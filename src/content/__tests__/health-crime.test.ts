import { describe, expect, it } from 'vitest';

import { crimePack } from '@/content/crime';
import { healthPack } from '@/content/health';
import { applyEffects } from '@/engine/effects';
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
