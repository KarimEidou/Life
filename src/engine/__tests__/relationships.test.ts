import { describe, expect, it } from 'vitest';
import { relationshipsPhase } from '@/engine/phases/relationships';
import { createRng, initialRngState } from '@/engine/rng';
import { addPerson, createLife } from '@/engine/state';
import type {
  ContentRegistry,
  Ctx,
  GameState,
  LogEntry,
  Person,
  RelKind,
  Stats,
} from '@/types';

/* Built by hand rather than through `buildRegistry`, which is another agent's
   module and still a stub. */
function emptyRegistry(): ContentRegistry {
  return {
    packs: [],
    events: [],
    eventsById: {},
    interactions: [],
    interactionsById: {},
    jobs: [],
    jobsById: {},
    assets: [],
    assetsById: {},
    illnesses: [],
    illnessesById: {},
    schools: [],
    schoolsById: {},
    countries: [],
    countriesById: {},
    crimes: [],
    crimesById: {},
    achievements: [],
    achievementsById: {},
    namePools: {},
  };
}

const REG = emptyRegistry();

function newLife(seed = 1): GameState {
  const state = createLife(REG, {
    seed,
    firstName: 'Ada',
    lastName: 'Byron',
    gender: 'female',
    startYear: 2000,
  });
  // The generated family varies with the seed; every test builds its own.
  state.people = {};
  state.character.stats.happiness = 60;
  state.character.money = 10000;
  return state;
}

function ctxFor(state: GameState): Ctx {
  return { state, c: state.character, rng: createRng(state), reg: REG };
}

interface PersonSpec {
  kind: RelKind;
  name?: string;
  age?: number;
  rel?: number;
  alive?: boolean;
  stats?: Partial<Stats>;
  petSpecies?: string;
}

/** A life with exactly one other person in it. */
function personState(seed: number, spec: PersonSpec): GameState {
  const state = newLife(seed);
  addPerson(state, {
    kind: spec.kind,
    name: spec.name ?? 'Sam Byron',
    gender: 'male',
    age: spec.age ?? 30,
    alive: spec.alive ?? true,
    rel: spec.rel ?? 50,
    stats: spec.stats,
    petSpecies: spec.petSpecies,
    flags: {},
  });
  return state;
}

function only(state: GameState): Person {
  const person = Object.values(state.people)[0];
  if (!person) throw new Error('this state has nobody in it');
  return person;
}

function texts(entries: LogEntry[]): string[] {
  return entries.map((e) => e.text);
}

interface Forced {
  state: GameState;
  entries: LogEntry[];
  cursor: number;
}

/** Runs the phase on a fresh state per rng cursor until `hit` says it fired. */
function forceBranch(
  build: () => GameState,
  hit: (state: GameState, entries: LogEntry[]) => boolean,
  limit = 400
): Forced {
  for (let cursor = 1; cursor <= limit; cursor += 1) {
    const state = build();
    state.rngState = initialRngState(cursor);
    const entries = relationshipsPhase(ctxFor(state));
    if (hit(state, entries)) return { state, entries, cursor };
  }
  throw new Error(`branch never fired within ${limit} rng cursors`);
}

/** How many cursors out of `limit` reach the branch. */
function fireCount(
  build: () => GameState,
  hit: (state: GameState, entries: LogEntry[]) => boolean,
  limit = 200
): number {
  let count = 0;
  for (let cursor = 1; cursor <= limit; cursor += 1) {
    const state = build();
    state.rngState = initialRngState(cursor);
    const entries = relationshipsPhase(ctxFor(state));
    if (hit(state, entries)) count += 1;
  }
  return count;
}

/* ---------------------------------------------------------------------------
   Aging
--------------------------------------------------------------------------- */

describe('everyone else ages', () => {
  it('adds a year to every living person and leaves the dead alone', () => {
    const state = newLife(2);
    addPerson(state, {
      kind: 'mother',
      name: 'Eve Byron',
      gender: 'female',
      age: 30,
      alive: true,
      rel: 80,
      flags: {},
    });
    addPerson(state, {
      kind: 'sibling',
      name: 'Max Byron',
      gender: 'male',
      age: 10,
      alive: false,
      rel: 60,
      flags: {},
    });
    addPerson(state, {
      kind: 'pet',
      name: 'Rex',
      gender: 'male',
      age: 3,
      alive: true,
      rel: 90,
      petSpecies: 'dog',
      flags: {},
    });

    relationshipsPhase(ctxFor(state));
    const [mother, sibling, pet] = Object.values(state.people);

    expect(mother.age).toBe(31);
    expect(sibling.age).toBe(10);
    expect(pet.age).toBe(4);
  });
});

