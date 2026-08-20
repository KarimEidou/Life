import { describe, expect, it } from 'vitest';

import { achievementsPack } from '@/content/achievements';
import { countriesPack } from '@/content/countries';
import { killCharacter, startLegacy } from '@/engine/death';
import { buildRegistry } from '@/engine/registry';
import { createRng } from '@/engine/rng';
import { addPerson, createLife, emigrateTo } from '@/engine/state';
import type { AchievementDef, GameState } from '@/types';

/**
 * `ach-world-citizen` and the `movedCountry` check behind it.
 *
 * `movedCountry` is private, so the shipped `check` is run through the def. Its
 * fallback is a promise about engine prose — `createLife` writes the birth line
 * it reads, `emigrateTo` writes the country flag it compares against — so every
 * state here comes out of the engine rather than being hand-written, which would
 * keep passing the day the engine stopped writing those sentences.
 */

const WORLD = buildRegistry([countriesPack]);

function defOf(id: string): AchievementDef {
  const def = (achievementsPack.achievements ?? []).find((candidate) => candidate.id === id);
  if (!def) throw new Error(`achievements ships no "${id}"`);
  return def;
}

const isWorldCitizen = (state: GameState): boolean => defOf('ach-world-citizen').check(state);

/**
 * Reaches a birthday the way `agingPhase` does, opening the year log the move is
 * written into. `createLife`'s own log stays `log[0]`, which is the line the
 * check reads.
 */
function birthday(state: GameState, age: number): void {
  state.year += age - state.character.age;
  state.character.age = age;
  state.log.push({ age, year: state.year, entries: [] });
}

/** An American adult who can afford the $2,000 visa fee. */
function adultLife(seed: number, lastName = 'Moreno'): GameState {
  const state = createLife(WORLD, { seed, firstName: 'Ada', lastName, countryId: 'us' });
  birthday(state, 30);
  state.character.money = 60000;
  return state;
}

/**
 * Points the shared cursor at a draw that settles the visa roll either way:
 * `emigrateTo` clamps its odds into [0.05, 0.95], so nothing else matters.
 */
function aimVisa(state: GameState, land: boolean): void {
  for (let cursor = 1; cursor <= 100000; cursor += 1) {
    const draw = createRng({ rngState: cursor }).next();
    if (land ? draw < 0.05 : draw > 0.95) {
      state.rngState = cursor;
      return;
    }
  }
  throw new Error('aimVisa: no cursor decides the roll');
}

/** Applies for a visa and insists on the outcome under test. */
function applyForVisa(state: GameState, countryId: string, land: boolean): void {
  aimVisa(state, land);
  const res = emigrateTo(state, WORLD, countryId);
  if (res.ok !== land) {
    const wanted = land ? 'approval' : 'refusal';
    throw new Error(`emigrateTo: wanted ${wanted}, got ${res.reason ?? 'ok'}`);
  }
}

/** A generation-2 heir: a fresh log, an inherited country and no visa stamp. */
function heirLife(seed: number): GameState {
  const parent = adultLife(seed);
  parent.character.age = 70;
  const child = addPerson(parent, {
    kind: 'child',
    name: 'Maya Moreno',
    gender: 'female',
    age: 30,
    alive: true,
    rel: 80,
    flags: {},
  });
  killCharacter(parent, WORLD, 'old age');

  const state = startLegacy(parent, WORLD, child.id);
  state.character.money = 60000;
  return state;
}

describe('ach-world-citizen', () => {
  it('stays locked for a life that never applied for a visa', () => {
    const state = adultLife(1);

    expect(state.character.flags.lastVisaAge).toBeUndefined();
    expect(isWorldCitizen(state)).toBe(false);
  });

  it('stays locked after a refused application', () => {
    const state = adultLife(1);
    applyForVisa(state, 'jp', false);

    // The stamp is paid for whether or not the visa lands, so it proves nothing.
    expect(state.character.flags.lastVisaAge).toBe(30);
    expect(state.character.flags.countryLabel).toBe('United States');
    expect(isWorldCitizen(state)).toBe(false);
  });

  it('unlocks once the birth line no longer names the country lived in', () => {
    const state = adultLife(1);
    applyForVisa(state, 'jp', true);

    expect(state.character.flags.countryLabel).toBe('Japan');
    expect(isWorldCitizen(state)).toBe(true);
  });

  it('reads the country slot of the birth line, not the whole sentence', () => {
    // The surname matches the country moved to, so a whole-line `includes` reads
    // the birth line as naming it and calls this life home for good.
    const state = adultLife(1, 'France');
    applyForVisa(state, 'fr', true);

    // The rolled gender noun is the only part of the line the seed decides.
    expect(state.log[0]?.entries[0]?.text).toContain('named Ada France in United States.');
    expect(state.character.flags.countryLabel).toBe('France');
    expect(isWorldCitizen(state)).toBe(true);
  });

  it('locks again for a life that moved back to where it opened', () => {
    const state = adultLife(1);
    applyForVisa(state, 'jp', true);
    // Past the five-year visa cooldown, so the second application is legal.
    birthday(state, 35);
    applyForVisa(state, 'us', true);

    expect(state.character.flags.countryLabel).toBe('United States');
    expect(isWorldCitizen(state)).toBe(false);
  });

  it('goes quiet for a legacy heir, whose log opens with no birth line', () => {
    const state = heirLife(2);
    applyForVisa(state, 'jp', true);

    expect(state.log[0]?.entries[0]?.text).toBe('You now live as Maya Moreno, generation 2.');
    expect(state.character.flags.countryLabel).toBe('Japan');
    expect(isWorldCitizen(state)).toBe(false);
  });

  it('unlocks for anybody the emigration pack naturalised', () => {
    const state = heirLife(3);
    state.character.flags['emigration:done'] = true;

    // The ceremony's marker outranks the birth line, heir or not.
    expect(isWorldCitizen(state)).toBe(true);
  });
});
