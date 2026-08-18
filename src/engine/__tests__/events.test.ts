import { describe, expect, it } from 'vitest';

import { ageUp, resolveChoice } from '@/engine/ageUp';
import { eventsPhase } from '@/engine/phases/events';
import { buildRegistry } from '@/engine/registry';
import { createRng } from '@/engine/rng';
import { createLife } from '@/engine/state';
import type {
  ContentPack,
  ContentRegistry,
  Ctx,
  EventDef,
  GameState,
  LogEntry,
  Rng,
} from '@/types';

const EMPTY = buildRegistry([]);

function event(over: Partial<EventDef> = {}): EventDef {
  return {
    id: 'life-something',
    area: 'life',
    icon: '🎲',
    minAge: 0,
    maxAge: 120,
    weight: 1,
    text: 'Something happened.',
    ...over,
  };
}

function registryOf(events: EventDef[]): ContentRegistry {
  const pack: ContentPack = { id: 'test-events', events };
  return buildRegistry([pack]);
}

function newLife(seed: number, age = 20): GameState {
  const state = createLife(EMPTY, { seed, firstName: 'Ada', lastName: 'Moreno' });
  state.character.age = age;
  return state;
}

/**
 * An `Rng` whose `chance` results are scripted, so a test can say exactly how
 * many events fire. `weighted` takes the heaviest item, which makes the draw a
 * pure function of the pool.
 */
function scriptRng(chances: readonly boolean[]): Rng {
  let index = 0;
  return {
    next: () => 0.5,
    int: (min: number) => min,
    pick: <T,>(arr: readonly T[]): T => arr[0] as T,
    chance: () => chances[index++] ?? false,
    weighted: <T,>(items: readonly T[], weight: (t: T) => number): T =>
      items.reduce((best, item) => (weight(item) > weight(best) ? item : best), items[0] as T),
    normal: (mean: number) => mean,
  };
}

/**
 * `chance` scripted, `weighted` the engine's real one. `scriptRng`'s stand-in
 * just takes the heaviest item and never throws, so it cannot show what the
 * live `rng.weighted` does with a pool it refuses to draw from.
 */
function liveWeightedRng(state: GameState, chances: readonly boolean[]): Rng {
  return { ...scriptRng(chances), weighted: createRng(state).weighted };
}

function ctxOf(state: GameState, reg: ContentRegistry, rng?: Rng): Ctx {
  return { state, c: state.character, rng: rng ?? createRng(state), reg };
}

describe('eventsPhase eligibility', () => {
  it('draws nothing, and spends no randomness, when no event is eligible', () => {
    const state = newLife(1, 8);
    const reg = registryOf([event({ minAge: 30, maxAge: 60 })]);
    const before = state.rngState;

    expect(eventsPhase(ctxOf(state, reg))).toEqual([]);
    expect(state.rngState).toBe(before);
  });

  it('respects the age window at both ends', () => {
    const reg = registryOf([event({ id: 'teen-thing', minAge: 13, maxAge: 17 })]);
    const rng = scriptRng([true, false]);

    const tooYoung = newLife(2, 12);
    expect(eventsPhase(ctxOf(tooYoung, reg, rng))).toEqual([]);

    const tooOld = newLife(2, 18);
    expect(eventsPhase(ctxOf(tooOld, reg, rng))).toEqual([]);

    const inside = newLife(2, 13);
    expect(eventsPhase(ctxOf(inside, reg, scriptRng([true, false])))).toHaveLength(1);
  });

  it('skips events whose condition fails and events with no weight', () => {
    const state = newLife(3);
    const reg = registryOf([
      event({ id: 'blocked', condition: () => false }),
      event({ id: 'weightless', weight: 0 }),
    ]);

    expect(eventsPhase(ctxOf(state, reg, scriptRng([true, true])))).toEqual([]);
  });

  it('skips an event whose weight is not finite instead of throwing on the draw', () => {
    /* `Infinity > 0` is true, so a bare `> 0` gate lets the def into the pool;
       `rng.weighted` then rejects it as non-finite, finds no positive weight and
       throws. The gate has to mirror that predicate, like `canRollOutcome`. */
    const state = newLife(22);
    const reg = registryOf([event({ id: 'endless', weight: Number.POSITIVE_INFINITY })]);

    let entries: LogEntry[] = [{ icon: '!', kind: 'info', text: 'unset' }];
    expect(() => {
      entries = eventsPhase(ctxOf(state, reg, liveWeightedRng(state, [true, true])));
    }).not.toThrow();
    expect(entries).toEqual([]);
  });

  it('spends no randomness on a year whose only event has a non-finite weight', () => {
    // The empty-pool early return, which is what keeps the year draw-free.
    const state = newLife(23);
    const reg = registryOf([event({ id: 'endless', weight: Number.POSITIVE_INFINITY })]);
    const before = state.rngState;

    expect(eventsPhase(ctxOf(state, reg))).toEqual([]);
    expect(state.rngState).toBe(before);
  });

  it('draws the finite sibling and never the non-finite one, on either draw', () => {
    const state = newLife(24);
    const reg = registryOf([
      // `scriptRng` takes the heaviest, so an unfiltered Infinity would win here.
      event({ id: 'endless', weight: Number.POSITIVE_INFINITY, text: 'Never.' }),
      event({ id: 'ordinary', weight: 1, text: 'Ordinary.' }),
    ]);

    const entries = eventsPhase(ctxOf(state, reg, scriptRng([true, true])));

    expect(entries.map((e) => e.text)).toEqual(['Ordinary.']);
  });

  it('hands the condition a context pointing at the live character', () => {
    const state = newLife(4);
    state.character.money = 900;
    const reg = registryOf([event({ id: 'rich-only', condition: (ctx) => ctx.c.money > 500 })]);

    expect(eventsPhase(ctxOf(state, reg, scriptRng([true, false])))).toHaveLength(1);
  });
});

