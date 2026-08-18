/**
 * Death check: the last phase of every year.
 */

import type { Ctx, LogEntry } from '@/types';

/** Per-year probability of dying, from age, health, illnesses and addictions. */
export function deathProbability(ctx: Ctx): number {
  throw new Error('TODO:deathCheck.deathProbability');
}

/** Rolls against `deathProbability` and kills the character when it hits. */
export function deathCheckPhase(ctx: Ctx): LogEntry[] {
  throw new Error('TODO:deathCheck.deathCheckPhase');
}
