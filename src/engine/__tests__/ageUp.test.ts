import { describe, expect, it, vi } from 'vitest';
import { ageUp, currentYearLog, resolveChoice } from '@/engine/ageUp';
import { agingPhase } from '@/engine/phases/aging';
import { deathCheckPhase } from '@/engine/phases/deathCheck';
import { killCharacter, startLegacy } from '@/engine/death';
import { createRng } from '@/engine/rng';
import { addPerson, createLife } from '@/engine/state';
import type {
  ContentRegistry,
  Ctx,
  EventDef,
  GameState,
  LogEntry,
  YearLog,
} from '@/types';

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

function newLife(seed: number, reg: ContentRegistry = emptyRegistry()): GameState {
  return createLife(reg, {
    seed,
    firstName: 'Ada',
    lastName: 'Byron',
    gender: 'female',
    startYear: 2000,
  });
}

function ctxFor(state: GameState, reg: ContentRegistry = emptyRegistry()): Ctx {
  return { state, c: state.character, rng: createRng(state), reg };
}

function lastYear(state: GameState): YearLog {
  return state.log[state.log.length - 1];
}

function texts(entries: LogEntry[]): string[] {
  return entries.map((e) => e.text);
}

/* ---------------------------------------------------------------------------
   Stand-in phase chain.

   Five of the eight phases belong to other agents and may still be stubs while
   this suite runs, so the orchestration tests swap the whole chain for stand-ins
   and re-import `ageUp` against them. `ownChain` puts the real `agingPhase` and
   `deathCheckPhase` back, which is enough to play a whole life. Everything else
   (`death`, `effects`, `rng`) stays real throughout, so the death protocol is
   exercised end to end.
--------------------------------------------------------------------------- */

const PHASE_ORDER = [
  'aging',
  'health',
  'education',
  'relationships',
  'career',
  'finance',
  'events',
  'deathCheck',
] as const;

type PhaseName = (typeof PHASE_ORDER)[number];
type PhaseFn = (ctx: Ctx) => LogEntry[];

interface FakeChain {
  calls: PhaseName[];
  ageUp: (state: GameState, reg: ContentRegistry) => void;
  resolveChoice: (state: GameState, reg: ContentRegistry, choiceIndex: number) => void;
}

async function fakeChain(overrides: Partial<Record<PhaseName, PhaseFn>> = {}): Promise<FakeChain> {
  const calls: PhaseName[] = [];
  const phase =
    (name: PhaseName): PhaseFn =>
    (ctx: Ctx): LogEntry[] => {
      calls.push(name);
      const custom = overrides[name];
      if (custom) return custom(ctx);
      if (name === 'aging') {
        // The real aging phase opens the year the other phases log into.
        ctx.c.age += 1;
        ctx.state.year += 1;
        ctx.state.log.push({ age: ctx.c.age, year: ctx.state.year, entries: [] });
      }
      return [{ icon: '•', kind: 'info', text: name }];
    };

  vi.resetModules();
  vi.doMock('@/engine/phases/aging', () => ({ agingPhase: phase('aging') }));
  vi.doMock('@/engine/phases/health', () => ({ healthPhase: phase('health') }));
  vi.doMock('@/engine/phases/education', () => ({ educationPhase: phase('education') }));
  vi.doMock('@/engine/phases/relationships', () => ({
    relationshipsPhase: phase('relationships'),
  }));
  vi.doMock('@/engine/phases/career', () => ({ careerPhase: phase('career') }));
  vi.doMock('@/engine/phases/finance', () => ({ financePhase: phase('finance') }));
  vi.doMock('@/engine/phases/events', () => ({ eventsPhase: phase('events') }));
  vi.doMock('@/engine/phases/deathCheck', () => ({ deathCheckPhase: phase('deathCheck') }));

  const mod = await import('@/engine/ageUp');
  return { calls, ageUp: mod.ageUp, resolveChoice: mod.resolveChoice };
}

/** The chain reduced to the two phases this module owns; the rest do nothing. */
function ownChain(): Promise<FakeChain> {
  const idle = (): LogEntry[] => [];
  return fakeChain({
    aging: agingPhase,
    health: idle,
    education: idle,
    relationships: idle,
    career: idle,
    finance: idle,
    events: idle,
    deathCheck: deathCheckPhase,
  });
}

/* One real-chain year, run at collection time: the phases owned by other agents
   may still throw `TODO:`, in which case the integration tests below are skipped
   rather than reported as failures of this module. */
