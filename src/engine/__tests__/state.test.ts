import { describe, expect, it, vi } from 'vitest';
import type {
  ContentRegistry,
  CountryDef,
  GameState,
  LogEntry,
  NamePool,
  Person,
  YearLog,
} from '@/types';

/* `ageUp` is another agent's module and still a stub while the engine wave runs
   in parallel, so this suite supplies the documented stand-in: the last year log,
   created for the current age when the log is empty. `rng` and `effects` have
   landed, so the real ones are used. */
vi.mock('@/engine/ageUp', () => ({
  currentYearLog: (state: GameState): YearLog => {
    const last = state.log[state.log.length - 1];
    if (last) {
      return last;
    }
    const fresh: YearLog = { age: state.character.age, year: state.year, entries: [] };
    state.log.push(fresh);
    return fresh;
  },
  ageUp: (): void => undefined,
  resolveChoice: (): void => undefined,
}));

import { killCharacter } from '@/engine/death';
import { addPerson, createLife, emigrateTo, lifeIsOver, pronounsFor } from '@/engine/state';

const US: CountryDef = {
  id: 'us',
  label: 'the United States',
  flag: '🇺🇸',
  costMult: 1,
  taxMult: 1,
  visaDifficulty: 0.5,
};

const JP: CountryDef = {
  id: 'jp',
  label: 'Japan',
  flag: '🇯🇵',
  costMult: 1.2,
  taxMult: 1.1,
  visaDifficulty: 0.8,
};

const US_NAMES: NamePool = {
  countryId: 'us',
  male: ['James', 'Robert', 'Michael'],
  female: ['Mary', 'Linda', 'Susan'],
  last: ['Smith', 'Jones'],
};

const JP_NAMES: NamePool = {
  countryId: 'jp',
  male: ['Haruto'],
  female: ['Yui'],
  last: ['Sato'],
};

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

function testRegistry(): ContentRegistry {
  const reg = emptyRegistry();
  reg.countries = [US, JP];
  reg.countriesById = { us: US, jp: JP };
  reg.namePools = { us: US_NAMES, jp: JP_NAMES };
  return reg;
}

function peopleOf(state: GameState): Person[] {
  return Object.values(state.people);
}

/** Last entry of the last year log — where an action's line lands. */
function lastEntry(state: GameState): LogEntry {
  const year = state.log[state.log.length - 1];
  return year.entries[year.entries.length - 1];
}

