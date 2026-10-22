import { VoiceController } from './voiceController';
import type { SttEngineMode, TtsEngineMode } from '../speech/speechService';
import { getModel, isModelDownloaded } from '../speech/models/modelStore';

const STT_BADGES: Record<SttEngineMode, string> = {
  'web-speech': 'WEB SPEECH',
  'offline-wasm': 'VOSK OFFLINE',
  sherpa: 'KROKO OFFLINE',
};

const NARRATOR_LABELS: Record<TtsEngineMode, string> = {
  native: 'Phone voice',
  'supertonic-2': 'Supertonic',
  'kitten-nano': 'Kitten',
};

const NARRATOR_ORDER: TtsEngineMode[] = ['native', 'supertonic-2', 'kitten-nano'];

export class VoiceDock {
  private container: HTMLElement;
  private controller: VoiceController;
  private onOpenSettings: () => void;
  private unsubController: (() => void) | null = null;
  private lastRenderedKey = '';

  constructor(container: HTMLElement, controller: VoiceController, onOpenSettings: () => void) {
    this.container = container;
    this.controller = controller;
    this.onOpenSettings = onOpenSettings;

    this.unsubController = this.controller.onStateChange(() => {
      this.update();
    });

    this.render();
  }

  public dispose(): void {
    if (this.unsubController) {
      this.unsubController();
      this.unsubController = null;
    }
  }

  public render(): void {
    this.container.innerHTML = `
      <footer class="voice-dock" role="region" aria-label="Voice Controls">
        <!-- Live Status & Transcript Banner -->
        <div class="dock-status-area">
          <div class="dock-mode-row">
            <span class="dock-mode-badge" id="dock-mode-badge">IDLE</span>
            <span class="dock-engine-badge" id="dock-engine-badge">WEB SPEECH</span>
            <button
              type="button"
              class="dock-narrator-btn"
              id="btn-dock-narrator"
              title="Switch narrator voice (downloaded narrators only)"
            >Phone voice</button>
          </div>
          <div class="dock-status-message" id="dock-status-message">
            Tap Mic & say e.g. "Transmit on 236"
          </div>
          <div class="dock-transcript-preview" id="dock-transcript-preview"></div>
        </div>

        <!-- Center Animated Microphone Button -->
        <div class="dock-center-action">
          <button
            type="button"
            class="btn-voice-mic"
            id="btn-voice-mic"
            aria-label="Toggle Microphone"
            title="Tap to speak command or answer prompt"
          >
            <div class="mic-pulse-ring" id="mic-pulse-ring"></div>
            <div class="mic-icon-wrapper" id="mic-icon-wrapper">
              <!-- Default Mic Icon -->
              <svg class="mic-svg" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                <line x1="12" y1="19" x2="12" y2="23"></line>
                <line x1="8" y1="23" x2="16" y2="23"></line>
              </svg>
            </div>
            <!-- Equalizer soundwaves for speaking state -->
            <div class="soundwave-equalizer" id="soundwave-equalizer">
              <span class="soundwave-bar"></span>
              <span class="soundwave-bar"></span>
              <span class="soundwave-bar"></span>
              <span class="soundwave-bar"></span>
            </div>
          </button>
        </div>

        <!-- Right Quick Controls (Mute & Settings) -->
        <div class="dock-controls-area">
          <button
            type="button"
            class="btn-dock-icon btn-mute-toggle"
            id="btn-dock-mute"
            aria-label="Toggle Audio Mute"
            title="Toggle Mute"
          >
            <svg class="icon-unmuted" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
            </svg>
            <svg class="icon-muted" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
              <line x1="23" y1="9" x2="17" y2="15"></line>
              <line x1="17" y1="9" x2="23" y2="15"></line>
            </svg>
          </button>

          <button
            type="button"
            class="btn-dock-icon btn-settings-open"
            id="btn-dock-settings"
            aria-label="Open Settings"
            title="Settings & Offline Mode"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
          </button>
        </div>
      </footer>
    `;

    this.bindEvents();
    this.update();
  }

