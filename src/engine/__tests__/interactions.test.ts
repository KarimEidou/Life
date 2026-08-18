import { describe, expect, it } from 'vitest';

import { availableInteractions, canUse, commitCrime, runInteraction } from '@/engine/interactions';
import { buildRegistry } from '@/engine/registry';
import { createRng } from '@/engine/rng';
import { createLife } from '@/engine/state';
import type {
  ContentPack,
  ContentRegistry,
  CrimeDef,
  Ctx,
  GameState,
  InteractionDef,
  LogEntry,
} from '@/types';

const EMPTY = buildRegistry([]);

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
    successChance: () => 1,
    payout: [500, 500],
    sentenceYears: [4, 4],
    ...over,
  };
}

function regOf(parts: Omit<ContentPack, 'id'>): ContentRegistry {
  return buildRegistry([{ id: 'test-actions', ...parts }]);
}

function newLife(seed = 1, age = 25): GameState {
  const state = createLife(EMPTY, { seed, firstName: 'Ada', lastName: 'Moreno' });
  state.character.age = age;
  state.character.money = 1000;
  return state;
}

function ctxOf(state: GameState, reg: ContentRegistry): Ctx {
  return { state, c: state.character, rng: createRng(state), reg };
}

/** Entries in the year the actions wrote into, minus the birth line. */
function feed(state: GameState): LogEntry[] {
  return (state.log[state.log.length - 1]?.entries ?? []).slice(1);
}

describe('canUse', () => {
  it('accepts an interaction with no gates at all', () => {
    const state = newLife();
    expect(canUse(ctxOf(state, EMPTY), interaction())).toEqual({ ok: true });
  });

  it('applies the age window, defaulting to 0..200', () => {
    const def = interaction({ minAge: 18, maxAge: 65 });

    expect(canUse(ctxOf(newLife(1, 17), EMPTY), def).ok).toBe(false);
    expect(canUse(ctxOf(newLife(1, 66), EMPTY), def).ok).toBe(false);
    expect(canUse(ctxOf(newLife(1, 18), EMPTY), def)).toEqual({ ok: true });
    expect(canUse(ctxOf(newLife(1, 65), EMPTY), def)).toEqual({ ok: true });
    expect(canUse(ctxOf(newLife(1, 0), EMPTY), interaction())).toEqual({ ok: true });
  });

  it('refuses when the condition fails', () => {
    const state = newLife();
    const def = interaction({ condition: (ctx) => ctx.c.job !== null });

    expect(canUse(ctxOf(state, EMPTY), def).ok).toBe(false);
  });

  it('reads interactionUse as the age of the last use', () => {
    const state = newLife(1, 30);
    const def = interaction({ cooldownYears: 5 });

    state.interactionUse.gym = 26;
    expect(canUse(ctxOf(state, EMPTY), def)).toEqual({ ok: false, reason: 'Too soon.' });

    state.interactionUse.gym = 25;
    expect(canUse(ctxOf(state, EMPTY), def)).toEqual({ ok: true });
  });

  it('ignores the cooldown when the interaction has never been used', () => {
    const state = newLife();
    expect(canUse(ctxOf(state, EMPTY), interaction({ cooldownYears: 10 }))).toEqual({ ok: true });
  });

  it('checks affordability against a flat price and a priced function', () => {
    const state = newLife();
    state.character.money = 100;

    expect(canUse(ctxOf(state, EMPTY), interaction({ cost: 100 }))).toEqual({ ok: true });
    expect(canUse(ctxOf(state, EMPTY), interaction({ cost: 101 }))).toEqual({
      ok: false,
      reason: "You can't afford it.",
    });
    expect(canUse(ctxOf(state, EMPTY), interaction({ cost: (ctx) => ctx.c.age * 10 })).ok).toBe(false);
  });
});

