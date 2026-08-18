/**
 * End of life and the hand-off to the next generation.
 */

import type { ContentRegistry, GameState } from '@/types';

/** Ends the life: records cause, age, obituary and epitaph stats, then sets phase `dead`. */
export function killCharacter(state: GameState, reg: ContentRegistry, cause: string): void {
  throw new Error('TODO:death.killCharacter');
}

/**
 * Starts a new life as the given child: generation + 1, 80% of the estate split
 * among the children as inheritance, and the deceased appended to `ancestors`.
 */
export function startLegacy(
  state: GameState,
  reg: ContentRegistry,
  childId: string
): GameState {
  throw new Error('TODO:death.startLegacy');
}