/* ---------------------------------------------------------------------------
   Mortality
--------------------------------------------------------------------------- */

describe('who gets rolled for death', () => {
  it('spares anyone the curves do not reach, without spending a draw', () => {
    const cases: PersonSpec[] = [
      { kind: 'mother', age: 38 },
      { kind: 'friend', age: 50 },
      { kind: 'child', age: 20 },
      { kind: 'pet', age: 5, petSpecies: 'dog' },
    ];
    for (const spec of cases) {
      const state = personState(3, spec);
      const before = state.rngState;
      relationshipsPhase(ctxFor(state));
      expect(only(state).alive).toBe(true);
      expect(state.rngState).toBe(before);
    }
  });

  it('rolls parents past 40 and anybody at all past 60', () => {
    for (const spec of [
      { kind: 'mother' as RelKind, age: 45 },
      { kind: 'friend' as RelKind, age: 70 },
      { kind: 'pet' as RelKind, age: 11 },
    ]) {
      const state = personState(4, spec);
      const before = state.rngState;
      relationshipsPhase(ctxFor(state));
      expect(state.rngState).not.toBe(before);
    }
  });

  it('kills the very old far more often than the middle-aged', () => {
    const deaths = (age: number): number =>
      fireCount(
        () => personState(5, { kind: 'mother', name: 'Eve Byron', age }),
        (state) => !only(state).alive
      );

    expect(deaths(41)).toBe(0);
    expect(deaths(199)).toBeGreaterThan(150);
  });

  it('buries a parent with a line and a dent in happiness', () => {
    const { state, entries } = forceBranch(
      () => personState(6, { kind: 'mother', name: 'Eve Byron', age: 199 }),
      (s) => !only(s).alive
    );

    expect(entries).toEqual([
      { icon: '🖤', kind: 'bad', text: 'Your mother Eve Byron died at 200.' },
    ]);
    expect(state.character.stats.happiness).toBe(48);
    expect(only(state).rel).toBe(50);
  });

  it('hurts more when it is a spouse', () => {
    const { state, entries } = forceBranch(
      () => personState(7, { kind: 'spouse', age: 199 }),
      (s) => !only(s).alive
    );

    expect(texts(entries)).toEqual(['Your spouse Sam Byron died at 200.']);
    expect(state.character.stats.happiness).toBe(42);
  });

  it('sees a pet out with its own line', () => {
    const { state, entries } = forceBranch(
      () => personState(8, { kind: 'pet', name: 'Rex', age: 11, petSpecies: 'dog' }),
      (s) => !only(s).alive
    );

    expect(entries).toEqual([{ icon: '💔', kind: 'bad', text: 'Your dog Rex died.' }]);
    expect(state.character.stats.happiness).toBe(52);
  });

  it('always takes a pet that has long outlived its species', () => {
    // 0.15 + 0.05 a year past 10 passes certainty at 30.
    const state = personState(9, { kind: 'pet', name: 'Rex', age: 30 });
    const entries = relationshipsPhase(ctxFor(state));

    expect(only(state).alive).toBe(false);
    expect(texts(entries)).toEqual(['Your pet Rex died.']);
  });
});

/* ---------------------------------------------------------------------------
   Drift
--------------------------------------------------------------------------- */

