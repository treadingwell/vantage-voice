import './styles/main.css';
import { StoryDatabase } from './data/storyDb';
import { speechService } from './speech/speechService';
import { injectSvgSprites } from './ui/svgSprites';
import { VoiceController } from './ui/voiceController';
import { LookupPad } from './ui/lookupPad';
import { StoryView } from './ui/storyView';
import { VoiceDock } from './ui/voiceDock';
import { SettingsModal } from './ui/settingsModal';

async function bootstrapApp(): Promise<void> {
  // 1. Ensure Rulepop SVG sprites are injected into the DOM
  injectSvgSprites();

  const appEl = document.getElementById('app');
  if (!appEl) {
    console.error('Root element #app not found');
    return;
  }

  // 2. Render base loading shell
  appEl.innerHTML = `
    <!-- Header -->
    <header class="app-header">
      <div class="header-container">
        <a href="#" class="header-logo-group" id="header-logo-home">
          <img src="${import.meta.env.BASE_URL}meta/icon-192.png" alt="Vantage Voice" class="header-logo-img" />
          <div class="header-title-text">
            <span class="header-title">Vantage Voice</span>
            <span class="header-subtitle">Offline Storybook Companion</span>
          </div>
        </a>
        <div class="header-actions">
          <button type="button" class="header-btn" id="btn-header-mute" title="Toggle Mute" aria-label="Toggle Audio Mute">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
            </svg>
          </button>
          <button type="button" class="header-btn" id="btn-header-settings" title="Settings" aria-label="Settings">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
          </button>
        </div>
      </div>
    </header>

    <!-- Main Content Area -->
    <main class="main-content" id="main-content">
      <div class="loading-state" id="loading-state" style="text-align: center; padding: 48px 16px; color: var(--accent-cyan);">
        <div style="font-size: 1.2rem; font-weight: 700; margin-bottom: 8px;">Loading Storybook Database...</div>
        <div style="font-size: 0.85rem; color: var(--text-dim);">Indexing 6,262 entries & reverse action vocabulary</div>
      </div>
      <div id="story-view-root" class="story-view-container"></div>
      <div id="lookup-pad-root" class="lookup-pad-container" style="display: none;"></div>
    </main>

    <!-- Bottom Voice Dock Container -->
    <div id="voice-dock-root"></div>

    <!-- Settings Modal Container -->
    <div id="settings-modal-root" class="settings-modal-root"></div>
  `;

  try {
    // 3. Load story database from local data/stories.json
    const db = await StoryDatabase.loadFromUrl(`${import.meta.env.BASE_URL}data/stories.json`);

    // 4. Set vocabulary words on speechService for constrained Vosk WASM engine
    speechService.setVocabulary(db.getAllVocabularyWords());

    // 5. Initialize controller
    const controller = new VoiceController(db, speechService);

    // Reload the saved narrator / recognition models in the background
    speechService.restoreSavedEngines().catch((err) => {
      console.warn('Failed to restore saved speech engines:', err);
    });

    // 6. Audio unlock listener on first user interaction (touch/click/key)
    const unlockHandler = async () => {
      await controller.unlockAudio();
      window.removeEventListener('pointerdown', unlockHandler);
      window.removeEventListener('keydown', unlockHandler);
      window.removeEventListener('touchstart', unlockHandler);
    };
    window.addEventListener('pointerdown', unlockHandler, { once: true });
    window.addEventListener('keydown', unlockHandler, { once: true });
    window.addEventListener('touchstart', unlockHandler, { once: true });

    // 7. Mount UI components
    const storyViewRoot = document.getElementById('story-view-root') as HTMLElement;
    const lookupPadRoot = document.getElementById('lookup-pad-root') as HTMLElement;
    const voiceDockRoot = document.getElementById('voice-dock-root') as HTMLElement;
    const settingsModalRoot = document.getElementById('settings-modal-root') as HTMLElement;
    const loadingState = document.getElementById('loading-state');

    if (loadingState) {
      loadingState.style.display = 'none';
    }
    if (lookupPadRoot) {
      lookupPadRoot.style.display = 'block';
    }

    const storyView = new StoryView(storyViewRoot, controller);
    const lookupPad = new LookupPad(lookupPadRoot, controller);

    const settingsModal = new SettingsModal(settingsModalRoot, controller);
    const voiceDock = new VoiceDock(voiceDockRoot, controller, () => {
      settingsModal.open();
    });

    // Header buttons
    const headerLogo = document.getElementById('header-logo-home');
    headerLogo?.addEventListener('click', (e) => {
      e.preventDefault();
      controller.backToLookup();
    });

    const headerSettingsBtn = document.getElementById('btn-header-settings');
    headerSettingsBtn?.addEventListener('click', () => {
      settingsModal.open();
    });

    const headerMuteBtn = document.getElementById('btn-header-mute');
    headerMuteBtn?.addEventListener('click', () => {
      controller.toggleMuted();
    });

    // 8. View switcher based on controller state
    controller.onStateChange((state) => {
      if (state.activeResult) {
        storyViewRoot.style.display = 'block';
        lookupPadRoot.style.display = 'none';
      } else {
        storyViewRoot.style.display = 'none';
        lookupPadRoot.style.display = 'block';
      }

      // Update header mute button icon
      if (headerMuteBtn) {
        if (state.isMuted) {
          headerMuteBtn.style.color = 'var(--accent-coral)';
        } else {
          headerMuteBtn.style.color = '';
        }
      }
    });

    console.log('Vantage Voice initialized successfully!');
  } catch (err) {
    console.error('Failed to initialize Vantage Voice:', err);
    const loadingState = document.getElementById('loading-state');
    if (loadingState) {
      loadingState.innerHTML = `
        <div style="color: var(--accent-coral); font-weight: 700; font-size: 1.1rem; margin-bottom: 8px;">
          Failed to load stories database
        </div>
        <div style="color: var(--text-dim); font-size: 0.85rem;">
          ${String(err)}
        </div>
      `;
    }
  }
}

// Start app on DOMContentLoaded or immediately if already loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrapApp);
} else {
  bootstrapApp();
}
