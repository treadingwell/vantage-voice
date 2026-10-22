import {
  BookName,
  CandidateMatch,
  ParsedBranchChoice,
  ParsedResultContent,
  StoryEntryVariant,
  StoryLookupResult,
  VoiceIntent,
  VoiceStateMode,
} from '../data/types';
import { StoryDatabase } from '../data/storyDb';
import {
  formatActionPromptForSpeech,
  formatBranchChoicesPrompt,
  formatDisambiguationPrompt,
  parseAndFormatResult,
} from '../speech/ttsFormatter';
import { parseVoiceInput } from '../speech/voiceParser';
import { SpeechService, SttEngineMode, TtsEngineMode } from '../speech/speechService';

export interface RecentLookupItem {
  key: string;
  bookName: BookName;
  number: number;
  label: string;
  variantIndex?: number;
  timestamp: number;
}

export interface VoiceControllerState {
  mode: VoiceStateMode;
  activeResult: StoryLookupResult | null;
  activeVariantIndex: number | null;
  activeChoices: ParsedBranchChoice[];
  chosenBranchIndex: number | null;
  isObscured: boolean;
  transcript: string;
  isFinalTranscript: boolean;
  statusMessage: string;
  isSpeaking: boolean;
  isListening: boolean;
  handsFreeMode: boolean;
  sttEngine: SttEngineMode;
  ttsEngine: TtsEngineMode;
  isMuted: boolean;
  recentLookups: RecentLookupItem[];
}

export type InputSource = 'voice' | 'tap';

export type StateListener = (state: VoiceControllerState) => void;

const RECENT_LOOKUPS_STORAGE_KEY = 'vantage_recent_lookups';
const HANDS_FREE_STORAGE_KEY = 'vantage_hands_free_mode';
const MAX_RECENT_LOOKUPS = 8;

export interface VoiceControllerOptions {
  commandDebounceMs?: number;
  promptResetMs?: number;
}

export class VoiceController {
  private db: StoryDatabase;
  private speech: SpeechService;
  private state: VoiceControllerState;
  private listeners: Set<StateListener> = new Set();
  private parsedResultCache: ParsedResultContent | null = null;
  private unsubSpeechState: (() => void) | null = null;
  private unsubTranscript: (() => void) | null = null;

  private commandDebounceMs: number;
  private promptResetMs: number;
  private utteranceBuffer: string = '';
  private commandSettleTimer: ReturnType<typeof setTimeout> | null = null;
  private promptResetTimer: ReturnType<typeof setTimeout> | null = null;
  private interimSilenceTimer: ReturnType<typeof setTimeout> | null = null;
  // True while the current lookup was started by voice; lets the mic answer its prompts
  // ("done", options) even when hands-free mode is off
  private voiceFlow = false;

  constructor(
    db: StoryDatabase,
    speechService: SpeechService,
    options?: VoiceControllerOptions
  ) {
    this.db = db;
    this.speech = speechService;
    this.commandDebounceMs = options?.commandDebounceMs ?? 1000;
    this.promptResetMs = options?.promptResetMs ?? 1800;

    // Load initial settings
    const storedHandsFree =
      typeof localStorage !== 'undefined'
        ? localStorage.getItem(HANDS_FREE_STORAGE_KEY) === 'true'
        : false;

    const storedRecents = this.loadRecentLookups();

    const speechState = this.speech.getState();

    this.state = {
      mode: 'IDLE',
      activeResult: null,
      activeVariantIndex: null,
      activeChoices: [],
      chosenBranchIndex: null,
      isObscured: true,
      transcript: '',
      isFinalTranscript: false,
      statusMessage: 'Tap Mic & say e.g. "Transmit on 236"',
      isSpeaking: speechState.isSpeaking,
      isListening: speechState.isListening,
      handsFreeMode: storedHandsFree,
      sttEngine: speechState.engine,
      ttsEngine: speechState.ttsEngine,
      isMuted: this.speech.isMuted(),
      recentLookups: storedRecents,
    };

    this.setupSpeechListeners();
  }

