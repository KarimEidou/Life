import { describe, expect, it } from 'vitest';
import { killCharacter } from '@/engine/death';
import {
  applyForJob,
  askForRaise,
  careerPhase,
  jobRequirementsMet,
  quitJob,
  setWorkHard,
} from '@/engine/phases/career';
import { createRng, initialRngState } from '@/engine/rng';
import { createLife } from '@/engine/state';
import type {
  ContentRegistry,
  Ctx,
  GameState,
  JobDef,
  JobState,
  LogEntry,
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

const JOBS: JobDef[] = [
  {
    id: 'clerk',
    track: 'office',
    title: 'Clerk',
    icon: '🧾',
    level: 1,
    baseSalary: 30000,
    raisePct: 0.03,
    req: { minAge: 18, education: 'high' },
    promotesTo: 'manager',
  },
  {
    id: 'manager',
    track: 'office',
    title: 'Manager',
    icon: '📈',
    level: 2,
    baseSalary: 60000,
    raisePct: 0.04,
    req: { education: 'high', prevJobId: 'clerk' },
    fameGain: 2,
  },
  {
    id: 'barista',
    track: 'service',
    title: 'Barista',
    icon: '☕',
    level: 1,
    baseSalary: 12000,
    raisePct: 0.02,
    req: { minAge: 16 },
    isPartTime: true,
  },
  {
    id: 'surgeon',
    track: 'medicine',
    title: 'Surgeon',
    icon: '🩺',
    level: 3,
    baseSalary: 200000,
    raisePct: 0.05,
    req: {
      minAge: 26,
      education: 'university',
      majors: ['medicine'],
      minSmarts: 80,
      minLooks: 20,
    },
  },
  {
    // An unvalidated pack: `validateRegistry` lints an unreadable rate, but
    // nothing calls it at load, so the engine has to survive one.
    id: 'glitch',
    track: 'odd',
    title: 'Sign Spinner',
    icon: '🪧',
    level: 1,
    baseSalary: 60000,
    raisePct: Number.NaN,
    req: {},
    promotesTo: 'glitch-lead',
  },
  {
    // The rung above it, with the other two numbers the career phase reads out
    // of content unreadable as well.
    id: 'glitch-lead',
    track: 'odd',
    title: 'Lead Sign Spinner',
    icon: '🪧',
    level: 2,
    baseSalary: Number.NaN,
    raisePct: 0.01,
    req: { prevJobId: 'glitch' },
    fameGain: Number.NaN,
  },
  {
    id: 'dreamer',
    track: 'odd',
    title: 'Dreamer',
    icon: '💭',
    level: 1,
    baseSalary: 1000,
    raisePct: 0,
    req: {},
    // Points at a rung the registry never got, so the ladder is a dead end.
    promotesTo: 'legend',
  },
];

function registry(): ContentRegistry {
  const reg = emptyRegistry();
  reg.jobs = JOBS;
  for (const job of JOBS) reg.jobsById[job.id] = job;
  return reg;
}

const REG = registry();

function newLife(seed = 1): GameState {
  const state = createLife(REG, {
    seed,
    firstName: 'Ada',
    lastName: 'Byron',
    gender: 'female',
    startYear: 2000,
  });
  state.people = {};
  return state;
}

function ctxFor(state: GameState): Ctx {
  return { state, c: state.character, rng: createRng(state), reg: REG };
}

function jobState(over: Partial<JobState> = {}): JobState {
  return {
    jobId: 'clerk',
    title: 'Clerk',
    salary: 30000,
    years: 1,
    performance: 50,
    workHard: false,
    ...over,
  };
}

function texts(entries: LogEntry[]): string[] {
  return entries.map((e) => e.text);
}

/** The single `normal(0, 4)` performance draw a worked year opens with. */
function performanceNoise(cursor: number): number {
  return createRng({ rngState: initialRngState(cursor) }).normal(0, 4);
}

interface Forced<T> {
  state: GameState;
  result: T;
  cursor: number;
}

/** Runs `attempt` on a fresh state per rng cursor until `hit` says the branch fired. */
function forceBranch<T>(
  build: () => GameState,
  attempt: (state: GameState) => T,
  hit: (state: GameState, result: T) => boolean,
  limit = 800
): Forced<T> {
  for (let cursor = 1; cursor <= limit; cursor += 1) {
    const state = build();
    state.rngState = initialRngState(cursor);
    const result = attempt(state);
    if (hit(state, result)) return { state, result, cursor };
  }
  throw new Error(`branch never fired within ${limit} rng cursors`);
}

/** True when no cursor in the scan ever reached the branch. */
function neverFires<T>(
  build: () => GameState,
  attempt: (state: GameState) => T,
  hit: (state: GameState, result: T) => boolean,
  limit = 200
): boolean {
  for (let cursor = 1; cursor <= limit; cursor += 1) {
    const state = build();
    state.rngState = initialRngState(cursor);
    const result = attempt(state);
    if (hit(state, result)) return false;
  }
  return true;
}

/* ---------------------------------------------------------------------------
   Prison
--------------------------------------------------------------------------- */

describe('careerPhase in prison', () => {
  it('counts a year off the sentence and does no work at all', () => {
    const state = newLife(2);
    state.character.age = 30;
    state.character.prison = { crime: 'burglary', yearsLeft: 3, totalYears: 5 };
    state.character.job = jobState();
    const before = state.rngState;

    const entries = careerPhase(ctxFor(state));

    expect(entries).toEqual([]);
    expect(state.character.prison?.yearsLeft).toBe(2);
    expect(state.character.job?.years).toBe(1);
    expect(state.character.job?.salary).toBe(30000);
    // A prison year rolls nothing.
    expect(state.rngState).toBe(before);
  });

  it('charges nothing for working hard from a cell', () => {
    const state = newLife(25);
    const c = state.character;
    c.age = 30;
    c.stats.health = 80;
    c.stats.happiness = 60;
    c.prison = { crime: 'burglary', yearsLeft: 3, totalYears: 5 };
    c.job = jobState({ workHard: true, performance: 50 });

    careerPhase(ctxFor(state));

    // No work was done, so the effort switch costs nothing and buys nothing.
    expect(c.stats.health).toBe(80);
    expect(c.stats.happiness).toBe(60);
    expect(c.job?.performance).toBe(50);
  });

  it('opens the gate on the last year', () => {
    const state = newLife(3);
    state.character.age = 30;
    state.character.stats.happiness = 40;
    state.character.prison = { crime: 'burglary', yearsLeft: 1, totalYears: 2 };

    const entries = careerPhase(ctxFor(state));

    expect(entries).toEqual([
      { icon: '🔓', kind: 'legal', text: 'You were released from prison.' },
    ]);
    expect(state.character.prison).toBeNull();
    expect(state.character.stats.happiness).toBe(55);
  });
});

/* ---------------------------------------------------------------------------
   A worked year
--------------------------------------------------------------------------- */

describe('careerPhase at work', () => {
  it('does nothing for someone with no job', () => {
    const state = newLife(4);
    state.character.age = 30;
    state.character.stats.health = 80;
    state.character.stats.happiness = 60;
    const before = state.rngState;

    expect(careerPhase(ctxFor(state))).toEqual([]);
    expect(state.rngState).toBe(before);
    // Nobody to work hard for, so no stat is charged either.
    expect(state.character.stats.health).toBe(80);
    expect(state.character.stats.happiness).toBe(60);
  });

  it('adds a year of service, drifts performance and pays the annual raise', () => {
    const state = newLife(5);
    state.character.age = 30;
    state.character.job = jobState({ years: 0, performance: 50 });
    state.rngState = initialRngState(11);

    const entries = careerPhase(ctxFor(state));
    const job = state.character.job;

    expect(entries).toEqual([]);
    expect(job?.years).toBe(1);
    expect(job?.salary).toBe(30900);
    expect(job?.performance).toBe(Math.round((52 + performanceNoise(11)) * 10) / 10);
  });

  it('rewards working hard with six more points, and charges health and happiness for them', () => {
    interface Worked {
      performance: number;
      health: number;
      happiness: number;
    }
    const run = (workHard: boolean): Worked => {
      const state = newLife(6);
      const c = state.character;
      c.age = 30;
      // Well clear of the sick-worker threshold, so only the effort moves stats.
      c.stats.health = 80;
      c.stats.happiness = 60;
      c.job = jobState({ workHard, performance: 50 });
      state.rngState = initialRngState(12);
      careerPhase(ctxFor(state));
      return {
        performance: c.job?.performance ?? 0,
        health: c.stats.health,
        happiness: c.stats.happiness,
      };
    };
    const hard = run(true);
    const coasting = run(false);

    expect(Math.round((hard.performance - coasting.performance) * 10) / 10).toBe(6);
    // Coasting is free.
    expect(coasting.health).toBe(80);
    expect(coasting.happiness).toBe(60);
    // The six points are bought with 1.5 health and 1 happiness.
    expect(hard.health).toBe(78.5);
    expect(hard.happiness).toBe(59);
  });

  it('charges the effort again every year, and stops at the floor', () => {
    const state = newLife(26);
    const c = state.character;
    c.age = 30;
    c.stats.health = 33;
    c.stats.happiness = 2.5;
    // No def behind the id, so no promotion can cut the run short.
    c.job = jobState({ jobId: 'ghost', title: 'Ghost', workHard: true, performance: 90 });
    state.rngState = initialRngState(21);

    for (let year = 0; year < 3; year += 1) careerPhase(ctxFor(state));

    expect(c.job).not.toBeNull();
    expect(c.stats.health).toBe(28.5);
    // 2.5 -> 1.5 -> 0.5 -> clamped at the floor rather than going negative.
    expect(c.stats.happiness).toBe(0);
  });

  it('costs a sick worker five points', () => {
    const run = (health: number): number => {
      const state = newLife(7);
      state.character.age = 30;
      state.character.stats.health = health;
      state.character.job = jobState({ performance: 50 });
      state.rngState = initialRngState(13);
      careerPhase(ctxFor(state));
      return state.character.job?.performance ?? 0;
    };
    expect(Math.round((run(50) - run(29)) * 10) / 10).toBe(5);
  });

  it('keeps the salary a job def no longer covers', () => {
    const state = newLife(8);
    state.character.age = 30;
    state.character.job = jobState({ jobId: 'ghost', title: 'Ghost', salary: 41234 });
    state.rngState = initialRngState(14);

    careerPhase(ctxFor(state));

    expect(state.character.job?.salary).toBe(41234);
  });

  it('keeps the salary a pack with an unreadable raise cannot grow', () => {
    const state = newLife(30);
    state.character.age = 30;
    state.character.job = jobState({
      jobId: 'glitch',
      title: 'Sign Spinner',
      salary: 60000,
      // Short of the promotion bar, so the year is nothing but the raise.
      years: 0,
      performance: 70,
    });
    state.rngState = initialRngState(19);

    careerPhase(ctxFor(state));

    /* `1 + NaN` is NaN and the salary is stored, so an unreadable raise used to
       cost the character the wage itself for the rest of the life — and the
       severance, the loan cap and the pension with it. It buys nothing now. */
    expect(state.character.job?.salary).toBe(60000);
  });
});

/* ---------------------------------------------------------------------------
   Promotion
--------------------------------------------------------------------------- */

describe('promotion', () => {
  const promotable = (): GameState => {
    const state = newLife(9);
    state.character.age = 40;
    state.character.flags.jobsHeld = 1;
    state.character.job = jobState({ years: 1, performance: 85 });
    return state;
  };

  it('moves the character up a rung with a raise, a fresh clock and a line', () => {
    const { state, result, cursor } = forceBranch(
      promotable,
      (s) => careerPhase(ctxFor(s)),
      (s) => s.character.job?.jobId === 'manager'
    );
    const c = state.character;
    const grown = Math.round((87 + performanceNoise(cursor)) * 10) / 10;

    expect(c.job).toEqual({
      jobId: 'manager',
      title: 'Manager',
      // The rung's base salary is a floor: 30900 x 1.05 would be a pay cut.
      salary: 60000,
      years: 0,
      performance: Math.round((grown - 10) * 10) / 10,
      workHard: false,
    });
    expect(c.flags.jobsHeld).toBe(2);
    expect(c.fame).toBe(2);
    expect(result).toEqual([
      { icon: '🎉', kind: 'good', text: 'You were promoted to Manager.' },
    ]);
  });

  it('carries a salary already above the next rung upwards', () => {
    const { state } = forceBranch(
      () => {
        const s = promotable();
        s.character.job = jobState({ years: 3, performance: 90, salary: 100000 });
        return s;
      },
      (s) => careerPhase(ctxFor(s)),
      (s) => s.character.job?.jobId === 'manager'
    );
    // 100000 x 1.03 annual raise, then 5% more for the promotion.
    expect(state.character.job?.salary).toBe(108150);
  });

  it('still charges the hard year that ends in a promotion', () => {
    const { state } = forceBranch(
      () => {
        const s = promotable();
        s.character.stats.health = 80;
        s.character.stats.happiness = 60;
        s.character.job = jobState({ years: 3, performance: 85, workHard: true });
        return s;
      },
      (s) => careerPhase(ctxFor(s)),
      (s) => s.character.job?.jobId === 'manager'
    );

    // The early return on a promotion does not refund the effort.
    expect(state.character.stats.health).toBe(78.5);
    expect(state.character.stats.happiness).toBe(59);
  });

  /* A rung whose `baseSalary` and `fameGain` are both unreadable. The floor and
     the fame bonus are the only two numbers a promotion reads out of content. */
  const intoGlitchLead = (): GameState => {
    const s = promotable();
    s.character.fame = 85;
    s.character.job = jobState({
      jobId: 'glitch',
      title: 'Sign Spinner',
      salary: 40000,
      years: 3,
      performance: 85,
    });
    return s;
  };

  it('promotes on the raise alone when the rung cannot say what it pays', () => {
    const { state } = forceBranch(
      intoGlitchLead,
      (s) => careerPhase(ctxFor(s)),
      (s) => s.character.job?.jobId === 'glitch-lead'
    );

    /* `Math.max(42000, NaN)` is NaN. An unreadable floor cannot lift the salary,
       but the 5% the promotion is worth still has to arrive. */
    expect(state.character.job?.salary).toBe(42000);
  });

  it('keeps the fame a rung with an unreadable bonus cannot add to', () => {
    const { state } = forceBranch(
      intoGlitchLead,
      (s) => careerPhase(ctxFor(s)),
      (s) => s.character.job?.jobId === 'glitch-lead'
    );

    /* `clampStat(NaN)` is 0 by design, so guarding after the add would reset a
       career's fame to nothing instead of skipping the bonus. */
    expect(state.character.fame).toBe(85);
  });

  it('needs two years in the chair', () => {
    expect(
      neverFires(
        () => {
          const s = promotable();
          s.character.job = jobState({ years: 0, performance: 95 });
          return s;
        },
        (s) => careerPhase(ctxFor(s)),
        (s) => s.character.job?.jobId === 'manager'
      )
    ).toBe(true);
  });

  it('needs performance above 70', () => {
    expect(
      neverFires(
        () => {
          const s = promotable();
          s.character.job = jobState({ years: 5, performance: 40 });
          return s;
        },
        (s) => careerPhase(ctxFor(s)),
        (s) => s.character.job?.jobId === 'manager'
      )
    ).toBe(true);
  });

  it('leaves part-time work and dead-end ladders where they are', () => {
    for (const jobId of ['barista', 'dreamer']) {
      const def = JOBS.find((j) => j.id === jobId);
      expect(
        neverFires(
          () => {
            const s = promotable();
            s.character.job = jobState({
              jobId,
              title: def?.title ?? '',
              years: 6,
              performance: 95,
              salary: 20000,
            });
            return s;
          },
          (s) => careerPhase(ctxFor(s)),
          // A layoff also empties the seat, so only a live change of rung counts.
          (s) => s.character.job !== null && s.character.job.jobId !== jobId
        )
      ).toBe(true);
    }
  });
});

/* ---------------------------------------------------------------------------
   Losing the job
--------------------------------------------------------------------------- */

describe('firing and layoffs', () => {
  it('fires a worker whose performance has collapsed', () => {
    const { state, result } = forceBranch(
      () => {
        const s = newLife(10);
        s.character.age = 40;
        s.character.stats.happiness = 60;
        s.character.job = jobState({ performance: 5, years: 3 });
        return s;
      },
      (s) => careerPhase(ctxFor(s)),
      (s, entries) => texts(entries).includes('You were fired.')
    );
    const c = state.character;

    expect(result).toEqual([{ icon: '📉', kind: 'bad', text: 'You were fired.' }]);
    expect(c.job).toBeNull();
    expect(c.stats.happiness).toBe(45);
    expect(c.flags.lastJobTitle).toBe('Clerk');
  });

  it('leaves a solid performer alone', () => {
    expect(
      neverFires(
        () => {
          const s = newLife(11);
          s.character.age = 40;
          s.character.job = jobState({ jobId: 'barista', title: 'Barista', performance: 90 });
          return s;
        },
        (s) => careerPhase(ctxFor(s)),
        (s, entries) => texts(entries).includes('You were fired.')
      )
    ).toBe(true);
  });

  it('lays a worker off with a tenth of their salary as severance', () => {
    const { state } = forceBranch(
      () => {
        const s = newLife(12);
        s.character.age = 40;
        s.character.money = 0;
        s.character.job = jobState({
          jobId: 'barista',
          title: 'Barista',
          salary: 12000,
          performance: 70,
        });
        return s;
      },
      (s) => careerPhase(ctxFor(s)),
      (s, entries) => texts(entries).includes('You were laid off.')
    );
    const c = state.character;

    expect(c.job).toBeNull();
    // 12000 grew by the 2% annual raise before the tenth was cut.
    expect(c.money).toBe(1224);
    expect(c.flags.lastJobTitle).toBe('Barista');
  });

  it('keeps the balance when an unreadable salary makes the severance unreadable', () => {
    const { state } = forceBranch(
      () => {
        const s = newLife(12);
        s.character.age = 40;
        s.character.money = 250000;
        /* No content rate can mint this any more — they are all read through
           `contentNumber` — but `loadGame` certifies the shape of `c.job`, not
           the values inside it, so a save can still seat one. */
        s.character.job = jobState({
          jobId: 'barista',
          title: 'Barista',
          salary: Number.NaN,
          performance: 70,
        });
        return s;
      },
      (s) => careerPhase(ctxFor(s)),
      (s, entries) => texts(entries).includes('You were laid off.')
    );
    const c = state.character;

    expect(c.job).toBeNull();
    /* An unreadable payment buys nothing, but it must not wipe the $250,000 that
       was already there. `Math.max(0, NaN)` is NaN, and the finance phase
       settles a NaN balance to $0 the same year. */
    expect(c.money).toBe(250000);
  });
});

/* ---------------------------------------------------------------------------
   Retirement
--------------------------------------------------------------------------- */

describe('retirement', () => {
  it('retires a worker at 70 on 30% of the salary they finished on', () => {
    const state = newLife(13);
    state.character.age = 70;
    state.character.job = jobState({ salary: 30000, years: 12 });
    state.rngState = initialRngState(15);
    const before = state.rngState;

    const entries = careerPhase(ctxFor(state));
    const c = state.character;

    expect(entries).toEqual([{ icon: '🏖️', kind: 'info', text: 'You retired at 70.' }]);
    expect(c.job).toBeNull();
    // 30% of the 30000 the last worked year left them on.
    expect(c.flags.pensionSalary).toBe(9000);
    expect(c.flags.lastJobTitle).toBe('Clerk');
    expect(c.flags.retired).toBe(true);
    // The retirement year is not worked, so it rolls nothing.
    expect(state.rngState).toBe(before);
  });

  it('works the year before retirement and none of the retirement year', () => {
    const state = newLife(27);
    const c = state.character;
    c.age = 69;
    c.stats.health = 80;
    c.stats.happiness = 60;
    c.job = jobState({ workHard: true, years: 3 });
    state.rngState = initialRngState(17);

    careerPhase(ctxFor(state));

    // 69 is an ordinary year: service counted, annual raise paid, effort charged.
    expect(c.job?.years).toBe(4);
    expect(c.job?.salary).toBe(30900);
    expect(c.stats.health).toBe(78.5);
    expect(c.stats.happiness).toBe(59);

    c.age = 70;
    const health = c.stats.health;
    const happiness = c.stats.happiness;
    const cursor = state.rngState;

    const entries = careerPhase(ctxFor(state));

    /* The finance phase reads `c.job` after this one, so a year worked on the
       way out the door would never be paid for. Nothing is worked, so nothing is
       charged for it and no draw is spent on it. */
    expect(texts(entries)).toEqual(['You retired at 70.']);
    expect(c.job).toBeNull();
    expect(c.stats.health).toBe(health);
    expect(c.stats.happiness).toBe(happiness);
    expect(state.rngState).toBe(cursor);
    // 30% of the 30900 the last worked year ended on.
    expect(c.flags.pensionSalary).toBe(9270);
  });

  it('retires once, and a later job buries neither the pension nor the career', () => {
    const state = newLife(28);
    const c = state.character;
    c.age = 70;
    c.job = jobState({ jobId: 'manager', title: 'Manager', salary: 400000, years: 10 });
    state.rngState = initialRngState(31);

    const first = careerPhase(ctxFor(state));

    expect(texts(first)).toEqual(['You retired at 70.']);
    expect(c.flags.pensionSalary).toBe(120000);
    expect(c.flags.lastJobTitle).toBe('Manager');
    expect(c.job).toBeNull();

    /* Hiring is closed from 70 on, but a job can still reach this age through a
       save or an effect — and a $12,000 one must restate neither a $120,000
       pension nor the title the obituary reads. */
    c.age = 71;
    c.job = jobState({
      jobId: 'barista',
      title: 'Barista',
      salary: 12000,
      years: 0,
      performance: 60,
    });
    const cursor = state.rngState;

    const second = careerPhase(ctxFor(state));

    expect(texts(second)).toEqual([]);
    expect(c.job).toBeNull();
    expect(c.flags.pensionSalary).toBe(120000);
    expect(c.flags.lastJobTitle).toBe('Manager');
    expect(state.rngState).toBe(cursor);
  });

  it('keeps a banked pension when the last seat pays something unreadable', () => {
    const state = newLife(34);
    const c = state.character;
    c.age = 71;
    c.flags.retired = true;
    c.flags.lastJobTitle = 'Manager';
    c.flags.pensionSalary = 120000;
    // Only a save can seat this now; every content rate is read through a guard.
    c.job = jobState({ jobId: 'barista', title: 'Barista', salary: Number.NaN, years: 2 });
    const cursor = state.rngState;

    const entries = careerPhase(ctxFor(state));

    /* The ratchet folds the seat into a pension the character has already
       banked, so `Math.max(120000, NaN)` does not lose the raise — it destroys
       the pension, which `numberFlag` then reads back as $0 a year for life. */
    expect(entries).toEqual([]);
    expect(c.job).toBeNull();
    expect(c.flags.pensionSalary).toBe(120000);
    expect(state.rngState).toBe(cursor);
  });

  it('says it once across a decade of odd jobs after 70', () => {
    const state = newLife(29);
    const c = state.character;
    c.age = 70;
    c.job = jobState({ jobId: 'manager', title: 'Manager', salary: 200000, years: 10 });
    state.rngState = initialRngState(33);

    const feed: string[] = [];
    const pensions: number[] = [];
    const titles: (string | undefined)[] = [];
    for (let year = 0; year < 10; year += 1) {
      feed.push(...texts(careerPhase(ctxFor(state))));
      pensions.push(Number(c.flags.pensionSalary));
      titles.push(String(c.flags.lastJobTitle));
      c.age += 1;
      // Planted back in the seat every year, always for a fraction of the career.
      c.job = jobState({
        jobId: 'barista',
        title: 'Barista',
        salary: 12000,
        years: 0,
        performance: 60,
      });
    }

    expect(feed).toEqual(['You retired at 70.']);
    // 30% of the 200000 the career ended on.
    expect(pensions[0]).toBe(60000);
    expect(pensions).toEqual(pensions.map(() => 60000));
    expect(titles).toEqual(titles.map(() => 'Manager'));
  });

  it('remembers the career in the obituary, not the job that came after it', () => {
    const state = newLife(31);
    const c = state.character;
    c.age = 70;
    c.flags.jobsHeld = 4;
    c.job = jobState({ jobId: 'manager', title: 'Manager', salary: 200000, years: 20 });
    state.rngState = initialRngState(51);

    expect(texts(careerPhase(ctxFor(state)))).toEqual(['You retired at 70.']);

    // Five years on, a hobby job is refused rather than taken and quietly deleted.
    c.age = 75;
    expect(applyForJob(state, REG, 'barista').ok).toBe(false);
    expect(c.job).toBeNull();

    killCharacter(state, REG, 'natural causes');

    expect(state.death?.obituary).toContain('Manager.');
    expect(state.death?.obituary).not.toContain('Barista');
  });

  it('leaves a 69-year-old at their desk', () => {
    const state = newLife(14);
    state.character.age = 69;
    state.character.job = jobState();
    state.rngState = initialRngState(16);

    careerPhase(ctxFor(state));

    expect(state.character.job).not.toBeNull();
    expect(state.character.flags.pensionSalary).toBeUndefined();
  });
});

/* ---------------------------------------------------------------------------
   Hiring gate
--------------------------------------------------------------------------- */

function surgeonReady(): GameState {
  const state = newLife(15);
  const c = state.character;
  c.age = 30;
  c.education = { level: 'university', major: 'medicine', year: 0, gpa: 3.5, studyHard: false };
  c.stats = { health: 80, happiness: 70, smarts: 90, looks: 60 };
  return state;
}

function jobDef(id: string): JobDef {
  const def = JOBS.find((j) => j.id === id);
  if (!def) throw new Error(`test registry has no ${id}`);
  return def;
}

describe('jobRequirementsMet', () => {
  it('lets a qualified applicant through', () => {
    expect(jobRequirementsMet(surgeonReady(), REG, jobDef('surgeon'))).toEqual({ ok: true });
  });

  it('refuses anyone still in a cell', () => {
    const state = surgeonReady();
    state.character.prison = { crime: 'fraud', yearsLeft: 2, totalYears: 4 };
    expect(jobRequirementsMet(state, REG, jobDef('surgeon'))).toEqual({
      ok: false,
      reason: "You're in prison.",
    });
  });

  it('refuses anyone who has reached retirement age', () => {
    const state = surgeonReady();

    state.character.age = 69;
    expect(jobRequirementsMet(state, REG, jobDef('surgeon'))).toEqual({ ok: true });

    state.character.age = 70;
    expect(jobRequirementsMet(state, REG, jobDef('surgeon'))).toEqual({
      ok: false,
      reason: "You're past retirement age.",
    });
    // Not even the part-time job with no requirements of its own.
    expect(jobRequirementsMet(state, REG, jobDef('barista')).reason).toBe(
      "You're past retirement age."
    );
  });

  it('refuses an applicant below the minimum age', () => {
    const state = surgeonReady();
    state.character.age = 25;
    expect(jobRequirementsMet(state, REG, jobDef('surgeon')).reason).toBe(
      'You must be 26 to apply.'
    );
  });

  it('ranks education rather than matching it', () => {
    const state = surgeonReady();

    state.character.education.level = 'high';
    expect(jobRequirementsMet(state, REG, jobDef('surgeon')).ok).toBe(false);

    state.character.education.level = 'postgrad';
    expect(jobRequirementsMet(state, REG, jobDef('surgeon')).ok).toBe(true);

    state.character.education.level = 'none';
    expect(jobRequirementsMet(state, REG, jobDef('clerk')).reason).toBe(
      'You need a high school diploma.'
    );
  });

  it('checks the major against the list the job accepts', () => {
    const state = surgeonReady();

    state.character.education.major = 'poetry';
    expect(jobRequirementsMet(state, REG, jobDef('surgeon')).reason).toBe(
      'Your major does not qualify.'
    );

    state.character.education.major = undefined;
    expect(jobRequirementsMet(state, REG, jobDef('surgeon')).ok).toBe(false);
  });

  it('checks smarts and looks', () => {
    const dim = surgeonReady();
    dim.character.stats.smarts = 79;
    expect(jobRequirementsMet(dim, REG, jobDef('surgeon')).reason).toBe(
      "You're not smart enough."
    );

    const plain = surgeonReady();
    plain.character.stats.looks = 19;
    expect(jobRequirementsMet(plain, REG, jobDef('surgeon')).reason).toBe(
      "You're not good-looking enough."
    );
  });

  it('holds an internal promotion to the job below it', () => {
    const state = newLife(16);
    state.character.age = 30;
    state.character.education.level = 'high';

    expect(jobRequirementsMet(state, REG, jobDef('manager')).reason).toBe(
      'You need to be a Clerk first.'
    );

    state.character.job = jobState({ jobId: 'barista', title: 'Barista' });
    expect(jobRequirementsMet(state, REG, jobDef('manager')).ok).toBe(false);

    state.character.job = jobState();
    expect(jobRequirementsMet(state, REG, jobDef('manager'))).toEqual({ ok: true });
  });
});

/* ---------------------------------------------------------------------------
   Player actions
--------------------------------------------------------------------------- */

describe('applyForJob', () => {
  const applicant = (): GameState => {
    const state = newLife(17);
    state.character.age = 20;
    state.character.stats.smarts = 80;
    return state;
  };

  it('hires and starts the clock', () => {
    const { state } = forceBranch(
      applicant,
      (s) => applyForJob(s, REG, 'barista'),
      (s, result) => result.ok
    );
    const c = state.character;

    expect(c.job).toEqual({
      jobId: 'barista',
      title: 'Barista',
      salary: 12000,
      years: 0,
      // 50, plus a fifth of the smarts above average.
      performance: 56,
      workHard: false,
    });
    expect(c.flags.jobsHeld).toBe(1);
    expect(state.log[state.log.length - 1].entries.slice(-1)).toEqual([
      { icon: '☕', kind: 'good', text: 'You started work as a Barista.' },
    ]);
  });

  it('hires at zero, not at NaN, when the pack cannot say what the job pays', () => {
    const { state } = forceBranch(
      () => {
        const s = applicant();
        s.character.job = jobState({ jobId: 'glitch', title: 'Sign Spinner', salary: 60000 });
        return s;
      },
      (s) => applyForJob(s, REG, 'glitch-lead'),
      (s, result) => result.ok
    );

    /* The seat is the source of every wage the life pays, so an unreadable
       `baseSalary` has to stop at the door rather than be stored. */
    expect(state.character.job?.salary).toBe(0);
  });

  it('counts every job held', () => {
    const state = applicant();
    state.character.flags.jobsHeld = 4;
    state.rngState = initialRngState(1);
    while (!state.character.job) applyForJob(state, REG, 'barista');
    expect(state.character.flags.jobsHeld).toBe(5);
  });

  it('sometimes loses the interview', () => {
    const { state } = forceBranch(
      applicant,
      (s) => applyForJob(s, REG, 'barista'),
      (s, result) => result.reason === 'The interview went badly.'
    );
    expect(state.character.job).toBeNull();
    expect(state.character.flags.jobsHeld).toBeUndefined();
  });

  it('passes a failed requirement straight back', () => {
    const state = applicant();
    state.character.age = 15;
    expect(applyForJob(state, REG, 'barista')).toEqual({
      ok: false,
      reason: 'You must be 16 to apply.',
    });
    expect(state.character.job).toBeNull();
  });

  it('turns a retirement-age applicant away without spending a draw on them', () => {
    const state = applicant();
    state.character.age = 70;
    state.rngState = initialRngState(7);
    const cursor = state.rngState;
    const feed = state.log[state.log.length - 1].entries.length;

    expect(applyForJob(state, REG, 'barista')).toEqual({
      ok: false,
      reason: "You're past retirement age.",
    });
    /* Accepting the job would be worse than refusing it: `careerPhase` deletes a
       seat held at this age at the top of the next year, before the year is
       worked, so the wage would never reach the finance phase. */
    expect(state.character.job).toBeNull();
    expect(state.character.flags.jobsHeld).toBeUndefined();
    expect(state.rngState).toBe(cursor);
    expect(state.log[state.log.length - 1].entries).toHaveLength(feed);
  });

  it('still hires at 69', () => {
    const { state } = forceBranch(
      () => {
        const s = applicant();
        s.character.age = 69;
        return s;
      },
      (s) => applyForJob(s, REG, 'barista'),
      (s, result) => result.ok
    );
    expect(state.character.job?.title).toBe('Barista');
  });

  it('refuses a job the registry does not list', () => {
    const state = applicant();
    expect(applyForJob(state, REG, 'astronaut')).toEqual({
      ok: false,
      reason: 'That job does not exist.',
    });
  });
});

describe('quitJob and setWorkHard', () => {
  it('walks out and remembers the title', () => {
    const state = newLife(18);
    state.character.age = 30;
    state.character.job = jobState();

    quitJob(state);

    expect(state.character.job).toBeNull();
    expect(state.character.flags.lastJobTitle).toBe('Clerk');
    expect(state.log[state.log.length - 1].entries.slice(-1)).toEqual([
      { icon: '🚪', kind: 'info', text: 'You quit your job.' },
    ]);
  });

  it('says nothing when there is no job to quit', () => {
    const state = newLife(19);
    const before = state.log[state.log.length - 1].entries.length;
    quitJob(state);
    expect(state.log[state.log.length - 1].entries).toHaveLength(before);
  });

  it('toggles working hard, and shrugs when unemployed', () => {
    const state = newLife(20);
    state.character.job = jobState();

    setWorkHard(state, true);
    expect(state.character.job?.workHard).toBe(true);
    setWorkHard(state, false);
    expect(state.character.job?.workHard).toBe(false);

    state.character.job = null;
    expect(() => setWorkHard(state, true)).not.toThrow();
  });
});

describe('askForRaise', () => {
  const employed = (): GameState => {
    const state = newLife(21);
    state.character.age = 30;
    state.character.stats.happiness = 60;
    state.character.job = jobState({ performance: 80, years: 2, salary: 50000 });
    return state;
  };

  it('needs a job first', () => {
    const state = newLife(22);
    expect(askForRaise(state, REG)).toEqual({ ok: false, text: 'You need a job first.' });
  });

  it('pays 8% when the boss says yes', () => {
    const { state } = forceBranch(
      employed,
      (s) => askForRaise(s, REG),
      (s, result) => result.ok
    );

    expect(state.character.job?.salary).toBe(54000);
    expect(state.character.flags.lastRaiseAskAge).toBe(30);
    expect(state.log[state.log.length - 1].entries.slice(-1)).toEqual([
      { icon: '💰', kind: 'money', text: 'Your boss gave you an 8% raise.' },
    ]);
  });

  it('stings a little when the boss says no', () => {
    const { state } = forceBranch(
      employed,
      (s) => askForRaise(s, REG),
      (s, result) => !result.ok
    );

    expect(state.character.job?.salary).toBe(50000);
    expect(state.character.stats.happiness).toBe(57);
  });

  it('never says yes to someone who has not earned it', () => {
    const state = employed();
    state.character.job = jobState({ performance: 60, years: 5 });
    const before = state.rngState;

    expect(askForRaise(state, REG)).toEqual({ ok: false, text: 'Denied. Maybe next year.' });
    // An undeserving ask is refused without rolling for it.
    expect(state.rngState).toBe(before);

    const green = employed();
    green.character.job = jobState({ performance: 95, years: 0 });
    const greenBefore = green.rngState;
    expect(askForRaise(green, REG).ok).toBe(false);
    expect(green.rngState).toBe(greenBefore);
  });

  it('allows one ask a year', () => {
    const state = employed();
    askForRaise(state, REG);
    const salary = state.character.job?.salary;
    const happiness = state.character.stats.happiness;

    expect(askForRaise(state, REG)).toEqual({
      ok: false,
      text: 'You already asked this year.',
    });
    expect(state.character.job?.salary).toBe(salary);
    expect(state.character.stats.happiness).toBe(happiness);

    state.character.age = 31;
    expect(askForRaise(state, REG).text).not.toBe('You already asked this year.');
    expect(state.character.flags.lastRaiseAskAge).toBe(31);
  });
});

/* ---------------------------------------------------------------------------
   A finished life
--------------------------------------------------------------------------- */

describe('career actions after death', () => {
  it('refuses every one of them and leaves the life exactly as it was', () => {
    const state = newLife(30);
    const c = state.character;
    c.age = 40;
    c.education.level = 'high';
    c.stats.happiness = 60;
    state.rngState = initialRngState(41);
    while (!c.job) applyForJob(state, REG, 'clerk');
    c.job.years = 3;
    c.job.performance = 90;

    killCharacter(state, REG, 'a heart attack');
    const character = JSON.stringify(c);
    const cursor = state.rngState;
    const feed = state.log[state.log.length - 1].entries.length;

    expect(applyForJob(state, REG, 'barista')).toEqual({
      ok: false,
      reason: 'Your life is over.',
    });
    expect(askForRaise(state, REG)).toEqual({ ok: false, text: 'Your life is over.' });
    quitJob(state);
    setWorkHard(state, true);

    expect(JSON.stringify(c)).toBe(character);
    // A refused action neither spends a draw nor writes a line after the obituary.
    expect(state.rngState).toBe(cursor);
    expect(state.log[state.log.length - 1].entries).toHaveLength(feed);
  });
});

/* ---------------------------------------------------------------------------
   A whole working life
--------------------------------------------------------------------------- */

describe('a career played out', () => {
  it('replays identically from the same cursor', () => {
    const play = (): string => {
      const state = newLife(23);
      state.character.age = 22;
      state.character.education.level = 'high';
      state.rngState = initialRngState(4242);
      for (let year = 0; year < 50; year += 1) {
        if (!state.character.job) applyForJob(state, REG, 'clerk');
        careerPhase(ctxFor(state));
        state.character.age += 1;
      }
      return JSON.stringify(state.character);
    };
    expect(play()).toBe(play());
  });

  it('climbs the ladder and ends on a pension', () => {
    const state = newLife(24);
    state.character.age = 22;
    state.character.education.level = 'high';
    state.character.stats.smarts = 90;
    state.rngState = initialRngState(99);

    const startHealth = state.character.stats.health;
    const startHappiness = state.character.stats.happiness;

    const titles = new Set<string>();
    for (let year = 0; year < 55; year += 1) {
      if (!state.character.job) applyForJob(state, REG, 'clerk');
      if (state.character.job) setWorkHard(state, true);
      careerPhase(ctxFor(state));
      if (state.character.job) titles.add(state.character.job.title);
      state.character.age += 1;
    }

    expect(titles.has('Manager')).toBe(true);
    expect(state.character.job).toBeNull();
    expect(Number(state.character.flags.pensionSalary)).toBeGreaterThan(0);
    // A lifetime of grinding leaves a mark: no career is climbed for free.
    expect(state.character.stats.health).toBeLessThan(startHealth);
    expect(state.character.stats.happiness).toBeLessThan(startHappiness);
  });
});
