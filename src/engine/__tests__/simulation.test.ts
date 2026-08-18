import { describe, expect, it } from 'vitest';

import { getRegistry, resetRegistryForTests } from '@/content';
import { ageUp, resolveChoice } from '@/engine/ageUp';
import { buildRegistry } from '@/engine/registry';
import { createLife } from '@/engine/state';
import type { ContentPack, ContentRegistry, IllnessDef, StatKey } from '@/types';

/** Seeds 1..200: enough lives for the demographics below to be stable. */
const LIVES = 200;

/** Hard ceiling in `deathCheckPhase`; no life may run past it. */
const MAX_AGE = 110;

/** Iteration guard: a year that neither ages nor resolves would spin forever. */
const MAX_STEPS = 200;

const STAT_KEYS: readonly StatKey[] = ['health', 'happiness', 'smarts', 'looks'];

/** The two markers `healthPhase` puts in the feed when a bout starts and ends. */
const CONTRACTED_ICON = '🤒';
const RECOVERED_ICON = '💚';

interface Run {
  ages: number[];
  /** Worst money seen at any point, across every life. */
  minMoney: number;
  /** Every stat value that ever fell outside 0..100, with the life it came from. */
  badStats: string[];
  /** Lives that were still alive when the step guard ran out. */
  unfinished: number[];
  /** Lives whose stats or money were checked at least once. */
  years: number;
  /** Illness bouts that started, counted from the life feed. */
  contracted: number;
  /** Illness bouts that ended in recovery. */
  recovered: number;
  /** Lives that ended still carrying a condition. */
  heldAtDeath: number;
  /** Longest one condition was carried, over every life-year seen. */
  maxYearsHeld: number;
}

/**
 * Plays `LIVES` full lives against one registry, answering every pending choice
 * with the first option, and records what the invariants need.
 */
function playAll(reg: ContentRegistry): Run {
  const run: Run = {
    ages: [],
    minMoney: Infinity,
    badStats: [],
    unfinished: [],
    years: 0,
    contracted: 0,
    recovered: 0,
    heldAtDeath: 0,
    maxYearsHeld: 0,
  };

  for (let seed = 1; seed <= LIVES; seed += 1) {
    const state = createLife(reg, { seed });
    let steps = 0;

    while (state.phase !== 'dead' && steps < MAX_STEPS) {
      if (state.phase === 'awaitingChoice') resolveChoice(state, reg, 0);
      else ageUp(state, reg);
      steps += 1;
      run.years += 1;

      const c = state.character;
      if (!Number.isFinite(c.money) || c.money < 0) run.minMoney = Math.min(run.minMoney, c.money);
      for (const key of STAT_KEYS) {
        const value = c.stats[key];
        if (!Number.isFinite(value) || value < 0 || value > 100) {
          run.badStats.push(`seed ${seed} age ${c.age}: ${key}=${value}`);
        }
      }
      run.minMoney = Math.min(run.minMoney, c.money);
      for (const illness of c.illnesses) {
        run.maxYearsHeld = Math.max(run.maxYearsHeld, illness.years);
      }
    }

    if (state.phase !== 'dead') run.unfinished.push(seed);
    run.ages.push(state.character.age);
    if (state.character.illnesses.length > 0) run.heldAtDeath += 1;
    for (const year of state.log) {
      for (const entry of year.entries) {
        if (entry.icon === CONTRACTED_ICON) run.contracted += 1;
        else if (entry.icon === RECOVERED_ICON) run.recovered += 1;
      }
    }
  }

  return run;
}

function average(values: readonly number[]): number {
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}

/**
 * A registry holding one mild, common illness — the shape a content pack's cold
 * takes. `lethality` is 0 so the only thing being measured is what the health
 * phase does with the condition: an illness nobody can shake off drains health
 * every year for the rest of the life, which shows up as lost years.
 */
function illnessRegistry(cureChance: number, chronic = false): ContentRegistry {
  const flu: IllnessDef = {
    id: 'test.flu',
    label: 'the flu',
    chronic,
    lethality: 0,
    onsetWeight: (ctx) => (ctx.c.age >= 5 ? 0.06 : 0),
    healthHit: 10,
    treatCost: 100,
    cureChance,
  };
  const pack: ContentPack = { id: 'test.health', illnesses: [flu] };
  return buildRegistry([pack]);
}

/**
 * The invariants every registry must satisfy. The age band is *not* gated on
 * content: an empty content set adds no lethality beyond the bare age curve in
 * `deathCheckPhase`, so that curve alone has to produce a plausible cohort —
 * gating the upper bound on illnesses is exactly what let the curve drift an
 * order of magnitude too flat (a 99.5-year average, 63.5% of lives past 100).
 */
