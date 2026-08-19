import { describe, expect, it } from 'vitest';

import { eventsAdultPack } from '@/content/events-adult';
import { eventsPhase } from '@/engine/phases/events';
import { buildRegistry } from '@/engine/registry';
import { createRng } from '@/engine/rng';
import { addPerson, createLife } from '@/engine/state';
import type {
  ContentRegistry,
  Ctx,
  Effect,
  EventDef,
  GameState,
  Illness,
  OwnedAsset,
  Person,
  Rng,
} from '@/types';

/**
 * Adult pack contract.
 *
 * Prison is the pack's blanket exclusion: `eventsPhase` keeps drawing while the
 * character is inside, so a def with no `condition` is fully eligible in a cell.
 * These tests run the real shipped defs through the real phase.
 */

const EMPTY = buildRegistry([]);
const adultEvents: EventDef[] = eventsAdultPack.events ?? [];

function defOf(id: string): EventDef {
  const def = adultEvents.find((candidate) => candidate.id === id);
  if (!def) throw new Error(`events-adult ships no "${id}"`);
  return def;
}

/** A registry holding only the defs under test, so the drawn pool is exactly them. */
function registryOf(defs: EventDef[]): ContentRegistry {
  return buildRegistry([{ id: 'events-adult-under-test', events: defs }]);
}

