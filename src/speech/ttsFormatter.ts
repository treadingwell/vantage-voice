import {
  BookPrefix,
  ParsedBranchChoice,
  ParsedResultContent,
  StoryEntryVariant,
  StoryLookupResult,
} from '../data/types';

export function htmlToSpeechText(html: string): string {
  if (!html) return '';
  let text = html;

  // Replace dice cost SVGs with spoken text before stripping tags
  text = text.replace(/<svg[^>]*>[\s\S]*?#(?:i-)?cost-(?:b)?x[\s\S]*?<\/svg>/gi, ' Roll any number of dice; ');
  text = text.replace(/<svg[^>]*>[\s\S]*?#(?:i-)?cost-(\d+)[\s\S]*?<\/svg>/gi, (_, n) => ` Roll ${n} ${n === '1' ? 'die' : 'dice'}; `);
  // Replace "Roll X dice" / "Roll X skill dice" in story text
  text = text.replace(/\bRoll X (?:skill )?dice\b/gi, 'Roll any number of dice');

  // Remove svg and script/style tags completely
  text = text.replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, ' ');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ');

  // Replace currencies: $1 -> 1 coin, $15 -> 15 coins
  text = text.replace(/\$1\b/g, '1 coin');
  text = text.replace(/\$(\d+)\b/g, '$1 coins');

  // Replace /turn: 1/turn -> 1 per turn, once/turn -> once per turn
  text = text.replace(/(\d+)\s*\/\s*turn\b/gi, '$1 per turn');
  text = text.replace(/once\s*\/\s*turn\b/gi, 'once per turn');
  text = text.replace(/\b([a-zA-Z]+)\s*\/\s*turn\b/gi, '$1 per turn');

  // Replace slashes between words with ' or ': move/look/engage -> move or look or engage
  while (/\b([a-zA-Z]+)\/([a-zA-Z]+)\b/.test(text)) {
    text = text.replace(/\b([a-zA-Z]+)\/([a-zA-Z]+)\b/g, '$1 or $2');
  }

  // Block ends become sentence ends, so list items and lines don't run together
  text = text.replace(/([^.!?:;\s>])(\s*)(<\/(?:li|p|div|h[1-6]|tr)>|<br\s*\/?>)/gi, '$1.$2$3');

  // Remove all other HTML tags
  text = text.replace(/<[^>]+>/g, ' ');

  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, 'and')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&(?:apos|#39|rsquo|lsquo);/g, "'")
    .replace(/&(?:rdquo|ldquo);/g, '"')
    .replace(/&(?:mdash|ndash|#8212|#8211);/g, ' - ')
    .replace(/&(?:hellip|#8230);/g, '...')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));

  // Replace unicode quotes, dashes, ellipses
  text = text.replace(/[\u2014\u2013]/g, ' - ');
  text = text.replace(/[\u2026]/g, '...');
  text = text.replace(/[\u2018\u2019]/g, "'");
  text = text.replace(/[\u201C\u201D]/g, '"');

  // Slashes between words that were wrapped in tags: "move</span>/<span>look" -> "move or look"
  text = text.replace(/\b([a-zA-Z]+)\s*\/\s*([a-zA-Z]+)\b/g, '$1 or $2');

  // Normalize whitespace
  text = text.replace(/\s+/g, ' ').trim();

  // Normalize spaces before punctuation
  text = text.replace(/\s+([.,;:!?])/g, '$1');

  return text;
}

// ---------------------------------------------------------------------------
// Spoken-text normalization
// ---------------------------------------------------------------------------

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

const DIRECTION_WORDS: Record<string, string> = {
  N: 'north', S: 'south', E: 'east', W: 'west',
  NE: 'northeast', NW: 'northwest', SE: 'southeast', SW: 'southwest',
};

function underHundred(n: number): string {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : '');
}

function cardinal(n: number): string {
  if (n < 100) return underHundred(n);
  if (n < 1000) {
    const rest = n % 100;
    return `${ONES[Math.floor(n / 100)]} hundred${rest ? ` ${underHundred(rest)}` : ''}`;
  }
  if (n < 1_000_000) {
    const rest = n % 1000;
    return `${cardinal(Math.floor(n / 1000))} thousand${rest ? ` ${cardinal(rest)}` : ''}`;
  }
  return String(n).split('').map((d) => ONES[Number(d)]).join(' ');
}

/** Two-digit chunk read the way people say room numbers: 4 -> "oh four", 39 -> "thirty nine". */
function pairChunk(n: number): string {
  return n < 10 ? `oh ${ONES[n]}` : underHundred(n);
}

/**
 * Reads a number the way Vantage players say it. Location and card numbers (100-9999) are
 * read in pairs ("236" -> "two thirty six", "1255" -> "twelve fifty five"); smaller
 * quantities and round hundreds/thousands are read normally.
 */
export function numberToWords(digits: string): string {
  if (/^0+$/.test(digits)) return digits.split('').map(() => 'zero').join(' ');
  const n = parseInt(digits, 10);
  if (n < 100) return underHundred(n);
  if (n < 10000) {
    if (n % 1000 === 0) return cardinal(n);
    if (n % 100 === 0) return n < 1000 ? cardinal(n) : `${underHundred(n / 100)} hundred`;
    const head = Math.floor(n / 100);
    return `${n < 1000 ? ONES[head] : underHundred(head)} ${pairChunk(n % 100)}`;
  }
  return cardinal(n);
}

const ORDINAL_LAST_WORD: Record<string, string> = {
  one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth',
  nine: 'ninth', twelve: 'twelfth',
};

/** "322" -> "three twenty second" */
function ordinalWords(digits: string): string {
  const words = numberToWords(digits).split(' ');
  const last = words.pop()!;
  const ordinal =
    ORDINAL_LAST_WORD[last] ?? (last.endsWith('y') ? `${last.slice(0, -1)}ieth` : `${last}th`);
  return [...words, ordinal].join(' ');
}

/**
 * Rewrites text so every narrator can read it cleanly: numbers and symbols become words,
 * ALL-CAPS action verbs become normal words (some voices spell caps letter by letter),
 * and every sentence ends with punctuation so it gets a natural pause. Neural voices like
 * Supertonic read raw characters and garble digits, so this matters most for them.
 */
export function normalizeForSpeech(input: string): string {
  let text = input;

  // Region codes: "SE-2" -> "southeast two"
  text = text.replace(/\b(NE|NW|SE|SW|N|S|E|W)-(\d+)\b/g, (_, dir: string, num: string) => `${DIRECTION_WORDS[dir]} ${numberToWords(num)}`);

  // Currency: "$1" -> "1 coin", "$15" -> "15 coins", "$X" -> "X coins"
  text = text
    .replace(/\$1\b/g, '1 coin')
    .replace(/\$(\d+)\b/g, '$1 coins')
    .replace(/\$([A-Z])\b/g, '$1 coins');

  text = text
    .replace(/\bvs\.\s/gi, 'versus ')
    .replace(/\be\.g\.,?\s/gi, 'for example, ')
    .replace(/\bi\.e\.,?\s/gi, 'that is, ');

  // Grid sizes and coordinates: "3x3" -> "3 by 3", "A1" -> "A 1"
  text = text.replace(/\b(\d+)x(\d+)\b/g, '$1 by $2');
  text = text.replace(/\b([A-Z])(\d)\b/g, '$1 $2');
  // Plural digits: "1s and 0s" -> "ones and zeros"
  text = text.replace(/\b(\d+)s\b/g, (_, n: string) => (n === '0' ? 'zeros' : `${numberToWords(n)}s`));
  text = text.replace(/&/g, ' and ');

  // Slashes: "move / look" -> "move or look"
  text = text.replace(/\s*\/\s*/g, ' or ');

  // Colons after option prefixes or list labels become periods so speech engines maintain strong, consistent volume
  text = text.replace(/\b(Option \w+):\s*/gi, '$1. ');
  text = text.replace(/\b(Multiple options for [^.:;]+):\s*/gi, '$1. ');

  // Parentheses and brackets become pauses. An opening one gets a semicolon, which neural
  // voices read as a natural break where a comma sounded clipped:
  // "location (view page 9)" -> "location; view page 9"
  text = text.replace(/\s*[([]\s*/g, '; ').replace(/\s*[)\]]\s*/g, ', ');

  // ALL-CAPS words (action verbs) -> lowercase
  text = text.replace(/\b[A-Z]{2,}\b/g, (w) => w.toLowerCase());

  // Ordinals and decimals before plain numbers
  text = text.replace(/\b(\d+)(?:st|nd|rd|th)\b/g, (_, n: string) => ordinalWords(n));
  text = text.replace(/\b(\d+)\.(\d+)\b/g, (_, a: string, b: string) => `${numberToWords(a)} point ${b.split('').map((d) => ONES[Number(d)]).join(' ')}`);
  // Thousands separators: "1,000" -> "1000"
  text = text.replace(/\b(\d{1,3}),(\d{3})\b/g, '$1$2');
  text = text.replace(/\b\d+\b/g, (d) => numberToWords(d));

  // Hyphen-number ranges or stray symbols that voices read literally
  text = text.replace(/[#*@%+=_{}|~^<>\\]/g, ' ');

  // Tidy punctuation produced above
  text = text
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/,\s*([.,;:!?])/g, '$1')
    .replace(/([;:!?.])\s*,/g, '$1')
    .replace(/^[\s,]+/, '')
    .trim();

  // Every utterance ends with punctuation so neural voices pause instead of trailing off
  if (text && !/[.!?]["'”’)]*$/.test(text)) {
    text = `${text.replace(/[,;:\s]+$/, '')}.`;
  }

  return text;
}

export function formatActionPromptForSpeech(
  variant: StoryEntryVariant,
  _prefix?: BookPrefix
): string {
  const plain = variant.actionPlain.trim();
  const isXCost =
    variant.cost !== null &&
    variant.cost !== undefined &&
    String(variant.cost).trim().toUpperCase() === 'X';

  if (!plain) {
    if (isXCost) {
      return 'Roll any number of dice;';
    }
    return 'Perform the action for this location.';
  }

  // Remove trailing period/punctuation for prompt building
  const stripped = plain.replace(/[.]+$/, '').trim();
  const words = stripped.split(/\s+/);
  words[0] = words[0].toLowerCase();
  const cleanAction = words.join(' ');

  if (isXCost) {
    return `Roll any number of dice; ${cleanAction}.`;
  }

  const numericCost =
    typeof variant.cost === 'number'
      ? variant.cost
      : variant.cost
      ? parseInt(String(variant.cost), 10)
      : null;

  if (numericCost !== null && !isNaN(numericCost) && numericCost > 0) {
    const dieWord = numericCost === 1 ? 'die' : 'dice';
    return `Roll ${numericCost} ${dieWord} to ${cleanAction}.`;
  }

  // Cost is null or 0: just the action text
  const endsWithPunct = /[.!?]$/.test(stripped);
  return endsWithPunct ? stripped : `${stripped}.`;
}

export function parseAndFormatResult(resultHtml: string): ParsedResultContent {
  if (!resultHtml) {
    return {
      mainHtml: '',
      mainSpeechText: '',
      hasChoices: false,
      isSequential: false,
      choices: [],
    };
  }

  const choices: ParsedBranchChoice[] = [];
  const detailsRegex =
    /<details[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>\s*(?:<div>)?([\s\S]*?)(?:<\/div>)?\s*<\/details>/gi;

  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = detailsRegex.exec(resultHtml)) !== null) {
    const rawSummary = match[1];
    const rawBody = match[2];

    const cleanSummary = htmlToSpeechText(rawSummary);
    const cleanSpeech = htmlToSpeechText(rawBody);

    choices.push({
      index,
      summary: cleanSummary,
      summaryHtml: rawSummary.trim(),
      html: rawBody.trim(),
      speechText: cleanSpeech,
    });
    index++;
  }

  const mainHtml = resultHtml.replace(/<details[^>]*>[\s\S]*?<\/details>/gi, '').trim();
  const mainSpeechText = htmlToSpeechText(mainHtml);

  const isSequential =
    /(?:then read the next result|read the next result only)/i.test(resultHtml) ||
    (choices.length > 1 && choices.every((c) => /^continue/i.test(c.summary.trim())));

  // If sequential, extract the required action (e.g. overpower-2-DIG) from the preceding text for each continue step
  if (isSequential) {
    for (let i = 0; i < choices.length; i++) {
      const priorHtml = i === 0 ? mainHtml : choices[i - 1].html;
      const actionMatch = priorHtml.match(
        /continue with (?:an? )?(<span class=['"][^'"]*skill['"]>[\s\S]*?<\/span>)/i
      );
      if (actionMatch) {
        choices[i].actionHtml = actionMatch[1];
      }
    }
  }

  return {
    mainHtml,
    mainSpeechText,
    hasChoices: choices.length > 0,
    isSequential,
    choices,
  };
}

export function formatDisambiguationPrompt(result: StoryLookupResult): string {
  const bookTitle = result.bookName.charAt(0).toUpperCase() + result.bookName.slice(1);
  const dirMap: Record<string, string> = {
    N: 'North',
    E: 'East',
    S: 'South',
    W: 'West',
    NE: 'Northeast',
    SE: 'Southeast',
    SW: 'Southwest',
    NW: 'Northwest',
  };

  const descriptions = result.variants.map((v) => {
    const parts: string[] = [];
    if (v.direction) {
      parts.push(dirMap[v.direction.toUpperCase()] ?? v.direction);
    }

    const verb = v.primaryVerb
      ? v.primaryVerb.charAt(0).toUpperCase() + v.primaryVerb.slice(1)
      : null;

    if (v.option && v.option !== v.direction) {
      const opt = v.option.charAt(0).toUpperCase() + v.option.slice(1).toLowerCase();
      parts.push(opt);
    } else if (verb) {
      parts.push(verb);
    }

    return parts.length > 0 ? parts.join(', ') : `Option ${v.index + 1}`;
  });

  let optionsString: string;
  if (descriptions.length === 2) {
    optionsString = `${descriptions[0]}; or ${descriptions[1]}`;
  } else if (descriptions.length > 2) {
    const allButLast = descriptions.slice(0, -1).join('; ');
    optionsString = `${allButLast}; or ${descriptions[descriptions.length - 1]}`;
  } else {
    optionsString = descriptions[0] ?? '';
  }

  return `Multiple options for ${bookTitle} ${result.paddedNumber}: ${optionsString}. Which one?`;
}

export function formatBranchChoicesPrompt(
  choices: ParsedBranchChoice[],
  isSequential: boolean = false,
  activeStep: number = 0
): string {
  if (!choices || choices.length === 0) return '';
  if (isSequential) {
    const isFinal = activeStep >= choices.length - 1;
    return `Say "Continue" to read the ${isFinal ? 'final' : 'next'} result, or say "Done" to stop.`;
  }
  const parts = choices.map((c) => `Option ${c.index + 1}: ${c.summary.replace(/[.!?]+$/, '')}.`);
  return `${parts.join(' ')} Which do you choose?`;
}
