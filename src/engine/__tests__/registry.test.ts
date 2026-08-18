import { describe, expect, it } from 'vitest';

import { buildRegistry, emptyPack, validateRegistry } from '@/engine/registry';
import type {
  AchievementDef,
  AssetDef,
  ContentPack,
  CountryDef,
  CrimeDef,
  EventDef,
  IllnessDef,
  InteractionDef,
  JobDef,
  NamePool,
  SchoolDef,
} from '@/types';

function event(over: Partial<EventDef> = {}): EventDef {
  return {
    id: 'life-something',
    area: 'life',
    icon: '🎲',
    minAge: 0,
    maxAge: 100,
    weight: 1,
    text: 'Something happened.',
    ...over,
  };
}

function job(over: Partial<JobDef> = {}): JobDef {
  return {
    id: 'clerk',
    track: 'office',
    title: 'Clerk',
    icon: '💼',
    level: 1,
    baseSalary: 30000,
    raisePct: 0.03,
    req: {},
    ...over,
  };
}

function school(over: Partial<SchoolDef> = {}): SchoolDef {
  return { id: 'primary', label: 'Primary School', level: 'primary', years: 5, tuitionPerYear: 0, ...over };
}

/** The three compulsory levels, exactly once each: the shape the validator wants. */
function ladder(): SchoolDef[] {
  return [
    school(),
    school({ id: 'middle', label: 'Middle School', level: 'middle', years: 3 }),
    school({ id: 'high', label: 'High School', level: 'high', years: 4 }),
  ];
}

function interaction(over: Partial<InteractionDef> = {}): InteractionDef {
  return {
    id: 'gym',
    area: 'activities',
    label: 'Go to the gym',
    icon: '🏋️',
    resolve: () => ({ text: 'You worked out.', effects: [] }),
    ...over,
  };
}

function crime(over: Partial<CrimeDef> = {}): CrimeDef {
  return {
    id: 'shoplift',
    label: 'Shoplifting',
    icon: '🛍️',
    minAge: 10,
    successChance: () => 0.5,
    payout: [20, 200],
    sentenceYears: [1, 3],
    ...over,
  };
}

function asset(over: Partial<AssetDef> = {}): AssetDef {
  return {
    id: 'sedan',
    type: 'vehicle',
    label: 'Sedan',
    icon: '🚗',
    price: 20000,
    upkeepPct: 0.05,
    apprPct: -0.1,
    ...over,
  };
}

function illness(over: Partial<IllnessDef> = {}): IllnessDef {
  return {
    id: 'flu',
    label: 'the flu',
    chronic: false,
    lethality: 0.001,
    onsetWeight: () => 1,
    healthHit: 10,
    treatCost: 200,
    cureChance: 0.8,
    ...over,
  };
}

function country(over: Partial<CountryDef> = {}): CountryDef {
  return { id: 'us', label: 'United States', flag: '🇺🇸', costMult: 1, taxMult: 1, visaDifficulty: 0.5, ...over };
}

function pool(over: Partial<NamePool> = {}): NamePool {
  return { countryId: 'us', male: ['Alex'], female: ['Riley'], last: ['Doe'], ...over };
}

function achievement(over: Partial<AchievementDef> = {}): AchievementDef {
  return { id: 'rich', label: 'Rich', desc: 'Bank a million.', icon: '💰', check: () => false, ...over };
}

function pack(id: string, parts: Omit<ContentPack, 'id'>): ContentPack {
  return { id, ...parts };
}

