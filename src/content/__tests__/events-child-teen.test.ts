import { beforeEach, describe, expect, it } from 'vitest';

import { getRegistry, resetRegistryForTests } from '@/content';
import { eventsChildPack } from '@/content/events-child';
import { eventsTeenPack } from '@/content/events-teen';
import { resolveChoice } from '@/engine/ageUp';
import { applyEffects } from '@/engine/effects';
import { eventsPhase } from '@/engine/phases/events';
import { buildRegistry } from '@/engine/registry';
import { createRng } from '@/engine/rng';
import { addPerson, createLife } from '@/engine/state';
import type {
  ContentRegistry,
  Ctx,
  Effect,
  EffectCtx,
  EventDef,
  GameState,
  Person,
  RelKind,
} from '@/types';

/**
 * Content rules the packs enforce themselves, because the engine cannot.
 *
 * `eventsPhase` keeps drawing every year regardless of `character.prison`; the
 * only thing that keeps a food-court shift out of a cell is the def's own
 * `condition`. These tests hold the teen pack to that contract.
 */

const TEEN_EVENTS: readonly EventDef[] = eventsTeenPack.events ?? [];
const CHILD_EVENTS: readonly EventDef[] = eventsChildPack.events ?? [];

/** Every age the pack's windows can open on. */
const TEEN_AGES = [13, 14, 15, 16, 17] as const;

/* `agingPhase` increments before `eventsPhase` runs, so age 0 is never drawn on
   and the pack's two `minAge: 0` events are age-1-only in practice. */
const CHILD_AGES: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** The age `education.advanceCompulsory` enrols at (`PRIMARY_START`). */
const PRIMARY_START = 6;

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

/**
 * The childhood pack's school gate. The compulsory ladder only enrols at
 * `PRIMARY_START`, and `dropOut` empties the desk for good at any age
 * (`flags.droppedOut` stops `startSchool` re-enrolling anyone), while
 * `eventsPhase` draws either way — so a homework email or a snow day has to be
 * refused by the event's own condition.
 */
describe('child pack school gate', () => {
  const SCHOOL_EVENTS = CHILD_EVENTS.filter((def) => def.area === 'school');

  /* Only the school events, so an empty pool is proof the gate refused them all
     rather than the year's draw landing on something else. */
  const schoolOnly = buildRegistry([{ id: 'test-events-child-school', events: [...SCHOOL_EVENTS] }]);

  let reg: ContentRegistry;

  beforeEach(() => {
    resetRegistryForTests();
    reg = getRegistry();
  });

  /** A child with a whole family, at a desk or not. */
  function child(registry: ContentRegistry, enrolled: boolean): GameState {
    const state = createLife(registry, {
      seed: 11,
      firstName: 'Ada',
      lastName: 'Moreno',
      gender: 'female',
      countryId: 'us',
    });
    state.people = {};
    addPerson(state, kin({ kind: 'mother', name: 'Rosa Moreno', age: 34 }));
    addPerson(state, kin({ kind: 'father', name: 'Luis Moreno', age: 36, gender: 'male' }));
    addPerson(state, kin({ kind: 'sibling', name: 'Nina Moreno', age: 9 }));
    // `ev-child-snow-day` asks the country too, and a partial registry has none.
    state.character.countryId = 'us';
    if (enrolled) state.character.education.enrolledIn = 'school-primary';
    return state;
  }

  it('opens no school event before the year the ladder enrols', () => {
    expect(SCHOOL_EVENTS.map((def) => def.id)).toEqual(
      expect.arrayContaining([
        'ev-child-caught-lying',
        'ev-child-snow-day',
        'ev-child-playground-fight',
        'ev-child-hidden-talent',
        'ev-child-photo-day',
        'ev-child-talent-show',
      ])
    );

    for (const def of SCHOOL_EVENTS) {
      expect(def.minAge, `event "${def.id}" opens before school does`).toBeGreaterThanOrEqual(
        PRIMARY_START
      );
    }

    /* The window is the cosmetic half: at five the desk is empty, so the
       condition has to refuse these on its own. */
    const ctx = ctxAt(child(reg, false), reg, PRIMARY_START - 1);
    for (const def of SCHOOL_EVENTS) {
      expect(passes(def, ctx), `event "${def.id}" is eligible at five`).toBe(false);
    }
  });

  it('refuses every school event to a child who left school', () => {
    const state = child(reg, false);
    state.character.flags.droppedOut = true;

    for (const age of CHILD_AGES) {
      const ctx = ctxAt(state, reg, age);
      for (const def of SCHOOL_EVENTS) {
        expect(
          passes(def, ctx),
          `event "${def.id}" is eligible at age ${age} with no school`
        ).toBe(false);
      }
    }
  });

  /* Guards the two tests above against passing vacuously: a gate that refused
     everybody would satisfy them too. */
  it('still offers every school event to a child at their desk', () => {
    const state = child(reg, true);

    for (const def of SCHOOL_EVENTS) {
      const inWindow = CHILD_AGES.filter((age) => age >= def.minAge && age <= def.maxAge);
      const eligibleSomewhere = inWindow.some((age) => passes(def, ctxAt(state, reg, age)));
      expect(eligibleSomewhere, `event "${def.id}" can never fire`).toBe(true);
    }
  });

  it('still offers every event outside school to a child who is not enrolled', () => {
    const state = child(reg, false);

    for (const def of CHILD_EVENTS.filter((event) => event.area !== 'school')) {
      const inWindow = CHILD_AGES.filter((age) => age >= def.minAge && age <= def.maxAge);
      const eligibleSomewhere = inWindow.some((age) => passes(def, ctxAt(state, reg, age)));
      expect(eligibleSomewhere, `event "${def.id}" can never fire out of school`).toBe(true);
    }
  });

  it('draws nothing and spends no randomness on a school-only pool at five', () => {
    const state = child(schoolOnly, false);
    state.character.age = PRIMARY_START - 1;
    const before = state.rngState;

    const ctx: Ctx = { state, c: state.character, rng: createRng(state), reg: schoolOnly };
    const entries = eventsPhase(ctx);

    expect(entries).toEqual([]);
    expect(state.pending).toEqual([]);
    // The pool is empty, so `eventsPhase` returns before rolling its first chance.
    expect(state.rngState).toBe(before);
  });

  it('spends randomness on the same pool once the child is enrolled', () => {
    const state = child(schoolOnly, true);
    state.character.age = PRIMARY_START;
    const before = state.rngState;

    eventsPhase({ state, c: state.character, rng: createRng(state), reg: schoolOnly });

    expect(state.rngState).not.toBe(before);
  });
});

