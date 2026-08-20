/**
 * Death check: the last phase of every year.
 */

import { findById } from '@/engine/registry';
import type { AddictionKey, Ctx, IllnessDef, LogEntry } from '@/types';

/**
 * Yearly hazard below 40, and the base the Gompertz curve starts from at 40.
 * Calibrated against real life tables: with AGE_EXPONENT this is ~6.8% a year
 * at 80 and ~39% at 100, which lands an empty-content cohort near a 78-year
 * average. A tenth of this and almost nobody dies of the curve at all — deaths
 * come only from the 105/110 backstops below and the cohort averages ~99.
 */
const BASE_HAZARD = 0.002;

/** Gompertz exponent: the hazard doubles roughly every eight years after 40. */
const AGE_EXPONENT = 0.088;

/** Nothing short of extreme age is ever certain. */
const MAX_HAZARD = 0.95;

/**
 * Always answers inside the bounds, NaN included — every comparison against NaN
 * is false, so the bare ternary handed it back untouched. An unreadable hazard
 * is not a merely wrong one: `rng.chance(NaN)` is `false`, so it is a character
 * who cannot die of anything until the 110 backstop.
 */
function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return n < min ? min : n > max ? max : n;
}

function findIllness(ctx: Ctx, defId: string): IllnessDef | undefined {
  return findById(ctx.reg.illnessesById, ctx.reg.illnesses, defId);
}

/** Per-year probability of dying, from age, health, illnesses and addictions. */
export function deathProbability(ctx: Ctx): number {
  const c = ctx.c;
  const age = c.age;

  const base = age < 40 ? BASE_HAZARD : BASE_HAZARD * Math.exp(AGE_EXPONENT * (age - 40));
  const healthFactor = clamp(1 + (50 - c.stats.health) / 50, 0.5, 3);
  let q = base * healthFactor;

  for (const illness of c.illnesses) {
    const def = findIllness(ctx, illness.defId);
    /* `lethality` is hand-authored and `validateRegistry` names a bad one but
       never runs at load time, so it arrives here unchecked. Dropped rather
       than summed — the reading `rng.weighted` and `isEligible` already give a
       non-finite weight: an unreadable number is not a very large one. */
    if (!def || !Number.isFinite(def.lethality)) continue;
    q += def.lethality * (illness.treated ? 0.5 : 2);
  }

  const addictions = c.addictions as Record<string, number | undefined>;
  for (const key of Object.keys(addictions)) {
    const severity = addictions[key];
    /* Widened, so the key may hold anything a drifted save carried, and
       `NaN <= 0` is false: the gate has to test readability itself. */
    if (typeof severity !== 'number' || !(Number.isFinite(severity) && severity > 0)) continue;
    q += (severity / 100) * 0.01 * (key === 'drugs' ? 3 : 1);
  }

  q = clamp(q, 0, MAX_HAZARD);
  if (age >= 105) q = Math.max(q, 0.5);
  if (age >= 110) q = 1;
  return q;
}

/** The most plausible thing to have killed this character this year. */
function causeOfDeath(ctx: Ctx): string {
  const c = ctx.c;

  let worst: IllnessDef | undefined;
  for (const illness of c.illnesses) {
    if (illness.treated) continue;
    const def = findIllness(ctx, illness.defId);
    /* Same skip as the hazard sum, for a second reason: `0.25 > NaN` is false,
       so an unreadable def adopted as `worst` could never be displaced and
       took the obituary from the illness that actually did the killing. */
    if (!def || !Number.isFinite(def.lethality)) continue;
    if (!worst || def.lethality > worst.lethality) worst = def;
  }
  if (worst) return worst.label;

  const drugs: AddictionKey = 'drugs';
  if ((c.addictions[drugs] ?? 0) > 60) return 'an overdose';

  return c.age >= 80 ? 'natural causes' : 'a sudden illness';
}

/** Rolls against `deathProbability` and kills the character when it hits. */
export function deathCheckPhase(ctx: Ctx): LogEntry[] {
  if (!ctx.rng.chance(deathProbability(ctx))) return [];
  /* Death protocol: mark only. `ageUp` sees the marker after this phase returns
     and calls `killCharacter`, which owns the obituary and the log entry. */
  ctx.state.phase = 'dead';
  ctx.c.flags.pendingDeathCause = causeOfDeath(ctx);
  return [];
}
