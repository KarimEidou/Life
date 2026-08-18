import { describe, expect, it, vi } from 'vitest';

import type {
  Character,
  ContentRegistry,
  Ctx,
  GameState,
  SchoolDef,
  YearLog,
} from '@/types';

/* Mocked so these tests never load the whole phase chain `ageUp` imports; the
   stand-in mirrors its contract (last year log, created for this age when empty). */
vi.mock('@/engine/ageUp', () => ({
  currentYearLog: (state: GameState): YearLog => {
    const last = state.log[state.log.length - 1];
    if (last) return last;
    const fresh: YearLog = { age: state.character.age, year: state.year, entries: [] };
    state.log.push(fresh);
    return fresh;
  },
}));

import { applyToSchool, dropOut, educationPhase, setStudyHard } from '@/engine/phases/education';
import { createRng, initialRngState } from '@/engine/rng';

const PRIMARY: SchoolDef = {
  id: 'ps',
  label: 'Sunnyside Elementary',
  level: 'primary',
  years: 5,
  tuitionPerYear: 0,
};
const MIDDLE: SchoolDef = {
  id: 'ms',
  label: 'Sunnyside Middle',
  level: 'middle',
  years: 3,
  tuitionPerYear: 0,
};
const HIGH: SchoolDef = {
  id: 'hs',
  label: 'Sunnyside High',
  level: 'high',
  years: 4,
  tuitionPerYear: 0,
};
const UNI: SchoolDef = {
  id: 'uni',
  label: 'State University',
  level: 'university',
  years: 4,
  tuitionPerYear: 15000,
  majors: ['cs', 'biology'],
  minGpa: 2,
};
const MED: SchoolDef = {
  id: 'med',
  label: 'Medical School',
  level: 'postgrad',
  years: 4,
  tuitionPerYear: 25000,
  majors: ['biology'],
};

// Hand-rolled fixtures: `buildRegistry` and `createLife` belong to other modules.
function makeRegistry(): ContentRegistry {
  const schools = [PRIMARY, MIDDLE, HIGH, UNI, MED];
  const schoolsById: Record<string, SchoolDef> = {};
  for (const school of schools) schoolsById[school.id] = school;
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
    schools,
    schoolsById,
    countries: [],
    countriesById: {},
    crimes: [],
    crimesById: {},
    achievements: [],
    achievementsById: {},
    namePools: {},
  };
}

function makeCharacter(over: Partial<Character> = {}): Character {
  return {
    id: 'me',
    firstName: 'Ada',
    lastName: 'Moreno',
    gender: 'female',
    pronouns: { sub: 'she', obj: 'her', pos: 'her' },
    countryId: 'us',
    age: 6,
    stats: { health: 80, happiness: 60, smarts: 50, looks: 50 },
    money: 0,
    education: { level: 'none', year: 0, gpa: 0, studyHard: false },
    job: null,
    prison: null,
    assets: [],
    loans: [],
    investments: { savings: 0, index: 0, crypto: 0 },
    illnesses: [],
    addictions: {},
    fame: 0,
    flags: {},
    ...over,
  };
}

const SEED = 11;

function makeState(over: Partial<Character> = {}, seed = SEED): GameState {
  const character = makeCharacter(over);
  return {
    rngState: initialRngState(seed),
    seed,
    generation: 1,
    year: 2025,
    character,
    people: {},
    log: [{ age: character.age, year: 2025, entries: [] }],
    pending: [],
    firedEvents: [],
    interactionUse: {},
    ancestors: [],
    phase: 'alive',
  };
}

function makeCtx(state: GameState, reg: ContentRegistry): Ctx {
  return { state, c: state.character, rng: createRng(state), reg };
}

function lastEntries(state: GameState): YearLog['entries'] {
  const last = state.log[state.log.length - 1];
  return last ? last.entries : [];
}

