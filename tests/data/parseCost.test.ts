import { describe, it, expect } from 'vitest';
import { parseCost } from '../../src/data/storyDb';

describe('parseCost', () => {
  it('keeps numeric costs', () => {
    expect(parseCost(4)).toBe(4);
    expect(parseCost(0)).toBe(0);
  });

  it('parses numeric strings (the dataset has one "4")', () => {
    expect(parseCost('4')).toBe(4);
    expect(parseCost(' 3 ')).toBe(3);
  });

  it('normalizes the "any number of dice" marker', () => {
    expect(parseCost('X')).toBe('X');
    expect(parseCost(' x ')).toBe('X');
  });

  it('treats missing or unreadable costs as no cost', () => {
    expect(parseCost(undefined)).toBeNull();
    expect(parseCost(null)).toBeNull();
    expect(parseCost('lots')).toBeNull();
  });
});
