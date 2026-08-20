/**
 * Rules more than one engine module has to agree on.
 *
 * A leaf module by design: it imports `@/types` and nothing else. Only a value
 * two modules must read the same way belongs here — a per-phase age or tuning
 * number stays with the phase that owns it, so it can be retuned on its own.
 */

import type { EdLevel } from '@/types';

/**
 * Ranking used for "at least this much schooling" checks.
 *
 * Read by the education phase's admission gates and by `jobRequirementsMet`.
 * They have to rank the levels identically or a school and a job disagree about
 * what "at least a degree" means: an applicant the university turns away for
 * already holding one is refused the post that diploma was the requirement for.
 */
export const LEVEL_ORDER: Record<EdLevel, number> = {
  none: 0,
  primary: 1,
  middle: 2,
  high: 3,
  university: 4,
  postgrad: 5,
};

export function hasAtLeast(level: EdLevel, needed: EdLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[needed];
}

/**
 * Levels a character enrols in by applying rather than by turning the right age:
 * the ones `applyToSchool` accepts, and the ones the compulsory ladder leaves
 * alone.
 */
export const DEGREE_LEVELS: readonly EdLevel[] = ['university', 'postgrad'];

export function isDegreeLevel(level: EdLevel): boolean {
  return DEGREE_LEVELS.includes(level);
}

/**
 * Age from which somebody is living on their own by default.
 *
 * The finance phase moves a character out of the family home here and starts
 * charging them rent; `startLegacy` stamps the same rule on the heir it builds.
 * One number or the other side is wrong: an heir born just over the line either
 * arrives already paying rent, or keeps a free roof the phase would have taken.
 */
export const MOVE_OUT_AGE = 22;