  private setupSpeechListeners(): void {
    this.unsubSpeechState = this.speech.onStateChange((s) => {
      let stateChanged = false;

      if (this.state.isSpeaking !== s.isSpeaking) {
        this.state.isSpeaking = s.isSpeaking;
        stateChanged = true;
      }

      if (this.state.isListening !== s.isListening) {
        this.state.isListening = s.isListening;
        stateChanged = true;
      }

      if (this.state.sttEngine !== s.engine) {
        this.state.sttEngine = s.engine;
        stateChanged = true;
      }

      if (this.state.ttsEngine !== s.ttsEngine) {
        this.state.ttsEngine = s.ttsEngine;
        stateChanged = true;
      }

      const muted = this.speech.isMuted();
      if (this.state.isMuted !== muted) {
        this.state.isMuted = muted;
        stateChanged = true;
      }

      if (stateChanged) {
        this.notify();
      }
    });

    this.unsubTranscript = this.speech.onTranscript((text, isFinal) => {
      this.onLiveSpeechTranscript(text, isFinal);
    });
  }

  private onLiveSpeechTranscript(text: string, isFinal: boolean): void {
    // Clear any pending prompt reset since user is actively speaking
    if (this.promptResetTimer) {
      clearTimeout(this.promptResetTimer);
      this.promptResetTimer = null;
    }

    if (!isFinal) {
      if (this.interimSilenceTimer) {
        clearTimeout(this.interimSilenceTimer);
        this.interimSilenceTimer = null;
      }

      // Display accumulated text + current interim segment
      const currentDisplay = (
        this.utteranceBuffer ? `${this.utteranceBuffer} ${text}` : text
      ).trim();
      this.state.transcript = currentDisplay;
      this.state.isFinalTranscript = false;
      this.notify();

      // If user goes completely silent mid-sentence for 2s without a final chunk, auto-reset
      this.interimSilenceTimer = setTimeout(() => {
        this.interimSilenceTimer = null;
        this.resetTranscriptAndPrompt();
      }, 2000);

      // Reset settle timer so we don't commit while user is speaking
      if (this.commandSettleTimer) {
        clearTimeout(this.commandSettleTimer);
        this.commandSettleTimer = null;
      }
      return;
    }

    // isFinal === true
    if (this.interimSilenceTimer) {
      clearTimeout(this.interimSilenceTimer);
      this.interimSilenceTimer = null;
    }

    const cleanChunk = text.trim();
    if (cleanChunk) {
      this.utteranceBuffer = (
        this.utteranceBuffer ? `${this.utteranceBuffer} ${cleanChunk}` : cleanChunk
      ).trim();
    }

    this.state.transcript = this.utteranceBuffer;
    this.state.isFinalTranscript = false;
    this.notify();

    if (this.commandDebounceMs <= 0) {
      this.commitLiveUtterance();
      return;
    }

    // Determine debounce wait:
    // Fast 1-word control command in WAITING_FOR_DONE triggers after 350ms settle
    const isFastControl =
      this.state.mode === 'WAITING_FOR_DONE' &&
      !/\d/.test(this.utteranceBuffer) &&
      /^\s*(done|ready|reveal|read|continue|finished|ok|okay|stop|cancel|repeat)\s*$/i.test(
        this.utteranceBuffer
      );

    const delay = isFastControl ? Math.min(350, this.commandDebounceMs) : this.commandDebounceMs;

    if (this.commandSettleTimer) {
      clearTimeout(this.commandSettleTimer);
      this.commandSettleTimer = null;
    }

    this.commandSettleTimer = setTimeout(async () => {
      await this.commitLiveUtterance();
    }, delay);
  }

  private async commitLiveUtterance(): Promise<void> {
    if (this.commandSettleTimer) {
      clearTimeout(this.commandSettleTimer);
      this.commandSettleTimer = null;
    }
    const full = this.utteranceBuffer.trim();
    this.utteranceBuffer = '';
    if (full) {
      await this.handleTranscript(full, true);
    }
  }

