/**
 * The year loop: the one place a life advances in time.
 */

import { killCharacter } from '@/engine/death';
import { applyEffects } from '@/engine/effects';
import { fillTemplate } from '@/engine/format';
import { agingPhase } from '@/engine/phases/aging';
import { careerPhase } from '@/engine/phases/career';
import { deathCheckPhase } from '@/engine/phases/deathCheck';
import { educationPhase } from '@/engine/phases/education';
import { eventsPhase } from '@/engine/phases/events';
import { financePhase } from '@/engine/phases/finance';
import { healthPhase } from '@/engine/phases/health';
import { relationshipsPhase } from '@/engine/phases/relationships';
import { createRng } from '@/engine/rng';
import type {
  ContentRegistry,
  Ctx,
  EventChoice,
  EventChoiceOutcome,
  EventDef,
  GameState,
  LogEntry,
  PendingEvent,
  YearLog,
} from '@/types';

/** Used when a `death` marker reaches the orchestrator without a stated cause. */
const DEFAULT_DEATH_CAUSE = 'natural causes';

/** Stands in for a discarded card that carried no icon of its own. */
const LOST_CHOICE_ICON = '❔';

/** Neutral line logged in place of an outcome the current content cannot roll. */
const LOST_CHOICE_TEXT = 'The moment passed before you could decide.';

/** Returns the log for the current age/year, appending a fresh one when missing. */
export function currentYearLog(state: GameState): YearLog {
  const last = state.log[state.log.length - 1];
  if (last) return last;
  const fresh: YearLog = { age: state.character.age, year: state.year, entries: [] };
  state.log.push(fresh);
  return fresh;
}

/**
 * Finishes a death that a phase or an effect only marked.
 * `{kind:'death'}` effects and `deathCheckPhase` set `phase`/`pendingDeathCause`
 * and stop; the obituary is built here, once, and the choice queue is dropped.
 * Returns true when the life has ended.
 */
function settleDeath(state: GameState, reg: ContentRegistry): boolean {
  if (state.phase !== 'dead') return false;
  if (!state.death) {
    const cause = String(state.character.flags.pendingDeathCause ?? DEFAULT_DEATH_CAUSE);
    killCharacter(state, reg, cause);
  }
  state.pending = [];
  return true;
}

/**
 * Advances one year. Throws unless `phase === 'alive'`.
 * Phases run in this fixed order: aging, health, education, relationships,
 * career, finance, events, deathCheck. A phase that kills the character halts
 * the remaining ones; a phase that queues a choice does not, so the year still
 * finishes and the queue is answered by `resolveChoice` afterwards.
 */
export function ageUp(state: GameState, reg: ContentRegistry): void {
  if (state.phase !== 'alive') {
    throw new Error(`ageUp while phase=${state.phase}`);
  }

  const ctx: Ctx = { state, c: state.character, rng: createRng(state), reg };

  /* Built per call rather than at module scope: phase modules may import back
     into this one, and a list built at import time could capture a binding that
     the circular import has not initialised yet. */
  const phases: ((ctx: Ctx) => LogEntry[])[] = [
    agingPhase,
    healthPhase,
    educationPhase,
    relationshipsPhase,
    careerPhase,
    financePhase,
    eventsPhase,
    deathCheckPhase,
  ];

  for (const phase of phases) {
    const entries = phase(ctx);
    if (entries.length > 0) currentYearLog(state).entries.push(...entries);
    // `awaitingChoice` (from the events phase) does not halt the year; death does.
    if (settleDeath(state, reg)) return;
  }
}

/** Widened lookup: a hand-built or partially loaded registry can miss the id. */
function findEvent(reg: ContentRegistry, eventId: string): EventDef | undefined {
  const byId: Record<string, EventDef | undefined> = reg.eventsById;
  return byId[eventId];
}

/**
 * True when `rng.weighted` has something to land on in this choice.
 *
 * Mirrors that function's own predicate: only a finite, strictly positive
 * weight can be rolled, so a list of zeroes or negatives — and an empty list —
 * makes the call throw. `validateRegistry` flags such a choice, but it is an
 * authoring lint nothing runs at load time, so an unvalidated pack reaches
 * `resolveChoice` intact and has to be handled here.
 */
