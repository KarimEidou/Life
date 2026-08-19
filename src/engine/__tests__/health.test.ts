import { describe, expect, it } from 'vitest';

import { clampStat } from '@/engine/effects';
import { healthPhase } from '@/engine/phases/health';
import { createRng, initialRngState } from '@/engine/rng';
import type { Character, ContentRegistry, Ctx, GameState, IllnessDef, LogEntry } from '@/types';

// Hand-rolled fixtures: `createLife` and `buildRegistry` belong to other modules.
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

/* Labels carry their own article, matching how `death.ts` reads one out:
   "You died of the flu at age 50." Every sentence the health phase builds has to
   swallow that same label unchanged. */
function makeIllness(over: Partial<IllnessDef> = {}): IllnessDef {
  return {
    id: 'flu',
    label: 'the flu',
    chronic: false,
    lethality: 0,
    onsetWeight: () => 0,
    healthHit: 20,
    treatCost: 100,
    cureChance: 0.5,
    ...over,
  };
}

/* Indexed the way `buildRegistry` indexes: every def stays in the list, but a
   duplicate id keeps the FIRST declaration in the map. */
function registryWith(illnesses: IllnessDef[]): ContentRegistry {
  const reg = emptyRegistry();
  reg.illnesses = illnesses;
  const byId: Record<string, IllnessDef | undefined> = reg.illnessesById;
  for (const def of illnesses) byId[def.id] ??= def;
  return reg;
}

function makeCharacter(over: Partial<Character> = {}): Character {
  return {
    id: 'me',
    firstName: 'Ada',
    lastName: 'Moreno',
    gender: 'female',
    pronouns: { sub: 'she', obj: 'her', pos: 'her' },
    countryId: 'us',
    age: 40,
    stats: { health: 80, happiness: 60, smarts: 50, looks: 50 },
    money: 5000,
    education: { level: 'high', year: 0, gpa: 0, studyHard: false },
    job: null,
    prison: null,
    assets: [],
    loans: [],
    investments: { savings: 0, index: 0, crypto: 0 },
    illnesses: [],
    addictions: {},
    fame: 0,
    flags: {},
    ...over,
  };
}

const SEED = 7;

function makeState(over: Partial<Character> = {}, seed = SEED): GameState {
  const character = makeCharacter(over);
  return {
    rngState: initialRngState(seed),
    seed,
    generation: 1,
    year: 2025,
    character,
    people: {},
    log: [{ age: character.age, year: 2025, entries: [] }],
    pending: [],
    firedEvents: [],
    interactionUse: {},
    ancestors: [],
    phase: 'alive',
  };
}

function makeCtx(state: GameState, reg: ContentRegistry): Ctx {
  return { state, c: state.character, rng: createRng(state), reg };
}