describe('educationPhase compulsory ladder', () => {
  it('starts elementary school at 6', () => {
    const state = makeState({ age: 6 });

    const entries = educationPhase(makeCtx(state, makeRegistry()));

    expect(state.character.education.enrolledIn).toBe('ps');
    expect(state.character.education.level).toBe('none');
    expect(entries).toEqual([
      { icon: '🏫', kind: 'info', text: 'You started elementary school.' },
    ]);
  });

  it('finishes primary and starts middle school at 11', () => {
    const state = makeState({
      age: 11,
      education: { level: 'none', enrolledIn: 'ps', year: 0, gpa: 3.1, studyHard: false },
    });

    const entries = educationPhase(makeCtx(state, makeRegistry()));

    expect(state.character.education.level).toBe('primary');
    expect(state.character.education.enrolledIn).toBe('ms');
    expect(entries).toEqual([{ icon: '🏫', kind: 'info', text: 'You started middle school.' }]);
  });

  it('finishes middle and starts high school at 14', () => {
    const state = makeState({
      age: 14,
      education: { level: 'primary', enrolledIn: 'ms', year: 0, gpa: 3.1, studyHard: false },
    });

    const entries = educationPhase(makeCtx(state, makeRegistry()));

    expect(state.character.education.level).toBe('middle');
    expect(state.character.education.enrolledIn).toBe('hs');
    expect(entries).toEqual([{ icon: '🏫', kind: 'info', text: 'You started high school.' }]);
  });

  it('graduates high school at 18 and leaves the last GPA standing', () => {
    const state = makeState({
      age: 18,
      education: { level: 'middle', enrolledIn: 'hs', year: 0, gpa: 3.42, studyHard: false },
    });

    const entries = educationPhase(makeCtx(state, makeRegistry()));

    expect(state.character.education.level).toBe('high');
    expect(state.character.education.enrolledIn).toBeUndefined();
    expect(state.character.education.gpa).toBe(3.42);
    expect(entries).toEqual([{ icon: '🎓', kind: 'good', text: 'You graduated high school.' }]);
  });

  it('leaves quiet years alone', () => {
    const state = makeState({
      age: 9,
      education: { level: 'none', enrolledIn: 'ps', year: 0, gpa: 2, studyHard: false },
    });

    const entries = educationPhase(makeCtx(state, makeRegistry()));

    expect(entries).toEqual([]);
    expect(state.character.education.enrolledIn).toBe('ps');
  });

  it('never re-enrols a dropout', () => {
    const state = makeState({
      age: 14,
      education: { level: 'middle', year: 0, gpa: 2.5, studyHard: false },
      flags: { droppedOut: true },
    });

    const entries = educationPhase(makeCtx(state, makeRegistry()));

    expect(state.character.education.enrolledIn).toBeUndefined();
    expect(entries).toEqual([]);
  });
});

