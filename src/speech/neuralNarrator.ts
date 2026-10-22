import type { SherpaClient } from './sherpa/sherpaClient';
import type { GeneratedSpeech } from './sherpa/sherpaProtocol';

// Very long sentences are split at clause breaks so the first audio starts sooner
const MAX_CHUNK_CHARS = 180;

/**
 * Splits narration into sentence-sized chunks. Each chunk is synthesized on its own, which
 * keeps first-audio latency low and gives a clean, controllable pause between sentences.
 */
export function splitIntoSentences(text: string): string[] {
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
      const buffer = ctx.createBuffer(1, audio.samples.length, audio.sampleRate);
      buffer.copyToChannel(audio.samples as Float32Array<ArrayBuffer>, 0);
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
