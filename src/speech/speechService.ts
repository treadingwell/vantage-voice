import { createModel, Model, KaldiRecognizer } from 'vosk-browser';

export type SttEngineMode = 'web-speech' | 'offline-wasm';

export interface SpeechServiceState {
  isListening: boolean;
  isSpeaking: boolean;
  engine: SttEngineMode;
  offlineModelReady: boolean;
  error?: string;
}

export type TranscriptCallback = (
  text: string,
  isFinal: boolean,
  alternatives?: string[]
) => void;

export type StateChangeCallback = (state: SpeechServiceState) => void;
export type ProgressCallback = (status: string, percent?: number) => void;

export interface SpeakOptions {
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (err: unknown) => void;
}

export const DEFAULT_VOSK_MODEL_URL =
  'https://ccoreilly.github.io/vosk-browser/models/vosk-model-small-en-us-0.15.tar.gz';
export const VOSK_CACHE_NAME = 'vantage-vosk-model-cache-v1';

// Web Speech API interface definitions for strict typechecking across environments
interface ISpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface ISpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message?: string;
}

interface ISpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  processLocally?: boolean;
  onstart: ((this: ISpeechRecognition, ev: Event) => void) | null;
  onend: ((this: ISpeechRecognition, ev: Event) => void) | null;
  onerror: ((this: ISpeechRecognition, ev: ISpeechRecognitionErrorEvent) => void) | null;
  onresult: ((this: ISpeechRecognition, ev: ISpeechRecognitionEvent) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

function getSpeechRecognitionClass(): { new (): ISpeechRecognition } | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: { new (): ISpeechRecognition };
    webkitSpeechRecognition?: { new (): ISpeechRecognition };
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export class SpeechService {
  // TTS State
  private speechRate = 1.0; // Clamped between 0.8 and 1.4
  private muted = false;
  private isSpeakingState = false;
  private activeUtterance: SpeechSynthesisUtterance | null = null;
  private availableVoices: SpeechSynthesisVoice[] = [];
  private selectedVoice: SpeechSynthesisVoice | null = null;
  private isAudioUnlocked = false;
  private ttsKeepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private ttsSafetyTimer: ReturnType<typeof setTimeout> | null = null;

  // STT State
  private currentEngine: SttEngineMode = 'web-speech';
  private isListeningState = false;
  private isListeningDesired = false;
  private continuousListening = false;
  private temporarilyPausedForSpeech = false;

  // Web Speech Engine
  private webSpeechRecognition: ISpeechRecognition | null = null;
  private webSpeechRestartTimer: ReturnType<typeof setTimeout> | null = null;

  // Vosk Offline WASM Engine
  private voskModel: Model | null = null;
  private voskRecognizer: KaldiRecognizer | null = null;
  private offlineModelReady = false;
  private vocabularyWords: string[] = [];
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private mediaSource: MediaStreamAudioSourceNode | null = null;
  private audioProcessor: ScriptProcessorNode | null = null;
  private audioZeroGain: GainNode | null = null;
  private modelBlobUrl: string | null = null;

  // Event Listeners
  private transcriptListeners = new Set<TranscriptCallback>();
  private stateChangeListeners = new Set<StateChangeCallback>();

  constructor() {
    this.initVoices();
  }

  // =========================================================================
  // 1. Local Text-to-Speech (TTS) Engine
  // =========================================================================

  /**
   * Plays a silent Web Audio buffer and a zero-volume empty utterance on first user
   * tap/click so iOS Safari and Android Chrome allow programmatic TTS playback
   * during voice interactions.
   */
  public async unlockAudio(): Promise<boolean> {
    if (this.isAudioUnlocked) return true;

    try {
      if (typeof window !== 'undefined') {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;

        if (AudioCtx) {
          if (!this.audioContext || this.audioContext.state === 'closed') {
            this.audioContext = new AudioCtx();
          }
          if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
          }

          // Play a silent 1-frame Web Audio buffer
          const buffer = this.audioContext.createBuffer(1, 1, 22050);
          const source = this.audioContext.createBufferSource();
          source.buffer = buffer;
          source.connect(this.audioContext.destination);
          source.start(0);
        }

        // Trigger zero-volume empty SpeechSynthesis utterance
        if ('speechSynthesis' in window) {
          const silentUtterance = new SpeechSynthesisUtterance('');
          silentUtterance.volume = 0;
          silentUtterance.rate = 1.0;
          window.speechSynthesis.speak(silentUtterance);
          if (window.speechSynthesis.paused) {
            window.speechSynthesis.resume();
          }
        }
      }
      this.isAudioUnlocked = true;
      return true;
    } catch (err) {
      console.warn('SpeechService: Audio unlock caught warning:', err);
      this.isAudioUnlocked = true;
      return true;
    }
  }

  /**
   * Initializes and listens for voice changes.
   */
  private initVoices(): void {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    this.refreshVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = () => {
        this.refreshVoices();
      };
    }
  }

  /**
   * Refreshes the list of available system voices and auto-selects preferred local English voice.
   */
  public refreshVoices(): SpeechSynthesisVoice[] {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];

    try {
      this.availableVoices = window.speechSynthesis.getVoices() || [];
      this.autoSelectPreferredVoice();
    } catch {
      this.availableVoices = [];
    }
    return this.availableVoices;
  }

  /**
   * Voice selection: prefers high-quality local/offline English voices
   * (voice.localService === true and voice.lang.startsWith('en')).
   */
  private autoSelectPreferredVoice(): void {
    if (
      this.selectedVoice &&
      this.availableVoices.some((v) => v.voiceURI === this.selectedVoice?.voiceURI)
    ) {
      return;
    }
    if (this.availableVoices.length === 0) return;

    // Filter for English voices
    const englishVoices = this.availableVoices.filter((v) =>
      v.lang.toLowerCase().replace('_', '-').startsWith('en')
    );

    // Prefer offline/local voices
    const localEnglish = englishVoices.filter((v) => v.localService === true);
    const candidatePool =
      localEnglish.length > 0
        ? localEnglish
        : englishVoices.length > 0
        ? englishVoices
        : this.availableVoices;

    // Rank high-quality natural sounding voice profiles
    const qualityKeywords = [
      'natural',
      'premium',
      'enhanced',
      'google',
      'siri',
      'samantha',
      'daniel',
      'karen',
      'oliver',
      'serena',
      'aaron',
    ];

    let bestVoice = candidatePool.find((v) =>
      qualityKeywords.some((kw) => v.name.toLowerCase().includes(kw))
    );

    if (!bestVoice) {
      bestVoice = candidatePool.find((v) => v.default) || candidatePool[0];
    }

    this.selectedVoice = bestVoice || null;
  }

  public getVoices(): SpeechSynthesisVoice[] {
    if (this.availableVoices.length === 0) {
      this.refreshVoices();
    }
    return this.availableVoices;
  }

  public getSelectedVoice(): SpeechSynthesisVoice | null {
    return this.selectedVoice;
  }

  public setSelectedVoice(voice: SpeechSynthesisVoice | null): void {
    this.selectedVoice = voice;
  }

  /**
   * Sets speech rate, clamped between 0.8 and 1.4 (default 1.0).
   */
  public setSpeechRate(rate: number): void {
    this.speechRate = Math.min(1.4, Math.max(0.8, rate));
  }

  public getSpeechRate(): number {
    return this.speechRate;
  }

  /**
   * Configures TTS mute toggle.
   */
  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted && this.isSpeakingState) {
      this.stopSpeaking();
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public toggleMuted(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /**
   * Cancels any ongoing speech before speaking, pauses STT while TTS is speaking
   * so the mic doesn't hear the app's own voice, and resolves when speech completes
   * (including a safety timeout fallback in case mobile browser onend doesn't fire).
   */
  public speak(text: string, options?: SpeakOptions): Promise<void> {
    // Cancel any ongoing speech
    this.stopSpeaking();

    // Check mute or empty text
    const cleanText = text.trim();
    if (this.muted || !cleanText) {
      options?.onStart?.();
      options?.onEnd?.();
      return Promise.resolve();
    }

    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      options?.onStart?.();
      options?.onEnd?.();
      return Promise.resolve();
    }

    // Pause STT while speaking so mic does not pick up synthesized audio
    const wasListeningBeforeSpeak = this.isListeningDesired;
    if (wasListeningBeforeSpeak) {
      this.pauseListeningForSpeech();
    }

    return new Promise<void>((resolve) => {
      try {
        const utterance = new SpeechSynthesisUtterance(cleanText);
        if (this.selectedVoice) {
          utterance.voice = this.selectedVoice;
        }
        utterance.rate = this.speechRate;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;

        let isCompleted = false;

        const cleanup = () => {
          if (this.ttsSafetyTimer) {
            clearTimeout(this.ttsSafetyTimer);
            this.ttsSafetyTimer = null;
          }
          if (this.ttsKeepAliveTimer) {
            clearInterval(this.ttsKeepAliveTimer);
            this.ttsKeepAliveTimer = null;
          }
          this.activeUtterance = null;
          this.isSpeakingState = false;
          this.notifyStateChange();

          // Resume STT if it was listening before TTS started
          if (wasListeningBeforeSpeak && this.isListeningDesired) {
            this.resumeListeningAfterSpeech();
          }
        };

        const finish = () => {
          if (isCompleted) return;
          isCompleted = true;
          cleanup();
          options?.onEnd?.();
          resolve();
        };

        const fail = (err: unknown) => {
          if (isCompleted) return;
          isCompleted = true;
          cleanup();
          options?.onError?.(err);
          resolve();
        };

        utterance.onstart = () => {
          this.isSpeakingState = true;
          this.notifyStateChange();
          options?.onStart?.();
        };

        utterance.onend = () => {
          finish();
        };

        utterance.onerror = (event) => {
          // 'canceled' and 'interrupted' are expected when user navigates or stops speech
          if (event.error === 'canceled' || event.error === 'interrupted') {
            finish();
          } else {
            fail(event);
          }
        };

        // Safety timeout fallback:
        // Speech rate: ~150 words/min = 2.5 words/sec * speechRate.
        // Estimate speech duration + 4 second safety buffer (minimum 5s).
        const wordCount = cleanText.split(/\s+/).filter(Boolean).length;
        const estimatedSeconds = wordCount / (2.5 * this.speechRate) + 4;
        const safetyTimeoutMs = Math.max(5000, Math.round(estimatedSeconds * 1000));

        this.ttsSafetyTimer = setTimeout(() => {
          console.warn(
            `SpeechService: TTS safety timeout fallback fired after ${safetyTimeoutMs}ms`
          );
          if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
            window.speechSynthesis.cancel();
          }
          finish();
        }, safetyTimeoutMs);

        // Chrome 15s freeze workaround: Chrome pauses speech synthesis after ~15s
        // unless briefly paused and resumed
        this.ttsKeepAliveTimer = setInterval(() => {
          if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
            if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
              window.speechSynthesis.pause();
              window.speechSynthesis.resume();
            }
          }
        }, 10000);

        this.activeUtterance = utterance;
        window.speechSynthesis.speak(utterance);
      } catch (err) {
        if (wasListeningBeforeSpeak && this.isListeningDesired) {
          this.resumeListeningAfterSpeech();
        }
        options?.onError?.(err);
        resolve();
      }
    });
  }

  /**
   * Stops any ongoing TTS speech.
   */
  public stopSpeaking(): void {
    if (this.ttsSafetyTimer) {
      clearTimeout(this.ttsSafetyTimer);
      this.ttsSafetyTimer = null;
    }
    if (this.ttsKeepAliveTimer) {
      clearInterval(this.ttsKeepAliveTimer);
      this.ttsKeepAliveTimer = null;
    }
    this.activeUtterance = null;

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }

    if (this.isSpeakingState) {
      this.isSpeakingState = false;
      this.notifyStateChange();
    }
  }

  public isSpeaking(): boolean {
    return this.isSpeakingState;
  }

  // =========================================================================
  // 2. Dual-Engine Local Speech-to-Text (STT)
  // =========================================================================

  public getEngine(): SttEngineMode {
    return this.currentEngine;
  }

  public async setEngine(mode: SttEngineMode): Promise<void> {
    if (this.currentEngine === mode) return;

    const wasListening = this.isListeningDesired;
    if (wasListening) {
      this.stopListening();
    }

    this.currentEngine = mode;
    this.notifyStateChange();

    if (wasListening) {
      await this.startListening(this.continuousListening);
    }
  }

  public isWebSpeechSupported(): boolean {
    return getSpeechRecognitionClass() !== null;
  }

  public isOfflineModelReady(): boolean {
    return this.offlineModelReady;
  }

  /**
   * Sets the restricted vocabulary words for Vosk grammar constraint.
   */
  public setVocabulary(words: string[]): void {
    this.vocabularyWords = words;
    if (
      this.currentEngine === 'offline-wasm' &&
      this.voskRecognizer &&
      this.voskModel &&
      this.isListeningState
    ) {
      this.recreateVoskRecognizer();
    }
  }

  /**
   * Checks if the compact English Vosk model is cached in CacheStorage.
   */
  public async isOfflineModelCached(
    modelUrl: string = DEFAULT_VOSK_MODEL_URL
  ): Promise<boolean> {
    if (typeof window === 'undefined' || typeof caches === 'undefined') {
      return false;
    }
    try {
      const cache = await caches.open(VOSK_CACHE_NAME);
      const match = await cache.match(modelUrl);
      return Boolean(match);
    } catch {
      return false;
    }
  }

  /**
   * Downloads and initializes the compact English Vosk model, cached via CacheStorage
   * so once downloaded it works 100% offline in Airplane Mode.
   */
  public async downloadAndInitOfflineModel(
    onProgress?: ProgressCallback,
    modelUrl: string = DEFAULT_VOSK_MODEL_URL
  ): Promise<boolean> {
    if (this.voskModel?.ready) {
      this.offlineModelReady = true;
      onProgress?.('Offline model already loaded', 100);
      this.notifyStateChange();
      return true;
    }

    try {
      let modelLoadUrl = modelUrl;

      if (typeof window !== 'undefined' && typeof caches !== 'undefined') {
        const cache = await caches.open(VOSK_CACHE_NAME);
        const cachedResponse = await cache.match(modelUrl);

        if (cachedResponse) {
          onProgress?.('Loading cached offline speech model...', 50);
          const blob = await cachedResponse.blob();
          if (this.modelBlobUrl) {
            URL.revokeObjectURL(this.modelBlobUrl);
          }
          this.modelBlobUrl = URL.createObjectURL(blob);
          modelLoadUrl = this.modelBlobUrl;
        } else {
          onProgress?.('Downloading offline speech model (~40 MB)...', 0);
          const response = await fetch(modelUrl);
          if (!response.ok) {
            throw new Error(
              `Failed to fetch offline model: HTTP ${response.status} ${response.statusText}`
            );
          }

          const contentLengthHeader = response.headers.get('content-length');
          const totalBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;
          let loadedBytes = 0;

          if (response.body && totalBytes > 0) {
            const reader = response.body.getReader();
            const chunks: BlobPart[] = [];

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value) {
                chunks.push(
                  value.buffer.slice(
                    value.byteOffset,
                    value.byteOffset + value.byteLength
                  ) as ArrayBuffer
                );
                loadedBytes += value.length;
                const percent = Math.min(99, Math.round((loadedBytes / totalBytes) * 100));
                onProgress?.(
                  `Downloading offline speech model... (${percent}%)`,
                  percent
                );
              }
            }

            const blob = new Blob(chunks, { type: 'application/gzip' });
            // Cache the downloaded model for 100% offline use
            await cache.put(
              modelUrl,
              new Response(blob.slice(), {
                headers: {
                  'Content-Type': 'application/gzip',
                  'Content-Length': String(blob.size),
                },
              })
            );

            if (this.modelBlobUrl) {
              URL.revokeObjectURL(this.modelBlobUrl);
            }
            this.modelBlobUrl = URL.createObjectURL(blob);
            modelLoadUrl = this.modelBlobUrl;
          } else {
            // Streaming reader not available
            const blob = await response.blob();
            await cache.put(
              modelUrl,
              new Response(blob.slice(), {
                headers: { 'Content-Type': 'application/gzip' },
              })
            );

            if (this.modelBlobUrl) {
              URL.revokeObjectURL(this.modelBlobUrl);
            }
            this.modelBlobUrl = URL.createObjectURL(blob);
            modelLoadUrl = this.modelBlobUrl;
          }
        }
      }

      onProgress?.('Initializing WASM speech recognizer...', 90);
      const model = await createModel(modelLoadUrl);
      this.voskModel = model;
      this.offlineModelReady = true;
      onProgress?.('Offline speech model ready', 100);
      this.notifyStateChange();
      return true;
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : 'Failed to initialize offline speech model';
      console.error('SpeechService: Offline model error:', err);
      this.notifyStateChange({ error: errorMsg });
      return false;
    }
  }

  /**
   * Starts listening for user speech with the selected STT engine.
   */
  public async startListening(continuous: boolean = false): Promise<void> {
    this.isListeningDesired = true;
    this.continuousListening = continuous;
    this.temporarilyPausedForSpeech = false;

    await this.unlockAudio();

    if (this.currentEngine === 'offline-wasm') {
      await this.startOfflineVosk();
    } else {
      this.startWebSpeech();
    }
  }

  /**
   * Stops STT listening.
   */
  public stopListening(): void {
    this.isListeningDesired = false;
    this.continuousListening = false;
    this.temporarilyPausedForSpeech = false;

    if (this.webSpeechRestartTimer) {
      clearTimeout(this.webSpeechRestartTimer);
      this.webSpeechRestartTimer = null;
    }

    if (this.currentEngine === 'offline-wasm') {
      this.stopOfflineVosk();
    } else {
      this.stopWebSpeech();
    }
  }

  public isListening(): boolean {
    return this.isListeningState;
  }

  // -------------------------------------------------------------------------
  // Engine 1: Native Web Speech API
  // -------------------------------------------------------------------------

  private startWebSpeech(): void {
    if (this.webSpeechRecognition) return;

    const RecClass = getSpeechRecognitionClass();
    if (!RecClass) {
      const errorMsg = 'Web Speech API is not supported in this browser.';
      console.warn('SpeechService:', errorMsg);
      this.notifyStateChange({ error: errorMsg });
      return;
    }

    try {
      const recognition = new RecClass();
      recognition.lang = 'en-US';
      recognition.interimResults = true;
      recognition.maxAlternatives = 5;

      // Prefer local processing if supported
      if ('processLocally' in recognition) {
        (recognition as unknown as { processLocally: boolean }).processLocally = true;
      }

      recognition.onstart = () => {
        this.isListeningState = true;
        this.notifyStateChange();
      };

      recognition.onresult = (event: ISpeechRecognitionEvent) => {
        let interimText = '';
        let finalText = '';
        const alternatives: string[] = [];

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const item = event.results[i];
          if (item.isFinal) {
            finalText += item[0].transcript;
            for (let j = 0; j < item.length; j++) {
              alternatives.push(item[j].transcript);
            }
          } else {
            interimText += item[0].transcript;
          }
        }

        if (finalText) {
          this.notifyTranscript(finalText.trim(), true, alternatives);
        } else if (interimText) {
          this.notifyTranscript(interimText.trim(), false);
        }
      };

      recognition.onerror = (event: ISpeechRecognitionErrorEvent) => {
        if (event.error === 'no-speech') {
          // Standard timeout during silence; will auto-restart if continuous
          return;
        }
        if (event.error === 'aborted') {
          return;
        }
        console.warn('SpeechService: Web Speech API error:', event.error);
        this.notifyStateChange({ error: `Speech recognition: ${event.error}` });
      };

      recognition.onend = () => {
        this.webSpeechRecognition = null;

        // Automatically restart listening if continuousListening is active
        // and session ends without a final match (e.g. while waiting for dice roll)
        if (
          this.isListeningDesired &&
          !this.temporarilyPausedForSpeech &&
          !this.isSpeakingState
        ) {
          this.webSpeechRestartTimer = setTimeout(() => {
            if (
              this.isListeningDesired &&
              !this.temporarilyPausedForSpeech &&
              !this.isSpeakingState
            ) {
              this.startWebSpeech();
            }
          }, 150);
        } else {
          if (!this.temporarilyPausedForSpeech) {
            this.isListeningState = false;
            this.notifyStateChange();
          }
        }
      };

      this.webSpeechRecognition = recognition;
      recognition.start();
    } catch (err) {
      console.warn('SpeechService: Failed to start Web Speech recognition:', err);
      this.isListeningState = false;
      this.notifyStateChange();
    }
  }

  private stopWebSpeech(): void {
    if (this.webSpeechRestartTimer) {
      clearTimeout(this.webSpeechRestartTimer);
      this.webSpeechRestartTimer = null;
    }

    if (this.webSpeechRecognition) {
      try {
        this.webSpeechRecognition.abort();
      } catch {}
      this.webSpeechRecognition = null;
    }

    this.isListeningState = false;
    this.notifyStateChange();
  }

  // -------------------------------------------------------------------------
  // Engine 2: Offline WASM Model (Vosk)
  // -------------------------------------------------------------------------

  private getVoskGrammarString(): string | undefined {
    if (!this.vocabularyWords || this.vocabularyWords.length === 0) {
      return undefined;
    }

    const cleanedWords = Array.from(
      new Set(
        this.vocabularyWords
          .map((w) => w.trim().toLowerCase())
          .filter((w) => w.length > 0)
      )
    );

    if (!cleanedWords.includes('[unk]')) {
      cleanedWords.push('[unk]');
    }

    return JSON.stringify(cleanedWords);
  }

  private recreateVoskRecognizer(): void {
    if (!this.voskModel || !this.voskModel.ready || !this.audioContext) return;

    if (this.voskRecognizer) {
      try {
        this.voskRecognizer.remove();
      } catch {}
      this.voskRecognizer = null;
    }

    const grammar = this.getVoskGrammarString();
    this.voskRecognizer = new this.voskModel.KaldiRecognizer(
      this.audioContext.sampleRate,
      grammar
    );
    this.attachVoskEvents(this.voskRecognizer);
  }

  private attachVoskEvents(recognizer: KaldiRecognizer): void {
    recognizer.on('result', (message: unknown) => {
      const msg = message as { result?: { text?: string } };
      const text = msg?.result?.text;
      if (text && text.trim()) {
        this.notifyTranscript(text.trim(), true);
      }
    });

    recognizer.on('partialresult', (message: unknown) => {
      const msg = message as { result?: { partial?: string } };
      const partial = msg?.result?.partial;
      if (partial && partial.trim()) {
        this.notifyTranscript(partial.trim(), false);
      }
    });

    recognizer.on('error', (message: unknown) => {
      const msg = message as { error?: string };
      const err = msg?.error || 'Vosk recognition error';
      console.warn('SpeechService: Vosk error:', err);
      this.notifyStateChange({ error: err });
    });
  }

  private async startOfflineVosk(): Promise<void> {
    if (!this.voskModel || !this.voskModel.ready) {
      const errorMsg =
        'Offline Vosk model is not initialized. Call downloadAndInitOfflineModel() first.';
      console.warn('SpeechService:', errorMsg);
      this.notifyStateChange({ error: errorMsg });
      return;
    }

    try {
      if (typeof window === 'undefined') return;

      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;

      if (!this.audioContext || this.audioContext.state === 'closed') {
        this.audioContext = new AudioCtx();
      }

      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      this.recreateVoskRecognizer();

      // Acquire microphone stream with echo cancellation and noise suppression
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
      });

      this.mediaSource = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.audioProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);

      this.audioProcessor.onaudioprocess = (event: AudioProcessingEvent) => {
        if (
          !this.isListeningState ||
          this.temporarilyPausedForSpeech ||
          this.isSpeakingState
        ) {
          return;
        }

        try {
          this.voskRecognizer?.acceptWaveform(event.inputBuffer);
        } catch (err) {
          console.error('SpeechService: acceptWaveform error:', err);
        }
      };

      // Connect through a zero-gain node so microphone audio doesn't loop back to speaker
      this.audioZeroGain = this.audioContext.createGain();
      this.audioZeroGain.gain.value = 0;

      this.mediaSource.connect(this.audioProcessor);
      this.audioProcessor.connect(this.audioZeroGain);
      this.audioZeroGain.connect(this.audioContext.destination);

      this.isListeningState = true;
      this.notifyStateChange();
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : 'Failed to start offline microphone capture';
      console.error('SpeechService: startOfflineVosk error:', err);
      this.isListeningState = false;
      this.notifyStateChange({ error: errorMsg });
    }
  }

  private stopOfflineVosk(): void {
    if (this.mediaStream) {
      try {
        this.mediaStream.getTracks().forEach((track) => track.stop());
      } catch {}
      this.mediaStream = null;
    }

    if (this.mediaSource) {
      try {
        this.mediaSource.disconnect();
      } catch {}
      this.mediaSource = null;
    }

    if (this.audioProcessor) {
      try {
        this.audioProcessor.onaudioprocess = null;
        this.audioProcessor.disconnect();
      } catch {}
      this.audioProcessor = null;
    }

    if (this.audioZeroGain) {
      try {
        this.audioZeroGain.disconnect();
      } catch {}
      this.audioZeroGain = null;
    }

    if (this.voskRecognizer) {
      try {
        this.voskRecognizer.remove();
      } catch {}
      this.voskRecognizer = null;
    }

    this.isListeningState = false;
    this.notifyStateChange();
  }

  // -------------------------------------------------------------------------
  // STT / TTS Coordination (Acoustic Echo Avoidance)
  // -------------------------------------------------------------------------

  private pauseListeningForSpeech(): void {
    this.temporarilyPausedForSpeech = true;
    if (this.currentEngine === 'web-speech') {
      if (this.webSpeechRecognition) {
        try {
          this.webSpeechRecognition.stop();
        } catch {}
      }
    }
    // For offline-wasm, ScriptProcessor drops incoming audio frames while
    // this.temporarilyPausedForSpeech is true, keeping audio pipe warm without echo.
  }

  private resumeListeningAfterSpeech(): void {
    this.temporarilyPausedForSpeech = false;
    if (this.isListeningDesired && !this.isSpeakingState) {
      if (this.currentEngine === 'web-speech') {
        this.startWebSpeech();
      }
    }
  }

  // =========================================================================
  // 3. Unified Event Callbacks & State
  // =========================================================================

  public onTranscript(callback: TranscriptCallback): () => void {
    this.transcriptListeners.add(callback);
    return () => {
      this.transcriptListeners.delete(callback);
    };
  }

  public onStateChange(callback: StateChangeCallback): () => void {
    this.stateChangeListeners.add(callback);
    // Emit immediate current state
    callback(this.getState());
    return () => {
      this.stateChangeListeners.delete(callback);
    };
  }

  public getState(): SpeechServiceState {
    return {
      isListening: this.isListeningState,
      isSpeaking: this.isSpeakingState,
      engine: this.currentEngine,
      offlineModelReady: this.offlineModelReady,
    };
  }

  private notifyTranscript(
    text: string,
    isFinal: boolean,
    alternatives?: string[]
  ): void {
    for (const listener of this.transcriptListeners) {
      try {
        listener(text, isFinal, alternatives);
      } catch (err) {
        console.error('SpeechService: Error in transcript callback:', err);
      }
    }
  }

  private notifyStateChange(override?: Partial<SpeechServiceState>): void {
    const state: SpeechServiceState = {
      isListening: this.isListeningState,
      isSpeaking: this.isSpeakingState,
      engine: this.currentEngine,
      offlineModelReady: this.offlineModelReady,
      ...override,
    };

    for (const listener of this.stateChangeListeners) {
      try {
        listener(state);
      } catch (err) {
        console.error('SpeechService: Error in state change callback:', err);
      }
    }
  }
}

export const speechService = new SpeechService();
export default speechService;