/**
 * The child pack's once-in-a-lifetime milestones.
 *
 * `isEligible` consults `firedEvents` only for a def that declares
 * `oncePerLife`, so a moment the text calls a first happens again in every
 * remaining year of its window unless the def says otherwise.
 */
describe('child pack first-time milestones', () => {
  /** Every child event whose own text calls the moment it narrates a first. */
  const FIRSTS: readonly string[] = [
    'ev-child-slept-through',
    'ev-child-teething',
    'ev-child-first-word',
    'ev-child-first-steps',
    'ev-child-lost-tooth',
  ];

  function defOf(id: string): EventDef {
    const def = CHILD_EVENTS.find((candidate) => candidate.id === id);
    if (!def) throw new Error(`events-child ships no "${id}"`);
    return def;
  }

  /**
   * Every age at which one def logs a line, over a single uninterrupted life.
   * The pool holds nothing else, so a year with an entry is that def firing and
   * the second draw always finds the pool empty.
   */
  function firedAges(def: EventDef): number[] {
    const registry = buildRegistry([{ id: 'test-events-child-first', events: [def] }]);
    const state = createLife(registry, {
      seed: 5,
      firstName: 'Ada',
      lastName: 'Moreno',
      gender: 'female',
      countryId: 'us',
    });
    // At a desk, so a first that happens at school is drawable in every year too.
    state.character.education.enrolledIn = 'school-primary';

    const ages: number[] = [];
    for (let age = def.minAge; age <= def.maxAge; age += 1) {
      state.character.age = age;
      const ctx: Ctx = { state, c: state.character, rng: createRng(state), reg: registry };
      if (eventsPhase(ctx).length > 0) ages.push(age);
    }
    return ages;
  }

  it('marks every event that narrates a first as oncePerLife', () => {
    for (const id of FIRSTS) {
      expect(defOf(id).oncePerLife, `event "${id}" narrates a first and can repeat`).toBe(true);
    }
  });

  it('loses the first tooth once across the five years of its window', () => {
    const def = defOf('ev-child-lost-tooth');
    // A one-year window would satisfy the test below on its own.
    expect(def.maxAge, 'the window closes the year it opens').toBeGreaterThan(def.minAge);

    expect(firedAges(def)).toHaveLength(1);
  });

  /* Guards the test above against passing vacuously: the same seed and the same
     window narrate the milestone more than once without the flag. */
  it('would lose the same first tooth again without the flag', () => {
    const repeatable: EventDef = { ...defOf('ev-child-lost-tooth'), oncePerLife: false };

    expect(firedAges(repeatable).length).toBeGreaterThan(1);
  });
});

