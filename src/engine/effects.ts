/**
 * The single write path from content data into game state.
 *
 * Content declares `Effect`s; only this module knows how each kind mutates the
 * world, so clamping and log side effects stay in one place.
 */

import type { Effect, EffectCtx, LogEntry } from '@/types';

/** Clamps a stat into 0..100 and rounds it to one decimal place. */
export function clampStat(n: number): number {
  throw new Error('TODO:effects.clampStat');
}

/** Applies every effect in order and returns the log entries they produced. */
export function applyEffects(ctx: EffectCtx, effects: Effect[]): LogEntry[] {
  throw new Error('TODO:effects.applyEffects');
}
