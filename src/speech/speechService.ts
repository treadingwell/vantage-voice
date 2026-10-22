import { createModel, Model, KaldiRecognizer } from 'vosk-browser';
import { SherpaClient } from './sherpa/sherpaClient';
import { NeuralNarrator } from './neuralNarrator';
import { getModel, isModelDownloaded } from './models/modelStore';
import { normalizeForSpeech } from './ttsFormatter';

export type SttEngineMode = 'web-speech' | 'offline-wasm' | 'sherpa';

/** 'native' is the device's speechSynthesis; the others are sherpa model ids. */
export type TtsEngineMode = 'native' | 'kitten-nano' | 'supertonic-2';

export const SHERPA_STT_MODEL_ID = 'kroko-en';

export interface SpeechServiceState {
  isListening: boolean;
  isSpeaking: boolean;
  engine: SttEngineMode;
  ttsEngine: TtsEngineMode;
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

const TTS_START_TIMEOUT_MS = 2000;
const VOICE_LANG_STORAGE_KEY = 'vantage_voice_lang';
const VOICE_NAME_STORAGE_KEY = 'vantage_voice_name';
const STT_ENGINE_STORAGE_KEY = 'vantage_stt_engine';
const TTS_ENGINE_STORAGE_KEY = 'vantage_tts_engine';
const NEURAL_VOICE_STORAGE_PREFIX = 'vantage_tts_voice_';
const SENTENCE_PAUSE_STORAGE_KEY = 'vantage_sentence_pause_ms';

/** Extra silence between sentences for neural narrators */
export const DEFAULT_SENTENCE_PAUSE_MS = 250;

const STT_ENGINES: SttEngineMode[] = ['web-speech', 'offline-wasm', 'sherpa'];
const TTS_ENGINES: TtsEngineMode[] = ['native', 'kitten-nano', 'supertonic-2'];

/** 'en' matches every English locale; 'all' disables filtering. */
export const DEFAULT_VOICE_LANGUAGE = 'en';

function normalizeLang(lang: string): string {
  return lang.toLowerCase().replace('_', '-');
}

function loadPref(key: string): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function savePref(key: string, value: string | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch {
    // ignore
  }
}
// Only desktop Chrome needs the pause/resume keep-alive. On iOS Safari and Android,
// pause() halts the utterance and resume() doesn't reliably restart it.
const UA = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
const NEEDS_TTS_KEEPALIVE = /Chrome\//.test(UA) && !/Android|Mobile|iPhone|iPad/i.test(UA);

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
  private voiceLanguage: string = loadPref(VOICE_LANG_STORAGE_KEY) || DEFAULT_VOICE_LANGUAGE;
  private isAudioUnlocked = false;
  private ttsKeepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private ttsSafetyTimer: ReturnType<typeof setTimeout> | null = null;
  private ttsStartTimer: ReturnType<typeof setTimeout> | null = null;
  private finishActiveSpeech: (() => void) | null = null;

  // Neural (sherpa) TTS
  private ttsEngine: TtsEngineMode = 'native';
  private sentencePauseMs = DEFAULT_SENTENCE_PAUSE_MS;
  private sherpa: SherpaClient | null = null;
  private narrator: NeuralNarrator | null = null;

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
  private micAudioHandler: ((buffer: AudioBuffer) => void) | null = null;
  private modelBlobUrl: string | null = null;

  // Event Listeners
  private transcriptListeners = new Set<TranscriptCallback>();
  private stateChangeListeners = new Set<StateChangeCallback>();

  constructor() {
    this.initVoices();

    const savedStt = loadPref(STT_ENGINE_STORAGE_KEY) as SttEngineMode | null;
    if (savedStt && STT_ENGINES.includes(savedStt)) this.currentEngine = savedStt;
    // A saved neural narrator is only used once its model is loaded (see ensureNarratorReady)
    const savedTts = loadPref(TTS_ENGINE_STORAGE_KEY) as TtsEngineMode | null;
    if (savedTts && TTS_ENGINES.includes(savedTts)) this.ttsEngine = savedTts;
    const savedPause = Number(loadPref(SENTENCE_PAUSE_STORAGE_KEY));
    if (loadPref(SENTENCE_PAUSE_STORAGE_KEY) !== null && Number.isFinite(savedPause)) {
      this.sentencePauseMs = savedPause;
    }
  }