/**
 * The teen pack's once-in-a-lifetime milestones.
 *
 * Same contract as the childhood pack: `isEligible` consults `firedEvents` only
 * for a def that declares `oncePerLife`, so a lesson the text calls a first
 * comes round again in every remaining year of its window unless the def says
 * otherwise — and a second driving lesson also re-sets `teen:canDrive` and can
 * charge the bollard twice.
 */
describe('teen pack first-time milestones', () => {
  /** Every teen event whose own text calls the moment it narrates a first. */
  const FIRSTS: readonly string[] = ['ev-teen-first-paycheck', 'ev-teen-driving-lesson'];

  function defOf(id: string): EventDef {
    const def = TEEN_EVENTS.find((candidate) => candidate.id === id);
    if (!def) throw new Error(`events-teen ships no "${id}"`);
    return def;
  }

  /**
   * Every age at which one def fires, over a single uninterrupted life. The pool
   * holds nothing else, so a year that logs a line or queues a card is that def
   * firing. A choice event logs nothing — the card carries the prompt — so the
   * queue is drained and the phase reset each year, which is what answering it
   * would leave behind.
   */
  function firedAges(def: EventDef): number[] {
    const registry = buildRegistry([{ id: 'test-events-teen-first', events: [def] }]);
    const state = createLife(registry, {
      seed: 7,
      firstName: 'Ada',
      lastName: 'Moreno',
      gender: 'male',
      countryId: 'us',
    });
    // At a desk and out of a cell, so every window is drawable in every year.
    state.character.education.enrolledIn = 'sch-high';

    const ages: number[] = [];
    for (let age = def.minAge; age <= def.maxAge; age += 1) {
      state.character.age = age;
      const ctx: Ctx = { state, c: state.character, rng: createRng(state), reg: registry };
      if (eventsPhase(ctx).length > 0 || state.pending.length > 0) ages.push(age);
      state.pending = [];
      state.phase = 'alive';
    }
    return ages;
  }

  it('marks every event that narrates a first as oncePerLife', () => {
    for (const id of FIRSTS) {
      expect(defOf(id).oncePerLife, `event "${id}" narrates a first and can repeat`).toBe(true);
    }
  });

  it('takes the first driving lesson once across both years of its window', () => {
    const def = defOf('ev-teen-driving-lesson');
    // A one-year window would satisfy the test below on its own.
    expect(def.maxAge, 'the window closes the year it opens').toBeGreaterThan(def.minAge);

    expect(firedAges(def)).toHaveLength(1);
  });

  /* Guards the test above against passing vacuously: the same seed and the same
     window narrate the same first lesson twice without the flag. */
  it('would take the same first driving lesson again without the flag', () => {
    const repeatable: EventDef = { ...defOf('ev-teen-driving-lesson'), oncePerLife: false };

    expect(firedAges(repeatable).length).toBeGreaterThan(1);
  });
});

/** A pack, plus one def of its own whose nudge is aimed at both living parents. */
type PackCase = readonly [label: string, events: readonly EventDef[], parentNudge: string];

/**
 * The affinity clamp both packs re-implement for `Person.rel`, a field
 * `applyEffects` does not own on a `fn` effect.
 *
 * `rel` comes back out of `JSON.parse` unchecked — `loadGame` inspects the save
 * version and `state.character`, never the people table — so a drifted slot can
 * hand these helpers an affinity that is not a readable number. Every other
 * write path settles one at 0 (`applyEffects` via `clampStat`, and the adult,
 * senior and relationships packs), and these two must too: nothing repairs a
 * parent or sibling afterwards, because `relationshipsPhase.drift` carries a NaN
 * forward untouched (`Math.max(0, NaN)`) for the rest of the life.
 */
