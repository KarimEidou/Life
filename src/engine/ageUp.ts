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
  EventDef,
  GameState,
  LogEntry,
  YearLog,
} from '@/types';

/** Used when a `death` marker reaches the orchestrator without a stated cause. */
const DEFAULT_DEATH_CAUSE = 'natural causes';

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
 * Resolves the first pending event with the chosen option: rolls a weighted
 * outcome, applies its effects, appends the entries and pops the queue. The
 * phase returns to `alive` once the queue empties and the character lives.
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
  const def = findEvent(reg, pending.eventId);
  if (!def) {
    throw new Error(`resolveChoice: unknown event ${pending.eventId}`);
  }
  if (!def.choices) {
    throw new Error(`resolveChoice: event ${pending.eventId} has no choices`);
  }
  const picked = pending.choices[choiceIndex];
  if (!picked) {
    throw new Error(`resolveChoice: no choice at index ${choiceIndex}`);
  }
  /* The queue stores only the labels that passed each choice's `condition`, so
     the index is remapped by label. Labels are unique within one event; the
     content lint enforces it. */
  const choice: EventChoice | undefined = def.choices.find((ch) => ch.label === picked.label);
  if (!choice) {
    throw new Error(`resolveChoice: no choice labelled ${picked.label}`);
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
