/**
 * Aging phase: advances age and year, then applies the natural stat drift that
 * comes with the character's new life stage.
 */

import type { Ctx, LogEntry } from '@/types';

/** Ages the character one year and applies stage-driven stat drift. */
export function agingPhase(ctx: Ctx): LogEntry[] {
  throw new Error('TODO:aging.agingPhase');
}
