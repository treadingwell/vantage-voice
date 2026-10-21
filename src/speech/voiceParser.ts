import {
  CandidateMatch,
  ParsedBranchChoice,
  StoryEntryVariant,
  StoryLookupResult,
  VoiceIntent,
  VoiceStateMode,
} from '../data/types';
import { StoryDatabase, stringSimilarity } from '../data/storyDb';

const DIGIT_WORDS: Record<string, number> = {
  zero: 0,
  oh: 0,
  o: 0,
  one: 1,
  won: 1,
  two: 2,
  too: 2,
  to: 2,
  three: 3,
  four: 4,
  fore: 4,
  for: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  ate: 8,
  nine: 9,
};

const TEEN_WORDS: Record<string, number> = {
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const TENS_WORDS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

function isRecognizedNumberWord(w: string): boolean {
  return (
    w === 'and' ||
    w === 'hundred' ||
    w === 'thousand' ||
    w === 'triple' ||
    w === 'double' ||
    DIGIT_WORDS[w] !== undefined ||
    TEEN_WORDS[w] !== undefined ||
    TENS_WORDS[w] !== undefined
  );
}

function parseUnder100(words: string[]): number | null {
  if (words.length === 1) {
    const w = words[0];
    if (DIGIT_WORDS[w] !== undefined) return DIGIT_WORDS[w];
    if (TEEN_WORDS[w] !== undefined) return TEEN_WORDS[w];
    if (TENS_WORDS[w] !== undefined) return TENS_WORDS[w];
    return null;
  }
  if (words.length === 2) {
    const [w0, w1] = words;
    if (TENS_WORDS[w0] !== undefined && DIGIT_WORDS[w1] !== undefined) {
      return TENS_WORDS[w0] + DIGIT_WORDS[w1];
    }
    if (DIGIT_WORDS[w0] !== undefined && DIGIT_WORDS[w1] !== undefined) {
      return DIGIT_WORDS[w0] * 10 + DIGIT_WORDS[w1];
    }
  }
  return null;
}

export function parseNumberWords(words: string[]): number | null {
  if (!words || words.length === 0) return null;
  if (!words.every(isRecognizedNumberWord)) return null;

  // Support 'triple zero', 'double zero', etc.
  if (words.length === 2 && words[0] === 'triple' && DIGIT_WORDS[words[1]] !== undefined) {
    const d = DIGIT_WORDS[words[1]];
    return d === 0 ? 0 : d * 111;
  }
  if (words.length === 2 && words[0] === 'double' && DIGIT_WORDS[words[1]] !== undefined) {
    const d = DIGIT_WORDS[words[1]];
    return d === 0 ? 0 : d * 11;
  }

  // Case 1: All words are single digit words (e.g. ['two', 'three', 'six'], ['zero', 'four', 'one'], ['zero', 'zero', 'zero'])
  if (words.length > 1 && words.every((w) => DIGIT_WORDS[w] !== undefined)) {
    const numStr = words.map((w) => DIGIT_WORDS[w]).join('');
    return parseInt(numStr, 10);
  }

  // Case 2: Standard compound with 'hundred' and/or 'thousand'
  if (words.includes('hundred') || words.includes('thousand')) {
    let total = 0;
    let current = 0;
    for (const w of words) {
      if (w === 'and') continue;
      if (w === 'thousand') {
        total += (current || 1) * 1000;
        current = 0;
      } else if (w === 'hundred') {
        total += (current || 1) * 100;
        current = 0;
      } else if (TENS_WORDS[w] !== undefined) {
        current += TENS_WORDS[w];
      } else if (TEEN_WORDS[w] !== undefined) {
        current += TEEN_WORDS[w];
      } else if (DIGIT_WORDS[w] !== undefined) {
        current += DIGIT_WORDS[w];
      }
    }
    return total + current;
  }

  // Case 3: Pair of 2-digit numbers (like 'fourteen twenty four', 'fifteen ninety eight', 'ten sixteen')
  if (words.length >= 2 && TEEN_WORDS[words[0]] !== undefined) {
    const rest = words.slice(1);
    const restNum = parseUnder100(rest);
    if (restNum !== null) {
      return TEEN_WORDS[words[0]] * 100 + restNum;
    }
  }

  // Case 4: 'two thirty six' (single digit + tens + [unit])
  if (words.length >= 2 && DIGIT_WORDS[words[0]] !== undefined) {
    const rest = words.slice(1);
    const restNum = parseUnder100(rest);
    if (restNum !== null && restNum >= 10) {
      return DIGIT_WORDS[words[0]] * 100 + restNum;
    }
  }

  // Case 5: Standard under 100
  const under100 = parseUnder100(words);
  if (under100 !== null) return under100;

  return null;
}

export function extractNumberFromTranscript(
  transcript: string
): { number: number; remainingText: string } | null {
  if (!transcript) return null;
  const raw = transcript.trim();

  // Pattern A: key like 'e236' or 'd43'
  const keyMatch = raw.match(/\b([mlehtods])(\d{1,4})\b/i);
  if (keyMatch) {
    const num = parseInt(keyMatch[2], 10);
    const idx = keyMatch.index ?? 0;
    const remaining = (
      raw.slice(0, idx) +
      ' ' +
      keyMatch[1] +
      ' ' +
      raw.slice(idx + keyMatch[0].length)
    )
      .trim()
      .replace(/\s+/g, ' ');
    return { number: num, remainingText: remaining };
  }

  // Pattern B1: spaced digits like '2 3 6' or '0 0 1'
  const spacedDigitsMatch = raw.match(/\b\d(?:\s+\d)+\b/);
  if (spacedDigitsMatch) {
    const compactDigits = spacedDigitsMatch[0].replace(/\s+/g, '');
    const num = parseInt(compactDigits, 10);
    const idx = spacedDigitsMatch.index ?? 0;
    const remaining = (
      raw.slice(0, idx) +
      ' ' +
      raw.slice(idx + spacedDigitsMatch[0].length)
    )
      .trim()
      .replace(/\s+/g, ' ');
    return { number: num, remainingText: remaining };
  }

  // Pattern B2: direct digits like '236', '43', '1598'
  const digitMatch = raw.match(/\b\d{1,4}\b/);
  if (digitMatch) {
    const num = parseInt(digitMatch[0], 10);
    const idx = digitMatch.index ?? 0;
    const remaining = (
      raw.slice(0, idx) +
      ' ' +
      raw.slice(idx + digitMatch[0].length)
    )
      .trim()
      .replace(/\s+/g, ' ');
    return { number: num, remainingText: remaining };
  }

  // Pattern C: word sequences
  const tokens = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) return null;

  // Find longest contiguous slice of number words that yields a valid number
  for (let len = tokens.length; len >= 1; len--) {
    for (let start = 0; start <= tokens.length - len; start++) {
      const slice = tokens.slice(start, start + len);
      // Skip if slice starts or ends with 'and'
      if (slice[0] === 'and' || slice[slice.length - 1] === 'and') continue;
      // Skip if slice is just standalone preposition 'to' or 'for' or standalone 'oh' / 'o'
      if (
        slice.length === 1 &&
        (slice[0] === 'to' || slice[0] === 'for' || slice[0] === 'oh' || slice[0] === 'o')
      ) {
        continue;
      }

      const num = parseNumberWords(slice);
      if (num !== null && num >= 0 && num <= 9999) {
        const remainingTokens = [...tokens.slice(0, start), ...tokens.slice(start + len)];
        const remainingText = remainingTokens.join(' ').trim();
        return { number: num, remainingText };
      }
    }
  }

  return null;
}

