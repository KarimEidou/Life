/**
 * Career phase plus the player actions that drive employment.
 */

import type { ContentRegistry, Ctx, GameState, JobDef, LogEntry } from '@/types';

/** Pays salary, moves performance, then rolls promotion, raise or firing. */
export function careerPhase(ctx: Ctx): LogEntry[] {
  throw new Error('TODO:career.careerPhase');
}

/** Checks a job's `req` gate: age, education level, major, stats and prior job. */
export function jobRequirementsMet(
  state: GameState,
  reg: ContentRegistry,
  job: JobDef
): { ok: boolean; reason?: string } {
  throw new Error('TODO:career.jobRequirementsMet');
}

/** Applies for a job: requirements gate, then an interview roll on success. */
export function applyForJob(
  state: GameState,
  reg: ContentRegistry,
  jobId: string
): { ok: boolean; reason?: string } {
  throw new Error('TODO:career.applyForJob');
}

/** Leaves the current job immediately, ending its salary. */
export function quitJob(state: GameState): void {
  throw new Error('TODO:career.quitJob');
}

/** Toggles working hard: better performance at the cost of health and happiness. */
export function setWorkHard(state: GameState, on: boolean): void {
  throw new Error('TODO:career.setWorkHard');
}

/** Asks for a raise: performance-weighted roll, once per year. */
export function askForRaise(
  state: GameState,
  reg: ContentRegistry
): { ok: boolean; text: string } {
  throw new Error('TODO:career.askForRaise');
}