describe('child and teen pack affinity clamps', () => {
  const PACKS: readonly PackCase[] = [
    ['events-child', CHILD_EVENTS, 'ev-child-slept-through'],
    ['events-teen', TEEN_EVENTS, 'ev-teen-family-dinner'],
  ];

  /** The kin these packs nudge; anyone else in the table was minted by the sweep. */
  const FAMILY_KINDS: readonly RelKind[] = ['mother', 'father', 'sibling'];

  let reg: ContentRegistry;

  beforeEach(() => {
    resetRegistryForTests();
    reg = getRegistry();
  });

  /** A whole family, every affinity starting at `rel`. */
  function family(rel: number): GameState {
    const state = createLife(reg, {
      seed: 3,
      firstName: 'Ada',
      lastName: 'Moreno',
      gender: 'female',
      countryId: 'us',
    });
    state.people = {};
    addPerson(state, kin({ kind: 'mother', name: 'Rosa Moreno', age: 40, rel }));
    addPerson(state, kin({ kind: 'father', name: 'Luis Moreno', age: 42, gender: 'male', rel }));
    addPerson(state, kin({ kind: 'sibling', name: 'Nina Moreno', age: 15, rel }));
    state.character.age = 15;
    return state;
  }

  function familyKin(state: GameState): Person[] {
    return Object.values(state.people).filter((person) => FAMILY_KINDS.includes(person.kind));
  }

  /* `Person.rel` is typed `number`, so none of these is reachable from a write
     the engine makes; they are the shapes a hand-edited or older save produces. */
  function poison(person: Person, value: unknown): void {
    (person as { rel: unknown }).rel = value;
  }

  /** Every `fn` effect a pack can run: top-level and from every choice outcome. */
  function fnEffects(events: readonly EventDef[]): Effect[] {
    return events
      .flatMap((def) => [
        ...(def.effects ?? []),
        ...(def.choices ?? []).flatMap((choice) =>
          choice.outcomes.flatMap((outcome) => outcome.effects)
        ),
      ])
      .filter((effect) => effect.kind === 'fn');
  }

  function effectCtx(state: GameState): EffectCtx {
    return { state, rng: createRng(state), reg };
  }

  /** Runs the pack's whole repertoire of `fn` effects over one family. */
  function runAll(state: GameState, events: readonly EventDef[]): void {
    for (const effect of fnEffects(events)) applyEffects(effectCtx(state), [effect]);
  }

  /** Which kin a pack reaches, read one effect at a time so nothing cancels out. */
  function nudgedKinds(events: readonly EventDef[]): Set<RelKind> {
    const kinds = new Set<RelKind>();
    for (const effect of fnEffects(events)) {
      const state = family(50);
      applyEffects(effectCtx(state), [effect]);
      for (const person of familyKin(state)) {
        if (person.rel !== 50) kinds.add(person.kind);
      }
    }
    return kinds;
  }

  it('keeps every affinity it writes inside 0..100', () => {
    for (const [label, events] of PACKS) {
      expect(fnEffects(events).length, `${label} ships no fn effect`).toBeGreaterThan(0);

      /* Both edges as well as mid-range: the nudges are signed, so only a start
         at each edge exercises the clamp in both directions. */
      for (const start of [0, 50, 100]) {
        const state = family(start);
        runAll(state, events);

        for (const person of Object.values(state.people)) {
          const note = `${label} left the ${person.kind} at ${person.rel}`;
          expect(person.rel, note).toBeGreaterThanOrEqual(0);
          expect(person.rel, note).toBeLessThanOrEqual(100);
        }
      }
    }
  });

  /* Guards the heal test below against passing vacuously: it proves nothing
     about kin the pack never writes in the first place. */
  it('nudges every kin the packs name', () => {
    for (const [label, events] of PACKS) {
      const kinds = nudgedKinds(events);

      for (const kind of FAMILY_KINDS) {
        expect(kinds.has(kind), `${label} never nudges the ${kind}`).toBe(true);
      }
    }
  });

  it('heals an unreadable affinity instead of writing it back', () => {
    for (const [label, events] of PACKS) {
      for (const value of [Number.NaN, undefined, '70']) {
        const state = family(50);
        for (const person of familyKin(state)) poison(person, value);

        runAll(state, events);

        for (const person of familyKin(state)) {
          const note = `${label} stored ${String(value)} on the ${person.kind}`;
          expect(Number.isFinite(person.rel), note).toBe(true);
          expect(person.rel, note).toBeGreaterThanOrEqual(0);
          expect(person.rel, note).toBeLessThanOrEqual(100);
        }
      }
    }
  });

  it('settles an unreadable parent affinity at 0 on the first nudge', () => {
    for (const [label, events, id] of PACKS) {
      const def = events.find((candidate) => candidate.id === id);
      if (!def) throw new Error(`${label} ships no "${id}"`);
      const state = family(50);
      for (const person of familyKin(state)) poison(person, Number.NaN);

      applyEffects(effectCtx(state), def.effects ?? []);

      for (const person of familyKin(state)) {
        // The sibling is nobody this def names, so it stays as the save left it.
        if (person.kind === 'sibling') continue;
        expect(person.rel, `${label} stored an unreadable rel on the ${person.kind}`).toBe(0);
      }
    }
  });
});

