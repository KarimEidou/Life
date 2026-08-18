/**
 * Career phase plus the player actions that drive employment.
 *
 * `JobState.performance` is standing with the employer: it drifts up every
 * worked year, buys promotions and raises above 70/60, and gets people fired
 * below 25. Salary is stored on the job, so a raise survives a registry that no
 * longer lists the position.
 */

import { currentYearLog } from '@/engine/ageUp';
import { clampStat } from '@/engine/effects';
import { createRng } from '@/engine/rng';
import type {
  ContentRegistry,
  Ctx,
  EdLevel,
  GameState,
  JobDef,
  LogEntry,
} from '@/types';

/** Ranking used for "at least this much schooling" checks. */
const LEVEL_ORDER: Record<EdLevel, number> = {
  none: 0,
  primary: 1,
  middle: 2,
  high: 3,
  university: 4,
  postgrad: 5,
};

const LEVEL_LABEL: Record<EdLevel, string> = {
  none: 'no schooling',
  primary: 'elementary school',
  middle: 'middle school',
  high: 'a high school diploma',
  university: 'a degree',
  postgrad: 'a postgraduate degree',
};

/** Yearly performance drift, before noise and the sick-worker penalty. */
const EFFORT_HARD = 8;
const EFFORT_COASTING = 2;
const PERFORMANCE_SD = 4;
const SICK_HEALTH = 30;
const SICK_PENALTY = 5;

const PROMOTION_MIN_YEARS = 2;
const PROMOTION_MIN_PERFORMANCE = 70;
const PROMOTION_BASE_CHANCE = 0.25;
/** Every point of performance over the bar adds 1/200 to the promotion odds. */
const PROMOTION_CHANCE_SPAN = 200;
const PROMOTION_RAISE = 1.05;
const PROMOTION_PERFORMANCE_COST = 10;

const FIRING_PERFORMANCE = 25;
const FIRING_CHANCE = 0.3;
const FIRING_GRIEF = 15;

const LAYOFF_CHANCE = 0.02;
const SEVERANCE_SHARE = 0.1;

const RETIREMENT_AGE = 70;
const PENSION_SHARE = 0.3;

const RELEASE_RELIEF = 15;

const INTERVIEW_FAIL_CHANCE = 0.1;
/** A new hire starts at 50, plus a fifth of the smarts they bring above average. */
const START_PERFORMANCE = 50;
const SMARTS_BASELINE = 50;
const SMARTS_PER_POINT = 5;

const RAISE_MIN_PERFORMANCE = 60;
const RAISE_MIN_YEARS = 1;
const RAISE_CHANCE = 0.4;
const RAISE_SIZE = 1.08;
const RAISE_SNUB = 3;

/* Registry maps are typed as total records, so widen before lookup: a hand-built
   or partially loaded registry can still miss the id we ask for. */
function findJob(reg: ContentRegistry, id: string): JobDef | undefined {
  const byId: Record<string, JobDef | undefined> = reg.jobsById;
  return byId[id] ?? reg.jobs.find((job) => job.id === id);
}

