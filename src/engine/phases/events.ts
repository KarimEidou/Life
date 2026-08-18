/**
 * Events phase: the random life moments that make each run different.
 */

import type { Ctx, LogEntry } from '@/types';

/**
 * Draws up to two eligible events per year by weight (85% for the first, then
 * 40% for a second). Instant events apply their effects immediately; choice
 * events push a `PendingEvent` and move the phase to `awaitingChoice`.
 */
export function eventsPhase(ctx: Ctx): LogEntry[] {
  throw new Error('TODO:events.eventsPhase');
}