describe('healthPhase onset', () => {
  it('contracts an illness whose onset is certain and takes the hit at once', () => {
    const reg = registryWith([makeIllness({ onsetWeight: () => 1 })]);
    const state = makeState({ stats: { health: 80, happiness: 60, smarts: 50, looks: 50 } });

    const entries = healthPhase(makeCtx(state, reg));

    expect(state.character.illnesses).toEqual([{ defId: 'flu', years: 0, treated: false }]);
    expect(state.character.stats.health).toBe(60);
    expect(entries).toEqual([{ icon: '🤒', kind: 'health', text: 'You came down with the flu.' }]);
  });

  it('never contracts an illness with zero onset, but still spends its roll', () => {
    const reg = registryWith([makeIllness({ onsetWeight: () => 0 })]);
    const state = makeState();

    const entries = healthPhase(makeCtx(state, reg));

    expect(state.character.illnesses).toEqual([]);
    expect(state.character.stats.health).toBe(80);
    expect(entries).toEqual([]);
    // One draw per un-held definition keeps the roll budget registry-shaped.
    const mirror = { rngState: initialRngState(SEED) };
    createRng(mirror).chance(0);
    expect(state.rngState).toBe(mirror.rngState);
  });

  it('does not roll onset for an illness already held', () => {
    // cureChance 0 keeps it held, so the only draw left to see is the onset one.
    const reg = registryWith([makeIllness({ onsetWeight: () => 1, cureChance: 0 })]);
    const state = makeState({ illnesses: [{ defId: 'flu', years: 2, treated: true }] });

    healthPhase(makeCtx(state, reg));

    expect(state.character.illnesses).toEqual([{ defId: 'flu', years: 3, treated: true }]);
    // A certain onset would fire a second time if it were rolled at all.
    const mirror = { rngState: initialRngState(SEED) };
    createRng(mirror).chance(0.5); // the recovery roll, and nothing else
    expect(state.rngState).toBe(mirror.rngState);
  });

  it('does not also progress an illness in the year it appears', () => {
    const reg = registryWith([makeIllness({ onsetWeight: () => 1, healthHit: 20 })]);
    const state = makeState();

    healthPhase(makeCtx(state, reg));

    // The onset hit only: 80 - 20, never a further 20 / 2 of progression.
    expect(state.character.stats.health).toBe(60);
    expect(state.character.illnesses[0]?.years).toBe(0);
  });

  /* Shipped onset weights multiply themselves by a comorbidity the character
     holds ('a stroke' triples on high blood pressure) and by how low health has
     fallen. Committing a catch before the rest of the registry has rolled would
     hand it those multipliers in the very year the cause appeared, a year before
     the character could treat anything — and would make them depend on where the
     def happens to sit in the list. Every onset is rolled against the state the
     year started in. */
  it('rolls a comorbidity against start-of-year state, so it cannot fire the year its cause appears', () => {
    const reg = registryWith([
      // A small hit keeps the second year clear of the "seriously ill" warning.
      makeIllness({
        id: 'bp',
        label: 'high blood pressure',
        onsetWeight: () => 1,
        healthHit: 5,
        cureChance: 0,
      }),
      makeIllness({
        id: 'stroke',
        label: 'a stroke',
        healthHit: 25,
        cureChance: 0,
        onsetWeight: (ctx) => (ctx.c.illnesses.some((held) => held.defId === 'bp') ? 1 : 0),
      }),
    ]);
    const state = makeState();

    const first = healthPhase(makeCtx(state, reg));

    expect(state.character.illnesses).toEqual([{ defId: 'bp', years: 0, treated: false }]);
    expect(first).toEqual([
      { icon: '🤒', kind: 'health', text: 'You came down with high blood pressure.' },
    ]);

    // The raised risk is real, it just starts accruing from the following year.
    const second = healthPhase(makeCtx(state, reg));

    expect(state.character.illnesses.map((illness) => illness.defId)).toEqual(['bp', 'stroke']);
    expect(second).toEqual([{ icon: '🤒', kind: 'health', text: 'You came down with a stroke.' }]);
  });

  it('shows a later onset the health it started the year with, not what an earlier one docked', () => {
    const seen: number[] = [];
    const reg = registryWith([
      makeIllness({ id: 'bone', label: 'a broken bone', onsetWeight: () => 1, healthHit: 30 }),
      makeIllness({
        id: 'pneumonia',
        label: 'pneumonia',
        onsetWeight: (ctx) => {
          seen.push(ctx.c.stats.health);
          return 0;
        },
      }),
    ]);
    const state = makeState();

    healthPhase(makeCtx(state, reg));

    expect(seen).toEqual([80]);
    // The hit still lands, just once every roll of the year is in.
    expect(state.character.stats.health).toBe(50);
  });

  it('gives the same year whichever order the registry lists cause and consequence in', () => {
    const cause = makeIllness({
      id: 'bp',
      label: 'high blood pressure',
      onsetWeight: () => 1,
      cureChance: 0,
    });
    const consequence = makeIllness({
      id: 'stroke',
      label: 'a stroke',
      cureChance: 0,
      onsetWeight: (ctx) => (ctx.c.illnesses.some((held) => held.defId === 'bp') ? 1 : 0),
    });
    const run = (defs: IllnessDef[]): string[] => {
      const state = makeState();
      healthPhase(makeCtx(state, registryWith(defs)));
      return state.character.illnesses.map((illness) => illness.defId);
    };

    expect(run([cause, consequence])).toEqual(['bp']);
    expect(run([consequence, cause])).toEqual(['bp']);
  });

  it('commits every catch of the year, in registry order and on one roll each', () => {
    const reg = registryWith([
      makeIllness({ id: 'flu', label: 'the flu', onsetWeight: () => 1, healthHit: 5 }),
      makeIllness({ id: 'gout', label: 'gout', onsetWeight: () => 1, healthHit: 8 }),
    ]);
    const state = makeState();

    const entries = healthPhase(makeCtx(state, reg));

    expect(state.character.illnesses).toEqual([
      { defId: 'flu', years: 0, treated: false },
      { defId: 'gout', years: 0, treated: false },
    ]);
    expect(state.character.stats.health).toBe(67);
    expect(entries).toEqual([
      { icon: '🤒', kind: 'health', text: 'You came down with the flu.' },
      { icon: '🤒', kind: 'health', text: 'You came down with gout.' },
    ]);
    // Two onset rolls and nothing else: neither fresh row rolls its own recovery.
    const mirror = { rngState: initialRngState(SEED) };
    const rng = createRng(mirror);
    rng.chance(1);
    rng.chance(1);
    expect(state.rngState).toBe(mirror.rngState);
  });

  /* `buildRegistry` appends every duplicate id to the flat list — that is what
     lets `validateRegistry` name the offending pack — and nothing runs that lint
     at load time, so two packs shipping the same illness reach this loop as two
     entries. The second one is a copy of a condition the character now holds. */
  it('contracts an illness once when two packs declare the same id', () => {
    const flu = makeIllness({ id: 'flu', label: 'the flu', onsetWeight: () => 1 });
    const reg = registryWith([flu, makeIllness({ ...flu, healthHit: 30 })]);
    const state = makeState();

    const entries = healthPhase(makeCtx(state, reg));

    expect(state.character.illnesses).toEqual([{ defId: 'flu', years: 0, treated: false }]);
    // One hit, from the def that caught it; the duplicate's 30 is never paid.
    expect(state.character.stats.health).toBe(60);
    expect(entries).toEqual([{ icon: '🤒', kind: 'health', text: 'You came down with the flu.' }]);
    // And skipped draw-free, exactly as an illness carried in from last year is.
    const mirror = { rngState: initialRngState(SEED) };
    createRng(mirror).chance(1);
    expect(state.rngState).toBe(mirror.rngState);
  });

  /* Only a catch holds the id: a copy that missed leaves the next one its own
     roll, so the duplicate costs the year no draw it would not otherwise spend
     and the catch still lands exactly once. */
  it('still rolls the duplicate of an id the first copy missed, and catches it once', () => {
    const flu = makeIllness({ id: 'flu', label: 'the flu', onsetWeight: () => 0 });
    const reg = registryWith([flu, makeIllness({ ...flu, onsetWeight: () => 1 })]);
    const state = makeState();

    const entries = healthPhase(makeCtx(state, reg));

    expect(state.character.illnesses).toEqual([{ defId: 'flu', years: 0, treated: false }]);
    // One hit of 20, not both copies' 20.
    expect(state.character.stats.health).toBe(60);
    expect(entries).toEqual([{ icon: '🤒', kind: 'health', text: 'You came down with the flu.' }]);
    const mirror = { rngState: initialRngState(SEED) };
    const rng = createRng(mirror);
    rng.chance(0);
    rng.chance(1);
    expect(state.rngState).toBe(mirror.rngState);
  });
});

