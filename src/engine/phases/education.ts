/**
 * Education phase plus the player actions that drive schooling.
 *
 * `EducationState.level` records the highest level *completed*; the school the
 * character currently attends lives in `enrolledIn`. Primary, middle and high
 * school are enrolled automatically at fixed ages from whichever school in the
 * registry carries that level; universities and postgrad programmes are opted
 * into through `applyToSchool`.
 */

import { currentYearLog } from '@/engine/ageUp';
import { clampStat } from '@/engine/effects';
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

/** Yearly price of studying hard, and what it buys. */
const STUDY_HAPPINESS_COST = 2;
const STUDY_SMARTS_GAIN = 1;

/** Set while a degree is being financed so the loan notice is logged only once. */
const LOAN_NOTICE_FLAG = 'studentLoanLogged';

/** Ranking used for "at least this much schooling" checks. */
const LEVEL_ORDER: Record<EdLevel, number> = {
  none: 0,
  primary: 1,
  middle: 2,
  high: 3,
  university: 4,
  postgrad: 5,
};

function hasAtLeast(level: EdLevel, needed: EdLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[needed];
}

/* Registry maps are typed as total records, so widen before lookup: a hand-built
   or partially loaded registry can still miss the id we ask for. */
function findSchool(reg: ContentRegistry, id: string): SchoolDef | undefined {
  const byId: Record<string, SchoolDef | undefined> = reg.schoolsById;
  return byId[id] ?? reg.schools.find((school) => school.id === id);
}

/** Content guarantees exactly one school per compulsory level. */
function schoolAtLevel(reg: ContentRegistry, level: EdLevel): SchoolDef | undefined {
  return reg.schools.find((school) => school.level === level);
}

function isDegree(def: SchoolDef): boolean {
  return def.level === 'university' || def.level === 'postgrad';
}

/** A GPA of 0 means it was never graded, not a failing student, so it passes. */
function gpaTooLow(ed: EducationState, def: SchoolDef): boolean {
  const minGpa = def.minGpa;
  return minGpa !== undefined && ed.gpa > 0 && ed.gpa < minGpa;
}

/** Records a finished level and empties the desk. */
function completeLevel(ed: EducationState, level: EdLevel): void {
  ed.level = level;
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
  const bounded = Math.min(GPA_MAX, Math.max(0, raw));
  return Math.round(bounded * 100) / 100;
}

/** The age-driven ladder from elementary school through a high school diploma. */
function advanceCompulsory(ctx: Ctx): LogEntry[] {
  const entries: LogEntry[] = [];
  const c = ctx.state.character;
  const ed = c.education;
  const reg = ctx.reg;
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
      c.money = Math.max(0, Math.round(c.money - tuition));
    } else {
      c.loans.push({
        id: `l${c.loans.length + 1}-${c.age}`,
        kind: 'student',
        principal: tuition,
        apr: STUDENT_LOAN_APR,
      });
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

  const entries =
    enrolled && isDegree(enrolled) ? advanceDegree(ctx, enrolled) : advanceCompulsory(ctx);

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
  const c = state.character;
  const ed = c.education;
  const def = findSchool(reg, schoolId);

  if (!def) return { ok: false, reason: 'That school does not exist.' };
  if (!isDegree(def)) return { ok: false, reason: 'That school enrols by age.' };
  if (ed.enrolledIn !== undefined) return { ok: false, reason: 'You are already in school.' };

  if (def.level === 'university') {
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
  state.character.education.studyHard = on;
}
