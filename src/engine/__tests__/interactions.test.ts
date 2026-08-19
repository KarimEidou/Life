import { describe, expect, it } from 'vitest';

import { killCharacter } from '@/engine/death';
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
    expect(canUse(ctxOf(state, EMPTY), interaction())).toEqual({ ok: true, cost: 0 });
  });

  it('applies the age window, defaulting to 0..200', () => {
    const def = interaction({ minAge: 18, maxAge: 65 });

    expect(canUse(ctxOf(newLife(1, 17), EMPTY), def).ok).toBe(false);
    expect(canUse(ctxOf(newLife(1, 66), EMPTY), def).ok).toBe(false);
    expect(canUse(ctxOf(newLife(1, 18), EMPTY), def)).toEqual({ ok: true, cost: 0 });
    expect(canUse(ctxOf(newLife(1, 65), EMPTY), def)).toEqual({ ok: true, cost: 0 });
    expect(canUse(ctxOf(newLife(1, 0), EMPTY), interaction())).toEqual({ ok: true, cost: 0 });
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
    expect(canUse(ctxOf(state, EMPTY), def)).toEqual({ ok: true, cost: 0 });
  });

  it('ignores the cooldown when the interaction has never been used', () => {
    const state = newLife();
    expect(canUse(ctxOf(state, EMPTY), interaction({ cooldownYears: 10 }))).toEqual({
      ok: true,
      cost: 0,
    });
  });

  it('checks affordability against a flat price and a priced function', () => {
    const state = newLife();
    state.character.money = 100;

    expect(canUse(ctxOf(state, EMPTY), interaction({ cost: 100 }))).toEqual({ ok: true, cost: 100 });
    expect(canUse(ctxOf(state, EMPTY), interaction({ cost: 101 }))).toEqual({
      ok: false,
      reason: "You can't afford it.",
      cost: 101,
    });
    expect(canUse(ctxOf(state, EMPTY), interaction({ cost: (ctx) => ctx.c.age * 10 }))).toEqual({
      ok: false,
      reason: "You can't afford it.",
      cost: 250,
    });
  });

  it('refuses a price that is not a readable amount, instead of handing the row over free', () => {
    /* `Math.max(0, NaN)` is NaN and an infinite price passes every `> 0` test,
       so an unreadable price used to be quoted at $0: the wallet check waved the
       row through, `runInteraction` skipped the charge and the sheet printed no
       price, which made an item priced beyond what the game can express the
       cheapest thing in it. Compare a merely huge finite price, which refuses. */
    for (const cost of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const state = newLife();
      state.character.money = 1_000_000;
      const reg = regOf({
        interactions: [
          interaction({
            cost,
            resolve: () => ({ text: 'Never runs.', effects: [{ kind: 'money', delta: 999 }] }),
          }),
        ],
      });
      const def = reg.interactionsById.gym as InteractionDef;
      const rngBefore = state.rngState;

      // No `cost` either: a price nobody can read is a quote for nobody, and
      // `fmtMoney` would print the non-finite one the sheet renders as "$0".
      expect(canUse(ctxOf(state, reg), def)).toEqual({
        ok: false,
        reason: "You can't afford it.",
      });
      expect(runInteraction(state, reg, 'gym')).toEqual({
        text: "You can't afford it.",
        icon: '🚫',
        entries: [],
      });
      expect(state.character.money).toBe(1_000_000);
      expect(state.interactionUse).toEqual({});
      expect(feed(state)).toEqual([]);
      expect(state.rngState).toBe(rngBefore);
    }

    // The same for a priced function whose arithmetic ran off the end of the
    // number line, or that read a price the pack never authored.
    const rich = newLife();
    rich.character.money = 1_000_000;
    expect(canUse(ctxOf(rich, EMPTY), interaction({ cost: () => Number.NaN }))).toEqual({
      ok: false,
      reason: "You can't afford it.",
    });
  });

  it('reports the price it validated and evaluates it only once', () => {
    const state = newLife();
    let calls = 0;
    const def = interaction({
      cost: () => {
        calls += 1;
        return 300;
      },
    });

    expect(canUse(ctxOf(state, EMPTY), def)).toEqual({ ok: true, cost: 300 });
    expect(calls).toBe(1);
  });

  it('rewinds the cursor whatever it answers, and reports the one it spent', () => {
    const priced = (): InteractionDef => interaction({ cost: (ctx) => ctx.rng.int(100, 900) });
    const state = newLife();
    state.character.money = 0;
    const before = state.rngState;

    // A refusal is free, so the quote it reports is repeatable rather than a
    // different roll every time the sheet re-prices a greyed-out row.
    const first = canUse(ctxOf(state, EMPTY), priced());
    expect(first.ok).toBe(false);
    expect(state.rngState).toBe(before);
    expect(canUse(ctxOf(state, EMPTY), priced())).toEqual(first);
    expect(state.rngState).toBe(before);

    /* And so is an approval: the same row, now affordable, quotes the same price
       off the same cursor and leaves it exactly where it found it. Keeping the
       draw here made looking at a row cost the life its future — but only for a
       character who happened to be able to afford it. */
    state.character.money = 1000;
    const passed = canUse(ctxOf(state, EMPTY), priced());
    expect(passed.ok).toBe(true);
    expect(passed.cost).toBe(first.cost);
    expect(state.rngState).toBe(before);

    // The draw is not lost, it is handed back for `runInteraction` to adopt.
    const spent = { rngState: before };
    createRng(spent).int(100, 900);
    expect(passed.rngState).toBe(spent.rngState);
    expect(passed.rngState).not.toBe(before);
  });

  it('is free to ask however many times, on an allowed priced row', () => {
    /* `availableInteractions` tells the sheet to call `canUse` per row before
       enabling it — on rows the player never runs — so a repaint must not
       silently re-roll every future event, illness, promotion and death check.
       Twenty looks at an affordable row used to advance the cursor twenty
       times, while twenty looks at the identical row on an empty wallet cost
       nothing at all: whether looking cost a character their future came down
       to whether they could afford the row they were looking at. */
    const reg = regOf({ interactions: [interaction({ cost: (ctx) => 10 + ctx.rng.int(0, 20) })] });
    const def = reg.interactionsById.gym as InteractionDef;
    const quotes = new Set<number | undefined>();

    for (const money of [0, 100000]) {
      const state = newLife(111, 30);
      state.character.money = money;
      const before = state.rngState;

      for (let look = 0; look < 20; look += 1) {
        const row = canUse(ctxOf(state, reg), def);
        expect(row.ok).toBe(money > 0);
        quotes.add(row.cost);
        expect(state.rngState).toBe(before);
      }
    }

    // One cursor, one price: the quote never depended on the wallet either.
    expect(quotes.size).toBe(1);
    const quoted = [...quotes][0] as number;

    /* And running the row still spends exactly the one draw its price took —
       `runInteraction` adopts the cursor the gate handed back rather than
       re-pricing the def — however many times the sheet looked at it first. */
    const state = newLife(111, 30);
    state.character.money = 100000;
    const opened = state.rngState;
    for (let look = 0; look < 20; look += 1) canUse(ctxOf(state, reg), def);
    runInteraction(state, reg, 'gym');

    const oneDraw = { rngState: opened };
    createRng(oneDraw).int(0, 20);
    expect(state.rngState).toBe(oneDraw.rngState);
    expect(state.character.money).toBe(100000 - quoted);
  });

  it('spends no draw on a refusal from the condition or the cooldown', () => {
    const blocked = newLife();
    const cursorA = blocked.rngState;
    const moody = interaction({ condition: (ctx) => ctx.rng.chance(0) });
    expect(canUse(ctxOf(blocked, EMPTY), moody)).toEqual({
      ok: false,
      reason: "You can't do that right now.",
    });
    expect(blocked.rngState).toBe(cursorA);

    const cooling = newLife(1, 30);
    cooling.interactionUse.gym = 28;
    const cursorB = cooling.rngState;
    // The condition draws before the cooldown gate is even reached.
    expect(
      canUse(
        ctxOf(cooling, EMPTY),
        interaction({ cooldownYears: 5, condition: (ctx) => ctx.rng.next() >= 0 })
      )
    ).toEqual({ ok: false, reason: 'Too soon.' });
    expect(cooling.rngState).toBe(cursorB);
  });

  it('leaves the price unread when an earlier gate refuses', () => {
    const state = newLife(1, 30);
    let calls = 0;
    const def = interaction({
      minAge: 40,
      cost: () => {
        calls += 1;
        return 1;
      },
    });

    expect(canUse(ctxOf(state, EMPTY), def)).toEqual({ ok: false, reason: "You're too young." });
    expect(calls).toBe(0);
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

  it('evaluates a priced function exactly once per use', () => {
    const state = newLife();
    const prices: number[] = [];
    const reg = regOf({
      interactions: [
        interaction({
          cost: (ctx) => {
            const price = ctx.rng.int(100, 900);
            prices.push(price);
            return price;
          },
        }),
      ],
    });

    const result = runInteraction(state, reg, 'gym');

    expect(result?.icon).toBe('🏋️');
    expect(prices).toHaveLength(1);
    // One evaluation means one draw: the gate and the till share the same roll.
    expect(state.character.money).toBe(1000 - (prices[0] as number));
  });

  it('charges the price the gate approved, not a second roll of it', () => {
    const reg = regOf({ interactions: [interaction({ cost: (ctx) => ctx.rng.int(100, 900) })] });
    const def = reg.interactionsById.gym as InteractionDef;

    for (let seed = 1; seed <= 20; seed += 1) {
      const state = newLife(seed);
      // A detached cursor reads the price the gate would validate without
      // spending the run's draw, so the run below starts on the same roll.
      const quoted = canUse(
        { state, c: state.character, rng: createRng({ rngState: state.rngState }), reg },
        def
      );

      expect(quoted).toEqual({ ok: true, cost: expect.any(Number) });
      runInteraction(state, reg, 'gym');
      expect(state.character.money).toBe(1000 - (quoted.cost as number));
    }
  });

  it('spends exactly one draw on a priced function, not two', () => {
    const state = newLife();
    const reg = regOf({ interactions: [interaction({ cost: (ctx) => ctx.rng.int(100, 900) })] });
    const cursor = { rngState: state.rngState };
    createRng(cursor).int(100, 900);

    runInteraction(state, reg, 'gym');

    expect(state.rngState).toBe(cursor.rngState);
  });

  it('refuses a drawn price the wallet cannot cover instead of emptying it', () => {
    const prices: number[] = [];
    const reg = regOf({
      interactions: [
        interaction({
          cost: (ctx) => {
            const price = ctx.rng.int(100, 900);
            prices.push(price);
            return price;
          },
        }),
      ],
    });
    let approved = 0;
    let refused = 0;

    for (let seed = 1; seed <= 200; seed += 1) {
      prices.length = 0;
      const state = newLife(seed);
      state.character.money = 400;

      const result = runInteraction(state, reg, 'gym');
      const price = prices[0] as number;

      if (price > 400) {
        refused += 1;
        expect(result).toEqual({ text: "You can't afford it.", icon: '🚫', entries: [] });
        expect(state.character.money).toBe(400);
        expect(state.interactionUse).toEqual({});
      } else {
        approved += 1;
        // Never clamped to $0: the bill is the quote the wallet was checked against.
        expect(state.character.money).toBe(400 - price);
      }
    }

    // Both sides of the gate are actually exercised by this seed range.
    expect(approved).toBeGreaterThan(0);
    expect(refused).toBeGreaterThan(0);
  });

  /* `targetId` is whatever the UI row carried, and on a loaded save it comes
     straight back out of JSON, so it widens to `string`. `state.people` always
     has `Object.prototype` behind it: a magic id must read as nobody home. */
  it('treats an inherited member of state.people as an unknown target', () => {
    const reg = regOf({
      interactions: [
        interaction({
          id: 'poke',
          area: 'relationships',
          label: 'Poke',
          icon: '👉',
          resolve: (ctx) => ({
            text: `You poked ${ctx.target?.name ?? 'nobody'}.`,
            effects: [{ kind: 'rel', who: 'target', delta: 5 }],
          }),
        }),
      ],
    });
    const polluted = (): boolean =>
      Object.prototype.hasOwnProperty.call(Object.prototype, 'rel') ||
      Object.prototype.hasOwnProperty.call(Object, 'rel') ||
      Object.prototype.hasOwnProperty.call(Object.prototype.toString, 'rel') ||
      Object.prototype.hasOwnProperty.call(Object.prototype.valueOf, 'rel');

    try {
      const unknown = runInteraction(newLife(), reg, 'poke', 'p99');
      expect(unknown).toMatchObject({ text: 'You poked nobody.', icon: '👉' });

      for (const magic of ['__proto__', 'constructor', 'toString', 'valueOf']) {
        const state = newLife();
        // Same answer as any id nobody owns, and nothing outside the state moved.
        expect(runInteraction(state, reg, 'poke', magic)).toEqual(unknown);
        expect(polluted()).toBe(false);
        expect(({} as Record<string, unknown>).rel).toBeUndefined();
      }
    } finally {
      // Never leak a polluted prototype into the rest of the suite.
      delete (Object.prototype as unknown as Record<string, unknown>).rel;
      delete (Object as unknown as Record<string, unknown>).rel;
      delete (Object.prototype.toString as unknown as Record<string, unknown>).rel;
      delete (Object.prototype.valueOf as unknown as Record<string, unknown>).rel;
    }
  });

  /* Pressing a greyed-out row must not re-roll the rest of the life: every
     future event, illness, promotion and death check hangs off this cursor. */
  it('leaves the cursor untouched when the gate refuses on cost, condition or cooldown', () => {
    const reg = regOf({
      interactions: [
        interaction({ id: 'pricey', label: 'Pricey', cost: (ctx) => ctx.rng.int(1000, 2000) }),
        interaction({ id: 'moody', label: 'Moody', condition: (ctx) => ctx.rng.chance(0) }),
        interaction({
          id: 'spa',
          label: 'Spa day',
          cooldownYears: 5,
          condition: (ctx) => ctx.rng.next() >= 0,
        }),
      ],
    });

    const broke = newLife();
    broke.character.money = 0;
    const cursorA = broke.rngState;
    expect(runInteraction(broke, reg, 'pricey')).toEqual({
      text: "You can't afford it.",
      icon: '🚫',
      entries: [],
    });
    expect(broke.rngState).toBe(cursorA);
    expect(broke.character.money).toBe(0);

    const blocked = newLife();
    const cursorB = blocked.rngState;
    expect(runInteraction(blocked, reg, 'moody')).toEqual({
      text: "You can't do that right now.",
      icon: '🚫',
      entries: [],
    });
    expect(blocked.rngState).toBe(cursorB);

    const cooling = newLife(1, 30);
    cooling.interactionUse.spa = 28;
    const cursorC = cooling.rngState;
    expect(runInteraction(cooling, reg, 'spa')).toEqual({
      text: 'Too soon.',
      icon: '🚫',
      entries: [],
    });
    expect(cooling.rngState).toBe(cursorC);
    expect(feed(cooling)).toEqual([]);
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

  it('refuses a crime below its minAge without spending a draw', () => {
    const state = newLife(1, 8);
    const reg = regOf({ crimes: [crime()] }); // minAge 10
    const rngBefore = state.rngState;

    expect(commitCrime(state, reg, 'shoplift')).toEqual({
      text: "You're too young for that.",
      icon: '🚫',
      entries: [],
    });
    expect(state.character.money).toBe(1000);
    expect(state.character.prison).toBeNull();
    expect(state.character.flags.convictions).toBeUndefined();
    expect(state.rngState).toBe(rngBefore);
    expect(feed(state)).toEqual([]);
  });

  it('lets a character exactly at minAge through', () => {
    const state = newLife(1, 10);
    const reg = regOf({ crimes: [crime()] });

    expect(commitCrime(state, reg, 'shoplift').text).toBe('You got away with Shoplifting. +$500');
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

  it('scores nothing on a payout that is not a number, instead of poisoning the balance', () => {
    /* `rng.int` answers a non-finite bound with NaN, and `Math.max(0, NaN)` is
       NaN: one such crime in a pack turned the balance into NaN for the rest of
       the life, and every later write was `NaN + delta`. The draw is spent
       either way, so the sequence is unchanged. */
    for (const payout of [
      [Number.NaN, Number.NaN],
      [0, Number.POSITIVE_INFINITY],
    ] as [number, number][]) {
      const state = newLife();
      const reg = regOf({ crimes: [crime({ payout })] });
      const spent = { rngState: state.rngState };
      const mirror = createRng(spent);
      mirror.chance(1);
      mirror.int(payout[0], payout[1]);

      const result = commitCrime(state, reg, 'shoplift');

      expect(result.text).toBe('You got away with Shoplifting. +$0');
      expect(state.character.money).toBe(1000);
      expect(Number.isFinite(state.character.money)).toBe(true);
      expect(state.rngState).toBe(spent.rngState);
    }
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
    expect(state.character.flags.lastJobTitle).toBe('Clerk');
    expect(state.character.stats.happiness).toBe(Math.max(0, happiness - 10));
    expect(state.character.flags.convictions).toBe(1);
    expect(feed(state)).toEqual(result.entries);
  });

  it('names the job the sentence cost in the obituary, not "Unemployed"', () => {
    const state = newLife();
    state.character.job = {
      jobId: 'j1',
      title: 'Junior Clerk',
      salary: 30000,
      years: 2,
      performance: 60,
      workHard: false,
    };
    const reg = regOf({ crimes: [crime({ successChance: () => 0 })] });

    commitCrime(state, reg, 'shoplift');
    killCharacter(state, reg, 'a shanking');

    expect(state.death?.obituary).toContain('Junior Clerk.');
    expect(state.death?.obituary).not.toContain('Unemployed');
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

  it('convicts without a cell when the term is no years at all', () => {
    /* Not an edge case: four of the ten shipped crimes carry
       `sentenceYears: [0, 1]`, so about half of their convictions roll a 0. The
       rule that a term of no years is a conviction rather than a jailing lives
       where the one `PrisonState` in the engine is built; this pins that the
       crime layer inherits it, because a `{ yearsLeft: 0, totalYears: 0 }` cell
       costs the job for time never served, refuses every `free()` row for the
       year, and hands the crime sheet a sentence with nothing left to serve to
       render. The repeat-offender multiplier must not invent time either. */
    for (const priors of [0, 3]) {
      const state = newLife();
      state.character.job = {
        jobId: 'j1',
        title: 'Clerk',
        salary: 30000,
        years: 2,
        performance: 60,
        workHard: false,
      };
      state.character.flags.convictions = priors;
      const happiness = state.character.stats.happiness;
      const reg = regOf({ crimes: [crime({ successChance: () => 0, sentenceYears: [0, 0] })] });

      const result = commitCrime(state, reg, 'shoplift');

      expect(result.text).toBe('GUILTY. Shoplifting.');
      expect(state.character.prison).toBeNull();
      // No cell, so no job lost to one — and no obituary line about losing it.
      expect(state.character.job?.title).toBe('Clerk');
      expect(state.character.flags.lastJobTitle).toBeUndefined();
      expect(result.entries[1]).toEqual({
        icon: '⚖️',
        kind: 'legal',
        text: 'You were convicted of Shoplifting, but served no time.',
      });
      // Still a conviction: the mood cost and the record both land.
      expect(state.character.stats.happiness).toBe(Math.max(0, happiness - 10));
      expect(state.character.flags.convictions).toBe(priors + 1);
      expect(feed(state)).toEqual(result.entries);
    }
  });

  it('serves no sentence for a term that is not a number, instead of a cell with no exit', () => {
    /* The sentence twin of the payout guard above. `rng.int` answers a NaN
       bound with NaN and an infinite one with Infinity, and `careerPhase` ends
       a sentence by subtracting one a year until `yearsLeft <= 0` — which
       neither ever reaches, so the character would sit in a cell, jobless and
       unpaid, for the rest of the life. The draw is spent either way, so the
       sequence is unchanged, and the repeat-offender multiplier must not
       resurrect the poison either. */
    for (const sentenceYears of [
      [Number.NaN, Number.NaN],
      [3, Number.POSITIVE_INFINITY],
    ] as [number, number][]) {
      for (const priors of [0, 1]) {
        const state = newLife();
        state.character.flags.convictions = priors;
        const reg = regOf({ crimes: [crime({ successChance: () => 0, sentenceYears })] });
        const spent = { rngState: state.rngState };
        const mirror = createRng(spent);
        mirror.chance(0);
        mirror.int(sentenceYears[0], sentenceYears[1]);

        const result = commitCrime(state, reg, 'shoplift');

        expect(result.text).toBe('GUILTY. Shoplifting.');
        /* A conviction with no time to serve: the term is a number the prison
           countdown can reach the end of. Whether that reads as a cell of zero
           years or as no cell at all is `applyEffects`' call, not this one's. */
        expect(state.character.prison?.yearsLeft ?? 0).toBe(0);
        expect(result.entries[1].text).not.toMatch(/NaN|Infinity/);
        expect(state.character.flags.convictions).toBe(priors + 1);
        expect(state.rngState).toBe(spent.rngState);
      }
    }
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

describe('a finished life', () => {
  it('refuses every action once the character is dead', () => {
    const state = newLife(8, 40);
    const reg = regOf({
      interactions: [
        interaction({
          resolve: () => ({ text: 'You worked out.', effects: [{ kind: 'stat', stat: 'health', delta: 5 }] }),
        }),
      ],
      crimes: [crime({ id: 'rob', label: 'Robbery', payout: [1000, 1000] })],
    });

    killCharacter(state, reg, 'a meteor');
    expect(state.phase).toBe('dead');

    const money = state.character.money;
    const health = state.character.stats.health;
    const rngBefore = state.rngState;
    const entriesBefore = feed(state).length;

    expect(canUse(ctxOf(state, reg), interaction())).toEqual({
      ok: false,
      reason: 'Your life is over.',
    });
    expect(runInteraction(state, reg, 'gym')).toEqual({
      text: 'Your life is over.',
      icon: '🚫',
      entries: [],
    });
    expect(commitCrime(state, reg, 'rob')).toEqual({
      text: 'Your life is over.',
      icon: '🚫',
      entries: [],
    });

    expect(state.character.money).toBe(money);
    expect(state.character.stats.health).toBe(health);
    expect(state.character.prison).toBeNull();
    expect(state.interactionUse).toEqual({});
    expect(state.rngState).toBe(rngBefore);
    // Nothing lands after the death line that closes the feed.
    expect(feed(state)).toHaveLength(entriesBefore);
  });
});