describe('educationPhase grades', () => {
  it('matches the GPA formula for the year draw', () => {
    const state = makeState({
      age: 9,
      stats: { health: 80, happiness: 60, smarts: 60, looks: 50 },
      education: { level: 'none', enrolledIn: 'ps', year: 0, gpa: 0, studyHard: false },
    });
    const mirror = { rngState: state.rngState };
    const noise = createRng(mirror).normal(0, 0.2);

    educationPhase(makeCtx(state, makeRegistry()));

    const expected = Math.round((0.3 + (60 / 100) * 3.4 + noise) * 100) / 100;
    expect(state.character.education.gpa).toBe(expected);
    expect(state.rngState).toBe(mirror.rngState);
  });

  it('keeps the GPA inside 0..4 at both extremes and rounds to two decimals', () => {
    for (const smarts of [0, 100]) {
      const state = makeState({
        age: 9,
        stats: { health: 80, happiness: 60, smarts, looks: 50 },
        education: { level: 'none', enrolledIn: 'ps', year: 0, gpa: 0, studyHard: true },
      });

      educationPhase(makeCtx(state, makeRegistry()));

      const gpa = state.character.education.gpa;
      expect(gpa).toBeGreaterThanOrEqual(0);
      expect(gpa).toBeLessThanOrEqual(4);
      expect(gpa).toBe(Math.round(gpa * 100) / 100);
    }
  });

  it('does not grade a year spent out of school', () => {
    const state = makeState({
      age: 30,
      education: { level: 'high', year: 0, gpa: 2.5, studyHard: true },
    });

    educationPhase(makeCtx(state, makeRegistry()));

    expect(state.character.education.gpa).toBe(2.5);
    expect(state.character.stats.happiness).toBe(60);
    expect(state.character.stats.smarts).toBe(50);
  });

  it('trades happiness for smarts and a better GPA when studying hard', () => {
    const slacker = makeState({
      age: 9,
      stats: { health: 80, happiness: 60, smarts: 50, looks: 50 },
      education: { level: 'none', enrolledIn: 'ps', year: 0, gpa: 0, studyHard: false },
    });
    const grinder = makeState({
      age: 9,
      stats: { health: 80, happiness: 60, smarts: 50, looks: 50 },
      education: { level: 'none', enrolledIn: 'ps', year: 0, gpa: 0, studyHard: true },
    });

    educationPhase(makeCtx(slacker, makeRegistry()));
    educationPhase(makeCtx(grinder, makeRegistry()));

    expect(slacker.character.stats.happiness).toBe(60);
    expect(slacker.character.stats.smarts).toBe(50);
    expect(grinder.character.stats.happiness).toBe(58);
    expect(grinder.character.stats.smarts).toBe(51);
    // Same seed, same noise: the whole gap is the effort bonus.
    expect(grinder.character.education.gpa).toBeCloseTo(slacker.character.education.gpa + 0.4, 2);
  });
});

