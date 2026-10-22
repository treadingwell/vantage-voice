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

  it('renders setup navigation banner for Location 000 and navigates to 001', async () => {
    await controller.handleTextInput('s0');

    expect(container.querySelector('.setup-nav-000')).not.toBeNull();
    const nextBtn = container.querySelector('#btn-nav-to-001') as HTMLButtonElement;
    expect(nextBtn).not.toBeNull();
    expect(nextBtn.textContent).toContain('Go to Location 001');

    nextBtn.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(controller.getState().activeResult?.key).toBe('s1');
  });

  it('renders setup navigation and pod buttons for Location 001 and navigates to 000', async () => {
    await controller.handleTextInput('s1');

    expect(container.querySelector('.setup-nav-001')).not.toBeNull();
    const prevBtn = container.querySelector('#btn-nav-to-000') as HTMLButtonElement;
    expect(prevBtn).not.toBeNull();
    expect(prevBtn.textContent).toContain('Back to Location 000');

    const podBtns = container.querySelectorAll('.btn-pod-loc');
    expect(podBtns.length).toBe(6); // 002 to 007

    prevBtn.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(controller.getState().activeResult?.key).toBe('s0');
  });

  it('provides visible repeat pre-done and post-done buttons', async () => {
    await controller.handleTextInput('e236');

    const repeatPreBtn = container.querySelector('#btn-replay-action');
    expect(repeatPreBtn).not.toBeNull();
    expect(repeatPreBtn?.getAttribute('title')).toContain('Repeat Pre-Done Prompt');
    expect(repeatPreBtn?.textContent).toContain('Repeat');

    await controller.revealResult();
    const repeatPostBtn = container.querySelector('#btn-replay-audio');
    expect(repeatPostBtn).not.toBeNull();
    expect(repeatPostBtn?.getAttribute('title')).toContain('Repeat Post-Done Result');
    expect(repeatPostBtn?.textContent).toContain('Repeat Result');

    const repeatPromptPostBtn = container.querySelector('#btn-replay-prompt-post');
    expect(repeatPromptPostBtn).not.toBeNull();
    expect(repeatPromptPostBtn?.getAttribute('title')).toContain('Repeat Pre-Done Prompt');
    expect(repeatPromptPostBtn?.textContent).toContain('Repeat Prompt');
  });

  it('renders progressive sequential results one step at a time for o235', async () => {
    await controller.handleTextInput('o235');
    await controller.revealResult();

    // Initial reveal: only the first Continue option should be shown
    const section = container.querySelector('.sequential-branch-section');
    expect(section).not.toBeNull();
    expect(section?.textContent).toContain('Progressive Result');

    const nextBtn = container.querySelector('.branch-continue-btn') as HTMLButtonElement;
    expect(nextBtn).not.toBeNull();
    expect(nextBtn.textContent).toContain('Continue');
    // Result 2 and Result 3 are not yet shown
    expect(container.querySelectorAll('.sequential-revealed-step').length).toBe(0);

    // Clicking next button reveals Step 1 (Result 1) and shows Step 2 Continue button
    nextBtn.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(container.querySelectorAll('.sequential-revealed-step').length).toBe(1);
    expect(container.textContent).toContain('Skirm spoiler pack');

    // Inline dice cost icon is enhanced with .inline-cost-dice-svg
    const diceIcons = container.querySelectorAll('.inline-cost-dice-svg');
    expect(diceIcons.length).toBeGreaterThan(0);
  });
});
