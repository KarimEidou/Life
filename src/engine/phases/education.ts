/**
 * Education phase plus the player actions that drive schooling.
 *
 * `EducationState.level` records the highest level *completed*; the school the
 * character currently attends lives in `enrolledIn`. Primary, middle and high
 * school are enrolled automatically at fixed ages from whichever school in the
 * registry carries that level; universities and postgrad programmes are opted
 * into through `applyToSchool`.
 */

import { clampMoney, clampStat } from '@/engine/effects';
import { currentYearLog } from '@/engine/log';
/* Finance owns loans, and student debt shares the id counter with every other
   loan, so the id comes from there rather than from a second minting rule. */
import { mintLoanId } from '@/engine/phases/finance';
import { findById } from '@/engine/registry';
import { LEVEL_ORDER, hasAtLeast, isDegreeLevel } from '@/engine/rules';
import { LIFE_OVER, lifeIsOver } from '@/engine/state';
import type {
  ContentRegistry,
  Ctx,
  EdLevel,
  EducationState,
  GameState,
  LogEntry,
  SchoolDef,
} from '@/types';

/** Ages the compulsory ladder turns over on. */
const PRIMARY_START = 6;
const MIDDLE_START = 11;
const HIGH_START = 14;
const HIGH_END = 18;

/** Youngest a university will consider an applicant. */
const UNIVERSITY_MIN_AGE = 17;

const STUDENT_LOAN_APR = 0.05;

/** GPA = floor + what smarts buy + an effort bonus + noise, capped at 4.0. */
const GPA_FLOOR = 0.3;
const GPA_SMARTS_SPAN = 3.4;
const GPA_STUDY_BONUS = 0.4;
const GPA_SD = 0.2;
const GPA_MAX = 4;

/**
 * Lowest grade a graded year can record: one step of the two-decimal grid
 * `rollGpa` rounds onto, because 0 is `gpaTooLow`'s "never graded" sentinel.
 */
const GPA_MIN_GRADED = 0.01;

/** Yearly price of studying hard, and what it buys. */
const STUDY_HAPPINESS_COST = 2;
const STUDY_SMARTS_GAIN = 1;

/** Set while a degree is being financed so the loan notice is logged only once. */
const LOAN_NOTICE_FLAG = 'studentLoanLogged';

function findSchool(reg: ContentRegistry, id: string): SchoolDef | undefined {
  return findById(reg.schoolsById, reg.schools, id);
}

/** Content guarantees exactly one school per compulsory level. */
function schoolAtLevel(reg: ContentRegistry, level: EdLevel): SchoolDef | undefined {
  return reg.schools.find((school) => school.level === level);
}

/**
 * A GPA of 0 means it was never graded, not a failing student, so it passes.
 *
 * `rollGpa` floors at `GPA_MIN_GRADED` precisely so a real transcript can never
 * land on that sentinel. Back when the roll could reach 0.00 this refusal was
 * non-monotonic: 0.01 was turned away and 0.00 — strictly worse — was admitted,
 * so a dead-last student was the only applicant no minimum could stop.
 */
function gpaTooLow(ed: EducationState, def: SchoolDef): boolean {
  const minGpa = def.minGpa;
  return minGpa !== undefined && ed.gpa > 0 && ed.gpa < minGpa;
}

/**
 * Records a finished level and empties the desk.
 *
 * `EducationState.level` is the *highest* level completed, so it only ever
 * ratchets upwards: finishing a bachelor's after a postgrad degree adds a
 * qualification, it does not revoke one, and a job gated on `postgrad` must stay
 * open. The desk is emptied either way — the programme really did end.
 */
function completeLevel(ed: EducationState, level: EdLevel): void {
  if (LEVEL_ORDER[level] > LEVEL_ORDER[ed.level]) ed.level = level;
  ed.enrolledIn = undefined;
  ed.year = 0;
}

/**
 * Enrols in a compulsory school, unless the character already sits somewhere or
 * has left school for good. Returns the entry to log, or nothing when skipped.
 */
function startSchool(ctx: Ctx, def: SchoolDef | undefined, text: string): LogEntry | undefined {
  const c = ctx.state.character;
  if (!def || c.education.enrolledIn !== undefined || c.flags.droppedOut === true) {
    return undefined;
  }
  c.education.enrolledIn = def.id;
  c.education.year = 0;
  return { icon: '🏫', kind: 'info', text };
}

function rollGpa(ctx: Ctx): number {
  const c = ctx.state.character;
  const raw =
    GPA_FLOOR +
    (c.stats.smarts / 100) * GPA_SMARTS_SPAN +
    (c.education.studyHard ? GPA_STUDY_BONUS : 0) +
    ctx.rng.normal(0, GPA_SD);
  const bounded = Math.min(GPA_MAX, Math.max(GPA_MIN_GRADED, raw));
  return Math.round(bounded * 100) / 100;
}

