import { beforeEach, describe, expect, it } from 'vitest';

import { getRegistry, resetRegistryForTests } from '@/content';
import { educationPack } from '@/content/education';
import { jobRequirementsMet } from '@/engine/phases/career';
import { dropOut, educationPhase } from '@/engine/phases/education';
import { createRng } from '@/engine/rng';
import { createLife } from '@/engine/state';
import type { ContentRegistry, Ctx, EdLevel, EventDef, GameState, JobDef } from '@/types';

/**
 * Window rules the education pack has to enforce itself.
 *
 * `isEligible`'s age test is inclusive and knows nothing about desks, but
 * `educationPhase` runs 3rd and `eventsPhase` 7th, so the year high school ends
 * reaches the draw with the desk already emptied. Any year a school event
 * declares therefore has to be a year its own `condition` still accepts.
 */

const SCHOOL_EVENTS: readonly EventDef[] = educationPack.events ?? [];

/** The last age the compulsory ladder covers; `HIGH_END` in the education phase. */
const GRADUATION_AGE = 18;

const GRADUATION_YEAR_EVENTS = ['ev-school-valedictorian', 'ev-school-yearbook'] as const;

/**
 * A pupil every school event could plausibly draw for. The seed is chosen so the
 * final graded year clears the 3.8 valedictorian gate; a new event gating on
 * anything this fixture does not carry has to be given it here.
 */
function student(reg: ContentRegistry): GameState {
  const state = createLife(reg, {
    seed: 11,
    firstName: 'Ada',
    lastName: 'Moreno',
    gender: 'female',
    countryId: 'us',
  });
  // A top student who studies rolls the 4.0 cap, so the GPA gate is not the variable.
  state.character.stats.smarts = 100;
  state.character.education.studyHard = true;
  return state;
}

function ctxFor(state: GameState, reg: ContentRegistry): Ctx {
  return { state, c: state.character, rng: createRng(state), reg };
}

/** Stands the character in `age` and runs the real ladder, as `ageUp` does before it draws. */
function liveYear(state: GameState, reg: ContentRegistry, age: number): void {
  state.character.age = age;
  educationPhase(ctxFor(state, reg));
}

/** True where `isEligible` would accept the def: it only refuses a hard `false`. */
function passes(def: EventDef, ctx: Ctx): boolean {
  return def.condition?.(ctx) !== false;
}

function eventById(id: string): EventDef {
  const def = SCHOOL_EVENTS.find((event) => event.id === id);
  if (!def) throw new Error(`education pack no longer ships "${id}"`);
  return def;
}

/** Walks the ladder to `age`, stopping after that year's education phase. */
function schooledTo(reg: ContentRegistry, age: number): GameState {
  const state = student(reg);
  for (let year = 1; year <= age; year += 1) liveYear(state, reg, year);
  return state;
}

describe('education pack school windows', () => {
  let reg: ContentRegistry;

  beforeEach(() => {
    resetRegistryForTests();
    reg = getRegistry();
  });

  it('ships school events, all of which declare a condition', () => {
    expect(SCHOOL_EVENTS.length).toBeGreaterThan(0);
    for (const def of SCHOOL_EVENTS) {
      expect(def.condition, `event "${def.id}" has no condition`).toBeTypeOf('function');
    }
  });

  it('accepts every school event at every age its window declares', () => {
    const state = student(reg);
    const eligibleAges = new Map<string, number[]>(SCHOOL_EVENTS.map((def) => [def.id, []]));

    for (let age = 1; age <= GRADUATION_AGE; age += 1) {
      liveYear(state, reg, age);
      const ctx = ctxFor(state, reg);
      for (const def of SCHOOL_EVENTS) {
        if (passes(def, ctx)) eligibleAges.get(def.id)?.push(age);
      }
    }

    for (const def of SCHOOL_EVENTS) {
      const live = eligibleAges.get(def.id) ?? [];
      for (let age = def.minAge; age <= def.maxAge; age += 1) {
        expect(live, `event "${def.id}" declares age ${age} but can never fire there`).toContain(
          age
        );
      }
    }
  });

  it('empties the desk in the graduation year, before any event is drawn', () => {
    const state = schooledTo(reg, GRADUATION_AGE);

    expect(state.character.education.level).toBe('high');
    expect(state.character.education.enrolledIn).toBeUndefined();
    // The last graded year's GPA stands: graduation does not re-roll it.
    expect(state.character.education.gpa).toBeGreaterThanOrEqual(3.8);
  });

  it('still offers the graduation-year events to a graduate at 18', () => {
    const state = schooledTo(reg, GRADUATION_AGE);
    const ctx = ctxFor(state, reg);
    const before = state.rngState;

    for (const id of GRADUATION_YEAR_EVENTS) {
      expect(passes(eventById(id), ctx), `event "${id}" refused in the graduation year`).toBe(true);
    }

    // Eligibility is decided before `eventsPhase` rolls anything, so it stays draw-free.
    for (const def of SCHOOL_EVENTS) passes(def, ctx);
    expect(state.rngState).toBe(before);
  });

  it('refuses the graduation-year events to a dropout, a prisoner and a 19-year-old', () => {
    /* Left in the last school year, so the 4.0 still stands: only the missing
       diploma may keep them out of the graduation-year moments. */
    const dropout = schooledTo(reg, 17);
    dropOut(dropout);
    dropout.character.age = GRADUATION_AGE;

    const inside = schooledTo(reg, GRADUATION_AGE);
    inside.character.prison = { crime: 'crime-assault', yearsLeft: 2, totalYears: 3 };

    const older = schooledTo(reg, GRADUATION_AGE);
    older.character.age = GRADUATION_AGE + 1;

    for (const [label, state] of [
      ['dropout', dropout],
      ['prisoner', inside],
      ['19-year-old', older],
    ] as const) {
      const ctx = ctxFor(state, reg);
      for (const id of GRADUATION_YEAR_EVENTS) {
        expect(passes(eventById(id), ctx), `event "${id}" offered to a ${label}`).toBe(false);
      }
    }
  });
});

