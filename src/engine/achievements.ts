/**
 * Achievement evaluation. Unlocks are global (cross-life), so the caller owns
 * the persisted id list and passes it in.
 */

import type { ContentRegistry, GameState } from '@/types';

/** Runs every achievement check and returns only the ids not already in `already`. */
export function evaluateAchievements(
  state: GameState,
  reg: ContentRegistry,
  already: readonly string[]
): string[] {
  throw new Error('TODO:achievements.evaluateAchievements');
}
