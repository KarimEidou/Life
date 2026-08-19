import { describe, expect, it } from 'vitest';

import { crimePack } from '@/content/crime';
import { healthPack } from '@/content/health';
import { applyEffects } from '@/engine/effects';
import { availableInteractions, runInteraction } from '@/engine/interactions';
import { eventsPhase } from '@/engine/phases/events';
import { healthPhase } from '@/engine/phases/health';
import { buildRegistry } from '@/engine/registry';
import { createRng } from '@/engine/rng';
import { addPerson, createLife } from '@/engine/state';
import type {
  ContentRegistry,
  Ctx,
  EventDef,
  GameState,
  IllnessDef,
  Person,
  PrisonState,
  RelKind,
  Rng,
} from '@/types';

/**
 * Health pack: the `chronic` / `cureChance` contract.
 *
 * `healthPhase` gates the yearly recovery roll on `!def.chronic`, and no pack
 * ships a `{kind:'illness', cure}` effect, so `cureChance` is unreachable on a
 * chronic row. A chronic row that declares one promises a recovery nothing in
 * the engine can deliver: the condition is carried for the rest of the life,
 * costing `healthHit / 2` a year untreated and its `lethality` in every
 * death check, while its own data says it clears.
 */

const illnesses: IllnessDef[] = healthPack.illnesses ?? [];

const EMPTY = buildRegistry([]);

function defOf(id: string): IllnessDef {
  const def = illnesses.find((candidate) => candidate.id === id);
  if (!def) throw new Error(`health ships no "${id}"`);
  return def;
}

/** A registry holding only the def under test, so the year's rolls are exactly its. */
function registryOf(def: IllnessDef): ContentRegistry {
  return buildRegistry([{ id: 'health-under-test', illnesses: [def] }]);
}

/** Already carrying the condition, so the year's only roll is its recovery one. */
function carrier(defId: string, treated = false): GameState {
  const state = createLife(EMPTY, { seed: 1, firstName: 'Ada', lastName: 'Moreno' });
  state.character.age = 40;
  state.character.illnesses = [{ defId, years: 1, treated }];
  return state;
}

function ctxOf(state: GameState, reg: ContentRegistry, rng?: Rng): Ctx {
  return { state, c: state.character, rng: rng ?? createRng(state), reg };
}

/** Every roll succeeds, so a recovery that is rolled at all is a recovery seen. */
function alwaysCures(): Rng {
  return {
    next: () => 0,
    int: (min: number) => min,
    pick: <T,>(arr: readonly T[]): T => arr[0] as T,
    chance: () => true,
    weighted: <T,>(items: readonly T[]): T => items[0] as T,
    normal: (mean: number) => mean,
  };
}

describe('health pack illness data', () => {
  it('never declares a cureChance the recovery roll cannot reach', () => {
    const unreachable = illnesses
      .filter((def) => def.chronic && def.cureChance !== 0)
      .map((def) => `${def.id}: chronic with cureChance ${def.cureChance}`);

    expect(unreachable).toEqual([]);
    // Not vacuous: the pack does ship permanent conditions.
    expect(illnesses.some((def) => def.chronic)).toBe(true);
  });
});

describe('health pack recovery', () => {
  it('lets depression and a bad back pass, treated or not', () => {
    for (const id of ['ill-depression', 'ill-back-pain']) {
      for (const treated of [false, true]) {
        const state = carrier(id, treated);
        const entries = healthPhase(ctxOf(state, registryOf(defOf(id)), alwaysCures()));

        expect(state.character.illnesses, `${id} treated=${treated}`).toEqual([]);
        expect(entries.map((entry) => entry.icon)).toEqual(['💚']);
      }
    }
  });

  // The failure this guards: the row was carried to the grave, every life.
  it('shakes depression off on the live rng, not only on a rigged one', () => {
    const state = carrier('ill-depression');
    const reg = registryOf(defOf('ill-depression'));
    let recovered = 0;

    for (let year = 0; year < 20; year += 1) {
      const entries = healthPhase(ctxOf(state, reg));
      recovered += entries.filter((entry) => entry.icon === '💚').length;
    }

    expect(recovered).toBeGreaterThan(0);
  });

  it('carries chronic migraines for life, as its label promises', () => {
    const def = defOf('ill-migraine');
    const state = carrier('ill-migraine');

    const entries = healthPhase(ctxOf(state, registryOf(def), alwaysCures()));

    expect(def.chronic).toBe(true);
    expect(state.character.illnesses).toEqual([
      { defId: 'ill-migraine', years: 2, treated: false },
    ]);
    expect(entries.every((entry) => entry.icon !== '💚')).toBe(true);
  });
});

/**
 * Health pack: the rows that need the world outside sit out prison years.
 *
 * `eventsPhase` keeps drawing while the character is inside and the Health
 * sheet stays reachable from More, so anything this pack leaves ungated is
 * handed out from a cell: a church-hall clinic that treats a $50,000 condition
 * for nothing, a $30 pharmacy queue, and a $6,000 thirty-day residential stay.
 */

