import { beforeEach, describe, expect, it } from 'vitest';

import { allPacks, getRegistry, resetRegistryForTests } from '@/content';
import { buildRegistry, validateRegistry } from '@/engine/registry';
import type { ContentRegistry } from '@/types';

/**
 * Content lint.
 *
 * The registry-wide count rules are unconditional. The shape a minimum most
 * needs to catch is a collection that disappeared — a pack dropped from
 * `allPacks`, or a `collect` call reading the wrong key — and nothing else in
 * the repo catches it: `validateRegistry` iterates each collection, so an empty
 * one produces zero problems, and three of its own cross-checks (the compulsory
 * school ladder, and both name-pool directions) are themselves guarded on the
 * collection being non-empty. The single count rule that stays conditional is
 * the per-pack event floor, and only because several packs legitimately author
 * no events at all.
 */

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Minimum rows per collection, registry-wide, floored well under what ships. */
const MINIMUMS = {
  jobs: 12,
  // The compulsory primary/middle/high ladder, plus a university above it:
  // without one, every degree-gated job is unreachable for the whole life.
  schools: 4,
  achievements: 15,
  countries: 8,
  illnesses: 10,
  crimes: 8,
  assets: 16,
  events: 60,
  interactions: 10,
} as const;

/** Every pack that ships events has to ship a full year's worth of them. */
const MIN_EVENTS_PER_PACK = 8;

/** Names per list, per country. */
const MIN_NAMES = 15;

/** Every key is a `ContentRegistry` list, so a new minimum cannot go unasserted. */
const MINIMUM_KEYS = Object.keys(MINIMUMS) as (keyof typeof MINIMUMS)[];

function atLeast(count: number, minimum: number, label: string): void {
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
      // The countries, names, achievements, jobs, activities and assets packs
      // author no events by design; `MINIMUMS.events` is what catches the event
      // collection itself going missing.
      if (count === 0) continue;
      atLeast(count, MIN_EVENTS_PER_PACK, `pack "${pack.id}" events`);
    }
  });

  it('ships a playable amount of every collection', () => {
    for (const key of MINIMUM_KEYS) {
      atLeast(reg[key].length, MINIMUMS[key], key);
    }
  });

  it('gives every country a full name pool', () => {
    for (const country of reg.countries) {
      const pool = reg.namePools[country.id];
      expect(pool, `country "${country.id}" has no name pool`).toBeDefined();
      if (!pool) continue;
      expect(pool.male.length, `${country.id} male names`).toBeGreaterThanOrEqual(MIN_NAMES);
      expect(pool.female.length, `${country.id} female names`).toBeGreaterThanOrEqual(MIN_NAMES);
      expect(pool.last.length, `${country.id} last names`).toBeGreaterThanOrEqual(MIN_NAMES);
    }
  });

  it('fails every minimum when a collection ships nothing', () => {
    // An entirely empty registry is the one shape these minimums used to wave
    // through, and it is the shape a dropped pack produces.
    const empty = buildRegistry([]);

    for (const key of MINIMUM_KEYS) {
      expect(empty[key].length, key).toBe(0);
      expect(() => {
        atLeast(empty[key].length, MINIMUMS[key], key);
      }, key).toThrow();
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