describe('eventsPhase instant events', () => {
  it('logs the resolved text and appends the entries its effects produce', () => {
    const state = newLife(5);
    const reg = registryOf([
      event({
        id: 'life-raise',
        icon: '💸',
        text: '{name} found money on the street.',
        effects: [
          { kind: 'money', delta: 250 },
          { kind: 'log', icon: '🎉', text: 'You treated yourself.', logKind: 'good' },
        ],
      }),
    ]);

    const entries = eventsPhase(ctxOf(state, reg, scriptRng([true, false])));

    expect(entries).toEqual([
      { icon: '💸', kind: 'info', text: 'Ada Moreno found money on the street.' },
      { icon: '🎉', kind: 'good', text: 'You treated yourself.' },
    ]);
    expect(state.character.money).toBe(250);
  });

  it('returns its entries instead of writing them into the log itself', () => {
    const state = newLife(6);
    const reg = registryOf([event()]);
    const before = state.log[state.log.length - 1]?.entries.length ?? 0;

    const entries = eventsPhase(ctxOf(state, reg, scriptRng([true, false])));

    expect(entries).toHaveLength(1);
    expect(state.log[state.log.length - 1]?.entries).toHaveLength(before);
  });

  it('resolves a text builder against the context', () => {
    const state = newLife(7, 41);
    const reg = registryOf([event({ text: (ctx) => `You turned ${ctx.c.age}.` })]);

    const entries = eventsPhase(ctxOf(state, reg, scriptRng([true, false])));

    expect(entries[0]?.text).toBe('You turned 41.');
  });

  it('draws a distinct second event when the second roll passes', () => {
    const state = newLife(8);
    const reg = registryOf([
      event({ id: 'heavy', weight: 10, text: 'Heavy.' }),
      event({ id: 'light', weight: 1, text: 'Light.' }),
    ]);

    const entries = eventsPhase(ctxOf(state, reg, scriptRng([true, true])));

    expect(entries.map((e) => e.text)).toEqual(['Heavy.', 'Light.']);
  });

  it('re-checks the second candidate against the state the first event left', () => {
    const state = newLife(8);
    state.character.money = 400;
    const reg = registryOf([
      event({ id: 'fine', weight: 10, text: 'A fine arrived.', effects: [{ kind: 'money', delta: -400 }] }),
      event({ id: 'splurge', text: 'You splurged.', condition: (ctx) => ctx.c.money >= 100 }),
    ]);

    const entries = eventsPhase(ctxOf(state, reg, scriptRng([true, true])));

    expect(entries.map((e) => e.text)).toEqual(['A fine arrived.']);
  });

  it('stops after the first event when the second roll fails', () => {
    const state = newLife(9);
    const reg = registryOf([event({ id: 'a', weight: 10, text: 'A.' }), event({ id: 'b', text: 'B.' })]);

    expect(eventsPhase(ctxOf(state, reg, scriptRng([true, false]))).map((e) => e.text)).toEqual(['A.']);
  });

  it('does not draw at all when the first roll fails', () => {
    const state = newLife(10);
    const reg = registryOf([event()]);

    expect(eventsPhase(ctxOf(state, reg, scriptRng([false, true])))).toEqual([]);
  });
});

