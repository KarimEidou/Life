import { describe, expect, it } from 'vitest';

import { careerPhase } from '@/engine/phases/career';
import { educationPhase } from '@/engine/phases/education';
import { buildRegistry, emptyPack, validateRegistry } from '@/engine/registry';
import { createRng } from '@/engine/rng';
import { createLife } from '@/engine/state';
import type {
  AchievementDef,
  AssetDef,
  ContentPack,
  ContentRegistry,
  CountryDef,
  CrimeDef,
  Ctx,
  EventChoice,
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

/** Every id map the registry hands out, under the name it is published as. */
function indexes(reg: ContentRegistry): Record<string, Record<string, unknown>> {
  return {
    eventsById: reg.eventsById,
    interactionsById: reg.interactionsById,
    jobsById: reg.jobsById,
    assetsById: reg.assetsById,
    illnessesById: reg.illnessesById,
    schoolsById: reg.schoolsById,
    countriesById: reg.countriesById,
    crimesById: reg.crimesById,
    achievementsById: reg.achievementsById,
    namePools: reg.namePools,
  };
}

/** Keys every plain object literal answers even when nothing was ever stored. */
const INHERITED_KEYS = [
  'toString',
  'constructor',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  '__proto__',
] as const;

/** A Ctx over a fresh life, for the phases that read the registry's indexes. */
function ctxFor(reg: ContentRegistry, seed = 1): Ctx {
  const state = createLife(reg, { seed });
  return { state, c: state.character, rng: createRng(state), reg };
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
    // The loser leaves no trace in the map, so the lint is the only thing that can name it.
    expect(validateRegistry(reg)).toContain('duplicate name pool for country id "us"');
  });

  it('does not treat inherited object keys as declared ids', () => {
    const reg = buildRegistry([pack('one', { events: [event({ id: 'constructor' })] })]);
    expect(reg.eventsById.constructor).toBe(reg.events[0]);
    expect(validateRegistry(reg)).toEqual([]);
  });
});

/**
 * Every `find*` helper in the engine reads one of these maps through a widened
 * `Record<string, T | undefined>` so a missing id comes back undefined. That is
 * only true of a map that inherits nothing: a plain object literal answers
 * `toString`, `constructor` and friends with a member of `Object.prototype`,
 * which is truthy and sails straight past every missing-def guard downstream.
 */
