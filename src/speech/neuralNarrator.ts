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
  private compressorNode: DynamicsCompressorNode | null = null;
  private masterGainNode: GainNode | null = null;
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

  private getAudioChain(ctx: AudioContext): AudioNode {
    if (!this.compressorNode || (this.compressorNode as unknown as { context?: AudioContext }).context !== ctx) {
      try {
        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -20;
        compressor.knee.value = 20;
        compressor.ratio.value = 8;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.25;

        const gain = ctx.createGain();
        gain.gain.value = 1.0;

        compressor.connect(gain);
        gain.connect(ctx.destination);

        this.compressorNode = compressor;
        this.masterGainNode = gain;
      } catch {
        return ctx.destination;
      }
    }
    return this.compressorNode ?? ctx.destination;
  }

  private play(ctx: AudioContext, audio: GeneratedSpeech): Promise<void> {
    return new Promise((resolve) => {
      const samples = new Float32Array(audio.samples);
      let peak = 0;
      for (let i = 0; i < samples.length; i++) {
        const abs = Math.abs(samples[i]);
        if (abs > peak) peak = abs;
      }
      // Normalize chunk volume so every reading (especially options & short prompts) has consistent loudness
      if (peak > 0.005) {
        const targetPeak = 0.92;
        const gain = Math.min(targetPeak / peak, 5.0);
        if (Math.abs(gain - 1.0) > 0.01) {
          for (let i = 0; i < samples.length; i++) {
            samples[i] *= gain;
          }
        }
      }

      const buffer = ctx.createBuffer(1, samples.length, audio.sampleRate);
      buffer.copyToChannel(samples, 0);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const target = this.getAudioChain(ctx);
      source.connect(target);
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
