import { describe, expect, it } from 'vitest';
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
    const before = state.rngState;

    expect(careerPhase(ctxFor(state))).toEqual([]);
    expect(state.rngState).toBe(before);
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

  it('rewards working hard with six more points than coasting', () => {
    const run = (workHard: boolean): number => {
      const state = newLife(6);
      state.character.age = 30;
      state.character.job = jobState({ workHard, performance: 50 });
      state.rngState = initialRngState(12);
      careerPhase(ctxFor(state));
      return state.character.job?.performance ?? 0;
    };
    expect(Math.round((run(true) - run(false)) * 10) / 10).toBe(6);
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
});

/* ---------------------------------------------------------------------------
   Retirement
--------------------------------------------------------------------------- */

describe('retirement', () => {
  it('retires a worker at 70 on 30% of their last salary', () => {
    const state = newLife(13);
    state.character.age = 70;
    state.character.job = jobState({ salary: 30000 });
    state.rngState = initialRngState(15);

    const entries = careerPhase(ctxFor(state));
    const c = state.character;

    expect(entries).toEqual([{ icon: '🏖️', kind: 'info', text: 'You retired at 70.' }]);
    expect(c.job).toBeNull();
    // 30000 plus the 3% raise, then 30% of that.
    expect(c.flags.pensionSalary).toBe(9270);
    expect(c.flags.lastJobTitle).toBe('Clerk');
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
  });
});
