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
  const seen = new Set<string>(already);
  const unlocked: string[] = [];

  for (const def of reg.achievements) {
    if (seen.has(def.id)) continue;
    let hit = false;
    try {
      // A check that throws on an unusual state must not break the whole sweep.
      hit = def.check(state) === true;
    } catch {
      hit = false;
    }
    if (!hit) continue;
    // Added to `seen` as well, so a duplicated definition unlocks only once.
    seen.add(def.id);
    unlocked.push(def.id);
  }

  return unlocked;
}
