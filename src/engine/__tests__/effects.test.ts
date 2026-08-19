import { describe, expect, it } from 'vitest';

import type {
  Character,
  ContentPack,
  ContentRegistry,
  Effect,
  EffectCtx,
  EventDef,
  GameState,
  JobDef,
  Person,
  RelKind,
  SchoolDef,
} from '@/types';
import { applyEffects, clampMoney, clampStat, personById } from '@/engine/effects';
import { buildRegistry, validateRegistry } from '@/engine/registry';
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

describe('clampMoney', () => {
  it('rounds to whole dollars and never goes below zero', () => {
    expect(clampMoney(250.4)).toBe(250);
    expect(clampMoney(10.5)).toBe(11);
    expect(clampMoney(-99999)).toBe(0);
    expect(clampMoney(0)).toBe(0);
  });

  it('holds the balance rather than storing a number it cannot read', () => {
    /* `Math.max(0, NaN)` is NaN, and that was the shape of every money write in
       the engine: one bad content number and the balance was NaN with no way
       back, because every later write is `NaN + delta`. */
    expect(clampMoney(Number.NaN, 1000)).toBe(1000);
    expect(clampMoney(Number.POSITIVE_INFINITY, 1000)).toBe(1000);
    expect(clampMoney(Number.NEGATIVE_INFINITY, 1000)).toBe(1000);
  });

  it('heals a balance that is already unreadable', () => {
    // The recovery path `clampStat` has always had: nothing stays poisoned.
    expect(clampMoney(Number.NaN, Number.NaN)).toBe(0);
    expect(clampMoney(Number.NaN)).toBe(0);
    expect(clampMoney(500, Number.NaN)).toBe(500);
  });
});

