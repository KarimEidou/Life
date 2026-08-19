import { describe, expect, it } from 'vitest';

import type { BlackjackTable } from '@/content/gambling';
import {
  LOTTERY_TIERS,
  SLOT_SYMBOLS,
  TICKET_PRICE,
  blackjackHit,
  blackjackStand,
  buyLottery,
  foldBlackjack,
  slotMultiplier,
  spinSlots,
  startBlackjack,
} from '@/content/gambling';
import { buildRegistry } from '@/engine/registry';
import { createLife } from '@/engine/state';
import type { ContentRegistry, GameState, LogEntry } from '@/types';

/**
 * Slots paytable contract.
 *
 * The machine is the one money faucet the player drives by hand: no cooldown,
 * no per-year cap, no interaction gate, just a button that may be tapped as
 * fast as a thumb allows. Its expected return is therefore the only thing
 * between the casino and an unlimited bankroll, and it has to stay under the
 * stake. It once paid 1.76 stakes per stake — any pair returned double, on 48%
 * of spins — which turned $500 a pull into six figures inside 200 taps and
 * defeated every money-gated mechanic in the run, achievements included.
 */

const EMPTY: ContentRegistry = buildRegistry([]);

/** Every line three independent reels can land on, each equally likely. */
const LINES: [string, string, string][] = SLOT_SYMBOLS.flatMap((left) =>
  SLOT_SYMBOLS.flatMap((middle) =>
    SLOT_SYMBOLS.map((right): [string, string, string] => [left, middle, right])
  )
);

/** Stakes paid across every line, and the return that averages out to. */
const PAID_PER_CYCLE = LINES.reduce((sum, line) => sum + slotMultiplier(line), 0);
const EXPECTED_RETURN = PAID_PER_CYCLE / LINES.length;

const TOP_MULT = Math.max(...LINES.map((line) => slotMultiplier(line)));

function isTriple(line: readonly [string, string, string]): boolean {
  return line[0] === line[1] && line[1] === line[2];
}

function hasPair(line: readonly [string, string, string]): boolean {
  return line[0] === line[1] || line[1] === line[2] || line[0] === line[2];
}

function gambler(seed: number, money: number): GameState {
  const state = createLife(EMPTY, { seed, firstName: 'Ada', lastName: 'Moreno' });
  state.character.age = 30;
  state.character.money = money;
  return state;
}

describe('slots paytable', () => {
  it('spans 125 distinct, equally likely lines', () => {
    expect(SLOT_SYMBOLS).toHaveLength(5);
    expect(LINES).toHaveLength(125);
    expect(new Set(LINES.map((line) => line.join('|'))).size).toBe(125);
  });

  it('returns less than a stake per stake wagered', () => {
    /* (30 + 12 + 3×5 + 60×1) / 125 = 0.936, a 6.4% house edge. */
    expect(PAID_PER_CYCLE).toBe(117);
    expect(EXPECTED_RETURN).toBeCloseTo(0.936, 6);
    expect(EXPECTED_RETURN).toBeLessThan(1);
  });

  it('ranks every triple above every pair, and pays nothing else', () => {
    const triples = LINES.filter((line) => isTriple(line));
    const pairs = LINES.filter((line) => !isTriple(line) && hasPair(line));
    const busts = LINES.filter((line) => !hasPair(line));

    expect([triples.length, pairs.length, busts.length]).toEqual([5, 60, 60]);
    expect(Math.min(...triples.map(slotMultiplier))).toBeGreaterThan(
      Math.max(...pairs.map(slotMultiplier))
    );
    expect(Math.max(...busts.map(slotMultiplier))).toBe(0);
  });

  it('hands a pair its stake back and no more, whichever reels matched', () => {
    const [cherry, lemon] = SLOT_SYMBOLS;

    expect(slotMultiplier([cherry, cherry, lemon])).toBe(1);
    expect(slotMultiplier([cherry, lemon, cherry])).toBe(1);
    expect(slotMultiplier([lemon, cherry, cherry])).toBe(1);
  });

  it('pays the jackpot multiplier on exactly one triple', () => {
    /* `spinSlots` sets `casino:jackpot` by comparing the multiplier it paid
       against the three-sevens constant, so no other line may share that value. */
    const top = LINES.filter((line) => slotMultiplier(line) === TOP_MULT);

    expect(top).toHaveLength(1);
    expect(isTriple(top[0])).toBe(true);
  });
});

