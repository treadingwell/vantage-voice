import { SpeechService, SttEngineMode, TtsEngineMode } from '../speech/speechService';
import {
  deleteModel,
  downloadModel,
  getModel,
  isModelDownloaded,
  SHERPA_RUNTIME,
} from '../speech/models/modelStore';
import { VoiceController } from './voiceController';

/** Downloadable models shown in settings: the Vosk pack plus the sherpa catalog entries. */
type ModelKey = 'vosk' | 'kroko-en' | 'kitten-nano' | 'supertonic-2' | 'supertonic-3';

type ModelStatus = 'checking' | 'missing' | 'ready';

interface DownloadProgress {
  percent: number;
  status: string;
}

interface EngineOption<T extends string> {
  value: T;
  title: string;
  desc: string;
  model?: ModelKey;
}

const VOSK_MB = 40;

const STT_OPTIONS: EngineOption<SttEngineMode>[] = [
  {
    value: 'web-speech',
    title: 'Browser speech recognition',
    desc: 'No download. Uses your browser or phone (may need internet).',
  },
  {
    value: 'offline-wasm',
    title: 'Vosk (offline)',
    desc: 'Listens for Vantage words only. Results after you stop talking.',
    model: 'vosk',
  },
  {
    value: 'sherpa',
    title: 'Kroko streaming (offline)',
    desc: 'Live word-by-word recognition. Most accurate offline option.',
    model: 'kroko-en',
  },
];

const TTS_OPTIONS: EngineOption<TtsEngineMode>[] = [
  {
    value: 'native',
    title: 'Phone voice',
    desc: 'No download. Quality depends on your device.',
  },
  {
    value: 'supertonic-2',
    title: 'Supertonic 2',
    desc: 'Fastest natural offline narrator. 10 voices.',
    model: 'supertonic-2',
  },
  {
    value: 'supertonic-3',
    title: 'Supertonic 3',
    desc: 'Clearest reading, about 3x slower than Supertonic 2. 10 voices.',
    model: 'supertonic-3',
  },
  {
    value: 'kitten-nano',
    title: 'Kitten Nano',
    desc: 'Smallest offline narrator. 8 voices.',
    model: 'kitten-nano',
  },
];

export class SettingsModal {
  private container: HTMLElement;
  private controller: VoiceController;
  private speech: SpeechService;
  private isOpen = false;
  private unsubController: (() => void) | null = null;

  private modelStatus: Record<ModelKey, ModelStatus> = {
    vosk: 'checking',
    'kroko-en': 'checking',
    'kitten-nano': 'checking',
    'supertonic-2': 'checking',
    'supertonic-3': 'checking',
  };
  private downloads: Partial<Record<ModelKey, DownloadProgress>> = {};
  private errorMessage = '';
  private busyMessage = '';
  private storageUsedMB: number | null = null;

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
    this.errorMessage = '';
    this.render();
    void this.refreshModelStatus();
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

  private modelSizeMB(key: ModelKey): number {
    if (key === 'vosk') return VOSK_MB;
    return getModel(key)?.approxMB ?? 0;
  }

  private modelLabel(key: ModelKey): string {
    if (key === 'vosk') return 'Vosk speech model';
    return getModel(key)?.label ?? key;
  }

  private async refreshModelStatus(): Promise<void> {
    const keys: ModelKey[] = ['vosk', 'kroko-en', 'kitten-nano', 'supertonic-2', 'supertonic-3'];
    for (const key of keys) {
      if (key === 'vosk') {
        this.modelStatus.vosk = (await this.speech.isOfflineModelCached()) ? 'ready' : 'missing';
      } else {
        const entry = getModel(key);
        this.modelStatus[key] = entry && (await isModelDownloaded(entry)) ? 'ready' : 'missing';
      }
    }

    try {
      const estimate = await navigator.storage?.estimate?.();
      this.storageUsedMB = estimate?.usage ? Math.round(estimate.usage / (1024 * 1024)) : null;
    } catch {
      this.storageUsedMB = null;
    }

    if (this.isOpen) this.render();
  }

