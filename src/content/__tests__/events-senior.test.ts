import { describe, expect, it } from 'vitest';

import { eventsSeniorPack } from '@/content/events-senior';
import { resolveChoice } from '@/engine/ageUp';
import { careerPhase } from '@/engine/phases/career';
import { eventsPhase } from '@/engine/phases/events';
import { buildRegistry } from '@/engine/registry';
import { createRng } from '@/engine/rng';
import { addPerson, createLife } from '@/engine/state';
import type { ContentRegistry, Ctx, EventDef, GameState, JobState, Person, Rng } from '@/types';

/**
 * Senior pack contract: the two work events answer to a career, not to an empty
 * job slot, and "a grandkid" means the pack's stand-in for one — a child of 25
 * or more — wherever a card says so.
 *
 * `careerPhase` is the only writer of `pensionSalary` and it retires at 70, so
 * "no job right now" is true of every never-employed, expelled and lifelong
 * student character from 65 on — and it is false of the one life the send-off is
 * written for, right up until the engine retires them. These tests run the real
 * shipped defs through the real phases.
 */

const EMPTY = buildRegistry([]);
const seniorEvents: EventDef[] = eventsSeniorPack.events ?? [];

const PARTY = 'ev-senior-retirement-party';
const REUNION = 'ev-senior-coworker-reunion';
const TECH = 'ev-senior-tech-struggle';

const PARTY_TEXT =
  'Your old department threw you a retirement party. The sheet cake spelled your name wrong.';
const REUNION_TEXT =
  'The old team met for lunch. Half of them are retired and half are pretending not to be.';

function defOf(id: string): EventDef {
  const def = seniorEvents.find((candidate) => candidate.id === id);
  if (!def) throw new Error(`events-senior ships no "${id}"`);
  return def;
}

/** A registry holding only the defs under test, so the drawn pool is exactly them. */
function registryOf(defs: EventDef[]): ContentRegistry {
  return buildRegistry([{ id: 'events-senior-under-test', events: defs }]);
}

