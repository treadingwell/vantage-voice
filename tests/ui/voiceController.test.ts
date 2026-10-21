import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import { StoryRawEntry } from '../../src/data/types';
import { StoryDatabase } from '../../src/data/storyDb';
import { SpeechService } from '../../src/speech/speechService';
import { VoiceController } from '../../src/ui/voiceController';

describe('VoiceController & State Machine Integration', () => {
  let db: StoryDatabase;
  let speech: SpeechService;
  let controller: VoiceController;

  beforeEach(() => {
    // Load dataset
    const storiesPath = path.resolve(__dirname, '../../public/data/stories.json');
    const rawData = JSON.parse(fs.readFileSync(storiesPath, 'utf8')) as Record<
      string,
      StoryRawEntry
    >;
    db = new StoryDatabase(rawData);
    speech = new SpeechService();

    // Mock speech speak & startListening methods for controlled testing
    vi.spyOn(speech, 'speak').mockResolvedValue(undefined);
    vi.spyOn(speech, 'startListening').mockResolvedValue(undefined);
    vi.spyOn(speech, 'stopListening').mockImplementation(() => {});
    vi.spyOn(speech, 'stopSpeaking').mockImplementation(() => {});
    vi.spyOn(speech, 'unlockAudio').mockResolvedValue(true);

    controller = new VoiceController(db, speech);
  });

  it('initializes with default IDLE state and empty selection', () => {
    const state = controller.getState();
    expect(state.mode).toBe('IDLE');
    expect(state.activeResult).toBeNull();
    expect(state.activeVariantIndex).toBeNull();
    expect(state.isObscured).toBe(true);
  });

  describe('Flow 1: Single Variant Entry (e236 "Transmit on 236")', () => {
    it('executes lookup, prompts dice roll, blurs result, and confirms with "Done"', async () => {
      // Step 1: User speaks "Transmit on 236"
      await controller.handleTranscript('transmit on 236', true);

      const state1 = controller.getState();
      expect(state1.activeResult?.key).toBe('e236');
      expect(state1.activeVariantIndex).toBe(0);
      expect(state1.mode).toBe('WAITING_FOR_DONE');
      expect(state1.isObscured).toBe(true);

      // Verify TTS was called with action prompt
      expect(speech.speak).toHaveBeenCalledWith(
        expect.stringContaining('Roll 6 dice to transmit a signal to your homeworld.')
      );
      // Verify STT auto-listened for "Done"
      expect(speech.startListening).toHaveBeenCalledWith(true);

      // Step 2: User says "Done"
      await controller.handleTranscript('done', true);

      const state2 = controller.getState();
      expect(state2.isObscured).toBe(false);
      // Result read aloud
      expect(speech.speak).toHaveBeenCalledWith(
        expect.stringContaining('The early days of basic training finally prove useful')
      );
      // No branching choices on e236, so returns to IDLE
      expect(state2.mode).toBe('IDLE');
    });

    it('unblurs and reads result when user taps reveal button directly', async () => {
      await controller.handleTextInput('e236');
      expect(controller.getState().mode).toBe('WAITING_FOR_DONE');
      expect(controller.getState().isObscured).toBe(true);

      await controller.revealResult();
      expect(controller.getState().isObscured).toBe(false);
      expect(speech.speak).toHaveBeenCalledWith(
        expect.stringContaining('The early days of basic training finally prove useful')
      );
    });
  });

  describe('Flow 2: Multi-Option Entry (d43 "Depart 43")', () => {
    it('enters DISAMBIGUATING, prompts options, and selects chosen variant', async () => {
      // Step 1: User says "Depart 43" (without specifying direction)
      await controller.handleTranscript('depart 43', true);

      const state1 = controller.getState();
      expect(state1.activeResult?.key).toBe('d43');
      expect(state1.activeVariantIndex).toBeNull();
      expect(state1.mode).toBe('DISAMBIGUATING');

      // Prompted aloud for which option
      expect(speech.speak).toHaveBeenCalledWith(
        expect.stringContaining('Multiple options for Depart 043')
      );

      // Step 2: User says "East" or "Enter"
      await controller.handleTranscript('east', true);

      const state2 = controller.getState();
      expect(state2.activeVariantIndex).toBe(0); // East option is index 0
      expect(state2.mode).toBe('WAITING_FOR_DONE');
      expect(state2.isObscured).toBe(true);
      expect(speech.speak).toHaveBeenCalledWith(
        expect.stringContaining('Roll 5 dice to enter east into a glowing door.')
      );
    });

    it('can select disambiguation option directly by button click index', async () => {
      await controller.handleTextInput('d43');
      expect(controller.getState().mode).toBe('DISAMBIGUATING');

      // Click option 1 (North / EVADE)
      await controller.selectDisambiguationOption(1);

      const state = controller.getState();
      expect(state.activeVariantIndex).toBe(1);
      expect(state.mode).toBe('WAITING_FOR_DONE');
      expect(speech.speak).toHaveBeenCalledWith(
        expect.stringContaining('Roll 2 dice to evade north around the nest')
      );
    });
  });

  describe('Flow 3: Branching Choices (o236 "Stun on 236")', () => {
    it('reveals main result, enters BRANCHING_CHOICE, and reads selected branch outcome', async () => {
      await controller.handleTranscript('stun on 236', true);
      expect(controller.getState().mode).toBe('WAITING_FOR_DONE');

      // User confirms done
      await controller.handleTranscript('ready', true);

      const state = controller.getState();
      expect(state.isObscured).toBe(false);
      expect(state.mode).toBe('BRANCHING_CHOICE');
      expect(state.activeChoices).toHaveLength(2);

      // Branch choices prompt spoken
      expect(speech.speak).toHaveBeenCalledWith(
        expect.stringContaining('Option 1: Let them live. Option 2: Finish them. Which do you choose?')
      );

      // User speaks choice "Let them live"
      await controller.handleTranscript('let them live', true);

      const stateAfterChoice = controller.getState();
      expect(stateAfterChoice.chosenBranchIndex).toBe(0);
      expect(speech.speak).toHaveBeenCalledWith(
        expect.stringContaining('Gain lesson 1424.')
      );
      expect(stateAfterChoice.mode).toBe('IDLE');
    });
  });

  describe('Flow 4: Non-Obscured Entry (s1 Book of Secrets)', () => {
    it('immediately reveals and speaks result without blurring when variant.obscure === false', async () => {
      const s1 = db.getByKey('s1');
      expect(s1).not.toBeNull();
      expect(s1?.variants[0].obscure).toBe(false);

      await controller.executeLookup(s1!, 0);

      const state = controller.getState();
      expect(state.isObscured).toBe(false);
      expect(state.mode).toBe('IDLE');
      expect(speech.speak).toHaveBeenCalled();
    });
  });

  describe('Flow 5: Cancel & Enhanced Repeat (Pre-Done and Post-Done)', () => {
    it('cancels active story and returns cleanly to IDLE', async () => {
      await controller.handleTranscript('transmit 236', true);
      expect(controller.getState().activeResult).not.toBeNull();

      await controller.handleTranscript('cancel', true);
      const state = controller.getState();
      expect(state.activeResult).toBeNull();
      expect(state.mode).toBe('IDLE');
    });

    it('repeats pre-done action prompt when "repeat" is spoken during WAITING_FOR_DONE', async () => {
      await controller.handleTranscript('transmit 236', true);
      expect(controller.getState().mode).toBe('WAITING_FOR_DONE');
      expect(controller.getState().isObscured).toBe(true);
      vi.clearAllMocks();

      await controller.handleTranscript('repeat', true);
      // Pre-done action prompt is spoken
      expect(speech.speak).toHaveBeenCalledWith(
        expect.stringContaining('Roll 6 dice to transmit a signal to your homeworld.')
      );
      // Continuous listening re-engaged for "Done"
      expect(speech.startListening).toHaveBeenCalledWith(true);
      expect(controller.getState().mode).toBe('WAITING_FOR_DONE');
    });

    it('repeats post-done result when "repeat" is spoken after "done"', async () => {
      await controller.handleTranscript('transmit 236', true);
      await controller.handleTranscript('done', true);
      expect(controller.getState().isObscured).toBe(false);
      vi.clearAllMocks();

      await controller.handleTranscript('repeat', true);
      // Post-done result is spoken
      expect(speech.speak).toHaveBeenCalledWith(
        expect.stringContaining('The early days of basic training finally prove useful')
      );
      // Continuous listening re-engaged for hands-free repeats/commands
      expect(speech.startListening).toHaveBeenCalledWith(true);
    });

    it('distinguishes "repeat action" vs "repeat result" when revealed', async () => {
      await controller.handleTranscript('transmit 236', true);
      await controller.handleTranscript('done', true);
      expect(controller.getState().isObscured).toBe(false);

      // Explicit "repeat action" repeats pre-done prompt
      vi.clearAllMocks();
      await controller.handleTranscript('repeat action', true);
      expect(speech.speak).toHaveBeenCalledWith(
        expect.stringContaining('Roll 6 dice to transmit a signal to your homeworld.')
      );

      // Explicit "repeat result" repeats post-done result
      vi.clearAllMocks();
      await controller.handleTranscript('repeat result', true);
      expect(speech.speak).toHaveBeenCalledWith(
        expect.stringContaining('The early days of basic training finally prove useful')
      );
    });
  });

  describe('Flow 6: Game Setup Cards (000 & 001)', () => {
    it('loads Card 000 via "location 000", "setup", and "zero zero zero"', async () => {
      // 1. "location 000"
      await controller.handleTranscript('location 000', true);
      expect(controller.getState().activeResult?.key).toBe('s0');
      expect(controller.getState().activeResult?.number).toBe(0);
      expect(controller.getState().isObscured).toBe(false);
      expect(speech.speak).toHaveBeenCalledWith(
        expect.stringContaining('Starting Setup')
      );

      // 2. "setup"
      await controller.handleTranscript('setup', true);
      expect(controller.getState().activeResult?.key).toBe('s0');

      // 3. "zero zero zero"
      await controller.handleTranscript('zero zero zero', true);
      expect(controller.getState().activeResult?.key).toBe('s0');
    });

    it('loads Card 001 via "location 001" and "zero zero one"', async () => {
      await controller.handleTranscript('location 001', true);
      expect(controller.getState().activeResult?.key).toBe('s1');
      expect(controller.getState().activeResult?.number).toBe(1);
      expect(controller.getState().isObscured).toBe(false);
      expect(speech.speak).toHaveBeenCalledWith(
        expect.stringContaining('The ship malfunctions')
      );

      await controller.handleTranscript('zero zero one', true);
      expect(controller.getState().activeResult?.key).toBe('s1');
    });
  });

  describe('Flow 7: Recent Lookups History', () => {
    it('adds viewed entries to recent lookups list', async () => {
      await controller.handleTextInput('e236');
      const recents = controller.getState().recentLookups;
      expect(recents.length).toBeGreaterThan(0);
      expect(recents[0].key).toBe('e236');
      expect(recents[0].label).toContain('ENGAGE 236');
    });
  });

  describe('Flow 8: Speech Prompt Completion Debounce & Auto-Reset', () => {
    it('accumulates chunks over ~1.0s pause before executing lookup', async () => {
      vi.useFakeTimers();

      // Simulate live STT microphone firing separate chunks: "transmit on", "2", "3", "6"
      (speech as any).notifyTranscript('transmit on', true);
      expect(controller.getState().transcript).toBe('transmit on');
      expect(controller.getState().mode).toBe('IDLE');

      // 400ms pause, then user says "2"
      vi.advanceTimersByTime(400);
      (speech as any).notifyTranscript('2', true);
      expect(controller.getState().transcript).toBe('transmit on 2');
      expect(controller.getState().mode).toBe('IDLE');

      // 400ms pause, then user says "3"
      vi.advanceTimersByTime(400);
      (speech as any).notifyTranscript('3', true);
      expect(controller.getState().transcript).toBe('transmit on 2 3');
      expect(controller.getState().mode).toBe('IDLE');

      // 400ms pause, then user says "6"
      vi.advanceTimersByTime(400);
      (speech as any).notifyTranscript('6', true);
      expect(controller.getState().transcript).toBe('transmit on 2 3 6');
      expect(controller.getState().mode).toBe('IDLE');

      // Debounce timer (1000ms) runs to completion after speech settles
      await vi.advanceTimersByTimeAsync(1000);

      // Should have executed lookup for e236!
      expect(controller.getState().activeResult?.key).toBe('e236');
      expect(controller.getState().mode).toBe('WAITING_FOR_DONE');

      vi.useRealTimers();
    });

    it('settles fast control command ("done") in 350ms during WAITING_FOR_DONE', async () => {
      vi.useFakeTimers();

      // First load e236
      await controller.handleTextInput('e236');
      expect(controller.getState().mode).toBe('WAITING_FOR_DONE');
      expect(controller.getState().isObscured).toBe(true);

      // Player says "done"
      (speech as any).notifyTranscript('done', true);
      expect(controller.getState().transcript).toBe('done');
      expect(controller.getState().isObscured).toBe(true);

      // Fast settle fires after 350ms
      await vi.advanceTimersByTimeAsync(350);
      expect(controller.getState().isObscured).toBe(false);

      vi.useRealTimers();
    });

    it('auto-resets transcript and restores mode prompt after ~1.8 seconds', async () => {
      vi.useFakeTimers();

      await controller.startListeningCommand();
      expect(controller.getState().mode).toBe('LISTENING_COMMAND');

      // An unrecognized phrase is spoken
      await controller.handleTranscript('hello galaxy', true);
      expect(controller.getState().transcript).toBe('hello galaxy');
      expect(controller.getState().statusMessage).toContain('No card or location number detected');

      // Advance by 1800ms
      await vi.advanceTimersByTimeAsync(1800);
      expect(controller.getState().transcript).toBe('');
      expect(controller.getState().statusMessage).toContain('Listening... Say e.g. "Transmit on 236"');

      vi.useRealTimers();
    });

    it('handles voice reset keywords to start fresh lookup', async () => {
      await controller.handleTextInput('e236');
      expect(controller.getState().activeResult).not.toBeNull();

      // User says "start over"
      await controller.handleTranscript('start over', true);
      expect(controller.getState().activeResult).toBeNull();
      expect(controller.getState().mode).toBe('LISTENING_COMMAND');

      // User says "clear"
      await controller.handleTextInput('e236');
      await controller.handleTranscript('clear', true);
      expect(controller.getState().activeResult).toBeNull();
      expect(controller.getState().mode).toBe('LISTENING_COMMAND');

      // User says "new lookup"
      await controller.handleTextInput('e236');
      await controller.handleTranscript('new lookup', true);
      expect(controller.getState().activeResult).toBeNull();
      expect(controller.getState().mode).toBe('LISTENING_COMMAND');
    });

    it('supports natural phrasings for lookups', async () => {
      // 1. "lookup transmit on 236"
      await controller.handleTranscript('lookup transmit on 236', true);
      expect(controller.getState().activeResult?.key).toBe('e236');

      // 2. "check engage 236"
      await controller.handleTranscript('check engage 236', true);
      expect(controller.getState().activeResult?.key).toBe('e236');

      // 3. "read 236"
      await controller.handleTranscript('read 236', true);
      // Multiple options for 236 -> DISAMBIGUATING
      expect(controller.getState().mode).toBe('DISAMBIGUATING');

      // 4. "card 236"
      await controller.handleTranscript('card 236', true);
      expect(controller.getState().mode).toBe('DISAMBIGUATING');
    });
  });
});
