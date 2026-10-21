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

  // Normalize whitespace
  text = text.replace(/\s+/g, ' ').trim();

  // Normalize spaces before punctuation
  text = text.replace(/\s+([.,;:!?])/g, '$1');

  return text;
}

export function formatActionPromptForSpeech(
  variant: StoryEntryVariant,
  _prefix?: BookPrefix
): string {
  const plain = variant.actionPlain.trim();
  if (!plain) {
    return 'Perform the action for this location.';
  }

  // Remove trailing period/punctuation for prompt building
  const stripped = plain.replace(/[.]+$/, '').trim();

  if (variant.cost !== null && variant.cost > 0) {
    const dieWord = variant.cost === 1 ? 'die' : 'dice';
    // Lowercase the first word when following "to"
    const words = stripped.split(/\s+/);
    words[0] = words[0].toLowerCase();
    const cleanAction = words.join(' ');
    return `Roll ${variant.cost} ${dieWord} to ${cleanAction}.`;
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
      html: rawBody.trim(),
      speechText: cleanSpeech,
    });
    index++;
  }

  const mainHtml = resultHtml.replace(/<details[^>]*>[\s\S]*?<\/details>/gi, '').trim();
  const mainSpeechText = htmlToSpeechText(mainHtml);

  return {
    mainHtml,
    mainSpeechText,
    hasChoices: choices.length > 0,
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

export function formatBranchChoicesPrompt(choices: ParsedBranchChoice[]): string {
  if (!choices || choices.length === 0) return '';
  const parts = choices.map((c) => `Option ${c.index + 1}: ${c.summary}.`);
  return `${parts.join(' ')} Which do you choose?`;
}
