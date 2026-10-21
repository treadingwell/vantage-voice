import {
  BookName,
  BookPrefix,
  BOOKS,
  BOOK_BY_NAME,
  BOOK_BY_PREFIX,
  CandidateMatch,
  StoryEntryVariant,
  StoryLookupResult,
  StoryRawEntry,
  StoryRawVariant,
} from './types';

export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const row = Array.from({ length: a.length + 1 }, (_, i) => i);

  for (let i = 1; i <= b.length; i++) {
    let prev = i;
    for (let j = 1; j <= a.length; j++) {
      const val = b.charAt(i - 1) === a.charAt(j - 1)
        ? row[j - 1]
        : Math.min(row[j - 1] + 1, prev + 1, row[j] + 1);
      row[j - 1] = prev;
      prev = val;
    }
    row[a.length] = prev;
  }

  return row[a.length];
}

export function stringSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const dist = levenshteinDistance(a.toLowerCase(), b.toLowerCase());
  return 1 - dist / maxLen;
}

function stripHtml(html: string): string {
  return html
    .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractVerbsFromAction(actionHtml: string): { primary: string | null; all: string[] } {
  if (!actionHtml) return { primary: null, all: [] };
  const matches = [...actionHtml.matchAll(/<span[^>]*>([^<]+)<\/span>/gi)];
  if (matches.length === 0) return { primary: null, all: [] };

  const verbs = matches
    .map((m) => m[1].trim().toLowerCase())
    .filter((v) => v.length > 0);

  return {
    primary: verbs[0] ?? null,
    all: verbs,
  };
}

const DIRECTION_SYNONYMS: Record<string, string> = {
  n: 'N',
  north: 'N',
  e: 'E',
  east: 'E',
  s: 'S',
  south: 'S',
  w: 'W',
  west: 'W',
  ne: 'NE',
  northeast: 'NE',
  se: 'SE',
  southeast: 'SE',
  sw: 'SW',
  southwest: 'SW',
  nw: 'NW',
  northwest: 'NW',
};

const NOISE_WORDS = new Set([
  'on',
  'at',
  'in',
  'the',
  'to',
  'for',
  'card',
  'location',
  'number',
  'please',
  'go',
  'a',
  'an',
]);

export class StoryDatabase {
  private byKey = new Map<string, StoryLookupResult>();
  private byNumber = new Map<number, StoryLookupResult[]>();
  private allVocabulary = new Set<string>();

  constructor(rawJson: Record<string, StoryRawEntry>) {
    this.parseAndIndex(rawJson);
  }

  public static async loadFromUrl(url: string = '/data/stories.json'): Promise<StoryDatabase> {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to load stories from ${url}: ${res.statusText}`);
    }
    const rawJson = (await res.json()) as Record<string, StoryRawEntry>;
    return new StoryDatabase(rawJson);
  }

  private parseAndIndex(rawJson: Record<string, StoryRawEntry>): void {
    for (const [rawKey, rawValue] of Object.entries(rawJson)) {
      const match = rawKey.match(/^([mlehtods])(\d+)$/i);
      if (!match) continue;

      const prefix = match[1].toLowerCase() as BookPrefix;
      const num = parseInt(match[2], 10);
      const meta = BOOK_BY_PREFIX[prefix];
      if (!meta) continue;

      const key = `${prefix}${num}`;
      const paddedNumber = num < 1000 ? String(num).padStart(3, '0') : String(num);

      const rawVariants: StoryRawVariant[] = Array.isArray(rawValue) ? rawValue : [rawValue];
      const variants: StoryEntryVariant[] = rawVariants.map((raw, index) => {
        const actionHtml = raw.action ?? '';
        const actionPlain = stripHtml(actionHtml);
        const { primary, all } = extractVerbsFromAction(actionHtml);

        for (const v of all) {
          this.allVocabulary.add(v);
        }
        if (raw.option) {
          this.allVocabulary.add(raw.option.toLowerCase().trim());
        }

        return {
          index,
          option: raw.option ?? null,
          direction: raw.direction ?? null,
          region: raw.region ?? null,
          cost: raw.cost !== undefined ? raw.cost : null,
          actionHtml,
          actionPlain,
          primaryVerb: primary,
          allVerbs: all,
          resultHtml: raw.result ?? '',
          obscure: raw.obscure !== undefined ? raw.obscure : true,
        };
      });

      const entry: StoryLookupResult = {
        key,
        prefix,
        bookName: meta.name,
        number: num,
        paddedNumber,
        variants,
      };

      this.byKey.set(key, entry);

      const existingForNum = this.byNumber.get(num) ?? [];
      existingForNum.push(entry);
      this.byNumber.set(num, existingForNum);
    }
  }

  public getByKey(key: string): StoryLookupResult | null {
    if (!key) return null;
    return this.byKey.get(key.toLowerCase().trim()) ?? null;
  }

  public getByBookAndNumber(prefixOrBook: string, num: number | string): StoryLookupResult | null {
    if (!prefixOrBook || num === undefined || num === null) return null;
    const cleanNum = typeof num === 'string' ? parseInt(num, 10) : num;
    if (isNaN(cleanNum)) return null;

    const cleanInput = prefixOrBook.toLowerCase().trim();
    let prefix: BookPrefix | null = null;

    if (BOOK_BY_PREFIX[cleanInput as BookPrefix]) {
      prefix = cleanInput as BookPrefix;
    } else if (BOOK_BY_NAME[cleanInput as BookName]) {
      prefix = BOOK_BY_NAME[cleanInput as BookName].prefix;
    } else if (cleanInput === 'secrets' || cleanInput === 'book of secrets') {
      prefix = 's';
    }

    if (!prefix) return null;
    return this.getByKey(`${prefix}${cleanNum}`);
  }

  public getEntriesForNumber(num: number | string): StoryLookupResult[] {
    if (num === undefined || num === null) return [];
    const cleanNum = typeof num === 'string' ? parseInt(num, 10) : num;
    if (isNaN(cleanNum)) return [];
    return this.byNumber.get(cleanNum) ?? [];
  }

  public findBySpokenCueAndNumber(
    cueText: string,
    num: number | string
  ): {
    result: StoryLookupResult;
    variantIndex: number | null;
    confidence: number;
    candidates?: CandidateMatch[];
  } | null {
    const entries = this.getEntriesForNumber(num);
    if (!entries || entries.length === 0) return null;

    const rawTokens = cueText
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 0);

    const tokens = rawTokens.filter((w) => !NOISE_WORDS.has(w));

    // If no cue text provided, return candidates across all entries for this number
    if (tokens.length === 0) {
      const candidates: CandidateMatch[] = [];
      for (const entry of entries) {
        for (const v of entry.variants) {
          candidates.push({
            result: entry,
            variantIndex: v.index,
            label: this.formatVariantLabel(entry, v),
          });
        }
      }
      return {
        result: entries[0],
        variantIndex: null,
        confidence: 0.5,
        candidates,
      };
    }

    // Score each (entry, variant)
    interface ScoredVariant {
      entry: StoryLookupResult;
      variant: StoryEntryVariant;
      score: number;
      hasVerbMatch: boolean;
      hasOptionMatch: boolean;
      hasDirectionMatch: boolean;
      hasBookMatch: boolean;
    }

    const scored: ScoredVariant[] = [];

    for (const entry of entries) {
      for (const variant of entry.variants) {
        let score = 0;
        let hasVerbMatch = false;
        let hasOptionMatch = false;
        let hasDirectionMatch = false;
        let hasBookMatch = false;

        for (const token of tokens) {
          // 1. Check book name / prefix
          if (token === entry.prefix || token === entry.bookName) {
            score += 50;
            hasBookMatch = true;
          } else if (token === 'secret' && entry.prefix === 's') {
            score += 50;
            hasBookMatch = true;
          } else {
            const bookSim = stringSimilarity(token, entry.bookName);
            if (bookSim >= 0.8) {
              score += 40 * bookSim;
              hasBookMatch = true;
            }
          }

          // 2. Check direction
          const dirCode = DIRECTION_SYNONYMS[token];
          if (dirCode && variant.direction && variant.direction.toUpperCase() === dirCode) {
            score += 90;
            hasDirectionMatch = true;
          }

          // 3. Check option (e.g., 'dive', 'evade', 'surface')
          if (variant.option) {
            const optLower = variant.option.toLowerCase();
            if (optLower === token) {
              score += 100;
              hasOptionMatch = true;
            } else {
              const optSim = stringSimilarity(token, optLower);
              if (optSim >= 0.75) {
                score += 80 * optSim;
                hasOptionMatch = true;
              }
            }
          }

          // 4. Check action verbs
          for (const verb of variant.allVerbs) {
            if (token === verb) {
              score += 100;
              hasVerbMatch = true;
            } else if (
              (token.length >= 4 && token.startsWith(verb)) ||
              (verb.length >= 4 && verb.startsWith(token))
            ) {
              // Tolerates stemming variations like stunning -> stun, scaling -> scale
              score += 90;
              hasVerbMatch = true;
            } else {
              const sim = stringSimilarity(token, verb);
              if (sim >= 0.75) {
                score += 80 * sim;
                hasVerbMatch = true;
              }
            }
          }
        }

        if (score > 0) {
          scored.push({
            entry,
            variant,
            score,
            hasVerbMatch,
            hasOptionMatch,
            hasDirectionMatch,
            hasBookMatch,
          });
        }
      }
    }

    if (scored.length === 0) {
      // No match found among entries
      return null;
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    const best = scored[0];
    const topScore = best.score;
    const topMatches = scored.filter((s) => s.score >= topScore * 0.9);

    // If the matched book has multiple variants and the cue only matched the book name
    // (i.e. did not specify direction, option, or verb), we should return variantIndex: null
    // so caller disambiguates between variants!
    if (best.hasBookMatch && !best.hasVerbMatch && !best.hasOptionMatch && !best.hasDirectionMatch) {
      if (best.entry.variants.length > 1) {
        const candidates: CandidateMatch[] = best.entry.variants.map((v) => ({
          result: best.entry,
          variantIndex: v.index,
          label: this.formatVariantLabel(best.entry, v),
        }));
        return {
          result: best.entry,
          variantIndex: null,
          confidence: 0.9,
          candidates,
        };
      }
    }

    // If there is an ambiguous tie between different books or variants
    if (topMatches.length > 1) {
      const distinctEntries = new Set(topMatches.map((m) => m.entry.key));
      if (distinctEntries.size > 1) {
        const candidates: CandidateMatch[] = topMatches.map((m) => ({
          result: m.entry,
          variantIndex: m.variant.index,
          label: this.formatVariantLabel(m.entry, m.variant),
        }));
        return {
          result: best.entry,
          variantIndex: null,
          confidence: 0.7,
          candidates,
        };
      }
    }

    const confidence = Math.min(1.0, best.score / 100);
    return {
      result: best.entry,
      variantIndex: best.variant.index,
      confidence,
    };
  }

  private formatVariantLabel(entry: StoryLookupResult, variant: StoryEntryVariant): string {
    const bookTitle = entry.bookName.charAt(0).toUpperCase() + entry.bookName.slice(1);
    const parts: string[] = [];

    if (variant.direction) {
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
      parts.push(dirMap[variant.direction.toUpperCase()] ?? variant.direction);
    }

    if (variant.option && variant.option !== variant.direction) {
      parts.push(variant.option);
    } else if (variant.primaryVerb) {
      parts.push(variant.primaryVerb.toUpperCase());
    }

    const detail = parts.length > 0 ? ` (${parts.join(', ')})` : '';
    return `${bookTitle} ${entry.paddedNumber}${detail}`;
  }

  public getAllVocabularyWords(): string[] {
    const vocab = new Set<string>(this.allVocabulary);

    // Book names & variations
    for (const b of BOOKS) {
      vocab.add(b.name);
      vocab.add(b.prefix);
    }
    vocab.add('secret');
    vocab.add('secrets');
    vocab.add('book');

    // Directions
    for (const d of [
      'north', 'south', 'east', 'west',
      'northeast', 'southeast', 'southwest', 'northwest',
      'n', 's', 'e', 'w'
    ]) {
      vocab.add(d);
    }

    // Number words & homophones
    for (const numWord of [
      'zero', 'oh', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
      'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
      'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety',
      'hundred', 'thousand',
      'won', 'too', 'to', 'fore', 'for', 'ate'
    ]) {
      vocab.add(numWord);
    }

    // Control & flow words
    for (const ctrl of [
      'done', 'ready', 'reveal', 'read', 'continue', 'finished', 'okay', 'ok',
      'cancel', 'stop', 'back', 'exit', 'abort',
      'repeat', 'again', 'option', 'choice', 'choose',
      'first', 'second', 'third', 'fourth', 'fifth',
      'on', 'at', 'in', 'the', 'and'
    ]) {
      vocab.add(ctrl);
    }

    return Array.from(vocab).sort();
  }
}