function newLife(seed: number, age: number): GameState {
  const state = createLife(EMPTY, { seed, firstName: 'Ada', lastName: 'Moreno' });
  state.character.age = age;
  return state;
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

function ctxOf(state: GameState, reg: ContentRegistry, rng?: Rng): Ctx {
  return { state, c: state.character, rng: rng ?? createRng(state), reg };
}

/** What `commitCrime` leaves behind on a jail sentence: inside, and out of a job. */
function jail(state: GameState): void {
  state.character.prison = { crime: 'Bank Robbery', yearsLeft: 8, totalYears: 8 };
  state.character.job = null;
}

function effectsOf(def: EventDef): Effect[] {
  return [
    ...(def.effects ?? []),
    ...(def.choices ?? []).flatMap((choice) =>
      choice.outcomes.flatMap((outcome) => outcome.effects)
    ),
  ];
}

function paysMoney(def: EventDef): boolean {
  return effectsOf(def).some((effect) => effect.kind === 'money' && effect.delta > 0);
}

describe('ev-adult-inheritance', () => {
  it('stays out of the pool while the character is inside, and spends no randomness', () => {
    const state = newLife(1, 30);
    jail(state);
    const reg = registryOf([defOf('ev-adult-inheritance')]);
    const before = state.rngState;

    expect(eventsPhase(ctxOf(state, reg))).toEqual([]);
    expect(state.character.money).toBe(0);
    expect(state.rngState).toBe(before);
    // The once-per-life slot must survive the sentence unspent.
    expect(state.firedEvents).toEqual([]);
  });

  it('still pays the windfall to a character who is not inside', () => {
    const state = newLife(1, 30);
    const reg = registryOf([defOf('ev-adult-inheritance')]);

    const entries = eventsPhase(ctxOf(state, reg, alwaysDraws()));

    expect(entries[0]?.text).toBe('A great-aunt you barely remember left you something in her will.');
    expect(state.character.money).toBe(9000);
    expect(state.firedEvents).toEqual(['ev-adult-inheritance']);
  });
});

/** Top-weight flavour whose only gate is `free`, so it is drawable every adult year. */
const FLAVOUR: ReadonlyArray<readonly [id: string, text: string]> = [
  ['ev-adult-caught-in-rain', 'The rain caught you halfway home, so you stopped hurrying.'],
  ['ev-adult-deja-vu', 'You have stood in this exact spot saying this exact sentence before.'],
];

describe('events-adult flavour events', () => {
  it('keeps free-world flavour out of a prison year, and spends no randomness', () => {
    const state = newLife(3, 30);
    jail(state);
    const reg = registryOf(FLAVOUR.map(([id]) => defOf(id)));
    const before = state.rngState;
    const stats = { ...state.character.stats };

    expect(eventsPhase(ctxOf(state, reg))).toEqual([]);
    // Mood and smarts the prison pack is withholding must not arrive by this door.
    expect(state.character.stats).toEqual(stats);
    expect(state.rngState).toBe(before);
  });

  it('still fires for a character who is not inside', () => {
    for (const [id, text] of FLAVOUR) {
      const state = newLife(3, 30);
      const reg = registryOf([defOf(id)]);

      const entries = eventsPhase(ctxOf(state, reg, alwaysDraws()));

      expect(entries[0]?.text, `event "${id}" did not fire`).toBe(text);
    }
  });
});

/** Employed and out in the world, which is all `employed` asks for. */
function employ(state: GameState): void {
  state.character.job = {
    jobId: 'j-clerk',
    title: 'Clerk',
    salary: 30000,
    years: 4,
    performance: 60,
    workHard: false,
  };
}

function illness(defId: string): Illness {
  return { defId, years: 3, treated: false };
}

/**
 * Illness events must not re-diagnose what the character already carries.
 *
 * `applyEffects` skips a duplicate `{kind:'illness'}` row, but the health and
 * mood in the same list are applied regardless — so an unguarded def charges for
 * a diagnosis already in `c.illnesses` and, for `oncePerLife`, spends its slot
 * on a firing that added nothing.
 */
const DIAGNOSES: ReadonlyArray<
  readonly [id: string, illnessId: string, text: string, health: number, happiness: number]
> = [
  [
    'ev-adult-desk-back-pain',
    'ill-back-pain',
    'Your chair, your posture and your job have been arguing about your spine.',
    -2,
    -3,
  ],
  [
    'ev-adult-food-poisoning',
    'ill-food-poisoning',
    'The gas station sushi seemed fine at the time.',
    -3,
    -5,
  ],
];

describe('events-adult illness events', () => {
  it('stays out of the pool while the illness is already held, and spends no randomness', () => {
    for (const [id, illnessId] of DIAGNOSES) {
      const state = newLife(5, 41);
      employ(state);
      state.character.illnesses = [illness(illnessId)];
      state.character.stats.health = 60;
      state.character.stats.happiness = 60;
      const reg = registryOf([defOf(id)]);
      const before = state.rngState;

      expect(eventsPhase(ctxOf(state, reg)), `event "${id}" fired`).toEqual([]);
      // No second charge for a diagnosis `healthPhase` already handed over.
      expect(state.character.stats.health, `event "${id}" charged health`).toBe(60);
      expect(state.character.stats.happiness, `event "${id}" charged happiness`).toBe(60);
      expect(state.character.illnesses).toEqual([illness(illnessId)]);
      // Refused before the roll: an empty pool must not move the cursor.
      expect(state.rngState, `event "${id}" spent randomness`).toBe(before);
      // The once-per-life slot must not be burnt on a no-op.
      expect(state.firedEvents, `event "${id}" burnt its slot`).toEqual([]);
    }
  });

  it('still diagnoses a character who is not already carrying it', () => {
    for (const [id, illnessId, text, health, happiness] of DIAGNOSES) {
      const state = newLife(5, 41);
      employ(state);
      state.character.stats.health = 60;
      state.character.stats.happiness = 60;
      const reg = registryOf([defOf(id)]);

      const entries = eventsPhase(ctxOf(state, reg, alwaysDraws()));

      expect(entries[0]?.text, `event "${id}" did not fire`).toBe(text);
      expect(state.character.illnesses).toEqual([{ defId: illnessId, years: 0, treated: false }]);
      expect(state.character.stats.health).toBe(60 + health);
      expect(state.character.stats.happiness).toBe(60 + happiness);
    }
  });
});

describe('events-adult prison exclusion', () => {
  /* The whole pack sits a sentence out, not just the events that move money:
     a def with no `condition` is drawable in a cell, and free-world flavour
     drawn against the prison pack's weights is the bug this guards. */
  it('leaves no event in the pack drawable while the character is inside', () => {
    const state = newLife(4, 40);
    jail(state);
    const ctx = ctxOf(state, registryOf(adultEvents));

    expect(adultEvents.length).toBeGreaterThan(0);
    for (const def of adultEvents) {
      expect(def.condition, `event "${def.id}" declares no condition`).toBeDefined();
      expect(def.condition?.(ctx), `event "${def.id}" is drawable in prison`).toBe(false);
    }
  });

  it('gates every money windfall in the pack behind a condition that refuses in prison', () => {
    const state = newLife(2, 40);
    jail(state);
    const reg = registryOf(adultEvents);
    const ctx = ctxOf(state, reg);
    const before = state.rngState;
    const windfalls = adultEvents.filter(paysMoney);

    expect(windfalls.length).toBeGreaterThan(0);
    for (const def of windfalls) {
      expect(def.condition, `event "${def.id}" declares no condition`).toBeDefined();
      expect(def.condition?.(ctx), `event "${def.id}" is drawable in prison`).toBe(false);
    }
    // Conditions are draw-free reads; evaluating the pool must not move the cursor.
    expect(state.rngState).toBe(before);
  });
});

/**
 * Drifted save data.
 *
 * `loadGame` proves `state.people` is an object and `character.assets` an array
 * and stops there, so every value inside them reaches this pack unchecked. Both
 * helpers run inside the year: `firstNameOf` from `resolveText`, `ownsType` from
 * the pool filter. A `TypeError` from either unwinds past `gameStore.commit`, so
 * the year is half applied, `phase` is still `'alive'`, and pressing Age Up
 * again re-runs the whole chain on a character who silently aged.
 */

/** Overwrites a field the type says is a string, the way an older save can. */
function driftName(person: Person, name: unknown): void {
  (person as unknown as { name: unknown }).name = name;
}

function newChild(state: GameState, age: number, name: string): Person {
  return addPerson(state, {
    kind: 'child',
    name,
    gender: 'female',
    age,
    alive: true,
    rel: 70,
    flags: {},
  });
}

/** A hole, a row that never had a `defId`, and one whose `defId` is not a string. */
function driftedAssets(): OwnedAsset[] {
  const rows: unknown[] = [
    null,
    { id: 'a1', label: 'Something', paid: 0, value: 1000, yearBought: 2020 },
    { id: 'a2', defId: 7, label: 'Something else', paid: 0, value: 500, yearBought: 2021 },
  ];
  return rows as OwnedAsset[];
}

function ownedRow(defId: string): OwnedAsset {
  return { id: 'a9', defId, label: 'Old Car', paid: 4000, value: 3000, yearBought: 2019 };
}

const TODDLER_TAIL = ' found a permanent marker and every white wall in the house.';

describe('events-adult against a drifted save', () => {
  it('falls back when a person row carries no usable name', () => {
    for (const name of [undefined, null, 42, '', '   ']) {
      const state = newLife(7, 30);
      driftName(newChild(state, 3, 'Nina Moreno'), name);
      const reg = registryOf([defOf('ev-adult-toddler-chaos')]);

      const entries = eventsPhase(ctxOf(state, reg, alwaysDraws()));

      expect(entries[0]?.text, `name ${String(name)} was not handled`).toBe(
        `Your toddler${TODDLER_TAIL}`
      );
    }
  });

  it('still calls a named child by their first name', () => {
    const state = newLife(7, 30);
    newChild(state, 3, 'Nina Moreno');
    const reg = registryOf([defOf('ev-adult-toddler-chaos')]);

    const entries = eventsPhase(ctxOf(state, reg, alwaysDraws()));

    expect(entries[0]?.text).toBe(`Nina${TODDLER_TAIL}`);
  });

  it('evaluates every condition in the pack against drifted asset rows', () => {
    const state = newLife(8, 30);
    state.character.flags.livesWithParents = false;
    state.character.assets = driftedAssets();
    const ctx = ctxOf(state, registryOf(adultEvents));
    const before = state.rngState;

    for (const def of adultEvents) {
      expect(() => def.condition?.(ctx), `event "${def.id}" threw`).not.toThrow();
    }
    expect(state.rngState).toBe(before);
  });

  it('counts no drifted row as an owned vehicle, and spends no randomness', () => {
    const state = newLife(8, 30);
    state.character.assets = driftedAssets();
    const reg = registryOf([defOf('ev-adult-flat-tire')]);
    const before = state.rngState;

    expect(eventsPhase(ctxOf(state, reg))).toEqual([]);
    expect(state.rngState).toBe(before);
  });

  it('still reads a `veh-` row this build no longer ships as a car', () => {
    const state = newLife(8, 30);
    state.character.assets = [...driftedAssets(), ownedRow('veh-retired-def')];
    const reg = registryOf([defOf('ev-adult-flat-tire')]);

    const entries = eventsPhase(ctxOf(state, reg, alwaysDraws()));

    expect(entries[0]?.text).toBe('Flat tire, pouring rain, no spare.');
  });

  it('leaves a character with only drifted rows renting', () => {
    const state = newLife(9, 30);
    state.character.flags.livesWithParents = false;
    state.character.assets = driftedAssets();
    const reg = registryOf([defOf('ev-adult-rent-hike')]);

    const entries = eventsPhase(ctxOf(state, reg, alwaysDraws()));

    expect(entries[0]?.text).toBe(
      'Your landlord raised the rent, then repainted the hallway to justify it.'
    );
  });
});
