/**
 * End of life and the hand-off to the next generation.
 */

import { currentYearLog } from '@/engine/ageUp';
import { clampMoney, clampStat, personById } from '@/engine/effects';
import { fmtMoneyCompact } from '@/engine/format';
import { createRng } from '@/engine/rng';
import { addPerson, pronounsFor } from '@/engine/state';
import type {
  AncestorRecord,
  Character,
  ContentRegistry,
  EdLevel,
  EducationState,
  GameState,
  Person,
  SchoolDef,
  Stats,
  StatKey,
} from '@/types';

/** Share of the estate that reaches the children; the rest is taxes and fees. */
const INHERITANCE_SHARE = 0.8;

/** Stats an heir starts from before their own `Person.stats` are laid over them. */
const HEIR_STATS: Stats = { health: 85, happiness: 70, smarts: 60, looks: 60 };

/** Age at which an heir is already living on their own. */
const MOVE_OUT_AGE = 22;

/**
 * Cash + investments + asset values - loan principals.
 *
 * Deliberately inlined instead of importing `finance.netWorth`: the estate is
 * needed while the character is already dead, and death must not depend on the
 * finance phase.
 */
function estateValue(state: GameState): number {
  const c = state.character;
  const invested = c.investments.savings + c.investments.index + c.investments.crypto;
  const assets = c.assets.reduce((sum, a) => sum + a.value, 0);
  const debt = c.loans.reduce((sum, l) => sum + l.principal, 0);
  const total = c.money + invested + assets - debt;
  /* A balance sheet that does not add up is worth nothing rather than `NaN`:
     `Math.max(0, NaN)` is `NaN`, so the floor the callers put under this would
     not hold. Same guard as `content/achievements.ts`'s copy of the sum. */
  return Number.isFinite(total) ? Math.round(total) : 0;
}

function aliveChildren(state: GameState): Person[] {
  return Object.values(state.people).filter((p) => p.alive && p.kind === 'child');
}

/**
 * Age from which a life with no work behind it is read as unemployment. Below
 * it there was no career to miss, so the obituary keeps quiet about work.
 */
const WORKING_AGE = 18;

/** True once a job has been held, even if no title survived to be remembered. */
function hasWorked(c: Character): boolean {
  const held = Number(c.flags.jobsHeld ?? 0);
  return Number.isFinite(held) && held > 0;
}

/** Last known occupation for the obituary; empty when there is nothing to say. */
function occupationOf(c: Character): string {
  if (c.job) return c.job.title;
  const last = c.flags.lastJobTitle;
  if (typeof last === 'string' && last.length > 0) return last;
  // Nobody has worked past this point: schooling is what the life was about.
  if (c.education.enrolledIn) return 'Student';
  if (c.age < WORKING_AGE && !hasWorked(c)) return '';
  return 'Unemployed';
}

/** Ends the life: records cause, age, obituary and epitaph stats, then sets phase `dead`. */
export function killCharacter(state: GameState, reg: ContentRegistry, cause: string): void {
  const c = state.character;
  const age = c.age;
  const netWorth = estateValue(state);
  const kids = aliveChildren(state).length;

  const flagged = Number(c.flags.jobsHeld ?? 0);
  const jobsHeld =
    Number.isFinite(flagged) && flagged > 0 ? Math.round(flagged) : c.job ? 1 : 0;

  const birthYear = state.year - age;
  const occupation = occupationOf(c);
  const clauses = [
    `${c.firstName} ${c.lastName}, ${birthYear}-${state.year}.`,
    `Died of ${cause} at ${age}.`,
    occupation ? `${occupation}.` : '',
    `Left ${fmtMoneyCompact(netWorth)} and ${kids} ${kids === 1 ? 'child' : 'children'}.`,
  ];
  const obituary = clauses.filter((part) => part.length > 0).join(' ');

  state.death = { cause, age, obituary, epitaphStats: { netWorth, jobsHeld, kids } };
  state.phase = 'dead';
  currentYearLog(state).entries.push({
    icon: '💀',
    kind: 'death',
    text: `You died of ${cause} at age ${age}.`,
  });
  state.pending = [];
}

/** Highest level completed and the level being attended, purely from age. */
function schoolingFor(age: number): { level: EdLevel; enrolLevel?: EdLevel } {
  if (age < 6) return { level: 'none' };
  if (age <= 10) return { level: 'none', enrolLevel: 'primary' };
  if (age <= 13) return { level: 'primary', enrolLevel: 'middle' };
  if (age <= 17) return { level: 'middle', enrolLevel: 'high' };
  return { level: 'high' };
}

