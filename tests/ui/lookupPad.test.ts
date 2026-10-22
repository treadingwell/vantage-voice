import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import { StoryRawEntry } from '../../src/data/types';
import { StoryDatabase } from '../../src/data/storyDb';
import { SpeechService } from '../../src/speech/speechService';
import { VoiceController } from '../../src/ui/voiceController';
import { LookupPad } from '../../src/ui/lookupPad';

describe('LookupPad Component', () => {
  let db: StoryDatabase;
  let speech: SpeechService;
  let controller: VoiceController;
  let container: HTMLElement;
  let lookupPad: LookupPad;

  beforeEach(() => {
    document.body.innerHTML = '<div id="test-root"></div>';
    container = document.getElementById('test-root')!;

    const storiesPath = path.resolve(__dirname, '../../public/data/stories.json');
    const rawData = JSON.parse(fs.readFileSync(storiesPath, 'utf8')) as Record<
      string,
      StoryRawEntry
    >;
    db = new StoryDatabase(rawData);
    speech = new SpeechService();

    vi.spyOn(speech, 'speak').mockResolvedValue(undefined);
    vi.spyOn(speech, 'startListening').mockResolvedValue(undefined);

    controller = new VoiceController(db, speech);
    lookupPad = new LookupPad(container, controller);
  });

  afterEach(() => {
    lookupPad.dispose();
    controller.dispose();
  });

  it('renders all 8 storybook buttons and 0-9 numpad', () => {
    const bookBtns = container.querySelectorAll('.book-btn');
    expect(bookBtns.length).toBe(8);

    const numpadBtns = container.querySelectorAll('.numpad-btn');
    expect(numpadBtns.length).toBe(12); // 0-9, backspace, submit

    const submitBtn = container.querySelector('#btn-submit') as HTMLButtonElement;
    expect(submitBtn).not.toBeNull();
    expect(submitBtn.disabled).toBe(true);
  });

  it('selects book and enters digits to enable submit for valid entry', async () => {
    // Select Engage book
    const engageBtn = container.querySelector('.book-btn[data-prefix="e"]') as HTMLButtonElement;
    engageBtn.click();
    expect(engageBtn.classList.contains('is-selected')).toBe(true);

    // Enter 236
    const btn2 = container.querySelector('.numpad-btn[data-key="2"]') as HTMLButtonElement;
    const btn3 = container.querySelector('.numpad-btn[data-key="3"]') as HTMLButtonElement;
    const btn6 = container.querySelector('.numpad-btn[data-key="6"]') as HTMLButtonElement;

    btn2.click();
    btn3.click();
    btn6.click();

    const digitsEl = container.querySelector('#digits-text');
    expect(digitsEl?.textContent).toBe('236');

    // Submit should be enabled because e236 exists!
    const submitBtn = container.querySelector('#btn-submit') as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(false);
    expect(submitBtn.classList.contains('is-ready')).toBe(true);

    // Click submit
    submitBtn.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(controller.getState().activeResult?.key).toBe('e236');
  });

  it('shows action previews when only digits are entered', async () => {
    lookupPad.setNumber('236');

    const previewContainer = container.querySelector('#action-previews');
    expect(previewContainer?.classList.contains('has-previews')).toBe(true);

    // Should render chips for available books on 236 (Move, Look, Engage, etc.)
    const chips = previewContainer?.querySelectorAll('.preview-chip');
    expect(chips?.length).toBeGreaterThan(3);

    // Clicking an action chip directly triggers lookup
    const engageChip = previewContainer?.querySelector('.preview-chip[data-key="e236"]') as HTMLButtonElement;
    expect(engageChip).not.toBeNull();
    engageChip.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(controller.getState().activeResult?.key).toBe('e236');
  });

  it('submits text commands via quick command input', async () => {
    const input = container.querySelector('#quick-command-input') as HTMLInputElement;
    const form = container.querySelector('#quick-command-form') as HTMLFormElement;

    input.value = 'transmit 236';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));

    expect(controller.getState().activeResult?.key).toBe('e236');
  });

  it('opens Card 000 from the game setup shortcut (no setup bar on the pad)', async () => {
    expect(container.querySelector('#game-setup-bar')).toBeNull();
    await controller.openGameSetup();
    expect(controller.getState().activeResult?.key).toBe('s0');
  });
});