describe('buildRegistry', () => {
  it('builds an empty, valid registry from no packs', () => {
    const reg = buildRegistry([]);

    expect(reg.packs).toEqual([]);
    expect(reg.events).toEqual([]);
    expect(reg.eventsById).toEqual({});
    expect(reg.jobs).toEqual([]);
    expect(reg.namePools).toEqual({});
    expect(validateRegistry(reg)).toEqual([]);
  });

  it('records pack ids in registration order', () => {
    const reg = buildRegistry([emptyPack('a'), emptyPack('b'), emptyPack('c')]);
    expect(reg.packs).toEqual(['a', 'b', 'c']);
  });

  it('concatenates every collection across packs and indexes it by id', () => {
    const reg = buildRegistry([
      pack('one', { events: [event({ id: 'a' })], jobs: [job({ id: 'clerk' })] }),
      pack('two', {
        events: [event({ id: 'b' })],
        jobs: [job({ id: 'manager', level: 2 })],
        assets: [asset()],
        illnesses: [illness()],
        schools: ladder(),
        countries: [country()],
        crimes: [crime()],
        achievements: [achievement()],
        interactions: [interaction()],
        namePools: [pool()],
      }),
    ]);

    expect(reg.events.map((e) => e.id)).toEqual(['a', 'b']);
    expect(reg.eventsById.b).toBe(reg.events[1]);
    expect(reg.jobs.map((j) => j.id)).toEqual(['clerk', 'manager']);
    expect(reg.schools).toHaveLength(3);
    expect(reg.assetsById.sedan?.label).toBe('Sedan');
    expect(reg.illnessesById.flu?.label).toBe('the flu');
    expect(reg.countriesById.us?.label).toBe('United States');
    expect(reg.crimesById.shoplift?.label).toBe('Shoplifting');
    expect(reg.achievementsById.rich?.label).toBe('Rich');
    expect(reg.interactionsById.gym?.label).toBe('Go to the gym');
    expect(reg.namePools.us?.last).toEqual(['Doe']);
  });

  it('keeps the first declaration when two packs share an id', () => {
    const reg = buildRegistry([
      pack('one', { jobs: [job({ id: 'clerk', title: 'First' })] }),
      pack('two', { jobs: [job({ id: 'clerk', title: 'Second' })] }),
    ]);

    expect(reg.jobsById.clerk?.title).toBe('First');
    // The loser stays in the list so `validateRegistry` can name it.
    expect(reg.jobs).toHaveLength(2);
  });

  it('keys name pools by country and keeps the first pool for a country', () => {
    const reg = buildRegistry([
      pack('one', { namePools: [pool({ countryId: 'us', last: ['First'] })] }),
      pack('two', {
        namePools: [pool({ countryId: 'us', last: ['Second'] }), pool({ countryId: 'jp' })],
      }),
    ]);

    expect(reg.namePools.us?.last).toEqual(['First']);
    expect(Object.keys(reg.namePools).sort()).toEqual(['jp', 'us']);
  });

  it('does not treat inherited object keys as declared ids', () => {
    const reg = buildRegistry([pack('one', { events: [event({ id: 'constructor' })] })]);
    expect(reg.eventsById.constructor).toBe(reg.events[0]);
    expect(validateRegistry(reg)).toEqual([]);
  });
});

