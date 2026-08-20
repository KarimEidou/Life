import { describe, expect, it } from 'vitest';

import { killCharacter, startLegacy } from '@/engine/death';
import { netWorth as financeNetWorth } from '@/engine/phases/finance';
import { buildRegistry } from '@/engine/registry';
import { addPerson, createLife } from '@/engine/state';
import { netWorth } from '@/engine/wealth';
import type { GameState, Person } from '@/types';

/**
 * The one net worth.
 *
 * The HUD, the finance sheet, the obituary, the inheritance split and two
 * achievements all quote this number, and it used to be three hand-written sums
 * that disagreed: the finance phase rounded but let a broken balance sheet
 * through as `NaN`, the estate rounded and guarded, the achievement check
 * guarded but did not round. These pin the single answer they now share.
 */

const REG = buildRegistry([]);

function life(seed: number, age = 40): GameState {
  const state = createLife(REG, { seed, startYear: 2000 });
  state.character.age = age;
  state.year = 2000 + age;
  return state;
}

function child(state: GameState, age = 25): Person {
  return addPerson(state, {
    kind: 'child',
    name: 'Nina Doe',
    gender: 'female',
    age,
    alive: true,
    rel: 80,
    flags: {},
  });
}

describe('netWorth', () => {
  it('adds cash, investments and asset values, then subtracts loan principal', () => {
    const state = life(1);
    const c = state.character;
    c.money = 100;
    c.investments = { savings: 200, index: 300, crypto: 400 };
    c.assets = [
      { id: 'a1', defId: 'prop-condo', label: 'Condo', paid: 900, value: 1000, yearBought: 2000 },
      { id: 'a2', defId: 'veh-car', label: 'Car', paid: 500, value: 250, yearBought: 2000 },
    ];
    c.loans = [{ id: 'l1', kind: 'personal', principal: 500, apr: 0.09 }];

    expect(netWorth(state)).toBe(1750);
  });

  it('goes negative when the debt outweighs everything owned', () => {
    const state = life(2);
    state.character.money = 10;
    state.character.loans = [{ id: 'l1', kind: 'student', principal: 5000, apr: 0.05 }];

    expect(netWorth(state)).toBe(-4990);
  });

  it('rounds the total, so a fraction cannot sit just under a threshold', () => {
    /* The achievements pack's copy did not round: a paper worth of 999,999.60
       displayed as $1,000,000 everywhere and still missed `ach-millionaire`. */
    const state = life(3);
    state.character.money = 999_999.6;
    expect(netWorth(state)).toBe(1_000_000);

    state.character.money = 999_999.4;
    expect(netWorth(state)).toBe(999_999);
  });

  it('is worth nothing, never `NaN`, when the balance sheet does not add up', () => {
    /* Nothing validates the numbers a save or a content pack delivers, and
       `Math.max(0, NaN)` is `NaN`, so an unguarded sum would take the floor out
       from under the inheritance and serialise the epitaph as `null`. */
    for (const poison of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const state = life(4);
      state.character.money = poison;
      expect(netWorth(state)).toBe(0);

      const broken = life(5);
      broken.character.money = 100_000;
      broken.character.assets = [
        { id: 'a1', defId: 'prop-house', label: 'House', paid: 0, value: poison, yearBought: 1990 },
      ];
      expect(netWorth(broken)).toBe(0);

      const owing = life(6);
      owing.character.money = 100_000;
      owing.character.loans = [{ id: 'l1', kind: 'personal', principal: poison, apr: 0.1 }];
      expect(netWorth(owing)).toBe(0);
    }
  });

  it('is the very function the finance phase publishes', () => {
    // The re-export is the dedup: two bindings would be two rulesets again.
    expect(financeNetWorth).toBe(netWorth);
  });
});

describe('the estate is the same number', () => {
  it('quotes net worth in the epitaph, fraction and all', () => {
    const state = life(7, 71);
    const c = state.character;
    c.money = 1200;
    c.investments = { savings: 0, index: 500, crypto: 0 };
    c.assets = [
      { id: 'a1', defId: 'prop-flat', label: 'Flat', paid: 0, value: 300.5, yearBought: 1990 },
    ];
    c.loans = [{ id: 'l1', kind: 'student', principal: 1000, apr: 0.04 }];
    const worth = netWorth(state);

    killCharacter(state, REG, 'old age');

    expect(worth).toBe(1001);
    expect(state.death?.epitaphStats.netWorth).toBe(worth);
    expect(state.death?.obituary).toContain('Left $1,001 and 0 children.');
  });

  it('leaves a broken estate at zero rather than passing `NaN` to the heir', () => {
    const state = life(8, 80);
    state.character.money = Number.NaN;
    state.character.investments = { savings: 50_000, index: 0, crypto: 0 };
    const heir = child(state);

    killCharacter(state, REG, 'old age');

    expect(state.death?.epitaphStats.netWorth).toBe(0);
    expect(startLegacy(state, REG, heir.id).character.money).toBe(0);
  });

  it('splits 80% of the estate between the heirs', () => {
    const state = life(9, 80);
    state.character.money = 100_000;
    const heir = child(state);

    killCharacter(state, REG, 'old age');

    expect(state.death?.epitaphStats.netWorth).toBe(100_000);
    expect(startLegacy(state, REG, heir.id).character.money).toBe(80_000);
  });
});
