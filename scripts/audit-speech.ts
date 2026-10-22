// Runs every story entry through the speech formatter and reports text that is likely to
// trip up a TTS voice: missing punctuation, leftover
// symbols, ALL-CAPS words (often spelled out letter by letter), zero-padded numbers, etc.
//
// Usage: npx vite-node scripts/audit-speech.ts [--examples N]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { StoryDatabase } from '../src/data/storyDb';
import { formatActionPromptForSpeech, normalizeForSpeech, parseAndFormatResult } from '../src/speech/ttsFormatter';

const examplesArg = process.argv.indexOf('--examples');
const MAX_EXAMPLES = examplesArg > -1 ? Number(process.argv[examplesArg + 1]) : 4;

const raw = JSON.parse(readFileSync(join(__dirname, '../public/data/stories.json'), 'utf8'));
const db = new StoryDatabase(raw);

interface SpokenText {
  where: string;
  text: string;
}

const texts: SpokenText[] = [];
for (const key of Object.keys(raw)) {
  const entry = db.getByKey(key);
  if (!entry) continue;
  for (const v of entry.variants) {
    const where = `${key}#${v.index}`;
    texts.push({ where: `${where} prompt`, text: formatActionPromptForSpeech(v, entry.prefix) });
    const parsed = parseAndFormatResult(v.resultHtml);
    if (parsed.mainSpeechText) texts.push({ where: `${where} result`, text: parsed.mainSpeechText });
    for (const c of parsed.choices) {
      texts.push({ where: `${where} choice${c.index + 1} summary`, text: c.summary });
      if (c.speechText) texts.push({ where: `${where} choice${c.index + 1} body`, text: c.speechText });
    }
  }
}

// Audit what the narrator actually receives
for (const t of texts) t.text = normalizeForSpeech(t.text);

const checks: { name: string; test: (t: string) => RegExpMatchArray | null }[] = [
  { name: 'missing final punctuation', test: (t) => (/[.!?:"')]$/.test(t) ? null : t.match(/.{0,40}$/)) },
  { name: 'ALL-CAPS word', test: (t) => t.match(/.{0,25}\b[A-Z]{2,}\b.{0,25}/) },
  { name: 'zero-padded number', test: (t) => t.match(/.{0,25}\b0\d+\b.{0,15}/) },
  { name: 'leftover symbol', test: (t) => t.match(/.{0,25}[<>#*@%+=_\[\]{}|~^\\/$].{0,25}/) },
  { name: 'digits', test: (t) => t.match(/.{0,20}\d.{0,20}/) },
  { name: 'abbreviation with period', test: (t) => t.match(/.{0,20}\b(?:e\.g|i\.e|etc|vs|approx|No)\.\s.{0,20}/) },
  { name: 'empty or very short', test: (t) => (t.trim().length < 3 ? ['(empty)'] as unknown as RegExpMatchArray : null) },
];

console.log(`Audited ${texts.length} spoken texts from ${Object.keys(raw).length} entries\n`);
for (const check of checks) {
  const hits = texts.map((t) => ({ t, m: check.test(t.text) })).filter((h) => h.m);
  console.log(`${check.name}: ${hits.length}`);
  for (const h of hits.slice(0, MAX_EXAMPLES)) {
    console.log(`   ${h.t.where.padEnd(28)} …${h.m![0].trim()}…`);
  }
}