function expectHealthyRun(run: Run): void {
  expect(run.badStats).toEqual([]);
  expect(run.unfinished).toEqual([]);
  expect(Number.isFinite(run.minMoney)).toBe(true);
  expect(run.minMoney).toBeGreaterThanOrEqual(0);
  expect(run.ages).toHaveLength(LIVES);
  expect(Math.max(...run.ages)).toBeLessThanOrEqual(MAX_AGE);
  expect(Math.min(...run.ages)).toBeGreaterThanOrEqual(0);

  // Childhood and early-adult death stays rare: measured 3.0% on the empty registry.
  const early = run.ages.filter((age) => age < 30).length;
  expect(early / LIVES).toBeLessThan(0.08);

  // And nobody piles up against the 110 cap: measured 0.5% past 100 on the
  // empty registry, against 63.5% when the age curve was ten times too flat.
  const veryOld = run.ages.filter((age) => age > 100).length;
  expect(veryOld / LIVES).toBeLessThan(0.05);

  // Inside the [55, 95] band, and tight enough to catch a curve that is an
  // order of magnitude off: the empty registry measures 77.9 after the fix.
  const avg = average(run.ages);
  expect(avg).toBeGreaterThanOrEqual(55);
  expect(avg).toBeLessThanOrEqual(92);
}

describe('full-life simulation', () => {
  it('plays 200 seeded lives on an empty registry without breaking an invariant', () => {
    const reg = buildRegistry([]);
    const run = playAll(reg);

    expect(run.years).toBeGreaterThan(LIVES);
    expectHealthyRun(run);
  });

  it('plays the same 200 lives against the shipped content packs', () => {
    resetRegistryForTests();
    const reg = getRegistry();
    const run = playAll(reg);

    expect(run.years).toBeGreaterThan(LIVES);
    expectHealthyRun(run);
  });

  it('replays a seed identically', () => {
    const play = (reg: ContentRegistry): string => {
      const state = createLife(reg, { seed: 77 });
      let steps = 0;
      while (state.phase !== 'dead' && steps < MAX_STEPS) {
        if (state.phase === 'awaitingChoice') resolveChoice(state, reg, 0);
        else ageUp(state, reg);
        steps += 1;
      }
      return JSON.stringify(state);
    };

    const empty = buildRegistry([]);
    expect(play(empty)).toEqual(play(empty));
    // The recovery roll is part of the sequence, so replay it too.
    const withIllness = illnessRegistry(0.85);
    expect(play(withIllness)).toEqual(play(withIllness));
  });
});

/**
 * `IllnessDef.chronic` and `IllnessDef.cureChance` are the only knobs a pack has
 * for how long a condition lasts, and the recovery roll used to sit behind
 * `Illness.treated` — a flag no effect, phase or interaction in the engine ever
 * sets. That made both knobs unreachable: every illness ever contracted was held
 * until death, and a 90%-curable cold cost a cohort ~20 years of average life.
 */
describe('illness cohorts', () => {
  it('lets a curable illness run its course instead of holding it until death', () => {
    const run = playAll(illnessRegistry(0.85));

    expectHealthyRun(run);
    // Bouts start (a 6%-a-year cold, from age 5 on) and they end.
    expect(run.contracted).toBeGreaterThan(LIVES);
    expect(run.recovered).toBeGreaterThan(0.8 * run.contracted);
    // Measured: 10 of 200 lives end mid-bout, against 200 of 200 when the roll
    // was gated on `treated`.
    expect(run.heldAtDeath / LIVES).toBeLessThan(0.25);
    // And no bout drags on: measured 2 years, against 84 when nothing ever cured.
    expect(run.maxYearsHeld).toBeLessThanOrEqual(12);
  });

  it('honours cureChance: the same illness made incurable costs far more life', () => {
    const empty = playAll(buildRegistry([]));
    const curable = playAll(illnessRegistry(0.85));
    const incurable = playAll(illnessRegistry(0));

    // A cureChance of 0 is the only way to be stuck with it for life.
    expect(incurable.recovered).toBe(0);
    expect(incurable.heldAtDeath / LIVES).toBeGreaterThan(0.5);

    // Two cohorts that differ only in cureChance must not live the same lives.
    expect(curable.ages).not.toEqual(incurable.ages);
    expect(average(curable.ages)).toBeGreaterThan(average(incurable.ages));

    // Measured: 77.9 empty, 74.1 curable, 68.8 incurable. One mild cold that
    // resolves costs a few years; one that never resolves costs a decade.
    expect(average(empty.ages) - average(curable.ages)).toBeLessThan(6);
  });

  it('keeps a chronic illness for life however curable it claims to be', () => {
    const run = playAll(illnessRegistry(0.85, true));

    expect(run.contracted).toBeGreaterThan(0);
    expect(run.recovered).toBe(0);
    expect(run.heldAtDeath / LIVES).toBeGreaterThan(0.5);
  });
});