describe('eventsPhase once-per-life', () => {
  it('records the id and never fires it again', () => {
    const state = newLife(11);
    const reg = registryOf([event({ id: 'first-kiss', oncePerLife: true })]);

    expect(eventsPhase(ctxOf(state, reg, scriptRng([true, false])))).toHaveLength(1);
    expect(state.firedEvents).toEqual(['first-kiss']);

    expect(eventsPhase(ctxOf(state, reg, scriptRng([true, false])))).toEqual([]);
    expect(state.firedEvents).toEqual(['first-kiss']);
  });

  it('leaves repeatable events out of firedEvents', () => {
    const state = newLife(12);
    const reg = registryOf([event({ id: 'rain' })]);

    eventsPhase(ctxOf(state, reg, scriptRng([true, false])));

    expect(state.firedEvents).toEqual([]);
  });
});

describe('eventsPhase choice events', () => {
  const choiceEvent = event({
    id: 'teen-party',
    icon: '🎉',
    text: 'A party is happening tonight.',
    choices: [
      { label: 'Go', outcomes: [{ weight: 1, text: 'You had a blast.', effects: [{ kind: 'stat', stat: 'happiness', delta: 5 }] }] },
      { label: 'Stay home', outcomes: [{ weight: 1, text: 'You stayed in.', effects: [] }] },
    ],
  });

  it('queues the card, flips the phase and logs nothing yet', () => {
    const state = newLife(13);
    const reg = registryOf([choiceEvent]);

    const entries = eventsPhase(ctxOf(state, reg, scriptRng([true, true])));

    expect(entries).toEqual([]);
    expect(state.phase).toBe('awaitingChoice');
    expect(state.pending).toEqual([
      {
        eventId: 'teen-party',
        text: 'A party is happening tonight.',
        icon: '🎉',
        choices: [{ label: 'Go' }, { label: 'Stay home' }],
      },
    ]);
  });

  it('blocks the second draw for the year', () => {
    const state = newLife(14);
    const reg = registryOf([
      { ...choiceEvent, weight: 10 },
      event({ id: 'filler', text: 'Filler.' }),
    ]);

    const entries = eventsPhase(ctxOf(state, reg, scriptRng([true, true, true])));

    expect(entries).toEqual([]);
    expect(state.pending).toHaveLength(1);
  });

  it('queues only the choices whose condition passes', () => {
    const state = newLife(15);
    state.character.money = 0;
    const reg = registryOf([
      event({
        id: 'adult-loan',
        choices: [
          { label: 'Pay up', condition: (ctx) => ctx.c.money >= 100, outcomes: [{ weight: 1, text: 'Paid.', effects: [] }] },
          { label: 'Walk away', outcomes: [{ weight: 1, text: 'You walked.', effects: [] }] },
        ],
      }),
    ]);

    eventsPhase(ctxOf(state, reg, scriptRng([true, false])));

    expect(state.pending[0]?.choices).toEqual([{ label: 'Walk away' }]);
  });

  it('degrades to an instant event when every choice is conditioned out', () => {
    const state = newLife(16);
    const reg = registryOf([
      event({
        id: 'adult-offer',
        text: 'Nobody offered you anything.',
        effects: [{ kind: 'stat', stat: 'happiness', delta: -2 }],
        choices: [{ label: 'Accept', condition: () => false, outcomes: [{ weight: 1, text: 'Done.', effects: [] }] }],
      }),
    ]);
    const before = state.character.stats.happiness;

    const entries = eventsPhase(ctxOf(state, reg, scriptRng([true, false])));

    expect(entries).toHaveLength(1);
    expect(entries[0]?.text).toBe('Nobody offered you anything.');
    expect(state.phase).toBe('alive');
    expect(state.pending).toEqual([]);
    expect(state.character.stats.happiness).toBe(before - 2);
  });

  it('feeds a queued card straight into resolveChoice', () => {
    const state = newLife(17);
    const reg = registryOf([choiceEvent]);
    eventsPhase(ctxOf(state, reg, scriptRng([true, false])));
    const before = state.character.stats.happiness;

    resolveChoice(state, reg, 0);

    expect(state.phase).toBe('alive');
    expect(state.pending).toEqual([]);
    expect(state.character.stats.happiness).toBe(before + 5);
    const entries = state.log[state.log.length - 1]?.entries ?? [];
    expect(entries[entries.length - 1]).toEqual({ icon: '🎉', kind: 'choice', text: 'You had a blast.' });
  });

  it('remaps the chosen index onto the surviving labels', () => {
    const state = newLife(18);
    state.character.money = 0;
    const reg = registryOf([
      event({
        id: 'adult-fork',
        choices: [
          { label: 'Bribe', condition: (ctx) => ctx.c.money >= 500, outcomes: [{ weight: 1, text: 'Bribed.', effects: [] }] },
          { label: 'Confess', outcomes: [{ weight: 1, text: 'Confessed.', effects: [] }] },
        ],
      }),
    ]);
    eventsPhase(ctxOf(state, reg, scriptRng([true, false])));

    resolveChoice(state, reg, 0);

    const entries = state.log[state.log.length - 1]?.entries ?? [];
    expect(entries[entries.length - 1]?.text).toBe('Confessed.');
  });
});

