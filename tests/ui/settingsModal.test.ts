import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import { StoryRawEntry } from '../../src/data/types';
import { StoryDatabase } from '../../src/data/storyDb';
import { SpeechService } from '../../src/speech/speechService';
import { VoiceController } from '../../src/ui/voiceController';
import { SettingsModal } from '../../src/ui/settingsModal';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('SettingsModal', () => {
  let speech: SpeechService;
  let root: HTMLElement;
  let modal: SettingsModal;
  let finishSpeaking: () => void;

  beforeEach(() => {
    const raw = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../public/data/stories.json'), 'utf8')
    ) as Record<string, StoryRawEntry>;
    speech = new SpeechService();
    vi.spyOn(speech, 'unlockAudio').mockResolvedValue(true);
    vi.spyOn(speech, 'speak').mockImplementation(
      () => new Promise<void>((resolve) => (finishSpeaking = resolve))
    );
    vi.spyOn(speech, 'stopSpeaking').mockImplementation(() => finishSpeaking?.());

    root = document.createElement('div');
    document.body.innerHTML = '';
    document.body.appendChild(root);
    modal = new SettingsModal(root, new VoiceController(new StoryDatabase(raw), speech));
    modal.open();
  });

  const testButton = () => root.querySelector<HTMLButtonElement>('#btn-test-voice')!;

  it('turns the test button into Stop while the sample plays, and stops it', async () => {
    testButton().click();
    await tick();
    expect(testButton().textContent).toContain('Stop Test');

    testButton().click();
    await tick();
    expect(speech.stopSpeaking).toHaveBeenCalled();
    expect(testButton().textContent).toContain('Test Voice & Speed');
  });

  it('stops a playing test when Settings closes', async () => {
    testButton().click();
    await tick();
    modal.close();
    expect(speech.stopSpeaking).toHaveBeenCalled();
  });

  it('shows install steps and silent-mode tips, and keeps a panel open across re-renders', () => {
    const install = root.querySelector<HTMLDetailsElement>('details[data-help="install"]')!;
    expect(install.textContent).toContain('Add to Home Screen');
    expect(install.textContent).toContain('Install app');
    expect(root.querySelector('details[data-help="sound"]')!.textContent).toContain('volume');

    install.open = true;
    install.dispatchEvent(new Event('toggle'));
    modal.render();
    expect(root.querySelector<HTMLDetailsElement>('details[data-help="install"]')!.open).toBe(true);
  });
});

describe('SettingsModal re-render', () => {
  it('keeps the panel scroll position', () => {
    const raw = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../public/data/stories.json'), 'utf8')
    ) as Record<string, StoryRawEntry>;
    const root = document.createElement('div');
    document.body.appendChild(root);
    const modal = new SettingsModal(root, new VoiceController(new StoryDatabase(raw), new SpeechService()));
    modal.open();
    root.querySelector('.modal-body')!.scrollTop = 420;
    modal.render();
    expect(root.querySelector('.modal-body')!.scrollTop).toBe(420);
  });
});
