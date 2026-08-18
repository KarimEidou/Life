/**
 * Relationships phase: everyone else ages, drifts and occasionally leaves.
 */

import { clampStat } from '@/engine/effects';
import type { Ctx, LogEntry, Person, RelKind } from '@/types';

/** Rolled for death at any age; everyone else is only rolled once they are old. */
const MORTAL_KINDS: readonly RelKind[] = ['mother', 'father', 'sibling'];

/** Age from which anybody, whatever their relationship, is rolled for death. */
const ELDER_AGE = 60;

/** Mortality curve: flat zero until 40, then exponential, capped short of certain. */
const MORTALITY_AGE = 40;
const MORTALITY_BASE = 0.0002;
const MORTALITY_GROWTH = 0.085;
const MORTALITY_CAP = 0.9;

/** Pets are rolled once they outlive this age, on a much steeper curve. */
const PET_SAFE_AGE = 10;
const PET_BASE = 0.15;
const PET_STEP = 0.05;

const GRIEF = 12;
const GRIEF_ROMANCE = 18;
const GRIEF_PET = 8;

/** Affinity everyone outside a romance loses each year without contact. */
const DRIFT = 2;

/**
 * A romance decays by a point a year, offset by the character's mood: misery
 * drags it down four points a year, contentment nudges it up one.
 */
const ROMANCE_DECAY = 1;
const ROMANCE_BASELINE = 60;
const ROMANCE_MOOD_SPAN = 20;
const ROMANCE_MOOD_MIN = -3;
const ROMANCE_MOOD_MAX = 2;

const DIVORCE_REL = 15;
const DIVORCE_CHANCE = 0.2;
/** Share of the cash that survives a divorce. */
const DIVORCE_KEEP = 0.7;
const DIVORCE_GRIEF = 20;

const BREAKUP_REL = 20;
const BREAKUP_CHANCE = 0.35;
const BREAKUP_GRIEF = 10;

/** Yearly growth of a child's smarts and looks. */
const CHILD_GROWTH_MEAN = 0.5;
const CHILD_GROWTH_SD = 1;

function isRomance(person: Person): boolean {
  return person.kind === 'partner' || person.kind === 'spouse';
}

/** Chance this person dies this year; 0 for anyone the curves do not reach. */
function mortality(person: Person): number {
  if (person.kind === 'pet') {
    if (person.age <= PET_SAFE_AGE) return 0;
    return PET_BASE + PET_STEP * (person.age - PET_SAFE_AGE);
  }
  const rolled = MORTAL_KINDS.includes(person.kind) || person.age >= ELDER_AGE;
  if (!rolled || person.age < MORTALITY_AGE) return 0;
  const raw = MORTALITY_BASE * Math.exp(MORTALITY_GROWTH * (person.age - MORTALITY_AGE));
  return Math.min(MORTALITY_CAP, raw);
}

/** Kills the person and charges the character the matching grief. */
function bury(ctx: Ctx, person: Person): LogEntry {
  const c = ctx.state.character;
  person.alive = false;
  if (person.kind === 'pet') {
    c.stats.happiness = clampStat(c.stats.happiness - GRIEF_PET);
    const species = person.petSpecies ?? 'pet';
    return { icon: '💔', kind: 'bad', text: `Your ${species} ${person.name} died.` };
  }
  c.stats.happiness = clampStat(c.stats.happiness - (isRomance(person) ? GRIEF_ROMANCE : GRIEF));
  return {
    icon: '🖤',
    kind: 'bad',
    text: `Your ${person.kind} ${person.name} died at ${person.age}.`,
  };
}

/** Yearly affinity drift; a romance tracks the character's mood, everyone else fades. */
function drift(ctx: Ctx, person: Person): void {
  if (!isRomance(person)) {
    person.rel = Math.max(0, person.rel - DRIFT);
    return;
  }
  const raw = (ctx.state.character.stats.happiness - ROMANCE_BASELINE) / ROMANCE_MOOD_SPAN;
  const mood = Math.max(ROMANCE_MOOD_MIN, Math.min(ROMANCE_MOOD_MAX, raw));
  person.rel = clampStat(person.rel + mood - ROMANCE_DECAY);
}

/** A child's own stats creep upwards as they grow. */
function developChild(ctx: Ctx, person: Person): void {
  const stats = person.stats;
  if (!stats) return;
  if (typeof stats.smarts === 'number') {
    stats.smarts = clampStat(stats.smarts + ctx.rng.normal(CHILD_GROWTH_MEAN, CHILD_GROWTH_SD));
  }
  if (typeof stats.looks === 'number') {
    stats.looks = clampStat(stats.looks + ctx.rng.normal(CHILD_GROWTH_MEAN, CHILD_GROWTH_SD));
  }
}

/**
 * Rolls the end of a romance that has run cold. The affinity test guards the
 * roll, so a healthy relationship never touches the rng.
 */
function rollSplit(ctx: Ctx, person: Person): LogEntry | undefined {
  const c = ctx.state.character;
  if (person.kind === 'spouse' && person.rel < DIVORCE_REL && ctx.rng.chance(DIVORCE_CHANCE)) {
    person.kind = 'ex';
    c.money = Math.max(0, Math.round(c.money * DIVORCE_KEEP));
    c.stats.happiness = clampStat(c.stats.happiness - DIVORCE_GRIEF);
    return { icon: '⚡', kind: 'bad', text: `${person.name} divorced you.` };
  }
  if (person.kind === 'partner' && person.rel < BREAKUP_REL && ctx.rng.chance(BREAKUP_CHANCE)) {
    person.kind = 'ex';
    c.stats.happiness = clampStat(c.stats.happiness - BREAKUP_GRIEF);
    return { icon: '⚡', kind: 'bad', text: `${person.name} broke up with you.` };
  }
  return undefined;
}

/**
 * Ages every person, drifts affinity, and rolls the deaths, divorces and
 * breakups of the year. New people are met through events and interactions,
 * never here.
 */
export function relationshipsPhase(ctx: Ctx): LogEntry[] {
  const entries: LogEntry[] = [];

  for (const person of Object.values(ctx.state.people)) {
    if (!person.alive) continue;
    person.age += 1;

    const risk = mortality(person);
    // Guarded so a person who cannot die this year never consumes a draw.
    if (risk > 0 && ctx.rng.chance(risk)) {
      entries.push(bury(ctx, person));
      continue;
    }

    drift(ctx, person);
    if (person.kind === 'child') developChild(ctx, person);

    const split = rollSplit(ctx, person);
    if (split) entries.push(split);
  }

  return entries;
}
