/**
 * Net worth: the one number the HUD, the finance sheet, the obituary, the
 * inheritance split and the wealth achievements all quote.
 *
 * A leaf module by design: it imports `@/types` and nothing else — no phase, no
 * registry, no rng, no draws. That is what lets `death.ts` value an estate while
 * the character is already dead without depending on the finance phase, and lets
 * an achievement check reach the same answer without importing a phase at all.
 */

import type { GameState } from '@/types';

/** Cash + investments + asset values - outstanding loan principal, rounded. */
export function netWorth(state: GameState): number {
  const c = state.character;
  const invested = c.investments.savings + c.investments.index + c.investments.crypto;
  const owned = c.assets.reduce((sum, asset) => sum + asset.value, 0);
  const owed = c.loans.reduce((sum, loan) => sum + loan.principal, 0);
  const total = c.money + invested + owned - owed;
  /* A balance sheet that does not add up is worth nothing rather than `NaN`:
     `Math.max(0, NaN)` is `NaN`, so the floor `startLegacy` puts under the
     inheritance would not hold, `epitaphStats.netWorth` would serialise as
     `null`, and every threshold test against it would invert. Zero is also what
     `fmtMoney`/`fmtMoneyCompact` already display for a number that is not one. */
  return Number.isFinite(total) ? Math.round(total) : 0;
}
