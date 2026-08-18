import { describe, expect, it } from 'vitest';

import { getRegistry, resetRegistryForTests } from '@/content';
import { ageUp, resolveChoice } from '@/engine/ageUp';
import { buildRegistry } from '@/engine/registry';
import { createLife } from '@/engine/state';
import type { ContentRegistry, StatKey } from '@/types';

/** Seeds 1..200: enough lives for the demographics below to be stable. */
const LIVES = 200;

/** Hard ceiling in `deathCheckPhase`; no life may run past it. */
const MAX_AGE = 110;

/** Iteration guard: a year that neither ages nor resolves would spin forever. */
const MAX_STEPS = 200;

const STAT_KEYS: readonly StatKey[] = ['health', 'happiness', 'smarts', 'looks'];

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
}

/**
 * Plays `LIVES` full lives against one registry, answering every pending choice
 * with the first option, and records what the invariants need.
 */
function playAll(reg: ContentRegistry): Run {
  const run: Run = { ages: [], minMoney: Infinity, badStats: [], unfinished: [], years: 0 };

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
    }

    if (state.phase !== 'dead') run.unfinished.push(seed);
    run.ages.push(state.character.age);
  }

  return run;
}

function average(values: readonly number[]): number {
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}

/**
 * The invariants every registry must satisfy. `avg <= 95` is asserted only once
 * the registry ships illnesses: an empty content set has no lethality beyond the
 * bare age curve, so its cohort outlives the band by construction.
 */
function expectHealthyRun(run: Run, reg: ContentRegistry): void {
  expect(run.badStats).toEqual([]);
  expect(run.unfinished).toEqual([]);
  expect(Number.isFinite(run.minMoney)).toBe(true);
  expect(run.minMoney).toBeGreaterThanOrEqual(0);
  expect(run.ages).toHaveLength(LIVES);
  expect(Math.max(...run.ages)).toBeLessThanOrEqual(MAX_AGE);
  expect(Math.min(...run.ages)).toBeGreaterThanOrEqual(0);

  const early = run.ages.filter((age) => age < 30).length;
  expect(early / LIVES).toBeLessThan(0.1);

  const avg = average(run.ages);
  expect(avg).toBeGreaterThanOrEqual(55);
  if (reg.illnesses.length > 0) expect(avg).toBeLessThanOrEqual(95);
}

describe('full-life simulation', () => {
  it('plays 200 seeded lives on an empty registry without breaking an invariant', () => {
    const reg = buildRegistry([]);
    const run = playAll(reg);

    expect(run.years).toBeGreaterThan(LIVES);
    expectHealthyRun(run, reg);
  });

  it('plays the same 200 lives against the shipped content packs', () => {
    resetRegistryForTests();
    const reg = getRegistry();
    const run = playAll(reg);

    expect(run.years).toBeGreaterThan(LIVES);
    expectHealthyRun(run, reg);
  });

  it('replays a seed identically', () => {
    const reg = buildRegistry([]);
    const play = (): string => {
      const state = createLife(reg, { seed: 77 });
      let steps = 0;
      while (state.phase !== 'dead' && steps < MAX_STEPS) {
        if (state.phase === 'awaitingChoice') resolveChoice(state, reg, 0);
        else ageUp(state, reg);
        steps += 1;
      }
      return JSON.stringify(state);
    };

    expect(play()).toEqual(play());
  });
});
