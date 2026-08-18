/**
 * Display formatting and narrative text templating.
 *
 * Pure helpers: nothing here reads or writes game state beyond the values it is
 * handed, so the UI and the engine can both call them freely.
 */

import type { Ctx, GameState } from '@/types';

/** Formats a whole-currency amount, e.g. `$12,340` and `-$500` for negatives. */
export function fmtMoney(n: number): string {
  throw new Error('TODO:format.fmtMoney');
}

/** Formats money with a magnitude suffix for tight spaces, e.g. `$1.2M`. */
export function fmtMoneyCompact(n: number): string {
  throw new Error('TODO:format.fmtMoneyCompact');
}

/** Substitutes `{name} {firstName} {lastName} {he} {him} {his} {partner} {country} {age}`. */
export function fillTemplate(text: string, state: GameState): string {
  throw new Error('TODO:format.fillTemplate');
}

/** Resolves content text that may be a literal or a builder, then fills its templates. */
export function resolveText(text: string | ((ctx: Ctx) => string), ctx: Ctx): string {
  throw new Error('TODO:format.resolveText');
}