describe('healthPhase progression', () => {
  it('worsens an untreated illness every year and warns once when it turns serious', () => {
    // cureChance 0 isolates progression from the yearly recovery roll.
    const reg = registryWith([makeIllness({ cureChance: 0 })]);
    const state = makeState({
      stats: { health: 32, happiness: 60, smarts: 50, looks: 50 },
      illnesses: [{ defId: 'flu', years: 0, treated: false }],
    });

    const first = healthPhase(makeCtx(state, reg));
    expect(state.character.stats.health).toBe(22);
    expect(state.character.illnesses[0]?.years).toBe(1);
    expect(first).toEqual([
      { icon: '🤕', kind: 'bad', text: 'You are getting seriously ill with the flu.' },
    ]);

    const second = healthPhase(makeCtx(state, reg));
    expect(state.character.stats.health).toBe(12);
    expect(state.character.illnesses[0]?.years).toBe(2);
    expect(second).toEqual([]);
  });

  it('cures a treated illness on a successful roll', () => {
    const reg = registryWith([makeIllness({ cureChance: 1 })]);
    const state = makeState({ illnesses: [{ defId: 'flu', years: 1, treated: true }] });

    const entries = healthPhase(makeCtx(state, reg));

    expect(state.character.illnesses).toEqual([]);
    expect(state.character.stats.health).toBe(80);
    expect(entries).toEqual([{ icon: '💚', kind: 'good', text: 'You recovered from the flu.' }]);
  });

  /* Nothing in the engine ever sets `treated`: no Effect kind flips it and no
     phase writes it, so recovery that only fires for treated illnesses is
     recovery that never fires at all. A cold has to pass on its own. */
  it('cures an untreated illness on a successful roll, with no treatment anywhere', () => {
    const reg = registryWith([makeIllness({ cureChance: 1 })]);
    const state = makeState({ illnesses: [{ defId: 'flu', years: 1, treated: false }] });

    const entries = healthPhase(makeCtx(state, reg));

    expect(state.character.illnesses).toEqual([]);
    expect(entries).toEqual([{ icon: '💚', kind: 'good', text: 'You recovered from the flu.' }]);
    // The year it resolves costs no further health: only the onset hit was ever paid.
    expect(state.character.stats.health).toBe(80);
  });

  it('drops a resolving illness before it can warn about turning serious', () => {
    const reg = registryWith([makeIllness({ cureChance: 1 })]);
    const state = makeState({
      stats: { health: 32, happiness: 60, smarts: 50, looks: 50 },
      illnesses: [{ defId: 'flu', years: 4, treated: false }],
    });

    const entries = healthPhase(makeCtx(state, reg));

    expect(state.character.stats.health).toBe(32);
    expect(entries).toEqual([{ icon: '💚', kind: 'good', text: 'You recovered from the flu.' }]);
  });

  it('treats an untreated illness as curable at its own rate, and treatment as better odds', () => {
    // cureChance 0.5 doubles to a certainty when treated, so the split is exact.
    const reg = registryWith([makeIllness({ cureChance: 0.5 })]);
    const seeds = Array.from({ length: 40 }, (_, i) => i + 1);
    const curesWhen = (treated: boolean): number => {
      let cured = 0;
      for (const seed of seeds) {
        const state = makeState({ illnesses: [{ defId: 'flu', years: 1, treated }] }, seed);
        healthPhase(makeCtx(state, reg));
        if (state.character.illnesses.length === 0) cured += 1;
      }
      return cured;
    };

    expect(curesWhen(true)).toBe(seeds.length);
    const untreated = curesWhen(false);
    expect(untreated).toBeGreaterThan(0);
    expect(untreated).toBeLessThan(seeds.length);
  });

  it('reads correctly in every sentence built from one article-bearing label', () => {
    // One label, three sentences: none of them may frame it as a possessive.
    const onsetState = makeState();
    const worseningState = makeState({
      stats: { health: 32, happiness: 60, smarts: 50, looks: 50 },
      illnesses: [{ defId: 'flu', years: 0, treated: false }],
    });
    const cureState = makeState({ illnesses: [{ defId: 'flu', years: 1, treated: true }] });

    const label = 'a bad back';
    const texts = [
      healthPhase(makeCtx(onsetState, registryWith([makeIllness({ label, onsetWeight: () => 1 })]))),
      healthPhase(makeCtx(worseningState, registryWith([makeIllness({ label, cureChance: 0 })]))),
      healthPhase(makeCtx(cureState, registryWith([makeIllness({ label, cureChance: 1 })]))),
    ].map((entries) => entries[0]?.text);

    expect(texts).toEqual([
      'You came down with a bad back.',
      'You are getting seriously ill with a bad back.',
      'You recovered from a bad back.',
    ]);
  });

  it('keeps a treated illness that fails its cure roll, without damage', () => {
    const reg = registryWith([makeIllness({ cureChance: 0 })]);
    const state = makeState({ illnesses: [{ defId: 'flu', years: 1, treated: true }] });

    const entries = healthPhase(makeCtx(state, reg));

    expect(state.character.illnesses).toEqual([{ defId: 'flu', years: 2, treated: true }]);
    expect(state.character.stats.health).toBe(80);
    expect(entries).toEqual([]);
  });

  it('holds a treated chronic illness steady instead of curing it', () => {
    const reg = registryWith([makeIllness({ chronic: true, cureChance: 1 })]);
    const state = makeState({ illnesses: [{ defId: 'flu', years: 3, treated: true }] });

    const entries = healthPhase(makeCtx(state, reg));

    expect(state.character.illnesses).toEqual([{ defId: 'flu', years: 4, treated: true }]);
    expect(state.character.stats.health).toBe(80);
    expect(entries).toEqual([]);
  });

  it('still damages an untreated chronic illness', () => {
    const reg = registryWith([makeIllness({ chronic: true, healthHit: 10 })]);
    const state = makeState({ illnesses: [{ defId: 'flu', years: 1, treated: false }] });

    healthPhase(makeCtx(state, reg));

    expect(state.character.stats.health).toBe(75);
  });

  /* The contract on `IllnessDef.chronic`: chronic conditions persist once
     contracted instead of resolving on their own, whatever `cureChance` says. */
  it('never resolves an untreated chronic illness, however curable it claims to be', () => {
    const reg = registryWith([makeIllness({ chronic: true, cureChance: 1, healthHit: 10 })]);
    const state = makeState({ illnesses: [{ defId: 'flu', years: 1, treated: false }] });

    const entries = healthPhase(makeCtx(state, reg));

    expect(state.character.illnesses).toEqual([{ defId: 'flu', years: 2, treated: false }]);
    expect(state.character.stats.health).toBe(75);
    expect(entries).toEqual([]);
  });

  /* A row whose def is gone is inert everywhere else — it never ages, never
     rolls recovery, is invisible to the death check and cannot be cured, since
     the curing effect would have to ship in the very pack that is missing — so
     skipping it parks it on the Health sheet for good with no label to render.
     It is dropped instead, like `educationPhase` emptying a vanished desk. */
  it('drops an illness whose definition is gone from the registry', () => {
    const state = makeState({ illnesses: [{ defId: 'ghost', years: 1, treated: false }] });

    const entries = healthPhase(makeCtx(state, emptyRegistry()));

    expect(state.character.illnesses).toEqual([]);
    // Silently: content drift is not a life event worth a log line.
    expect(entries).toEqual([]);
    expect(state.character.stats.health).toBe(80);
    // No definition, no roll: an unknown illness cannot shift the draw budget.
    expect(state.rngState).toBe(initialRngState(SEED));
  });

  it('stays dropped, instead of riding along for the rest of the life', () => {
    const reg = emptyRegistry();
    const state = makeState({ illnesses: [{ defId: 'ghost', years: 0, treated: false }] });

    for (let year = 0; year < 20; year += 1) healthPhase(makeCtx(state, reg));

    expect(state.character.illnesses).toEqual([]);
  });

  it('drops every def-less row while leaving the rest of the sheet alone', () => {
    const reg = registryWith([makeIllness({ onsetWeight: () => 0, cureChance: 0 })]);
    const state = makeState({
      illnesses: [
        { defId: 'ghost', years: 3, treated: true },
        { defId: 'flu', years: 1, treated: false },
        { defId: 'wraith', years: 7, treated: false },
      ],
    });

    healthPhase(makeCtx(state, reg));

    // The one real illness ages and takes its progression hit; both phantoms go.
    expect(state.character.illnesses).toEqual([{ defId: 'flu', years: 2, treated: false }]);
    expect(state.character.stats.health).toBe(70);
  });

  it('drops a phantom without shifting a single draw', () => {
    const reg = registryWith([
      makeIllness({ id: 'flu', label: 'the flu', onsetWeight: () => 0, cureChance: 0 }),
      makeIllness({ id: 'gout', label: 'gout', onsetWeight: () => 0.5, cureChance: 0 }),
    ]);
    const withPhantom = makeState({
      illnesses: [
        { defId: 'flu', years: 1, treated: false },
        { defId: 'ghost', years: 2, treated: false },
      ],
    });
    const without = makeState({ illnesses: [{ defId: 'flu', years: 1, treated: false }] });

    healthPhase(makeCtx(withPhantom, reg));
    healthPhase(makeCtx(without, reg));

    // One onset roll for the un-held gout, one recovery roll for the flu, both times.
    expect(withPhantom.rngState).toBe(without.rngState);
    expect(withPhantom.character.illnesses).toEqual(without.character.illnesses);
    expect(withPhantom.character.stats.health).toBe(without.character.stats.health);
  });
});