describe('spinSlots over a long run', () => {
  const SPINS = 20000;
  const BET = 10;
  const START_MONEY = 1000000;

  it('drains the bankroll instead of printing money', () => {
    const state = gambler(7, START_MONEY);
    let staked = 0;
    let paid = 0;
    let jackpots = 0;
    let forgedJackpot = 0;
    let refused = 0;

    for (let i = 0; i < SPINS; i += 1) {
      const spin = spinSlots(state, EMPTY, BET);
      if (spin.reels[0] === '🚫') {
        refused += 1;
        continue;
      }
      staked += BET;
      paid += spin.payout;
      if (spin.payout === BET * TOP_MULT) {
        jackpots += 1;
        if (!isTriple(spin.reels)) forgedJackpot += 1;
      }
    }

    /* A bankroll that ran dry would refuse the rest and leave the measurement
       reading a handful of spins instead of twenty thousand. */
    expect(refused).toBe(0);
    expect(state.character.money).toBe(START_MONEY - staked + paid);
    expect(state.character.money).toBeLessThan(START_MONEY);
    /* Sampling error over 20,000 spins is ~2% of a stake; the band is wide
       enough to survive it and still catch any table that pays its own way. */
    expect(paid / staked).toBeGreaterThan(EXPECTED_RETURN - 0.1);
    expect(paid / staked).toBeLessThan(EXPECTED_RETURN + 0.1);

    expect(jackpots).toBeGreaterThan(0);
    expect(forgedJackpot).toBe(0);
    expect(state.character.flags['casino:jackpot']).toBe(true);
  });
});

/**
 * Lottery ticket contract.
 *
 * The ticket is the same hand-driven faucet as the machine — a fixed $5, no
 * cooldown, no per-year cap, nothing but the wallet between one tap and the
 * next — so the expected prize has to stay under the price. It once stood at
 * $111.40: a 1-in-20,000 shot at $2,000,000 on top of a 1-in-5,000 shot at
 * $50,000 returned twenty-two times what the tickets took, and any bankroll
 * big enough to ride out the variance grew without bound.
 */

/** What one ticket is worth: each tier's band width times the prize behind it. */
const EXPECTED_PRIZE = LOTTERY_TIERS.reduce((sum, tier) => sum + tier.chance * tier.prize, 0);

/** Every prize the table can pay, for checking a run never invented another. */
const PRIZES = new Set(LOTTERY_TIERS.map((tier) => tier.prize));

describe('lottery tiers', () => {
  it('is worth less than the ticket costs', () => {
    /* 0.40 + 1.00 + 0.25 + 0.80 = $2.45 against a $5 ticket, a 49% return. */
    expect(EXPECTED_PRIZE).toBeCloseTo(2.45, 6);
    expect(EXPECTED_PRIZE).toBeLessThan(TICKET_PRICE);
  });

  it('hangs longer odds on bigger prizes and leaves a losing band', () => {
    const chances = LOTTERY_TIERS.map((tier) => tier.chance);
    const prizes = LOTTERY_TIERS.map((tier) => tier.prize);

    /* The walk is disjoint whatever the order, but the ladder is what the
       prose, the joy deltas and the log/achievement thresholds all assume. */
    expect(prizes).toEqual([...prizes].sort((a, b) => b - a));
    expect(chances).toEqual([...chances].sort((a, b) => a - b));
    expect(new Set(prizes).size).toBe(prizes.length);
    expect(LOTTERY_TIERS.every((tier) => tier.prize > 0 && tier.joy > 0)).toBe(true);

    /* Most tickets have to lose: together the bands cover a sliver of the line. */
    expect(chances.reduce((sum, chance) => sum + chance, 0)).toBeLessThan(0.1);

    /* And none of them may be thinner than one step of the 32-bit stream, or
       the tier would be a prize the draw can never land on. */
    expect(Math.min(...chances)).toBeGreaterThan(2 ** -32);
  });
});

describe('buyLottery over a long run', () => {
  const TICKETS = 200000;
  const START_MONEY = 5000000;

  it('takes more than it hands back, band by band', () => {
    const state = gambler(11, START_MONEY);
    const hits = new Map<number, number>();
    let paid = 0;
    let mislabelled = 0;

    for (let i = 0; i < TICKETS; i += 1) {
      const ticket = buyLottery(state, EMPTY);
      if (ticket.won !== (ticket.prize > 0)) mislabelled += 1;
      paid += ticket.prize;
      hits.set(ticket.prize, (hits.get(ticket.prize) ?? 0) + 1);
    }

    /* The counter bumps only on a ticket that was actually sold, so a bankroll
       that ran dry mid-run would show up here rather than skewing the rates. */
    expect(state.character.flags['casino:ticketsBought']).toBe(TICKETS);
    expect(state.character.money).toBe(START_MONEY - TICKETS * TICKET_PRICE + paid);
    expect(mislabelled).toBe(0);
    expect([...hits.keys()].filter((prize) => prize !== 0 && !PRIZES.has(prize))).toEqual([]);

    /* The tier test above is the guarantee; this is the walk honouring it with
       real money, on the same stream the rest of the year is drawn from. */
    expect(paid).toBeLessThan(TICKETS * TICKET_PRICE);
    expect(state.character.money).toBeLessThan(START_MONEY);

    /* Observed band rates, within about four standard errors of their width:
       the walk pays each tier as often as the table says it should. */
    expect((hits.get(20) ?? 0) / TICKETS).toBeGreaterThan(0.0384);
    expect((hits.get(20) ?? 0) / TICKETS).toBeLessThan(0.0416);
    expect(hits.get(500) ?? 0).toBeGreaterThan(60);
    expect(hits.get(500) ?? 0).toBeLessThan(140);
  });
});

