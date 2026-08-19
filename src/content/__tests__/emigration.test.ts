import { describe, expect, it } from 'vitest';

import { countriesPack } from '@/content/countries';
import { emigrationPack } from '@/content/emigration';
import { killCharacter, startLegacy } from '@/engine/death';
import { eventsPhase } from '@/engine/phases/events';
import { buildRegistry } from '@/engine/registry';
import { createRng } from '@/engine/rng';
import { addPerson, createLife, emigrateTo } from '@/engine/state';
import type { ContentRegistry, Ctx, EventDef, GameState, Rng } from '@/types';

/**
 * Emigration pack contract.
 *
 * `abroad` is not exported, so the shipped conditions are run directly. Every
 * state here comes out of the real engine — `emigrateTo` writes the line the
 * gate reads and `startLegacy` writes the heir's opening line — because the gate
 * is a promise about that prose, and a test that wrote the prose itself would
 * still pass the day the engine stopped writing it.
 */

const WORLD = buildRegistry([countriesPack]);
const emigEvents: EventDef[] = emigrationPack.events ?? [];

/** The cards a fresh move opens on its own; the rest ask for family or years. */
const PLAIN_CARDS = [
  'ev-emig-homesickness',
  'ev-emig-paperwork',
  'ev-emig-taste-of-home',
  'ev-emig-old-friend',
];

function defOf(id: string): EventDef {
  const def = emigEvents.find((candidate) => candidate.id === id);
  if (!def) throw new Error(`emigration ships no "${id}"`);
  return def;
}

/** A registry holding only the defs under test, so the drawn pool is exactly them. */
function registryOf(defs: EventDef[]): ContentRegistry {
  return buildRegistry([{ id: 'emigration-under-test', events: defs }]);
}

function ctxOf(state: GameState, reg: ContentRegistry = WORLD, rng?: Rng): Ctx {
  return { state, c: state.character, rng: rng ?? createRng(state), reg };
}

/** Both yearly rolls pass and `weighted` is a pure pick, so the draw is fixed. */
function alwaysDraws(): Rng {
  return {
    next: () => 0.5,
    int: (min: number) => min,
    pick: <T,>(arr: readonly T[]): T => arr[0] as T,
    chance: () => true,
    weighted: <T,>(items: readonly T[]): T => items[0] as T,
    normal: (mean: number) => mean,
  };
}

/**
 * Reaches a birthday the way `agingPhase` does, opening the year log the move
 * gets written into. The residence clock is read off that log, so a test that
 * only bumped `c.age` would date every move to the year of birth.
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

/**
 * Draws the shipped ceremony, the pack's only writer of `emigration:done`. The
 * flag is set through the real effect so the test still means something the day
 * the ceremony stops setting it.
 */
function naturalise(state: GameState): void {
  eventsPhase(ctxOf(state, registryOf([defOf('ev-emig-citizenship')]), alwaysDraws()));
  if (state.character.flags['emigration:done'] !== true) {
    throw new Error('naturalise: the ceremony did not fire');
  }
}

describe('emigration gate', () => {
  it('leaves a refused application out of the storyline', () => {
    const state = adultLife(1);
    applyForVisa(state, 'jp', false);
    const ctx = ctxOf(state);

    // The stamp the engine leaves behind is not evidence of a move.
    expect(state.character.flags.lastVisaAge).toBe(30);
    expect(state.character.flags.countryLabel).toBe('United States');
    for (const def of emigEvents) {
      expect(def.condition?.(ctx), `event "${def.id}" is drawable after a refusal`).toBe(false);
    }
  });

  it('opens the storyline once the engine logs the move', () => {
    const state = adultLife(1);
    applyForVisa(state, 'jp', true);
    const ctx = ctxOf(state);

    expect(state.character.flags.countryLabel).toBe('Japan');
    for (const id of PLAIN_CARDS) {
      expect(defOf(id).condition?.(ctx), `event "${id}" is not drawable abroad`).toBe(true);
    }
  });

  it('leaves a generation-2 heir whose application was refused out of it', () => {
    const state = heirLife(2);
    expect(state.generation).toBe(2);
    expect(state.log[0]?.entries[0]?.text).toBe('You now live as Maya Moreno, generation 2.');

    applyForVisa(state, 'jp', false);
    const ctx = ctxOf(state);

    expect(state.character.flags.countryLabel).toBe('United States');
    for (const def of emigEvents) {
      expect(def.condition?.(ctx), `event "${def.id}" is drawable after a refusal`).toBe(false);
    }
  });

  it('never hands a refused heir the citizenship the achievement reads', () => {
    const state = heirLife(3);
    applyForVisa(state, 'jp', false);
    // Well past the five years the ceremony asks for.
    birthday(state, 45);

    expect(defOf('ev-emig-citizenship').condition?.(ctxOf(state))).toBe(false);
    expect(state.character.flags['emigration:done']).toBeUndefined();
  });

  it('still runs for a generation-2 heir who actually moves', () => {
    const state = heirLife(2);
    applyForVisa(state, 'jp', true);
    const ctx = ctxOf(state);

    expect(state.character.flags.countryLabel).toBe('Japan');
    for (const id of PLAIN_CARDS) {
      expect(defOf(id).condition?.(ctx), `event "${id}" is not drawable abroad`).toBe(true);
    }
  });

  it('reads the country slot of the birth line, not the whole sentence', () => {
    // The surname matches the country moved to, so a whole-line `includes`
    // reads the birth line as naming it and calls this life home.
    const state = adultLife(1, 'France');
    applyForVisa(state, 'fr', true);
    const ctx = ctxOf(state);

    expect(state.log[0]?.entries[0]?.text).toContain('Ada France');
    expect(state.character.flags.countryLabel).toBe('France');
    for (const id of PLAIN_CARDS) {
      expect(defOf(id).condition?.(ctx), `event "${id}" is not drawable abroad`).toBe(true);
    }
  });

  it('lets a life named after the country it moved to reach the ceremony', () => {
    const state = adultLife(1, 'France');
    applyForVisa(state, 'fr', true);
    // Five years settled: the beat that sets the flag the achievement reads.
    birthday(state, 36);

    expect(defOf('ev-emig-citizenship').condition?.(ctxOf(state))).toBe(true);
  });

  it('treats a move back to the country the life opened in as coming home', () => {
    const state = adultLife(1);
    applyForVisa(state, 'jp', true);
    // Past the five-year visa cooldown, so the second application is legal.
    birthday(state, 35);
    applyForVisa(state, 'us', true);

    expect(state.character.flags.countryLabel).toBe('United States');
    expect(defOf('ev-emig-homesickness').condition?.(ctxOf(state))).toBe(false);
  });

  it('goes quiet in prison and speaks again once the passport lands', () => {
    const state = adultLife(1);
    applyForVisa(state, 'jp', true);
    state.character.prison = { crime: 'Fraud', yearsLeft: 3, totalYears: 3 };

    expect(defOf('ev-emig-homesickness').condition?.(ctxOf(state))).toBe(false);

    state.character.prison = null;
    state.character.flags['emigration:done'] = true;
    expect(defOf('ev-emig-homesickness').condition?.(ctxOf(state))).toBe(true);
  });

  it('closes the renewal queue the year the passport lands', () => {
    const state = adultLife(1);
    applyForVisa(state, 'jp', true);
    // Five years settled, so the ceremony is due.
    birthday(state, 36);
    naturalise(state);
    const ctx = ctxOf(state);

    // Nothing left to renew, and the flag holds `abroad` open for the rest of
    // the life, so the card has to read the passport itself.
    expect(defOf('ev-emig-paperwork').condition?.(ctx)).toBe(false);

    // Living abroad carries on; only the queue at the counter ends.
    for (const id of PLAIN_CARDS) {
      if (id === 'ev-emig-paperwork') continue;
      expect(defOf(id).condition?.(ctx), `event "${id}" closed at a citizen`).toBe(true);
    }
  });
});