describe('createLife', () => {
  it('is reproducible for a given seed', () => {
    const a = createLife(testRegistry(), { seed: 20250818 });
    const b = createLife(testRegistry(), { seed: 20250818 });
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(Object.keys(a.people).length).toBeGreaterThanOrEqual(2);
  });

  it('produces different lives for different seeds', () => {
    const a = createLife(testRegistry(), { seed: 1 });
    const b = createLife(testRegistry(), { seed: 2 });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('leaves the cursor where generation stopped so the life continues the sequence', () => {
    const state = createLife(testRegistry(), { seed: 99 });
    expect(state.seed).toBe(99);
    expect(state.rngState).not.toBe(99);
    expect(Number.isInteger(state.rngState)).toBe(true);
  });

  it('rolls newborn stats inside their documented ranges', () => {
    for (let seed = 1; seed <= 80; seed += 1) {
      const { stats } = createLife(testRegistry(), { seed }).character;
      expect(Number.isInteger(stats.health)).toBe(true);
      expect(stats.health).toBeGreaterThanOrEqual(70);
      expect(stats.health).toBeLessThanOrEqual(100);
      expect(stats.happiness).toBeGreaterThanOrEqual(60);
      expect(stats.happiness).toBeLessThanOrEqual(100);
      expect(stats.smarts).toBeGreaterThanOrEqual(10);
      expect(stats.smarts).toBeLessThanOrEqual(95);
      expect(stats.looks).toBeGreaterThanOrEqual(10);
      expect(stats.looks).toBeLessThanOrEqual(95);
    }
  });

  it('starts a blank newborn life', () => {
    const state = createLife(testRegistry(), { seed: 11, startYear: 1994 });
    const c = state.character;
    expect(state.generation).toBe(1);
    expect(state.phase).toBe('alive');
    expect(state.year).toBe(1994);
    expect(state.pending).toEqual([]);
    expect(state.firedEvents).toEqual([]);
    expect(state.ancestors).toEqual([]);
    expect(state.interactionUse).toEqual({});
    expect(c.age).toBe(0);
    expect(c.money).toBe(0);
    expect(c.fame).toBe(0);
    expect(c.job).toBeNull();
    expect(c.prison).toBeNull();
    expect(c.assets).toEqual([]);
    expect(c.loans).toEqual([]);
    expect(c.illnesses).toEqual([]);
    expect(c.addictions).toEqual({});
    expect(c.investments).toEqual({ savings: 0, index: 0, crypto: 0 });
    expect(c.education).toEqual({ level: 'none', year: 0, gpa: 0, studyHard: false });
    expect(c.flags.livesWithParents).toBe(true);
  });

  it('defaults the start year to 2025', () => {
    const state = createLife(testRegistry(), { seed: 5 });
    expect(state.year).toBe(2025);
    expect(state.log[0].year).toBe(2025);
  });

  it('honours every option override', () => {
    const state = createLife(testRegistry(), {
      seed: 42,
      firstName: 'Zoe',
      lastName: 'Quinn',
      gender: 'nonbinary',
      countryId: 'jp',
      startYear: 1990,
    });
    const c = state.character;
    expect(c.firstName).toBe('Zoe');
    expect(c.lastName).toBe('Quinn');
    expect(c.gender).toBe('nonbinary');
    expect(c.countryId).toBe('jp');
    expect(c.flags.countryLabel).toBe('Japan');
    expect(c.pronouns).toEqual({ sub: 'they', obj: 'them', pos: 'their' });
    expect(state.year).toBe(1990);
    expect(state.log[0].entries[0].text).toBe(
      'You were born a baby child named Zoe Quinn in Japan.'
    );
  });

  it('rolls a registry country when the requested one is unknown', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const state = createLife(testRegistry(), { seed, countryId: 'atlantis' });
      expect(['us', 'jp']).toContain(state.character.countryId);
    }
  });

  it('draws names from the country pool', () => {
    const state = createLife(testRegistry(), { seed: 8, countryId: 'jp', gender: 'female' });
    expect(JP_NAMES.female).toContain(state.character.firstName);
    expect(JP_NAMES.last).toContain(state.character.lastName);
  });

  it('falls back to placeholder country and names for an empty registry', () => {
    const male = createLife(emptyRegistry(), { seed: 3, gender: 'male' });
    const female = createLife(emptyRegistry(), { seed: 3, gender: 'female' });
    expect(male.character.countryId).toBe('us');
    expect(male.character.flags.countryLabel).toBe('us');
    expect(male.character.firstName).toBe('Alex');
    expect(female.character.firstName).toBe('Riley');
    expect(male.character.lastName).toBe('Doe');
    expect(peopleOf(male).every((p) => p.name.endsWith('Doe'))).toBe(true);
  });

  it('writes one birth entry into the first year log', () => {
    const state = createLife(testRegistry(), { seed: 17, gender: 'male', countryId: 'us' });
    expect(state.log).toHaveLength(1);
    expect(state.log[0].age).toBe(0);
    expect(state.log[0].entries).toHaveLength(1);
    const entry = state.log[0].entries[0];
    expect(entry.icon).toBe('👶');
    expect(entry.kind).toBe('info');
    expect(entry.text).toBe(
      `You were born a baby boy named ${state.character.firstName} ${state.character.lastName} in the United States.`
    );
  });

  it('generates a mother, a father and 0-3 siblings', () => {
    let sawNoSiblings = false;
    let sawSiblings = false;

    for (let seed = 1; seed <= 60; seed += 1) {
      const state = createLife(testRegistry(), { seed });
      const people = peopleOf(state);
      const mothers = people.filter((p) => p.kind === 'mother');
      const fathers = people.filter((p) => p.kind === 'father');
      const siblings = people.filter((p) => p.kind === 'sibling');

      expect(mothers).toHaveLength(1);
      expect(fathers).toHaveLength(1);
      expect(siblings.length).toBeGreaterThanOrEqual(0);
      expect(siblings.length).toBeLessThanOrEqual(3);
      if (siblings.length === 0) {
        sawNoSiblings = true;
      } else {
        sawSiblings = true;
      }

      expect(mothers[0].gender).toBe('female');
      expect(mothers[0].age).toBeGreaterThanOrEqual(20);
      expect(mothers[0].age).toBeLessThanOrEqual(42);
      expect(mothers[0].rel).toBeGreaterThanOrEqual(70);
      expect(mothers[0].rel).toBeLessThanOrEqual(100);

      expect(fathers[0].gender).toBe('male');
      expect(fathers[0].age).toBeGreaterThanOrEqual(22);
      expect(fathers[0].age).toBeLessThanOrEqual(45);
      expect(fathers[0].rel).toBeGreaterThanOrEqual(70);
      expect(fathers[0].rel).toBeLessThanOrEqual(100);

      for (const sibling of siblings) {
        expect(sibling.age).toBeGreaterThanOrEqual(1);
        expect(sibling.age).toBeLessThanOrEqual(10);
        expect(sibling.rel).toBeGreaterThanOrEqual(55);
        expect(sibling.rel).toBeLessThanOrEqual(95);
      }

      for (const person of people) {
        expect(person.alive).toBe(true);
        expect(person.name.endsWith(` ${state.character.lastName}`)).toBe(true);
      }
    }

    expect(sawNoSiblings).toBe(true);
    expect(sawSiblings).toBe(true);
  });

  it('numbers family members sequentially and leaves the counter ready', () => {
    const state = createLife(testRegistry(), { seed: 23 });
    const ids = Object.keys(state.people);
    expect(ids).toEqual(ids.map((_, i) => `p${i + 1}`));
    expect(state.character.flags.nextPersonId).toBe(ids.length + 1);
    expect(state.character.id).toBe('me');
  });
});

