/**
 * Seeded pseudo-random source.
 *
 * The cursor lives inside `GameState.rngState`, so every draw must write the
 * advanced value back into the container it was created from — that is what
 * makes a save/load round trip reproduce the exact same run.
 */

import type { Rng } from '@/types';

/**
 * Golden ratio in 32-bit fixed point. Xoring the raw seed with it scrambles
 * low-entropy seeds (0, 1, 2, ...) so neighbouring seeds start far apart.
 */
const GOLDEN_RATIO_32 = 0x9e3779b9;

/** mulberry32's per-step increment. */
const MULBERRY_INCREMENT = 0x6d2b79f5;

/** 2^32 — divisor that maps the 32-bit output into [0, 1). */
const UINT32_SPAN = 4294967296;

/** Normalises an arbitrary seed into the 32-bit unsigned cursor mulberry32 expects. */
export function initialRngState(seed: number): number {
  const whole = Number.isFinite(seed) ? Math.trunc(seed) : 0;
  return ((whole >>> 0) ^ GOLDEN_RATIO_32) >>> 0;
}

/**
 * One mulberry32 step: advances `container.rngState` in place and returns a
 * uniform float in [0, 1). The cursor is stored unsigned so it survives a JSON
 * round trip unchanged; a corrupted (NaN) cursor coerces to 0 rather than
 * poisoning the sequence.
 */
function draw(container: { rngState: number }): number {
  const a = (container.rngState + MULBERRY_INCREMENT) | 0;
  container.rngState = a >>> 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / UINT32_SPAN;
}

/**
 * Builds a mulberry32 `Rng` whose every draw advances `container.rngState`.
 *
 * Draw budget per call — callers rely on this for determinism when they replay
 * a sequence: `next`, `int`, `pick`, `chance` and `weighted` consume exactly
 * one draw each (even in degenerate cases such as `chance(0)` or a
 * single-element range), and `normal` consumes exactly two (Box-Muller).
 * `pick` on an empty array and `weighted` with no positive weight throw
 * *before* consuming anything, so a caught error leaves the cursor untouched.
 */
export function createRng(container: { rngState: number }): Rng {
  return {
    next(): number {
      return draw(container);
    },

    int(min: number, max: number): number {
      const lo = Math.ceil(min);
      const hi = Math.floor(max);
      const roll = draw(container);
      const span = hi - lo + 1;
      if (!(span > 1)) return lo;
      // Math.min guards the (unreachable in practice) roll === 1 rounding edge.
      return lo + Math.min(span - 1, Math.floor(roll * span));
    },

    pick<T>(arr: readonly T[]): T {
      if (arr.length === 0) throw new Error('rng.pick: cannot pick from an empty array');
      const roll = draw(container);
      const index = Math.min(arr.length - 1, Math.floor(roll * arr.length));
      return arr[index] as T;
    },

    chance(p: number): boolean {
      const roll = draw(container);
      if (!(p > 0)) return false;
      if (p >= 1) return true;
      return roll < p;
    },

    weighted<T>(items: readonly T[], weight: (t: T) => number): T {
      let total = 0;
      let lastPositive = -1;
      // Zero/negative weights repeat the running total, so no roll can land on them.
      const cumulative: number[] = [];
      for (let i = 0; i < items.length; i++) {
        const w = weight(items[i] as T);
        if (Number.isFinite(w) && w > 0) {
          total += w;
          lastPositive = i;
        }
        cumulative.push(total);
      }
      if (lastPositive < 0) {
        throw new Error('rng.weighted: no item has a positive weight');
      }
      const roll = draw(container) * total;
      for (let i = 0; i < items.length; i++) {
        if (roll < (cumulative[i] as number)) return items[i] as T;
      }
      return items[lastPositive] as T;
    },

    normal(mean: number, sd: number): number {
      // Box-Muller: exactly two draws, always taken in this order.
      const u1 = 1 - draw(container); // shifted off zero so log() stays finite
      const u2 = draw(container);
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      return mean + sd * z;
    },
  };
}