/**
 * Ages the texts state out loud.
 *
 * An outcome's text is a plain string — only an event's prompt may be a builder
 * — so the one way a line can name the character's age is the `{age}` token
 * `resolveChoice` fills through `fillTemplate`. A literal is right in at most
 * one year of a window that spans several.
 */
describe('child and teen pack age statements', () => {
  const ID = 'ev-teen-allowance';
  const CHOICE = 'Present your case';
  /** The branch of that choice which answers with the character's age. */
  const REFUSED = /get a job/;

  /** Every number a line could state an age with, spelled out. */
  const NUMBERS =
    'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|' +
    'fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty';

  /* An age stated about the character, in words or digits. The number has to
     close its clause, so a count of something else ("ten minutes late") reads as
     the prose it is rather than as an age. */
  const AGE_STATEMENT = new RegExp(
    `\\byou (?:are|were|turn|turned) (?:\\d+|${NUMBERS})\\s*(?=[.,;!?]|$)`,
    'i'
  );

  function defOf(id: string): EventDef {
    const def = TEEN_EVENTS.find((candidate) => candidate.id === id);
    if (!def) throw new Error(`events-teen ships no "${id}"`);
    return def;
  }

  /** The shipped def, with the branch under test the only one left to roll. */
  function forced(def: EventDef): ContentRegistry {
    const choices = (def.choices ?? []).map((choice) =>
      choice.label === CHOICE
        ? { ...choice, outcomes: choice.outcomes.filter((outcome) => REFUSED.test(outcome.text)) }
        : choice
    );
    const only = choices.find((choice) => choice.label === CHOICE)?.outcomes ?? [];
    expect(only, `"${CHOICE}" no longer offers the branch that states the age`).toHaveLength(1);
    return buildRegistry([{ id: 'test-events-teen-allowance', events: [{ ...def, choices }] }]);
  }

  /**
   * The line the feed prints for that branch at one age. The card is queued by
   * hand so the year's draw cannot land elsewhere; `resolveChoice` still looks
   * the def up by id and the option up by label, which is the path under test.
   */
  function lineAt(age: number): string | undefined {
    const def = defOf(ID);
    const registry = forced(def);
    const state = createLife(registry, {
      seed: 9,
      firstName: 'Ada',
      lastName: 'Moreno',
      gender: 'male',
      countryId: 'us',
    });
    state.character.age = age;
    state.phase = 'awaitingChoice';
    state.pending = [{ eventId: def.id, text: '', icon: def.icon, choices: [{ label: CHOICE }] }];

    resolveChoice(state, registry, 0);

    return state.log
      .flatMap((year) => year.entries)
      .find((entry) => entry.kind === 'choice')?.text;
  }

  it('tells a teenager the age they actually are, in every year of the window', () => {
    const def = defOf(ID);
    // A one-year window would make a literal correct and the test vacuous.
    expect(def.maxAge, 'the window closes the year it opens').toBeGreaterThan(def.minAge);

    for (let age = def.minAge; age <= def.maxAge; age += 1) {
      expect(lineAt(age), `the allowance refusal at age ${age}`).toBe(
        `You were told to get a job. You are ${age}.`
      );
    }
  });

  it('states no age as a literal anywhere in either pack', () => {
    /* Only the fixed strings: a prompt written as a builder is handed the `Ctx`
       and can read the age it is narrating, so it cannot go stale the way a
       literal does. */
    const texts = [...CHILD_EVENTS, ...TEEN_EVENTS].flatMap((def) => [
      ...(typeof def.text === 'string' ? [def.text] : []),
      ...(def.choices ?? []).flatMap((choice) => choice.outcomes.map((outcome) => outcome.text)),
    ]);
    expect(texts.length).toBeGreaterThan(0);

    for (const text of texts) {
      expect(AGE_STATEMENT.test(text), `"${text}" states an age {age} should fill`).toBe(false);
    }
  });

  /* Guards the lint above against passing vacuously — the sentence this event
     used to ship is exactly the shape it has to catch — and against reading a
     count of anything else as an age. */
  it('catches an age this event hard-codes without catching a count', () => {
    expect(AGE_STATEMENT.test('You were told to get a job. You are fourteen.')).toBe(true);
    expect(AGE_STATEMENT.test('You were told to get a job. You are 14.')).toBe(true);
    const count = 'You came in forty minutes late and you are ten steps from bed.';
    expect(AGE_STATEMENT.test(count)).toBe(false);
  });
});