/** Reads a counter flag that older saves or content may have left unset. */
function counter(value: boolean | number | string | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Rolls the yearly promotion. Only a job whose def names a `promotesTo` rung can
 * climb, which is what keeps part-time work a dead end.
 */
function rollPromotion(ctx: Ctx, def: JobDef): LogEntry | undefined {
  const c = ctx.state.character;
  const job = c.job;
  if (!job || def.promotesTo === undefined) return undefined;
  if (job.years < PROMOTION_MIN_YEARS || job.performance <= PROMOTION_MIN_PERFORMANCE) {
    return undefined;
  }
  const next = findJob(ctx.reg, def.promotesTo);
  if (!next) return undefined;

  const odds =
    PROMOTION_BASE_CHANCE +
    (job.performance - PROMOTION_MIN_PERFORMANCE) / PROMOTION_CHANCE_SPAN;
  if (!ctx.rng.chance(odds)) return undefined;

  // Never a pay cut: the rung's base salary is a floor, not a reset.
  job.salary = Math.max(Math.round(job.salary * PROMOTION_RAISE), Math.round(next.baseSalary));
  job.jobId = next.id;
  job.title = next.title;
  job.years = 0;
  job.performance = clampStat(job.performance - PROMOTION_PERFORMANCE_COST);
  c.flags.jobsHeld = counter(c.flags.jobsHeld) + 1;
  if (next.fameGain !== undefined) c.fame = clampStat(c.fame + next.fameGain);

  return { icon: '🎉', kind: 'good', text: `You were promoted to ${next.title}.` };
}

/** Pays salary, moves performance, then rolls promotion, raise or firing. */
export function careerPhase(ctx: Ctx): LogEntry[] {
  const c = ctx.state.character;
  const entries: LogEntry[] = [];

  const prison = c.prison;
  if (prison) {
    prison.yearsLeft -= 1;
    if (prison.yearsLeft <= 0) {
      c.prison = null;
      c.stats.happiness = clampStat(c.stats.happiness + RELEASE_RELIEF);
      entries.push({ icon: '🔓', kind: 'legal', text: 'You were released from prison.' });
    }
    // Nobody works from a cell; schooling carries on in its own phase.
    return entries;
  }

  const job = c.job;
  if (!job) return entries;

  job.years += 1;
  const effort = job.workHard ? EFFORT_HARD : EFFORT_COASTING;
  const drag = c.stats.health < SICK_HEALTH ? SICK_PENALTY : 0;
  job.performance = clampStat(
    job.performance + effort + ctx.rng.normal(0, PERFORMANCE_SD) - drag
  );

  const def = findJob(ctx.reg, job.jobId);
  if (def) job.salary = Math.round(job.salary * (1 + def.raisePct));

  /* Retirement is settled before the yearly rolls: nobody is promoted or laid
     off on their way out the door. */
  if (c.age >= RETIREMENT_AGE) {
    c.flags.pensionSalary = Math.round(job.salary * PENSION_SHARE);
    c.flags.lastJobTitle = job.title;
    c.job = null;
    entries.push({ icon: '🏖️', kind: 'info', text: `You retired at ${c.age}.` });
    return entries;
  }

  if (def) {
    const promotion = rollPromotion(ctx, def);
    if (promotion) {
      entries.push(promotion);
      return entries;
    }
  }

  if (job.performance < FIRING_PERFORMANCE && ctx.rng.chance(FIRING_CHANCE)) {
    c.flags.lastJobTitle = job.title;
    c.job = null;
    c.stats.happiness = clampStat(c.stats.happiness - FIRING_GRIEF);
    entries.push({ icon: '📉', kind: 'bad', text: 'You were fired.' });
    return entries;
  }

  if (ctx.rng.chance(LAYOFF_CHANCE)) {
    c.flags.lastJobTitle = job.title;
    c.money = Math.max(0, Math.round(c.money + Math.round(SEVERANCE_SHARE * job.salary)));
    c.job = null;
    entries.push({ icon: '📦', kind: 'bad', text: 'You were laid off.' });
  }

  return entries;
}

/** Checks a job's `req` gate: age, education level, major, stats and prior job. */
export function jobRequirementsMet(
  state: GameState,
  reg: ContentRegistry,
  job: JobDef
): { ok: boolean; reason?: string } {
  const c = state.character;
  const req = job.req;

  if (c.prison) return { ok: false, reason: "You're in prison." };
  if (req.minAge !== undefined && c.age < req.minAge) {
    return { ok: false, reason: `You must be ${req.minAge} to apply.` };
  }
  if (
    req.education !== undefined &&
    LEVEL_ORDER[c.education.level] < LEVEL_ORDER[req.education]
  ) {
    return { ok: false, reason: `You need ${LEVEL_LABEL[req.education]}.` };
  }
  const majors = req.majors;
  if (majors && majors.length > 0) {
    const held = c.education.major;
    if (held === undefined || !majors.includes(held)) {
      return { ok: false, reason: 'Your major does not qualify.' };
    }
  }
  if (req.minSmarts !== undefined && c.stats.smarts < req.minSmarts) {
    return { ok: false, reason: "You're not smart enough." };
  }
  if (req.minLooks !== undefined && c.stats.looks < req.minLooks) {
    return { ok: false, reason: "You're not good-looking enough." };
  }
  if (req.prevJobId !== undefined && (!c.job || c.job.jobId !== req.prevJobId)) {
    const below = findJob(reg, req.prevJobId);
    const title = below ? below.title : 'the job below it';
    return { ok: false, reason: `You need to be a ${title} first.` };
  }

  return { ok: true };
}

/** Applies for a job: requirements gate, then an interview roll on success. */
export function applyForJob(
  state: GameState,
  reg: ContentRegistry,
  jobId: string
): { ok: boolean; reason?: string } {
  const c = state.character;
  const def = findJob(reg, jobId);
  if (!def) return { ok: false, reason: 'That job does not exist.' };

  const gate = jobRequirementsMet(state, reg, def);
  if (!gate.ok) return gate;

  const rng = createRng(state);
  if (rng.chance(INTERVIEW_FAIL_CHANCE)) {
    return { ok: false, reason: 'The interview went badly.' };
  }

  c.job = {
    jobId: def.id,
    title: def.title,
    salary: Math.round(def.baseSalary),
    years: 0,
    performance: clampStat(
      START_PERFORMANCE + (c.stats.smarts - SMARTS_BASELINE) / SMARTS_PER_POINT
    ),
    workHard: false,
  };
  c.flags.jobsHeld = counter(c.flags.jobsHeld) + 1;
  /* A wage does not move anyone out on its own: `livesWithParents` is cleared by
     the finance phase, at 22 or on a marriage or a home. */
  currentYearLog(state).entries.push({
    icon: def.icon,
    kind: 'good',
    text: `You started work as a ${def.title}.`,
  });
  return { ok: true };
}

/** Leaves the current job immediately, ending its salary. */
export function quitJob(state: GameState): void {
  const c = state.character;
  const job = c.job;
  if (!job) return;

  c.flags.lastJobTitle = job.title;
  c.job = null;
  currentYearLog(state).entries.push({
    icon: '🚪',
    kind: 'info',
    text: 'You quit your job.',
  });
}

/** Toggles working hard: better performance at the cost of health and happiness. */
export function setWorkHard(state: GameState, on: boolean): void {
  const job = state.character.job;
  if (job) job.workHard = on;
}

/** Asks for a raise: performance-weighted roll, once per year. */
export function askForRaise(
  state: GameState,
  reg: ContentRegistry
): { ok: boolean; text: string } {
  const c = state.character;
  const job = c.job;
  if (!job) return { ok: false, text: 'You need a job first.' };

  const asked = c.flags.lastRaiseAskAge;
  if (typeof asked === 'number' && asked === c.age) {
    return { ok: false, text: 'You already asked this year.' };
  }
  c.flags.lastRaiseAskAge = c.age;

  const earned = job.performance > RAISE_MIN_PERFORMANCE && job.years >= RAISE_MIN_YEARS;
  // The roll is guarded so an undeserving ask never consumes a draw.
  if (earned && createRng(state).chance(RAISE_CHANCE)) {
    job.salary = Math.round(job.salary * RAISE_SIZE);
    const text = 'Your boss gave you an 8% raise.';
    currentYearLog(state).entries.push({ icon: '💰', kind: 'money', text });
    return { ok: true, text };
  }

  c.stats.happiness = clampStat(c.stats.happiness - RAISE_SNUB);
  const text = 'Denied. Maybe next year.';
  currentYearLog(state).entries.push({ icon: '💬', kind: 'info', text });
  return { ok: false, text };
}