const CANCEL_PATTERN =
  /\b(cancel|stop|never mind|nevermind|back|exit|abort|close|clear|reset|start over|new lookup)\b/i;
const REPEAT_PRE_PATTERN =
  /\b(repeat action|repeat prompt|repeat cost|say action|read action|read prompt|repeat the action|repeat the prompt|repeat the cost)\b/i;
const REPEAT_POST_PATTERN =
  /\b(repeat result|repeat entry|repeat story|read result|read entry|say result|repeat the result|repeat the entry|repeat the story)\b/i;
const REPEAT_AUTO_PATTERN =
  /\b(repeat that|say again|read again|one more time|what was that|repeat|again|pardon)\b/i;
const SETUP_PATTERN =
  /\b(setup|start game|starting setup|game setup|start new game|begin game)\b/i;
const CONFIRM_DONE_PATTERN =
  /\b(done|ready|reveal|read|continue|finished|okay|ok|proceed|let's go|lets go|i'm done|im done|we're done|were done)\b/i;

const POSITIONAL_OPTIONS: Record<string, number> = {
  '1': 0,
  'one': 0,
  'first': 0,
  'first one': 0,
  'option 1': 0,
  'option one': 0,
  'choice 1': 0,
  'choice one': 0,
  '2': 1,
  'two': 1,
  'second': 1,
  'second one': 1,
  'option 2': 1,
  'option two': 1,
  'choice 2': 1,
  'choice two': 1,
  '3': 2,
  'three': 2,
  'third': 2,
  'third one': 2,
  'option 3': 2,
  'option three': 2,
  'choice 3': 2,
  'choice three': 2,
  '4': 3,
  'four': 3,
  'fourth': 3,
  'fourth one': 3,
  'option 4': 3,
  'option four': 3,
  '5': 4,
  'five': 4,
  'fifth': 4,
  'option 5': 4,
};

const SORTED_POSITIONAL_ENTRIES = Object.entries(POSITIONAL_OPTIONS).sort(
  (a, b) => b[0].length - a[0].length
);

const DIRECTION_WORDS: Record<string, string> = {
  north: 'N',
  n: 'N',
  east: 'E',
  e: 'E',
  south: 'S',
  s: 'S',
  west: 'W',
  w: 'W',
  northeast: 'NE',
  ne: 'NE',
  southeast: 'SE',
  se: 'SE',
  southwest: 'SW',
  sw: 'SW',
  northwest: 'NW',
  nw: 'NW',
};

function formatVariantLabel(variant: StoryEntryVariant): string {
  const parts: string[] = [];
  if (variant.direction) parts.push(variant.direction);
  if (variant.option) parts.push(variant.option);
  if (variant.primaryVerb) parts.push(variant.primaryVerb);
  return parts.join(' - ');
}

export function parseVoiceInput(
  transcript: string,
  db: StoryDatabase,
  context: {
    mode: VoiceStateMode;
    activeResult?: StoryLookupResult | null;
    activeChoices?: ParsedBranchChoice[];
  }
): VoiceIntent {
  const cleanTranscript = (transcript || '').trim();
  const lower = cleanTranscript.toLowerCase();

  // 1. Check Global Cancel command
  if (CANCEL_PATTERN.test(lower)) {
    return { type: 'CANCEL', rawTranscript: cleanTranscript };
  }

  // 2. Check Global Repeat command (with target pre/post/auto)
  if (REPEAT_PRE_PATTERN.test(lower)) {
    return { type: 'REPEAT', target: 'pre', rawTranscript: cleanTranscript };
  }
  if (REPEAT_POST_PATTERN.test(lower)) {
    return { type: 'REPEAT', target: 'post', rawTranscript: cleanTranscript };
  }
  if (REPEAT_AUTO_PATTERN.test(lower)) {
    return { type: 'REPEAT', target: 'auto', rawTranscript: cleanTranscript };
  }

  // 3. Mode: WAITING_FOR_DONE
  if (context.mode === 'WAITING_FOR_DONE') {
    // Only confirm done if the user is not uttering a new card or location number
    if (!extractNumberFromTranscript(cleanTranscript) && CONFIRM_DONE_PATTERN.test(lower)) {
      return { type: 'CONFIRM_DONE', rawTranscript: cleanTranscript };
    }
  }

  // 4. Mode: DISAMBIGUATING
  if (context.mode === 'DISAMBIGUATING' && context.activeResult) {
    const variants = context.activeResult.variants;

    // Check positional matches ("option 1", "first", "second", etc.)
    for (const [key, index] of SORTED_POSITIONAL_ENTRIES) {
      if (lower === key || new RegExp(`\\b${key}\\b`, 'i').test(lower)) {
        if (index < variants.length) {
          return {
            type: 'SELECT_OPTION',
            optionIndex: index,
            optionText: formatVariantLabel(variants[index]),
          };
        }
      }
    }

    // Check direction, option, and verb matches against each variant
    const tokens = lower
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);

    for (let i = 0; i < variants.length; i++) {
      const v = variants[i];
      for (const token of tokens) {
        // Direction match
        const dirCode = DIRECTION_WORDS[token];
        if (dirCode && v.direction && v.direction.toUpperCase() === dirCode) {
          return {
            type: 'SELECT_OPTION',
            optionIndex: i,
            optionText: formatVariantLabel(v),
          };
        }

        // Option match
        if (v.option) {
          const optLower = v.option.toLowerCase();
          if (optLower === token || stringSimilarity(optLower, token) >= 0.75) {
            return {
              type: 'SELECT_OPTION',
              optionIndex: i,
              optionText: formatVariantLabel(v),
            };
          }
        }

        // Verb match
        for (const verb of v.allVerbs) {
          if (
            verb === token ||
            (token.length >= 4 && token.startsWith(verb)) ||
            stringSimilarity(verb, token) >= 0.75
          ) {
            return {
              type: 'SELECT_OPTION',
              optionIndex: i,
              optionText: formatVariantLabel(v),
            };
          }
        }
      }
    }
  }

  // 5. Mode: BRANCHING_CHOICE
  if (context.mode === 'BRANCHING_CHOICE' && context.activeChoices && context.activeChoices.length > 0) {
    const choices = context.activeChoices;

    // Check positional matches
    for (const [key, index] of SORTED_POSITIONAL_ENTRIES) {
      if (lower === key || new RegExp(`\\b${key}\\b`, 'i').test(lower)) {
        if (index < choices.length) {
          return {
            type: 'SELECT_OPTION',
            optionIndex: index,
            optionText: choices[index].summary,
          };
        }
      }
    }

    // Match choice summary text
    let bestChoiceIndex = -1;
    let bestSimilarity = 0;

    for (let i = 0; i < choices.length; i++) {
      const summaryLower = choices[i].summary.toLowerCase();

      // Direct substring match
      if (summaryLower.includes(lower) || lower.includes(summaryLower)) {
        return {
          type: 'SELECT_OPTION',
          optionIndex: i,
          optionText: choices[i].summary,
        };
      }

      // Similarity check
      const sim = stringSimilarity(summaryLower, lower);
      if (sim > bestSimilarity) {
        bestSimilarity = sim;
        bestChoiceIndex = i;
      }

      // Check token overlap
      const choiceWords = new Set(summaryLower.split(/\s+/));
      const transcriptWords = lower.split(/\s+/);
      let matchCount = 0;
      for (const tw of transcriptWords) {
        if (choiceWords.has(tw) && tw.length > 2) matchCount++;
      }
      if (matchCount >= 2 && matchCount / transcriptWords.length >= 0.5) {
        return {
          type: 'SELECT_OPTION',
          optionIndex: i,
          optionText: choices[i].summary,
        };
      }
    }

    if (bestSimilarity >= 0.55 && bestChoiceIndex >= 0) {
      return {
        type: 'SELECT_OPTION',
        optionIndex: bestChoiceIndex,
        optionText: choices[bestChoiceIndex].summary,
      };
    }
  }

  // 6. Full Lookup Command (works in IDLE, LISTENING_COMMAND, or as fallback)
  if (SETUP_PATTERN.test(lower)) {
    const s0Entry = db.getByKey('s0') || db.getByBookAndNumber('s', 0);
    if (s0Entry) {
      return {
        type: 'LOOKUP',
        result: s0Entry,
        variantIndex: 0,
        confidence: 1.0,
        spokenCue: cleanTranscript,
        number: 0,
      };
    }
  }

  const extracted = extractNumberFromTranscript(cleanTranscript);

  if (extracted) {
    const match = db.findBySpokenCueAndNumber(extracted.remainingText, extracted.number);

    if (match) {
      if (match.variantIndex !== null) {
        return {
          type: 'LOOKUP',
          result: match.result,
          variantIndex: match.variantIndex,
          confidence: match.confidence,
          spokenCue: extracted.remainingText,
          number: extracted.number,
        };
      } else {
        // Variant index is null (e.g. multiple variants on single entry or ambiguous entries)
        if (match.candidates && match.candidates.length > 1) {
          const distinctKeys = new Set(match.candidates.map((c) => c.result.key));
          if (distinctKeys.size === 1) {
            // All candidates are variants of the same entry (e.g. d43, m51)
            return {
              type: 'LOOKUP',
              result: match.result,
              variantIndex: null,
              confidence: match.confidence,
              spokenCue: extracted.remainingText,
              number: extracted.number,
            };
          } else {
            // Ambiguous among multiple books
            return {
              type: 'AMBIGUOUS_LOOKUP',
              number: extracted.number,
              candidates: match.candidates,
              rawTranscript: cleanTranscript,
            };
          }
        }

        return {
          type: 'LOOKUP',
          result: match.result,
          variantIndex: null,
          confidence: match.confidence,
          spokenCue: extracted.remainingText,
          number: extracted.number,
        };
      }
    }

    // If findBySpokenCueAndNumber returned null, check if any entries exist for this number
    const available = db.getEntriesForNumber(extracted.number);
    if (available.length > 0) {
      const candidates: CandidateMatch[] = available.flatMap((e) =>
        e.variants.map((v) => ({
          result: e,
          variantIndex: v.index,
          label: `${e.bookName.toUpperCase()} ${e.paddedNumber}`,
        }))
      );
      return {
        type: 'AMBIGUOUS_LOOKUP',
        number: extracted.number,
        candidates,
        rawTranscript: cleanTranscript,
      };
    }

    return {
      type: 'UNKNOWN',
      rawTranscript: cleanTranscript,
      reason: `Location or card number ${extracted.number} not found in storybook.`,
    };
  }

  return {
    type: 'UNKNOWN',
    rawTranscript: cleanTranscript,
    reason: 'No card or location number detected.',
  };
}
