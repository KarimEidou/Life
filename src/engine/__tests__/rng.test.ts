import { describe, expect, it } from 'vitest';

import type { Rng } from '@/types';
import { createRng, initialRngState } from '@/engine/rng';

/** Fresh cursor + generator for a seed. */
function make(seed: number): { container: { rngState: number }; rng: Rng } {
  const container = { rngState: initialRngState(seed) };
  return { container, rng: createRng(container) };
}

/** `n` consecutive floats from a fresh generator. */
function sequence(seed: number, n: number): number[] {
  const { rng } = make(seed);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(rng.next());
  return out;
}

/** Cursor value after `use` has run against a fresh generator; reveals draw counts. */
function cursorAfter(use: (rng: Rng) => void): number {
  const { container, rng } = make(99);
  use(rng);
  return container.rngState;
}

describe('initialRngState', () => {
  it('scrambles the seed so seed 0 is still a usable cursor', () => {
    expect(initialRngState(0)).toBe(0x9e3779b9);
    expect(initialRngState(0)).not.toBe(0);
  });

  it('always yields an unsigned 32-bit integer', () => {
    for (const seed of [0, 1, -1, 2 ** 31, 4294967295, -123456789, 1.9]) {
      const s = initialRngState(seed);
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('is stable and maps different seeds to different cursors', () => {
    expect(initialRngState(1234)).toBe(initialRngState(1234));
    expect(initialRngState(1234)).not.toBe(initialRngState(1235));
  });
});

describe('createRng determinism', () => {
  it('reproduces an identical 10k-draw sequence for the same seed', () => {
    const a = sequence(20260818, 10000);
    const b = sequence(20260818, 10000);
    expect(a).toEqual(b);
    expect(a).toHaveLength(10000);
  });

  it('produces a different sequence for a different seed', () => {
    expect(sequence(1, 200)).not.toEqual(sequence(2, 200));
  });

  it('keeps every draw inside [0, 1)', () => {
    for (const v of sequence(7, 5000)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('does not stall on the zero seed', () => {
    const values = sequence(0, 200);
    expect(new Set(values).size).toBeGreaterThan(190);
  });

  it('continues identically after a JSON round trip mid-sequence', () => {
    const { container, rng } = make(31337);
    for (let i = 0; i < 500; i++) rng.next();

    const restored = JSON.parse(JSON.stringify({ rngState: container.rngState })) as {
      rngState: number;
    };
    expect(restored.rngState).toBe(container.rngState);

    const resumed = createRng(restored);
    const original: number[] = [];
    const reloaded: number[] = [];
    for (let i = 0; i < 500; i++) {
      original.push(rng.next());
      reloaded.push(resumed.next());
    }
    expect(reloaded).toEqual(original);
    expect(restored.rngState).toBe(container.rngState);
  });

  it('advances the cursor on every method call', () => {
    const { container, rng } = make(5);
    let cursor = container.rngState;
    const calls: (() => void)[] = [
      () => rng.next(),
      () => rng.int(1, 6),
      () => rng.pick([1, 2, 3]),
      () => rng.chance(0.5),
      () => rng.weighted([1, 2], () => 1),
      () => rng.normal(0, 1),
    ];
    for (const call of calls) {
      call();
      expect(container.rngState).not.toBe(cursor);
      cursor = container.rngState;
    }
  });

  it('spends exactly one draw per call, and two for normal()', () => {
    const one = cursorAfter((r) => r.next());
    const two = cursorAfter((r) => {
      r.next();
      r.next();
    });

    expect(cursorAfter((r) => r.int(1, 6))).toBe(one);
    expect(cursorAfter((r) => r.int(5, 5))).toBe(one);
    expect(cursorAfter((r) => r.pick(['a', 'b']))).toBe(one);
    expect(cursorAfter((r) => r.chance(0.5))).toBe(one);
    expect(cursorAfter((r) => r.chance(0))).toBe(one);
    expect(cursorAfter((r) => r.chance(1))).toBe(one);
    expect(cursorAfter((r) => r.weighted([1, 2, 3], (n) => n))).toBe(one);
    expect(cursorAfter((r) => r.normal(0, 1))).toBe(two);
  });
});

describe('int', () => {
  it('hits both inclusive bounds and never escapes the range', () => {
    const { rng } = make(11);
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const v = rng.int(1, 6);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
      seen.add(v);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('handles negative ranges and single-value ranges', () => {
    const { rng } = make(12);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(rng.int(-2, 2));
    expect([...seen].sort((a, b) => a - b)).toEqual([-2, -1, 0, 1, 2]);
    expect(rng.int(4, 4)).toBe(4);
  });
});

describe('chance', () => {
  it('fires about half the time at p = 0.5 over 10k rolls', () => {
    const { rng } = make(2024);
    let hits = 0;
    for (let i = 0; i < 10000; i++) if (rng.chance(0.5)) hits++;
    expect(hits / 10000).toBeGreaterThan(0.45);
    expect(hits / 10000).toBeLessThan(0.55);
  });

  it('treats p <= 0 as never and p >= 1 as always', () => {
    const { rng } = make(3);
    for (let i = 0; i < 200; i++) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(-1)).toBe(false);
      expect(rng.chance(1)).toBe(true);
      expect(rng.chance(2)).toBe(true);
    }
  });
});

describe('pick', () => {
  it('returns members of the array and reaches every element', () => {
    const { rng } = make(88);
    const arr = ['a', 'b', 'c', 'd'] as const;
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const v = rng.pick(arr);
      expect(arr).toContain(v);
      seen.add(v);
    }
    expect(seen.size).toBe(4);
  });

  it('throws on an empty array without touching the cursor', () => {
    const { container, rng } = make(4);
    const before = container.rngState;
    expect(() => rng.pick([])).toThrow();
    expect(container.rngState).toBe(before);
  });
});

describe('weighted', () => {
  it('never selects zero- or negative-weight items', () => {
    const { rng } = make(55);
    const items = ['zero', 'negative', 'only'] as const;
    const weight = (t: string): number => (t === 'only' ? 5 : t === 'negative' ? -3 : 0);
    for (let i = 0; i < 500; i++) expect(rng.weighted(items, weight)).toBe('only');
  });

  it('selects roughly in proportion to the weights', () => {
    const { rng } = make(56);
    const counts: Record<string, number> = { light: 0, heavy: 0 };
    for (let i = 0; i < 10000; i++) {
      const pickTarget = rng.weighted(['light', 'heavy'], (t) => (t === 'heavy' ? 3 : 1));
      counts[pickTarget] = (counts[pickTarget] ?? 0) + 1;
    }
    expect((counts.heavy ?? 0) / 10000).toBeGreaterThan(0.7);
    expect((counts.heavy ?? 0) / 10000).toBeLessThan(0.8);
  });

  it('throws when nothing has a positive weight, leaving the cursor untouched', () => {
    const { container, rng } = make(57);
    const before = container.rngState;
    expect(() => rng.weighted([1, 2, 3], () => 0)).toThrow(/positive weight/);
    expect(() => rng.weighted([], () => 1)).toThrow(/positive weight/);
    expect(container.rngState).toBe(before);
  });
});

describe('normal', () => {
  it('is reproducible for a seed and centred on the requested mean', () => {
    const first = make(4321).rng;
    const second = make(4321).rng;
    const samples: number[] = [];
    for (let i = 0; i < 20000; i++) {
      const v = first.normal(10, 2);
      expect(second.normal(10, 2)).toBe(v);
      samples.push(v);
    }
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const variance =
      samples.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (samples.length - 1);
    expect(mean).toBeGreaterThan(9.9);
    expect(mean).toBeLessThan(10.1);
    expect(Math.sqrt(variance)).toBeGreaterThan(1.9);
    expect(Math.sqrt(variance)).toBeLessThan(2.1);
    expect(samples.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('returns the mean exactly when sd is 0, still spending two draws', () => {
    const { container, rng } = make(6);
    const before = container.rngState;
    expect(rng.normal(7, 0)).toBe(7);
    expect(container.rngState).not.toBe(before);
  });
});