describe('availableInteractions', () => {
  it('filters by area and sorts by label', () => {
    const reg = regOf({
      interactions: [
        interaction({ id: 'zumba', label: 'Zumba class' }),
        interaction({ id: 'art', label: 'Art class' }),
        interaction({ id: 'date', label: 'Ask someone out', area: 'relationships' }),
      ],
    });

    expect(availableInteractions(newLife(), reg, 'activities').map((d) => d.id)).toEqual(['art', 'zumba']);
    expect(availableInteractions(newLife(), reg, 'relationships').map((d) => d.id)).toEqual(['date']);
  });

  it('keeps unaffordable and cooling-down rows so the sheet can grey them out', () => {
    const state = newLife();
    state.character.money = 0;
    state.interactionUse.spa = state.character.age;
    const reg = regOf({
      interactions: [
        interaction({ id: 'yacht', label: 'Charter a yacht', cost: 50000 }),
        interaction({ id: 'spa', label: 'Book a spa day', cooldownYears: 3 }),
      ],
    });

    const rows = availableInteractions(state, reg, 'activities');

    expect(rows.map((d) => d.id)).toEqual(['spa', 'yacht']);
    expect(canUse(ctxOf(state, reg), rows[0] as InteractionDef).reason).toBe('Too soon.');
    expect(canUse(ctxOf(state, reg), rows[1] as InteractionDef).reason).toBe("You can't afford it.");
  });

  it('drops rows outside the age window or blocked by their condition', () => {
    const state = newLife(1, 12);
    const reg = regOf({
      interactions: [
        interaction({ id: 'bar', label: 'Hit the bar', minAge: 21 }),
        interaction({ id: 'quit', label: 'Quit your job', condition: (ctx) => ctx.c.job !== null }),
        interaction({ id: 'nap', label: 'Take a nap' }),
      ],
    });

    expect(availableInteractions(state, reg, 'activities').map((d) => d.id)).toEqual(['nap']);
  });

  it('never advances the run rng, even for a condition that draws', () => {
    const state = newLife();
    const reg = regOf({
      interactions: [interaction({ condition: (ctx) => ctx.rng.chance(0.5) || true })],
    });
    const before = state.rngState;

    availableInteractions(state, reg, 'activities');

    expect(state.rngState).toBe(before);
  });
});

describe('runInteraction', () => {
  it('returns null for an id the registry does not know', () => {
    expect(runInteraction(newLife(), EMPTY, 'ghost')).toBeNull();
  });

  it('charges the cost, logs the line and applies the effects', () => {
    const state = newLife();
    const reg = regOf({
      interactions: [
        interaction({
          cost: 60,
          resolve: () => ({
            text: 'You lifted more than last time.',
            effects: [
              { kind: 'stat', stat: 'health', delta: 4 },
              { kind: 'log', icon: '💪', text: 'You feel stronger.', logKind: 'good' },
            ],
          }),
        }),
      ],
    });
    const health = state.character.stats.health;

    const result = runInteraction(state, reg, 'gym');

    expect(result?.text).toBe('You lifted more than last time.');
    expect(result?.icon).toBe('🏋️');
    expect(result?.entries).toEqual([
      { icon: '🏋️', kind: 'info', text: 'You lifted more than last time.' },
      { icon: '💪', kind: 'good', text: 'You feel stronger.' },
    ]);
    expect(state.character.money).toBe(940);
    expect(state.character.stats.health).toBe(Math.min(100, health + 4));
    expect(feed(state)).toEqual(result?.entries);
  });

  it('records the cooldown as the current age', () => {
    const state = newLife(1, 33);
    const reg = regOf({ interactions: [interaction({ cooldownYears: 2 })] });

    runInteraction(state, reg, 'gym');

    expect(state.interactionUse.gym).toBe(33);
    expect(runInteraction(state, reg, 'gym')).toEqual({ text: 'Too soon.', icon: '🚫', entries: [] });
  });

  it('prefers the icon the outcome carries and fills templates in its text', () => {
    const state = newLife();
    const reg = regOf({
      interactions: [interaction({ resolve: () => ({ text: '{name} took a walk.', effects: [], icon: '🚶' }) })],
    });

    const result = runInteraction(state, reg, 'gym');

    expect(result).toMatchObject({ icon: '🚶', text: 'Ada Moreno took a walk.' });
  });

  it('passes the target through to the resolver and to the effects', () => {
    const state = newLife();
    const mother = state.people.p1;
    if (!mother) throw new Error('fixture: expected a mother at p1');
    mother.rel = 50;
    const reg = regOf({
      interactions: [
        interaction({
          id: 'compliment',
          area: 'relationships',
          resolve: (ctx) => ({
            text: `You complimented ${ctx.target?.name ?? 'nobody'}.`,
            effects: [{ kind: 'rel', who: 'target', delta: 8 }],
          }),
        }),
      ],
    });

    const result = runInteraction(state, reg, 'compliment', mother.id);

    expect(result?.text).toBe(`You complimented ${mother.name}.`);
    expect(mother.rel).toBe(58);
  });

  it('reports the reason and changes nothing when the gate refuses', () => {
    const state = newLife();
    state.character.money = 10;
    const reg = regOf({
      interactions: [interaction({ cost: 500, resolve: () => ({ text: 'Never runs.', effects: [{ kind: 'money', delta: 999 }] }) })],
    });
    const rngBefore = state.rngState;

    const result = runInteraction(state, reg, 'gym');

    expect(result).toEqual({ text: "You can't afford it.", icon: '🚫', entries: [] });
    expect(state.character.money).toBe(10);
    expect(state.interactionUse).toEqual({});
    expect(feed(state)).toEqual([]);
    expect(state.rngState).toBe(rngBefore);
  });

  it('settles a death an effect only marked', () => {
    const state = newLife();
    const reg = regOf({
      interactions: [
        interaction({
          id: 'skydive',
          resolve: () => ({ text: 'The chute never opened.', effects: [{ kind: 'death', cause: 'a skydiving accident' }] }),
        }),
      ],
    });

    runInteraction(state, reg, 'skydive');

    expect(state.phase).toBe('dead');
    expect(state.death?.cause).toBe('a skydiving accident');
    expect(feed(state).map((e) => e.kind)).toEqual(['info', 'death']);
  });
});