describe('addPerson', () => {
  const stranger = {
    kind: 'friend',
    name: 'Sam Ray',
    gender: 'male',
    age: 12,
    alive: true,
    rel: 50,
    flags: {},
  } as const;

  it('assigns the next id, stores the person and advances the counter', () => {
    const state = createLife(testRegistry(), { seed: 31 });
    const before = state.character.flags.nextPersonId;
    expect(typeof before).toBe('number');

    const first = addPerson(state, { ...stranger, flags: {} });
    const second = addPerson(state, { ...stranger, name: 'Kit Ray', flags: {} });

    expect(first.id).toBe(`p${Number(before)}`);
    expect(second.id).toBe(`p${Number(before) + 1}`);
    expect(state.people[first.id]).toBe(first);
    expect(state.people[second.id]).toBe(second);
    expect(state.character.flags.nextPersonId).toBe(Number(before) + 2);
    expect(first.name).toBe('Sam Ray');
  });

  it('starts at p1 when the counter flag is missing', () => {
    const state = createLife(testRegistry(), { seed: 32 });
    state.people = {};
    delete state.character.flags.nextPersonId;

    const person = addPerson(state, { ...stranger, flags: {} });

    expect(person.id).toBe('p1');
    expect(state.character.flags.nextPersonId).toBe(2);
  });

  /* `nextPersonId` is an ordinary flag: content writes it through
     `{ kind: 'flag' }` with no reserved-name protection, and a hand-edited or
     truncated save can hold anything at all. Restarting the counter at 1 would
     re-mint `p1` — the exact shape `state.people` already holds — and the store
     would replace whoever lives there, so every damaged value has to land on a
     free id instead. */
  const damaged: readonly (boolean | number | string)[] = [
    'oops',
    true,
    0,
    -3,
    1.5e-9,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_VALUE,
  ];

  for (const value of damaged) {
    it(`mints a free id and replaces nobody when the counter is ${String(value)}`, () => {
      const state = createLife(testRegistry(), { seed: 112 });
      const before = { ...state.people };
      const ids = Object.keys(before);
      expect(ids.length).toBeGreaterThanOrEqual(2);

      state.character.flags.nextPersonId = value;
      const person = addPerson(state, { ...stranger, name: 'Newcomer', flags: {} });

      // A fresh id, not one that was already handed out.
      expect(ids).not.toContain(person.id);
      expect(person.id).toBe(`p${ids.length + 1}`);
      expect(state.people[person.id]).toBe(person);
      // Every existing person is untouched — same id, same object.
      for (const id of ids) {
        expect(state.people[id]).toBe(before[id]);
      }
      expect(Object.keys(state.people)).toHaveLength(ids.length + 1);
      // And the counter is usable again for the next call.
      expect(state.character.flags.nextPersonId).toBe(ids.length + 2);
      const after = addPerson(state, { ...stranger, name: 'Later', flags: {} });
      expect(after.id).toBe(`p${ids.length + 2}`);
      expect(state.people[person.id]).toBe(person);
    });
  }

  it('skips over ids the table already holds when the counter has fallen behind', () => {
    const state = createLife(testRegistry(), { seed: 41 });
    const before = { ...state.people };
    const ids = Object.keys(before);

    // A stale counter (rolled back by a save merge) points at a live person.
    state.character.flags.nextPersonId = 1;
    const person = addPerson(state, { ...stranger, name: 'Newcomer', flags: {} });

    expect(person.id).toBe(`p${ids.length + 1}`);
    for (const id of ids) {
      expect(state.people[id]).toBe(before[id]);
    }
    expect(Object.keys(state.people)).toHaveLength(ids.length + 1);
  });

  it('rebuilds a lost counter above the highest id still in the table', () => {
    const state = createLife(testRegistry(), { seed: 44 });
    const keep = state.people.p1;
    // A save that dropped everyone but the highest-numbered person.
    state.people = { p9: { ...keep, id: 'p9' } };
    delete state.character.flags.nextPersonId;

    const person = addPerson(state, { ...stranger, flags: {} });

    expect(person.id).toBe('p10');
    expect(state.people.p9.id).toBe('p9');
    expect(state.character.flags.nextPersonId).toBe(11);
  });

  it('ignores ids that are not in the minted shape when rebuilding the counter', () => {
    const state = createLife(testRegistry(), { seed: 45 });
    const keep = state.people.p1;
    state.people = { p2: { ...keep, id: 'p2' }, spouse: { ...keep, id: 'spouse' } };
    delete state.character.flags.nextPersonId;

    const person = addPerson(state, { ...stranger, flags: {} });

    expect(person.id).toBe('p3');
    expect(state.people.spouse.id).toBe('spouse');
    expect(state.people.p2.id).toBe('p2');
  });
});

