/**
 * Education phase plus the player actions that drive schooling.
 */

import type { ContentRegistry, Ctx, GameState, LogEntry } from '@/types';

/** Auto-enrols compulsory schooling, advances the school year, updates GPA and graduates. */
export function educationPhase(ctx: Ctx): LogEntry[] {
  throw new Error('TODO:education.educationPhase');
}

/** Checks admission (age, prior level, GPA, tuition) and enrols on success. */
export function applyToSchool(
  state: GameState,
  reg: ContentRegistry,
  schoolId: string,
  major?: string
): { ok: boolean; reason?: string } {
  throw new Error('TODO:education.applyToSchool');
}

/** Leaves the current school without completing it; the level stays as it was. */
export function dropOut(state: GameState): void {
  throw new Error('TODO:education.dropOut');
}

/** Toggles studying hard: better GPA at the cost of happiness. */
export function setStudyHard(state: GameState, on: boolean): void {
  throw new Error('TODO:education.setStudyHard');
}