describe('buildRegistry: inherited members are not content', () => {
  it('answers undefined for every inherited key, in every index', () => {
    const registries: Record<string, ContentRegistry> = {
      empty: buildRegistry([]),
      populated: buildRegistry([
        pack('all', {
          events: [event()],
          jobs: [job()],
          schools: ladder(),
          countries: [country()],
          illnesses: [illness()],
          assets: [asset()],
          crimes: [crime()],
          achievements: [achievement()],
          interactions: [interaction()],
          namePools: [pool()],
        }),
      ]),
    };

    for (const [shape, reg] of Object.entries(registries)) {
      for (const [name, map] of Object.entries(indexes(reg))) {
        for (const key of INHERITED_KEYS) {
          expect(map[key], `${shape} registry: ${name}.${key}`).toBeUndefined();
        }
      }
    }
  });

  it('leaves a job whose id is an inherited key looking unemployed to the phase', () => {
    // `toString` used to resolve to Function.prototype.toString, whose
    // `raisePct` is undefined: the raise turned the salary into NaN for good.
    const ctx = ctxFor(buildRegistry([]));
    const c = ctx.c;
    c.age = 30;
    c.money = 50000;
    c.job = {
      jobId: 'toString',
      title: 'Ghost',
      salary: 40000,
      years: 2,
      performance: 60,
      workHard: false,
    };

    careerPhase(ctx);

    expect(c.job?.salary).toBe(40000);
    expect(Number.isFinite(c.job?.salary ?? Number.NaN)).toBe(true);
  });

  it('empties a desk whose school id is an inherited key', () => {
    // The education self-heal is guarded on `findSchool` missing; `valueOf`
    // used to satisfy it, stranding the character in a school forever.
    const ctx = ctxFor(buildRegistry([]));
    const ed = ctx.c.education;
    ctx.c.age = 10;
    ed.level = 'primary';
    ed.enrolledIn = 'valueOf';
    ed.year = 0;
    ed.gpa = 3;

    educationPhase(ctx);

    expect(ed.enrolledIn).toBeUndefined();
    expect(ed.year).toBe(0);
  });

  it('treats a requested country id that is an inherited key as unknown', () => {
    // `constructor` used to resolve to the Object constructor, whose `.id` is
    // undefined — and that undefined became the character's country.
    const state = createLife(buildRegistry([]), { seed: 1, countryId: 'constructor' });

    expect(state.character.countryId).toBe('us');
    expect(state.character.flags.countryLabel).toBe('us');
    expect(state.log[0]?.entries[0]?.text).not.toContain('undefined');
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

  it('reports a required major that only a postgrad programme lists', () => {
    /* A postgrad `majors` list is the undergrad majors it *accepts*, not a
       curriculum, and `applyToSchool` writes `education.major` only for a
       university — so nobody can ever hold 'Physics' and the job is unearnable.
       Counting the postgrad list as offered made this lint say the pack was clean. */
    const reg = buildRegistry([
      pack('mix', {
        jobs: [job({ id: 'prof', req: { majors: ['Physics'] } })],
        schools: [...ladder(), school({ id: 'phd', level: 'postgrad', years: 4, majors: ['Physics'] })],
      }),
    ]);

    expect(validateRegistry(reg)).toContain(
      'job "prof" requires major "Physics" that no university offers'
    );
  });

  it('accepts a major a university teaches and a postgrad programme also accepts', () => {
    // The shipped shape: a postgrad-gated job asking for the undergrad major its programme takes.
    const reg = buildRegistry([
      pack('mix', {
        jobs: [job({ id: 'doctor', req: { education: 'postgrad', majors: ['biology'] } })],
        schools: [
          ...ladder(),
          school({ id: 'uni', level: 'university', years: 4, majors: ['biology'] }),
          school({ id: 'med', level: 'postgrad', years: 4, majors: ['biology'] }),
        ],
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

  it('reports a non-finite weight on an event and on an outcome', () => {
    /* `Infinity > 0` is true, so a bare `> 0` gate validated both of these
       clean while `rng.weighted` refuses them at draw time: the event throws
       out of `eventsPhase`, and the outcome makes every deal of the card end in
       `discardPending`. `weight>0` is this lint's own promise, and the
       predicate it has to promise is `rng.weighted`'s: finite and positive. */
    const reg = buildRegistry([
      pack('events', {
        events: [
          event({ id: 'endless', weight: Number.POSITIVE_INFINITY }),
          event({ id: 'nan-weight', weight: Number.NaN }),
          event({ id: 'backwards-infinite', weight: Number.NEGATIVE_INFINITY }),
          event({
            id: 'endless-outcome',
            choices: [
              {
                label: 'Go',
                outcomes: [
                  { weight: Number.POSITIVE_INFINITY, text: 'Nothing.', effects: [] },
                  { weight: Number.NaN, text: 'Also nothing.', effects: [] },
                ],
              },
            ],
          }),
        ],
      }),
    ]);

    const problems = validateRegistry(reg);
    expect(problems).toContain('event "endless" has weight Infinity');
    expect(problems).toContain('event "nan-weight" has weight NaN');
    expect(problems).toContain('event "backwards-infinite" has weight -Infinity');
    expect(problems).toContain('event "endless-outcome" choice "Go" outcome 0 has weight Infinity');
    expect(problems).toContain('event "endless-outcome" choice "Go" outcome 1 has weight NaN');
  });

  it('leaves ordinary finite weights alone', () => {
    // The predicate was widened, not tightened: valid content still validates clean.
    const reg = buildRegistry([
      pack('events', {
        events: [
          event({ id: 'tiny', weight: 0.001 }),
          event({
            id: 'branching',
            weight: 1000,
            choices: [{ label: 'Go', outcomes: [{ weight: 0.5, text: 'Fine.', effects: [] }] }],
          }),
        ],
      }),
    ]);

    expect(validateRegistry(reg)).toEqual([]);
  });

  it('reports a choice with no outcome list at all instead of throwing on it', () => {
    /* The shape `ageUp`'s `canRollOutcome` widens for, and the one this lint is
       documented to name. It reached the validator as an opaque TypeError. */
    const choiceless = { label: 'Shrug' } as unknown as EventChoice;
    const reg = buildRegistry([
      pack('events', { events: [event({ id: 'listless', choices: [choiceless] })] }),
    ]);

    let problems: string[] = [];
    expect(() => {
      problems = validateRegistry(reg);
    }).not.toThrow();
    expect(problems).toContain('event "listless" choice "Shrug" has no outcomes');
  });

  it('reports an illness id no IllnessDef defines, from effects and from outcomes', () => {
    const reg = buildRegistry([
      pack('sick', {
        illnesses: [illness({ id: 'flu' })],
        events: [
          event({ id: 'instant', effects: [{ kind: 'illness', add: 'dragonpox' }] }),
          event({
            id: 'branching',
            choices: [
              {
                label: 'Drink it',
                outcomes: [
                  { weight: 1, text: 'Cured?', effects: [{ kind: 'illness', cure: 'ennui' }] },
                  { weight: 1, text: 'Worse.', effects: [{ kind: 'illness', add: 'flu' }] },
                ],
              },
            ],
          }),
        ],
      }),
    ]);

    const problems = validateRegistry(reg);
    expect(problems).toContain('event "instant" adds unknown illness "dragonpox"');
    expect(problems).toContain('event "branching" cures unknown illness "ennui"');
    // The one illness the pack actually defines is not a problem.
    expect(problems).not.toContain('event "branching" adds unknown illness "flu"');
  });

  it('names a dangling illness once however many outcomes repeat the typo', () => {
    const reg = buildRegistry([
      pack('sick', {
        events: [
          event({
            id: 'thrice',
            effects: [{ kind: 'illness', add: 'dragonpox' }],
            choices: [
              {
                label: 'Again',
                outcomes: [
                  { weight: 1, text: 'A.', effects: [{ kind: 'illness', add: 'dragonpox' }] },
                  { weight: 1, text: 'B.', effects: [{ kind: 'illness', add: 'dragonpox' }] },
                ],
              },
            ],
          }),
        ],
      }),
    ]);

    const problems = validateRegistry(reg);
    expect(problems.filter((p) => p.includes('unknown illness "dragonpox"'))).toHaveLength(1);
  });

  it('reports a name pool keyed to a country nobody declared', () => {
    const reg = buildRegistry([
      pack('c', { countries: [country()], namePools: [pool(), pool({ countryId: 'atlantis' })] }),
    ]);

    const problems = validateRegistry(reg);
    expect(problems).toContain('name pool for unknown country "atlantis"');
    expect(problems).not.toContain('name pool for unknown country "us"');

    // Pools authored before any country pack exists are early, not wrong.
    const countryless = buildRegistry([pack('c', { namePools: [pool({ countryId: 'atlantis' })] })]);
    expect(validateRegistry(countryless)).toEqual([]);
  });

  it('reports a country claimed by two name pools, once, and one pool each alone', () => {
    /* The only duplicate the registry cannot be asked about after the fact:
       pools are keyed by country and the loser is dropped at build time, not
       kept in a list, so a pack that widens an existing pool ships names no
       life can ever draw while `namePools.us` still answers with a full pool
       and every other check passes. */
    const reg = buildRegistry([
      pack('one', { countries: [country()], namePools: [pool({ last: ['First'] })] }),
      pack('two', { namePools: [pool({ last: ['Second'] }), pool({ last: ['Third'] })] }),
    ]);

    expect(validateRegistry(reg)).toEqual(['duplicate name pool for country id "us"']);

    // One pool per country is the shipped shape, however many countries there are.
    const distinct = buildRegistry([
      pack('c', {
        countries: [country(), country({ id: 'jp', label: 'Japan' })],
        namePools: [pool(), pool({ countryId: 'jp' })],
      }),
    ]);
    expect(validateRegistry(distinct)).toEqual([]);
  });

  it('lints a registry it did not build instead of throwing on the missing pool list', () => {
    /* Several suites hand-build a `ContentRegistry` literal, and the authored
       pool list is kept beside the registry rather than on it, so those
       fixtures have no pools to compare. The lint still has to run on them. */
    const us = country();
    const handBuilt: ContentRegistry = {
      ...buildRegistry([]),
      countries: [us],
      countriesById: { us },
      namePools: { us: pool() },
    };

    expect(validateRegistry(handBuilt)).toEqual([]);
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
    expect(problems).toContain('interaction "nap" has cooldownYears -1');
  });

  it('reports a negative payout or sentence on a crime', () => {
    /* Ordered and finite was the whole test, so a range that is simply below
       zero validated clean: `commitCrime` rolls a negative payout, banks it and
       reports the success as 'You got away with it. +-$1,240' while the balance
       drops, and a negative sentence is served as no time at all — the term the
       pack authored never happens and nothing says why. */
    const reg = buildRegistry([
      pack('misc', {
        crimes: [
          crime({ id: 'fine', payout: [-2000, -500] }),
          crime({ id: 'backpay', sentenceYears: [-1, 3] }),
        ],
      }),
    ]);

    const problems = validateRegistry(reg);
    expect(problems).toContain('crime "fine" has payout floor -2000');
    expect(problems).toContain('crime "backpay" has sentenceYears floor -1');
  });

  it('names an unreadable crime range once, as a range', () => {
    // The sign check runs on readable bounds only, so a NaN keeps one line.
    const reg = buildRegistry([
      pack('misc', {
        crimes: [
          crime({ id: 'ghost-take', payout: [Number.NaN, 500] }),
          crime({ id: 'ghost-term', sentenceYears: [1, Number.POSITIVE_INFINITY] }),
        ],
      }),
    ]);

    expect(validateRegistry(reg)).toEqual([
      'crime "ghost-take" has a non-finite payout range',
      'crime "ghost-term" has a non-finite sentenceYears range',
    ]);
  });

  it('leaves an ordinary crime range alone, including a zero floor', () => {
    /* Widened, not tightened: the shipped shape is a crime that pays nothing
       and one whose sentence may come to nothing. */
    const reg = buildRegistry([
      pack('misc', {
        crimes: [
          crime({ id: 'vandalism', payout: [0, 0], sentenceYears: [0, 1] }),
          crime({ id: 'heist', payout: [2000, 15000], sentenceYears: [1, 4] }),
        ],
      }),
    ]);
    expect(validateRegistry(reg)).toEqual([]);
  });

  it('reports an unreadable cooldown on an interaction', () => {
    /* `NaN < 0` and `Infinity < 0` are both false, so the old gate passed the
       two values that break the cooldown worst: `canUse` tests `cooldown > 0`,
       which NaN fails, dropping the gate entirely — the row is unlimited-use
       inside one year — while Infinity keeps `age - lastUsedAge < cooldown`
       true for the rest of the life after a single use. */
    const reg = buildRegistry([
      pack('misc', {
        interactions: [
          interaction({ id: 'unmetered', cooldownYears: Number.NaN }),
          interaction({ id: 'once-ever', cooldownYears: Number.POSITIVE_INFINITY }),
        ],
      }),
    ]);

    const problems = validateRegistry(reg);
    expect(problems).toContain('interaction "unmetered" has cooldownYears NaN');
    expect(problems).toContain('interaction "once-ever" has cooldownYears Infinity');
  });

  it('leaves an ordinary cooldown alone, including none at all and zero', () => {
    // Widened, not tightened: a metered row and an unmetered one both validate clean.
    const reg = buildRegistry([
      pack('misc', {
        interactions: [
          interaction({ id: 'spa', cooldownYears: 3 }),
          interaction({ id: 'walk', cooldownYears: 0 }),
          interaction({ id: 'read' }),
        ],
      }),
    ]);
    expect(validateRegistry(reg)).toEqual([]);
  });

  it('reports an inverted age window on an interaction, and leaves usable ones alone', () => {
    /* Transposing the pair is quieter than any other authoring slip on a row:
       `availableInteractions` filters on `age >= minAge && age <= maxAge`, which
       no age satisfies, so the sheet never renders the row for `canUse` to
       refuse — the pack ships content no life can reach. A one-sided window and
       a single-age one are both satisfiable, so neither is named. */
    const reg = buildRegistry([
      pack('misc', {
        interactions: [
          interaction({ id: 'backwards', minAge: 45, maxAge: 18 }),
          interaction({ id: 'grown-up', minAge: 18, maxAge: 45 }),
          interaction({ id: 'floor-only', minAge: 18 }),
          interaction({ id: 'ceiling-only', maxAge: 18 }),
          interaction({ id: 'one-year-only', minAge: 18, maxAge: 18 }),
        ],
      }),
    ]);

    expect(validateRegistry(reg)).toEqual([
      'interaction "backwards" has minAge 45 above maxAge 18',
    ]);
  });

  it('names a jail sentence of no readable length on an event and on an outcome', () => {
    /* `applyEffects` answers an unreadable sentence with no time served, so the
       cell the pack authored never happens and nothing else says why. */
    const reg = buildRegistry([
      pack('misc', {
        events: [
          event({ id: 'raid', effects: [{ kind: 'jail', years: Number.NaN, crime: 'Fraud' }] }),
          event({
            id: 'trial',
            choices: [
              {
                label: 'Plead',
                outcomes: [
                  {
                    weight: 1,
                    text: 'Guilty.',
                    effects: [{ kind: 'jail', years: Number.POSITIVE_INFINITY, crime: 'Treason' }],
                  },
                ],
              },
            ],
          }),
        ],
      }),
    ]);

    const problems = validateRegistry(reg);
    expect(problems).toContain('event "raid" has a jail sentence of NaN years');
    expect(problems).toContain(
      'event "trial" choice "Plead" outcome 0 has a jail sentence of Infinity years'
    );
  });

  it('leaves an ordinary jail sentence alone', () => {
    const reg = buildRegistry([
      pack('misc', {
        events: [event({ id: 'raid', effects: [{ kind: 'jail', years: 2, crime: 'Fraud' }] })],
      }),
    ]);
    expect(validateRegistry(reg)).toEqual([]);
  });

  it('reports a non-finite asset price', () => {
    /* `Infinity > 0` is true, so a bare `> 0` gate validated an infinite price
       clean while `buyAsset` refuses it — 'That is not for sale.' at every
       balance and every age — and the sheet renders the row as $0. NaN and
       -Infinity already failed the old gate; they are pinned so the whole
       family stays named. */
    const reg = buildRegistry([
      pack('misc', {
        assets: [
          asset({ id: 'endless', price: Number.POSITIVE_INFINITY }),
          asset({ id: 'nan-price', price: Number.NaN }),
          asset({ id: 'backwards-infinite', price: Number.NEGATIVE_INFINITY }),
        ],
      }),
    ]);

    const problems = validateRegistry(reg);
    expect(problems).toContain('asset "endless" has price Infinity');
    expect(problems).toContain('asset "nan-price" has price NaN');
    expect(problems).toContain('asset "backwards-infinite" has price -Infinity');
  });

  it('leaves an ordinary finite price alone', () => {
    // The predicate was widened, not tightened: priced content still validates clean.
    const reg = buildRegistry([pack('misc', { assets: [asset({ price: 20000 })] })]);
    expect(validateRegistry(reg)).toEqual([]);
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
