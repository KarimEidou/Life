/**
 * The year log every part of the engine writes narration into.
 *
 * A leaf module by design: it imports `@/types` and nothing else. The helper
 * used to live in `ageUp.ts`, which made every module that logs — the phases,
 * `death`, `state`, `interactions` — import the orchestrator that imports them
 * back, so the year loop had to build its phase list per call to survive the
 * cycle. Keeping this module dependency-free is what keeps that gone.
 */

import type { GameState, YearLog } from '@/types';

/** Returns the log for the current age/year, appending a fresh one when missing. */
export function currentYearLog(state: GameState): YearLog {
  const last = state.log[state.log.length - 1];
  if (last) return last;
  const fresh: YearLog = { age: state.character.age, year: state.year, entries: [] };
  state.log.push(fresh);
  return fresh;
}