describe('pronounsFor', () => {
  it('maps each gender to its forms', () => {
    expect(pronounsFor('male')).toEqual({ sub: 'he', obj: 'him', pos: 'his' });
    expect(pronounsFor('female')).toEqual({ sub: 'she', obj: 'her', pos: 'her' });
    expect(pronounsFor('nonbinary')).toEqual({ sub: 'they', obj: 'them', pos: 'their' });
  });

  it('returns a fresh object each call', () => {
    const first = pronounsFor('male');
    first.sub = 'it';
    expect(pronounsFor('male').sub).toBe('he');
  });
});

describe('emigrateTo', () => {
  function adult(seed = 7): GameState {
    const state = createLife(testRegistry(), {
      seed,
      countryId: 'us',
      firstName: 'Ada',
      lastName: 'Byron',
      gender: 'female',
    });
    const c = state.character;
    c.age = 30;
    c.money = 10000;
    c.stats.smarts = 50;
    c.stats.happiness = 50;
    return state;
  }

  it('refuses an unknown country without charging', () => {
    const state = adult();
    const res = emigrateTo(state, testRegistry(), 'atlantis');
    expect(res).toEqual({ ok: false, reason: 'unknown-country' });
    expect(state.character.money).toBe(10000);
    expect(state.character.flags.lastVisaAge).toBeUndefined();
  });

  it('refuses the country the character already lives in', () => {
    const state = adult();
    const res = emigrateTo(state, testRegistry(), 'us');
    expect(res).toEqual({ ok: false, reason: 'same-country' });
    expect(state.character.money).toBe(10000);
  });

  it('refuses minors', () => {
    const state = adult();
    state.character.age = 17;
    const res = emigrateTo(state, testRegistry(), 'jp');
    expect(res).toEqual({ ok: false, reason: 'too-young' });
    expect(state.character.money).toBe(10000);
  });

  it('refuses when the fee is unaffordable', () => {
    const state = adult();
    state.character.money = 1999;
    const res = emigrateTo(state, testRegistry(), 'jp');
    expect(res).toEqual({ ok: false, reason: 'no-money' });
    expect(state.character.money).toBe(1999);
  });

  it('refuses from prison', () => {
    const state = adult();
    state.character.prison = { crime: 'burglary', yearsLeft: 2, totalYears: 4 };
    const res = emigrateTo(state, testRegistry(), 'jp');
    expect(res).toEqual({ ok: false, reason: 'in-prison' });
    expect(state.character.money).toBe(10000);
  });

  it('refuses a second application inside the five-year cooldown', () => {
    const state = adult();
    state.character.flags.lastVisaAge = 26;
    const res = emigrateTo(state, testRegistry(), 'jp');
    expect(res).toEqual({ ok: false, reason: 'cooldown' });
    expect(state.character.money).toBe(10000);
    expect(state.character.flags.lastVisaAge).toBe(26);
  });

  it('allows an application once the cooldown has passed', () => {
    const state = adult();
    state.character.flags.lastVisaAge = 25;
    const res = emigrateTo(state, testRegistry(), 'jp');
    expect(res.reason).not.toBe('cooldown');
    expect(state.character.money).toBe(8000);
    expect(state.character.flags.lastVisaAge).toBe(30);
  });

  /** Rolls the same application from different cursors until it lands `wanted`. */
  function applicationWhere(wanted: boolean, tweak?: (s: GameState) => void): GameState {
    for (let i = 0; i < 200; i += 1) {
      const state = adult();
      state.rngState = i * 7919 + 13;
      tweak?.(state);
      const res = emigrateTo(state, testRegistry(), 'jp');
      if (res.ok === wanted) {
        return state;
      }
    }
    throw new Error(`no cursor produced ok=${String(wanted)}`);
  }

  it('both approves and denies applications depending on the roll', () => {
    let approved = 0;
    let denied = 0;
    for (let i = 0; i < 60; i += 1) {
      const state = adult();
      state.rngState = i * 7919 + 13;
      const res = emigrateTo(state, testRegistry(), 'jp');
      if (res.ok) {
        approved += 1;
      } else {
        expect(res.reason).toBe('denied');
        denied += 1;
      }
      expect(state.character.money).toBe(8000);
      expect(state.character.flags.lastVisaAge).toBe(30);
    }
    expect(approved).toBeGreaterThan(0);
    expect(denied).toBeGreaterThan(0);
  });

  it('moves the character on approval', () => {
    const state = applicationWhere(true);
    const c = state.character;
    expect(c.countryId).toBe('jp');
    expect(c.flags.countryLabel).toBe('Japan');
    expect(c.stats.happiness).toBe(60);
    expect(lastEntry(state)).toEqual({ icon: '✈️', kind: 'good', text: 'You moved to Japan.' });
  });

  it('clamps the approval happiness bonus at 100', () => {
    const state = applicationWhere(true, (s) => {
      s.character.stats.happiness = 95;
    });
    expect(state.character.stats.happiness).toBe(100);
  });

  it('keeps the character home on denial', () => {
    const state = applicationWhere(false);
    const c = state.character;
    expect(c.countryId).toBe('us');
    expect(c.flags.countryLabel).toBe('the United States');
    expect(c.stats.happiness).toBe(45);
    expect(lastEntry(state)).toEqual({
      icon: '✈️',
      kind: 'bad',
      text: 'Your visa application to Japan was denied.',
    });
  });

  it('advances the shared cursor so the roll is not repeatable in place', () => {
    const state = adult();
    state.rngState = 12345;
    emigrateTo(state, testRegistry(), 'jp');
    expect(state.rngState).not.toBe(12345);
  });

  it('refuses once the life is over, charging nothing and rolling nothing', () => {
    const state = adult();
    killCharacter(state, testRegistry(), 'a heart attack');
    const character = JSON.stringify(state.character);
    const cursor = state.rngState;
    const feed = state.log[state.log.length - 1].entries.length;

    expect(emigrateTo(state, testRegistry(), 'jp')).toEqual({ ok: false, reason: 'life-over' });

    expect(JSON.stringify(state.character)).toBe(character);
    // No $2,000 visa fee against a settled estate, and no visa stamp either.
    expect(state.character.money).toBe(10000);
    expect(state.character.flags.lastVisaAge).toBeUndefined();
    /* The roll must not happen: a draw here would advance the cursor past the
       end of the life, and the entry would land after the obituary. */
    expect(state.rngState).toBe(cursor);
    expect(state.log[state.log.length - 1].entries).toHaveLength(feed);
    expect(state.death?.epitaphStats.netWorth).toBe(10000);
  });
});

describe('lifeIsOver', () => {
  it('is true only once the life has ended', () => {
    const state = createLife(testRegistry(), { seed: 61 });

    expect(lifeIsOver(state)).toBe(false);
    // A queued choice pauses the year; it does not finish the life.
    state.phase = 'awaitingChoice';
    expect(lifeIsOver(state)).toBe(false);
    state.phase = 'dead';
    expect(lifeIsOver(state)).toBe(true);
  });
});
