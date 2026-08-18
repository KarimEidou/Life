/**
 * Events phase: the random life moments that make each run different.
 */

import { applyEffects } from '@/engine/effects';
import { resolveText } from '@/engine/format';
import type { Ctx, EventChoice, EventDef, LogEntry, PendingEvent } from '@/types';

/** Chance of drawing a first event each year, then a second, distinct one. */
const FIRST_EVENT_CHANCE = 0.85;
const SECOND_EVENT_CHANCE = 0.4;

/**
 * Age window, once-per-life history and the def's own condition.
 * Non-positive weights are excluded here too, so `rng.weighted` always has a
 * drawable candidate; `validateRegistry` reports them as content bugs.
 */
function isEligible(ctx: Ctx, def: EventDef): boolean {
  const age = ctx.c.age;
  if (age < def.minAge || age > def.maxAge) return false;
  if (def.oncePerLife === true && ctx.state.firedEvents.includes(def.id)) return false;
  if (!(def.weight > 0)) return false;
  return def.condition?.(ctx) !== false;
}

/** The choices whose `condition` passes; only these reach the pending card. */
function openChoices(ctx: Ctx, def: EventDef): EventChoice[] {
  return (def.choices ?? []).filter((choice) => choice.condition?.(ctx) !== false);
}

/**
 * Fires one event.
 * Returns false when the year must stop drawing: either the character died, or
 * a choice is now queued and blocks any further event this year.
 */
function fire(ctx: Ctx, def: EventDef, entries: LogEntry[]): boolean {
  const { state, reg, rng } = ctx;
  if (def.oncePerLife === true) state.firedEvents.push(def.id);
  const text = resolveText(def.text, ctx);

  if (def.choices) {
    const open = openChoices(ctx, def);
    if (open.length > 0) {
      const pending: PendingEvent = {
        eventId: def.id,
        text,
        icon: def.icon,
        choices: open.map((choice) => ({ label: choice.label })),
      };
      state.pending.push(pending);
      state.phase = 'awaitingChoice';
      /* The prompt itself is not logged: the card carries it, and `resolveChoice`
         logs the outcome. Drawing again would stack a second card on an answer
         the player has not given yet, so the year stops drawing here. */
      return false;
    }
    // Every choice was conditioned out; the event degrades to an instant one.
  }

  entries.push({ icon: def.icon, kind: 'info', text });
  entries.push(...applyEffects({ state, rng, reg }, def.effects ?? []));
  // Death protocol: a `death` effect only marks; `ageUp` settles the obituary.
  return state.phase !== 'dead';
}

/**
 * Draws up to two eligible events per year by weight (85% for the first, then
 * 40% for a second). Instant events apply their effects immediately; choice
 * events push a `PendingEvent` and move the phase to `awaitingChoice`.
 */
export function eventsPhase(ctx: Ctx): LogEntry[] {
  const entries: LogEntry[] = [];
  const rng = ctx.rng;

  // Checked before the roll so a year with nothing to draw consumes no randomness.
  let pool = ctx.reg.events.filter((def) => isEligible(ctx, def));
  if (pool.length === 0) return entries;
  if (!rng.chance(FIRST_EVENT_CHANCE)) return entries;

  const first = rng.weighted(pool, (def) => def.weight);
  if (!fire(ctx, first, entries)) return entries;

  /* Distinct from the first draw, and re-checked: the first event's effects may
     have invalidated a condition that passed at the top of the year. */
  pool = pool.filter((def) => def !== first && isEligible(ctx, def));
  if (pool.length === 0) return entries;
  if (!rng.chance(SECOND_EVENT_CHANCE)) return entries;

  fire(ctx, rng.weighted(pool, (def) => def.weight), entries);
  return entries;
}
