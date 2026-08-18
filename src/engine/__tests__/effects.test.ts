import { describe, expect, it } from 'vitest';

import type {
  Character,
  ContentRegistry,
  Effect,
  EffectCtx,
  GameState,
  Person,
  RelKind,
} from '@/types';
import { applyEffects, clampStat } from '@/engine/effects';
import { createRng, initialRngState } from '@/engine/rng';

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

function makeCharacter(over: Partial<Character> = {}): Character {
  return {
    id: 'c1',
    firstName: 'Ada',
    lastName: 'Moreno',
    gender: 'female',
    pronouns: { sub: 'she', obj: 'her', pos: 'her' },
    countryId: 'us',
    age: 30,
    stats: { health: 50, happiness: 50, smarts: 50, looks: 50 },
    money: 1000,
    education: { level: 'high', year: 0, gpa: 3, studyHard: false },
    job: { jobId: 'j1', title: 'Barista', salary: 24000, years: 2, performance: 60, workHard: false },
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

function makePerson(id: string, kind: RelKind, over: Partial<Person> = {}): Person {
  return {
    id,
    kind,
    name: `Person ${id}`,
    gender: 'female',
    age: 40,
    alive: true,
    rel: 50,
    flags: {},
    ...over,
  };
}

function makeState(character: Character, people: Person[] = []): GameState {
  const byId: Record<string, Person> = {};
  for (const p of people) byId[p.id] = p;
  return {
    rngState: initialRngState(42),
    seed: 42,
    generation: 1,
    year: 2026,
    character,
    people: byId,
    log: [],
    pending: [],
    firedEvents: [],
    interactionUse: {},
    ancestors: [],
    phase: 'alive',
  };
}

function makeCtx(state: GameState, target?: Person): EffectCtx {
  return { state, rng: createRng(state), reg: emptyRegistry(), target };
}

describe('clampStat', () => {
  it('clamps into 0..100', () => {
    expect(clampStat(-5)).toBe(0);
    expect(clampStat(0)).toBe(0);
    expect(clampStat(105)).toBe(100);
    expect(clampStat(100)).toBe(100);
    expect(clampStat(42)).toBe(42);
  });

  it('rounds to one decimal place', () => {
    expect(clampStat(33.333)).toBe(33.3);
    expect(clampStat(55.55)).toBe(55.6);
    expect(clampStat(0.04)).toBe(0);
    expect(clampStat(99.96)).toBe(100);
  });

  it('treats a non-finite value as 0', () => {
    expect(clampStat(Number.NaN)).toBe(0);
    expect(clampStat(Number.POSITIVE_INFINITY)).toBe(100);
    expect(clampStat(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

describe('applyEffects: stat', () => {
  it('adds the delta and clamps at both ends', () => {
    const state = makeState(makeCharacter({ stats: { health: 95, happiness: 4, smarts: 50, looks: 50 } }));
    applyEffects(makeCtx(state), [
      { kind: 'stat', stat: 'health', delta: 20 },
      { kind: 'stat', stat: 'happiness', delta: -20 },
      { kind: 'stat', stat: 'smarts', delta: 2.25 },
    ]);
    expect(state.character.stats.health).toBe(100);
    expect(state.character.stats.happiness).toBe(0);
    expect(state.character.stats.smarts).toBe(52.3);
    expect(state.character.stats.looks).toBe(50);
  });
});

describe('applyEffects: money', () => {
  it('adds, rounds and never drops below zero', () => {
    const state = makeState(makeCharacter({ money: 1000 }));
    const ctx = makeCtx(state);

    applyEffects(ctx, [{ kind: 'money', delta: 250.4 }]);
    expect(state.character.money).toBe(1250);

    applyEffects(ctx, [{ kind: 'money', delta: -99999 }]);
    expect(state.character.money).toBe(0);
    expect(Number.isInteger(state.character.money)).toBe(true);

    applyEffects(ctx, [{ kind: 'money', delta: 10.5 }]);
    expect(state.character.money).toBe(11);
  });
});

describe('applyEffects: rel', () => {
  it('targets ctx.target and writes through to the stored person', () => {
    const friend = makePerson('1', 'friend', { rel: 40 });
    const state = makeState(makeCharacter(), [friend]);
    // A stale copy must still route the mutation to the canonical object.
    const stale: Person = { ...friend, rel: 0 };
    applyEffects(makeCtx(state, stale), [{ kind: 'rel', who: 'target', delta: 15 }]);
    expect(state.people['1']?.rel).toBe(55);
  });

  it('prefers a living spouse over a partner for the partner sentinel', () => {
    const state = makeState(makeCharacter(), [
      makePerson('1', 'partner', { rel: 30 }),
      makePerson('2', 'spouse', { rel: 60 }),
    ]);
    applyEffects(makeCtx(state), [{ kind: 'rel', who: 'partner', delta: 10 }]);
    expect(state.people['2']?.rel).toBe(70);
    expect(state.people['1']?.rel).toBe(30);
  });

  it('falls back to a living partner when the spouse is dead', () => {
    const state = makeState(makeCharacter(), [
      makePerson('1', 'spouse', { rel: 60, alive: false }),
      makePerson('2', 'partner', { rel: 30 }),
    ]);
    applyEffects(makeCtx(state), [{ kind: 'rel', who: 'partner', delta: 10 }]);
    expect(state.people['2']?.rel).toBe(40);
    expect(state.people['1']?.rel).toBe(60);
  });

  it('only ever hits living family for random-family', () => {
    const state = makeState(makeCharacter(), [
      makePerson('1', 'mother', { rel: 50 }),
      makePerson('2', 'father', { rel: 50 }),
      makePerson('3', 'sibling', { rel: 50 }),
      makePerson('4', 'child', { rel: 50 }),
      makePerson('5', 'friend', { rel: 50 }),
      makePerson('6', 'pet', { rel: 50 }),
      makePerson('7', 'sibling', { rel: 50, alive: false }),
    ]);
    const ctx = makeCtx(state);
    const touched = new Set<string>();
    for (let i = 0; i < 200; i++) {
      applyEffects(ctx, [{ kind: 'rel', who: 'random-family', delta: 1 }]);
      applyEffects(ctx, [{ kind: 'rel', who: 'random-family', delta: -1 }]);
    }
    // One draw per pick, so the two calls rarely cancel on the same person.
    for (const p of Object.values(state.people)) {
      if (p.rel !== 50) touched.add(p.id);
    }
    expect(state.people['5']?.rel).toBe(50);
    expect(state.people['6']?.rel).toBe(50);
    expect(state.people['7']?.rel).toBe(50);
    expect(touched.size).toBeGreaterThan(0);
    for (const id of touched) expect(['1', '2', '3', '4']).toContain(id);
  });

  it('is a silent no-op when the sentinel matches nobody, without spending a draw', () => {
    const state = makeState(makeCharacter());
    const ctx = makeCtx(state);
    const cursor = state.rngState;
    const entries = applyEffects(ctx, [
      { kind: 'rel', who: 'random-family', delta: 5 },
      { kind: 'rel', who: 'partner', delta: 5 },
      { kind: 'rel', who: 'target', delta: 5 },
      { kind: 'rel', who: 'no-such-person', delta: 5 },
    ]);
    expect(entries).toEqual([]);
    expect(state.rngState).toBe(cursor);
  });

  it('addresses an explicit person id and clamps 0..100', () => {
    const state = makeState(makeCharacter(), [
      makePerson('9', 'friend', { rel: 95 }),
      makePerson('10', 'enemy', { rel: 5 }),
    ]);
    applyEffects(makeCtx(state), [
      { kind: 'rel', who: '9', delta: 20 },
      { kind: 'rel', who: '10', delta: -20 },
    ]);
    expect(state.people['9']?.rel).toBe(100);
    expect(state.people['10']?.rel).toBe(0);
  });
});

describe('applyEffects: flag, fame, addiction, illness', () => {
  it('sets flags of every allowed type', () => {
    const state = makeState(makeCharacter());
    applyEffects(makeCtx(state), [
      { kind: 'flag', flag: 'gymRegular', value: true },
      { kind: 'flag', flag: 'jobsHeld', value: 3 },
      { kind: 'flag', flag: 'countryLabel', value: 'Japan' },
    ]);
    expect(state.character.flags.gymRegular).toBe(true);
    expect(state.character.flags.jobsHeld).toBe(3);
    expect(state.character.flags.countryLabel).toBe('Japan');
  });

  it('clamps fame into 0..100', () => {
    const state = makeState(makeCharacter({ fame: 90 }));
    const ctx = makeCtx(state);
    applyEffects(ctx, [{ kind: 'fame', delta: 25 }]);
    expect(state.character.fame).toBe(100);
    applyEffects(ctx, [{ kind: 'fame', delta: -200 }]);
    expect(state.character.fame).toBe(0);
  });

  it('accumulates addiction severity and removes the key at zero', () => {
    const state = makeState(makeCharacter());
    const ctx = makeCtx(state);

    applyEffects(ctx, [{ kind: 'addiction', which: 'alcohol', delta: 30 }]);
    expect(state.character.addictions.alcohol).toBe(30);

    applyEffects(ctx, [{ kind: 'addiction', which: 'alcohol', delta: 90 }]);
    expect(state.character.addictions.alcohol).toBe(100);

    applyEffects(ctx, [{ kind: 'addiction', which: 'alcohol', delta: -100 }]);
    expect(state.character.addictions.alcohol).toBeUndefined();
    expect('alcohol' in state.character.addictions).toBe(false);

    applyEffects(ctx, [{ kind: 'addiction', which: 'smoking', delta: -5 }]);
    expect('smoking' in state.character.addictions).toBe(false);
  });

  it('adds an illness once and cures by def id', () => {
    const state = makeState(makeCharacter());
    const ctx = makeCtx(state);

    applyEffects(ctx, [{ kind: 'illness', add: 'flu' }]);
    applyEffects(ctx, [{ kind: 'illness', add: 'flu' }]);
    expect(state.character.illnesses).toEqual([{ defId: 'flu', years: 0, treated: false }]);

    applyEffects(ctx, [{ kind: 'illness', add: 'asthma' }]);
    expect(state.character.illnesses).toHaveLength(2);

    applyEffects(ctx, [{ kind: 'illness', cure: 'flu' }]);
    expect(state.character.illnesses.map((i) => i.defId)).toEqual(['asthma']);

    applyEffects(ctx, [{ kind: 'illness', cure: 'nothing-here' }]);
    expect(state.character.illnesses).toHaveLength(1);
  });
});

describe('applyEffects: jail', () => {
  it('imprisons, clears the job and logs the sentence', () => {
    const state = makeState(makeCharacter());
    const entries = applyEffects(makeCtx(state), [
      { kind: 'jail', years: 3, crime: 'Burglary' },
    ]);
    expect(state.character.prison).toEqual({ crime: 'Burglary', yearsLeft: 3, totalYears: 3 });
    expect(state.character.job).toBeNull();
    expect(entries).toEqual([
      { icon: '⚖️', text: 'You were sentenced to 3 years in prison.', kind: 'legal' },
    ]);
  });

  it('says "1 year" for a one-year sentence', () => {
    const state = makeState(makeCharacter());
    const entries = applyEffects(makeCtx(state), [{ kind: 'jail', years: 1, crime: 'Theft' }]);
    expect(entries[0]?.text).toBe('You were sentenced to 1 year in prison.');
  });
});

describe('applyEffects: log', () => {
  it('defaults to the info kind, honours logKind and fills templates', () => {
    const state = makeState(makeCharacter(), [makePerson('1', 'spouse', { name: 'Yuki' })]);
    const entries = applyEffects(makeCtx(state), [
      { kind: 'log', icon: '🎉', text: 'You threw a party.' },
      { kind: 'log', icon: '💔', text: '{partner} left you.', logKind: 'bad' },
    ]);
    expect(entries).toEqual([
      { icon: '🎉', text: 'You threw a party.', kind: 'info' },
      { icon: '💔', text: 'Yuki left you.', kind: 'bad' },
    ]);
  });

  it('returns entries rather than writing them into state.log', () => {
    const state = makeState(makeCharacter());
    const entries = applyEffects(makeCtx(state), [
      { kind: 'log', icon: '📈', text: 'You got a raise.', logKind: 'money' },
    ]);
    expect(entries).toHaveLength(1);
    expect(state.log).toEqual([]);
  });
});

describe('applyEffects: fn', () => {
  it('runs the escape hatch with the live context', () => {
    const target = makePerson('1', 'friend');
    const state = makeState(makeCharacter(), [target]);
    let sawTarget: string | undefined;
    applyEffects(makeCtx(state, target), [
      {
        kind: 'fn',
        run: (ctx) => {
          sawTarget = ctx.target?.id;
          ctx.state.character.money = 777;
        },
      },
    ]);
    expect(sawTarget).toBe('1');
    expect(state.character.money).toBe(777);
  });
});

describe('applyEffects: death', () => {
  it('marks the death, stores the cause and stops the remaining effects', () => {
    const state = makeState(makeCharacter({ money: 100 }));
    const entries = applyEffects(makeCtx(state), [
      { kind: 'log', icon: '🚗', text: 'The brakes failed.', logKind: 'bad' },
      { kind: 'death', cause: 'a car crash' },
      { kind: 'money', delta: 5000 },
      { kind: 'stat', stat: 'health', delta: 50 },
      { kind: 'log', icon: '🙈', text: 'Never happens.' },
    ]);

    expect(state.phase).toBe('dead');
    expect(state.character.flags.pendingDeathCause).toBe('a car crash');
    expect(state.death).toBeUndefined();
    expect(state.character.money).toBe(100);
    expect(state.character.stats.health).toBe(50);
    expect(entries).toEqual([{ icon: '🚗', text: 'The brakes failed.', kind: 'bad' }]);
  });
});

describe('applyEffects: ordering', () => {
  it('returns every generated entry in effect order', () => {
    const state = makeState(makeCharacter());
    const effects: Effect[] = [
      { kind: 'log', icon: '1', text: 'first' },
      { kind: 'jail', years: 2, crime: 'Fraud' },
      { kind: 'log', icon: '3', text: 'third' },
    ];
    const entries = applyEffects(makeCtx(state), effects);
    expect(entries.map((e) => e.icon)).toEqual(['1', '⚖️', '3']);
  });
});
