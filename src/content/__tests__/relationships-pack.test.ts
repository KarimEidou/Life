import { describe, expect, it } from 'vitest';

import { relationshipsPack } from '@/content/relationships';
import { availableInteractions, runInteraction } from '@/engine/interactions';
import { eventsPhase } from '@/engine/phases/events';
import { buildRegistry } from '@/engine/registry';
import { addPerson, createLife } from '@/engine/state';
import type { ContentRegistry, Ctx, EventDef, GameState, Gender, Person, Rng } from '@/types';

/**
 * Relationships pack contract.
 *
 * The pack's child events pick their person by age window rather than by id, and
 * they pick twice: once to write the feed line, once again inside the effect. A
 * life can hold several children, and the lookup is a `find` over insertion
 * order, so the two windows have to be identical or the meter that moves belongs
 * to a different child than the one the line names.
 *
 * The rows that mint a person are gated on being out in the world: the prison
 * pack owns the years after a conviction, cellmates included.
 */

const EMPTY = buildRegistry([]);
const relEvents: EventDef[] = relationshipsPack.events ?? [];

function defOf(id: string): EventDef {
  const def = relEvents.find((candidate) => candidate.id === id);
  if (!def) throw new Error(`relationships ships no "${id}"`);
  return def;
}

/** A registry holding only the def under test, so the drawn pool is exactly it. */
function registryOf(defs: EventDef[]): ContentRegistry {
  return buildRegistry([{ id: 'relationships-under-test', events: defs }]);
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

function ctxOf(state: GameState, reg: ContentRegistry, rng: Rng): Ctx {
  return { state, c: state.character, rng, reg };
}

const START_REL = 50;

function addChild(state: GameState, name: string, gender: Gender, age: number): Person {
  return addPerson(state, {
    kind: 'child',
    name,
    gender,
    age,
    alive: true,
    rel: START_REL,
    flags: {},
  });
}

describe('ev-rel-child-first-steps', () => {
  it('moves the affinity of the child the feed line names, not an older sibling', () => {
    const state = newLife(1, 40);
    /* Inserted oldest-first, which is birth order: the elder child sits ahead of
       the toddler in the `find` the effect runs. */
    const elder = addChild(state, 'Emily Moreno', 'female', 3);
    const toddler = addChild(state, 'Noah Moreno', 'male', 1);

    const reg = registryOf([defOf('ev-rel-child-first-steps')]);

    const entries = eventsPhase(ctxOf(state, reg, alwaysDraws()));

    expect(entries[0]?.text).toBe('Noah took three steps and landed on the dog bowl.');
    expect(toddler.rel).toBe(START_REL + 6);
    expect(elder.rel).toBe(START_REL);
  });
});

describe('ev-rel-child-graduates', () => {
  it('moves the affinity of the child the feed line names, not an older sibling', () => {
    const state = newLife(2, 45);
    const elder = addChild(state, 'Emily Moreno', 'female', 20);
    const graduate = addChild(state, 'Noah Moreno', 'male', 18);

    const reg = registryOf([defOf('ev-rel-child-graduates')]);

    const entries = eventsPhase(ctxOf(state, reg, alwaysDraws()));

    expect(entries[0]?.text).toBe(
      'Noah graduated. You cried in the third row and denied it after.'
    );
    expect(graduate.rel).toBe(START_REL + 8);
    expect(elder.rel).toBe(START_REL);
  });
});

describe('rel-make-friend', () => {
  const FULL = buildRegistry([relationshipsPack]);

  function idsOffered(state: GameState): string[] {
    return availableInteractions(state, FULL, 'relationship').map((def) => def.id);
  }

  it('is offered out in the world and mints the friend it names', () => {
    const state = newLife(3, 30);
    const before = Object.keys(state.people).length;

    expect(idsOffered(state)).toContain('rel-make-friend');

    const result = runInteraction(state, FULL, 'rel-make-friend');

    expect(result?.text).toMatch(/^You met .+\. You get on\.$/);
    expect(Object.keys(state.people)).toHaveLength(before + 1);
  });

  it('is refused behind bars, where nobody meets anyone at the laundromat', () => {
    const state = newLife(3, 30);
    state.character.prison = { crime: 'Robbery', yearsLeft: 8, totalYears: 8 };
    const before = Object.keys(state.people).length;
    const cursor = state.rngState;

    expect(idsOffered(state)).not.toContain('rel-make-friend');

    const result = runInteraction(state, FULL, 'rel-make-friend');

    expect(result?.text).toBe("You can't do that right now.");
    expect(Object.keys(state.people)).toHaveLength(before);
    // A refused row rolls nothing: no name, no age, no meeting place.
    expect(state.rngState).toBe(cursor);
  });
});