describe('applyToSchool', () => {
  const graduate = (over: Partial<Character> = {}): GameState =>
    makeState({
      age: 18,
      education: { level: 'high', year: 0, gpa: 3, studyHard: false },
      ...over,
    });

  it('rejects an unknown school', () => {
    const state = graduate();
    expect(applyToSchool(state, makeRegistry(), 'nope')).toEqual({
      ok: false,
      reason: expect.any(String),
    });
  });

  it('rejects schools that enrol by age', () => {
    const state = graduate();
    const result = applyToSchool(state, makeRegistry(), 'hs');
    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it('rejects an applicant who is already in school', () => {
    const state = graduate({
      education: { level: 'high', enrolledIn: 'uni', year: 1, gpa: 3, studyHard: false },
    });
    const result = applyToSchool(state, makeRegistry(), 'uni', 'cs');
    expect(result.ok).toBe(false);
    expect(state.character.education.year).toBe(1);
  });

  it('rejects an applicant without a high school diploma', () => {
    const state = graduate({ education: { level: 'middle', year: 0, gpa: 3, studyHard: false } });
    const result = applyToSchool(state, makeRegistry(), 'uni', 'cs');
    expect(result).toEqual({ ok: false, reason: 'You need a high school diploma.' });
  });

  it('rejects an applicant who is too young', () => {
    const state = graduate({ age: 16 });
    const result = applyToSchool(state, makeRegistry(), 'uni', 'cs');
    expect(result).toEqual({ ok: false, reason: 'You are too young.' });
  });

  it('rejects a GPA below the bar', () => {
    const state = graduate({ education: { level: 'high', year: 0, gpa: 1.5, studyHard: false } });
    const result = applyToSchool(state, makeRegistry(), 'uni', 'cs');
    expect(result).toEqual({ ok: false, reason: 'Your GPA is too low.' });
  });

  it('treats an ungraded transcript as a pass', () => {
    const state = graduate({ education: { level: 'high', year: 0, gpa: 0, studyHard: false } });
    expect(applyToSchool(state, makeRegistry(), 'uni', 'biology')).toEqual({ ok: true });
  });

  it('requires a major the university actually offers', () => {
    const noMajor = applyToSchool(graduate(), makeRegistry(), 'uni');
    expect(noMajor).toEqual({ ok: false, reason: 'Pick a major.' });

    const wrongMajor = applyToSchool(graduate(), makeRegistry(), 'uni', 'art');
    expect(wrongMajor).toEqual({ ok: false, reason: 'That major is not offered.' });
  });

  it('enrols, records the major and logs the year entry', () => {
    const state = graduate();

    expect(applyToSchool(state, makeRegistry(), 'uni', 'cs')).toEqual({ ok: true });

    const ed = state.character.education;
    expect(ed.enrolledIn).toBe('uni');
    expect(ed.year).toBe(0);
    expect(ed.major).toBe('cs');
    expect(ed.level).toBe('high');
    expect(lastEntries(state)).toEqual([
      { icon: '🎓', kind: 'info', text: 'You enrolled at State University.' },
    ]);
  });

  it('gates postgrad on a degree with an accepted undergrad major', () => {
    const reg = makeRegistry();

    const noDegree = makeState({
      age: 24,
      education: { level: 'high', year: 0, gpa: 3.5, studyHard: false },
    });
    expect(applyToSchool(noDegree, reg, 'med')).toEqual({
      ok: false,
      reason: 'You need a degree first.',
    });

    const wrongMajor = makeState({
      age: 24,
      education: { level: 'university', major: 'cs', year: 0, gpa: 3.5, studyHard: false },
    });
    expect(applyToSchool(wrongMajor, reg, 'med')).toEqual({
      ok: false,
      reason: 'Your major does not qualify.',
    });

    const accepted = makeState({
      age: 24,
      education: { level: 'university', major: 'biology', year: 0, gpa: 3.5, studyHard: false },
    });
    expect(applyToSchool(accepted, reg, 'med')).toEqual({ ok: true });
    expect(accepted.character.education.enrolledIn).toBe('med');
    // The bachelor's major is what a postgrad school matched on; it is kept.
    expect(accepted.character.education.major).toBe('biology');
  });
});

describe('degree years', () => {
  const student = (over: Partial<Character> = {}): GameState =>
    makeState({
      age: 18,
      money: 100000,
      education: { level: 'high', enrolledIn: 'uni', major: 'cs', year: 0, gpa: 3, studyHard: false },
      ...over,
    });

  it('bills tuition from cash while it lasts', () => {
    const state = student();

    const entries = educationPhase(makeCtx(state, makeRegistry()));

    expect(state.character.money).toBe(85000);
    expect(state.character.loans).toEqual([]);
    expect(state.character.education.year).toBe(1);
    expect(entries).toEqual([]);
  });

  it('takes a student loan when tuition is unaffordable and says so once', () => {
    const state = student({ money: 0, age: 19 });
    const reg = makeRegistry();

    const first = educationPhase(makeCtx(state, reg));
    expect(state.character.loans).toEqual([
      { id: 'l1-19', kind: 'student', principal: 15000, apr: 0.05 },
    ]);
    expect(first).toEqual([{ icon: '🏦', kind: 'money', text: 'You took a student loan.' }]);

    state.character.age = 20;
    const second = educationPhase(makeCtx(state, reg));
    expect(state.character.loans).toHaveLength(2);
    expect(state.character.loans[1]?.id).toBe('l2-20');
    expect(second).toEqual([]);
  });

  it('graduates after the programme length and keeps the major', () => {
    const state = student();
    const reg = makeRegistry();

    for (let i = 0; i < 3; i += 1) {
      const entries = educationPhase(makeCtx(state, reg));
      expect(entries).toEqual([]);
      state.character.age += 1;
    }
    const final = educationPhase(makeCtx(state, reg));

    const ed = state.character.education;
    expect(ed.level).toBe('university');
    expect(ed.enrolledIn).toBeUndefined();
    expect(ed.year).toBe(0);
    expect(ed.major).toBe('cs');
    expect(state.character.money).toBe(100000 - 4 * 15000);
    expect(final).toEqual([
      { icon: '🎓', kind: 'good', text: 'You earned your State University degree.' },
    ]);
  });

  it('tags the school when a postgrad programme is finished', () => {
    const state = makeState({
      age: 24,
      money: 200000,
      education: {
        level: 'university',
        enrolledIn: 'med',
        major: 'biology',
        year: 3,
        gpa: 3.6,
        studyHard: false,
      },
    });

    const entries = educationPhase(makeCtx(state, makeRegistry()));

    expect(state.character.education.level).toBe('postgrad');
    expect(state.character.flags.postgradId).toBe('med');
    expect(entries).toEqual([
      { icon: '🎓', kind: 'good', text: 'You earned your Medical School degree.' },
    ]);
  });

  it('lets a fresh loan notice fire for the next degree', () => {
    const state = makeState({
      age: 22,
      money: 0,
      education: {
        level: 'university',
        major: 'biology',
        year: 0,
        gpa: 3.6,
        studyHard: false,
        // A previous degree already logged its loan notice.
      },
      flags: { studentLoanLogged: true },
    });
    const reg = makeRegistry();

    expect(applyToSchool(state, reg, 'med')).toEqual({ ok: true });
    const entries = educationPhase(makeCtx(state, reg));

    expect(entries).toEqual([{ icon: '🏦', kind: 'money', text: 'You took a student loan.' }]);
  });
});

describe('dropOut and setStudyHard', () => {
  it('leaves high school and marks the character a dropout', () => {
    const state = makeState({
      age: 16,
      education: { level: 'middle', enrolledIn: 'hs', year: 0, gpa: 2.1, studyHard: true },
    });

    dropOut(state);

    const ed = state.character.education;
    expect(ed.enrolledIn).toBeUndefined();
    expect(ed.level).toBe('middle');
    expect(state.character.flags.droppedOut).toBe(true);
    expect(lastEntries(state)).toEqual([{ icon: '🚪', kind: 'bad', text: 'You dropped out.' }]);
  });

  it('quitting university is not a school dropout', () => {
    const state = makeState({
      age: 20,
      education: { level: 'high', enrolledIn: 'uni', major: 'cs', year: 2, gpa: 2.8, studyHard: false },
    });

    dropOut(state);

    expect(state.character.education.enrolledIn).toBeUndefined();
    expect(state.character.education.level).toBe('high');
    expect(state.character.flags.droppedOut).toBeUndefined();
  });

  it('does nothing when there is no school to leave', () => {
    const state = makeState({ age: 30, education: { level: 'high', year: 0, gpa: 3, studyHard: false } });

    dropOut(state);

    expect(lastEntries(state)).toEqual([]);
    expect(state.character.flags.droppedOut).toBeUndefined();
  });

  it('toggles studying hard', () => {
    const state = makeState();

    setStudyHard(state, true);
    expect(state.character.education.studyHard).toBe(true);

    setStudyHard(state, false);
    expect(state.character.education.studyHard).toBe(false);
  });
});

describe('educationPhase determinism', () => {
  it('replays a whole school career identically from the same seed', () => {
    const run = (): { entries: unknown; character: unknown; cursor: number } => {
      const state = makeState({ age: 5, education: { level: 'none', year: 0, gpa: 0, studyHard: true } });
      const reg = makeRegistry();
      const entries = [];
      for (let age = 6; age <= 18; age += 1) {
        state.character.age = age;
        entries.push(...educationPhase(makeCtx(state, reg)));
      }
      return { entries, character: state.character, cursor: state.rngState };
    };

    const a = run();
    const b = run();

    expect(a).toEqual(b);
    expect(a.entries).toHaveLength(4);
  });
});