/**
 * Walking away from an unfinished hand.
 *
 * The stake is charged as the hand is dealt and only `settleHand` ever pays
 * anything back, which takes playing the hand out — something a life that has
 * ended can no longer do. A hand still open at the moment of death was
 * therefore unresolvable: the money stayed taken with no line in the feed to
 * account for it, and the table stayed `done: false` for whatever the store
 * persisted next, so a reload restored the same stuck hand onto a dead life.
 */

const BLACKJACK_BET = 500;

/** The year the character is living, which is where the casino logs. */
function feed(state: GameState): LogEntry[] {
  const year = state.log[state.log.length - 1];
  if (year === undefined) throw new Error('expected a year log');
  return year.entries;
}

/** Deals until a hand survives the deal; a dealt 21 settles on the spot. */
function dealOpenHand(state: GameState): { table: BlackjackTable; held: number } {
  for (let i = 0; i < 100; i += 1) {
    const held = state.character.money;
    const table = startBlackjack(state, EMPTY, BLACKJACK_BET);
    if (!table.done) return { table, held };
  }
  throw new Error('expected an open blackjack table');
}

describe('foldBlackjack', () => {
  it('hands the stake back, closes the table and draws nothing', () => {
    const state = gambler(3, 5000);
    const { table, held } = dealOpenHand(state);
    expect(state.character.money).toBe(held - BLACKJACK_BET);

    const lines = feed(state).length;
    const cursor = state.rngState;
    const folded = foldBlackjack(state, table);

    expect(folded.done).toBe(true);
    expect(folded.result).toBe('push');
    expect(folded.payout).toBe(BLACKJACK_BET);
    expect(state.character.money).toBe(held);
    /* No card is drawn, so a folded hand cannot shift a later roll. */
    expect(state.rngState).toBe(cursor);

    const written = feed(state).slice(lines);
    expect(written).toHaveLength(1);
    expect(written[0]?.kind).toBe('money');
    expect(written[0]?.text).toContain('$500');
  });

  it('leaves a finished hand alone rather than paying its stake twice', () => {
    const state = gambler(3, 5000);
    const { table } = dealOpenHand(state);
    const folded = foldBlackjack(state, table);

    const money = state.character.money;
    const lines = feed(state).length;
    const again = foldBlackjack(state, folded);

    expect(again).toBe(folded);
    expect(state.character.money).toBe(money);
    expect(feed(state)).toHaveLength(lines);
  });

  it('books no stake at all for a table carrying an unreadable bet', () => {
    /* `payout` is what the store and the sheet do their arithmetic against, so
       a poisoned stake has to widen to nothing here rather than travel on. */
    const state = gambler(3, 5000);
    const { table } = dealOpenHand(state);
    const money = state.character.money;
    const folded = foldBlackjack(state, { ...table, bet: Number.NaN });

    expect(folded.payout).toBe(0);
    expect(state.character.money).toBe(money);
  });
});

describe('a hand still open when the life ends', () => {
  it('folds on a stand instead of stranding the stake', () => {
    const state = gambler(3, 5000);
    const { table, held } = dealOpenHand(state);
    const lines = feed(state).length;
    state.phase = 'dead';

    const settled = blackjackStand(state, table);

    expect(settled.done).toBe(true);
    expect(state.character.money).toBe(held);
    expect(feed(state).slice(lines).map((entry) => entry.text)).toEqual([
      'Blackjack: left the table mid-hand. Your $500 came back.',
    ]);
    /* A dead life is still closed to play: the dealer drew no hole card. */
    expect(settled.dealer).toEqual(table.dealer);
  });

  it('folds on a hit instead of stranding the stake', () => {
    const state = gambler(3, 5000);
    const { table, held } = dealOpenHand(state);
    const cursor = state.rngState;
    state.phase = 'dead';

    const settled = blackjackHit(state, table);

    expect(settled.done).toBe(true);
    expect(settled.player).toEqual(table.player);
    expect(state.character.money).toBe(held);
    expect(state.rngState).toBe(cursor);
  });

  it('never counts an unfinished hand as one played', () => {
    const state = gambler(3, 5000);
    const { table } = dealOpenHand(state);
    const played = state.character.flags['casino:handsPlayed'];
    const habit = state.character.addictions.gambling;
    state.phase = 'dead';

    blackjackStand(state, table);

    expect(state.character.flags['casino:handsPlayed']).toBe(played);
    expect(state.character.addictions.gambling).toBe(habit);
  });
});