function heirEducation(reg: ContentRegistry, age: number, smarts: number): EducationState {
  const { level, enrolLevel } = schoolingFor(age);
  const education: EducationState = {
    level,
    year: 0,
    gpa: Math.round((2 + smarts / 50) * 100) / 100,
    studyHard: false,
  };
  if (enrolLevel) {
    const school: SchoolDef | undefined = reg.schools.find((s) => s.level === enrolLevel);
    if (school) education.enrolledIn = school.id;
  }
  return education;
}

function heirStats(child: Person): Stats {
  const stats: Stats = { ...HEIR_STATS };
  const own = child.stats;
  if (own) {
    for (const key of Object.keys(stats) as StatKey[]) {
      const value = own[key];
      if (typeof value === 'number') stats[key] = clampStat(value);
    }
  }
  return stats;
}

/**
 * Starts a new life as the given child: generation + 1, 80% of the estate split
 * among the children as inheritance, and the deceased appended to `ancestors`.
 */
export function startLegacy(
  state: GameState,
  reg: ContentRegistry,
  childId: string
): GameState {
  /* `personById`, never `state.people[childId]`: the id comes from a UI pick
     and reads back out of JSON, so an inherited member like `__proto__` must
     be nobody here too — the same invariant, kept in one place. */
  const heir = personById(state.people, childId);
  if (!heir) throw new Error(`startLegacy: unknown person ${childId}`);
  if (heir.kind !== 'child') throw new Error(`startLegacy: ${childId} is not a child`);
  if (!heir.alive) throw new Error(`startLegacy: ${childId} is not alive`);

  const previous = state.character;
  const heirs = aliveChildren(state);
  const inheritance = Math.round(
    (INHERITANCE_SHARE * Math.max(0, estateValue(state))) / heirs.length
  );

  const firstName = heir.name.split(' ')[0] ?? heir.name;
  const lastName = previous.lastName;
  const stats = heirStats(heir);

  const character: Character = {
    id: 'me',
    firstName,
    lastName,
    gender: heir.gender,
    pronouns: pronounsFor(heir.gender),
    countryId: previous.countryId,
    age: heir.age,
    stats,
    money: clampMoney(inheritance),
    education: heirEducation(reg, heir.age, stats.smarts),
    job: null,
    prison: null,
    assets: [],
    loans: [],
    investments: { savings: 0, index: 0, crypto: 0 },
    illnesses: [],
    addictions: {},
    fame: 0,
    flags: {
      livesWithParents: heir.age < MOVE_OUT_AGE,
      nextPersonId: 1,
      countryLabel: previous.flags.countryLabel ?? previous.countryId,
      jobsHeld: 0,
    },
  };

  const deathAge = state.death ? state.death.age : previous.age;
  const cause = state.death
    ? state.death.cause
    : String(previous.flags.pendingDeathCause ?? 'natural causes');
  const ancestor: AncestorRecord = {
    name: `${previous.firstName} ${previous.lastName}`,
    years: `${state.year - deathAge}-${state.year}`,
    cause,
  };

  const generation = state.generation + 1;
  const next: GameState = {
    rngState: state.rngState,
    seed: state.seed,
    generation,
    year: state.year,
    character,
    people: {},
    log: [
      {
        age: heir.age,
        year: state.year,
        entries: [
          {
            icon: '🌱',
            kind: 'info',
            text: `You now live as ${firstName} ${lastName}, generation ${generation}.`,
          },
        ],
      },
    ],
    pending: [],
    firedEvents: [],
    interactionUse: {},
    ancestors: [...state.ancestors, ancestor],
    phase: 'alive',
  };

  const rng = createRng(next);
  for (const sibling of heirs) {
    if (sibling.id === heir.id) continue;
    addPerson(next, {
      kind: 'sibling',
      name: sibling.name,
      gender: sibling.gender,
      age: sibling.age,
      alive: true,
      rel: rng.int(60, 90),
      flags: {},
    });
  }

  const people = Object.values(state.people);
  const survivor =
    people.find((p) => p.alive && p.kind === 'spouse') ??
    people.find((p) => p.alive && p.kind === 'partner');
  if (survivor) {
    addPerson(next, {
      kind: survivor.gender === 'male' ? 'father' : 'mother',
      name: survivor.name,
      gender: survivor.gender,
      age: survivor.age,
      alive: true,
      rel: rng.int(65, 95),
      flags: {},
    });
  }

  return next;
}