describe('commitCrime', () => {
  it('blocks an unknown crime and anyone already inside', () => {
    const reg = regOf({ crimes: [crime()] });

    expect(commitCrime(newLife(), reg, 'ghost')).toEqual({
      text: 'You thought better of it.',
      icon: '🚫',
      entries: [],
    });

    const inmate = newLife();
    inmate.character.prison = { crime: 'Robbery', yearsLeft: 2, totalYears: 3 };
    expect(commitCrime(inmate, reg, 'shoplift')).toEqual({
      text: "You're already in prison.",
      icon: '🚫',
      entries: [],
    });
  });

  it('pays out and logs the score when the roll succeeds', () => {
    const state = newLife();
    const reg = regOf({ crimes: [crime()] });

    const result = commitCrime(state, reg, 'shoplift');

    expect(result).toEqual({
      text: 'You got away with Shoplifting. +$500',
      icon: '🛍️',
      entries: [{ icon: '🛍️', kind: 'legal', text: 'You got away with Shoplifting. +$500' }],
    });
    expect(state.character.money).toBe(1500);
    expect(state.character.prison).toBeNull();
    expect(state.character.flags.convictions).toBeUndefined();
    expect(feed(state)).toEqual(result.entries);
  });

  it('convicts, jails and counts the conviction when the roll fails', () => {
    const state = newLife();
    state.character.job = { jobId: 'j1', title: 'Clerk', salary: 30000, years: 2, performance: 60, workHard: false };
    const happiness = state.character.stats.happiness;
    const reg = regOf({ crimes: [crime({ successChance: () => 0 })] });

    const result = commitCrime(state, reg, 'shoplift');

    expect(result.text).toBe('GUILTY. Shoplifting.');
    expect(result.entries[0]).toEqual({ icon: '🛍️', kind: 'legal', text: 'GUILTY. Shoplifting.' });
    expect(result.entries[1]).toEqual({
      icon: '⚖️',
      kind: 'legal',
      text: 'You were sentenced to 4 years in prison.',
    });
    expect(state.character.prison).toEqual({ crime: 'Shoplifting', yearsLeft: 4, totalYears: 4 });
    expect(state.character.job).toBeNull();
    expect(state.character.stats.happiness).toBe(Math.max(0, happiness - 10));
    expect(state.character.flags.convictions).toBe(1);
    expect(feed(state)).toEqual(result.entries);
  });

  it('adds half again to a repeat offender sentence', () => {
    const state = newLife();
    state.character.flags.convictions = 1;
    const reg = regOf({ crimes: [crime({ successChance: () => 0, sentenceYears: [3, 3] })] });

    commitCrime(state, reg, 'shoplift');

    // 3 rolled * 1.5 for the prior conviction.
    expect(state.character.prison?.totalYears).toBe(5);
    expect(state.character.flags.convictions).toBe(2);
  });

  it('splits into both branches across seeds and replays each one', () => {
    const reg = regOf({ crimes: [crime({ successChance: () => 0.5 })] });
    const outcomes = new Map<number, string>();

    for (let seed = 1; seed <= 20; seed += 1) {
      const state = newLife(seed);
      outcomes.set(seed, commitCrime(state, reg, 'shoplift').text);
      // A fresh life on the same seed must land on the same side of the roll.
      expect(commitCrime(newLife(seed), reg, 'shoplift').text).toBe(outcomes.get(seed));
    }

    const texts = [...outcomes.values()];
    expect(texts.some((t) => t.startsWith('You got away'))).toBe(true);
    expect(texts.some((t) => t.startsWith('GUILTY.'))).toBe(true);
  });
});
