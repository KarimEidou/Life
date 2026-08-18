/**
 * Seeded pseudo-random source.
 *
 * The cursor lives inside `GameState.rngState`, so every draw must write the
 * advanced value back into the container it was created from — that is what
 * makes a save/load round trip reproduce the exact same run.
 */

import type { Rng } from '@/types';

/** Normalises an arbitrary seed into the 32-bit unsigned cursor mulberry32 expects. */
export function initialRngState(seed: number): number {
  throw new Error('TODO:rng.initialRngState');
}

/** Builds a mulberry32 `Rng` whose every draw advances `container.rngState`. */
export function createRng(container: { rngState: number }): Rng {
  throw new Error('TODO:rng.createRng');
}