function newLife(seed: number, age: number): GameState {
  const state = createLife(EMPTY, { seed, firstName: 'Ada', lastName: 'Moreno' });
  state.character.age = age;
  state.character.stats.happiness = 50;
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

function job(): JobState {
  return {
    jobId: 'j-clerk',
    title: 'Clerk',
    salary: 30000,
    years: 12,
    performance: 60,
    workHard: false,
  };
}

/** What a finished career leaves behind when no pension was ever minted. */
function pastCareer(state: GameState): void {
  state.character.flags.jobsHeld = 3;
  state.character.flags.lastJobTitle = 'Clerk';
}

/** A living child of the given age, appended to the table in call order. */
function child(state: GameState, name: string, age: number, rel: number): Person {
  return addPerson(state, {
    kind: 'child',
    name,
    gender: 'female',
    age,
    alive: true,
    rel,
    flags: {},
  });
}

function labelsOf(state: GameState): string[] {
  return (state.pending[0]?.choices ?? []).map((choice) => choice.label);
}

function jail(state: GameState): void {
  state.character.prison = { crime: 'Bank Robbery', yearsLeft: 4, totalYears: 8 };
  state.character.job = null;
}

describe('ev-senior-retirement-party', () => {
  it('stays out of the pool for a life that never held a job, and spends no randomness', () => {
    const state = newLife(1, 66);
    const reg = registryOf([defOf(PARTY)]);
    const before = state.rngState;

    expect(eventsPhase(ctxOf(state, reg))).toEqual([]);
    // No department, no cake, and above all no $250 and no mood for a career that never was.
    expect(state.character.money).toBe(0);
    expect(state.character.stats.happiness).toBe(50);
    expect(state.rngState).toBe(before);
    expect(state.firedEvents).toEqual([]);
  });

  it('counts an empty counter and an empty title as no career at all', () => {
    const state = newLife(1, 66);
    state.character.flags.jobsHeld = 0;
    state.character.flags.lastJobTitle = '';
    const reg = registryOf([defOf(PARTY)]);
    const before = state.rngState;

    expect(eventsPhase(ctxOf(state, reg))).toEqual([]);
    expect(state.rngState).toBe(before);
  });

  it('stays out of the pool while the character is still working', () => {
    const state = newLife(2, 66);
    state.character.job = job();
    state.character.flags.jobsHeld = 3;
    const reg = registryOf([defOf(PARTY)]);
    const before = state.rngState;

    expect(eventsPhase(ctxOf(state, reg))).toEqual([]);
    expect(state.rngState).toBe(before);
    // The once-per-life slot must still be there for the year they actually leave.
    expect(state.firedEvents).toEqual([]);
  });

  it('throws the party in the year the career phase retires the character', () => {
    const state = newLife(3, 70);
    state.character.job = job();
    state.character.flags.jobsHeld = 3;
    const reg = registryOf([defOf(PARTY)]);

    const retirement = careerPhase(ctxOf(state, reg));
    expect(retirement.map((entry) => entry.text)).toEqual(['You retired at 70.']);
    expect(state.character.job).toBeNull();

    const entries = eventsPhase(ctxOf(state, reg, alwaysDraws()));

    expect(entries[0]?.text).toBe(PARTY_TEXT);
    expect(state.character.money).toBe(250);
    expect(state.character.stats.happiness).toBe(59);
    expect(state.firedEvents).toEqual([PARTY]);
  });

  it('throws the party for a career that ended before a pension was ever minted', () => {
    const state = newLife(4, 66);
    pastCareer(state);
    const reg = registryOf([defOf(PARTY)]);

    const entries = eventsPhase(ctxOf(state, reg, alwaysDraws()));

    expect(entries[0]?.text).toBe(PARTY_TEXT);
    expect(state.character.money).toBe(250);
  });

  it('stays drawable from retirement age to the end of the window', () => {
    for (const age of [70, 75, 80]) {
      const state = newLife(5, age);
      state.character.flags.pensionSalary = 9000;
      const reg = registryOf([defOf(PARTY)]);

      const entries = eventsPhase(ctxOf(state, reg, alwaysDraws()));

      expect(entries[0]?.text, `age ${age} could not draw the party`).toBe(PARTY_TEXT);
    }
  });

  it('keeps the window shut on either side of the senior years', () => {
    for (const age of [64, 81]) {
      const state = newLife(6, age);
      state.character.flags.pensionSalary = 9000;
      const reg = registryOf([defOf(PARTY)]);
      const before = state.rngState;

      expect(eventsPhase(ctxOf(state, reg)), `age ${age} drew the party`).toEqual([]);
      expect(state.rngState).toBe(before);
    }
  });
});

describe('ev-senior-coworker-reunion', () => {
  it('stays out of the pool for a life that never held a job, and spends no randomness', () => {
    const state = newLife(7, 68);
    const reg = registryOf([defOf(REUNION)]);
    const before = state.rngState;

    expect(eventsPhase(ctxOf(state, reg))).toEqual([]);
    expect(state.character.money).toBe(0);
    expect(state.rngState).toBe(before);
  });

  it('meets the old team for a retired career, and for one still going', () => {
    const retired = newLife(8, 68);
    pastCareer(retired);
    const stillWorking = newLife(8, 68);
    stillWorking.character.job = job();
    stillWorking.character.flags.jobsHeld = 1;

    for (const state of [retired, stillWorking]) {
      // `clampMoney` floors the balance at zero, so the lunch needs paying for.
      state.character.money = 1000;
      const reg = registryOf([defOf(REUNION)]);

      const entries = eventsPhase(ctxOf(state, reg, alwaysDraws()));

      expect(entries[0]?.text).toBe(REUNION_TEXT);
      expect(state.character.money).toBe(965);
    }
  });
});

describe('events-senior work events in prison', () => {
  /* Both conditions were rewritten around the career flags, which a prisoner
     keeps: `free` has to survive that rewrite or the prison pack loses the year. */
  it('leaves neither work event drawable while the character is inside', () => {
    const state = newLife(9, 71);
    pastCareer(state);
    state.character.flags.pensionSalary = 9000;
    jail(state);
    const reg = registryOf([defOf(PARTY), defOf(REUNION)]);
    const before = state.rngState;

    expect(eventsPhase(ctxOf(state, reg))).toEqual([]);
    expect(state.rngState).toBe(before);
    expect(state.firedEvents).toEqual([]);
  });
});

describe('ev-senior-tech-struggle', () => {
  const CALL = 'Call a grandkid';
  const FIXED = 'Fixed in ninety seconds. You were told, again, to stop tapping so hard.';

  it('keeps the grandkid call off the card while the only child is a small one', () => {
    // `rel-adopt` carries no upper age, so a 70-year-old can be the parent of a four-year-old.
    const state = newLife(10, 70);
    child(state, 'Nina Moreno', 4, 60);
    const reg = registryOf([defOf(TECH)]);

    eventsPhase(ctxOf(state, reg, alwaysDraws()));

    expect(state.phase).toBe('awaitingChoice');
    expect(labelsOf(state)).toEqual(['Work it out yourself', 'Put it in a drawer']);
  });

  it('offers it as soon as a child is old enough to have kids of their own', () => {
    const state = newLife(11, 70);
    child(state, 'Nina Moreno', 25, 60);
    const reg = registryOf([defOf(TECH)]);

    eventsPhase(ctxOf(state, reg, alwaysDraws()));

    expect(labelsOf(state)).toEqual([CALL, 'Work it out yourself', 'Put it in a drawer']);
  });

  it('lands the affinity on the grown child, not on whichever child the table lists first', () => {
    const state = newLife(12, 70);
    const small = child(state, 'Nina Moreno', 4, 60);
    const grown = child(state, 'Bea Moreno', 45, 50);
    const reg = registryOf([defOf(TECH)]);

    eventsPhase(ctxOf(state, reg, alwaysDraws()));
    expect(labelsOf(state)[0]).toBe(CALL);

    // This seed rolls the first outcome, the only one that moves affinity.
    resolveChoice(state, reg, 0);

    expect(state.log[0]?.entries.map((entry) => entry.text)).toContain(FIXED);
    expect(grown.rel).toBe(53);
    expect(small.rel).toBe(60);
  });
});
