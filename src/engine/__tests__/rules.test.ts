import { describe, expect, it } from 'vitest';

import { killCharacter, startLegacy } from '@/engine/death';
import { jobRequirementsMet } from '@/engine/phases/career';
import { applyToSchool } from '@/engine/phases/education';
import { financePhase } from '@/engine/phases/finance';
import { buildRegistry } from '@/engine/registry';
import { createRng } from '@/engine/rng';
import {
  DEGREE_LEVELS,
  LEVEL_ORDER,
  MOVE_OUT_AGE,
  hasAtLeast,
  isDegreeLevel,
} from '@/engine/rules';
import { addPerson, createLife } from '@/engine/state';
import type { ContentRegistry, Ctx, EdLevel, GameState, JobDef, LogEntry } from '@/types';

/** The ladder in the order the rules are supposed to rank it. */
const LADDER: readonly EdLevel[] = ['none', 'primary', 'middle', 'high', 'university', 'postgrad'];

const MOVED_OUT = 'You moved out on your own.';
const BY_AGE = 'That school enrols by age.';

const DEGREE_JOB: JobDef = {
  id: 'analyst',
  track: 'office',
  title: 'Analyst',
  icon: '📊',
  level: 1,
  baseSalary: 40000,
  raisePct: 0.03,
  req: { education: 'university' },
};

/** One school per level, so an application can be aimed at any rung. */
const REG: ContentRegistry = buildRegistry([
  {
    id: 'rules-test',
    jobs: [DEGREE_JOB],
    schools: LADDER.map((level) => ({
      id: `sch-${level}`,
      label: `${level} school`,
      level,
      years: 4,
      tuitionPerYear: 0,
    })),
  },
]);

function life(age: number, seed = 5): GameState {
  const state = createLife(REG, {
    seed,
    firstName: 'Ada',
    lastName: 'Byron',
    gender: 'female',
    startYear: 2000,
  });
  state.character.age = age;
  // Family is generated per seed; these tests state the cast they need themselves.
  state.people = {};
  return state;
}

function ctxFor(state: GameState): Ctx {
  return { state, c: state.character, rng: createRng(state), reg: REG };
}

function texts(entries: LogEntry[]): string[] {
  return entries.map((entry) => entry.text);
}

/** The life an only child of the given age inherits. */
function heirAged(age: number): GameState {
  const state = life(60);
  state.character.money = 100000;
  const child = addPerson(state, {
    kind: 'child',
    name: 'Nina Byron',
    gender: 'female',
    age,
    alive: true,
    rel: 80,
    flags: {},
  });
  killCharacter(state, REG, 'old age');
  return startLegacy(state, REG, child.id);
}

describe('LEVEL_ORDER', () => {
  it('ranks every level of the ladder, none lowest and postgrad highest', () => {
    // Every rung ranked, none twice, and ranked in the order the ladder is climbed.
    expect(Object.keys(LEVEL_ORDER).sort()).toEqual([...LADDER].sort());

    const ranks = LADDER.map((level) => LEVEL_ORDER[level]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(ranks).size).toBe(LADDER.length);
  });

  it('is what `hasAtLeast` reads "at least this much schooling" off', () => {
    LADDER.forEach((held, heldRank) => {
      LADDER.forEach((needed, neededRank) => {
        expect(hasAtLeast(held, needed)).toBe(heldRank >= neededRank);
      });
    });
  });

  /* The reason the table is shared at all: the career phase gates a job on it and
     the education phase gates admission on it, so a level that clears the job
     requirement has to be exactly the level the university stops admitting. Two
     copies of the ranking could disagree and neither side would notice. */
  it('gates a job requirement and a university admission at the same level', () => {
    const student = life(22);
    student.character.education.level = 'high';

    expect(jobRequirementsMet(student, REG, DEGREE_JOB)).toEqual({
      ok: false,
      reason: 'You need a degree.',
    });
    expect(applyToSchool(student, REG, 'sch-university')).toEqual({ ok: true });

    const graduate = life(22);
    graduate.character.education.level = 'university';

    expect(jobRequirementsMet(graduate, REG, DEGREE_JOB)).toEqual({ ok: true });
    expect(applyToSchool(graduate, REG, 'sch-university')).toEqual({
      ok: false,
      reason: 'You already have a degree.',
    });
  });
});

describe('DEGREE_LEVELS', () => {
  it('names the levels applied to rather than aged into', () => {
    expect(DEGREE_LEVELS).toEqual(['university', 'postgrad']);
    for (const level of LADDER) {
      expect(isDegreeLevel(level)).toBe(DEGREE_LEVELS.includes(level));
    }
  });

  /* Spelled out rather than derived from `DEGREE_LEVELS`, so the phase is pinned
     against the rule instead of moving with it: a level dropped from the list
     starts answering "enrols by age" here and this notices. */
  it('is exactly the set `applyToSchool` accepts an application for', () => {
    const refusals: Record<EdLevel, string> = {
      none: BY_AGE,
      primary: BY_AGE,
      middle: BY_AGE,
      high: BY_AGE,
      university: 'You need a high school diploma.',
      postgrad: 'You need a degree first.',
    };

    for (const level of LADDER) {
      // Every applicant starts from `none`, so a degree rung refuses for want of the one below.
      const result = applyToSchool(life(30), REG, `sch-${level}`);
      expect(result).toEqual({ ok: false, reason: refusals[level] });
    }
  });
});

describe('MOVE_OUT_AGE', () => {
  it('is the age the finance phase moves a character out of the family home', () => {
    const early = life(MOVE_OUT_AGE - 1);
    early.character.money = 100000;

    expect(texts(financePhase(ctxFor(early)))).not.toContain(MOVED_OUT);
    expect(early.character.flags.livesWithParents).toBe(true);

    const moving = life(MOVE_OUT_AGE);
    moving.character.money = 100000;

    expect(texts(financePhase(ctxFor(moving)))).toContain(MOVED_OUT);
    expect(moving.character.flags.livesWithParents).toBe(false);
  });

  /* The other half of the same rule: an heir born over the line has to start out
     with a home of their own, or the finance phase charges rent to somebody it
     believes still lives with parents who are dead. */
  it('is the age an heir inherits a life of their own at', () => {
    expect(heirAged(MOVE_OUT_AGE - 1).character.flags.livesWithParents).toBe(true);
    expect(heirAged(MOVE_OUT_AGE).character.flags.livesWithParents).toBe(false);
  });
});