describe('healthPhase recovery draw budget', () => {
  /** Cursor after one year, minus the cursor a mirror reaches with `draws` rolls. */
  function drawsSpent(state: GameState): number {
    const mirror = { rngState: initialRngState(SEED) };
    const rng = createRng(mirror);
    for (let spent = 0; spent <= 4; spent += 1) {
      if (mirror.rngState === state.rngState) return spent;
      rng.chance(0.5);
    }
    return -1;
  }

  it('spends one recovery roll a year on a non-chronic illness, treated or not', () => {
    const reg = registryWith([makeIllness({ cureChance: 0 })]);
    for (const treated of [false, true]) {
      const state = makeState({ illnesses: [{ defId: 'flu', years: 1, treated }] });
      healthPhase(makeCtx(state, reg));
      expect(drawsSpent(state)).toBe(1);
    }
  });

  it('spends nothing on a chronic illness, which can never resolve', () => {
    const reg = registryWith([makeIllness({ chronic: true, cureChance: 1 })]);
    for (const treated of [false, true]) {
      const state = makeState({ illnesses: [{ defId: 'flu', years: 1, treated }] });
      healthPhase(makeCtx(state, reg));
      expect(drawsSpent(state)).toBe(0);
    }
  });

  it('rolls onset for what is not held and recovery for what is, in that order', () => {
    const reg = registryWith([
      makeIllness({ id: 'flu', label: 'the flu', cureChance: 0 }),
      makeIllness({ id: 'gout', label: 'gout', onsetWeight: () => 0, cureChance: 0 }),
      makeIllness({ id: 'asthma', label: 'asthma', chronic: true, onsetWeight: () => 0 }),
    ]);
    const state = makeState({ illnesses: [{ defId: 'flu', years: 1, treated: false }] });

    healthPhase(makeCtx(state, reg));

    // Two unheld defs roll onset; the one held non-chronic illness rolls recovery.
    expect(drawsSpent(state)).toBe(3);
  });
});

