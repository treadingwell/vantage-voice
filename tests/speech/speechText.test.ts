import { describe, it, expect } from 'vitest';
import {
  normalizeForSpeech,
  numberToWords,
  formatActionPromptForSpeech,
  htmlToSpeechText,
} from '../../src/speech/ttsFormatter';
import { splitIntoSentences } from '../../src/speech/neuralNarrator';

describe('numberToWords', () => {
  it('reads small quantities normally', () => {
    expect(numberToWords('1')).toBe('one');
    expect(numberToWords('15')).toBe('fifteen');
    expect(numberToWords('40')).toBe('forty');
    expect(numberToWords('99')).toBe('ninety nine');
  });

  it('reads location and card numbers in pairs', () => {
    expect(numberToWords('236')).toBe('two thirty six');
    expect(numberToWords('204')).toBe('two oh four');
    expect(numberToWords('118')).toBe('one eighteen');
    expect(numberToWords('1255')).toBe('twelve fifty five');
    expect(numberToWords('1603')).toBe('sixteen oh three');
  });

  it('reads round numbers and zero-padded ids', () => {
    expect(numberToWords('100')).toBe('one hundred');
    expect(numberToWords('1000')).toBe('one thousand');
    expect(numberToWords('1200')).toBe('twelve hundred');
    expect(numberToWords('097')).toBe('ninety seven');
    expect(numberToWords('000')).toBe('zero zero zero');
  });
});

describe('normalizeForSpeech', () => {
  it('spells out numbers and currency', () => {
    expect(normalizeForSpeech('Go to cave 097 and gain 2 boost.')).toBe(
      'Go to cave ninety seven and gain two boost.'
    );
    expect(normalizeForSpeech('You may pay $2.')).toBe('You may pay two coins.');
    expect(normalizeForSpeech('Pay $1 to continue.')).toBe('Pay one coin to continue.');
  });

  it('turns slashes and parentheses into words and pauses', () => {
    expect(normalizeForSpeech('matching that skill: move / look ( 061 ); anything else ( 054 ).')).toBe(
      'matching that skill: move or look; sixty one; anything else; fifty four.'
    );
  });

  it('lowercases ALL-CAPS verbs and expands region codes', () => {
    expect(normalizeForSpeech('HIKE north or DESCEND')).toBe('hike north or descend.');
    expect(normalizeForSpeech('your current area is SE-2.')).toBe('your current area is southeast two.');
  });

  it('always ends with punctuation', () => {
    expect(normalizeForSpeech('Grab a spike and hold on')).toBe('Grab a spike and hold on.');
    expect(normalizeForSpeech('Which one?')).toBe('Which one?');
    expect(normalizeForSpeech('“Hello there.”')).toBe('“Hello there.”');
  });

  it('reads ordinals and decimals', () => {
    expect(normalizeForSpeech('the 2nd time')).toBe('the second time.');
    expect(normalizeForSpeech('speed 1.5')).toBe('speed one point five.');
  });
});

describe('splitIntoSentences', () => {
  it('splits on sentence boundaries', () => {
    expect(
      splitIntoSentences(
        'At the top of the cliff, you are greeted by a view of the area. The narrow tunnel curves and winds down into the earth.'
      )
    ).toEqual([
      'At the top of the cliff, you are greeted by a view of the area.',
      'The narrow tunnel curves and winds down into the earth.',
    ]);
  });

  it('merges short sentences into a neighbour so the voice has context', () => {
    expect(
      splitIntoSentences(
        'If you pay six coins, the cartographer sells you a map. Go to cave ninety seven.'
      )
    ).toEqual(['If you pay six coins, the cartographer sells you a map. Go to cave ninety seven.']);
    expect(
      splitIntoSentences('Choose one. Hike around the mountain to reach the far side of the valley.')
    ).toEqual(['Choose one. Hike around the mountain to reach the far side of the valley.']);
    expect(splitIntoSentences('Go to two ninety two.')).toEqual(['Go to two ninety two.']);
  });

  it('splits very long sentences at clause breaks', () => {
    const long = `${'word '.repeat(30).trim()}, ${'more '.repeat(30).trim()}.`;
    const chunks = splitIntoSentences(long);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 180)).toBe(true);
  });
});

describe('normalizeForSpeech edge cases from the dataset', () => {
  it('handles variable costs, abbreviations, grids and coordinates', () => {
    expect(normalizeForSpeech('you may pay $X to decrease this cost')).toBe('you may pay X coins to decrease this cost.');
    expect(normalizeForSpeech('the edges (e.g., when looking) and i.e. no rotating')).toBe(
      'the edges; for example, when looking, and that is, no rotating.'
    );
    expect(normalizeForSpeech('a 3x3 grid')).toBe('a three by three grid.');
    expect(normalizeForSpeech('your path is A1, B1, C2')).toBe('your path is A one, B one, C two.');
    expect(normalizeForSpeech('vocalized 1s and 0s')).toBe('vocalized ones and zeros.');
    expect(normalizeForSpeech('the 322nd floor')).toBe('the three twenty second floor.');
    expect(normalizeForSpeech('the 20th time')).toBe('the twentieth time.');
  });
});

describe('parenthetical pauses', () => {
  it('uses a semicolon for an opening parenthesis', () => {
    expect(
      normalizeForSpeech(
        'the sentient highlights your current location (view page 9 in the Book of Vantages; you are in region L).'
      )
    ).toBe(
      'the sentient highlights your current location; view page nine in the Book of Vantages; you are in region L.'
    );
  });
});

describe('X dice marker formatting', () => {
  it('formats action prompts with X dice marker as "Roll any number of dice;"', () => {
    // Cost is 'X'
    const promptWithAction = formatActionPromptForSpeech({
      cost: 'X',
      actionPlain: 'COMMUNE with the cave',
    } as any);
    expect(promptWithAction).toBe('Roll any number of dice; commune with the cave.');

    // Cost is 'x' lowercase
    const promptLower = formatActionPromptForSpeech({
      cost: 'x',
      actionPlain: 'GATHER intel',
    } as any);
    expect(promptLower).toBe('Roll any number of dice; gather intel.');

    // Cost is 'X' with empty action
    const promptEmpty = formatActionPromptForSpeech({
      cost: 'X',
      actionPlain: '',
    } as any);
    expect(promptEmpty).toBe('Roll any number of dice;');

    // Inline SVG with cost-x in summary or text
    const speechFromSvg = htmlToSpeechText(
      "<summary><svg class='◊' viewBox='0 0 500 500'><use href='#i-cost-x' /></svg> <span class='move action'>ENTER</span></summary>"
    );
    expect(speechFromSvg).toContain('Roll any number of dice;');
    expect(speechFromSvg).toContain('ENTER');
  });

  it('normalizes option prompts to keep speech volume consistent across engines', () => {
    expect(normalizeForSpeech('Option 1: Let them live.')).toBe('Option one. Let them live.');
    expect(normalizeForSpeech('Multiple options for Depart forty three: East or North. Which one?')).toBe(
      'Multiple options for Depart forty three. East or North. Which one?'
    );
  });
});