  private bindEvents(): void {
    const micBtn = this.container.querySelector('#btn-voice-mic');
    micBtn?.addEventListener('click', () => {
      this.controller.toggleMic();
    });

    const muteBtn = this.container.querySelector('#btn-dock-mute');
    muteBtn?.addEventListener('click', () => {
      this.controller.toggleMuted();
    });

    const settingsBtn = this.container.querySelector('#btn-dock-settings');
    settingsBtn?.addEventListener('click', () => {
      this.onOpenSettings();
    });

    const narratorBtn = this.container.querySelector<HTMLButtonElement>('#btn-dock-narrator');
    narratorBtn?.addEventListener('click', () => this.cycleNarrator(narratorBtn));
  }

  /** Switches to the next downloaded narrator; with none downloaded, opens settings. */
  private async cycleNarrator(btn: HTMLButtonElement): Promise<void> {
    const speech = this.controller.getSpeechService();
    const ready: TtsEngineMode[] = [];
    for (const mode of NARRATOR_ORDER) {
      const model = mode === 'native' ? null : getModel(mode);
      if (!model || (await isModelDownloaded(model))) ready.push(mode);
    }
    if (ready.length < 2) {
      this.onOpenSettings();
      return;
    }

    const current = this.controller.getState().ttsEngine;
    const next = ready[(ready.indexOf(current) + 1) % ready.length];
    btn.disabled = true;
    btn.textContent = 'Loading…';
    try {
      await speech.setTtsEngine(next);
    } catch (err) {
      console.warn('VoiceDock: narrator switch failed:', err);
    } finally {
      btn.disabled = false;
      this.update();
    }
  }

  public update(): void {
    const state = this.controller.getState();
    const modeBadge = this.container.querySelector('#dock-mode-badge');
    const engineBadge = this.container.querySelector('#dock-engine-badge');
    const statusMsg = this.container.querySelector('#dock-status-message');
    const transcriptEl = this.container.querySelector('#dock-transcript-preview');
    const micBtn = this.container.querySelector('#btn-voice-mic') as HTMLElement;
    const muteBtn = this.container.querySelector('#btn-dock-mute');

    if (!modeBadge || !statusMsg || !transcriptEl || !micBtn) return;

    // Update Mode badge
    modeBadge.textContent = state.mode.replace(/_/g, ' ');
    modeBadge.className = `dock-mode-badge mode-${state.mode.toLowerCase()}`;

    // Update Engine badge
    if (engineBadge) {
      engineBadge.textContent = STT_BADGES[state.sttEngine];
    }

    const narratorBtn = this.container.querySelector<HTMLButtonElement>('#btn-dock-narrator');
    if (narratorBtn && !narratorBtn.disabled) {
      narratorBtn.textContent = NARRATOR_LABELS[state.ttsEngine];
    }

    // Update Status Message
    statusMsg.textContent = state.statusMessage;

    // Update Transcript Preview
    if (state.transcript) {
      transcriptEl.textContent = `"${state.transcript}"`;
      transcriptEl.classList.add('is-active');
      if (state.isFinalTranscript) {
        transcriptEl.classList.add('is-final');
      } else {
        transcriptEl.classList.remove('is-final');
      }
    } else {
      transcriptEl.textContent = '';
      transcriptEl.classList.remove('is-active', 'is-final');
    }

    // Update Mic Button Active States
    micBtn.classList.remove('is-listening', 'is-speaking');
    if (state.isSpeaking) {
      micBtn.classList.add('is-speaking');
    } else if (state.isListening) {
      micBtn.classList.add('is-listening');
    }

    // Update Mute Button State
    if (muteBtn) {
      if (state.isMuted) {
        muteBtn.classList.add('is-muted');
      } else {
        muteBtn.classList.remove('is-muted');
      }
    }
  }
}