describe('eventsPhase death protocol', () => {
  it('marks the death, drops the rest of the effect list and stops drawing', () => {
    const state = newLife(19);
    const reg = registryOf([
      event({
        id: 'adult-crash',
        weight: 10,
        text: 'A truck ran the light.',
        effects: [
          { kind: 'death', cause: 'a car crash' },
          { kind: 'money', delta: 1000 },
        ],
      }),
      event({ id: 'filler', text: 'Filler.' }),
    ]);

    const entries = eventsPhase(ctxOf(state, reg, scriptRng([true, true])));

    expect(entries.map((e) => e.text)).toEqual(['A truck ran the light.']);
    expect(state.phase).toBe('dead');
    expect(state.character.flags.pendingDeathCause).toBe('a car crash');
    expect(state.character.money).toBe(0);
    // The obituary belongs to `killCharacter`, which `ageUp` calls afterwards.
    expect(state.death).toBeUndefined();
  });
});

describe('eventsPhase inside ageUp', () => {
  it('does not strand the year half-advanced on a non-finite event weight', () => {
    /* The throw escaped `ageUp` after `agingPhase` had already bumped age/year
       and pushed a fresh YearLog, leaving a state with no legal move — the same
       unrecoverable strand `resolveChoice` was hardened against. */
    const reg = registryOf([event({ id: 'endless', weight: Number.POSITIVE_INFINITY })]);
    const state = createLife(reg, { seed: 1, firstName: 'Ada', lastName: 'Moreno' });

    expect(() => {
      for (let year = 0; year < 20; year += 1) ageUp(state, reg);
    }).not.toThrow();
    expect(state.character.age).toBe(20);
    expect(state.phase).toBe('alive');
    expect(state.log).toHaveLength(21);
  });
});

describe('eventsPhase with the real rng', () => {
  it('fires on roughly 85% of years and stays reproducible', () => {
    const reg = registryOf([event({ id: 'a', text: 'A.' }), event({ id: 'b', text: 'B.' })]);

    const run = (seed: number): number => {
      const state = newLife(seed);
      let fired = 0;
      for (let year = 0; year < 200; year += 1) {
        fired += eventsPhase(ctxOf(state, reg)).length;
      }
      return fired;
    };

    const fired = run(21);
    // 200 years * (0.85 + 0.85*0.4) events; a wide band keeps this a smoke test.
    expect(fired).toBeGreaterThan(180);
    expect(fired).toBeLessThan(280);
    expect(run(21)).toBe(fired);
  });
});