describe('residence clock', () => {
  it('counts the settling-in years from the move, and closes them on time', () => {
    const state = adultLife(1);
    applyForVisa(state, 'jp', true);
    const shock = defOf('ev-emig-culture-shock');

    // Everything is still new in the year of the move and for three after it.
    expect(shock.condition?.(ctxOf(state))).toBe(true);
    birthday(state, 33);
    expect(shock.condition?.(ctxOf(state))).toBe(true);
    birthday(state, 34);
    expect(shock.condition?.(ctxOf(state))).toBe(false);
  });

  it('does not restart the clock when a later application is refused', () => {
    const state = adultLife(1);
    applyForVisa(state, 'jp', true);
    // The cooldown is served, so a second application is legal — and refused.
    birthday(state, 35);
    applyForVisa(state, 'de', false);
    const ctx = ctxOf(state);

    // The stamp moved; the character did not.
    expect(state.character.flags.lastVisaAge).toBe(35);
    expect(state.character.countryId).toBe('jp');

    // Five years in Japan: the newly-arrived card stays shut...
    expect(defOf('ev-emig-culture-shock').condition?.(ctx)).toBe(false);
    // ...and the ceremony a rewound clock would have pushed to 40 is due now.
    expect(defOf('ev-emig-citizenship').condition?.(ctx)).toBe(true);

    // The wider window closes on the move too, not on the refusal.
    birthday(state, 36);
    expect(defOf('ev-emig-language-wall').condition?.(ctxOf(state))).toBe(false);
  });

  it('restarts the clock when the life actually moves on', () => {
    const state = adultLife(1);
    applyForVisa(state, 'jp', true);
    birthday(state, 36);
    applyForVisa(state, 'de', true);
    const ctx = ctxOf(state);

    expect(state.character.flags.countryLabel).toBe('Germany');
    // Six years in Japan buy nothing in Germany: new country, new first week.
    expect(defOf('ev-emig-culture-shock').condition?.(ctx)).toBe(true);
    expect(defOf('ev-emig-citizenship').condition?.(ctx)).toBe(false);
  });
});

describe('emigration pack through the events phase', () => {
  it('draws nothing for a heir who only ever applied, and spends no randomness', () => {
    const state = heirLife(2);
    applyForVisa(state, 'jp', false);
    const money = state.character.money;
    const before = state.rngState;

    expect(eventsPhase(ctxOf(state, registryOf(emigEvents)))).toEqual([]);
    expect(state.character.money).toBe(money);
    expect(state.rngState).toBe(before);
    expect(state.pending).toEqual([]);
  });

  it('draws for a heir who moved, naming the country they moved to', () => {
    const state = heirLife(2);
    applyForVisa(state, 'jp', true);

    const only = registryOf([defOf('ev-emig-homesickness')]);
    const entries = eventsPhase(ctxOf(state, only, alwaysDraws()));

    expect(entries[0]?.text).toBe(
      'A song you have not heard since childhood came on in a supermarket in Japan.'
    );
  });

  it('never bills a citizen for a visa renewal', () => {
    const state = adultLife(1);
    applyForVisa(state, 'jp', true);
    birthday(state, 36);
    naturalise(state);

    const money = state.character.money;
    const before = state.rngState;
    const only = registryOf([defOf('ev-emig-paperwork')]);

    expect(eventsPhase(ctxOf(state, only))).toEqual([]);
    expect(state.character.money).toBe(money);
    expect(state.rngState).toBe(before);
  });
});