  public dispose(): void {
    if (this.commandSettleTimer) {
      clearTimeout(this.commandSettleTimer);
      this.commandSettleTimer = null;
    }
    if (this.promptResetTimer) {
      clearTimeout(this.promptResetTimer);
      this.promptResetTimer = null;
    }
    if (this.interimSilenceTimer) {
      clearTimeout(this.interimSilenceTimer);
      this.interimSilenceTimer = null;
    }
    this.utteranceBuffer = '';

    if (this.unsubSpeechState) {
      this.unsubSpeechState();
      this.unsubSpeechState = null;
    }
    if (this.unsubTranscript) {
      this.unsubTranscript();
      this.unsubTranscript = null;
    }
  }

  public getState(): VoiceControllerState {
    return { ...this.state };
  }

  public onStateChange(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const snapshot = this.getState();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private updateStatusMessage(): void {
    if (this.state.isSpeaking) {
      this.state.statusMessage = 'Reading aloud...';
      return;
    }

    switch (this.state.mode) {
      case 'IDLE':
        this.state.statusMessage = 'Tap Mic & say e.g. "Transmit on 236"';
        break;
      case 'LISTENING_COMMAND':
        this.state.statusMessage = 'Listening... Say e.g. "Transmit on 236"';
        break;
      case 'DISAMBIGUATING':
        this.state.statusMessage = 'Multiple options — Say your choice or tap below';
        break;
      case 'WAITING_FOR_DONE':
        this.state.statusMessage = 'Roll dice! Say "Done" or tap button when ready';
        break;
      case 'BRANCHING_CHOICE':
        this.state.statusMessage = 'Choose a branch — Say your option or tap below';
        break;
    }
  }

  private setMode(mode: VoiceStateMode): void {
    this.state.mode = mode;
    this.updateStatusMessage();
    this.notify();
  }

  // --- Audio Unlock & Mic Toggle ---

  public async unlockAudio(): Promise<boolean> {
    return this.speech.unlockAudio();
  }

  public async toggleMic(): Promise<void> {
    await this.unlockAudio();

    if (this.speech.isSpeaking()) {
      this.speech.stopSpeaking();
      // If we were waiting for done or branching, resume listening
      if (this.state.mode === 'WAITING_FOR_DONE' || this.state.mode === 'BRANCHING_CHOICE') {
        await this.speech.startListening(true);
      }
      return;
    }

    if (this.speech.isListening()) {
      this.speech.stopListening();
      if (this.state.mode === 'LISTENING_COMMAND') {
        this.setMode('IDLE');
      }
      return;
    }

    // Start listening
    if (this.state.mode === 'WAITING_FOR_DONE' || this.state.mode === 'BRANCHING_CHOICE') {
      await this.speech.startListening(true);
    } else {
      await this.startListeningCommand();
    }
  }

  public async startListeningCommand(): Promise<void> {
    await this.unlockAudio();
    this.setMode('LISTENING_COMMAND');
    this.state.transcript = '';
    this.state.isFinalTranscript = false;
    await this.speech.startListening(this.state.handsFreeMode);
    this.notify();
  }

  public stopListening(): void {
    this.speech.stopListening();
    if (this.state.mode === 'LISTENING_COMMAND') {
      this.setMode('IDLE');
    }
  }

  // --- Voice Transcript & Intent Resolution ---

  public async handleTranscript(transcript: string, isFinal: boolean): Promise<void> {
    this.state.transcript = transcript;
    this.state.isFinalTranscript = isFinal;

    if (!isFinal) {
      this.notify();
      return;
    }

    if (this.promptResetTimer) {
      clearTimeout(this.promptResetTimer);
      this.promptResetTimer = null;
    }

    const clean = transcript.trim();
    if (!clean) {
      return;
    }

    const intent = parseVoiceInput(clean, this.db, {
      mode: this.state.mode,
      activeResult: this.state.activeResult,
      activeChoices: this.state.activeChoices,
    });

    await this.processIntent(intent, 'voice');

    // Auto-reset transcript & restore prompt after promptResetMs (default ~1.8s)
    this.schedulePromptReset();
  }

  private schedulePromptReset(delayMs: number = this.promptResetMs): void {
    if (this.promptResetTimer) {
      clearTimeout(this.promptResetTimer);
      this.promptResetTimer = null;
    }
    if (delayMs <= 0) {
      this.resetTranscriptAndPrompt();
      return;
    }
    this.promptResetTimer = setTimeout(() => {
      this.resetTranscriptAndPrompt();
    }, delayMs);
  }

  private resetTranscriptAndPrompt(): void {
    if (this.promptResetTimer) {
      clearTimeout(this.promptResetTimer);
      this.promptResetTimer = null;
    }
    if (this.interimSilenceTimer) {
      clearTimeout(this.interimSilenceTimer);
      this.interimSilenceTimer = null;
    }
    this.utteranceBuffer = '';
    this.state.transcript = '';
    this.state.isFinalTranscript = false;
    this.updateStatusMessage();
    this.notify();
  }

  public async handleTextInput(text: string): Promise<void> {
    const clean = (text || '').trim();
    if (!clean) return;

    if (this.commandSettleTimer) {
      clearTimeout(this.commandSettleTimer);
      this.commandSettleTimer = null;
    }
    if (this.promptResetTimer) {
      clearTimeout(this.promptResetTimer);
      this.promptResetTimer = null;
    }
    if (this.interimSilenceTimer) {
      clearTimeout(this.interimSilenceTimer);
      this.interimSilenceTimer = null;
    }
    this.utteranceBuffer = '';

    await this.unlockAudio();

    // Check direct key format like "e236", "d43", "s1", "m1016"
    const directKeyMatch = clean.match(/^([mlehtods])\s*(\d+)$/i);
    if (directKeyMatch) {
      const prefix = directKeyMatch[1].toLowerCase();
      const num = parseInt(directKeyMatch[2], 10);
      const res = this.db.getByBookAndNumber(prefix, num);
      if (res) {
        await this.executeLookup(res, null, 'tap');
        return;
      }
    }

    // Check pure number like "236"
    if (/^\d+$/.test(clean)) {
      const num = parseInt(clean, 10);
      const entries = this.db.getEntriesForNumber(num);
      if (entries.length === 1) {
        await this.executeLookup(entries[0], null, 'tap');
        return;
      } else if (entries.length > 1) {
        const candidates: CandidateMatch[] = entries.flatMap((e) =>
          e.variants.map((v) => ({
            result: e,
            variantIndex: v.index,
            label: `${e.bookName.toUpperCase()} ${e.paddedNumber}${v.primaryVerb ? ` (${v.primaryVerb.toUpperCase()})` : ''}`,
          }))
        );
        this.state.activeResult = entries[0];
        this.setMode('DISAMBIGUATING');
        this.state.statusMessage = `Found ${entries.length} actions on location ${num}. Select one:`;
        this.notify();
        return;
      }
    }

    const intent = parseVoiceInput(clean, this.db, {
      mode: this.state.mode,
      activeResult: this.state.activeResult,
      activeChoices: this.state.activeChoices,
    });

    await this.processIntent(intent, 'tap');
  }

  private async processIntent(intent: VoiceIntent, source: InputSource): Promise<void> {
    switch (intent.type) {
      case 'CANCEL':
        if (/^(clear|reset|start over|new lookup)$/i.test(intent.rawTranscript.trim())) {
          this.handleCancel(true);
        } else {
          this.handleCancel(false);
        }
        break;

      case 'REPEAT':
        await this.handleRepeat(intent.target ?? 'auto');
        break;

      case 'CONFIRM_DONE':
        if (this.state.mode === 'WAITING_FOR_DONE') {
          await this.revealResult();
        }
        break;

      case 'SELECT_OPTION':
        if (this.state.mode === 'DISAMBIGUATING') {
          await this.selectDisambiguationOption(intent.optionIndex);
        } else if (this.state.mode === 'BRANCHING_CHOICE') {
          await this.selectBranchChoice(intent.optionIndex);
        }
        break;

      case 'LOOKUP':
        await this.executeLookup(intent.result, intent.variantIndex, source);
        break;

      case 'AMBIGUOUS_LOOKUP':
        if (intent.candidates && intent.candidates.length > 0) {
          this.state.activeResult = intent.candidates[0].result;
          this.setMode('DISAMBIGUATING');
          this.state.statusMessage = `Multiple matches for ${intent.number}. Which action or book?`;
          this.notify();
          const prompt = `Multiple actions available for ${intent.number}. Which one?`;
          this.voiceFlow = source === 'voice';
          await this.speech.speak(prompt);
          await this.listenForAnswer();
        }
        break;

      case 'UNKNOWN':
        if (this.state.mode === 'LISTENING_COMMAND') {
          this.state.statusMessage = intent.reason || 'Could not understand command. Try e.g. "Transmit on 236"';
          this.notify();
        }
        break;
    }
  }

  // --- Step 1 & 2: Lookup and Disambiguation Flow ---

  public async executeLookup(
    result: StoryLookupResult,
    variantIndex: number | null = null,
    source: InputSource = 'tap'
  ): Promise<void> {
    await this.unlockAudio();
    this.speech.stopSpeaking();
    this.speech.stopListening();
    this.voiceFlow = source === 'voice';

    this.state.activeResult = result;
    this.parsedResultCache = null;

    // Check if variant is already uniquely identified or if there is only 1 variant
    if (variantIndex !== null && variantIndex >= 0 && variantIndex < result.variants.length) {
      await this.selectVariant(result, variantIndex);
      return;
    }

    if (result.variants.length === 1) {
      await this.selectVariant(result, 0);
      return;
    }

    // Step 2: Multi-Option Disambiguation needed (e.g. d43, m51)
    this.state.activeVariantIndex = null;
    this.setMode('DISAMBIGUATING');

    const promptText = formatDisambiguationPrompt(result);
    this.notify();

    await this.speech.speak(promptText);

    // Listen for the chosen option after the prompt
    await this.listenForAnswer();
  }

  public async selectDisambiguationOption(index: number): Promise<void> {
    if (!this.state.activeResult) return;
    if (index < 0 || index >= this.state.activeResult.variants.length) return;

    this.speech.stopSpeaking();
    this.speech.stopListening();

    await this.selectVariant(this.state.activeResult, index);
  }

  // --- Step 3: Action & Dice Prompt (Spoiler Protected) ---

  public async selectVariant(
    result: StoryLookupResult,
    variantIndex: number
  ): Promise<void> {
    await this.unlockAudio();
    this.speech.stopSpeaking();
    this.speech.stopListening();

    this.state.activeResult = result;
    this.state.activeVariantIndex = variantIndex;
    this.state.chosenBranchIndex = null;
    this.state.activeChoices = [];

    const variant = result.variants[variantIndex];
    if (!variant) return;

    this.parsedResultCache = parseAndFormatResult(variant.resultHtml);
    this.state.activeChoices = this.parsedResultCache.choices;

    // Add to Recent Lookups history
    this.addRecentLookup(result, variantIndex);

    // Check if result is NOT obscured (e.g. s1 in Book of Secrets)
    if (variant.obscure === false) {
      this.state.isObscured = false;
      this.setMode('IDLE');
      this.notify();
      await this.readRevealedResult();
      return;
    }

    // Normal case: Obscured / Blurred result
    this.state.isObscured = true;
    this.setMode('WAITING_FOR_DONE');

    const promptText = formatActionPromptForSpeech(variant, result.prefix);
    this.notify();

    await this.speech.speak(promptText);

    // Listen for "Done" after the prompt
    await this.listenForAnswer();
  }

  // --- Step 4: Result Reveal & Read Aloud ---

  public async revealResult(): Promise<void> {
    await this.unlockAudio();

    if (!this.state.activeResult || this.state.activeVariantIndex === null) {
      return;
    }

    const variant = this.state.activeResult.variants[this.state.activeVariantIndex];
    if (!variant) return;

    // Stop ongoing listening & speech
    this.speech.stopSpeaking();
    this.speech.stopListening();

    // Unblur result box
    this.state.isObscured = false;
    this.notify();

    await this.readRevealedResult();
  }

  private async readRevealedResult(): Promise<void> {
    if (!this.parsedResultCache) {
      const variant =
        this.state.activeResult?.variants[this.state.activeVariantIndex ?? 0];
      if (variant) {
        this.parsedResultCache = parseAndFormatResult(variant.resultHtml);
        this.state.activeChoices = this.parsedResultCache.choices;
      }
    }

    const parsed = this.parsedResultCache;
    if (!parsed) return;

    // Speak main speech text
    if (parsed.mainSpeechText) {
      this.updateStatusMessage();
      this.notify();
      await this.speech.speak(parsed.mainSpeechText);
    }

    // Step 5: Check Branching Choices
    if (parsed.hasChoices && parsed.choices.length > 0) {
      this.setMode('BRANCHING_CHOICE');
      this.speech.stopListening();
      const branchPrompt = formatBranchChoicesPrompt(parsed.choices);
      this.notify();
      await this.speech.speak(branchPrompt);

      // Listen for the branch choice
      await this.listenForAnswer();
    } else {
      // Completed reading result with no sub-choices
      await this.finishFlow();
    }
  }

  // --- Branching Choices Phase ---

  public async selectBranchChoice(choiceIndex: number): Promise<void> {
    await this.unlockAudio();

    if (!this.state.activeChoices || choiceIndex < 0 || choiceIndex >= this.state.activeChoices.length) {
      return;
    }

    this.speech.stopSpeaking();
    this.speech.stopListening();

    this.state.chosenBranchIndex = choiceIndex;
    const choice = this.state.activeChoices[choiceIndex];

    this.notify();

    if (choice.speechText) {
      await this.speech.speak(choice.speechText);
    }

    await this.finishFlow();
  }

  /** Turns the mic on for a prompt's answer: always in hands-free mode, otherwise only
   *  when this lookup was started by voice. */
  private async listenForAnswer(): Promise<void> {
    if (this.state.handsFreeMode || this.voiceFlow) {
      await this.speech.startListening(true);
    }
  }

  /** End of a lookup: hands-free returns to listening for commands, otherwise the mic
   *  turns off until the player taps it. */
  private async finishFlow(): Promise<void> {
    this.voiceFlow = false;
    if (this.state.handsFreeMode) {
      this.setMode('LISTENING_COMMAND');
      await this.speech.startListening(true);
    } else {
      this.setMode('IDLE');
      this.speech.stopListening();
    }
  }

  // --- Audio Control / Replay / Cancel ---

  public async replayCurrentAudio(target: 'pre' | 'post' | 'auto' = 'auto'): Promise<void> {
    await this.unlockAudio();
    await this.handleRepeat(target);
  }

  public stopAudio(): void {
    this.speech.stopSpeaking();
    this.updateStatusMessage();
    this.notify();
  }

  public handleCancel(resumeListening: boolean = false): void {
    if (this.commandSettleTimer) {
      clearTimeout(this.commandSettleTimer);
      this.commandSettleTimer = null;
    }
    if (this.promptResetTimer) {
      clearTimeout(this.promptResetTimer);
      this.promptResetTimer = null;
    }
    if (this.interimSilenceTimer) {
      clearTimeout(this.interimSilenceTimer);
      this.interimSilenceTimer = null;
    }
    this.utteranceBuffer = '';
    this.state.transcript = '';
    this.state.isFinalTranscript = false;

    this.speech.stopSpeaking();
    this.speech.stopListening();

    this.state.activeResult = null;
    this.state.activeVariantIndex = null;
    this.state.activeChoices = [];
    this.state.chosenBranchIndex = null;
    this.state.isObscured = true;
    this.parsedResultCache = null;

    if (resumeListening || this.state.handsFreeMode) {
      this.setMode('LISTENING_COMMAND');
      this.speech.startListening(this.state.handsFreeMode);
    } else {
      this.setMode('IDLE');
    }
  }

  // Repeat never changes mic state: speak() pauses the mic and restores it only if it was on.
  public async handleRepeat(target: 'pre' | 'post' | 'auto' = 'auto'): Promise<void> {
    if (this.state.mode === 'DISAMBIGUATING' && this.state.activeResult) {
      const prompt = formatDisambiguationPrompt(this.state.activeResult);
      await this.speech.speak(prompt);
      return;
    }

    if (!this.state.activeResult || this.state.activeVariantIndex === null) {
      return;
    }

    const variant = this.state.activeResult.variants[this.state.activeVariantIndex];
    if (!variant) return;

    // Resolve 'auto' target: if obscured or waiting for done -> 'pre'; otherwise -> 'post'
    const resolvedTarget: 'pre' | 'post' =
      target === 'auto'
        ? this.state.isObscured || this.state.mode === 'WAITING_FOR_DONE'
          ? 'pre'
          : 'post'
        : target;

    if (resolvedTarget === 'pre') {
      const prompt = formatActionPromptForSpeech(variant, this.state.activeResult.prefix);
      await this.speech.speak(prompt);
      return;
    }

    // resolvedTarget === 'post' (revealed result)
    if (!this.parsedResultCache) {
      this.parsedResultCache = parseAndFormatResult(variant.resultHtml);
      this.state.activeChoices = this.parsedResultCache.choices;
    }

    if (this.state.chosenBranchIndex !== null && this.state.activeChoices[this.state.chosenBranchIndex]) {
      const choice = this.state.activeChoices[this.state.chosenBranchIndex];
      await this.speech.speak(choice.speechText);
    } else if (this.state.mode === 'BRANCHING_CHOICE' && this.state.activeChoices.length > 0) {
      let fullText = this.parsedResultCache?.mainSpeechText || '';
      const branchPrompt = formatBranchChoicesPrompt(this.state.activeChoices);
      fullText = fullText ? `${fullText} ${branchPrompt}` : branchPrompt;
      await this.speech.speak(fullText);
    } else if (this.parsedResultCache?.mainSpeechText) {
      await this.speech.speak(this.parsedResultCache.mainSpeechText);
    }
  }

  /** Opens game setup (Card 000); Card 001 (escape pods) is linked from there. */
  public async openGameSetup(): Promise<void> {
    const entry = this.db.getByKey('s0') || this.db.getByBookAndNumber('s', 0);
    if (entry) {
      await this.executeLookup(entry, 0);
    }
  }

  public backToLookup(): void {
    this.handleCancel();
  }

  // --- Settings & Persistence ---

  public setHandsFreeMode(enabled: boolean): void {
    this.state.handsFreeMode = enabled;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(HANDS_FREE_STORAGE_KEY, String(enabled));
    }
    this.notify();
  }

