import { describe, expect, it } from 'vitest';

import { namesPack } from '@/content/names';
import { relationshipsPack } from '@/content/relationships';
import { applyEffects } from '@/engine/effects';
import { availableInteractions, runInteraction } from '@/engine/interactions';
import { eventsPhase } from '@/engine/phases/events';
import { buildRegistry } from '@/engine/registry';
import { addPerson, createLife } from '@/engine/state';
import type {
  ContentRegistry,
  Ctx,
  EventDef,
  GameState,
  Gender,
  InteractionDef,
  Person,
  RelKind,
  Rng,
} from '@/types';

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
 * pack owns the years after a conviction, cellmates included. `eventsPhase`
 * keeps drawing while the character is inside, so each event has to sit those
 * years out on its own — nothing upstream does it for them.
 *
 * The divorce settlement is the pack's one money write that is a share of the
 * balance rather than a fixed delta, so it writes `character.money` by hand —
 * and it does so through `clampMoney`, the only supported way to write money,
 * which is what makes a balance that came back poisoned heal on the write
 * instead of surviving it.
 *
 * A row that asks somebody for something carries two ages: its `condition`
 * gates the person on the other end, and only `minAge` gates the character. The
 * cheque row needs both, or the life's first income arrives in the cot.
 *
 * Twins are minted from two independent draws over one pool and both take the
 * character's surname, so the second name has to be rolled from a list the
 * first was taken out of — the sheet keys its rows on id, and two children
 * under one name are two people the player cannot tell apart.
 */

const EMPTY = buildRegistry([]);
const relEvents: EventDef[] = relationshipsPack.events ?? [];
const relInteractions: InteractionDef[] = relationshipsPack.interactions ?? [];

function defOf(id: string): EventDef {
  const def = relEvents.find((candidate) => candidate.id === id);
  if (!def) throw new Error(`relationships ships no "${id}"`);
  return def;
}