  private getSherpa(): SherpaClient {
    if (!this.sherpa) {
      this.sherpa = new SherpaClient();
      this.sherpa.onAsrResult((text, isFinal) => {
        if (this.currentEngine === 'sherpa' && !this.temporarilyPausedForSpeech && !this.isSpeakingState) {
          this.notifyTranscript(text, isFinal);
        }
      });
    }
    return this.sherpa;
  }

  private getNarrator(): NeuralNarrator {
    if (!this.narrator) {
      this.narrator = new NeuralNarrator(this.getSherpa(), () => this.getAudioContext());
    }
    return this.narrator;
  }

  private getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.audioContext || this.audioContext.state === 'closed') {
      this.audioContext = new AudioCtx();
    }
    return this.audioContext;
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
      this.availableVoices.some((v) => v.voiceURI === this.selectedVoice?.voiceURI) &&
      this.matchesVoiceLanguage(this.selectedVoice)
    ) {
      return;
    }
    if (this.availableVoices.length === 0) return;

    // Restore the user's saved voice if it's still installed and fits the language
    const savedName = loadPref(VOICE_NAME_STORAGE_KEY);
    const saved = savedName
      ? this.availableVoices.find((v) => v.name === savedName && this.matchesVoiceLanguage(v))
      : undefined;
    if (saved) {
      this.selectedVoice = saved;
      return;
    }

    // Filter for voices in the chosen language
    const languageVoices = this.getFilteredVoices();

    // Prefer offline/local voices
    const localLanguage = languageVoices.filter((v) => v.localService === true);
    const candidatePool =
      localLanguage.length > 0
        ? localLanguage
        : languageVoices.length > 0
        ? languageVoices
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
    savePref(VOICE_NAME_STORAGE_KEY, voice ? voice.name : null);
  }

  private matchesVoiceLanguage(voice: SpeechSynthesisVoice): boolean {
    if (this.voiceLanguage === 'all') return true;
    const lang = normalizeLang(voice.lang);
    return lang === this.voiceLanguage || lang.startsWith(`${this.voiceLanguage}-`);
  }

  /** Voices matching the chosen language, for the narrator voice picker. */
  public getFilteredVoices(): SpeechSynthesisVoice[] {
    return this.getVoices().filter((v) => this.matchesVoiceLanguage(v));
  }

  /** Distinct English locales installed on this device (e.g. en-us, en-gb), sorted. */
  public getEnglishVoiceLocales(): string[] {
    const locales = new Set(
      this.getVoices()
        .map((v) => normalizeLang(v.lang))
        .filter((l) => l.startsWith('en-'))
    );
    return Array.from(locales).sort();
  }

  public getVoiceLanguage(): string {
    return this.voiceLanguage;
  }

  /** Sets the language filter ('en', a locale like 'en-gb', or 'all') and re-picks a voice if needed. */
  public setVoiceLanguage(lang: string): void {
    this.voiceLanguage = lang === 'all' ? 'all' : normalizeLang(lang);
    savePref(VOICE_LANG_STORAGE_KEY, this.voiceLanguage);
    if (this.selectedVoice && !this.matchesVoiceLanguage(this.selectedVoice)) {
      this.selectedVoice = null;
    }
    this.autoSelectPreferredVoice();
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
    const cleanText = normalizeForSpeech(text.trim());
    if (this.muted || !cleanText) {
      options?.onStart?.();
      options?.onEnd?.();
      return Promise.resolve();
    }

    if (this.ttsEngine !== 'native' && this.sherpa?.isTtsLoaded(this.ttsEngine)) {
      return this.speakNeural(cleanText, options);
    }
    return this.speakNative(cleanText, options);
  }

  /**
   * Speaks through the selected sherpa model. Falls back to the device voice for this
   * utterance if generation fails, so the game never goes silent.
   */
  private speakNeural(cleanText: string, options?: SpeakOptions): Promise<void> {
    const wasListeningBeforeSpeak = this.isListeningDesired;
    if (wasListeningBeforeSpeak) {
      this.pauseListeningForSpeech();
    }

    // Speaking covers generation time too, so the mic stays ignored while audio is prepared
    this.isSpeakingState = true;
    this.notifyStateChange();

    return new Promise<void>((resolve) => {
      let isCompleted = false;
      const finish = (failed: boolean) => {
        if (isCompleted) return;
        isCompleted = true;
        if (this.finishActiveSpeech === finishInterrupted) this.finishActiveSpeech = null;
        this.isSpeakingState = false;
        this.notifyStateChange();
        if (wasListeningBeforeSpeak && this.isListeningDesired) {
          this.resumeListeningAfterSpeech();
        }
        // On failure the device-voice fallback resolves instead
        if (!failed) {
          options?.onEnd?.();
          resolve();
        }
      };
      const finishInterrupted = () => finish(false);
      this.finishActiveSpeech = finishInterrupted;

      this.getNarrator()
        .narrate(cleanText, {
          sid: this.getNeuralVoice(this.ttsEngine),
          speed: this.speechRate,
          sentencePauseMs: this.sentencePauseMs,
          onStart: () => options?.onStart?.(),
        })
        .then(
          () => finish(false),
          (err) => {
            if (isCompleted) return;
            console.warn('SpeechService: neural TTS failed, using device voice:', err);
            finish(true);
            this.speakNative(cleanText, options).then(resolve);
          }
        );
    });
  }

  private speakNative(cleanText: string, options?: SpeakOptions): Promise<void> {
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
        let isCompleted = false;
        let hasStarted = false;
        let retriesLeft = 1;
        let currentUtterance: SpeechSynthesisUtterance | null = null;

        const cleanup = () => {
          if (this.ttsStartTimer) {
            clearTimeout(this.ttsStartTimer);
            this.ttsStartTimer = null;
          }
          if (this.ttsSafetyTimer) {
            clearTimeout(this.ttsSafetyTimer);
            this.ttsSafetyTimer = null;
          }
          if (this.ttsKeepAliveTimer) {
            clearInterval(this.ttsKeepAliveTimer);
            this.ttsKeepAliveTimer = null;
          }
          this.activeUtterance = null;
          if (this.finishActiveSpeech === finish) {
            this.finishActiveSpeech = null;
          }
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

        // Safety timeout fallback, armed only once speech actually starts so a slow
        // engine start-up doesn't eat into it. Assumes a slow ~110 words/min
        // (1.8 words/sec * speechRate) plus an 8 second buffer (minimum 10s).
        const wordCount = cleanText.split(/\s+/).filter(Boolean).length;
        const estimatedSeconds = wordCount / (1.8 * this.speechRate) + 8;
        const safetyTimeoutMs = Math.max(10000, Math.round(estimatedSeconds * 1000));

        const onStarted = () => {
          if (hasStarted || isCompleted) return;
          hasStarted = true;
          if (this.ttsStartTimer) {
            clearTimeout(this.ttsStartTimer);
            this.ttsStartTimer = null;
          }
          this.isSpeakingState = true;
          this.notifyStateChange();
          options?.onStart?.();

          this.ttsSafetyTimer = setTimeout(() => {
            console.warn(
              `SpeechService: TTS safety timeout fallback fired after ${safetyTimeoutMs}ms`
            );
            window.speechSynthesis.cancel();
            finish();
          }, safetyTimeoutMs);

          // Chrome desktop freezes speech synthesis after ~15s unless briefly paused and resumed
          if (NEEDS_TTS_KEEPALIVE) {
            this.ttsKeepAliveTimer = setInterval(() => {
              if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
                window.speechSynthesis.pause();
                window.speechSynthesis.resume();
              }
            }, 10000);
          }
        };

        const attempt = () => {
          const utterance = new SpeechSynthesisUtterance(cleanText);
          if (this.selectedVoice) {
            utterance.voice = this.selectedVoice;
          }
          utterance.rate = this.speechRate;
          utterance.pitch = 1.0;
          utterance.volume = 1.0;

          // Handlers ignore events from an utterance superseded by a retry
          const isCurrent = () => currentUtterance === utterance;

          utterance.onstart = () => {
            if (isCurrent()) onStarted();
          };

          utterance.onend = () => {
            if (isCurrent()) finish();
          };

          utterance.onerror = (event) => {
            if (!isCurrent()) return;
            // 'canceled' and 'interrupted' are expected when user navigates or stops speech
            if (event.error === 'canceled' || event.error === 'interrupted') {
              finish();
            } else {
              fail(event);
            }
          };

          // Chrome occasionally drops an utterance queued right after cancel() and never
          // fires onstart. Retry once, then give up so the flow doesn't hang.
          this.ttsStartTimer = setTimeout(() => {
            this.ttsStartTimer = null;
            if (hasStarted || isCompleted) return;
            if (retriesLeft > 0) {
              retriesLeft--;
              this.activeUtterance = null;
              window.speechSynthesis.cancel();
              attempt();
            } else {
              console.warn('SpeechService: TTS never started; giving up');
              window.speechSynthesis.cancel();
              finish();
            }
          }, TTS_START_TIMEOUT_MS);

          currentUtterance = utterance;
          this.activeUtterance = utterance;
          window.speechSynthesis.speak(utterance);
          // Some Chrome builds leave the queue paused after a cancel()
          if (window.speechSynthesis.paused) {
            window.speechSynthesis.resume();
          }
        };

        this.finishActiveSpeech = finish;
        attempt();
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
    if (this.ttsStartTimer) {
      clearTimeout(this.ttsStartTimer);
      this.ttsStartTimer = null;
    }
    if (this.ttsSafetyTimer) {
      clearTimeout(this.ttsSafetyTimer);
      this.ttsSafetyTimer = null;
    }
    if (this.ttsKeepAliveTimer) {
      clearInterval(this.ttsKeepAliveTimer);
      this.ttsKeepAliveTimer = null;
    }
    this.activeUtterance = null;
    this.narrator?.stop();

    // Only cancel when something is queued: a needless cancel() right before speak()
    // makes Chrome drop the next utterance.
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        const synth = window.speechSynthesis;
        if (synth.speaking || synth.pending) {
          synth.cancel();
        }
      } catch {}
    }

    // Resolve the interrupted speak() promise even if the engine never fires an event
    const finishInterrupted = this.finishActiveSpeech;
    this.finishActiveSpeech = null;
    finishInterrupted?.();

    if (this.isSpeakingState) {
      this.isSpeakingState = false;
      this.notifyStateChange();
    }
  }

  public isSpeaking(): boolean {
    return this.isSpeakingState;
  }

  // -------------------------------------------------------------------------
  // Neural narrator selection (sherpa models)
  // -------------------------------------------------------------------------

  public getTtsEngine(): TtsEngineMode {
    return this.ttsEngine;
  }

  /** True when the selected narrator is actually in use (neural models must be loaded). */
  public isTtsEngineActive(): boolean {
    return this.ttsEngine === 'native' || Boolean(this.sherpa?.isTtsLoaded(this.ttsEngine));
  }

  /**
   * Switches narrator. Neural models must already be downloaded; they're loaded into the
   * worker here (about a second), so the first prompt doesn't pay that cost.
   */
  public async setTtsEngine(mode: TtsEngineMode): Promise<void> {
    this.stopSpeaking();
    if (mode !== 'native') {
      const model = getModel(mode);
      if (!model || !(await isModelDownloaded(model))) {
        throw new Error('Download this narrator before selecting it.');
      }
      await this.getSherpa().loadTts(mode);
    } else {
      await this.sherpa?.unloadTts();
    }
    this.ttsEngine = mode;
    savePref(TTS_ENGINE_STORAGE_KEY, mode);
    this.notifyStateChange();
  }

  public getNeuralVoice(mode: TtsEngineMode): number {
    const saved = Number(loadPref(NEURAL_VOICE_STORAGE_PREFIX + mode));
    return Number.isInteger(saved) && saved >= 0 ? saved : 0;
  }

  public setNeuralVoice(mode: TtsEngineMode, sid: number): void {
    savePref(NEURAL_VOICE_STORAGE_PREFIX + mode, String(sid));
  }

  public getSentencePauseMs(): number {
    return this.sentencePauseMs;
  }

  public setSentencePauseMs(ms: number): void {
    this.sentencePauseMs = Math.min(1500, Math.max(0, Math.round(ms)));
    savePref(SENTENCE_PAUSE_STORAGE_KEY, String(this.sentencePauseMs));
  }

  /**
   * Reloads the saved narrator and recognition models at startup when they're downloaded,
   * falling back to the built-in engines otherwise.
   */
  public async restoreSavedEngines(): Promise<void> {
    if (this.ttsEngine !== 'native') {
      try {
        await this.setTtsEngine(this.ttsEngine);
      } catch (err) {
        console.warn('SpeechService: saved narrator unavailable, using device voice:', err);
        this.ttsEngine = 'native';
        this.notifyStateChange();
      }
    }

    if (this.currentEngine === 'offline-wasm' && !(await this.isOfflineModelCached())) {
      this.currentEngine = 'web-speech';
      this.notifyStateChange();
    }
    if (this.currentEngine === 'sherpa') {
      const model = getModel(SHERPA_STT_MODEL_ID);
      if (!model || !(await isModelDownloaded(model))) {
        this.currentEngine = 'web-speech';
        this.notifyStateChange();
      }
    }
  }

  /** Frees a neural model from memory, e.g. before its files are deleted. */
  public async releaseSherpaModel(modelId: string): Promise<void> {
    if (this.ttsEngine === modelId) {
      await this.setTtsEngine('native');
    }
    if (modelId === SHERPA_STT_MODEL_ID) {
      if (this.currentEngine === 'sherpa') await this.setEngine('web-speech');
      await this.sherpa?.unloadAsr();
    }
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
    savePref(STT_ENGINE_STORAGE_KEY, mode);
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

  /** Deletes the cached Vosk model, switching recognition back to the browser if needed. */
  public async deleteOfflineModel(modelUrl: string = DEFAULT_VOSK_MODEL_URL): Promise<void> {
    if (this.currentEngine === 'offline-wasm') {
      await this.setEngine('web-speech');
    }
    this.voskModel?.terminate();
    this.voskModel = null;
    this.offlineModelReady = false;
    if (this.modelBlobUrl) {
      URL.revokeObjectURL(this.modelBlobUrl);
      this.modelBlobUrl = null;
    }
    if (typeof caches !== 'undefined') {
      try {
        const cache = await caches.open(VOSK_CACHE_NAME);
        await cache.delete(modelUrl);
      } catch {
        // ignore
      }
    }
    this.notifyStateChange();
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
      // Load the cached model after a reload; never start a 40 MB download implicitly
      if (!this.voskModel?.ready && (await this.isOfflineModelCached())) {
        await this.downloadAndInitOfflineModel();
      }
      await this.startOfflineVosk();
    } else if (this.currentEngine === 'sherpa') {
      await this.startSherpaStt();
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
    } else if (this.currentEngine === 'sherpa') {
      this.stopMicCapture();
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
      recognition.continuous = this.continuousListening;

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
      if (!this.getAudioContext()) return;
      this.recreateVoskRecognizer();
      await this.startMicCapture((buffer) => {
        try {
          this.voskRecognizer?.acceptWaveform(buffer);
        } catch (err) {
          console.error('SpeechService: acceptWaveform error:', err);
        }
      });
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : 'Failed to start offline microphone capture';
      console.error('SpeechService: startOfflineVosk error:', err);
      this.isListeningState = false;
      this.notifyStateChange({ error: errorMsg });
    }
  }

  private stopOfflineVosk(): void {
    this.stopMicCapture();

    if (this.voskRecognizer) {
      try {
        this.voskRecognizer.remove();
      } catch {}
      this.voskRecognizer = null;
    }
  }

  // -------------------------------------------------------------------------
  // Engine 3: Sherpa streaming Zipformer (runs in the sherpa Web Worker)
  // -------------------------------------------------------------------------

  private async startSherpaStt(): Promise<void> {
    try {
      const model = getModel(SHERPA_STT_MODEL_ID);
      if (!model || !(await isModelDownloaded(model))) {
        throw new Error('Download the Sherpa streaming model in Settings first.');
      }
      const sherpa = this.getSherpa();
      await sherpa.loadAsr(SHERPA_STT_MODEL_ID);
      if (!this.isListeningDesired) return;
      sherpa.resetAsr();
      const sampleRate = this.getAudioContext()?.sampleRate ?? 48000;
      await this.startMicCapture((buffer) => {
        // Copy: the worker takes ownership of the transferred buffer
        sherpa.feedAsr(new Float32Array(buffer.getChannelData(0)), sampleRate);
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to start sherpa recognition';
      console.error('SpeechService: startSherpaStt error:', err);
      this.isListeningState = false;
      this.notifyStateChange({ error: errorMsg });
    }
  }

  // -------------------------------------------------------------------------
  // Shared microphone capture for the offline engines
  // -------------------------------------------------------------------------

  /**
   * Opens the mic and calls onAudio for every captured block, except while the app is
   * speaking (frames are dropped so the recognizer never hears its own voice).
   */
  private async startMicCapture(onAudio: (buffer: AudioBuffer) => void): Promise<void> {
    const ctx = this.getAudioContext();
    if (!ctx) throw new Error('Web Audio is not available');
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    // Already capturing (e.g. listening resumes after a prompt): keep the mic open and just
    // swap the handler, rather than re-requesting the microphone every time
    const liveTrack = this.mediaStream?.getAudioTracks().some((t) => t.readyState === 'live');
    if (liveTrack && this.audioProcessor) {
      this.micAudioHandler = onAudio;
      this.isListeningState = true;
      this.notifyStateChange();
      return;
    }
    this.stopMicCapture();
    this.micAudioHandler = onAudio;

    // Acquire microphone stream with echo cancellation and noise suppression
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        channelCount: 1,
      },
    });

    this.mediaSource = ctx.createMediaStreamSource(this.mediaStream);
    this.audioProcessor = ctx.createScriptProcessor(4096, 1, 1);

    this.audioProcessor.onaudioprocess = (event: AudioProcessingEvent) => {
      if (!this.isListeningState || this.temporarilyPausedForSpeech || this.isSpeakingState) {
        return;
      }
      this.micAudioHandler?.(event.inputBuffer);
    };

    // Connect through a zero-gain node so microphone audio doesn't loop back to speaker
    this.audioZeroGain = ctx.createGain();
    this.audioZeroGain.gain.value = 0;

    this.mediaSource.connect(this.audioProcessor);
    this.audioProcessor.connect(this.audioZeroGain);
    this.audioZeroGain.connect(ctx.destination);

    this.isListeningState = true;
    this.notifyStateChange();
  }

  private stopMicCapture(): void {
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

    this.micAudioHandler = null;
    this.isListeningState = false;
    this.notifyStateChange();
  }

  // -------------------------------------------------------------------------
  // STT / TTS Coordination (Acoustic Echo Avoidance)
  // -------------------------------------------------------------------------

  private pauseListeningForSpeech(): void {
    this.temporarilyPausedForSpeech = true;
    if (this.currentEngine === 'web-speech') {
      // abort() releases the mic immediately; stop() waits to finalize, and while the
      // recording session is open iOS ducks or stalls TTS output
      if (this.webSpeechRecognition) {
        try {
          this.webSpeechRecognition.abort();
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
      } else if (this.currentEngine === 'sherpa') {
        // Drop any half-heard words from before the prompt
        this.sherpa?.resetAsr();
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
      ttsEngine: this.isTtsEngineActive() ? this.ttsEngine : 'native',
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
      ttsEngine: this.isTtsEngineActive() ? this.ttsEngine : 'native',
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
