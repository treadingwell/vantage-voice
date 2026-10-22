import type { SherpaClient } from './sherpa/sherpaClient';
import type { GeneratedSpeech } from './sherpa/sherpaProtocol';

// Very long sentences are split at clause breaks so the first audio starts sooner
const MAX_CHUNK_CHARS = 180;

// Neural voices garble very short inputs: measured with Kroko transcription, Supertonic
// had ~27% word errors on standalone sentences like "Go to two ninety two." versus ~6%
// once each was joined to a neighbouring sentence. Chunks shorter than this are merged.
const MIN_CHUNK_WORDS = 7;

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

/**
 * Splits narration into chunks that are synthesized one at a time, which keeps first-audio
 * latency low and gives a controllable pause between chunks. Short sentences are merged
 * into a neighbour so every chunk gives the voice enough context.
 */
export function splitIntoSentences(text: string): string[] {
  const chunks = splitRaw(text);
  const merged: string[] = [];
  let carry = '';
  for (const chunk of chunks) {
    const combined = carry ? `${carry} ${chunk}` : chunk;
    if (wordCount(combined) < MIN_CHUNK_WORDS) {
      carry = combined;
    } else {
      merged.push(combined);
      carry = '';
    }
  }
  // A short tail joins the previous chunk
  if (carry) {
    if (merged.length > 0) merged[merged.length - 1] = `${merged[merged.length - 1]} ${carry}`;
    else merged.push(carry);
  }
  return merged;
}

function splitRaw(text: string): string[] {
  const sentences = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?…])["”')\]]*\s+(?=["“'(\[]?[A-Z0-9$])/)
    .map((s) => s.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length <= MAX_CHUNK_CHARS) {
      chunks.push(sentence);
      continue;
    }
    let current = '';
    for (const part of sentence.split(/(?<=[;:,])\s+/)) {
      if (current && current.length + part.length + 1 > MAX_CHUNK_CHARS) {
        chunks.push(current);
        current = part;
      } else {
        current = current ? `${current} ${part}` : part;
      }
    }
    if (current) chunks.push(current);
  }
  return chunks;
}

// Loudness levelling: Kitten and Supertonic come out at different volumes, and so do
// short prompts vs long results. Measured on speech only (silence would drag RMS down).
const SPEECH_FLOOR = 0.01;
const TARGET_SPEECH_RMS = 0.12;
const MAX_GAIN = 2.5;
const MAX_PEAK = 0.92;

/** Returns a copy of `samples` scaled to a common speech loudness, without clipping. */
export function normalizeSpeechLoudness(samples: Float32Array): Float32Array<ArrayBuffer> {
  const out = new Float32Array(samples);
  let sumSq = 0;
  let speechSamples = 0;
  let peak = 0;
  for (const v of out) {
    const abs = Math.abs(v);
    if (abs > peak) peak = abs;
    if (abs > SPEECH_FLOOR) {
      sumSq += abs * abs;
      speechSamples++;
    }
  }
  const speechRms = speechSamples > 0 ? Math.sqrt(sumSq / speechSamples) : 0;
  if (speechRms <= 0.005) return out;

  let gain = Math.min(TARGET_SPEECH_RMS / speechRms, MAX_GAIN);
  if (peak * gain > MAX_PEAK) gain = MAX_PEAK / peak;
  if (Math.abs(gain - 1) > 0.01) {
    for (let i = 0; i < out.length; i++) out[i] *= gain;
  }
  return out;
}

export interface NarrateOptions {
  sid: number;
  speed: number;
  /** Extra silence inserted between sentences */
  sentencePauseMs: number;
  onStart?: () => void;
}

/**
 * Plays text through a sherpa TTS model, generating the next sentence while the current
 * one plays. stop() cuts playback and makes the pending narrate() resolve.
 */
export class NeuralNarrator {
  private client: SherpaClient;
  private getAudioContext: () => AudioContext | null;
  private generation = 0;
  private activeSource: AudioBufferSourceNode | null = null;
  private wake: (() => void) | null = null;

  constructor(client: SherpaClient, getAudioContext: () => AudioContext | null) {
    this.client = client;
    this.getAudioContext = getAudioContext;
  }

  public async narrate(text: string, options: NarrateOptions): Promise<void> {
    this.stop();
    const token = ++this.generation;
    const ctx = this.getAudioContext();
    if (!ctx) throw new Error('Audio output is not available');
    if (ctx.state === 'suspended') await ctx.resume();

    const chunks = splitIntoSentences(text);
    if (chunks.length === 0) return;

    let pending = this.client.generate(chunks[0], options.sid, options.speed);
    let started = false;

    for (let i = 0; i < chunks.length; i++) {
      const audio = await pending;
      if (token !== this.generation) return;
      if (i + 1 < chunks.length) {
        pending = this.client.generate(chunks[i + 1], options.sid, options.speed);
        // Avoid an unhandled rejection if we stop before awaiting it
        pending.catch(() => {});
      }

      if (!started) {
        started = true;
        options.onStart?.();
      }
      await this.play(ctx, audio);
      if (token !== this.generation) return;

      if (i + 1 < chunks.length && options.sentencePauseMs > 0) {
        await this.sleep(options.sentencePauseMs);
        if (token !== this.generation) return;
      }
    }
  }

  public stop(): void {
    this.generation++;
    if (this.activeSource) {
      try {
        this.activeSource.stop();
      } catch {
        // already stopped
      }
      this.activeSource = null;
    }
    this.wake?.();
    this.wake = null;
  }

  private play(ctx: AudioContext, audio: GeneratedSpeech): Promise<void> {
    return new Promise((resolve) => {
      const samples = normalizeSpeechLoudness(audio.samples);
      const buffer = ctx.createBuffer(1, samples.length, audio.sampleRate);
      buffer.copyToChannel(samples, 0);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      const done = () => {
        if (this.activeSource === source) this.activeSource = null;
        if (this.wake === done) this.wake = null;
        resolve();
      };
      source.onended = done;
      this.activeSource = source;
      this.wake = done;
      source.start();
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      const self = this;
      function done() {
        clearTimeout(timer);
        if (self.wake === done) self.wake = null;
        resolve();
      }
      this.wake = done;
    });
  }
}
