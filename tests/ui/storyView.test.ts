import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import { StoryRawEntry } from '../../src/data/types';
import { StoryDatabase } from '../../src/data/storyDb';
import { SpeechService } from '../../src/speech/speechService';
import { VoiceController } from '../../src/ui/voiceController';
import { StoryView } from '../../src/ui/storyView';

describe('StoryView Component', () => {
  let db: StoryDatabase;
  let speech: SpeechService;
  let controller: VoiceController;
  let container: HTMLElement;
  let storyView: StoryView;

  beforeEach(() => {
    document.body.innerHTML = '<div id="story-root"></div>';
    container = document.getElementById('story-root')!;

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
    storyView = new StoryView(container, controller);
  });

  afterEach(() => {
    storyView.dispose();
    controller.dispose();
  });

  it('is inactive and empty when no story is loaded', () => {
    expect(container.classList.contains('is-active')).toBe(false);
    expect(container.innerHTML).toBe('');
  });

  it('renders story entry with action banner and blurred result with DONE overlay', async () => {
    await controller.handleTextInput('e236');

    expect(container.classList.contains('is-active')).toBe(true);
    expect(container.querySelector('.story-book-name')?.textContent).toBe('ENGAGE');
    expect(container.querySelector('.story-number')?.textContent).toBe('236');

    // Action banner contains TRANSMIT
    const actionEl = container.querySelector('.action-html-body');
    expect(actionEl?.textContent).toContain('TRANSMIT');

    // Result is obscured
    const resultBox = container.querySelector('.story-result-box');
    expect(resultBox?.classList.contains('is-obscured')).toBe(true);

    const doneBtn = container.querySelector('#btn-reveal-done');
    expect(doneBtn).not.toBeNull();
  });

  it('unblurs result and renders audio controls when DONE is clicked', async () => {
    await controller.handleTextInput('e236');

    const doneBtn = container.querySelector('#btn-reveal-done') as HTMLButtonElement;
    doneBtn.click();
    await new Promise((r) => setTimeout(r, 0));

    // Result is now revealed
    const resultBox = container.querySelector('.story-result-box');
    expect(resultBox?.classList.contains('is-revealed')).toBe(true);

    const replayBtn = container.querySelector('#btn-replay-audio');
    expect(replayBtn).not.toBeNull();
  });

  it('renders branching choices for entries with sub-choices (o236)', async () => {
    await controller.handleTextInput('o236');
    await controller.revealResult();

    const branchSection = container.querySelector('.story-branching-section');
    expect(branchSection).not.toBeNull();

    const choiceCards = container.querySelectorAll('.branch-choice-card');
    expect(choiceCards.length).toBe(2);

    // Clicking a choice expands it and triggers speech
    const firstChoiceBtn = choiceCards[0].querySelector('.branch-summary-btn') as HTMLButtonElement;
    firstChoiceBtn.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(controller.getState().chosenBranchIndex).toBe(0);
  });

  it('navigates back to lookup when Back button is clicked', async () => {
    await controller.handleTextInput('e236');

    const backBtn = container.querySelector('#btn-back-lookup') as HTMLButtonElement;
    backBtn.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(controller.getState().activeResult).toBeNull();
    expect(container.classList.contains('is-active')).toBe(false);
  });
});
