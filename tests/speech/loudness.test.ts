import { describe, it, expect } from 'vitest';
import { normalizeSpeechLoudness } from '../../src/speech/neuralNarrator';

/** RMS of samples above the silence floor, the measure the narrator levels to. */
function speechRms(samples: Float32Array): number {
  let sumSq = 0;
  let n = 0;
  for (const v of samples) {
    if (Math.abs(v) > 0.01) {
      sumSq += v * v;
      n++;
    }
  }
  return Math.sqrt(sumSq / n);
}

function tone(amplitude: number, length = 4410): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * 220 * i) / 44100);
  return out;
}

describe('normalizeSpeechLoudness', () => {
  it('brings quiet and loud speech to the same level', () => {
    const quiet = normalizeSpeechLoudness(tone(0.1));
    const loud = normalizeSpeechLoudness(tone(0.3));
    expect(speechRms(quiet)).toBeCloseTo(0.12, 2);
    expect(speechRms(loud)).toBeCloseTo(0.12, 2);
  });

  it('ignores leading and trailing silence when measuring', () => {
    const padded = new Float32Array(20000);
    padded.set(tone(0.1), 8000);
    expect(speechRms(normalizeSpeechLoudness(padded))).toBeCloseTo(0.12, 2);
  });

  it('caps the boost for very quiet audio', () => {
    const out = normalizeSpeechLoudness(tone(0.02));
    const peak = Math.max(...Array.from(out, Math.abs));
    expect(peak).toBeCloseTo(0.02 * 2.5, 2);
  });

  it('never pushes peaks past the clipping guard', () => {
    // Quiet body with one loud spike: the RMS gain alone would clip the spike
    const samples = tone(0.05);
    samples[100] = 0.9;
    const out = normalizeSpeechLoudness(samples);
    expect(Math.max(...Array.from(out, Math.abs))).toBeLessThanOrEqual(0.92 + 1e-6);
  });

  it('leaves silence untouched and never mutates the input', () => {
    const silence = new Float32Array(1000);
    expect(normalizeSpeechLoudness(silence).every((v) => v === 0)).toBe(true);

    const input = tone(0.3);
    const before = input[50];
    normalizeSpeechLoudness(input);
    expect(input[50]).toBe(before);
  });
});