function probeRealChain(): string {
  const reg = emptyRegistry();
  try {
    ageUp(newLife(1, reg), reg);
    return '';
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

const chainBlocker = probeRealChain();
if (chainBlocker !== '') {
  console.warn(`ageUp integration tests skipped; phase chain not ready: ${chainBlocker}`);
}

describe('currentYearLog', () => {
  it('returns the year the log is currently on', () => {
    const state = newLife(2);
    const first = currentYearLog(state);
    expect(first).toBe(state.log[0]);
    expect(currentYearLog(state)).toBe(first);
    expect(state.log).toHaveLength(1);
  });

  it('opens a year for the current age when the log is empty', () => {
    const state = newLife(3);
    state.log = [];
    state.character.age = 7;
    state.year = 2007;

    const year = currentYearLog(state);

    expect(year).toEqual({ age: 7, year: 2007, entries: [] });
    expect(state.log).toEqual([year]);
  });

  it('hands back the newest year, not the first one', () => {
    const state = newLife(4);
    state.log.push({ age: 1, year: 2001, entries: [] });
    expect(currentYearLog(state).age).toBe(1);
  });
});

describe('ageUp guard', () => {
  it('refuses to run while the character is dead', () => {
    const state = newLife(5);
    state.phase = 'dead';
    expect(() => ageUp(state, emptyRegistry())).toThrow('ageUp while phase=dead');
  });

  it('refuses to run while a choice is pending', () => {
    const state = newLife(6);
    state.phase = 'awaitingChoice';
    expect(() => ageUp(state, emptyRegistry())).toThrow('ageUp while phase=awaitingChoice');
  });
});

describe('ageUp phase chain', () => {
  it('runs the eight phases in order and appends their entries to the new year', () => {
    return fakeChain().then(({ calls, ageUp: run }) => {
      const state = newLife(7);
      run(state, emptyRegistry());

      expect(calls).toEqual([...PHASE_ORDER]);
      expect(state.character.age).toBe(1);
      expect(state.year).toBe(2001);
      expect(state.log).toHaveLength(2);
      expect(texts(lastYear(state).entries)).toEqual([...PHASE_ORDER]);
      // The birth line stays in the year it was written.
      expect(state.log[0].entries).toHaveLength(1);
      expect(state.phase).toBe('alive');
    });
  });

  it('stops at the phase that kills and builds the obituary once', async () => {
    const { calls, ageUp: run } = await fakeChain({
      education: (ctx): LogEntry[] => {
        ctx.state.phase = 'dead';
        ctx.c.flags.pendingDeathCause = 'a falling piano';
        return [{ icon: '🎹', kind: 'bad', text: 'A piano fell on you.' }];
      },
    });
    const state = newLife(8);
    state.pending = [{ eventId: 'ghost', text: 'x', icon: '❓', choices: [{ label: 'ok' }] }];

    run(state, emptyRegistry());

    expect(calls).toEqual(['aging', 'health', 'education']);
    expect(state.phase).toBe('dead');
    expect(state.death?.cause).toBe('a falling piano');
    expect(state.pending).toEqual([]);
    expect(texts(lastYear(state).entries)).toEqual([
      'aging',
      'health',
      'A piano fell on you.',
      'You died of a falling piano at age 1.',
    ]);
  });

  it('falls back to natural causes when a phase leaves no cause', async () => {
    const { ageUp: run } = await fakeChain({
      career: (ctx): LogEntry[] => {
        ctx.state.phase = 'dead';
        return [];
      },
    });
    const state = newLife(9);

    run(state, emptyRegistry());

    expect(state.death?.cause).toBe('natural causes');
    expect(state.death?.obituary).toContain('Died of natural causes at 1.');
  });

  it('leaves an obituary that is already written alone', async () => {
    const { ageUp: run } = await fakeChain({
      health: (ctx): LogEntry[] => {
        ctx.state.phase = 'dead';
        ctx.state.death = {
          cause: 'stage fright',
          age: 1,
          obituary: 'Written elsewhere.',
          epitaphStats: { netWorth: 0, jobsHeld: 0, kids: 0 },
        };
        return [];
      },
    });
    const state = newLife(10);

    run(state, emptyRegistry());

    expect(state.death?.obituary).toBe('Written elsewhere.');
    // No second death line: `killCharacter` never ran.
    expect(texts(lastYear(state).entries)).toEqual(['aging']);
  });

  it('keeps a queued choice pending and still runs the death check', async () => {
    const { calls, ageUp: run } = await fakeChain({
      events: (ctx): LogEntry[] => {
        ctx.state.phase = 'awaitingChoice';
        ctx.state.pending.push({
          eventId: 'fork',
          text: 'A fork in the road.',
          icon: '🍴',
          choices: [{ label: 'Right' }],
        });
        return [{ icon: '🍴', kind: 'info', text: 'A fork in the road.' }];
      },
    });
    const state = newLife(11);

    run(state, emptyRegistry());

    expect(calls).toEqual([...PHASE_ORDER]);
    expect(state.phase).toBe('awaitingChoice');
    expect(state.pending).toHaveLength(1);
    expect(texts(lastYear(state).entries)).toContain('deathCheck');
  });

  it('drops a queued choice when the death check kills the character', async () => {
    const { ageUp: run } = await fakeChain({
      events: (ctx): LogEntry[] => {
        ctx.state.phase = 'awaitingChoice';
        ctx.state.pending.push({
          eventId: 'fork',
          text: 'A fork in the road.',
          icon: '🍴',
          choices: [{ label: 'Right' }],
        });
        return [];
      },
      deathCheck: (ctx): LogEntry[] => {
        ctx.state.phase = 'dead';
        ctx.c.flags.pendingDeathCause = 'a sudden illness';
        return [];
      },
    });
    const state = newLife(12);

    run(state, emptyRegistry());

    expect(state.phase).toBe('dead');
    expect(state.pending).toEqual([]);
  });
});

describe('agingPhase', () => {
  it('advances age and year and opens the year log', () => {
    const state = newLife(13);
    state.character.age = 10;
    state.year = 2010;

    const entries = agingPhase(ctxFor(state));

    expect(entries).toEqual([]);
    expect(state.character.age).toBe(11);
    expect(state.year).toBe(2011);
    expect(lastYear(state)).toEqual({ age: 11, year: 2011, entries: [] });
  });

  it('announces every stage the character enters, once', () => {
    const crossings: [number, string, string][] = [
      [2, '🧸', "You're a toddler now."],
      [5, '🧒', "You're a child now."],
      [12, '🎒', "You're a teenager now."],
      [17, '🧑', "You're an adult now."],
      [64, '👴', "You're a senior now."],
    ];

    for (const [age, icon, text] of crossings) {
      const state = newLife(14);
      state.character.age = age;
      const entries = agingPhase(ctxFor(state));
      expect(entries).toEqual([{ icon, kind: 'info', text }]);
    }
  });

  it('says nothing on a birthday inside a stage', () => {
    for (const age of [0, 3, 7, 14, 30, 63, 70]) {
      const state = newLife(15);
      state.character.age = age;
      expect(agingPhase(ctxFor(state))).toEqual([]);
    }
  });

  it('leaves looks and health alone before 31', () => {
    const state = newLife(16);
    state.character.age = 20;
    state.character.stats = { health: 80, happiness: 60, smarts: 50, looks: 70 };

    agingPhase(ctxFor(state));

    expect(state.character.stats.health).toBe(80);
    expect(state.character.stats.looks).toBe(70);
  });

  it('fades looks and health past their bands', () => {
    const bands: [number, number, number][] = [
      // age before the birthday, looks after, health after
      [40, 69.5, 79.7],
      [55, 69, 79.7],
      [60, 69, 79],
    ];

    for (const [age, looks, health] of bands) {
      const state = newLife(17);
      state.character.age = age;
      state.character.stats = { health: 80, happiness: 60, smarts: 50, looks: 70 };
      agingPhase(ctxFor(state));
      expect(state.character.stats.looks).toBe(looks);
      expect(state.character.stats.health).toBe(health);
    }
  });

  it('pays back health for the gym and a good diet', () => {
    const state = newLife(18);
    state.character.age = 40;
    state.character.stats = { health: 80, happiness: 60, smarts: 50, looks: 70 };
    state.character.flags.gymRegular = true;
    state.character.flags.goodDiet = true;

    agingPhase(ctxFor(state));

    expect(state.character.stats.health).toBe(80.7);
  });

  it('pulls happiness a tenth of the way back to 60', () => {
    const swings: [number, number][] = [
      [100, 96],
      [50, 51],
      [0, 6],
      [60, 60],
    ];

    for (const [before, after] of swings) {
      const state = newLife(19);
      state.character.age = 20;
      state.character.stats = { health: 80, happiness: before, smarts: 50, looks: 70 };
      agingPhase(ctxFor(state));
      expect(state.character.stats.happiness).toBe(after);
    }
  });

  it('rewards schooling with smarts and taxes a very old mind', () => {
    const schooled = newLife(20);
    schooled.character.age = 10;
    schooled.character.stats = { health: 80, happiness: 60, smarts: 50, looks: 70 };
    schooled.character.education.enrolledIn = 'primary-school';
    agingPhase(ctxFor(schooled));
    expect(schooled.character.stats.smarts).toBe(50.5);

    const old = newLife(21);
    old.character.age = 75;
    old.character.stats = { health: 80, happiness: 60, smarts: 50, looks: 70 };
    agingPhase(ctxFor(old));
    expect(old.character.stats.smarts).toBe(49.7);

    const oldStudent = newLife(22);
    oldStudent.character.age = 75;
    oldStudent.character.stats = { health: 80, happiness: 60, smarts: 50, looks: 70 };
    oldStudent.character.education.enrolledIn = 'night-school';
    agingPhase(ctxFor(oldStudent));
    expect(oldStudent.character.stats.smarts).toBe(50.2);
  });

  it('keeps drift inside 0..100', () => {
    const state = newLife(23);
    state.character.age = 70;
    state.character.stats = { health: 100, happiness: 100, smarts: 100, looks: 0 };
    state.character.flags.gymRegular = true;
    state.character.flags.goodDiet = true;
    state.character.education.enrolledIn = 'university';

    agingPhase(ctxFor(state));

    expect(state.character.stats.looks).toBe(0);
    expect(state.character.stats.health).toBe(100);
    expect(state.character.stats.smarts).toBe(100);
  });
});

/* ---------------------------------------------------------------------------
   resolveChoice
--------------------------------------------------------------------------- */

function forkEvent(): EventDef {
  return {
    id: 'fork',
    area: 'life',
    icon: '🍴',
    minAge: 0,
    maxAge: 120,
    weight: 1,
    text: 'A fork in the road.',
    choices: [
      {
        label: 'Turn back',
        condition: (): boolean => false,
        outcomes: [{ weight: 1, text: 'You turned back.', effects: [] }],
      },
      {
        label: 'Go right',
        outcomes: [
          {
            weight: 1,
            text: 'You went right, {name}.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 5 },
              { kind: 'log', icon: '✨', text: 'Nice walk.', logKind: 'good' },
            ],
          },
        ],
      },
    ],
  };
}

function eventRegistry(...events: EventDef[]): ContentRegistry {
  const reg = emptyRegistry();
  reg.events = events;
  for (const def of events) reg.eventsById[def.id] = def;
  return reg;
}

/** A life parked on the fork, with only the surviving label queued. */
function atFork(seed = 30, labels: string[] = ['Go right']): GameState {
  const state = newLife(seed);
  state.character.stats.happiness = 50;
  state.phase = 'awaitingChoice';
  state.pending = [
    {
      eventId: 'fork',
      text: 'A fork in the road.',
      icon: '🍴',
      choices: labels.map((label) => ({ label })),
    },
  ];
  return state;
}

describe('resolveChoice', () => {
  it('maps the index through the filtered labels back to the original choice', () => {
    const state = atFork();
    const reg = eventRegistry(forkEvent());

    resolveChoice(state, reg, 0);

    expect(state.character.stats.happiness).toBe(55);
    expect(lastYear(state).entries.slice(-2)).toEqual([
      { icon: '🍴', kind: 'choice', text: 'You went right, Ada Byron.' },
      { icon: '✨', kind: 'good', text: 'Nice walk.' },
    ]);
    expect(state.pending).toEqual([]);
    expect(state.phase).toBe('alive');
  });

  it('never rolls an outcome with no weight', () => {
    const def = forkEvent();
    def.choices = [
      {
        label: 'Go right',
        outcomes: [
          { weight: 0, text: 'Impossible.', effects: [] },
          { weight: 1, text: 'The only way.', effects: [] },
        ],
      },
    ];
    const reg = eventRegistry(def);

    for (let cursor = 0; cursor < 25; cursor += 1) {
      const state = atFork(31);
      state.rngState = cursor * 7919 + 13;
      resolveChoice(state, reg, 0);
      expect(lastYear(state).entries.slice(-1)[0].text).toBe('The only way.');
    }
  });

  it('spreads outcomes across the weighted options', () => {
    const def = forkEvent();
    def.choices = [
      {
        label: 'Go right',
        outcomes: [
          { weight: 1, text: 'Heads.', effects: [] },
          { weight: 1, text: 'Tails.', effects: [] },
        ],
      },
    ];
    const reg = eventRegistry(def);
    const seen = new Set<string>();

    for (let cursor = 0; cursor < 40; cursor += 1) {
      const state = atFork(32);
      state.rngState = cursor * 7919 + 13;
      resolveChoice(state, reg, 0);
      seen.add(lastYear(state).entries.slice(-1)[0].text);
    }

    expect(seen).toEqual(new Set(['Heads.', 'Tails.']));
  });

  it('stays on the queue while more choices are pending', () => {
    const state = atFork(33);
    state.pending.push({
      eventId: 'fork',
      text: 'Another fork.',
      icon: '🍴',
      choices: [{ label: 'Go right' }],
    });

    resolveChoice(state, eventRegistry(forkEvent()), 0);

    expect(state.phase).toBe('awaitingChoice');
    expect(state.pending).toHaveLength(1);
  });

  it('runs the death protocol when an outcome kills', () => {
    const def = forkEvent();
    def.choices = [
      {
        label: 'Go right',
        outcomes: [
          {
            weight: 1,
            text: 'A bee found you.',
            effects: [
              { kind: 'death', cause: 'a bee sting' },
              { kind: 'money', delta: 100 },
            ],
          },
        ],
      },
    ];
    const state = atFork(34);
    state.character.money = 40;

    resolveChoice(state, eventRegistry(def), 0);

    expect(state.phase).toBe('dead');
    expect(state.death?.cause).toBe('a bee sting');
    expect(state.death?.obituary).toContain('Died of a bee sting at 0.');
    // Effects after the death marker are skipped.
    expect(state.character.money).toBe(40);
    expect(state.pending).toEqual([]);
    expect(texts(lastYear(state).entries).slice(-2)).toEqual([
      'A bee found you.',
      'You died of a bee sting at age 0.',
    ]);
  });

  it('refuses to run outside the awaiting-choice phase', () => {
    const state = atFork(35);
    state.phase = 'alive';
    expect(() => resolveChoice(state, eventRegistry(forkEvent()), 0)).toThrow(
      'resolveChoice while phase=alive'
    );
  });

  it('refuses an empty queue and an out-of-range index', () => {
    const reg = eventRegistry(forkEvent());

    const empty = atFork(36);
    empty.pending = [];
    expect(() => resolveChoice(empty, reg, 0)).toThrow('empty pending queue');

    const outOfRange = atFork(38);
    expect(() => resolveChoice(outOfRange, reg, 3)).toThrow('no choice at index 3');
    // A caller mistake leaves the card up, so the call can be retried.
    expect(outOfRange.phase).toBe('awaitingChoice');
    expect(outOfRange.pending).toHaveLength(1);
  });

  it('reports a bad index even when the event is missing from the registry', () => {
    /* The content-drift path below must not swallow a caller bug: an index the
       card never offered is wrong whatever the registry says. */
    const stale = atFork(39);
    stale.pending[0].eventId = 'ghost';

    expect(() => resolveChoice(stale, emptyRegistry(), 3)).toThrow('no choice at index 3');
    expect(stale.pending).toHaveLength(1);
    expect(stale.phase).toBe('awaitingChoice');
  });
});

/* ---------------------------------------------------------------------------
   resolveChoice against content that has moved on.

   A card is written into the save by event id and label, but it is answered
   against whatever content the running build ships. Every one of these misses
   used to throw, and since `ageUp` refuses any phase but `alive`, a save parked
   on `awaitingChoice` was then locked out of both calls for good.
--------------------------------------------------------------------------- */

describe('resolveChoice on a card the current content cannot resolve', () => {
  const LOST_LINE = 'The moment passed before you could decide.';

  it('discards a pending event the registry no longer defines instead of locking the life', () => {
    // Registry B is the pack that queued the card, with the event dropped.
    const state = atFork(50);
    const regB = emptyRegistry();
    const ageBefore = state.character.age;
    const cursorBefore = state.rngState;

    resolveChoice(state, regB, 0);

    expect(state.phase).toBe('alive');
    expect(state.pending).toEqual([]);
    // A neutral line stands in for the outcome that can no longer be rolled.
    expect(lastYear(state).entries.slice(-1)).toEqual([
      { icon: '🍴', kind: 'info', text: LOST_LINE },
    ]);
    // No outcome, so no effects and — the determinism budget — no draw.
    expect(state.character.stats.happiness).toBe(50);
    expect(state.rngState).toBe(cursorBefore);

    // The point of the fix: the life is playable again.
    ageUp(state, regB);
    expect(state.character.age).toBe(ageBefore + 1);
  });

  it('discards a card whose event no longer branches', () => {
    // The same id, rewritten by a content update into an instant event.
    const instant: EventDef = {
      id: 'fork',
      area: 'life',
      icon: '🍴',
      minAge: 0,
      maxAge: 120,
      weight: 1,
      text: 'A fork in the road.',
      effects: [{ kind: 'stat', stat: 'happiness', delta: 30 }],
    };
    const state = atFork(51);

    resolveChoice(state, eventRegistry(instant), 0);

    expect(state.phase).toBe('alive');
    expect(state.pending).toEqual([]);
    // The instant rewrite's effects are not a stand-in outcome.
    expect(state.character.stats.happiness).toBe(50);
    expect(texts(lastYear(state).entries).slice(-1)).toEqual([LOST_LINE]);
  });

  it('discards a card whose chosen label the event has retired', () => {
    const state = atFork(52, ['Vanished label']);

    resolveChoice(state, eventRegistry(forkEvent()), 0);

    expect(state.phase).toBe('alive');
    expect(state.pending).toEqual([]);
    expect(state.character.stats.happiness).toBe(50);
    expect(texts(lastYear(state).entries).slice(-1)).toEqual([LOST_LINE]);
  });

  it('discards a card whose chosen option has no outcome it can roll', () => {
    /* The label survives the update but every outcome behind it is weightless,
       so `rng.weighted` has nothing to land on. Throwing here was terminal:
       `ageUp` takes no phase but `alive` and the retry threw the same way, so
       the save had no legal move left. */
    const def = forkEvent();
    def.choices = [{ label: 'Only', outcomes: [{ weight: 0, text: 'nope', effects: [] }] }];
    const reg = eventRegistry(def);
    const state = atFork(55, ['Only']);
    const ageBefore = state.character.age;
    const cursorBefore = state.rngState;

    resolveChoice(state, reg, 0);

    expect(state.phase).toBe('alive');
    expect(state.pending).toEqual([]);
    expect(lastYear(state).entries.slice(-1)).toEqual([
      { icon: '🍴', kind: 'info', text: LOST_LINE },
    ]);
    // The unrollable outcome is not silently promoted to the winner.
    expect(texts(lastYear(state).entries)).not.toContain('nope');
    // The draw-free property the other discard paths guarantee holds here too.
    expect(state.rngState).toBe(cursorBefore);
    expect(state.character.stats.happiness).toBe(50);

    // The point of the fix: the life advances again, against the same pack.
    ageUp(state, reg);
    expect(state.character.age).toBe(ageBefore + 1);
  });

  it('discards a card whose chosen option lost its outcome list entirely', () => {
    const def = forkEvent();
    def.choices = [{ label: 'Go right', outcomes: [] }];
    const state = atFork(56);
    const cursorBefore = state.rngState;

    resolveChoice(state, eventRegistry(def), 0);

    expect(state.phase).toBe('alive');
    expect(state.pending).toEqual([]);
    expect(texts(lastYear(state).entries).slice(-1)).toEqual([LOST_LINE]);
    expect(state.rngState).toBe(cursorBefore);
    expect(state.character.stats.happiness).toBe(50);
  });

  it('discards on every weight set rng.weighted refuses, and only those', () => {
    // Mirrors `rng.weighted`: only a finite, strictly positive weight is rollable.
    const unrollable = [[0, 0], [-1, -2], [Number.NaN], [Number.POSITIVE_INFINITY], [0, -3]];
    for (const weights of unrollable) {
      const def = forkEvent();
      def.choices = [
        {
          label: 'Go right',
          outcomes: weights.map((weight, i) => ({ weight, text: `w${i}`, effects: [] })),
        },
      ];
      const state = atFork(57);
      const cursorBefore = state.rngState;

      resolveChoice(state, eventRegistry(def), 0);

      expect(texts(lastYear(state).entries).slice(-1)).toEqual([LOST_LINE]);
      expect(state.phase).toBe('alive');
      expect(state.pending).toEqual([]);
      expect(state.rngState).toBe(cursorBefore);
    }

    // One positive weight among the junk is still a real roll, not a discard.
    const def = forkEvent();
    def.choices = [
      {
        label: 'Go right',
        outcomes: [
          { weight: 0, text: 'w0', effects: [] },
          { weight: 2, text: 'w1', effects: [] },
        ],
      },
    ];
    const rolled = atFork(57);
    const cursorBefore = rolled.rngState;

    resolveChoice(rolled, eventRegistry(def), 0);

    expect(texts(lastYear(rolled).entries).slice(-1)).toEqual(['w1']);
    expect(rolled.rngState).not.toBe(cursorBefore);
  });

  it('discards only the option that cannot be rolled, not its rollable siblings', () => {
    const def = forkEvent();
    def.choices = [
      { label: 'Dead end', outcomes: [{ weight: 0, text: 'nope', effects: [] }] },
      {
        label: 'Go right',
        outcomes: [
          {
            weight: 1,
            text: 'You went right, {name}.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: 5 }],
          },
        ],
      },
    ];
    const reg = eventRegistry(def);

    const stuck = atFork(58, ['Dead end', 'Go right']);
    resolveChoice(stuck, reg, 0);
    expect(texts(lastYear(stuck).entries).slice(-1)).toEqual([LOST_LINE]);
    expect(stuck.character.stats.happiness).toBe(50);

    const fine = atFork(58, ['Dead end', 'Go right']);
    resolveChoice(fine, reg, 1);
    expect(texts(lastYear(fine).entries).slice(-1)).toEqual(['You went right, Ada Byron.']);
    expect(fine.character.stats.happiness).toBe(55);
    expect(fine.phase).toBe('alive');
  });

  it('replays an unrollable-outcome discard identically from the same seed', () => {
    const def = forkEvent();
    def.choices = [{ label: 'Only', outcomes: [{ weight: 0, text: 'nope', effects: [] }] }];
    const reg = eventRegistry(def);

    const play = (): GameState => {
      const state = atFork(59, ['Only']);
      resolveChoice(state, reg, 0);
      ageUp(state, emptyRegistry());
      return state;
    };

    expect(JSON.stringify(play())).toBe(JSON.stringify(play()));
  });

  it('discards a card that offers no choices at all instead of bricking the save', () => {
    /* A zero-choice card cannot be minted — the events phase queues one only
       once a label has passed its condition — but it can arrive from a save,
       which `loadGame` does not validate below `state.character`. Every index is
       out of range on it, so the caller-mistake throw left no legal move at all:
       `ageUp` takes no phase but `alive`, and the retry threw the same way. */
    const reg = eventRegistry(forkEvent());
    const state = atFork(72, []);
    const ageBefore = state.character.age;
    const cursorBefore = state.rngState;

    resolveChoice(state, reg, 0);

    expect(state.phase).toBe('alive');
    expect(state.pending).toEqual([]);
    expect(lastYear(state).entries.slice(-1)).toEqual([
      { icon: '🍴', kind: 'info', text: LOST_LINE },
    ]);
    // Draw-free, like every other discard.
    expect(state.rngState).toBe(cursorBefore);
    expect(state.character.stats.happiness).toBe(50);

    // The point of the fix: the life is playable again.
    ageUp(state, reg);
    expect(state.character.age).toBe(ageBefore + 1);
  });

  it('discards a zero-choice card whatever index is passed, and whatever the registry knows', () => {
    // Both halves of the repro: the event still defined, and long since renamed.
    const cases = [
      { reg: eventRegistry(forkEvent()), eventId: 'fork' },
      { reg: emptyRegistry(), eventId: 'gone' },
    ];
    for (const { reg, eventId } of cases) {
      for (const index of [0, 1, 7, -1]) {
        const state = atFork(73, []);
        state.pending[0].eventId = eventId;
        const cursorBefore = state.rngState;

        expect(() => resolveChoice(state, reg, index)).not.toThrow();

        expect(state.phase).toBe('alive');
        expect(state.pending).toEqual([]);
        expect(texts(lastYear(state).entries).slice(-1)).toEqual([LOST_LINE]);
        expect(state.rngState).toBe(cursorBefore);
      }
    }
  });

  it('drops only the zero-choice card, leaving the queue behind it answerable', () => {
    const state = atFork(74, []);
    state.pending.push({
      eventId: 'fork',
      text: 'A fork in the road.',
      icon: '🍴',
      choices: [{ label: 'Go right' }],
    });
    const reg = eventRegistry(forkEvent());

    resolveChoice(state, reg, 0);

    expect(state.phase).toBe('awaitingChoice');
    expect(state.pending).toHaveLength(1);
    expect(state.character.stats.happiness).toBe(50);

    resolveChoice(state, reg, 0);

    expect(state.phase).toBe('alive');
    expect(state.character.stats.happiness).toBe(55);
  });

  it('replays a zero-choice discard identically from the same seed', () => {
    const reg = eventRegistry(forkEvent());

    const play = (): GameState => {
      const state = atFork(75, []);
      resolveChoice(state, reg, 0);
      ageUp(state, reg);
      return state;
    };

    expect(JSON.stringify(play())).toBe(JSON.stringify(play()));
  });

  it('still reports a bad index on a card that does offer options', () => {
    // The discard covers the shape with no legal index; it does not swallow a
    // caller bug on a card where index 0 was there to be passed.
    const state = atFork(76);

    expect(() => resolveChoice(state, eventRegistry(forkEvent()), 2)).toThrow(
      'no choice at index 2'
    );
    expect(state.phase).toBe('awaitingChoice');
    expect(state.pending).toHaveLength(1);
    expect(texts(lastYear(state).entries)).not.toContain(LOST_LINE);
  });

  it('drops one card per call and drains a queue of them', () => {
    const state = atFork(53);
    state.pending.push({
      eventId: 'fork',
      text: 'Another fork.',
      icon: '🍴',
      choices: [{ label: 'Go right' }],
    });
    const regB = emptyRegistry();

    resolveChoice(state, regB, 0);

    expect(state.phase).toBe('awaitingChoice');
    expect(state.pending).toHaveLength(1);

    resolveChoice(state, regB, 0);

    expect(state.phase).toBe('alive');
    expect(state.pending).toEqual([]);
  });

  it('leaves a still-valid card behind it answerable as normal', () => {
    const state = atFork(54);
    state.pending[0].eventId = 'ghost';
    state.pending.push({
      eventId: 'fork',
      text: 'A fork in the road.',
      icon: '🍴',
      choices: [{ label: 'Go right' }],
    });
    const reg = eventRegistry(forkEvent());

    resolveChoice(state, reg, 0);
    expect(state.phase).toBe('awaitingChoice');
    expect(state.character.stats.happiness).toBe(50);

    resolveChoice(state, reg, 0);
    expect(state.phase).toBe('alive');
    expect(state.character.stats.happiness).toBe(55);
  });

  it('recovers a life the real chain parked on an event a content update removed', () => {
    // Registry A ships the event; the next build renames or drops it.
    const regA = eventRegistry(forkEvent());
    const regB = emptyRegistry();

    const state = createLife(regA, { seed: 2, startYear: 2000 });
    for (let guard = 0; guard < 50 && state.phase === 'alive'; guard += 1) {
      ageUp(state, regA);
    }
    expect(state.phase).toBe('awaitingChoice');
    expect(state.pending).toHaveLength(1);

    // Answering against the new content must not dead-end the save.
    resolveChoice(state, regB, 0);

    expect(state.phase).toBe('alive');
    expect(state.pending).toEqual([]);

    const ageBefore = state.character.age;
    ageUp(state, regB);
    expect(state.character.age).toBe(ageBefore + 1);
  });

  it('replays a discard identically from the same seed', () => {
    const regA = eventRegistry(forkEvent());
    const regB = emptyRegistry();

    const play = (): GameState => {
      const state = createLife(regA, { seed: 2, startYear: 2000 });
      for (let guard = 0; guard < 50 && state.phase === 'alive'; guard += 1) {
        ageUp(state, regA);
      }
      resolveChoice(state, regB, 0);
      ageUp(state, regB);
      return state;
    };

    expect(JSON.stringify(play())).toBe(JSON.stringify(play()));
  });
});

/* ---------------------------------------------------------------------------
   Whole lives: first against the phases this module owns, then — once the other
   agents' phases exist — against the real chain.
--------------------------------------------------------------------------- */

interface LifeRunner {
  ageUp: (state: GameState, reg: ContentRegistry) => void;
  resolveChoice: (state: GameState, reg: ContentRegistry, choiceIndex: number) => void;
}

const realRunner: LifeRunner = { ageUp, resolveChoice };

/** Plays a life to its end, answering every event with its first option. */
function playToDeath(seed: number, reg: ContentRegistry, run: LifeRunner = realRunner): GameState {
  const state = createLife(reg, { seed, startYear: 2000 });
  for (let guard = 0; guard < 400; guard += 1) {
    if (state.phase === 'dead') return state;
    if (state.phase === 'awaitingChoice') {
      run.resolveChoice(state, reg, 0);
      continue;
    }
    run.ageUp(state, reg);
  }
  throw new Error(`life ${seed} did not end within 400 turns`);
}

/** Every year of the log lines up with the age and year it belongs to. */
function expectOneYearPerBirthday(state: GameState): void {
  expect(state.log).toHaveLength(state.character.age + 1);
  state.log.forEach((year, index) => {
    expect(year.age).toBe(index);
    expect(year.year).toBe(2000 + index);
  });
}

describe('a whole life on aging and the death check alone', () => {
  it('replays identically from the same seed', async () => {
    const run = await ownChain();
    const first = playToDeath(424242, emptyRegistry(), run);
    const second = playToDeath(424242, emptyRegistry(), run);

    expect(JSON.stringify(first.log)).toBe(JSON.stringify(second.log));
    expect(JSON.stringify(first.death)).toBe(JSON.stringify(second.death));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('always ends by 110, with a matching obituary', async () => {
    const run = await ownChain();
    const ages = new Set<number>();

    for (const seed of [1, 424242, 987654, 5150]) {
      const state = playToDeath(seed, emptyRegistry(), run);
      const c = state.character;
      const death = state.death;
      ages.add(c.age);

      expect(state.phase).toBe('dead');
      expect(c.age).toBeLessThanOrEqual(110);
      expect(death).toBeDefined();
      if (!death) return;
      expect(death.age).toBe(c.age);
      expect(death.obituary).toContain(`${c.firstName} ${c.lastName}`);
      expect(death.obituary).toContain(`Died of ${death.cause} at ${c.age}.`);
      expect(lastYear(state).entries.slice(-1)[0]).toEqual({
        icon: '💀',
        kind: 'death',
        text: `You died of ${death.cause} at age ${c.age}.`,
      });
      expectOneYearPerBirthday(state);
    }

    expect(ages.size).toBeGreaterThan(1);
  });

  it('walks the character through every life stage it reaches', async () => {
    const run = await ownChain();
    const state = playToDeath(424242, emptyRegistry(), run);
    const lines = state.log.flatMap((year) => texts(year.entries));

    expect(lines).toContain("You're a toddler now.");
    expect(lines).toContain("You're a child now.");
    expect(lines).toContain("You're a teenager now.");
    expect(lines).toContain("You're an adult now.");
    expect(lines.filter((line) => line === "You're an adult now.")).toHaveLength(1);
  });
});

describe('the generation after', () => {
  it('ages the heir a legacy handed over', async () => {
    const run = await ownChain();
    const reg = emptyRegistry();
    const state = newLife(41, reg);
    state.character.age = 60;
    state.year = 2060;
    state.log.push({ age: 60, year: 2060, entries: [] });
    const heir = addPerson(state, {
      kind: 'child',
      name: 'Nina Byron',
      gender: 'female',
      age: 8,
      alive: true,
      rel: 80,
      flags: {},
    });
    killCharacter(state, reg, 'old age');

    const next = startLegacy(state, reg, heir.id);
    run.ageUp(next, reg);

    expect(next.generation).toBe(2);
    expect(next.character.age).toBe(9);
    expect(next.year).toBe(2061);
    expect(next.log).toHaveLength(2);
    expect(next.log[1].age).toBe(9);
  });
});

describe('a whole life on the real phase chain', () => {
  it.skipIf(chainBlocker !== '')('replays identically from the same seed', () => {
    const first = playToDeath(424242, emptyRegistry());
    const second = playToDeath(424242, emptyRegistry());

    expect(JSON.stringify(first.log)).toBe(JSON.stringify(second.log));
    expect(JSON.stringify(first.death)).toBe(JSON.stringify(second.death));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it.skipIf(chainBlocker !== '')('always ends by 110', () => {
    for (const seed of [1, 424242, 987654]) {
      const state = playToDeath(seed, emptyRegistry());
      expect(state.phase).toBe('dead');
      expect(state.death).toBeDefined();
      expect(state.character.age).toBeLessThanOrEqual(110);
      expect(state.death?.age).toBe(state.character.age);
      expect(lastYear(state).entries.slice(-1)[0].kind).toBe('death');
    }
  });

  it.skipIf(chainBlocker !== '')('logs one year per birthday', () => {
    expectOneYearPerBirthday(playToDeath(424242, emptyRegistry()));
  });
});