/** Rows that need the world outside; none of them may reach a cell. */
const OUTSIDE_EVENTS = [
  'ev-health-gym-injury',
  'ev-health-scare',
  'ev-health-free-clinic',
  'ev-health-dentist',
  'ev-health-flu-shot',
];

/** Bouts a cell delivers as readily as a house does; these stay ungated. */
const INSIDE_EVENTS = [
  'ev-health-flu-season',
  'ev-health-insomnia',
  'ev-health-allergies',
  'ev-health-back-tweak',
];

/** The four residential stays, by id. */
const REHAB_ROWS = [
  'act-rehab-alcohol',
  'act-rehab-drugs',
  'act-rehab-gambling',
  'act-rehab-smoking',
];

/** Care an infirmary can plausibly manage: the whole health sheet, inside. */
const INSIDE_ROWS = ['act-checkup', 'act-doctor', 'act-meditation', 'act-therapy'];

const CLINIC_TEXT =
  'A free clinic set up in the church hall. You got a shot, a lollipop and a clean bill of health.';

const HEALTH = buildRegistry([healthPack]);

const SENTENCE: PrisonState = { crime: 'Burglary', yearsLeft: 6, totalYears: 6 };

function healthEventOf(id: string): EventDef {
  const def = (healthPack.events ?? []).find((candidate) => candidate.id === id);
  if (!def) throw new Error(`health ships no "${id}"`);
  return def;
}

/**
 * Forty-eight, a gym habit and four things to quit, so every row under test
 * clears its age window and its other clauses: the cell is the only difference.
 */
function patient(prison: PrisonState | null): GameState {
  const state = createLife(EMPTY, { seed: 3, firstName: 'Ada', lastName: 'Moreno' });
  const c = state.character;
  c.age = 48;
  c.prison = prison;
  c.flags.gymRegular = true;
  c.addictions = { alcohol: 60, smoking: 60, gambling: 60, drugs: 60 };
  return state;
}

describe('health pack prison gate', () => {
  it('refuses every outside-world event to a character serving a sentence', () => {
    for (const id of OUTSIDE_EVENTS) {
      const def = healthEventOf(id);

      expect(def.condition?.(ctxOf(patient(SENTENCE), HEALTH)), id).toBe(false);
      // Not vacuous: the same character, released, is eligible for all five.
      expect(def.condition?.(ctxOf(patient(null), HEALTH)), id).toBe(true);
    }
  });

  it('draws none of them, and no randomness, during a prison year', () => {
    const reg = buildRegistry([
      { id: 'health-outside-only', events: OUTSIDE_EVENTS.map(healthEventOf) },
    ]);
    const inside = patient(SENTENCE);
    const before = inside.rngState;

    expect(eventsPhase(ctxOf(inside, reg))).toEqual([]);
    // The pool is emptied before the year's first roll, so the year costs nothing.
    expect(inside.rngState).toBe(before);
  });

  it('still runs the clinic for a character who is not inside', () => {
    const reg = buildRegistry([
      { id: 'health-clinic-only', events: [healthEventOf('ev-health-free-clinic')] },
    ]);

    const entries = eventsPhase(ctxOf(patient(null), reg, alwaysDraws()));

    expect(entries[0]?.text).toBe(CLINIC_TEXT);
  });

  it('offers the infirmary rows from a cell and the rehab rows only outside', () => {
    const listed = availableInteractions(patient(SENTENCE), HEALTH, 'health').map((def) => def.id);

    expect(listed.sort()).toEqual(INSIDE_ROWS);

    // Not vacuous: the same four addictions buy four rehab rows on the outside.
    const outside = availableInteractions(patient(null), HEALTH, 'health').map((def) => def.id);
    expect(outside.sort()).toEqual([...INSIDE_ROWS, ...REHAB_ROWS].sort());
  });

  it('keeps the bouts a cell can still deliver', () => {
    const inside = patient(SENTENCE);

    for (const id of INSIDE_EVENTS) {
      expect(healthEventOf(id).condition?.(ctxOf(inside, HEALTH)) !== false, id).toBe(true);
    }
  });
});

/**
 * Health pack: the care rows that need an age of their own.
 *
 * `canUse` falls back to `def.minAge ?? 0`, so a row shipped without one is
 * offered from birth. `act-meditation` is free and carries no cooldown, so
 * ungated it put an unlimited +3 happiness in front of a newborn: a dozen taps
 * from the rolled start to 100, before the first Age Up. The activities pack
 * gates its own `act-meditate` at the same age for the same reason.
 */

/** Old enough to sit still on purpose; the gate `act-meditate` also carries. */
const MEDITATION_MIN_AGE = 8;

/** Health rows that need no age of their own: all a newborn may be offered. */
const INFANT_ROWS = ['act-checkup', 'act-doctor'];