/** The age-driven ladder from elementary school through a high school diploma. */
function advanceCompulsory(ctx: Ctx): LogEntry[] {
  const entries: LogEntry[] = [];
  const c = ctx.state.character;
  const ed = c.education;
  const reg = ctx.reg;
  const deskBefore = ed.enrolledIn;
  const primary = schoolAtLevel(reg, 'primary');
  const middle = schoolAtLevel(reg, 'middle');
  const high = schoolAtLevel(reg, 'high');

  if (c.age === PRIMARY_START) {
    const entry = startSchool(ctx, primary, 'You started elementary school.');
    if (entry) entries.push(entry);
  } else if (c.age === MIDDLE_START) {
    if (primary && ed.enrolledIn === primary.id) completeLevel(ed, 'primary');
    const entry = startSchool(ctx, middle, 'You started middle school.');
    if (entry) entries.push(entry);
  } else if (c.age === HIGH_START) {
    if (middle && ed.enrolledIn === middle.id) completeLevel(ed, 'middle');
    const entry = startSchool(ctx, high, 'You started high school.');
    if (entry) entries.push(entry);
  } else if (c.age === HIGH_END && high && ed.enrolledIn === high.id) {
    completeLevel(ed, 'high');
    entries.push({ icon: '🎓', kind: 'good', text: 'You graduated high school.' });
  }

  /* A year sat at the same desk is a year of that programme, exactly as it is
     for a degree. Only an unchanged desk counts: `startSchool` and
     `completeLevel` have just written the 0 that belongs to whichever rung this
     year moved to, so a first year still reads as year 1 of its school. Without
     this the counter never left 0 and all twelve compulsory years reported
     themselves as "Year 1 of N". No draw is spent either way. */
  if (ed.enrolledIn !== undefined && ed.enrolledIn === deskBefore) ed.year += 1;

  return entries;
}

/** One year of a university or postgrad programme: tuition, then the diploma. */
function advanceDegree(ctx: Ctx, def: SchoolDef): LogEntry[] {
  const entries: LogEntry[] = [];
  const c = ctx.state.character;
  const ed = c.education;

  ed.year += 1;

  const tuition = Math.round(def.tuitionPerYear);
  if (tuition > 0) {
    if (c.money >= tuition) {
      /* `clampMoney`, never `Math.max(0, ...)`: an unreadable balance clears the
         affordability check above (`Infinity >= tuition`), so this is the write
         that has to settle it. See `clampMoney`'s own comment. */
      c.money = clampMoney(c.money - tuition, c.money);
    } else {
      /* One accumulating student debt, not one record per school year: minting a
         fresh loan every year left a four-year degree owing four separate
         debts, which the finance phase then paid off in the same year and
         announced four times over with the same sentence. */
      const held = c.loans.find((loan) => loan.kind === 'student');
      if (held) {
        held.principal += tuition;
      } else {
        c.loans.push({
          id: mintLoanId(c),
          kind: 'student',
          principal: tuition,
          apr: STUDENT_LOAN_APR,
        });
      }
      if (c.flags[LOAN_NOTICE_FLAG] !== true) {
        c.flags[LOAN_NOTICE_FLAG] = true;
        entries.push({ icon: '🏦', kind: 'money', text: 'You took a student loan.' });
      }
    }
  }

  if (ed.year >= def.years) {
    // The major earned with the bachelor's is kept; postgrad only tags the school.
    completeLevel(ed, def.level);
    c.flags[LOAN_NOTICE_FLAG] = false;
    if (def.level === 'postgrad') c.flags.postgradId = def.id;
    entries.push({ icon: '🎓', kind: 'good', text: `You earned your ${def.label} degree.` });
  }

  return entries;
}

/** Auto-enrols compulsory schooling, advances the school year, updates GPA and graduates. */
export function educationPhase(ctx: Ctx): LogEntry[] {
  const c = ctx.state.character;
  const ed = c.education;
  const enrolled = ed.enrolledIn !== undefined ? findSchool(ctx.reg, ed.enrolledIn) : undefined;

  /* A save can outlive the content that defined the school it sits in. Nothing
     downstream can move a desk no def describes: `advanceDegree` has no tuition,
     length or label to work from, and the compulsory ladder refuses to enrol
     anyone whose desk is still occupied, so the character would stay "in school"
     for the rest of the life — never graduating, never re-enrolling, and refused
     by `applyToSchool` every time. The desk is emptied instead, which hands the
     character back to the ladder. `level` and `major` are what was actually
     earned, so they stand; the level ratchet never moves backwards. Like
     `ageUp`'s `discardPending`, this consumes no randomness, so the surrounding
     sequence is untouched and the year replays identically. */
  if (ed.enrolledIn !== undefined && !enrolled) {
    ed.enrolledIn = undefined;
    ed.year = 0;
  }

  const entries =
    enrolled && isDegreeLevel(enrolled.level)
      ? advanceDegree(ctx, enrolled)
      : advanceCompulsory(ctx);

  // Grades and study drift belong to whatever school the year ends inside.
  if (ed.enrolledIn !== undefined) {
    ed.gpa = rollGpa(ctx);
    if (ed.studyHard) {
      c.stats.happiness = clampStat(c.stats.happiness - STUDY_HAPPINESS_COST);
      c.stats.smarts = clampStat(c.stats.smarts + STUDY_SMARTS_GAIN);
    }
  }

  return entries;
}

