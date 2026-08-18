/**
 * Player-initiated actions: activities, relationship moves and crimes.
 *
 * Everything here runs outside the year loop and writes into the current
 * `YearLog`, so the feed reads as one continuous year.
 */

import type {
  ContentRegistry,
  Ctx,
  GameState,
  InteractionDef,
  LogEntry,
} from '@/types';

/** Checks the age window, condition, cooldown and whether the cost is affordable. */
export function canUse(ctx: Ctx, def: InteractionDef): { ok: boolean; reason?: string } {
  throw new Error('TODO:interactions.canUse');
}

/** All interactions in `area` that currently pass `canUse`. */
export function availableInteractions(
  state: GameState,
  reg: ContentRegistry,
  area: string
): InteractionDef[] {
  throw new Error('TODO:interactions.availableInteractions');
}

/**
 * Runs one interaction: resolves `targetId` into `ctx.target`, charges the cost,
 * applies the resolved effects, records the cooldown in `interactionUse` and
 * appends the entries to the current year log. Returns null when unavailable.
 */
export function runInteraction(
  state: GameState,
  reg: ContentRegistry,
  id: string,
  targetId?: string
): { text: string; icon: string; entries: LogEntry[] } | null {
  throw new Error('TODO:interactions.runInteraction');
}

/** Rolls the crime's success chance, then applies either the payout or a jail sentence. */
export function commitCrime(
  state: GameState,
  reg: ContentRegistry,
  crimeId: string
): { text: string; icon: string; entries: LogEntry[] } {
  throw new Error('TODO:interactions.commitCrime');
}
