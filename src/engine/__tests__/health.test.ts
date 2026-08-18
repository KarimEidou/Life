import { describe, expect, it } from 'vitest';

import { clampStat } from '@/engine/effects';
import { healthPhase } from '@/engine/phases/health';
import { createRng, initialRngState } from '@/engine/rng';
import type { Character, ContentRegistry, Ctx, GameState, IllnessDef } from '@/types';

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

function makeIllness(over: Partial<IllnessDef> = {}): IllnessDef {
  return {
    id: 'flu',
    label: 'influenza',
    chronic: false,
    lethality: 0,
    onsetWeight: () => 0,
    healthHit: 20,
    treatCost: 100,
    cureChance: 0.5,
    ...over,
  };
}

function registryWith(illnesses: IllnessDef[]): ContentRegistry {
  const reg = emptyRegistry();
  reg.illnesses = illnesses;
  for (const def of illnesses) reg.illnessesById[def.id] = def;
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
    expect(entries).toEqual([
      { icon: '🤒', kind: 'health', text: 'You came down with influenza.' },
    ]);
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
    const reg = registryWith([makeIllness({ onsetWeight: () => 1 })]);
    const state = makeState({ illnesses: [{ defId: 'flu', years: 2, treated: true }] });

    healthPhase(makeCtx(state, reg));

    expect(state.character.illnesses).toHaveLength(1);
  });

  it('does not also progress an illness in the year it appears', () => {
    const reg = registryWith([makeIllness({ onsetWeight: () => 1, healthHit: 20 })]);
    const state = makeState();

    healthPhase(makeCtx(state, reg));

    // The onset hit only: 80 - 20, never a further 20 / 2 of progression.
    expect(state.character.stats.health).toBe(60);
    expect(state.character.illnesses[0]?.years).toBe(0);
  });
});

describe('healthPhase progression', () => {
  it('worsens an untreated illness every year and warns once when it turns serious', () => {
    const reg = registryWith([makeIllness()]);
    const state = makeState({
      stats: { health: 32, happiness: 60, smarts: 50, looks: 50 },
      illnesses: [{ defId: 'flu', years: 0, treated: false }],
    });

    const first = healthPhase(makeCtx(state, reg));
    expect(state.character.stats.health).toBe(22);
    expect(state.character.illnesses[0]?.years).toBe(1);
    expect(first).toEqual([
      { icon: '🤕', kind: 'bad', text: 'Your influenza is getting serious.' },
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
    expect(entries).toEqual([{ icon: '💚', kind: 'good', text: 'You recovered from influenza.' }]);
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

  it('ignores an illness whose definition is gone from the registry', () => {
    const state = makeState({ illnesses: [{ defId: 'ghost', years: 1, treated: false }] });

    const entries = healthPhase(makeCtx(state, emptyRegistry()));

    expect(entries).toEqual([]);
    expect(state.character.stats.health).toBe(80);
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
      makeIllness({ id: 'flu', label: 'influenza', onsetWeight: () => 0.5 }),
      makeIllness({ id: 'asthma', label: 'asthma', chronic: true, onsetWeight: () => 0.5 }),
      makeIllness({ id: 'gout', label: 'gout', onsetWeight: () => 0.5, healthHit: 8 }),
    ];
    const run = (): { entries: unknown; character: unknown; cursor: number } => {
      const state = makeState({ addictions: { alcohol: 20 } });
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