/** Checks admission (age, prior level, GPA, tuition) and enrols on success. */
export function applyToSchool(
  state: GameState,
  reg: ContentRegistry,
  schoolId: string,
  major?: string
): { ok: boolean; reason?: string } {
  // A finished life is read-only; see `lifeIsOver`.
  if (lifeIsOver(state)) return { ok: false, reason: LIFE_OVER };

  const c = state.character;
  /* Nobody matriculates from a cell: the refusal `jobRequirementsMet` gives a
     would-be hire, in the same words. A sentence keeps an enrolment that already
     existed — `careerPhase` hands those years to this phase — but it ends
     attendance, and the Education sheet stays reachable throughout, so without
     this a prisoner enrolled and `advanceDegree` billed tuition, or minted
     student debt against someone with no income to service it, for every year of
     the sentence. Placed above the desk heal below so a refusal writes nothing. */
  if (c.prison) return { ok: false, reason: "You're in prison." };

  const ed = c.education;
  const def = findSchool(reg, schoolId);

  if (!def) return { ok: false, reason: 'That school does not exist.' };
  if (!isDegreeLevel(def.level)) return { ok: false, reason: 'That school enrols by age.' };

  /* The same reconciliation `educationPhase` performs, because a save is loaded
     into the Education sheet long before the next `ageUp` runs it: a desk no def
     describes is not a desk. Without it the refusal below is exactly the
     "refused by `applyToSchool` every time" dead end that heal exists to
     prevent, and the sheet hides its Drop out button for the same unresolvable
     id, so nothing on screen can reconcile the two. Emptying the desk is not
     dropping out — `level` and `major` stand and the compulsory ladder still
     picks a child up at the next rung. Consumes no randomness, like the phase's
     heal, so replay is untouched. */
  if (ed.enrolledIn !== undefined && !findSchool(reg, ed.enrolledIn)) {
    ed.enrolledIn = undefined;
    ed.year = 0;
  }
  if (ed.enrolledIn !== undefined) return { ok: false, reason: 'You are already in school.' };

  if (def.level === 'university') {
    /* A level already held cannot be advanced by sitting it again, so the
       applicant is turned away rather than charged four years of tuition for
       nothing. Checked before the diploma gate, which a graduate always passes. */
    if (hasAtLeast(ed.level, 'university')) {
      return { ok: false, reason: 'You already have a degree.' };
    }
    if (!hasAtLeast(ed.level, 'high')) {
      return { ok: false, reason: 'You need a high school diploma.' };
    }
    if (c.age < UNIVERSITY_MIN_AGE) return { ok: false, reason: 'You are too young.' };
    if (gpaTooLow(ed, def)) return { ok: false, reason: 'Your GPA is too low.' };
    const majors = def.majors;
    if (majors && majors.length > 0) {
      if (major === undefined) return { ok: false, reason: 'Pick a major.' };
      if (!majors.includes(major)) return { ok: false, reason: 'That major is not offered.' };
    }
  } else {
    // Same rule one rung up; see the university branch.
    if (hasAtLeast(ed.level, 'postgrad')) {
      return { ok: false, reason: 'You already have a postgraduate degree.' };
    }
    if (!hasAtLeast(ed.level, 'university')) {
      return { ok: false, reason: 'You need a degree first.' };
    }
    if (gpaTooLow(ed, def)) return { ok: false, reason: 'Your GPA is too low.' };
    /* Reinterpretation: on a postgrad school `majors` lists the undergrad majors
       it accepts, not majors it teaches, so it is matched against the degree the
       character already holds. */
    const accepted = def.majors;
    if (accepted && accepted.length > 0) {
      const held = ed.major;
      if (held === undefined || !accepted.includes(held)) {
        return { ok: false, reason: 'Your major does not qualify.' };
      }
    }
  }

  ed.enrolledIn = def.id;
  ed.year = 0;
  if (def.level === 'university' && major !== undefined) ed.major = major;
  c.flags[LOAN_NOTICE_FLAG] = false;
  currentYearLog(state).entries.push({
    icon: '🎓',
    kind: 'info',
    text: `You enrolled at ${def.label}.`,
  });
  return { ok: true };
}

/** Leaves the current school without completing it; the level stays as it was. */
export function dropOut(state: GameState): void {
  // A finished life is read-only; see `lifeIsOver`.
  if (lifeIsOver(state)) return;

  const c = state.character;
  const ed = c.education;
  if (ed.enrolledIn === undefined) return;

  ed.enrolledIn = undefined;
  ed.year = 0;
  /* No registry here: anything abandoned before a diploma is compulsory school,
     and that is the only case the ladder must stop re-enrolling. */
  if (!hasAtLeast(ed.level, 'high')) c.flags.droppedOut = true;
  currentYearLog(state).entries.push({ icon: '🚪', kind: 'bad', text: 'You dropped out.' });
}

/** Toggles studying hard: better GPA at the cost of happiness. */
export function setStudyHard(state: GameState, on: boolean): void {
  // A finished life is read-only; see `lifeIsOver`.
  if (lifeIsOver(state)) return;

  state.character.education.studyHard = on;
}