describe('validateRegistry', () => {
  it('passes a well-formed registry', () => {
    const reg = buildRegistry([
      pack('all', {
        events: [event({ choices: [{ label: 'Yes', outcomes: [{ weight: 1, text: 'Fine.', effects: [] }] }] })],
        jobs: [
          job({ id: 'clerk', promotesTo: 'manager' }),
          job({ id: 'manager', level: 2, req: { prevJobId: 'clerk', majors: ['Business'] } }),
        ],
        schools: [...ladder(), school({ id: 'uni', label: 'State University', level: 'university', years: 4, majors: ['Business'] })],
        countries: [country()],
        namePools: [pool()],
        crimes: [crime()],
        assets: [asset()],
        interactions: [interaction({ cooldownYears: 1 })],
      }),
    ]);

    expect(validateRegistry(reg)).toEqual([]);
  });

  it('reports duplicate ids per collection, once each', () => {
    const reg = buildRegistry([
      pack('one', { events: [event({ id: 'dup' }), event({ id: 'dup' }), event({ id: 'dup' })] }),
      pack('two', { crimes: [crime({ id: 'c' }), crime({ id: 'c' })] }),
    ]);

    const problems = validateRegistry(reg);
    expect(problems.filter((p) => p.includes('duplicate event id "dup"'))).toHaveLength(1);
    expect(problems).toContain('duplicate crime id "c"');
  });

  it('reports a dangling promotesTo and prevJobId', () => {
    const reg = buildRegistry([
      pack('jobs', { jobs: [job({ id: 'clerk', promotesTo: 'ghost', req: { prevJobId: 'phantom' } })] }),
    ]);

    const problems = validateRegistry(reg);
    expect(problems).toContain('job "clerk" promotesTo unknown job "ghost"');
    expect(problems).toContain('job "clerk" req.prevJobId is unknown job "phantom"');
  });

  it('reports a required major that no university offers', () => {
    const reg = buildRegistry([
      pack('mix', {
        jobs: [job({ id: 'doctor', req: { majors: ['Medicine'] } })],
        // A major listed on a high-school def does not count as offered.
        schools: [...ladder(), school({ id: 'uni', level: 'university', years: 4, majors: ['Law'] })],
      }),
    ]);

    expect(validateRegistry(reg)).toContain(
      'job "doctor" requires major "Medicine" that no university offers'
    );
  });

  it('accepts a major offered by a postgrad programme', () => {
    const reg = buildRegistry([
      pack('mix', {
        jobs: [job({ id: 'prof', req: { majors: ['Physics'] } })],
        schools: [...ladder(), school({ id: 'phd', level: 'postgrad', years: 4, majors: ['Physics'] })],
      }),
    ]);

    expect(validateRegistry(reg)).toEqual([]);
  });

  it('reports broken event windows, weights, choices and outcomes', () => {
    const reg = buildRegistry([
      pack('events', {
        events: [
          event({ id: 'backwards', minAge: 40, maxAge: 10 }),
          event({ id: 'weightless', weight: 0 }),
          event({ id: 'empty-choice', choices: [{ label: 'Shrug', outcomes: [] }] }),
          event({
            id: 'zero-outcome',
            choices: [{ label: 'Go', outcomes: [{ weight: 0, text: 'Nothing.', effects: [] }] }],
          }),
          event({
            id: 'twin-labels',
            choices: [
              { label: 'Go', outcomes: [{ weight: 1, text: 'A.', effects: [] }] },
              { label: 'Go', outcomes: [{ weight: 1, text: 'B.', effects: [] }] },
            ],
          }),
        ],
      }),
    ]);

    const problems = validateRegistry(reg);
    expect(problems).toContain('event "backwards" has minAge 40 above maxAge 10');
    expect(problems).toContain('event "weightless" has weight 0');
    expect(problems).toContain('event "empty-choice" choice "Shrug" has no outcomes');
    expect(problems).toContain('event "zero-outcome" choice "Go" outcome 0 has weight 0');
    expect(problems).toContain('event "twin-labels" has duplicate choice label "Go"');
  });

  it('reports reversed sentences, free assets and negative cooldowns', () => {
    const reg = buildRegistry([
      pack('misc', {
        crimes: [crime({ id: 'heist', sentenceYears: [9, 2] })],
        assets: [asset({ id: 'freebie', price: 0 })],
        interactions: [interaction({ id: 'nap', cooldownYears: -1 })],
      }),
    ]);

    const problems = validateRegistry(reg);
    expect(problems).toContain('crime "heist" has a reversed sentenceYears range');
    expect(problems).toContain('asset "freebie" has price 0');
    expect(problems).toContain('interaction "nap" has negative cooldownYears -1');
  });

  it('requires exactly one school per compulsory level once any school exists', () => {
    const missing = buildRegistry([
      pack('school', { schools: [school({ id: 'uni', level: 'university', years: 4 })] }),
    ]);
    const problems = validateRegistry(missing);
    expect(problems).toContain('expected exactly one primary school, found 0');
    expect(problems).toContain('expected exactly one middle school, found 0');
    expect(problems).toContain('expected exactly one high school, found 0');

    const doubled = buildRegistry([
      pack('school', { schools: [...ladder(), school({ id: 'primary-2', level: 'primary', years: 5 })] }),
    ]);
    expect(validateRegistry(doubled)).toContain('expected exactly one primary school, found 2');
  });

  it('requires a name pool per country only once pools exist', () => {
    const poolless = buildRegistry([pack('c', { countries: [country(), country({ id: 'jp' })] })]);
    expect(validateRegistry(poolless)).toEqual([]);

    const partial = buildRegistry([
      pack('c', { countries: [country(), country({ id: 'jp', label: 'Japan' })], namePools: [pool()] }),
    ]);
    const problems = validateRegistry(partial);
    expect(problems).toContain('country "jp" has no name pool');
    expect(problems).not.toContain('country "us" has no name pool');
  });
});