  public render(): void {
    if (!this.isOpen) {
      this.container.innerHTML = '';
      return;
    }

    const state = this.controller.getState();
    const currentRate = this.speech.getSpeechRate();
    const ttsEngine = this.speech.getTtsEngine();
    const pauseMs = this.speech.getSentencePauseMs();

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
          ${this.errorMessage ? `<div class="settings-error" role="alert">${this.errorMessage}</div>` : ''}
          ${this.busyMessage ? `<div class="settings-busy" role="status">${this.busyMessage}</div>` : ''}

          <!-- Narrator (TTS) -->
          <section class="settings-section">
            <h3 class="section-heading">Story Narrator</h3>
            <div class="engine-radios">
              ${TTS_OPTIONS.map((o) => this.renderEngineOption('tts-engine', o, ttsEngine)).join('')}
            </div>
          </section>

          <section class="settings-section">
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

            ${ttsEngine === 'native' ? this.renderNativeVoiceControls() : this.renderNeuralVoiceControls(ttsEngine, pauseMs)}

            <button type="button" class="btn-test-voice" id="btn-test-voice">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
              </svg>
              <span>Test Voice & Speed</span>
            </button>
          </section>

          <!-- Speech Recognition (STT) -->
          <section class="settings-section">
            <h3 class="section-heading">Speech Recognition</h3>
            <div class="engine-radios">
              ${STT_OPTIONS.map((o) => this.renderEngineOption('stt-engine', o, state.sttEngine)).join('')}
            </div>
          </section>

          <section class="settings-section">
            <div class="toggle-row">
              <div class="toggle-info">
                <label for="toggle-hands-free" class="toggle-title">Hands-Free Continuous Listening</label>
                <div class="toggle-desc">On: the mic stays on and listens for your next command after each story entry. Off: the mic only answers prompts for lookups you spoke, then turns off.</div>
              </div>
              <input
                type="checkbox"
                id="toggle-hands-free"
                class="toggle-checkbox"
                ${state.handsFreeMode ? 'checked' : ''}
              />
            </div>
          </section>

          <p class="storage-note">
            Offline models work in Airplane Mode once downloaded. Sherpa models share a
            ${SHERPA_RUNTIME.approxMB} MB speech engine.
            ${this.storageUsedMB !== null ? `This app is using about ${this.storageUsedMB} MB on this device.` : ''}
          </p>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private renderEngineOption<T extends string>(name: string, option: EngineOption<T>, selected: T): string {
    const status = option.model ? this.modelStatus[option.model] : 'ready';
    const isSelected = option.value === selected;
    const isUsable = status === 'ready';
    const size = option.model ? ` · ~${this.modelSizeMB(option.model)} MB` : '';

    return `
      <div class="engine-option-card ${option.model ? 'has-model' : ''} ${isSelected ? 'is-selected' : ''} ${isUsable ? '' : 'is-unavailable'}">
        <label class="engine-option-main">
          <input
            type="radio"
            name="${name}"
            value="${option.value}"
            ${isSelected ? 'checked' : ''}
            ${isUsable ? '' : 'disabled'}
          />
          <div class="engine-info">
            <div class="engine-title">${option.title}<span class="engine-size">${size}</span></div>
            <div class="engine-desc">${option.desc}</div>
            ${option.model && option.model !== 'vosk' && getModel(option.model)?.credit ? `<div class="engine-credit">${getModel(option.model)?.credit}</div>` : ''}
          </div>
        </label>
        ${option.model ? this.renderModelRow(option.model) : ''}
      </div>
    `;
  }

  private renderModelRow(key: ModelKey): string {
    const progress = this.downloads[key];
    if (progress) {
      return `
        <div class="model-row">
          <div class="model-progress">
            <div class="download-progress-bar-wrapper">
              <div class="download-progress-bar" data-progress-key="${key}" style="width: ${progress.percent}%;"></div>
            </div>
            <div class="download-status-detail" data-status-key="${key}">${progress.status}</div>
          </div>
        </div>
      `;
    }

    const status = this.modelStatus[key];
    if (status === 'checking') {
      return `<div class="model-row"><span class="model-status">Checking…</span></div>`;
    }
    if (status === 'ready') {
      return `
        <div class="model-row">
          <span class="model-status is-ready">✓ Downloaded</span>
          <button type="button" class="btn-model-delete" data-delete-model="${key}">Delete</button>
        </div>
      `;
    }
    return `
      <div class="model-row">
        <span class="model-status">Not downloaded</span>
        <button type="button" class="btn-primary-pack btn-model-download" data-download-model="${key}">
          Download ${this.modelSizeMB(key)} MB
        </button>
      </div>
    `;
  }

  private renderNativeVoiceControls(): string {
    const voices = this.speech.getFilteredVoices();
    const selectedVoice = this.speech.getSelectedVoice();
    const voiceLanguage = this.speech.getVoiceLanguage();
    const languageOptions = ['en', ...this.speech.getEnglishVoiceLocales(), 'all'];
    if (!languageOptions.includes(voiceLanguage)) {
      languageOptions.splice(1, 0, voiceLanguage);
    }

    return `
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
    `;
  }

  private renderNeuralVoiceControls(engine: TtsEngineMode, pauseMs: number): string {
    const voices = getModel(engine)?.voices ?? [];
    const sid = this.speech.getNeuralVoice(engine);

    return `
      <div class="form-group">
        <label for="neural-voice-select">Narrator Voice</label>
        <select id="neural-voice-select" class="voice-select">
          ${voices
            .map((v) => `<option value="${v.sid}" ${v.sid === sid ? 'selected' : ''}>${v.label}</option>`)
            .join('')}
        </select>
      </div>

      <div class="form-group">
        <div class="slider-header">
          <label for="pause-slider">Pause Between Sentences</label>
          <span class="slider-value" id="pause-value">${(pauseMs / 1000).toFixed(2)}s</span>
        </div>
        <input
          type="range"
          id="pause-slider"
          class="rate-slider"
          min="0"
          max="1000"
          step="50"
          value="${pauseMs}"
        />
      </div>
    `;
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
    this.container.querySelectorAll<HTMLInputElement>('input[name="stt-engine"]').forEach((radio) => {
      radio.addEventListener('change', async () => {
        if (!radio.checked) return;
        await this.runBusy('Switching recognition…', () => this.controller.setEngine(radio.value as SttEngineMode));
      });
    });

    // Narrator radios
    this.container.querySelectorAll<HTMLInputElement>('input[name="tts-engine"]').forEach((radio) => {
      radio.addEventListener('change', async () => {
        if (!radio.checked) return;
        await this.runBusy('Loading narrator…', () => this.speech.setTtsEngine(radio.value as TtsEngineMode));
      });
    });

    // Model downloads / deletes
    this.container.querySelectorAll<HTMLButtonElement>('[data-download-model]').forEach((btn) => {
      btn.addEventListener('click', () => this.startDownload(btn.dataset.downloadModel as ModelKey));
    });
    this.container.querySelectorAll<HTMLButtonElement>('[data-delete-model]').forEach((btn) => {
      btn.addEventListener('click', () => this.deleteDownloadedModel(btn.dataset.deleteModel as ModelKey));
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

    // Sentence pause slider (neural narrators)
    const pauseSlider = this.container.querySelector('#pause-slider') as HTMLInputElement;
    const pauseValueEl = this.container.querySelector('#pause-value');
    pauseSlider?.addEventListener('input', () => {
      const ms = parseInt(pauseSlider.value, 10);
      this.speech.setSentencePauseMs(ms);
      if (pauseValueEl) {
        pauseValueEl.textContent = `${(ms / 1000).toFixed(2)}s`;
      }
    });

    // Neural voice picker
    const neuralSelect = this.container.querySelector('#neural-voice-select') as HTMLSelectElement;
    neuralSelect?.addEventListener('change', () => {
      this.speech.setNeuralVoice(this.speech.getTtsEngine(), parseInt(neuralSelect.value, 10));
    });

    // Language Filter
    const langSelect = this.container.querySelector('#voice-lang-select') as HTMLSelectElement;
    langSelect?.addEventListener('change', () => {
      this.speech.setVoiceLanguage(langSelect.value);
      this.render();
    });

    // Device voice selector
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
      await this.speech.speak(
        'Vantage voice system online. Roll six dice to transmit a signal to your homeworld. Say done when ready.'
      );
    });
  }

  private async runBusy(message: string, action: () => Promise<void>): Promise<void> {
    this.errorMessage = '';
    this.busyMessage = message;
    this.render();
    try {
      await action();
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : String(err);
    } finally {
      this.busyMessage = '';
      this.render();
    }
  }

  private async startDownload(key: ModelKey): Promise<void> {
    this.errorMessage = '';
    this.downloads[key] = { percent: 0, status: 'Starting download…' };
    this.render();

    const report = (percent: number, status: string) => {
      this.downloads[key] = { percent, status };
      // Update the DOM directly so the bar animates smoothly without re-rendering
      const bar = this.container.querySelector<HTMLElement>(`[data-progress-key="${key}"]`);
      const statusEl = this.container.querySelector(`[data-status-key="${key}"]`);
      if (bar) bar.style.width = `${percent}%`;
      if (statusEl) statusEl.textContent = status;
    };

    try {
      if (key === 'vosk') {
        const ok = await this.speech.downloadAndInitOfflineModel((status, percent) => {
          report(percent ?? this.downloads[key]?.percent ?? 0, status);
        });
        if (!ok) throw new Error('The Vosk model failed to download.');
      } else {
        const entry = getModel(key);
        if (!entry) throw new Error(`Unknown model ${key}`);
        await downloadModel(entry, (loaded, total) => {
          const percent = Math.min(99, Math.round((loaded / total) * 100));
          report(percent, `Downloading… ${Math.round(loaded / (1024 * 1024))} of ~${Math.round(total / (1024 * 1024))} MB`);
        });
      }
      this.modelStatus[key] = 'ready';
    } catch (err) {
      this.errorMessage = `${this.modelLabel(key)}: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      delete this.downloads[key];
      await this.refreshModelStatus();
    }
  }

  private async deleteDownloadedModel(key: ModelKey): Promise<void> {
    const confirmed = window.confirm(
      `Delete ${this.modelLabel(key)} (~${this.modelSizeMB(key)} MB) from this device? You can download it again later.`
    );
    if (!confirmed) return;

    await this.runBusy(`Deleting ${this.modelLabel(key)}…`, async () => {
      if (key === 'vosk') {
        await this.speech.deleteOfflineModel();
      } else {
        const entry = getModel(key);
        if (!entry) return;
        await this.speech.releaseSherpaModel(key);
        await deleteModel(entry);
      }
      this.modelStatus[key] = 'missing';
    });
    await this.refreshModelStatus();
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
}
