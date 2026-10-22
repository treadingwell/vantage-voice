import { SpeechService, SttEngineMode } from '../speech/speechService';
import { VoiceController } from './voiceController';

export class SettingsModal {
  private container: HTMLElement;
  private controller: VoiceController;
  private speech: SpeechService;
  private isOpen = false;
  private isDownloadingModel = false;
  private downloadStatus = '';
  private downloadPercent = 0;
  private unsubController: (() => void) | null = null;

  constructor(container: HTMLElement, controller: VoiceController) {
    this.container = container;
    this.controller = controller;
    this.speech = controller.getSpeechService();

    this.unsubController = this.controller.onStateChange(() => {
      if (this.isOpen) {
        this.updateFormFields();
      }
    });

    this.render();
  }

  public dispose(): void {
    if (this.unsubController) {
      this.unsubController();
      this.unsubController = null;
    }
  }

  public open(): void {
    this.isOpen = true;
    this.container.classList.add('is-open');
    this.render();
  }

  public close(): void {
    this.isOpen = false;
    this.container.classList.remove('is-open');
  }

  public toggle(): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  public render(): void {
    if (!this.isOpen) {
      this.container.innerHTML = '';
      return;
    }

    const state = this.controller.getState();
    const isOfflineReady = this.speech.isOfflineModelReady();
    const voices = this.speech.getFilteredVoices();
    const selectedVoice = this.speech.getSelectedVoice();
    const voiceLanguage = this.speech.getVoiceLanguage();
    const languageOptions = ['en', ...this.speech.getEnglishVoiceLocales(), 'all'];
    if (!languageOptions.includes(voiceLanguage)) {
      languageOptions.splice(1, 0, voiceLanguage);
    }
    const currentRate = this.speech.getSpeechRate();

    this.container.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop"></div>
      <div class="modal-drawer" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header class="modal-header">
          <div class="modal-title-wrapper">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
            <h2 id="settings-title">Audio & Voice Settings</h2>
          </div>
          <button type="button" class="btn-close-modal" id="btn-close-modal" aria-label="Close Settings">
            ✕
          </button>
        </header>

        <div class="modal-body">
          <!-- STT Engine Selector -->
          <section class="settings-section">
            <h3 class="section-heading">Speech Recognition Engine (STT)</h3>
            <div class="engine-radios">
              <label class="engine-option-card ${state.sttEngine === 'web-speech' ? 'is-selected' : ''}">
                <input
                  type="radio"
                  name="stt-engine"
                  value="web-speech"
                  ${state.sttEngine === 'web-speech' ? 'checked' : ''}
                />
                <div class="engine-info">
                  <div class="engine-title">Browser Web Speech API</div>
                  <div class="engine-desc">Instant online/native speech recognition. Zero download required.</div>
                </div>
              </label>

              <label class="engine-option-card ${state.sttEngine === 'offline-wasm' ? 'is-selected' : ''}">
                <input
                  type="radio"
                  name="stt-engine"
                  value="offline-wasm"
                  ${state.sttEngine === 'offline-wasm' ? 'checked' : ''}
                />
                <div class="engine-info">
                  <div class="engine-title">Offline Airplane Mode (Vosk WASM)</div>
                  <div class="engine-desc">100% offline local model. Vantage vocabulary constrained. Silent continuous listening.</div>
                </div>
              </label>
            </div>
          </section>

          <!-- Offline Voice Pack Download Section -->
          <section class="settings-section">
            <h3 class="section-heading">Offline Voice Model Pack (~40 MB)</h3>
            <div class="voice-pack-card">
              <div class="pack-status-row">
                <span class="pack-status-icon">${isOfflineReady ? '✓' : '📦'}</span>
                <span class="pack-status-text">
                  ${isOfflineReady ? 'Offline Model Ready (vosk-model-small-en-us-0.15 cached)' : 'Model Not Downloaded (~40 MB)'}
                </span>
              </div>

              ${
                this.isDownloadingModel
                  ? `
                <div class="download-progress-bar-wrapper">
                  <div class="download-progress-bar" style="width: ${this.downloadPercent}%;"></div>
                </div>
                <div class="download-status-detail">${this.downloadStatus || 'Downloading...'}</div>
              `
                  : `
                <button
                  type="button"
                  class="btn-download-pack ${isOfflineReady ? 'btn-re-download' : 'btn-primary-pack'}"
                  id="btn-download-pack"
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                  </svg>
                  <span>${isOfflineReady ? 'Re-Download / Update Voice Pack' : 'Download Offline Voice Pack (~40 MB)'}</span>
                </button>
              `
              }
            </div>
          </section>

          <!-- Hands-Free Continuous Mode Toggle -->
          <section class="settings-section">
            <div class="toggle-row">
              <div class="toggle-info">
                <label for="toggle-hands-free" class="toggle-title">Hands-Free Continuous Listening</label>
                <div class="toggle-desc">Automatically returns to listening for commands after reading story entries.</div>
              </div>
              <input
                type="checkbox"
                id="toggle-hands-free"
                class="toggle-checkbox"
                ${state.handsFreeMode ? 'checked' : ''}
              />
            </div>
          </section>

          <!-- Text-to-Speech (TTS) Settings -->
          <section class="settings-section">
            <h3 class="section-heading">Story Narrator (TTS)</h3>

            <!-- Speed Slider -->
            <div class="form-group">
              <div class="slider-header">
                <label for="rate-slider">Narration Speed</label>
                <span class="slider-value" id="rate-value">${currentRate.toFixed(1)}x</span>
              </div>
              <input
                type="range"
                id="rate-slider"
                class="rate-slider"
                min="0.8"
                max="1.4"
                step="0.1"
                value="${currentRate}"
              />
            </div>

            <!-- Language Filter -->
            <div class="form-group">
              <label for="voice-lang-select">Voice Language</label>
              <select id="voice-lang-select" class="voice-select">
                ${languageOptions
                  .map(
                    (lang) =>
                      `<option value="${lang}" ${lang === voiceLanguage ? 'selected' : ''}>${this.formatLanguageLabel(lang)}</option>`
                  )
                  .join('')}
              </select>
            </div>

            <!-- Voice Selector -->
            <div class="form-group">
              <label for="voice-select">Narrator Voice</label>
              <select id="voice-select" class="voice-select">
                ${
                  voices.length > 0
                    ? voices
                        .map((v) => {
                          const isSelected = selectedVoice && selectedVoice.name === v.name;
                          return `<option value="${v.name}" ${isSelected ? 'selected' : ''}>${v.name} (${v.lang})${v.default ? ' [Default]' : ''}</option>`;
                        })
                        .join('')
                    : `<option value="">Default System Voice</option>`
                }
              </select>
            </div>

            <!-- Test Voice Button -->
            <button type="button" class="btn-test-voice" id="btn-test-voice">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
              </svg>
              <span>Test Voice & Speed</span>
            </button>
          </section>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private updateFormFields(): void {
    const state = this.controller.getState();
    const rateValEl = this.container.querySelector('#rate-value');
    if (rateValEl) {
      rateValEl.textContent = `${this.speech.getSpeechRate().toFixed(1)}x`;
    }

    const handsFreeCheckbox = this.container.querySelector('#toggle-hands-free') as HTMLInputElement;
    if (handsFreeCheckbox) {
      handsFreeCheckbox.checked = state.handsFreeMode;
    }
  }

  private bindEvents(): void {
    // Backdrop & Close button
    const backdrop = this.container.querySelector('#modal-backdrop');
    backdrop?.addEventListener('click', () => this.close());

    const closeBtn = this.container.querySelector('#btn-close-modal');
    closeBtn?.addEventListener('click', () => this.close());

    // STT Engine radios
    const engineRadios = this.container.querySelectorAll<HTMLInputElement>('input[name="stt-engine"]');
    engineRadios.forEach((radio) => {
      radio.addEventListener('change', async () => {
        if (radio.checked) {
          const mode = radio.value as SttEngineMode;
          await this.controller.setEngine(mode);
          this.render();
        }
      });
    });

    // Download Voice Pack
    const downloadBtn = this.container.querySelector('#btn-download-pack');
    downloadBtn?.addEventListener('click', async () => {
      await this.startDownloadOfflineModel();
    });

    // Hands-Free Toggle
    const handsFreeCheckbox = this.container.querySelector('#toggle-hands-free') as HTMLInputElement;
    handsFreeCheckbox?.addEventListener('change', () => {
      this.controller.setHandsFreeMode(handsFreeCheckbox.checked);
    });

    // Narration Speed Slider
    const rateSlider = this.container.querySelector('#rate-slider') as HTMLInputElement;
    const rateValueEl = this.container.querySelector('#rate-value');
    rateSlider?.addEventListener('input', () => {
      const val = parseFloat(rateSlider.value);
      this.speech.setSpeechRate(val);
      if (rateValueEl) {
        rateValueEl.textContent = `${val.toFixed(1)}x`;
      }
    });

    // Language Filter
    const langSelect = this.container.querySelector('#voice-lang-select') as HTMLSelectElement;
    langSelect?.addEventListener('change', () => {
      this.speech.setVoiceLanguage(langSelect.value);
      this.render();
    });

    // Voice Selector
    const voiceSelect = this.container.querySelector('#voice-select') as HTMLSelectElement;
    voiceSelect?.addEventListener('change', () => {
      const voiceName = voiceSelect.value;
      const allVoices = this.speech.getVoices();
      const match = allVoices.find((v) => v.name === voiceName);
      if (match) {
        this.speech.setSelectedVoice(match);
      }
    });

    // Test Voice
    const testVoiceBtn = this.container.querySelector('#btn-test-voice');
    testVoiceBtn?.addEventListener('click', async () => {
      await this.speech.unlockAudio();
      await this.speech.speak('Vantage voice system online. All storybooks indexed.');
    });
  }

  private formatLanguageLabel(lang: string): string {
    if (lang === 'all') return 'All languages';
    if (lang === 'en') return 'English (all accents)';
    try {
      const [base, region] = lang.split('-');
      const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(base) ?? base;
      const regionName = region
        ? new Intl.DisplayNames(['en'], { type: 'region' }).of(region.toUpperCase())
        : undefined;
      return regionName ? `${name} (${regionName})` : name;
    } catch {
      return lang;
    }
  }

  private async startDownloadOfflineModel(): Promise<void> {
    this.isDownloadingModel = true;
    this.downloadPercent = 5;
    this.downloadStatus = 'Starting download...';
    this.render();

    try {
      await this.speech.downloadAndInitOfflineModel((status, percent) => {
        this.downloadStatus = status;
        if (percent !== undefined) {
          this.downloadPercent = percent;
        }
        // Update DOM directly for smooth progress bar updates
        const bar = this.container.querySelector('.download-progress-bar') as HTMLElement;
        const statusEl = this.container.querySelector('.download-status-detail');
        if (bar && percent !== undefined) {
          bar.style.width = `${percent}%`;
        }
        if (statusEl) {
          statusEl.textContent = status;
        }
      });

      this.isDownloadingModel = false;
      this.downloadStatus = '';
      this.render();
    } catch (err) {
      this.isDownloadingModel = false;
      this.downloadStatus = `Error: ${String(err)}`;
      this.render();
    }
  }
}