describe('affinity drift', () => {
  it('fades everyone outside a romance by two points a year', () => {
    for (const [before, after] of [
      [50, 48],
      [2, 0],
      [1, 0],
      [0, 0],
    ]) {
      const state = personState(10, { kind: 'friend', rel: before });
      relationshipsPhase(ctxFor(state));
      expect(only(state).rel).toBe(after);
    }
  });

  it("moves a romance with the character's mood", () => {
    const drift = (happiness: number, rel = 50): number => {
      const state = personState(11, { kind: 'spouse', rel });
      state.character.stats.happiness = happiness;
      relationshipsPhase(ctxFor(state));
      return only(state).rel;
    };

    expect(drift(100)).toBe(51);
    expect(drift(80)).toBe(50);
    expect(drift(60)).toBe(49);
    expect(drift(40)).toBe(48);
    // The mood term is bounded either way: misery costs four points a year, no more.
    expect(drift(0)).toBe(46);
  });

  it('keeps a romance inside 0..100', () => {
    const state = personState(12, { kind: 'spouse', rel: 100 });
    state.character.stats.happiness = 100;
    relationshipsPhase(ctxFor(state));
    expect(only(state).rel).toBe(100);

    const cold = personState(13, { kind: 'partner', rel: 3 });
    cold.character.stats.happiness = 0;
    relationshipsPhase(ctxFor(cold));
    expect(only(cold).rel).toBe(0);
  });

  it('drifts a partner apart before rolling for the breakup', () => {
    // rel 20 survives the test on its own but drifts to 19 first.
    const state = personState(14, { kind: 'partner', rel: 20 });
    const before = state.rngState;
    relationshipsPhase(ctxFor(state));
    expect(only(state).rel).toBe(19);
    expect(state.rngState).not.toBe(before);
  });
});

/* ---------------------------------------------------------------------------
   Divorce and breakup
--------------------------------------------------------------------------- */

describe('divorce', () => {
  it('takes 30% of the money and a fifth of the mood', () => {
    const { state, entries } = forceBranch(
      () => personState(15, { kind: 'spouse', rel: 15 }),
      (s) => only(s).kind === 'ex'
    );
    const c = state.character;

    expect(entries).toEqual([{ icon: '⚡', kind: 'bad', text: 'Sam Byron divorced you.' }]);
    expect(c.money).toBe(7000);
    expect(c.stats.happiness).toBe(40);
    expect(only(state).kind).toBe('ex');
  });

  it('leaves a warm marriage alone without rolling for it', () => {
    const state = personState(16, { kind: 'spouse', rel: 20 });
    const before = state.rngState;

    const entries = relationshipsPhase(ctxFor(state));

    expect(entries).toEqual([]);
    expect(only(state).kind).toBe('spouse');
    expect(state.rngState).toBe(before);
    expect(state.character.money).toBe(10000);
  });

  it('settles an unreadable balance at zero instead of carrying the poison through', () => {
    for (const poisoned of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const { state } = forceBranch(
        () => {
          const s = personState(28, { kind: 'spouse', rel: 15 });
          s.character.money = poisoned;
          return s;
        },
        (s) => only(s).kind === 'ex'
      );

      expect(state.character.money).toBe(0);
    }
  });

  it('does not divorce every cold marriage at once', () => {
    const fired = fireCount(
      () => personState(17, { kind: 'spouse', rel: 5 }),
      (state) => only(state).kind === 'ex'
    );
    expect(fired).toBeGreaterThan(10);
    expect(fired).toBeLessThan(80);
  });
});

describe('breakup', () => {
  it('ends a cold romance without touching the money', () => {
    const { state, entries } = forceBranch(
      () => personState(18, { kind: 'partner', rel: 20 }),
      (s) => only(s).kind === 'ex'
    );
    const c = state.character;

    expect(entries).toEqual([{ icon: '⚡', kind: 'bad', text: 'Sam Byron broke up with you.' }]);
    expect(c.money).toBe(10000);
    expect(c.stats.happiness).toBe(50);
  });

  it('holds on while the affinity is still there', () => {
    const state = personState(19, { kind: 'partner', rel: 25 });
    const before = state.rngState;

    relationshipsPhase(ctxFor(state));

    expect(only(state).kind).toBe('partner');
    expect(state.rngState).toBe(before);
  });

  it('breaks up more readily than it divorces', () => {
    const dating = fireCount(
      () => personState(20, { kind: 'partner', rel: 5 }),
      (state) => only(state).kind === 'ex'
    );
    const married = fireCount(
      () => personState(21, { kind: 'spouse', rel: 5 }),
      (state) => only(state).kind === 'ex'
    );
    expect(dating).toBeGreaterThan(married);
  });
});

/* ---------------------------------------------------------------------------
   Children
--------------------------------------------------------------------------- */