function interactionOf(id: string): InteractionDef {
  const def = relInteractions.find((candidate) => candidate.id === id);
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

describe('the prison gate on every event', () => {
  const SENTENCE = { crime: 'Robbery', yearsLeft: 8, totalYears: 8 };

  function addKin(state: GameState, kind: RelKind, name: string, age: number): Person {
    return addPerson(state, {
      kind,
      name,
      gender: 'male',
      age,
      alive: true,
      rel: START_REL,
      flags: {},
    });
  }

  /** One of every relationship the pack's events look for, so the only thing
   *  left that can refuse a condition is the sentence. */
  function peopledLife(): GameState {
    const state = newLife(4, 40);
    addKin(state, 'spouse', 'Sam Moreno', 41);
    addKin(state, 'sibling', 'Luca Moreno', 38);
    addKin(state, 'friend', 'Alex Reed', 40);
    addKin(state, 'enemy', 'Dana Vale', 40);
    addKin(state, 'pet', 'Rex', 4);
    addChild(state, 'Noah Moreno', 'male', 1);
    addChild(state, 'Emily Moreno', 'female', 18);
    return state;
  }

  it('lets every event through out in the world', () => {
    const ctx = ctxOf(peopledLife(), EMPTY, alwaysDraws());

    for (const def of relEvents) {
      expect(def.condition?.(ctx) ?? true, def.id).toBe(true);
    }
  });

  it('refuses every event while the character is inside', () => {
    const state = peopledLife();
    state.character.prison = { ...SENTENCE };
    const ctx = ctxOf(state, EMPTY, alwaysDraws());

    for (const def of relEvents) {
      expect(def.condition?.(ctx) ?? true, def.id).toBe(false);
    }
  });

  /* The pool is built before the yearly roll, so a cell year draws nothing at
     all rather than drawing and discarding. */
  it('deals no card and charges nothing in a cell year', () => {
    const state = peopledLife();
    state.character.prison = { ...SENTENCE };
    const money = state.character.money;

    const entries = eventsPhase(ctxOf(state, registryOf(relEvents), alwaysDraws()));

    expect(entries).toEqual([]);
    expect(state.pending).toEqual([]);
    expect(state.phase).toBe('alive');
    expect(state.character.money).toBe(money);
  });
});

describe('rel-make-friend', () => {
  const FULL = buildRegistry([relationshipsPack]);

  function idsOffered(state: GameState): string[] {
    return availableInteractions(state, FULL, 'relationship').map((def) => def.id);
  }

  /* PersonSheet is the only surface that lists this area, and it runs every row
     at the person the player tapped, so the gate is asked with a target in hand
     — including on a visiting day, where the target is the whole point. */
  it('is offered out in the world and mints the friend it names', () => {
    const state = newLife(3, 30);
    const tapped = addChild(state, 'Noah Moreno', 'male', 12);
    const before = Object.keys(state.people).length;

    expect(idsOffered(state)).toContain('rel-make-friend');

    const result = runInteraction(state, FULL, 'rel-make-friend', tapped.id);

    expect(result?.text).toMatch(/^You met .+\. You get on\.$/);
    expect(Object.keys(state.people)).toHaveLength(before + 1);
  });

  it('is refused behind bars, where nobody meets anyone at the laundromat', () => {
    const state = newLife(3, 30);
    state.character.prison = { crime: 'Robbery', yearsLeft: 8, totalYears: 8 };
    const tapped = addChild(state, 'Noah Moreno', 'male', 12);
    const before = Object.keys(state.people).length;
    const cursor = state.rngState;

    expect(idsOffered(state)).not.toContain('rel-make-friend');

    const result = runInteraction(state, FULL, 'rel-make-friend', tapped.id);

    expect(result?.text).toBe("You can't do that right now.");
    expect(Object.keys(state.people)).toHaveLength(before);
    // A refused row rolls nothing: no name, no age, no meeting place.
    expect(state.rngState).toBe(cursor);
  });
});

describe('rel-ask-money', () => {
  const FULL = buildRegistry([relationshipsPack]);
  const MIN_CHEQUE = 200;
  const MAX_CHEQUE = 2000;

  /** The mother `createLife` mints, whose affinity is the payout's own gate. */
  function motherOf(state: GameState): Person {
    const people: Person[] = Object.values(state.people);
    const mother = people.find((person) => person.kind === 'mother');
    if (!mother) throw new Error('createLife minted no mother');
    return mother;
  }

  function lifeWithMother(age: number): { state: GameState; mother: Person } {
    const state = newLife(6, age);
    const mother = motherOf(state);
    // Over the row's own `t.rel > 60`, like every parent rolled at 70-100.
    mother.rel = 80;
    return { state, mother };
  }

  function idsOffered(state: GameState): string[] {
    return availableInteractions(state, FULL, 'relationship').map((def) => def.id);
  }

  it('is refused while the character is too young to be asking', () => {
    const { state, mother } = lifeWithMother(0);
    const cursor = state.rngState;

    expect(idsOffered(state)).not.toContain('rel-ask-money');

    const result = runInteraction(state, FULL, 'rel-ask-money', mother.id);

    expect(result?.text).toBe("You're too young.");
    // A refusal costs nothing: no cheque, no draw, no cooldown stamp.
    expect(state.character.money).toBe(0);
    expect(state.rngState).toBe(cursor);
    expect(mother.rel).toBe(80);
    expect(state.interactionUse['rel-ask-money']).toBeUndefined();
  });

  it('pays out once the character is old enough to ask', () => {
    const { state, mother } = lifeWithMother(6);

    expect(idsOffered(state)).toContain('rel-ask-money');

    const result = runInteraction(state, FULL, 'rel-ask-money', mother.id);

    expect(result?.text).toMatch(/ wrote you a cheque and did not ask what for\.$/);
    expect(state.character.money).toBeGreaterThanOrEqual(MIN_CHEQUE);
    expect(state.character.money).toBeLessThanOrEqual(MAX_CHEQUE);
  });
});

describe('rel-divorce', () => {
  const FULL = buildRegistry([relationshipsPack]);
  const SETTLEMENT = 'The settlement took 40% of your cash.';

  function marriedLife(money: number): { state: GameState; spouse: Person } {
    const state = newLife(5, 40);
    const spouse = addPerson(state, {
      kind: 'spouse',
      name: 'Sam Moreno',
      gender: 'male',
      age: 41,
      alive: true,
      rel: START_REL,
      flags: {},
    });
    state.character.money = money;
    return { state, spouse };
  }

  it('leaves the whole 60% its own log line quotes', () => {
    const { state, spouse } = marriedLife(1001);

    const result = runInteraction(state, FULL, 'rel-divorce', spouse.id);

    expect(result?.entries.map((entry) => entry.text)).toContain(SETTLEMENT);
    // round(1001 * 0.6): whole dollars, and the 40% the line quotes.
    expect(state.character.money).toBe(601);
    expect(spouse.kind).toBe('ex');
  });

  /* The settlement is not the one write a poisoned balance may survive: a
     drifted save reaches `clampMoney` here like it would through any
     `{kind:'money'}` effect, and heals rather than staying unreadable. */
  it('heals an unreadable balance instead of leaving it in place', () => {
    const { state, spouse } = marriedLife(Number.NaN);

    const result = runInteraction(state, FULL, 'rel-divorce', spouse.id);

    expect(result?.entries.map((entry) => entry.text)).toContain(SETTLEMENT);
    expect(state.character.money).toBe(0);
    expect(spouse.kind).toBe('ex');
  });
});

describe('rel-try-baby', () => {
  /** The pools the shipped game rolls names from, keyed to the life's country. */
  const NAMED = buildRegistry([namesPack]);
  const PICKS_PER_TWIN_BIRTH = 4;

  /** Every pick lands on the head of its list — two draws over one pool of
   *  given names, which is the collision the branch has to break — and counts
   *  itself, so what breaking it costs in draws is visible. */
  function headPicks(): { rng: Rng; picks: () => number } {
    const base = alwaysDraws();
    let picks = 0;
    const rng: Rng = {
      ...base,
      pick: <T,>(arr: readonly T[]): T => {
        picks += 1;
        return base.pick(arr);
      },
    };
    return { rng, picks: () => picks };
  }

  function marriedLife(): { state: GameState; spouse: Person } {
    const state = newLife(7, 30);
    const spouse = addPerson(state, {
      kind: 'spouse',
      name: 'Sam Moreno',
      gender: 'male',
      age: 31,
      alive: true,
      rel: START_REL,
      flags: {},
    });
    return { state, spouse };
  }

  it('mints twins under two names rather than one name twice', () => {
    const { state, spouse } = marriedLife();
    const { rng, picks } = headPicks();
    const ctx: Ctx = { ...ctxOf(state, NAMED, rng), target: spouse };

    const result = interactionOf('rel-try-baby').resolve(ctx);
    // Two genders and two given names: the second name still costs one draw.
    expect(picks()).toBe(PICKS_PER_TWIN_BIRTH);

    applyEffects({ state, rng, reg: NAMED, target: spouse }, result.effects);

    const people: Person[] = Object.values(state.people);
    const twins = people.filter((person) => person.kind === 'child');
    expect(twins).toHaveLength(2);
    expect(twins[0]?.name).not.toBe(twins[1]?.name);
    expect(result.text).toBe(
      `Twins. Meet ${twins[0]?.name} and ${twins[1]?.name}. Nobody is sleeping again.`
    );
  });
});
