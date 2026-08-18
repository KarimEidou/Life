import { beforeEach, describe, expect, it } from 'vitest';

import { allPacks, getRegistry, resetRegistryForTests } from '@/content';
import { buildRegistry, validateRegistry } from '@/engine/registry';
import type { ContentRegistry } from '@/types';

/**
 * Content lint.
 *
 * The count rules are conditional on purpose: a collection nobody has authored
 * yet is not a failure, but the moment a pack ships one row of a kind it has to
 * ship a playable amount of it.
 */

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Minimum rows per collection, applied only once that collection is non-empty. */
const MINIMUMS = {
  jobs: 12,
  achievements: 15,
  countries: 8,
  illnesses: 10,
  crimes: 8,
  assets: 16,
} as const;

/** Every pack that ships events has to ship a full year's worth of them. */
const MIN_EVENTS_PER_PACK = 8;

/** Names per list, per country, once any country exists. */
const MIN_NAMES = 15;

function atLeastWhenPresent(count: number, minimum: number, label: string): void {
  if (count === 0) return;
  expect(count, `${label}: ${count} shipped, minimum ${minimum}`).toBeGreaterThanOrEqual(minimum);
}

describe('content packs', () => {
  let reg: ContentRegistry;

  beforeEach(() => {
    resetRegistryForTests();
    reg = getRegistry();
  });

  it('builds a registry from every declared pack', () => {
    const built = buildRegistry(allPacks);

    expect(built.packs).toEqual(allPacks.map((pack) => pack.id));
    expect(built.packs.length).toBe(new Set(built.packs).size);
  });

  it('has no validation problems', () => {
    expect(validateRegistry(reg)).toEqual([]);
  });

  it('caches one registry and rebuilds it on demand', () => {
    expect(getRegistry()).toBe(reg);
    resetRegistryForTests();
    expect(getRegistry()).not.toBe(reg);
  });
});

describe('content minimums', () => {
  let reg: ContentRegistry;

  beforeEach(() => {
    resetRegistryForTests();
    reg = getRegistry();
  });

  it('gives every event pack a usable number of events', () => {
    for (const pack of allPacks) {
      const count = pack.events?.length ?? 0;
      atLeastWhenPresent(count, MIN_EVENTS_PER_PACK, `pack "${pack.id}" events`);
    }
  });

  it('ships enough jobs, achievements, illnesses, crimes and assets', () => {
    atLeastWhenPresent(reg.jobs.length, MINIMUMS.jobs, 'jobs');
    atLeastWhenPresent(reg.achievements.length, MINIMUMS.achievements, 'achievements');
    atLeastWhenPresent(reg.illnesses.length, MINIMUMS.illnesses, 'illnesses');
    atLeastWhenPresent(reg.crimes.length, MINIMUMS.crimes, 'crimes');
    atLeastWhenPresent(reg.assets.length, MINIMUMS.assets, 'assets');
  });

  it('ships enough countries, each with a full name pool', () => {
    atLeastWhenPresent(reg.countries.length, MINIMUMS.countries, 'countries');

    for (const country of reg.countries) {
      const pool = reg.namePools[country.id];
      expect(pool, `country "${country.id}" has no name pool`).toBeDefined();
      if (!pool) continue;
      expect(pool.male.length, `${country.id} male names`).toBeGreaterThanOrEqual(MIN_NAMES);
      expect(pool.female.length, `${country.id} female names`).toBeGreaterThanOrEqual(MIN_NAMES);
      expect(pool.last.length, `${country.id} last names`).toBeGreaterThanOrEqual(MIN_NAMES);
    }
  });
});

describe('content shape', () => {
  let reg: ContentRegistry;

  beforeEach(() => {
    resetRegistryForTests();
    reg = getRegistry();
  });

  it('gives every event a kebab-case id and non-empty text', () => {
    for (const event of reg.events) {
      expect(event.id, `event id "${event.id}"`).toMatch(KEBAB_CASE);
      // Builder texts are exercised by the phase tests; only literals are linted here.
      if (typeof event.text === 'string') {
        expect(event.text.trim(), `event "${event.id}" text`).not.toBe('');
      }
      expect(event.icon, `event "${event.id}" icon`).not.toBe('');
      expect(event.area, `event "${event.id}" area`).not.toBe('');
    }
  });

  it('gives every interaction a label and an icon', () => {
    for (const def of reg.interactions) {
      expect(def.id, `interaction id "${def.id}"`).toMatch(KEBAB_CASE);
      expect(def.label.trim(), `interaction "${def.id}" label`).not.toBe('');
      expect(def.icon.trim(), `interaction "${def.id}" icon`).not.toBe('');
      expect(def.area.trim(), `interaction "${def.id}" area`).not.toBe('');
    }
  });
});