describe('personById', () => {
  /* The one supported way to read `state.people` by an id that came from
     content, a UI row or a loaded save — everything else in the engine goes
     through it, so the prototype guard lives in exactly one place. */
  it('answers only with own properties of the table', () => {
    const friend = makePerson('1', 'friend');
    const people: Record<string, Person> = { '1': friend };

    expect(personById(people, '1')).toBe(friend);
    expect(personById(people, 'p99')).toBeUndefined();
    for (const magic of ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
      expect(personById(people, magic)).toBeUndefined();
    }
  });

  it('still finds a person whose own id shadows an inherited member', () => {
    const odd = makePerson('toString', 'friend');
    const people: Record<string, Person> = { toString: odd };

    expect(personById(people, 'toString')).toBe(odd);
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

  it('ignores a delta that is not a number instead of destroying the balance', () => {
    /* The sibling of the NaN guard `clampStat` has always had — and the one the
       money path never did. `Math.max(0, NaN)` is NaN, so one such delta in a
       pack poisoned the balance for the rest of the life: every later write was
       `NaN + delta`, and it spread to `Loan.principal`, `netWorth`, the finance
       sheet and the epitaph. */
    const state = makeState(makeCharacter({ money: 1000 }));
    const ctx = makeCtx(state);

    for (const delta of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      applyEffects(ctx, [{ kind: 'money', delta }]);
      expect(state.character.money).toBe(1000);
    }

    // And the balance still works afterwards: this is a skip, not a wound.
    applyEffects(ctx, [{ kind: 'money', delta: 500 }]);
    expect(state.character.money).toBe(1500);
    expect(Number.isFinite(state.character.money)).toBe(true);
  });

  it('heals a balance that arrived unreadable, exactly as a stat does', () => {
    const state = makeState(makeCharacter({ money: Number.NaN }));
    const ctx = makeCtx(state);

    applyEffects(ctx, [
      { kind: 'money', delta: 250 },
      { kind: 'stat', stat: 'health', delta: Number.NaN },
    ]);

    expect(state.character.money).toBe(0);
    expect(state.character.stats.health).toBe(0);
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

  /* `who` widens to `string`, so an authoring typo naming an inherited member is
     an ordinary content bug — and `state.people` always carries Object.prototype,
     because that is what JSON.parse hands back on every load. */
  it('treats an inherited member of state.people as nobody, without polluting it', () => {
    const bystander: Record<string, unknown> = {};
    const state = makeState(makeCharacter(), [makePerson('1', 'friend', { rel: 40 })]);
    const ctx = makeCtx(state);
    const cursor = state.rngState;

    try {
      const entries = applyEffects(ctx, [
        { kind: 'rel', who: '__proto__', delta: 10 },
        { kind: 'rel', who: 'toString', delta: 10 },
        { kind: 'rel', who: 'constructor', delta: 10 },
        { kind: 'rel', who: 'hasOwnProperty', delta: 10 },
        { kind: 'rel', who: 'valueOf', delta: 10 },
      ]);

      expect(entries).toEqual([]);
      // Skipped like any other unmatched `who`: no draw, no side effect anywhere.
      expect(state.rngState).toBe(cursor);
      expect(state.people['1']?.rel).toBe(40);
      expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'rel')).toBe(false);
      expect(bystander.rel).toBeUndefined();
      expect(({} as Record<string, unknown>).rel).toBeUndefined();
      expect((Object.prototype.toString as unknown as Record<string, unknown>).rel).toBeUndefined();
    } finally {
      // Never leak a polluted prototype into the rest of the suite.
      delete (Object.prototype as unknown as Record<string, unknown>).rel;
    }
  });

  it('still writes through to a person whose own id is an inherited key', () => {
    // Own properties win: only the *absence* of a person is what must not be
    // filled in by the prototype chain.
    const odd = makePerson('toString', 'friend', { rel: 40 });
    const state = makeState(makeCharacter(), [odd]);
    // Indexed through a variable: `state.people.toString` is the built-in.
    const stored = (id: string): Person | undefined => state.people[id];

    applyEffects(makeCtx(state, { ...odd, rel: 0 }), [
      { kind: 'rel', who: 'target', delta: 15 },
    ]);
    expect(stored('toString')?.rel).toBe(55);

    applyEffects(makeCtx(state), [{ kind: 'rel', who: 'toString', delta: 5 }]);
    expect(stored('toString')?.rel).toBe(60);
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
    // The obituary reads this flag; losing the job to a sentence must still set it.
    expect(state.character.flags.lastJobTitle).toBe('Barista');
    expect(entries).toEqual([
      { icon: '⚖️', text: 'You were sentenced to 3 years in prison.', kind: 'legal' },
    ]);
  });

  it('leaves an earlier lastJobTitle alone when there is no job to lose', () => {
    const state = makeState(makeCharacter({ job: null, flags: { lastJobTitle: 'Welder' } }));
    applyEffects(makeCtx(state), [{ kind: 'jail', years: 2, crime: 'Fraud' }]);
    expect(state.character.job).toBeNull();
    expect(state.character.flags.lastJobTitle).toBe('Welder');
  });

  it('says "1 year" for a one-year sentence', () => {
    const state = makeState(makeCharacter());
    const entries = applyEffects(makeCtx(state), [{ kind: 'jail', years: 1, crime: 'Theft' }]);
    expect(entries[0]?.text).toBe('You were sentenced to 1 year in prison.');
  });

  it('serves no time for a zero-year sentence: no cell, and the job survives', () => {
    // Routine, not exotic: shipped crimes carry `sentenceYears` ranges from 0.
    const state = makeState(makeCharacter());
    const entries = applyEffects(makeCtx(state), [
      { kind: 'jail', years: 0, crime: 'Shoplifting' },
    ]);
    expect(state.character.prison).toBeNull();
    expect(state.character.job?.title).toBe('Barista');
    expect(state.character.flags.lastJobTitle).toBeUndefined();
    expect(entries).toEqual([
      {
        icon: '⚖️',
        text: 'You were convicted of Shoplifting, but served no time.',
        kind: 'legal',
      },
    ]);
  });

  it('treats a sentence that rounds away to nothing as no time either', () => {
    for (const years of [0.4, -3]) {
      const state = makeState(makeCharacter());
      applyEffects(makeCtx(state), [{ kind: 'jail', years, crime: 'Loitering' }]);
      expect(state.character.prison).toBeNull();
      expect(state.character.job).not.toBeNull();
    }
  });

  it('leaves a sentence being served alone when no further time is added', () => {
    const state = makeState(
      makeCharacter({ job: null, prison: { crime: 'Arson', yearsLeft: 2, totalYears: 5 } })
    );
    applyEffects(makeCtx(state), [{ kind: 'jail', years: 0, crime: 'Loitering' }]);
    expect(state.character.prison).toEqual({ crime: 'Arson', yearsLeft: 2, totalYears: 5 });
  });

  it('refuses an unreadable sentence instead of storing one that never ends', () => {
    /* `careerPhase` frees a prisoner when `yearsLeft -= 1` reaches 0, and NaN
       and Infinity never get there — storing either is a life sentence by typo,
       and `Math.max(0, NaN)` is NaN, so the zero-year guard does not catch it. */
    for (const years of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const state = makeState(makeCharacter());
      const entries = applyEffects(makeCtx(state), [{ kind: 'jail', years, crime: 'Fraud' }]);
      expect(state.character.prison).toBeNull();
      expect(state.character.job?.title).toBe('Barista');
      expect(entries).toEqual([
        { icon: '⚖️', text: 'You were convicted of Fraud, but served no time.', kind: 'legal' },
      ]);

      // The sanitising happens before the write, so a sentence already being
      // served is not overwritten with the unreadable one either.
      const serving = makeState(
        makeCharacter({ job: null, prison: { crime: 'Arson', yearsLeft: 2, totalYears: 5 } })
      );
      applyEffects(makeCtx(serving), [{ kind: 'jail', years, crime: 'Fraud' }]);
      expect(serving.character.prison).toEqual({ crime: 'Arson', yearsLeft: 2, totalYears: 5 });
    }
  });

  it('caps an astronomical sentence so the yearly decrement can still end it', () => {
    const state = makeState(makeCharacter());
    applyEffects(makeCtx(state), [{ kind: 'jail', years: 1e300, crime: 'Treason' }]);
    const prison = state.character.prison;
    // Still a sentence, and still longer than the 110-year death backstop, so no
    // sentence anyone could live to serve is shortened by the cap.
    expect(prison?.yearsLeft).toBeGreaterThan(110);
    expect(prison?.totalYears).toBe(prison?.yearsLeft);
    /* Above 2^53 `yearsLeft -= 1` stops changing the number, which would make an
       uncapped finite sentence exactly as unescapable as Infinity. Serve it. */
    let left = prison?.yearsLeft ?? Number.POSITIVE_INFINITY;
    for (let year = 0; year < 10_000 && left > 0; year += 1) left -= 1;
    expect(left).toBeLessThanOrEqual(0);
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

/* ---------------------------------------------------------------------------
   The content lint that keeps such numbers out in the first place

   The other half of the money guard above. The engine now refuses to *store* a
   number it cannot read; this is where the pack that authored one is told about
   it, before anybody plays it. The two are one fix, so the lint is covered here
   beside the write path it protects.
--------------------------------------------------------------------------- */

function packOf(parts: Omit<ContentPack, 'id'>): ContentRegistry {
  return buildRegistry([{ id: 'lint', ...parts }]);
}

function aJob(over: Partial<JobDef> = {}): JobDef {
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

function anEvent(over: Partial<EventDef> = {}): EventDef {
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

function aSchool(over: Partial<SchoolDef> = {}): SchoolDef {
  return { id: 'primary', label: 'Primary', level: 'primary', years: 5, tuitionPerYear: 0, ...over };
}

/** The three compulsory levels, so a school fixture does not trip that lint too. */
function ladder(): SchoolDef[] {
  return [
    aSchool(),
    aSchool({ id: 'middle', label: 'Middle', level: 'middle', years: 3 }),
    aSchool({ id: 'high', label: 'High', level: 'high', years: 4 }),
  ];
}

describe('validateRegistry: numbers that would poison the balance sheet', () => {
  it('names a salary or a raise that is not a number', () => {
    const problems = validateRegistry(
      packOf({
        jobs: [
          aJob({ id: 'ghost', baseSalary: Number.NaN }),
          aJob({ id: 'endless', baseSalary: Number.POSITIVE_INFINITY }),
          aJob({ id: 'owed', baseSalary: -1 }),
          aJob({ id: 'unraised', raisePct: Number.NaN }),
        ],
      })
    );

    expect(problems).toContain('job "ghost" has baseSalary NaN');
    expect(problems).toContain('job "endless" has baseSalary Infinity');
    expect(problems).toContain('job "owed" has baseSalary -1');
    expect(problems).toContain('job "unraised" has raisePct NaN');
    // A pay cut is a legitimate raise, so only the unreadable one is named.
    expect(validateRegistry(packOf({ jobs: [aJob({ raisePct: -0.1 })] }))).toEqual([]);
  });

  it('names a broken country multiplier', () => {
    const problems = validateRegistry(
      packOf({
        countries: [
          { id: 'nowhere', label: 'Nowhere', flag: '🏳️', costMult: Number.NaN, taxMult: 1, visaDifficulty: 0.5 },
          { id: 'free', label: 'Free', flag: '🏴', costMult: 1, taxMult: Number.POSITIVE_INFINITY, visaDifficulty: -1 },
        ],
      })
    );

    expect(problems).toContain('country "nowhere" has costMult NaN');
    expect(problems).toContain('country "free" has taxMult Infinity');
    expect(problems).toContain('country "free" has visaDifficulty -1');
  });

  it('names broken illness odds and costs', () => {
    const problems = validateRegistry(
      packOf({
        illnesses: [
          {
            id: 'dragonpox',
            label: 'dragonpox',
            chronic: false,
            lethality: Number.NaN,
            onsetWeight: () => 1,
            healthHit: Number.POSITIVE_INFINITY,
            treatCost: Number.NaN,
            cureChance: -1,
          },
        ],
      })
    );

    expect(problems).toContain('illness "dragonpox" has lethality NaN');
    expect(problems).toContain('illness "dragonpox" has cureChance -1');
    expect(problems).toContain('illness "dragonpox" has healthHit Infinity');
    expect(problems).toContain('illness "dragonpox" has treatCost NaN');
  });

  it('names a broken tuition and a programme nobody could ever finish', () => {
    const problems = validateRegistry(
      packOf({
        schools: [
          ...ladder(),
          aSchool({ id: 'uni', level: 'university', years: 4, tuitionPerYear: Number.NaN }),
          aSchool({ id: 'instant', level: 'postgrad', years: 0, tuitionPerYear: 1000 }),
        ],
      })
    );

    expect(problems).toContain('school "uni" has tuitionPerYear NaN');
    expect(problems).toContain('school "instant" has years 0');
  });

  it('names a payout range that is unreadable or backwards', () => {
    const base = { icon: '🛍️', minAge: 10, successChance: () => 0.5 } as const;
    const problems = validateRegistry(
      packOf({
        crimes: [
          { id: 'void', label: 'Void', ...base, payout: [Number.NaN, Number.NaN], sentenceYears: [1, 3] },
          { id: 'backwards', label: 'Backwards', ...base, payout: [500, 20], sentenceYears: [1, 3] },
          { id: 'endless', label: 'Endless', ...base, payout: [20, 200], sentenceYears: [1, Number.POSITIVE_INFINITY] },
        ],
      })
    );

    expect(problems).toContain('crime "void" has a non-finite payout range');
    expect(problems).toContain('crime "backwards" has a reversed payout range');
    expect(problems).toContain('crime "endless" has a non-finite sentenceYears range');
    // One line for the range, not one per bound.
    expect(problems.filter((p) => p.includes('payout range'))).toHaveLength(2);
  });

  it('names an unreadable delta on an event effect and on an outcome effect', () => {
    const problems = validateRegistry(
      packOf({
        events: [
          anEvent({ id: 'windfall', effects: [{ kind: 'money', delta: Number.NaN }] }),
          anEvent({
            id: 'gamble',
            choices: [
              {
                label: 'Bet',
                outcomes: [
                  { weight: 1, text: 'Up.', effects: [{ kind: 'money', delta: Number.POSITIVE_INFINITY }] },
                  { weight: 1, text: 'Down.', effects: [{ kind: 'stat', stat: 'happiness', delta: Number.NaN }] },
                ],
              },
            ],
          }),
          anEvent({
            id: 'spiral',
            effects: [
              { kind: 'fame', delta: Number.NaN },
              { kind: 'rel', who: 'partner', delta: Number.NaN },
              { kind: 'addiction', which: 'alcohol', delta: Number.NaN },
            ],
          }),
        ],
      })
    );

    expect(problems).toContain('event "windfall" has a money delta of NaN');
    expect(problems).toContain('event "gamble" choice "Bet" outcome 0 has a money delta of Infinity');
    expect(problems).toContain('event "gamble" choice "Bet" outcome 1 has a stat delta of NaN');
    expect(problems).toContain('event "spiral" has a fame delta of NaN');
    expect(problems).toContain('event "spiral" has a rel delta of NaN');
    expect(problems).toContain('event "spiral" has a addiction delta of NaN');
  });

  it('names broken upkeep and appreciation on an asset', () => {
    const problems = validateRegistry(
      packOf({
        assets: [
          { id: 'ghost', type: 'vehicle', label: 'Ghost', icon: '🚗', price: 20000, upkeepPct: Number.NaN, apprPct: -0.1 },
          { id: 'rocket', type: 'property', label: 'Rocket', icon: '🚀', price: 1000, upkeepPct: 0.01, apprPct: Number.POSITIVE_INFINITY },
        ],
      })
    );

    expect(problems).toContain('asset "ghost" has upkeepPct NaN');
    expect(problems).toContain('asset "rocket" has apprPct Infinity');
  });

  it('leaves an ordinary, well-formed pack completely clean', () => {
    // The lint was widened, not tightened: plausible content still validates.
    const reg = packOf({
      jobs: [aJob()],
      schools: [...ladder(), aSchool({ id: 'uni', level: 'university', years: 4, tuitionPerYear: 15000 })],
      countries: [{ id: 'us', label: 'the States', flag: '🇺🇸', costMult: 1, taxMult: 1, visaDifficulty: 0.5 }],
      assets: [{ id: 'sedan', type: 'vehicle', label: 'Sedan', icon: '🚗', price: 20000, upkeepPct: 0.05, apprPct: -0.1 }],
      illnesses: [
        {
          id: 'flu',
          label: 'the flu',
          chronic: false,
          lethality: 0.001,
          onsetWeight: () => 1,
          healthHit: 10,
          treatCost: 200,
          cureChance: 0.8,
        },
      ],
      crimes: [
        {
          id: 'shoplift',
          label: 'Shoplifting',
          icon: '🛍️',
          minAge: 10,
          successChance: () => 0.5,
          payout: [20, 200],
          sentenceYears: [1, 3],
        },
      ],
      events: [
        anEvent({
          effects: [
            { kind: 'money', delta: -250 },
            { kind: 'stat', stat: 'happiness', delta: -5 },
          ],
          choices: [
            { label: 'Pay up', outcomes: [{ weight: 1, text: 'Fine.', effects: [{ kind: 'fame', delta: 0 }] }] },
          ],
        }),
      ],
    });

    expect(validateRegistry(reg)).toEqual([]);
    expect(validateRegistry(buildRegistry([]))).toEqual([]);
  });
});
