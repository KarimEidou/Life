import { beforeEach, describe, expect, it } from 'vitest';

import { getRegistry, resetRegistryForTests } from '@/content';
import { eventsTeenPack } from '@/content/events-teen';
import { eventsPhase } from '@/engine/phases/events';
import { buildRegistry } from '@/engine/registry';
import { createRng } from '@/engine/rng';
import { addPerson, createLife } from '@/engine/state';
import type { ContentRegistry, Ctx, EventDef, GameState, Person } from '@/types';

/**
 * Content rules the packs enforce themselves, because the engine cannot.
 *
 * `eventsPhase` keeps drawing every year regardless of `character.prison`; the
 * only thing that keeps a food-court shift out of a cell is the def's own
 * `condition`. These tests hold the teen pack to that contract.
 */

const TEEN_EVENTS: readonly EventDef[] = eventsTeenPack.events ?? [];

/** Every age the pack's windows can open on. */
const TEEN_AGES = [13, 14, 15, 16, 17] as const;

function kin(over: Partial<Person> & Pick<Person, 'kind' | 'name' | 'age'>): Omit<Person, 'id'> {
  return { gender: 'female', alive: true, rel: 70, flags: {}, ...over };
}

/**
 * A teenager every event in the pack could plausibly draw for: living parents, a
 * sibling, school, and (when `attached`) a partner and a weekend job. Two runs
 * are needed because `isSingle` and the heartbreak gate are mutually exclusive.
 */
function teenager(reg: ContentRegistry, attached: boolean): GameState {
  const state = createLife(reg, {
    seed: 7,
    firstName: 'Ada',
    lastName: 'Moreno',
    // `ev-teen-voice-crack` is the one event with a gender gate.
    gender: 'male',
    countryId: 'us',
  });
  state.people = {};
  addPerson(state, kin({ kind: 'mother', name: 'Rosa Moreno', age: 44 }));
  addPerson(state, kin({ kind: 'father', name: 'Luis Moreno', age: 46, gender: 'male' }));
  addPerson(state, kin({ kind: 'sibling', name: 'Nina Moreno', age: 15 }));
  state.character.education.enrolledIn = 'sch-high';
  if (attached) {
    addPerson(state, kin({ kind: 'partner', name: 'Sam Ruiz', age: 16 }));
    state.character.job = {
      jobId: 'job-retail',
      title: 'Weekend help',
      salary: 9000,
      years: 1,
      performance: 60,
      workHard: false,
    };
  }
  return state;
}

function ctxAt(state: GameState, reg: ContentRegistry, age: number): Ctx {
  state.character.age = age;
  return { state, c: state.character, rng: createRng(state), reg };
}

/** True where `isEligible` would accept the def: it only refuses a hard `false`. */
function passes(def: EventDef, ctx: Ctx): boolean {
  return def.condition?.(ctx) !== false;
}

describe('teen pack prison exclusion', () => {
  let reg: ContentRegistry;

  beforeEach(() => {
    resetRegistryForTests();
    reg = getRegistry();
  });

  it('ships events, all of which declare a condition', () => {
    expect(TEEN_EVENTS.length).toBeGreaterThan(0);
    for (const def of TEEN_EVENTS) {
      expect(def.condition, `event "${def.id}" has no condition`).toBeTypeOf('function');
    }
  });

  it('refuses every teen event while the character is incarcerated', () => {
    for (const attached of [false, true]) {
      const state = teenager(reg, attached);
      /* The job is deliberately left standing, which a real sentence would have
         cleared: the work events have to be refused by the prison gate itself. */
      state.character.prison = { crime: 'crime-assault', yearsLeft: 2, totalYears: 3 };

      for (const age of TEEN_AGES) {
        const ctx = ctxAt(state, reg, age);
        for (const def of TEEN_EVENTS) {
          expect(
            passes(def, ctx),
            `event "${def.id}" is eligible at age ${age} from a cell`
          ).toBe(false);
        }
      }
    }
  });

  /* Guards the test above against passing vacuously: a pack whose every event
     was conditioned out for some unrelated reason would satisfy it too. */
  it('still offers every teen event to a teenager who is not inside', () => {
    const states = [teenager(reg, false), teenager(reg, true)];

    for (const def of TEEN_EVENTS) {
      const inWindow = TEEN_AGES.filter((age) => age >= def.minAge && age <= def.maxAge);
      const eligibleSomewhere = states.some((state) =>
        inWindow.some((age) => passes(def, ctxAt(state, reg, age)))
      );
      expect(eligibleSomewhere, `event "${def.id}" can never fire`).toBe(true);
    }
  });

  it('draws nothing and spends no randomness on a teen-only pool from a cell', () => {
    const teenOnly = buildRegistry([eventsTeenPack]);
    const state = teenager(teenOnly, false);
    state.character.age = 16;
    state.character.prison = { crime: 'crime-burglary', yearsLeft: 4, totalYears: 6 };
    const before = state.rngState;

    const ctx: Ctx = { state, c: state.character, rng: createRng(state), reg: teenOnly };
    const entries = eventsPhase(ctx);

    expect(entries).toEqual([]);
    expect(state.pending).toEqual([]);
    // The pool is empty, so `eventsPhase` returns before rolling its first chance.
    expect(state.rngState).toBe(before);
  });

  it('spends randomness on the same pool once the sentence is over', () => {
    const teenOnly = buildRegistry([eventsTeenPack]);
    const state = teenager(teenOnly, false);
    state.character.age = 16;
    const before = state.rngState;

    eventsPhase({ state, c: state.character, rng: createRng(state), reg: teenOnly });

    expect(state.rngState).not.toBe(before);
  });
});

/**
 * Dropping out is reachable at any age and permanent (`flags.droppedOut` stops
 * `startSchool` re-enrolling anyone), so tryouts, prom and exams have to be
 * refused for the rest of the life, not just while the character is inside.
 */
describe('teen pack school gate', () => {
  const SCHOOL_EVENTS = TEEN_EVENTS.filter((def) => def.area === 'school');

  let reg: ContentRegistry;

  beforeEach(() => {
    resetRegistryForTests();
    reg = getRegistry();
  });

  /** The same teenager, after leaving school for good. */
  function dropout(attached: boolean): GameState {
    const state = teenager(reg, attached);
    state.character.education.enrolledIn = undefined;
    state.character.flags.droppedOut = true;
    return state;
  }

  it('refuses every school event to a dropout', () => {
    expect(SCHOOL_EVENTS.map((def) => def.id)).toEqual(
      expect.arrayContaining(['ev-teen-tryouts', 'ev-teen-preprom'])
    );

    for (const attached of [false, true]) {
      const state = dropout(attached);
      for (const age of TEEN_AGES) {
        const ctx = ctxAt(state, reg, age);
        for (const def of SCHOOL_EVENTS) {
          expect(
            passes(def, ctx),
            `event "${def.id}" is eligible at age ${age} for a dropout`
          ).toBe(false);
        }
      }
    }
  });

  /* Guards the test above against passing vacuously: leaving school ends the
     school year, not the life. */
  it('still offers every event outside school to a dropout', () => {
    const states = [dropout(false), dropout(true)];

    for (const def of TEEN_EVENTS.filter((event) => event.area !== 'school')) {
      const inWindow = TEEN_AGES.filter((age) => age >= def.minAge && age <= def.maxAge);
      const eligibleSomewhere = states.some((state) =>
        inWindow.some((age) => passes(def, ctxAt(state, reg, age)))
      );
      expect(eligibleSomewhere, `event "${def.id}" can never fire for a dropout`).toBe(true);
    }
  });
});
