/**
 * The year loop: the one place a life advances in time.
 */

import type { ContentRegistry, GameState, YearLog } from '@/types';

/** Returns the log for the current age/year, appending a fresh one when missing. */
export function currentYearLog(state: GameState): YearLog {
  throw new Error('TODO:ageUp.currentYearLog');
}

/**
 * Advances one year. Throws unless `phase === 'alive'`.
 * Phases run in this fixed order: aging, health, education, relationships,
 * career, finance, events, deathCheck. Any phase may kill the character or
 * queue pending choices, which halts the remaining phases for the year.
 */
export function ageUp(state: GameState, reg: ContentRegistry): void {
  throw new Error('TODO:ageUp.ageUp');
}

/**
 * Resolves the first pending event with the chosen option: rolls a weighted
 * outcome, applies its effects, appends the entries and pops the queue. The
 * phase returns to `alive` once the queue empties and the character lives.
 */
export function resolveChoice(
  state: GameState,
  reg: ContentRegistry,
  choiceIndex: number
): void {
  throw new Error('TODO:ageUp.resolveChoice');
}