describe('children growing up', () => {
  it('grows smarts and looks from the shared cursor, in that order', () => {
    const state = personState(22, {
      kind: 'child',
      name: 'Kit Byron',
      age: 5,
      rel: 50,
      stats: { smarts: 50, looks: 50 },
    });
    state.rngState = initialRngState(77);

    const probe = { rngState: initialRngState(77) };
    const mirror = createRng(probe);
    const smartsGain = mirror.normal(0.5, 1);
    const looksGain = mirror.normal(0.5, 1);

    relationshipsPhase(ctxFor(state));
    const child = only(state);

    expect(child.age).toBe(6);
    expect(child.rel).toBe(48);
    expect(child.stats?.smarts).toBe(Math.round((50 + smartsGain) * 10) / 10);
    expect(child.stats?.looks).toBe(Math.round((50 + looksGain) * 10) / 10);
    expect(state.rngState).toBe(probe.rngState);
  });

  it('leaves a child with no stat block alone', () => {
    const state = personState(23, { kind: 'child', age: 5 });
    const before = state.rngState;

    relationshipsPhase(ctxFor(state));

    expect(only(state).stats).toBeUndefined();
    expect(state.rngState).toBe(before);
  });

  it('only grows the stats a child actually has', () => {
    const state = personState(24, { kind: 'child', age: 5, stats: { smarts: 50 } });
    state.rngState = initialRngState(5);

    relationshipsPhase(ctxFor(state));
    const child = only(state);

    expect(child.stats?.smarts).not.toBe(50);
    expect(child.stats?.looks).toBeUndefined();
  });

  it('trends upwards over a childhood', () => {
    const state = personState(25, {
      kind: 'child',
      age: 0,
      stats: { smarts: 50, looks: 50 },
    });
    state.rngState = initialRngState(31);

    for (let year = 0; year < 18; year += 1) relationshipsPhase(ctxFor(state));

    expect(only(state).stats?.smarts).toBeGreaterThan(50);
  });
});

/* ---------------------------------------------------------------------------
   Whole runs
--------------------------------------------------------------------------- */

describe('a crowded life', () => {
  it('replays identically from the same cursor', () => {
    const play = (): string => {
      const state = newLife(26);
      addPerson(state, {
        kind: 'mother',
        name: 'Eve Byron',
        gender: 'female',
        age: 62,
        alive: true,
        rel: 80,
        flags: {},
      });
      addPerson(state, {
        kind: 'spouse',
        name: 'Sam Byron',
        gender: 'male',
        age: 60,
        alive: true,
        rel: 70,
        flags: {},
      });
      addPerson(state, {
        kind: 'child',
        name: 'Kit Byron',
        gender: 'female',
        age: 20,
        alive: true,
        rel: 65,
        stats: { smarts: 60, looks: 60 },
        flags: {},
      });
      addPerson(state, {
        kind: 'pet',
        name: 'Rex',
        gender: 'male',
        age: 9,
        alive: true,
        rel: 90,
        petSpecies: 'dog',
        flags: {},
      });
      state.rngState = initialRngState(808);

      const lines: string[] = [];
      for (let year = 0; year < 40; year += 1) {
        lines.push(...texts(relationshipsPhase(ctxFor(state))));
      }
      return JSON.stringify({ lines, people: state.people, c: state.character });
    };

    expect(play()).toBe(play());
  });

  it('eventually buries the old and lets go of the cold', () => {
    const state = newLife(27);
    addPerson(state, {
      kind: 'father',
      name: 'Abe Byron',
      gender: 'male',
      age: 90,
      alive: true,
      rel: 80,
      flags: {},
    });
    addPerson(state, {
      kind: 'partner',
      name: 'Sam Byron',
      gender: 'male',
      age: 40,
      alive: true,
      rel: 18,
      flags: {},
    });
    state.rngState = initialRngState(404);

    const lines: string[] = [];
    for (let year = 0; year < 60; year += 1) {
      lines.push(...texts(relationshipsPhase(ctxFor(state))));
      state.character.stats.happiness = 60;
    }

    expect(lines).toContain('Sam Byron broke up with you.');
    expect(lines.some((line) => line.startsWith('Your father Abe Byron died at'))).toBe(true);
  });
});