  public toggleMuted(): boolean {
    const isMuted = this.speech.toggleMuted();
    this.state.isMuted = isMuted;
    this.notify();
    return isMuted;
  }

  public async setEngine(engine: SttEngineMode): Promise<void> {
    await this.speech.setEngine(engine);
    this.state.sttEngine = engine;
    this.notify();
  }

  public getSpeechService(): SpeechService {
    return this.speech;
  }

  public getDatabase(): StoryDatabase {
    return this.db;
  }

  // --- Recent Lookups Management ---

  private loadRecentLookups(): RecentLookupItem[] {
    if (typeof localStorage === 'undefined') return [];
    try {
      const raw = localStorage.getItem(RECENT_LOOKUPS_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private saveRecentLookups(items: RecentLookupItem[]): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(RECENT_LOOKUPS_STORAGE_KEY, JSON.stringify(items));
    } catch {
      // ignore
    }
  }

  private addRecentLookup(result: StoryLookupResult, variantIndex: number): void {
    const variant = result.variants[variantIndex];
    let label = `${result.bookName.toUpperCase()} ${result.paddedNumber}`;
    if (variant?.primaryVerb) {
      label += ` (${variant.primaryVerb.toUpperCase()})`;
    } else if (variant?.option) {
      label += ` (${variant.option.toUpperCase()})`;
    }

    const newItem: RecentLookupItem = {
      key: result.key,
      bookName: result.bookName,
      number: result.number,
      label,
      variantIndex,
      timestamp: Date.now(),
    };

    const filtered = this.state.recentLookups.filter(
      (item) => !(item.key === result.key && item.variantIndex === variantIndex)
    );

    filtered.unshift(newItem);
    if (filtered.length > MAX_RECENT_LOOKUPS) {
      filtered.length = MAX_RECENT_LOOKUPS;
    }

    this.state.recentLookups = filtered;
    this.saveRecentLookups(filtered);
    this.notify();
  }
}
