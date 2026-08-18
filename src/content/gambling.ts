import { emptyPack } from '@/engine/registry';
import type { ContentPack, ContentRegistry, GameState } from '@/types';

/** Casino content: the venue interactions and the addiction events they feed. */
export const gamblingPack: ContentPack = emptyPack('gambling');

/** A blackjack hand in progress; the store holds one of these while the table is open. */
export interface BlackjackTable {
  bet: number;
  player: string[];
  dealer: string[];
  playerTotal: number;
  dealerTotal: number;
  done: boolean;
  result?: 'win' | 'lose' | 'push' | 'blackjack';
  payout: number;
}

/**
 * Deals a new hand: charges the bet immediately, draws through the engine RNG
 * (`createRng(state)`) so the run stays reproducible, and resolves at once on a
 * dealt blackjack. Cards are display strings such as `A♠`.
 */
export function startBlackjack(
  state: GameState,
  reg: ContentRegistry,
  bet: number
): BlackjackTable {
  throw new Error('TODO:gambling.startBlackjack');
}

/** Draws one card for the player, busting the hand when the total passes 21. */
export function blackjackHit(state: GameState, table: BlackjackTable): BlackjackTable {
  throw new Error('TODO:gambling.blackjackHit');
}

/** Dealer draws to 17, pays winnings into `character.money` and logs one summary line. */
export function blackjackStand(state: GameState, table: BlackjackTable): BlackjackTable {
  throw new Error('TODO:gambling.blackjackStand');
}

/** The three symbols a slot spin landed on and what it paid. */
export interface SlotsResult {
  reels: [string, string, string];
  payout: number;
}

/** Charges the bet, spins three reels and pays out on matching symbols. */
export function spinSlots(
  state: GameState,
  reg: ContentRegistry,
  bet: number
): SlotsResult {
  throw new Error('TODO:gambling.spinSlots');
}

/** Whether a lottery ticket hit, and for how much. */
export interface LotteryResult {
  won: boolean;
  prize: number;
}

/** Charges the ticket price and rolls the long-odds jackpot. */
export function buyLottery(state: GameState, reg: ContentRegistry): LotteryResult {
  throw new Error('TODO:gambling.buyLottery');
}
