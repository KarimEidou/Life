import { describe, expect, it } from 'vitest';
import { killCharacter, startLegacy } from '@/engine/death';
import { deathCheckPhase, deathProbability } from '@/engine/phases/deathCheck';
import { createRng } from '@/engine/rng';
import { addPerson, createLife } from '@/engine/state';
import type {
  ContentRegistry,
  Ctx,
  GameState,
  IllnessDef,
  Person,
  Rng,
  SchoolDef,
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

function school(id: string, level: SchoolDef['level']): SchoolDef {
  return { id, label: id, level, years: 4, tuitionPerYear: 0 };
}

function schoolRegistry(): ContentRegistry {
  const reg = emptyRegistry();
  reg.schools = [school('primary', 'primary'), school('middle', 'middle'), school('high', 'high')];
  for (const s of reg.schools) reg.schoolsById[s.id] = s;
  return reg;
}

function illness(id: string, label: string, lethality: number): IllnessDef {
  return {
    id,
    label,
    chronic: true,
    lethality,
    onsetWeight: (): number => 1,
    healthHit: 10,
    treatCost: 500,
    cureChance: 0.5,
  };
}

function illnessRegistry(...defs: IllnessDef[]): ContentRegistry {
  const reg = emptyRegistry();
  reg.illnesses = defs;
  for (const def of defs) reg.illnessesById[def.id] = def;
  return reg;
}

/** A life whose family, age and year are set by the caller. */
function life(reg: ContentRegistry, age: number, year: number, seed = 77): GameState {
  const state = createLife(reg, {
    seed,
    firstName: 'Ada',
    lastName: 'Byron',
    gender: 'female',
    startYear: year - age,
  });
  state.character.age = age;
  state.year = year;
  state.log.push({ age, year, entries: [] });
  // Rebuild the cast so ids and relationships are exactly what each test states.
  state.people = {};
  state.character.flags.nextPersonId = 1;
  return state;
}

function addChild(state: GameState, name: string, age: number, over: Partial<Person> = {}): Person {
  return addPerson(state, {
    kind: 'child',
    name,
    gender: 'female',
    age,
    alive: true,
    rel: 80,
    flags: {},
    ...over,
  });
}

/* --------------------------------------------------------------------------
   killCharacter
-------------------------------------------------------------------------- */

describe('killCharacter', () => {
  function wealthy(): GameState {
    const state = life(emptyRegistry(), 40, 2040);
    const c = state.character;
    c.money = 250000;
    c.investments = { savings: 100000, index: 0, crypto: 0 };
    c.assets = [
      { id: 'a1', defId: 'house', label: 'House', paid: 500000, value: 900000, yearBought: 2030 },
    ];
    c.loans = [{ id: 'l1', kind: 'mortgage', principal: 50000, apr: 0.05 }];
    c.job = { jobId: 'chef', title: 'Chef', salary: 60000, years: 9, performance: 70, workHard: true };
    c.flags.jobsHeld = 4;
    addChild(state, 'Nina Byron', 12);
    addChild(state, 'Otto Byron', 9, { gender: 'male' });
    return state;
  }

  it('writes the obituary, the epitaph stats and the death line', () => {
    const state = wealthy();
    state.pending = [{ eventId: 'x', text: 'x', icon: '❓', choices: [{ label: 'ok' }] }];

    killCharacter(state, emptyRegistry(), 'cancer');

    expect(state.phase).toBe('dead');
    expect(state.pending).toEqual([]);
    expect(state.death).toEqual({
      cause: 'cancer',
      age: 40,
      obituary: 'Ada Byron, 2000-2040. Died of cancer at 40. Chef. Left $1.2M and 2 children.',
      epitaphStats: { netWorth: 1200000, jobsHeld: 4, kids: 2 },
    });
    const year = state.log[state.log.length - 1];
    expect(year.entries.slice(-1)[0]).toEqual({
      icon: '💀',
      kind: 'death',
      text: 'You died of cancer at age 40.',
    });
  });

  it('counts only living children and says "child" for one', () => {
    const state = life(emptyRegistry(), 70, 2070);
    addChild(state, 'Nina Byron', 40);
    addChild(state, 'Otto Byron', 38, { alive: false });
    addPerson(state, {
      kind: 'friend',
      name: 'Kit Ray',
      gender: 'male',
      age: 70,
      alive: true,
      rel: 60,
      flags: {},
    });

    killCharacter(state, emptyRegistry(), 'natural causes');

    expect(state.death?.epitaphStats.kids).toBe(1);
    expect(state.death?.obituary).toContain('and 1 child.');
  });

  it('nets investments and assets against debt, including into the red', () => {
    const state = life(emptyRegistry(), 50, 2050);
    state.character.money = 1000;
    state.character.loans = [{ id: 'l1', kind: 'student', principal: 6000, apr: 0.04 }];

    killCharacter(state, emptyRegistry(), 'a car crash');

    expect(state.death?.epitaphStats.netWorth).toBe(-5000);
    expect(state.death?.obituary).toContain('Left -$5,000 and 0 children.');
  });

  it('falls back to the last job, then to Unemployed', () => {
    const employed = life(emptyRegistry(), 45, 2045);
    employed.character.flags.lastJobTitle = 'Welder';
    killCharacter(employed, emptyRegistry(), 'old age');
    expect(employed.death?.obituary).toContain('at 45. Welder. Left');

    const jobless = life(emptyRegistry(), 45, 2045);
    killCharacter(jobless, emptyRegistry(), 'old age');
    expect(jobless.death?.obituary).toContain('at 45. Unemployed. Left');
  });

  /* A schoolchild or a teenager has no career to fail at, so the obituary of a
     minor who never worked says nothing about work at all. */
  it('leaves the occupation clause out for a minor who never worked', () => {
    for (const age of [0, 3, 5, 6, 9, 14, 17]) {
      const state = life(emptyRegistry(), age, 2000 + age);
      killCharacter(state, emptyRegistry(), 'a sudden illness');
      expect(state.death?.obituary).toBe(
        `Ada Byron, 2000-${2000 + age}. Died of a sudden illness at ${age}. ` +
          'Left $0 and 0 children.'
      );
    }
  });

  it('calls a jobless adult unemployed from 18 on', () => {
    const adult = life(emptyRegistry(), 18, 2018);
    killCharacter(adult, emptyRegistry(), 'a sudden illness');
    expect(adult.death?.obituary).toContain('at 18. Unemployed. Left');
  });

  it('remembers someone still in school as a student', () => {
    const pupil = life(emptyRegistry(), 12, 2012);
    pupil.character.education.enrolledIn = 'middle';
    killCharacter(pupil, emptyRegistry(), 'a fever');
    expect(pupil.death?.obituary).toContain('at 12. Student. Left');

    const undergrad = life(emptyRegistry(), 20, 2020);
    undergrad.character.education.enrolledIn = 'university';
    killCharacter(undergrad, emptyRegistry(), 'a fever');
    expect(undergrad.death?.obituary).toContain('at 20. Student. Left');
  });

  it('remembers a working minor by the job rather than by their age', () => {
    const employed = life(emptyRegistry(), 17, 2017);
    employed.character.job = {
      jobId: 'barista',
      title: 'Barista',
      salary: 12000,
      years: 1,
      performance: 50,
      workHard: false,
    };
    killCharacter(employed, emptyRegistry(), 'a car crash');
    expect(employed.death?.obituary).toContain('at 17. Barista. Left');

    const fired = life(emptyRegistry(), 17, 2017);
    fired.character.flags.lastJobTitle = 'Paper Boy';
    killCharacter(fired, emptyRegistry(), 'a car crash');
    expect(fired.death?.obituary).toContain('at 17. Paper Boy. Left');

    // Held a job, lost it without a remembered title: unemployed, not a child.
    const jobless = life(emptyRegistry(), 17, 2017);
    jobless.character.flags.jobsHeld = 1;
    killCharacter(jobless, emptyRegistry(), 'a car crash');
    expect(jobless.death?.obituary).toContain('at 17. Unemployed. Left');
  });

  it('derives jobs held from the current job when the flag is unset', () => {
    const state = life(emptyRegistry(), 30, 2030);
    state.character.job = {
      jobId: 'barista',
      title: 'Barista',
      salary: 25000,
      years: 2,
      performance: 50,
      workHard: false,
    };
    killCharacter(state, emptyRegistry(), 'a sudden illness');
    expect(state.death?.epitaphStats.jobsHeld).toBe(1);

    const never = life(emptyRegistry(), 30, 2030);
    killCharacter(never, emptyRegistry(), 'a sudden illness');
    expect(never.death?.epitaphStats.jobsHeld).toBe(0);
  });
});

/* --------------------------------------------------------------------------
   startLegacy
-------------------------------------------------------------------------- */

describe('startLegacy', () => {
  /** A dead parent with `kids` children of the given ages and a widowed spouse. */
  function estate(
    reg: ContentRegistry,
    opts: { money?: number; ages?: number[]; spouse?: boolean } = {}
  ): { state: GameState; children: Person[] } {
    const state = life(reg, 60, 2060);
    state.character.money = opts.money ?? 100000;
    const children = (opts.ages ?? [30]).map((age, i) =>
      addChild(state, `${['Nina', 'Otto', 'Pia'][i] ?? `Kid${i}`} Byron`, age, {
        gender: i % 2 === 0 ? 'female' : 'male',
      })
    );
    if (opts.spouse) {
      addPerson(state, {
        kind: 'spouse',
        name: 'Marcus Byron',
        gender: 'male',
        age: 62,
        alive: true,
        rel: 88,
        flags: {},
      });
    }
    killCharacter(state, reg, 'old age');
    return { state, children };
  }

  it('carries the surname, generation and country into the heir', () => {
    const reg = schoolRegistry();
    const { state, children } = estate(reg, { ages: [8] });

    const next = startLegacy(state, reg, children[0].id);

    expect(next.generation).toBe(2);
    expect(next.year).toBe(2060);
    expect(next.seed).toBe(state.seed);
    expect(next.phase).toBe('alive');
    expect(next.character.id).toBe('me');
    expect(next.character.firstName).toBe('Nina');
    expect(next.character.lastName).toBe('Byron');
    expect(next.character.age).toBe(8);
    expect(next.character.gender).toBe('female');
    expect(next.character.pronouns).toEqual({ sub: 'she', obj: 'her', pos: 'her' });
    expect(next.character.countryId).toBe(state.character.countryId);
    expect(next.character.flags.countryLabel).toBe(state.character.flags.countryLabel);
    expect(next.character.flags.jobsHeld).toBe(0);
    expect(next.character.flags.livesWithParents).toBe(true);
    expect(next.character.job).toBeNull();
    expect(next.character.prison).toBeNull();
    expect(next.character.assets).toEqual([]);
    expect(next.character.loans).toEqual([]);
    expect(next.character.illnesses).toEqual([]);
    expect(next.character.addictions).toEqual({});
    expect(next.character.fame).toBe(0);
    expect(next.character.investments).toEqual({ savings: 0, index: 0, crypto: 0 });
    expect(next.pending).toEqual([]);
    expect(next.firedEvents).toEqual([]);
    expect(next.interactionUse).toEqual({});
  });

  it('hands an only child 80% of the estate', () => {
    const reg = emptyRegistry();
    const { state, children } = estate(reg, { money: 100000 });
    expect(startLegacy(state, reg, children[0].id).character.money).toBe(80000);
  });

  it('splits the estate between the living children', () => {
    const reg = emptyRegistry();
    const { state, children } = estate(reg, { money: 100000, ages: [30, 28] });
    expect(startLegacy(state, reg, children[0].id).character.money).toBe(40000);
    expect(startLegacy(state, reg, children[1].id).character.money).toBe(40000);
  });

  it('inherits nothing from an estate underwater', () => {
    const reg = emptyRegistry();
    const { state, children } = estate(reg, { money: 0 });
    state.character.loans = [{ id: 'l1', kind: 'personal', principal: 9000, apr: 0.1 }];
    expect(startLegacy(state, reg, children[0].id).character.money).toBe(0);
  });

  it('inherits nothing from an estate that does not add up', () => {
    /* Nothing validates the numbers a save or a pack delivers, so a balance
       sheet can arrive holding `NaN` or `Infinity`. `Math.max(0, NaN)` is NaN,
       so an unguarded split would open the next life on a wallet that is not a
       number — and every affordability test against it inverts. */
    const reg = emptyRegistry();
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const state = life(reg, 60, 2060);
      state.character.money = 100000;
      state.character.assets = [
        { id: 'a1', defId: 'house', label: 'House', paid: 0, value, yearBought: 2050 },
      ];
      const heir = addChild(state, 'Nina Byron', 30);
      killCharacter(state, reg, 'old age');

      expect(state.death?.epitaphStats.netWorth).toBe(0);
      expect(startLegacy(state, reg, heir.id).character.money).toBe(0);
    }
  });

  it('rebuilds the family around the heir', () => {
    const reg = emptyRegistry();
    const { state, children } = estate(reg, { ages: [10, 8, 6], spouse: true });
    // A sibling who did not survive the parent is not carried over.
    children[2].alive = false;

    const next = startLegacy(state, reg, children[0].id);
    const people = Object.values(next.people);

    expect(people.map((p) => p.name)).toEqual(['Otto Byron', 'Marcus Byron']);
    const sibling = people[0];
    const father = people[1];
    expect(sibling.kind).toBe('sibling');
    expect(sibling.age).toBe(8);
    expect(sibling.rel).toBeGreaterThanOrEqual(60);
    expect(sibling.rel).toBeLessThanOrEqual(90);
    expect(father.kind).toBe('father');
    expect(father.rel).toBeGreaterThanOrEqual(65);
    expect(father.rel).toBeLessThanOrEqual(95);
    expect(people.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(next.character.flags.nextPersonId).toBe(3);
  });

  it('makes a surviving wife the heir’s mother', () => {
    const reg = emptyRegistry();
    const state = life(reg, 60, 2060);
    const heir = addChild(state, 'Nina Byron', 20);
    addPerson(state, {
      kind: 'partner',
      name: 'Iris Byron',
      gender: 'female',
      age: 58,
      alive: true,
      rel: 70,
      flags: {},
    });
    killCharacter(state, reg, 'old age');

    const next = startLegacy(state, reg, heir.id);

    expect(Object.values(next.people)[0].kind).toBe('mother');
  });

  it('appends the deceased to the family tree', () => {
    const reg = emptyRegistry();
    const { state, children } = estate(reg);
    state.ancestors = [{ name: 'Old Byron', years: '1940-2000', cause: 'a fall' }];

    const next = startLegacy(state, reg, children[0].id);

    expect(next.ancestors).toEqual([
      { name: 'Old Byron', years: '1940-2000', cause: 'a fall' },
      { name: 'Ada Byron', years: '2000-2060', cause: 'old age' },
    ]);
  });

  it('takes the ancestor cause from the death marker when no obituary was written', () => {
    const reg = emptyRegistry();
    const state = life(reg, 60, 2060);
    const heir = addChild(state, 'Nina Byron', 30);
    state.phase = 'dead';
    state.character.flags.pendingDeathCause = 'a shark attack';

    expect(startLegacy(state, reg, heir.id).ancestors).toEqual([
      { name: 'Ada Byron', years: '2000-2060', cause: 'a shark attack' },
    ]);
  });

  it('clamps inherited stats into 0..100', () => {
    const reg = emptyRegistry();
    const { state, children } = estate(reg, { ages: [10] });
    children[0].stats = { smarts: 140, looks: -20 };

    const stats = startLegacy(state, reg, children[0].id).character.stats;

    expect(stats.smarts).toBe(100);
    expect(stats.looks).toBe(0);
  });

  it('opens the new life with a single log entry', () => {
    const reg = emptyRegistry();
    const { state, children } = estate(reg, { ages: [8] });

    const next = startLegacy(state, reg, children[0].id);

    expect(next.log).toEqual([
      {
        age: 8,
        year: 2060,
        entries: [
          { icon: '🌱', kind: 'info', text: 'You now live as Nina Byron, generation 2.' },
        ],
      },
    ]);
  });

  it('carries the cursor without touching the old life', () => {
    const reg = emptyRegistry();
    const { state, children } = estate(reg);
    const before = JSON.stringify(state);

    const next = startLegacy(state, reg, children[0].id);

    // No siblings and no widow, so nothing rolled.
    expect(next.rngState).toBe(state.rngState);
    expect(JSON.stringify(state)).toBe(before);
    expect(next.people).not.toBe(state.people);
    expect(next.ancestors).not.toBe(state.ancestors);
  });

  it('advances the cursor for every relationship it rolls', () => {
    const reg = emptyRegistry();
    const { state, children } = estate(reg, { ages: [10, 8], spouse: true });
    const before = state.rngState;

    const next = startLegacy(state, reg, children[0].id);

    expect(next.rngState).not.toBe(before);
    expect(state.rngState).toBe(before);
  });

  it('lays the heir’s own stats over the default block', () => {
    const reg = emptyRegistry();
    const { state, children } = estate(reg, { ages: [10] });
    children[0].stats = { smarts: 90, health: 40 };

    expect(startLegacy(state, reg, children[0].id).character.stats).toEqual({
      health: 40,
      happiness: 70,
      smarts: 90,
      looks: 60,
    });
  });

  it('enrols the heir in the school their age belongs to', () => {
    const reg = schoolRegistry();
    const expected: [number, string, string | undefined][] = [
      [3, 'none', undefined],
      [8, 'none', 'primary'],
      [12, 'primary', 'middle'],
      [16, 'middle', 'high'],
      [20, 'high', undefined],
    ];

    for (const [age, level, enrolledIn] of expected) {
      const { state, children } = estate(reg, { ages: [age] });
      const education = startLegacy(state, reg, children[0].id).character.education;
      expect(education.level).toBe(level);
      expect(education.enrolledIn).toBe(enrolledIn);
      expect(education.year).toBe(0);
      expect(education.studyHard).toBe(false);
      expect(education.gpa).toBe(3.2);
    }
  });

  it('leaves the heir unenrolled when the registry ships no schools', () => {
    const reg = emptyRegistry();
    const { state, children } = estate(reg, { ages: [8] });
    expect(startLegacy(state, reg, children[0].id).character.education.enrolledIn).toBeUndefined();
  });

  it('scales the starting GPA with smarts', () => {
    const reg = schoolRegistry();
    const { state, children } = estate(reg, { ages: [10] });
    children[0].stats = { smarts: 90 };
    expect(startLegacy(state, reg, children[0].id).character.education.gpa).toBe(3.8);
  });

  it('moves an adult heir out of the family home', () => {
    const reg = emptyRegistry();
    const { state, children } = estate(reg, { ages: [25] });
    expect(startLegacy(state, reg, children[0].id).character.flags.livesWithParents).toBe(false);
  });

  it('refuses anyone who is not a living child', () => {
    const reg = emptyRegistry();
    const { state, children } = estate(reg, { ages: [30] });
    const friend = addPerson(state, {
      kind: 'friend',
      name: 'Kit Ray',
      gender: 'male',
      age: 40,
      alive: true,
      rel: 50,
      flags: {},
    });
    const gone = addChild(state, 'Gone Byron', 20, { alive: false });

    expect(() => startLegacy(state, reg, 'p99')).toThrow('unknown person p99');
    /* `people[id]` would answer these with `Object.prototype` or `Object`
       itself; the heir lookup must read them as nobody, like any other id. */
    expect(() => startLegacy(state, reg, '__proto__')).toThrow('unknown person __proto__');
    expect(() => startLegacy(state, reg, 'constructor')).toThrow('unknown person constructor');
    expect(() => startLegacy(state, reg, 'toString')).toThrow('unknown person toString');
    expect(() => startLegacy(state, reg, friend.id)).toThrow('is not a child');
    expect(() => startLegacy(state, reg, gone.id)).toThrow('is not alive');
    expect(() => startLegacy(state, reg, children[0].id)).not.toThrow();
  });
});

/* --------------------------------------------------------------------------
   deathProbability / deathCheckPhase
-------------------------------------------------------------------------- */

/** An rng whose `chance` answer is fixed, so a roll can be forced either way. */
function stubRng(hit: boolean): Rng {
  return {
    next: (): number => 0.5,
    int: (min: number): number => min,
    pick: <T>(arr: readonly T[]): T => arr[0],
    chance: (): boolean => hit,
    weighted: <T>(items: readonly T[]): T => items[0],
    normal: (mean: number): number => mean,
  };
}

function ctxFor(reg: ContentRegistry, tweak: (s: GameState) => void, rng?: Rng): Ctx {
  const state = life(reg, 40, 2040, 5);
  state.character.stats.health = 50;
  tweak(state);
  return { state, c: state.character, rng: rng ?? createRng(state), reg };
}

function hazard(reg: ContentRegistry, tweak: (s: GameState) => void): number {
  return deathProbability(ctxFor(reg, tweak));
}

describe('deathProbability', () => {
  it('climbs with age', () => {
    const reg = emptyRegistry();
    const curve = [20, 50, 80, 100].map((age) =>
      hazard(reg, (s) => {
        s.character.age = age;
      })
    );

    expect(curve[0]).toBeCloseTo(0.002, 6);
    expect(curve[1]).toBeGreaterThan(curve[0]);
    expect(curve[2]).toBeGreaterThan(curve[1]);
    expect(curve[3]).toBeGreaterThan(curve[2]);
    // Steep at 100, but still short of the 0.95 ceiling.
    expect(curve[3]).toBeLessThan(0.95);
  });

  /* The scale of the curve decides whether anyone ever dies of age at all. At
     BASE_HAZARD 0.0002 an average 80-year-old died with ~0.7% odds a year — an
     order of magnitude under the life tables — and the cohort piled up against
     the 110 cap instead. These bands are life-table shaped (~5-7% a year at 80)
     and fail for any base hazard off by a factor of ten either way. */
  it('sits on a life-table scale', () => {
    const reg = emptyRegistry();
    const at = (age: number): number =>
      hazard(reg, (s) => {
        s.character.age = age;
      });

    expect(at(30)).toBeLessThan(0.01);
    expect(at(60)).toBeGreaterThan(0.005);
    expect(at(60)).toBeLessThan(0.03);
    expect(at(80)).toBeGreaterThan(0.04);
    expect(at(80)).toBeLessThan(0.1);
    expect(at(100)).toBeGreaterThan(0.25);
  });

  it('is flat below 40', () => {
    const reg = emptyRegistry();
    const young = [0, 10, 39].map((age) =>
      hazard(reg, (s) => {
        s.character.age = age;
      })
    );
    expect(young[1]).toBeCloseTo(young[0], 10);
    expect(young[2]).toBeCloseTo(young[0], 10);
  });

  it('falls as health rises, with the bonus floored', () => {
    const reg = emptyRegistry();
    const at = (health: number): number =>
      hazard(reg, (s) => {
        s.character.age = 60;
        s.character.stats.health = health;
      });

    expect(at(10)).toBeGreaterThan(at(50));
    expect(at(50)).toBeGreaterThan(at(90));
    expect(at(90)).toBeCloseTo(at(100), 10);
  });

  it('adds the illnesses the registry knows about', () => {
    const reg = illnessRegistry(illness('cancer', 'cancer', 0.25));
    const base = hazard(reg, () => undefined);
    const treated = hazard(reg, (s) => {
      s.character.illnesses = [{ defId: 'cancer', years: 2, treated: true }];
    });
    const untreated = hazard(reg, (s) => {
      s.character.illnesses = [{ defId: 'cancer', years: 2, treated: false }];
    });
    const unknown = hazard(reg, (s) => {
      s.character.illnesses = [{ defId: 'nonesuch', years: 1, treated: false }];
    });

    expect(treated).toBeCloseTo(base + 0.125, 6);
    expect(untreated).toBeCloseTo(base + 0.5, 6);
    expect(unknown).toBeCloseTo(base, 10);
  });

  it('adds addictions, and drugs three times over', () => {
    const reg = emptyRegistry();
    const base = hazard(reg, () => undefined);
    const drink = hazard(reg, (s) => {
      s.character.addictions = { alcohol: 60 };
    });
    const drugs = hazard(reg, (s) => {
      s.character.addictions = { drugs: 60 };
    });

    expect(drink).toBeCloseTo(base + 0.006, 6);
    expect(drugs).toBeCloseTo(base + 0.018, 6);
  });

  it('never exceeds 0.95 before extreme age', () => {
    const reg = illnessRegistry(illness('plague', 'the plague', 0.9));
    const q = hazard(reg, (s) => {
      s.character.age = 100;
      s.character.stats.health = 1;
      s.character.illnesses = [{ defId: 'plague', years: 1, treated: false }];
      s.character.addictions = { drugs: 100 };
    });
    expect(q).toBe(0.95);
  });

  it('gives at least even odds at 105 and none at all at 110', () => {
    const reg = emptyRegistry();
    const healthy = (age: number) => (s: GameState): void => {
      s.character.age = age;
      s.character.stats.health = 100;
    };

    expect(hazard(reg, healthy(104))).toBeLessThan(0.5);
    expect(hazard(reg, healthy(105))).toBe(0.5);
    expect(hazard(reg, healthy(109))).toBeGreaterThanOrEqual(0.5);
    expect(hazard(reg, healthy(110))).toBe(1);
    expect(hazard(reg, healthy(120))).toBe(1);
  });
});

describe('deathCheckPhase', () => {
  it('says nothing when the roll misses', () => {
    const ctx = ctxFor(emptyRegistry(), () => undefined, stubRng(false));
    expect(deathCheckPhase(ctx)).toEqual([]);
    expect(ctx.state.phase).toBe('alive');
    expect(ctx.c.flags.pendingDeathCause).toBeUndefined();
  });

  it('marks the death without writing the obituary', () => {
    const ctx = ctxFor(emptyRegistry(), () => undefined, stubRng(true));

    expect(deathCheckPhase(ctx)).toEqual([]);
    expect(ctx.state.phase).toBe('dead');
    expect(ctx.c.flags.pendingDeathCause).toBe('a sudden illness');
    // The obituary and the log line belong to `killCharacter`.
    expect(ctx.state.death).toBeUndefined();
    expect(ctx.state.log[ctx.state.log.length - 1].entries).toEqual([]);
  });

  it('blames the deadliest untreated illness first', () => {
    const reg = illnessRegistry(
      illness('flu', 'the flu', 0.02),
      illness('cancer', 'cancer', 0.25),
      illness('gout', 'gout', 0.5)
    );
    const ctx = ctxFor(
      reg,
      (s) => {
        s.character.illnesses = [
          { defId: 'flu', years: 1, treated: false },
          { defId: 'cancer', years: 3, treated: false },
          { defId: 'gout', years: 1, treated: true },
        ];
      },
      stubRng(true)
    );

    deathCheckPhase(ctx);

    expect(ctx.c.flags.pendingDeathCause).toBe('cancer');
  });

  it('blames a heavy drug habit next', () => {
    const ctx = ctxFor(
      emptyRegistry(),
      (s) => {
        s.character.addictions = { drugs: 61, alcohol: 100 };
      },
      stubRng(true)
    );

    deathCheckPhase(ctx);

    expect(ctx.c.flags.pendingDeathCause).toBe('an overdose');
  });

  it('calls it natural causes once the character is old', () => {
    const ctx = ctxFor(
      emptyRegistry(),
      (s) => {
        s.character.age = 80;
        s.character.addictions = { drugs: 60 };
      },
      stubRng(true)
    );

    deathCheckPhase(ctx);

    expect(ctx.c.flags.pendingDeathCause).toBe('natural causes');
  });

  it('always kills at 110, whatever the cursor', () => {
    for (let cursor = 0; cursor < 20; cursor += 1) {
      const ctx = ctxFor(emptyRegistry(), (s) => {
        s.character.age = 110;
        s.character.stats.health = 100;
        s.rngState = cursor * 7919 + 13;
      });
      deathCheckPhase(ctx);
      expect(ctx.state.phase).toBe('dead');
      expect(ctx.c.flags.pendingDeathCause).toBe('natural causes');
    }
  });
});
