export type BookPrefix = 'm' | 'l' | 'e' | 'h' | 't' | 'o' | 'd' | 's';

export type BookName =
  | 'move'
  | 'look'
  | 'engage'
  | 'help'
  | 'take'
  | 'overpower'
  | 'depart'
  | 'secret';

export interface BookMeta {
  prefix: BookPrefix;
  name: BookName;
  label: string;
  color: string;
  iconId: string;
  keyIconId: string;
}

export const BOOKS: BookMeta[] = [
  { prefix: 'm', name: 'move', label: 'Move', color: '#2563eb', iconId: 'i-move', keyIconId: 'key-move' },
  { prefix: 'l', name: 'look', label: 'Look', color: '#8b5cf6', iconId: 'i-look', keyIconId: 'key-look' },
  { prefix: 'e', name: 'engage', label: 'Engage', color: '#10b981', iconId: 'i-engage', keyIconId: 'key-engage' },
  { prefix: 'h', name: 'help', label: 'Help', color: '#f97316', iconId: 'i-help', keyIconId: 'key-help' },
  { prefix: 't', name: 'take', label: 'Take', color: '#eab308', iconId: 'i-take', keyIconId: 'key-take' },
  { prefix: 'o', name: 'overpower', label: 'Overpower', color: '#ef4444', iconId: 'i-overpower', keyIconId: 'key-overpower' },
  { prefix: 'd', name: 'depart', label: 'Depart', color: '#1e3a8a', iconId: 'i-depart', keyIconId: 'key-depart' },
  { prefix: 's', name: 'secret', label: 'Book of Secrets', color: '#64748b', iconId: 'i-secret', keyIconId: 'key-secret' },
];

export const BOOK_BY_PREFIX: Record<BookPrefix, BookMeta> = BOOKS.reduce((acc, book) => {
  acc[book.prefix] = book;
  return acc;
}, {} as Record<BookPrefix, BookMeta>);

export const BOOK_BY_NAME: Record<BookName, BookMeta> = BOOKS.reduce((acc, book) => {
  acc[book.name] = book;
  return acc;
}, {} as Record<BookName, BookMeta>);

export interface StoryRawVariant {
  option?: string;
  direction?: string;
  region?: string;
  cost?: number;
  action?: string;
  result?: string;
  obscure?: boolean;
}

export type StoryRawEntry = StoryRawVariant | StoryRawVariant[];

export interface StoryEntryVariant {
  index: number;
  option: string | null;
  direction: string | null;
  region: string | null;
  cost: number | null;
  actionHtml: string;
  actionPlain: string;
  primaryVerb: string | null;
  allVerbs: string[];
  resultHtml: string;
  obscure: boolean;
}

export interface StoryLookupResult {
  key: string;
  prefix: BookPrefix;
  bookName: BookName;
  number: number;
  paddedNumber: string;
  variants: StoryEntryVariant[];
}

export interface CandidateMatch {
  result: StoryLookupResult;
  variantIndex: number;
  label: string;
}

export interface ParsedBranchChoice {
  index: number;
  summary: string;
  html: string;
  speechText: string;
}

export interface ParsedResultContent {
  mainHtml: string;
  mainSpeechText: string;
  hasChoices: boolean;
  choices: ParsedBranchChoice[];
}

export type VoiceStateMode =
  | 'IDLE'
  | 'LISTENING_COMMAND'
  | 'DISAMBIGUATING'
  | 'WAITING_FOR_DONE'
  | 'BRANCHING_CHOICE';

export interface LookupIntent {
  type: 'LOOKUP';
  result: StoryLookupResult;
  variantIndex: number | null;
  confidence: number;
  spokenCue?: string;
  number?: number;
}

export interface AmbiguousLookupIntent {
  type: 'AMBIGUOUS_LOOKUP';
  number: number;
  candidates: CandidateMatch[];
  rawTranscript: string;
}

export interface SelectOptionIntent {
  type: 'SELECT_OPTION';
  optionIndex: number;
  optionText?: string;
}

export interface ConfirmDoneIntent {
  type: 'CONFIRM_DONE';
  rawTranscript: string;
}

export interface CancelIntent {
  type: 'CANCEL';
  rawTranscript: string;
}

export interface RepeatIntent {
  type: 'REPEAT';
  rawTranscript: string;
}

export interface UnknownIntent {
  type: 'UNKNOWN';
  rawTranscript: string;
  reason?: string;
}

export type VoiceIntent =
  | LookupIntent
  | AmbiguousLookupIntent
  | SelectOptionIntent
  | ConfirmDoneIntent
  | CancelIntent
  | RepeatIntent
  | UnknownIntent;
