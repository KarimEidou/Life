import { describe, expect, it } from 'vitest';

import { achievementsPack } from '@/content/achievements';
import { buildRegistry } from '@/engine/registry';
import { createLife } from '@/engine/state';
import { netWorth } from '@/engine/wealth';
import type { AchievementDef, GameState } from '@/types';

/**
 * `ach-millionaire` / `ach-deca-millionaire` and the net worth behind them.
 *
 * The pack used to carry its own copy of the sum — the only one of the three
 * that did not round — so a life the HUD, the finance sheet and the obituary all
 * called a millionaire could miss the achievement by a fraction of a dollar.
 * Both now read `@/engine/wealth`, the same content→engine import `gambling.ts`
 * already makes, and these run the shipped `check` through the def rather than
 * the private helper.
 */

const REG = buildRegistry([]);

function defOf(id: string): AchievementDef {
  const def = (achievementsPack.achievements ?? []).find((candidate) => candidate.id === id);
  if (!def) throw new Error(`achievements ships no "${id}"`);
  return def;
}

const isMillionaire = (state: GameState): boolean => defOf('ach-millionaire').check(state);
const isDecaMillionaire = (state: GameState): boolean =>
  defOf('ach-deca-millionaire').check(state);

function life(seed: number): GameState {
  const state = createLife(REG, { seed, startYear: 2000 });
  state.character.age = 45;
  state.year = 2045;
  return state;
}

describe('the wealth achievements', () => {
  it('unlocks at the threshold and not a dollar below it', () => {
    const state = life(1);

    state.character.money = 999_999;
    expect(isMillionaire(state)).toBe(false);

    state.character.money = 1_000_000;
    expect(isMillionaire(state)).toBe(true);
    expect(isDecaMillionaire(state)).toBe(false);

    state.character.money = 10_000_000;
    expect(isDecaMillionaire(state)).toBe(true);
  });

  it('rounds a fractional fortune up to the million it is displayed as', () => {
    /* The one behaviour this dedup changes: the pack's copy did not round, so a
       paper worth of 999,999.60 read as $1,000,000 on every screen and still
       missed the unlock. The window is sub-dollar and the thresholds are whole
       numbers, so nothing else moves. */
    const state = life(2);
    state.character.money = 999_999.6;

    expect(netWorth(state)).toBe(1_000_000);
    expect(isMillionaire(state)).toBe(true);

    state.character.money = 999_999.4;
    expect(isMillionaire(state)).toBe(false);
  });

  it('counts investments and property, and nets the debt off', () => {
    const state = life(3);
    const c = state.character;
    c.money = 200_000;
    c.investments = { savings: 100_000, index: 400_000, crypto: 100_000 };
    c.assets = [
      {
        id: 'a1',
        defId: 'prop-house',
        label: 'House',
        paid: 300_000,
        value: 400_000,
        yearBought: 2030,
      },
    ];

    expect(isMillionaire(state)).toBe(true);

    // A mortgage the size of the house takes the life back under the line.
    c.loans = [{ id: 'l1', kind: 'mortgage', principal: 400_000, apr: 0.05 }];
    expect(isMillionaire(state)).toBe(false);
  });

  it('stays locked for a fortune whose balance sheet does not add up', () => {
    /* A damaged save can hold a `NaN` balance; `NaN >= 1e6` is false either way,
       but the guard is what stops the sum reaching the epitaph and the
       inheritance as `NaN`. Pinned here so the pack keeps agreeing with them. */
    const state = life(4);
    state.character.investments = { savings: 5_000_000, index: 5_000_000, crypto: 0 };
    state.character.money = Number.NaN;

    expect(netWorth(state)).toBe(0);
    expect(isMillionaire(state)).toBe(false);
    expect(isDecaMillionaire(state)).toBe(false);
  });
});