describe('healthPhase addictions', () => {
  it('grows severity, drains health, mood and money, and warns at 50', () => {
    const reg = emptyRegistry();
    const state = makeState({
      stats: { health: 60, happiness: 50, smarts: 50, looks: 50 },
      money: 5000,
      addictions: { gambling: 48 },
    });

    const entries = healthPhase(makeCtx(state, reg));

    const c = state.character;
    expect(c.addictions.gambling).toBe(51);
    expect(c.stats.health).toBe(clampStat(60 - 51 / 20));
    expect(c.stats.happiness).toBe(clampStat(50 - 51 / 25));
    expect(c.money).toBe(5000 - 51 * 20);
    expect(entries).toEqual([
      { icon: '🎰', kind: 'bad', text: 'Your gambling addiction is taking over your life.' },
    ]);

    // The warning is a threshold crossing, not a yearly nag.
    const second = healthPhase(makeCtx(state, reg));
    expect(c.addictions.gambling).toBe(54);
    expect(second).toEqual([]);
  });

  /* Severity also moves through `{kind:'addiction'}` effects, and every one of
     them — an event, a choice, an interaction — lands later in the year than
     this phase. A warning that only compared this year's severity with last
     year's would miss those crossings for good: by the next health phase the
     addiction is already past the alarm, so the one line the game has for it
     would never print. */
  it('warns about a crossing that happened outside the phase', () => {
    const reg = emptyRegistry();
    // Grew to 48 here last year without a word, then a night at the casino.
    const state = makeState({ addictions: { gambling: 53 } });

    const entries = healthPhase(makeCtx(state, reg));

    expect(state.character.addictions.gambling).toBe(56);
    expect(entries).toEqual([
      { icon: '🎰', kind: 'bad', text: 'Your gambling addiction is taking over your life.' },
    ]);
    // Once, not every year after — and without spending a draw on any of it.
    expect(healthPhase(makeCtx(state, reg))).toEqual([]);
    expect(state.rngState).toBe(initialRngState(SEED));
  });

  it('warns again about a habit beaten back under the alarm and picked up anew', () => {
    const alarm: LogEntry = {
      icon: '🚬',
      kind: 'bad',
      text: 'Your smoking addiction is taking over your life.',
    };
    const reg = emptyRegistry();
    const state = makeState({ addictions: { smoking: 48 } });
    const c = state.character;

    expect(healthPhase(makeCtx(state, reg))).toEqual([alarm]);

    // Cutting down is enough to re-arm it: the line is about crossing the alarm.
    c.addictions.smoking = 20;
    expect(healthPhase(makeCtx(state, reg))).toEqual([]);
    c.addictions.smoking = 48;
    expect(healthPhase(makeCtx(state, reg))).toEqual([alarm]);

    /* And so is quitting, which `applyEffects` records by dropping the key —
       even when the relapse arrives from effects alone and is already over the
       alarm before this phase ever sees it again. */
    delete c.addictions.smoking;
    expect(healthPhase(makeCtx(state, reg))).toEqual([]);
    c.addictions.smoking = 55;
    expect(healthPhase(makeCtx(state, reg))).toEqual([alarm]);
  });

  /* One latch per addiction rather than one for the character: a habit already
     announced must not swallow the first line another habit earns, and beating
     one back must not re-arm the other. */
  it('latches each addiction on its own', () => {
    const alcohol: LogEntry = {
      icon: '🍺',
      kind: 'bad',
      text: 'Your alcohol addiction is taking over your life.',
    };
    const reg = emptyRegistry();
    // Alcohol crossed the alarm outside the phase; gambling crosses inside it.
    const state = makeState({ addictions: { alcohol: 60, gambling: 48 } });
    const c = state.character;

    expect(healthPhase(makeCtx(state, reg))).toEqual([
      alcohol,
      { icon: '🎰', kind: 'bad', text: 'Your gambling addiction is taking over your life.' },
    ]);
    expect(healthPhase(makeCtx(state, reg))).toEqual([]);

    c.addictions.alcohol = 20;
    expect(healthPhase(makeCtx(state, reg))).toEqual([]);
    // Only the drinking is announced afresh; the gambling stayed over the alarm.
    c.addictions.alcohol = 60;
    expect(healthPhase(makeCtx(state, reg))).toEqual([alcohol]);
  });

  it('stays quiet while an addiction is still mild', () => {
    const state = makeState({ addictions: { smoking: 10 } });

    const entries = healthPhase(makeCtx(state, emptyRegistry()));

    expect(state.character.addictions.smoking).toBe(13);
    expect(entries).toEqual([]);
  });

  it('never drains money below zero', () => {
    const state = makeState({ money: 100, addictions: { drugs: 60 } });

    healthPhase(makeCtx(state, emptyRegistry()));

    expect(state.character.money).toBe(0);
  });

  it('settles a balance that is already unreadable', () => {
    /* The toll is always readable — severity is a `clampStat` output — so the
       only poison this write can meet is the balance itself, and written as
       `Math.max(0, Math.round(money - toll))` it handed that poison back
       untouched, year after year. See `clampMoney`'s own comment. */
    for (const poison of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const state = makeState({ money: poison, addictions: { drugs: 60 } });

      healthPhase(makeCtx(state, emptyRegistry()));

      expect(state.character.money).toBe(0);
      // The rest of the toll still landed; only the balance was refused.
      expect(state.character.addictions.drugs).toBe(63);
    }
  });

  it('leaves a cleared addiction alone and caps severity at 100', () => {
    const state = makeState({ addictions: { alcohol: 99, drugs: 0 } });

    healthPhase(makeCtx(state, emptyRegistry()));

    expect(state.character.addictions.alcohol).toBe(100);
    expect(state.character.addictions.drugs).toBe(0);
  });
});

describe('healthPhase determinism', () => {
  it('produces the same year twice from the same seed', () => {
    const defs = [
      makeIllness({ id: 'flu', label: 'the flu', onsetWeight: () => 0.5 }),
      makeIllness({ id: 'asthma', label: 'asthma', chronic: true, onsetWeight: () => 0.5 }),
      makeIllness({ id: 'gout', label: 'gout', onsetWeight: () => 0.5, healthHit: 8 }),
    ];
    const run = (): { entries: unknown; character: unknown; cursor: number } => {
      const state = makeState({
        addictions: { alcohol: 20 },
        // Carried conditions add the recovery rolls to the sequence under test.
        illnesses: [
          { defId: 'gout', years: 2, treated: false },
          { defId: 'asthma', years: 5, treated: true },
        ],
      });
      const entries = healthPhase(makeCtx(state, registryWith(defs)));
      return { entries, character: state.character, cursor: state.rngState };
    };

    const a = run();
    const b = run();

    expect(a).toEqual(b);
    // A real roll happened; the seeds are not agreeing on an empty year.
    expect(a.cursor).not.toBe(initialRngState(SEED));
  });
});