function canRollOutcome(choice: EventChoice): boolean {
  /* Widened like `findEvent`: a hand-built or partially loaded pack can ship a
     choice with no outcome list at all. */
  const outcomes: readonly EventChoiceOutcome[] | undefined = choice.outcomes;
  if (!outcomes) return false;
  return outcomes.some((o) => Number.isFinite(o.weight) && o.weight > 0);
}

/**
 * Drops the head card without rolling an outcome, then reopens the phase.
 *
 * A save stores a card by event id and label, but it is answered against
 * whatever content the running build ships. An update that renames or removes
 * an event, drops its branches, retires one label, or leaves the chosen option
 * with nothing rollable (see `canRollOutcome`) leaves a queued card no outcome
 * can be produced for — as does a stored card that offers no labels at all.
 * Refusing it would strand the life for good — `ageUp` accepts no phase but
 * `alive`, so a save parked on `awaitingChoice` would have no legal move left.
 * The card is discarded with a neutral line instead. No randomness is consumed,
 * so the surrounding sequence is untouched and the discard replays identically.
 */
function discardPending(state: GameState, pending: PendingEvent): void {
  currentYearLog(state).entries.push({
    icon: pending.icon || LOST_CHOICE_ICON,
    kind: 'info',
    text: LOST_CHOICE_TEXT,
  });
  state.pending.shift();
  state.phase = state.pending.length > 0 ? 'awaitingChoice' : 'alive';
}

/**
 * Resolves the first pending event with the chosen option: rolls a weighted
 * outcome, applies its effects, appends the entries and pops the queue. The
 * phase returns to `alive` once the queue empties and the character lives.
 *
 * Throws only on caller mistakes (wrong phase, empty queue, an out-of-range
 * index into a card that does offer options), which leave the queue untouched
 * so the call can be retried. A card the current content can no longer
 * describe — including one that offers nothing to pick — is discarded instead,
 * see `discardPending`.
 */
export function resolveChoice(
  state: GameState,
  reg: ContentRegistry,
  choiceIndex: number
): void {
  if (state.phase !== 'awaitingChoice') {
    throw new Error(`resolveChoice while phase=${state.phase}`);
  }
  const pending = state.pending[0];
  if (!pending) {
    throw new Error('resolveChoice with an empty pending queue');
  }
  /* A card offering nothing has no index that is not out of range, so the throw
     below would leave the life no legal move at all: `ageUp` takes no phase but
     `alive` and every retry throws the same way. The events phase never mints
     such a card — it queues one only once a label has passed its condition — so
     it can only arrive from a save, which the loader does not validate this
     deep. That is the same drift the paths below handle, and it gets the same
     draw-free discard. Widened because a stored card can also carry no list at
     all. */
  const offered: readonly { label: string }[] | undefined = pending.choices;
  if (!offered || offered.length === 0) {
    discardPending(state, pending);
    return;
  }
  /* Checked before the registry lookup so a caller passing a bad index is always
     reported as such, never quietly swallowed by the content-drift path below.
     Only reachable once the card is known to offer something, so the index is
     genuinely the caller's mistake. */
  const picked = offered[choiceIndex];
  if (!picked) {
    throw new Error(`resolveChoice: no choice at index ${choiceIndex}`);
  }

  // Everything from here is resolved against content that may have moved on.
  const def = findEvent(reg, pending.eventId);
  if (!def?.choices) {
    discardPending(state, pending);
    return;
  }
  /* The queue stores only the labels that passed each choice's `condition`, so
     the index is remapped by label. Labels are unique within one event; the
     content lint enforces it. */
  const choice: EventChoice | undefined = def.choices.find((ch) => ch.label === picked.label);
  /* An option that survived by label but lost every rollable outcome is the same
     drift case: `rng.weighted` would throw, and throwing here is unrecoverable.
     Checked before the rng is drawn from, so the discard stays draw-free. */
  if (!choice || !canRollOutcome(choice)) {
    discardPending(state, pending);
    return;
  }

  const rng = createRng(state);
  const outcome = rng.weighted(choice.outcomes, (o) => o.weight);

  const entries: LogEntry[] = [
    { icon: def.icon, kind: 'choice', text: fillTemplate(outcome.text, state) },
  ];
  entries.push(...applyEffects({ state, rng, reg }, outcome.effects));
  currentYearLog(state).entries.push(...entries);

  state.pending.shift();
  if (settleDeath(state, reg)) return;
  state.phase = state.pending.length > 0 ? 'awaitingChoice' : 'alive';
}
