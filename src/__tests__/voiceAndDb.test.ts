import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import {
  BOOKS,
  BOOK_BY_PREFIX,
  BOOK_BY_NAME,
  StoryRawEntry,
} from '../data/types';
import { StoryDatabase } from '../data/storyDb';
import {
  formatActionPromptForSpeech,
  parseAndFormatResult,
  formatDisambiguationPrompt,
  formatBranchChoicesPrompt,
  htmlToSpeechText,
} from '../speech/ttsFormatter';
import {
  extractNumberFromTranscript,
  parseVoiceInput,
  parseNumberWords,
} from '../speech/voiceParser';

describe('Vantage Data Layer, TTS Formatter & Voice NLP Parser', () => {
  let db: StoryDatabase;

  beforeAll(() => {
    // Load real dataset from public/data/stories.json
    const storiesPath = path.resolve(__dirname, '../../public/data/stories.json');
    const rawData = JSON.parse(fs.readFileSync(storiesPath, 'utf8')) as Record<
      string,
      StoryRawEntry
    >;
    db = new StoryDatabase(rawData);
  });

  describe('1. Types & Book Metadata', () => {
    it('defines exactly 8 book metadata entries', () => {
      expect(BOOKS).toHaveLength(8);
      const prefixes = BOOKS.map((b) => b.prefix).sort();
      expect(prefixes).toEqual(['d', 'e', 'h', 'l', 'm', 'o', 's', 't']);
    });

    it('indexes books by prefix and by name', () => {
      expect(BOOK_BY_PREFIX['e'].name).toBe('engage');
      expect(BOOK_BY_PREFIX['d'].name).toBe('depart');
      expect(BOOK_BY_PREFIX['s'].name).toBe('secret');

      expect(BOOK_BY_NAME['engage'].prefix).toBe('e');
      expect(BOOK_BY_NAME['depart'].prefix).toBe('d');
      expect(BOOK_BY_NAME['secret'].prefix).toBe('s');
    });
  });

  describe('2. StoryDatabase & Reverse Action Index', () => {
    it('gets entry by exact key', () => {
      const e236 = db.getByKey('e236');
      expect(e236).not.toBeNull();
      expect(e236?.key).toBe('e236');
      expect(e236?.bookName).toBe('engage');
      expect(e236?.number).toBe(236);
      expect(e236?.paddedNumber).toBe('236');
      expect(e236?.variants).toHaveLength(1);

      const v = e236!.variants[0];
      expect(v.cost).toBe(6);
      expect(v.primaryVerb).toBe('transmit');
      expect(v.actionPlain).toContain('TRANSMIT a signal to your homeworld');
    });

    it('gets entry by book name/prefix and number', () => {
      const byName = db.getByBookAndNumber('engage', 236);
      const byPrefix = db.getByBookAndNumber('e', '236');
      expect(byName?.key).toBe('e236');
      expect(byPrefix?.key).toBe('e236');

      const bos = db.getByBookAndNumber('secret', 1);
      expect(bos?.key).toBe('s1');
      expect(bos?.variants[0].obscure).toBe(false);
    });

    it('builds reverse index for location 236 with all 7 books and verbs', () => {
      const entries = db.getEntriesForNumber(236);
      expect(entries.length).toBe(7);

      const verbByPrefix = new Map<string, string | null>();
      for (const entry of entries) {
        verbByPrefix.set(entry.prefix, entry.variants[0].primaryVerb);
      }

      expect(verbByPrefix.get('m')).toBe('scale');
      expect(verbByPrefix.get('l')).toBe('study');
      expect(verbByPrefix.get('e')).toBe('transmit');
      expect(verbByPrefix.get('h')).toBe('craft');
      expect(verbByPrefix.get('t')).toBe('hack');
      expect(verbByPrefix.get('o')).toBe('stun');
      expect(verbByPrefix.get('d')).toBe('wade');
    });

    it('handles multi-option entries like d43 and m51', () => {
      const d43 = db.getByKey('d43');
      expect(d43).not.toBeNull();
      expect(d43?.variants).toHaveLength(2);

      // Variant 0: East / Enter
      expect(d43?.variants[0].direction).toBe('E');
      expect(d43?.variants[0].primaryVerb).toBe('enter');
      expect(d43?.variants[0].cost).toBe(5);

      // Variant 1: North / Evade
      expect(d43?.variants[1].direction).toBe('N');
      expect(d43?.variants[1].primaryVerb).toBe('evade');
      expect(d43?.variants[1].cost).toBe(2);

      const m51 = db.getByKey('m51');
      expect(m51).not.toBeNull();
      expect(m51?.variants).toHaveLength(2);
      expect(m51?.variants[0].option).toBe('EVADE');
      expect(m51?.variants[1].option).toBe('DIVE');
    });

    it('resolves spoken cues by verb, book, option, and direction', () => {
      // "transmit" on 236 -> e236 variant 0
      const matchTransmit = db.findBySpokenCueAndNumber('transmit', 236);
      expect(matchTransmit?.result.key).toBe('e236');
      expect(matchTransmit?.variantIndex).toBe(0);

      // "dive" on 51 -> m51 variant 1
      const matchDive = db.findBySpokenCueAndNumber('dive', 51);
      expect(matchDive?.result.key).toBe('m51');
      expect(matchDive?.variantIndex).toBe(1);

      // "evade" on 43 -> d43 variant 1
      const matchEvade = db.findBySpokenCueAndNumber('evade', 43);
      expect(matchEvade?.result.key).toBe('d43');
      expect(matchEvade?.variantIndex).toBe(1);

      // "depart north" on 43 -> d43 variant 1
      const matchDepartNorth = db.findBySpokenCueAndNumber('depart north', 43);
      expect(matchDepartNorth?.result.key).toBe('d43');
      expect(matchDepartNorth?.variantIndex).toBe(1);

      // "depart" on 43 without direction/option -> variantIndex null to trigger disambiguation!
      const matchDepart = db.findBySpokenCueAndNumber('depart', 43);
      expect(matchDepart?.result.key).toBe('d43');
      expect(matchDepart?.variantIndex).toBeNull();
      expect(matchDepart?.candidates).toHaveLength(2);

      // Fuzzy matching: "transmits" on 236 -> e236 variant 0
      const matchFuzzy = db.findBySpokenCueAndNumber('transmits', 236);
      expect(matchFuzzy?.result.key).toBe('e236');
      expect(matchFuzzy?.variantIndex).toBe(0);

      // Fuzzy matching: "stunning" on 236 -> o236 variant 0
      const matchStunning = db.findBySpokenCueAndNumber('stunning', 236);
      expect(matchStunning?.result.key).toBe('o236');
      expect(matchStunning?.variantIndex).toBe(0);
    });

    it('generates offline Vosk vocabulary with verbs, directions, numbers, and control words', () => {
      const vocab = db.getAllVocabularyWords();
      expect(vocab.length).toBeGreaterThanOrEqual(300);

      expect(vocab).toContain('transmit');
      expect(vocab).toContain('scale');
      expect(vocab).toContain('engage');
      expect(vocab).toContain('north');
      expect(vocab).toContain('two');
      expect(vocab).toContain('hundred');
      expect(vocab).toContain('done');
      expect(vocab).toContain('ready');
      expect(vocab).toContain('reveal');
      expect(vocab).toContain('cancel');
      expect(vocab).toContain('repeat');
    });
  });

  describe('3. TTS Formatter', () => {
    it('formats action prompt for speech with dice count', () => {
      const e236 = db.getByKey('e236')!;
      const prompt = formatActionPromptForSpeech(e236.variants[0], 'e');
      expect(prompt).toBe('Roll 6 dice to transmit a signal to your homeworld.');

      // Cost === 1
      const mockVar1 = { ...e236.variants[0], cost: 1 };
      const prompt1 = formatActionPromptForSpeech(mockVar1, 'e');
      expect(prompt1).toBe('Roll 1 die to transmit a signal to your homeworld.');

      // Cost === null (e.g. Book of Secrets s1)
      const s1 = db.getByKey('s1')!;
      const promptS1 = formatActionPromptForSpeech(s1.variants[0], 's');
      expect(promptS1).toBe('Book of Secrets.');
    });

    it('converts HTML entities, currencies, and slashes to natural speech', () => {
      const input = '<p>Pay $15 to gain 1/turn bonus. Choose move/look/engage.</p>';
      const clean = htmlToSpeechText(input);
      expect(clean).toBe('Pay 15 coins to gain 1 per turn bonus. Choose move or look or engage.');

      const singular = '<p>Lose $1.</p>';
      expect(htmlToSpeechText(singular)).toBe('Lose 1 coin.');
    });

    it('extracts branching choices from <details> blocks', () => {
      const o236 = db.getByKey('o236')!;
      const parsed = parseAndFormatResult(o236.variants[0].resultHtml);

      expect(parsed.hasChoices).toBe(true);
      expect(parsed.choices).toHaveLength(2);

      // Choice 0
      expect(parsed.choices[0].summary).toBe('Let them live');
      expect(parsed.choices[0].speechText).toContain('Gain lesson 1424.');

      // Choice 1
      expect(parsed.choices[1].summary).toBe('Finish them');
      expect(parsed.choices[1].speechText).toContain('you lose 1 morale and gain 2 health.');

      // Main HTML should have <details> stripped
      expect(parsed.mainHtml).not.toContain('<details>');
      expect(parsed.mainSpeechText).toContain('A translucent pink sentient blinks into existence');
    });

    it('formats disambiguation prompts for multi-option entries', () => {
      const d43 = db.getByKey('d43')!;
      const promptD43 = formatDisambiguationPrompt(d43);
      expect(promptD43).toBe('Multiple options for Depart 043: East, Enter; or North, Evade. Which one?');

      const m51 = db.getByKey('m51')!;
      const promptM51 = formatDisambiguationPrompt(m51);
      expect(promptM51).toBe('Multiple options for Move 051: Evade; or Dive. Which one?');
    });

    it('formats branch choices prompt', () => {
      const o236 = db.getByKey('o236')!;
      const parsed = parseAndFormatResult(o236.variants[0].resultHtml);
      const prompt = formatBranchChoicesPrompt(parsed.choices);
      expect(prompt).toBe('Option 1: Let them live. Option 2: Finish them. Which do you choose?');
    });
  });

  describe('4. Spoken Number Normalization & Voice NLP Parser', () => {
    it('parses number words correctly across variations', () => {
      expect(parseNumberWords(['two', 'three', 'six'])).toBe(236);
      expect(parseNumberWords(['zero', 'four', 'one'])).toBe(41);
      expect(parseNumberWords(['oh', 'four', 'one'])).toBe(41);
      expect(parseNumberWords(['two', 'thirty', 'six'])).toBe(236);
      expect(parseNumberWords(['two', 'hundred', 'and', 'thirty', 'six'])).toBe(236);
      expect(parseNumberWords(['fourteen', 'twenty', 'four'])).toBe(1424);
      expect(parseNumberWords(['fifteen', 'ninety', 'eight'])).toBe(1598);
      expect(parseNumberWords(['one', 'thousand', 'five', 'hundred', 'ninety', 'eight'])).toBe(1598);
      expect(parseNumberWords(['forty', 'three'])).toBe(43);
      expect(parseNumberWords(['won', 'forty', 'three'])).toBe(143);
    });

    it('extracts numbers and remaining text from various transcripts', () => {
      expect(extractNumberFromTranscript('transmit on 236')).toEqual({
        number: 236,
        remainingText: 'transmit on',
      });

      expect(extractNumberFromTranscript('engage 236')).toEqual({
        number: 236,
        remainingText: 'engage',
      });

      expect(extractNumberFromTranscript('e236')).toEqual({
        number: 236,
        remainingText: 'e',
      });

      expect(extractNumberFromTranscript('depart north 43')).toEqual({
        number: 43,
        remainingText: 'depart north',
      });

      expect(extractNumberFromTranscript('secret 85')).toEqual({
        number: 85,
        remainingText: 'secret',
      });

      expect(extractNumberFromTranscript('two thirty six transmit')).toEqual({
        number: 236,
        remainingText: 'transmit',
      });

      expect(extractNumberFromTranscript('engage two hundred and thirty six')).toEqual({
        number: 236,
        remainingText: 'engage',
      });

      expect(extractNumberFromTranscript('fourteen twenty four')).toEqual({
        number: 1424,
        remainingText: '',
      });
    });

    it('parses VoiceIntent in IDLE / LISTENING_COMMAND mode', () => {
      const intentTransmit = parseVoiceInput('transmit on 236', db, { mode: 'IDLE' });
      expect(intentTransmit.type).toBe('LOOKUP');
      if (intentTransmit.type === 'LOOKUP') {
        expect(intentTransmit.result.key).toBe('e236');
        expect(intentTransmit.variantIndex).toBe(0);
      }

      const intentDepartNorth = parseVoiceInput('depart north 43', db, { mode: 'LISTENING_COMMAND' });
      expect(intentDepartNorth.type).toBe('LOOKUP');
      if (intentDepartNorth.type === 'LOOKUP') {
        expect(intentDepartNorth.result.key).toBe('d43');
        expect(intentDepartNorth.variantIndex).toBe(1);
      }

      const intentDepartAmbiguous = parseVoiceInput('depart 43', db, { mode: 'LISTENING_COMMAND' });
      expect(intentDepartAmbiguous.type).toBe('LOOKUP');
      if (intentDepartAmbiguous.type === 'LOOKUP') {
        expect(intentDepartAmbiguous.result.key).toBe('d43');
        expect(intentDepartAmbiguous.variantIndex).toBeNull();
      }

      const intentBos = parseVoiceInput('secret 85', db, { mode: 'IDLE' });
      expect(intentBos.type).toBe('LOOKUP');
      if (intentBos.type === 'LOOKUP') {
        expect(intentBos.result.key).toBe('s85');
      }

      const intentCancel = parseVoiceInput('cancel', db, { mode: 'IDLE' });
      expect(intentCancel.type).toBe('CANCEL');

      const intentRepeat = parseVoiceInput('repeat that', db, { mode: 'IDLE' });
      expect(intentRepeat.type).toBe('REPEAT');

      const intentUnknown = parseVoiceInput('hello computer', db, { mode: 'IDLE' });
      expect(intentUnknown.type).toBe('UNKNOWN');
    });

    it('parses VoiceIntent in WAITING_FOR_DONE mode', () => {
      const intentDone = parseVoiceInput('done', db, { mode: 'WAITING_FOR_DONE' });
      expect(intentDone.type).toBe('CONFIRM_DONE');

      const intentReady = parseVoiceInput('ready', db, { mode: 'WAITING_FOR_DONE' });
      expect(intentReady.type).toBe('CONFIRM_DONE');

      const intentReveal = parseVoiceInput('reveal result', db, { mode: 'WAITING_FOR_DONE' });
      expect(intentReveal.type).toBe('CONFIRM_DONE');

      const intentCancel = parseVoiceInput('cancel', db, { mode: 'WAITING_FOR_DONE' });
      expect(intentCancel.type).toBe('CANCEL');
    });

    it('parses VoiceIntent in DISAMBIGUATING mode', () => {
      const d43 = db.getByKey('d43')!;

      // Direction word match
      const intentNorth = parseVoiceInput('north', db, {
        mode: 'DISAMBIGUATING',
        activeResult: d43,
      });
      expect(intentNorth.type).toBe('SELECT_OPTION');
      if (intentNorth.type === 'SELECT_OPTION') {
        expect(intentNorth.optionIndex).toBe(1);
      }

      // Positional match
      const intentOption1 = parseVoiceInput('option 1', db, {
        mode: 'DISAMBIGUATING',
        activeResult: d43,
      });
      expect(intentOption1.type).toBe('SELECT_OPTION');
      if (intentOption1.type === 'SELECT_OPTION') {
        expect(intentOption1.optionIndex).toBe(0);
      }

      const intentFirst = parseVoiceInput('first one', db, {
        mode: 'DISAMBIGUATING',
        activeResult: d43,
      });
      expect(intentFirst.type).toBe('SELECT_OPTION');
      if (intentFirst.type === 'SELECT_OPTION') {
        expect(intentFirst.optionIndex).toBe(0);
      }
    });

    it('parses VoiceIntent in BRANCHING_CHOICE mode', () => {
      const o236 = db.getByKey('o236')!;
      const parsed = parseAndFormatResult(o236.variants[0].resultHtml);

      // Summary text match
      const intentLive = parseVoiceInput('let them live', db, {
        mode: 'BRANCHING_CHOICE',
        activeChoices: parsed.choices,
      });
      expect(intentLive.type).toBe('SELECT_OPTION');
      if (intentLive.type === 'SELECT_OPTION') {
        expect(intentLive.optionIndex).toBe(0);
      }

      const intentFinish = parseVoiceInput('finish them', db, {
        mode: 'BRANCHING_CHOICE',
        activeChoices: parsed.choices,
      });
      expect(intentFinish.type).toBe('SELECT_OPTION');
      if (intentFinish.type === 'SELECT_OPTION') {
        expect(intentFinish.optionIndex).toBe(1);
      }

      // Positional match
      const intentSecond = parseVoiceInput('second one', db, {
        mode: 'BRANCHING_CHOICE',
        activeChoices: parsed.choices,
      });
      expect(intentSecond.type).toBe('SELECT_OPTION');
      if (intentSecond.type === 'SELECT_OPTION') {
        expect(intentSecond.optionIndex).toBe(1);
      }
    });

    it('resolves Setup Cards 000 and 001 via voice without requiring "secret"', () => {
      // 000 variations
      const intentLoc000 = parseVoiceInput('location 000', db, { mode: 'IDLE' });
      expect(intentLoc000.type).toBe('LOOKUP');
      if (intentLoc000.type === 'LOOKUP') {
        expect(intentLoc000.result.key).toBe('s0');
        expect(intentLoc000.variantIndex).toBe(0);
        expect(intentLoc000.number).toBe(0);
      }

      const intentSetup = parseVoiceInput('setup', db, { mode: 'IDLE' });
      expect(intentSetup.type).toBe('LOOKUP');
      if (intentSetup.type === 'LOOKUP') {
        expect(intentSetup.result.key).toBe('s0');
        expect(intentSetup.variantIndex).toBe(0);
      }

      const intentStartGame = parseVoiceInput('start game', db, { mode: 'IDLE' });
      expect(intentStartGame.type).toBe('LOOKUP');
      if (intentStartGame.type === 'LOOKUP') {
        expect(intentStartGame.result.key).toBe('s0');
        expect(intentStartGame.variantIndex).toBe(0);
      }

      const intentTripleZero = parseVoiceInput('triple zero', db, { mode: 'IDLE' });
      expect(intentTripleZero.type).toBe('LOOKUP');
      if (intentTripleZero.type === 'LOOKUP') {
        expect(intentTripleZero.result.key).toBe('s0');
        expect(intentTripleZero.variantIndex).toBe(0);
      }

      const intentZeroZeroZero = parseVoiceInput('zero zero zero', db, { mode: 'IDLE' });
      expect(intentZeroZeroZero.type).toBe('LOOKUP');
      if (intentZeroZeroZero.type === 'LOOKUP') {
        expect(intentZeroZeroZero.result.key).toBe('s0');
        expect(intentZeroZeroZero.variantIndex).toBe(0);
      }

      // 001 variations
      const intentLoc001 = parseVoiceInput('location 001', db, { mode: 'IDLE' });
      expect(intentLoc001.type).toBe('LOOKUP');
      if (intentLoc001.type === 'LOOKUP') {
        expect(intentLoc001.result.key).toBe('s1');
        expect(intentLoc001.variantIndex).toBe(0);
        expect(intentLoc001.number).toBe(1);
      }

      const intentCard001 = parseVoiceInput('card 001', db, { mode: 'IDLE' });
      expect(intentCard001.type).toBe('LOOKUP');
      if (intentCard001.type === 'LOOKUP') {
        expect(intentCard001.result.key).toBe('s1');
        expect(intentCard001.variantIndex).toBe(0);
      }

      const intentZeroZeroOne = parseVoiceInput('zero zero one', db, { mode: 'IDLE' });
      expect(intentZeroZeroOne.type).toBe('LOOKUP');
      if (intentZeroZeroOne.type === 'LOOKUP') {
        expect(intentZeroZeroOne.result.key).toBe('s1');
        expect(intentZeroZeroOne.variantIndex).toBe(0);
      }
    });

    it('parses enhanced repeat commands with target (auto, pre, post)', () => {
      // Auto targets
      const rAuto1 = parseVoiceInput('repeat', db, { mode: 'WAITING_FOR_DONE' });
      expect(rAuto1.type).toBe('REPEAT');
      if (rAuto1.type === 'REPEAT') expect(rAuto1.target).toBe('auto');

      const rAuto2 = parseVoiceInput('say again', db, { mode: 'IDLE' });
      expect(rAuto2.type).toBe('REPEAT');
      if (rAuto2.type === 'REPEAT') expect(rAuto2.target).toBe('auto');

      const rAuto3 = parseVoiceInput('one more time', db, { mode: 'IDLE' });
      expect(rAuto3.type).toBe('REPEAT');
      if (rAuto3.type === 'REPEAT') expect(rAuto3.target).toBe('auto');

      // Pre-done targets
      const rPre1 = parseVoiceInput('repeat action', db, { mode: 'IDLE' });
      expect(rPre1.type).toBe('REPEAT');
      if (rPre1.type === 'REPEAT') expect(rPre1.target).toBe('pre');

      const rPre2 = parseVoiceInput('repeat prompt', db, { mode: 'IDLE' });
      expect(rPre2.type).toBe('REPEAT');
      if (rPre2.type === 'REPEAT') expect(rPre2.target).toBe('pre');

      const rPre3 = parseVoiceInput('repeat cost', db, { mode: 'IDLE' });
      expect(rPre3.type).toBe('REPEAT');
      if (rPre3.type === 'REPEAT') expect(rPre3.target).toBe('pre');

      // Post-done targets
      const rPost1 = parseVoiceInput('repeat result', db, { mode: 'IDLE' });
      expect(rPost1.type).toBe('REPEAT');
      if (rPost1.type === 'REPEAT') expect(rPost1.target).toBe('post');

      const rPost2 = parseVoiceInput('repeat entry', db, { mode: 'IDLE' });
      expect(rPost2.type).toBe('REPEAT');
      if (rPost2.type === 'REPEAT') expect(rPost2.target).toBe('post');

      const rPost3 = parseVoiceInput('repeat story', db, { mode: 'IDLE' });
      expect(rPost3.type).toBe('REPEAT');
      if (rPost3.type === 'REPEAT') expect(rPost3.target).toBe('post');
    });
  });
});