/**
 * The ratchet the job packs have to enforce themselves.
 *
 * `jobRequirementsMet` reads the rung's own `req` and never walks `prevJobId`,
 * while promotion ignores `req` altogether. A gate left off a rung is therefore
 * a hole rather than an inherited minimum: whoever merit lifts onto the rung
 * below can apply straight through it with stats that rung would refuse.
 */

const ED_ORDER: readonly EdLevel[] = [
  'none',
  'primary',
  'middle',
  'high',
  'university',
  'postgrad',
];

/** Schooling rank, with "asks for none" ranking below every level. */
function edRank(level: EdLevel | undefined): number {
  return level === undefined ? 0 : ED_ORDER.indexOf(level);
}

function jobById(reg: ContentRegistry, id: string): JobDef {
  const byId: Record<string, JobDef | undefined> = reg.jobsById;
  const def = byId[id];
  if (!def) throw new Error(`the job packs no longer ship "${id}"`);
  return def;
}

/** A 30-year-old graduate sitting on `heldId` with stats no gate can refuse. */
function holderOf(reg: ContentRegistry, heldId: string): GameState {
  const state = createLife(reg, {
    seed: 5,
    firstName: 'Ivo',
    lastName: 'Renn',
    gender: 'male',
    countryId: 'us',
  });
  const c = state.character;
  const held = jobById(reg, heldId);
  c.age = 30;
  c.education.level = 'university';
  c.stats.smarts = 100;
  c.stats.looks = 100;
  c.job = {
    jobId: held.id,
    title: held.title,
    salary: held.baseSalary,
    years: 3,
    performance: 60,
    workHard: false,
  };
  return state;
}

describe('job ladder gates', () => {
  let reg: ContentRegistry;

  beforeEach(() => {
    resetRegistryForTests();
    reg = getRegistry();
  });

  it('never offers a rung on easier terms than the rung below it', () => {
    for (const below of reg.jobs) {
      if (below.promotesTo === undefined) continue;
      const above = jobById(reg, below.promotesTo);
      const edge = `"${above.id}" sits on "${below.id}"`;

      expect(above.req.minAge ?? 0, `${edge}: minAge`).toBeGreaterThanOrEqual(
        below.req.minAge ?? 0
      );
      expect(edRank(above.req.education), `${edge}: education`).toBeGreaterThanOrEqual(
        edRank(below.req.education)
      );
      expect(above.req.minSmarts ?? 0, `${edge}: minSmarts`).toBeGreaterThanOrEqual(
        below.req.minSmarts ?? 0
      );
      expect(above.req.minLooks ?? 0, `${edge}: minLooks`).toBeGreaterThanOrEqual(
        below.req.minLooks ?? 0
      );
    }
  });

  it('refuses the rung above to stats the rung below turns away', () => {
    for (const [heldId, aboveId, stat] of [
      ['job-electrician', 'job-master-electrician', 'smarts'],
      ['job-sales-rep', 'job-account-exec', 'looks'],
      ['job-account-exec', 'job-sales-vp', 'looks'],
    ] as const) {
      const below = jobById(reg, heldId).req;
      const floor = stat === 'smarts' ? below.minSmarts : below.minLooks;
      if (floor === undefined) throw new Error(`"${heldId}" no longer gates ${stat}`);

      // Promotion ignores `req`, so this is a seat a character can hold on merit.
      const state = holderOf(reg, heldId);
      state.character.stats[stat] = floor - 1;

      const gate = jobRequirementsMet(state, reg, jobById(reg, aboveId));
      expect(gate.ok, `"${aboveId}" accepted ${stat} that "${heldId}" refuses`).toBe(false);
    }
  });
});
