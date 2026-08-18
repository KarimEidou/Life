/**
 * Finance phase plus every money action the player can take directly.
 */

import type {
  ContentRegistry,
  Ctx,
  GameState,
  Investments,
  LogEntry,
} from '@/types';

/** Charges living costs, taxes, upkeep and loan interest; grows investments and assets. */
export function financePhase(ctx: Ctx): LogEntry[] {
  throw new Error('TODO:finance.financePhase');
}

/** Cash plus investments plus asset values, minus outstanding loan principal. */
export function netWorth(state: GameState): number {
  throw new Error('TODO:finance.netWorth');
}

/** Moves cash into an investment vehicle; false when the cash is not there. */
export function depositInvestment(
  state: GameState,
  kind: keyof Investments,
  amount: number
): boolean {
  throw new Error('TODO:finance.depositInvestment');
}

/** Moves money out of an investment vehicle; false when the balance is too low. */
export function withdrawInvestment(
  state: GameState,
  kind: keyof Investments,
  amount: number
): boolean {
  throw new Error('TODO:finance.withdrawInvestment');
}

/** Borrows against income and existing debt, adding a personal loan on success. */
export function takeLoan(
  state: GameState,
  reg: ContentRegistry,
  amount: number
): { ok: boolean; reason?: string } {
  throw new Error('TODO:finance.takeLoan');
}

/** Pays down a loan's principal by up to `amount`, clearing it when it reaches zero. */
export function repayLoan(state: GameState, loanId: string, amount: number): void {
  throw new Error('TODO:finance.repayLoan');
}

/** Buys an asset outright or with a secured loan for the balance. */
export function buyAsset(
  state: GameState,
  reg: ContentRegistry,
  defId: string,
  withLoan?: boolean
): { ok: boolean; reason?: string } {
  throw new Error('TODO:finance.buyAsset');
}

/** Sells an owned asset at its current value, settling any loan secured against it. */
export function sellAsset(state: GameState, assetId: string): void {
  throw new Error('TODO:finance.sellAsset');
}
