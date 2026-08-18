/**
 * Health phase: illness onset, progression, recovery and addiction pressure.
 */

import type { Ctx, LogEntry } from '@/types';

/** Rolls new illnesses by onset weight, then ages and resolves the active ones. */
export function healthPhase(ctx: Ctx): LogEntry[] {
  throw new Error('TODO:health.healthPhase');
}