/** A well character of the given age: nothing to quit, so only the age can gate. */
function aged(age: number): GameState {
  const state = createLife(EMPTY, { seed: 11, firstName: 'Ada', lastName: 'Moreno' });
  state.character.age = age;
  // Room under the cap, so a +3 that lands is a +3 the assertion can see.
  state.character.stats.happiness = 50;
  return state;
}

describe('health pack age gates', () => {
  it('offers a newborn only the rows that carry no age of their own', () => {
    const listed = availableInteractions(aged(0), HEALTH, 'health').map((def) => def.id);

    expect(listed.sort()).toEqual(INFANT_ROWS);

    // Not vacuous: the sheet lists meditation the year the character is old enough.
    const older = availableInteractions(aged(MEDITATION_MIN_AGE), HEALTH, 'health');
    expect(older.map((def) => def.id)).toContain('act-meditation');
  });

  it('refuses a child the free, cooldown-free happiness of meditation', () => {
    const state = aged(MEDITATION_MIN_AGE - 1);
    const before = state.rngState;

    expect(runInteraction(state, HEALTH, 'act-meditation')?.text).toBe("You're too young.");
    expect(state.character.stats.happiness).toBe(50);
    // A refusal costs nothing, a draw included.
    expect(state.rngState).toBe(before);

    // Not vacuous: a year older, the same tap lands its +3.
    const older = aged(MEDITATION_MIN_AGE);
    expect(runInteraction(older, HEALTH, 'act-meditation')?.entries.length).toBeGreaterThan(0);
    expect(older.character.stats.happiness).toBe(53);
  });
});

/**
 * Crime pack: visiting day's gate and its reward have to name the same people.
 *
 * `hasVisitor` counts a spouse or a partner as somebody who would make the
 * drive, while `{who:'random-family'}` resolves to mother/father/sibling/child
 * only. An inmate whose one living relation is a spouse therefore passed the
 * gate, read the text, and watched the +5 resolve to nobody.
 */

const VISITING_DAY_TEXT =
  'Visiting day. Forty minutes, one plexiglass window, and a lot of nodding.';

/** Every kind the gate lets through; the reward has to reach all six. */
const VISITOR_KINDS: readonly RelKind[] = [
  'mother',
  'father',
  'sibling',
  'child',
  'spouse',
  'partner',
];

function eventOf(id: string): EventDef {
  const def = (crimePack.events ?? []).find((candidate) => candidate.id === id);
  if (!def) throw new Error(`crime ships no "${id}"`);
  return def;
}

/** A registry holding only the def under test, so the year's draw is exactly it. */
function eventRegistryOf(def: EventDef): ContentRegistry {
  return buildRegistry([{ id: 'crime-under-test', events: [def] }]);
}

/** Both yearly rolls pass and `weighted` is a pure pick, so the draw is fixed. */
function alwaysDraws(): Rng {
  return {
    next: () => 0.5,
    int: (min: number) => min,
    pick: <T,>(arr: readonly T[]): T => arr[0] as T,
    chance: () => true,
    weighted: <T,>(items: readonly T[]): T => items[0] as T,
    normal: (mean: number) => mean,
  };
}

/** Serving a sentence with one living relation: the visitor under test. */
function inmateVisitedBy(kind: RelKind): { state: GameState; visitor: Person } {
  const state = createLife(EMPTY, { seed: 7, firstName: 'Ada', lastName: 'Moreno' });
  state.character.age = 48;
  state.character.prison = { crime: 'Burglary', yearsLeft: 4, totalYears: 6 };
  state.character.job = null;
  // The rolled family is buried, so only this visitor can answer the sentinel.
  for (const person of Object.values(state.people)) person.alive = false;
  const visitor = addPerson(state, {
    kind,
    name: 'Sam Moreno',
    gender: 'female',
    age: 46,
    alive: true,
    rel: 50,
    flags: {},
  });
  return { state, visitor };
}

describe('ev-prison-visiting-day', () => {
  it('lands its +5 on every visitor its own gate lets through', () => {
    const def = eventOf('ev-prison-visiting-day');
    const reg = eventRegistryOf(def);

    for (const kind of VISITOR_KINDS) {
      const { state, visitor } = inmateVisitedBy(kind);
      // Not vacuous: the gate is what promised this visitor was coming.
      expect(def.condition?.(ctxOf(state, reg)), kind).toBe(true);

      const entries = eventsPhase(ctxOf(state, reg, alwaysDraws()));

      expect(entries[0]?.text, kind).toBe(VISITING_DAY_TEXT);
      expect(state.people[visitor.id]?.rel, kind).toBe(55);
    }
  });

  it('pays one visitor once, and spends no roll on a sentinel that matches nobody', () => {
    const { state, visitor } = inmateVisitedBy('spouse');
    const before = state.rngState;

    applyEffects(
      { state, rng: createRng(state), reg: EMPTY },
      eventOf('ev-prison-visiting-day').effects ?? []
    );

    expect(state.people[visitor.id]?.rel).toBe(55);
    // `random-family` finds no living family here, and `partner` never picks.
    expect(state.rngState).toBe(before);
  });
});
