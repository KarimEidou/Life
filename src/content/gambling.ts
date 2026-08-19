import { currentYearLog } from '@/engine/ageUp';
import { clampMoney, clampStat } from '@/engine/effects';
import { fmtMoney } from '@/engine/format';
import { createRng } from '@/engine/rng';
import type {
  ContentPack,
  ContentRegistry,
  Ctx,
  EventDef,
  GameState,
  LogKind,
  Rng,
} from '@/types';

/**
 * The casino: three games the player drives directly, plus the events that grow
 * out of playing them.
 *
 * Every draw goes through `createRng(state)`, never `Math.random`, so a hand of
 * blackjack is part of the same reproducible sequence as the year around it —
 * the same seed dealt the same cards, and a save/load round trip in the middle
 * of a session cannot re-roll a bet that has already been charged.
 *
 * Two invariants hold across all three games. A refused bet is completely free:
 * no money moves, no draw is spent, no log line is written, so asking to play
 * with a bet nobody can cover never nudges the run's sequence. And money is only
 * ever written through `clampMoney`, which floors the balance at zero and
 * refuses an unreadable amount rather than storing it — a wallet cannot go
 * negative at this table and cannot be poisoned by a NaN a UI field handed in.
 */

/* ------------------------------------------------------------------ */
/* State writes                                                        */
/* ------------------------------------------------------------------ */

/** Whole dollars a stake is worth; anything unreadable is no stake at all. */
function wholeBet(bet: number): number {
  return Number.isFinite(bet) ? Math.floor(bet) : 0;
}

/**
 * What the character can actually put on the table.
 *
 * Widened rather than read straight, because `NaN > NaN` is false and an
 * unreadable balance would therefore pass every affordability test and let a
 * player bet money nobody has. A balance that arrived poisoned buys nothing.
 */
function bankroll(state: GameState): number {
  const held = state.character.money;
  return Number.isFinite(held) ? held : 0;
}

/** Takes the stake. `clampMoney` keeps the balance whole and never negative. */
function charge(state: GameState, amount: number): void {
  const c = state.character;
  c.money = clampMoney(c.money - amount, c.money);
}

/** Pays winnings in, rounded to whole dollars like every other money write. */
function payOut(state: GameState, amount: number): void {
  if (!(amount > 0)) return;
  const c = state.character;
  c.money = clampMoney(c.money + amount, c.money);
}

/** The gambling severity a save actually holds, widened against junk. */
function gamblingSeverity(state: GameState): number {
  const held: unknown = state.character.addictions.gambling;
  return typeof held === 'number' && Number.isFinite(held) ? held : 0;
}

/** Moves the gambling addiction, clamped 0..100 exactly as the engine would. */
function addAddiction(state: GameState, delta: number): void {
  const c = state.character;
  const next = clampStat(gamblingSeverity(state) + delta);
  if (next <= 0) delete c.addictions.gambling;
  else c.addictions.gambling = next;
}

/** A flag counter that survives a save holding a string, a boolean or NaN. */
function counter(state: GameState, flag: string): number {
  const raw = state.character.flags[flag];
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return 0;
  return Math.floor(raw);
}

/** Bumps one of the casino counters and hands back the new total. */
function bumpCounter(state: GameState, flag: string, step = 1): number {
  const next = counter(state, flag) + step;
  state.character.flags[flag] = next;
  return next;
}

/** Appends one line to the year the character is currently living. */
function logLine(state: GameState, icon: string, text: string, kind: LogKind): void {
  currentYearLog(state).entries.push({ icon, text, kind });
}

/** A finished life is read-only: no game may charge it or pay it. */
function tableClosed(state: GameState): boolean {
  return state.phase === 'dead';
}

/* ------------------------------------------------------------------ */
/* Blackjack                                                           */
/* ------------------------------------------------------------------ */

/**
 * An infinite shoe: every rank is equally likely on every card, which is the
 * same 4-in-13 chance of a ten-value card a real deck deals and needs no state
 * carried between hands.
 */
const RANKS: readonly string[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUITS: readonly string[] = ['♠', '♥', '♦', '♣'];

const MIN_BLACKJACK_BET = 10;
const BLACKJACK_TOTAL = 21;
/** The dealer stands on any 17, soft ones included. */
const DEALER_STANDS_ON = 17;
/** A dealt 21 returns two and a half times the stake, stake included. */
const NATURAL_PAYOUT = 2.5;
/** Severity a finished hand adds, win or lose. */
const HAND_ADDICTION = 2;

const BLACKJACK_ICON = '🃏';

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

/** The inert table a refused deal returns: no cards, no result, nothing charged. */
function closedTable(): BlackjackTable {
  return {
    bet: 0,
    player: [],
    dealer: [],
    playerTotal: 0,
    dealerTotal: 0,
    done: true,
    payout: 0,
  };
}

function drawCard(rng: Rng): string {
  return `${rng.pick(RANKS)}${rng.pick(SUITS)}`;
}

/** Blackjack value of one card; an ace counts 11 here and is demoted by `handTotal`. */
function cardValue(card: string): number {
  // Every suit is one UTF-16 unit, so the rank is everything before it.
  const rank = card.slice(0, -1);
  if (rank === 'A') return 11;
  if (rank === 'K' || rank === 'Q' || rank === 'J') return 10;
  const pips = Number(rank);
  return Number.isFinite(pips) ? pips : 0;
}

/** The best total a hand can make: aces drop from 11 to 1 until it fits under 22. */
function handTotal(cards: readonly string[]): number {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    const value = cardValue(card);
    if (value === 11) aces += 1;
    total += value;
  }
  while (total > BLACKJACK_TOTAL && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

/** One line per finished hand, phrased by what the player actually gained. */
function handSummary(table: BlackjackTable, net: number): string {
  if (table.result === 'blackjack') return `Blackjack: dealt 21 and won ${fmtMoney(net)}.`;
  if (table.result === 'win') return `Blackjack: won ${fmtMoney(net)}.`;
  if (table.result === 'push') return `Blackjack: a push. Your ${fmtMoney(table.bet)} came back.`;
  return `Blackjack: lost ${fmtMoney(table.bet)}.`;
}

/**
 * Closes a hand once and only once: pays the stake back in, writes the single
 * summary line, and books the habit. Every finished hand — a dealt 21, a bust,
 * or a showdown — comes through here, so the log never carries two lines for
 * one hand and `casino:handsPlayed` never counts one twice.
 *
 * `payout` is what goes *into* the balance, stake included: 0 for a loss, the
 * stake for a push, twice it for a win.
 */
function settleHand(
  state: GameState,
  table: BlackjackTable,
  result: 'win' | 'lose' | 'push' | 'blackjack',
  payout: number
): BlackjackTable {
  const paid = Number.isFinite(payout) ? Math.max(0, Math.round(payout)) : 0;
  const settled: BlackjackTable = { ...table, done: true, result, payout: paid };
  payOut(state, paid);
  logLine(state, BLACKJACK_ICON, handSummary(settled, paid - settled.bet), 'money');
  addAddiction(state, HAND_ADDICTION);
  bumpCounter(state, 'casino:handsPlayed');
  return settled;
}

/**
 * Deals a new hand: charges the bet immediately, draws through the engine RNG
 * (`createRng(state)`) so the run stays reproducible, and resolves at once on a
 * dealt blackjack. Cards are display strings such as `A♠`.
 *
 * The player gets two cards, the dealer one — the hole card is drawn on the
 * stand, so nothing the table exposes is information a real dealer would hide.
 * A bet under $10, over the balance or simply unreadable is refused with the
 * inert table from `closedTable`: nothing charged, nothing drawn.
 */
export function startBlackjack(
  state: GameState,
  reg: ContentRegistry,
  bet: number
): BlackjackTable {
  const stake = wholeBet(bet);
  if (tableClosed(state)) return closedTable();
  if (stake < MIN_BLACKJACK_BET || stake > bankroll(state)) return closedTable();

  charge(state, stake);
  const rng = createRng(state);
  const player = [drawCard(rng), drawCard(rng)];
  const dealer = [drawCard(rng)];
  const table: BlackjackTable = {
    bet: stake,
    player,
    dealer,
    playerTotal: handTotal(player),
    dealerTotal: handTotal(dealer),
    done: false,
    payout: 0,
  };

  if (table.playerTotal === BLACKJACK_TOTAL) {
    return settleHand(state, table, 'blackjack', Math.round(stake * NATURAL_PAYOUT));
  }
  return table;
}

/**
 * Draws one card for the player, busting the hand when the total passes 21.
 * A total of exactly 21 stands itself, so nobody has to click twice.
 */
export function blackjackHit(state: GameState, table: BlackjackTable): BlackjackTable {
  if (table.done || tableClosed(state)) return table;

  const rng = createRng(state);
  const player = [...table.player, drawCard(rng)];
  const hit: BlackjackTable = { ...table, player, playerTotal: handTotal(player) };

  if (hit.playerTotal > BLACKJACK_TOTAL) return settleHand(state, hit, 'lose', 0);
  if (hit.playerTotal === BLACKJACK_TOTAL) return blackjackStand(state, hit);
  return hit;
}

/** Dealer draws to 17, pays winnings into `character.money` and logs one summary line. */
export function blackjackStand(state: GameState, table: BlackjackTable): BlackjackTable {
  if (table.done || tableClosed(state)) return table;

  const rng = createRng(state);
  const dealer = [...table.dealer];
  let dealerTotal = handTotal(dealer);
  // Every card is worth at least one, so the draw always terminates.
  while (dealerTotal < DEALER_STANDS_ON) {
    dealer.push(drawCard(rng));
    dealerTotal = handTotal(dealer);
  }
  const shown: BlackjackTable = { ...table, dealer, dealerTotal };

  if (dealerTotal > BLACKJACK_TOTAL || shown.playerTotal > dealerTotal) {
    return settleHand(state, shown, 'win', shown.bet * 2);
  }
  if (shown.playerTotal === dealerTotal) return settleHand(state, shown, 'push', shown.bet);
  return settleHand(state, shown, 'lose', 0);
}

/* ------------------------------------------------------------------ */
/* Slots                                                               */
/* ------------------------------------------------------------------ */

/** The reel strip; every reel is drawn from it independently. */
export const SLOT_SYMBOLS: readonly string[] = ['🍒', '🍋', '🔔', '💎', '7️⃣'];
const SEVEN = '7️⃣';
const DIAMOND = '💎';

const MIN_SLOT_BET = 5;
const MAX_SLOT_BET = 1000;
/**
 * The paytable, in stakes paid back. Three reels over five symbols make 125
 * equally likely lines — 1 all sevens, 1 all diamonds, 3 another triple, 60 a
 * single pair — so the machine returns (30 + 12 + 3×5 + 60×1) / 125 = 0.936
 * stakes per stake wagered.
 *
 * Two constraints ride on these numbers, and the pack test pins both. The
 * return has to stay under 1: nothing caps how often the handle may be pulled —
 * no cooldown, no yearly cap, no interaction gate — so a machine paying more
 * than it takes is not a game but an unlimited wallet, and every money-gated
 * mechanic in the run is defeated by holding down one button. And
 * `TRIPLE_SEVEN_MULT` has to stay unique among these, because the jackpot flag
 * is set by comparing the multiplier a spin paid against it.
 */
const TRIPLE_SEVEN_MULT = 30;
const TRIPLE_DIAMOND_MULT = 12;
const TRIPLE_MULT = 5;
/** A pair hands the stake back: the reels teased, the wallet stayed put. */
const PAIR_MULT = 1;
/** Every triple is loud enough for the life feed; a pair is not news. */
const SLOT_LOG_MULT = TRIPLE_MULT;
const SPIN_ADDICTION = 1;

const SLOTS_ICON = '🎰';

/** The three symbols a slot spin landed on and what it paid. */
export interface SlotsResult {
  reels: [string, string, string];
  payout: number;
}

/** What a refused spin shows: three blocked signs, nothing charged, nothing drawn. */
function refusedSpin(): SlotsResult {
  return { reels: ['🚫', '🚫', '🚫'], payout: 0 };
}

/**
 * Stakes paid on one line: three 7s, three diamonds, any other triple, or a
 * pair, which pays the stake back and nothing on top of it.
 */
export function slotMultiplier(reels: readonly [string, string, string]): number {
  const [left, middle, right] = reels;
  if (left === middle && middle === right) {
    if (left === SEVEN) return TRIPLE_SEVEN_MULT;
    if (left === DIAMOND) return TRIPLE_DIAMOND_MULT;
    return TRIPLE_MULT;
  }
  if (left === middle || middle === right || left === right) return PAIR_MULT;
  return 0;
}

/**
 * Charges the bet, spins three reels and pays out on matching symbols.
 * Bets run $5 to $1,000; anything outside that or over the balance is refused
 * for free. Three 7s set `casino:jackpot`, which is what the jackpot
 * achievement reads.
 */
export function spinSlots(
  state: GameState,
  reg: ContentRegistry,
  bet: number
): SlotsResult {
  const stake = wholeBet(bet);
  if (tableClosed(state)) return refusedSpin();
  if (stake < MIN_SLOT_BET || stake > MAX_SLOT_BET || stake > bankroll(state)) {
    return refusedSpin();
  }

  charge(state, stake);
  const rng = createRng(state);
  const reels: [string, string, string] = [
    rng.pick(SLOT_SYMBOLS),
    rng.pick(SLOT_SYMBOLS),
    rng.pick(SLOT_SYMBOLS),
  ];

  const mult = slotMultiplier(reels);
  const payout = Math.round(stake * mult);
  payOut(state, payout);
  if (mult === TRIPLE_SEVEN_MULT) state.character.flags['casino:jackpot'] = true;
  addAddiction(state, SPIN_ADDICTION);
  bumpCounter(state, 'casino:spins');

  if (mult >= SLOT_LOG_MULT) {
    logLine(state, SLOTS_ICON, `Slots: ${reels.join(' ')} paid ${fmtMoney(payout)}.`, 'money');
  }
  return { reels, payout };
}

/* ------------------------------------------------------------------ */
/* Lottery                                                             */
/* ------------------------------------------------------------------ */

export const TICKET_PRICE = 5;

/**
 * Prize tiers, longest odds first; one draw walks them as disjoint bands, so a
 * tier's chance is exactly the width of its band and the odds read straight off
 * the table: 1 in 5,000,000, 1 in 50,000, 1 in 2,000, 1 in 25.
 *
 * The constraint the slot paytable carries applies here too, and harder: a
 * ticket has no cooldown, no per-year cap and no interaction gate, so nothing
 * stands between the player and an unlimited bankroll except the expected prize
 * being smaller than the price. It comes to $2.45 on a $5 ticket
 * (0.0000002×2,000,000 + 0.00002×50,000 + 0.0005×500 + 0.04×20) — a 49% return,
 * about what a real lottery pays back. The pack test pins it under the price.
 */
export const LOTTERY_TIERS: readonly { chance: number; prize: number; joy: number }[] = [
  { chance: 0.0000002, prize: 2000000, joy: 15 },
  { chance: 0.00002, prize: 50000, joy: 8 },
  { chance: 0.0005, prize: 500, joy: 3 },
  { chance: 0.04, prize: 20, joy: 1 },
];

/** A win worth telling the life feed about. */
const LOTTERY_LOG_PRIZE = 500;
/**
 * A win the achievement wall counts as beating the odds, which is why it sits
 * at the $50,000 tier rather than the $2,000,000 one: `ach-lottery-winner`
 * reads `casino:lotteryWin`, and hanging it on the jackpot alone would make it
 * an achievement nobody ever sees. Odds long enough to keep the ticket honest
 * make even this tier a rare sight from the casino, which is why the adult
 * sidewalk-ticket event sets the same flag on its own top outcome.
 */
const LOTTERY_WIN_PRIZE = 50000;

const LOTTERY_ICON = '🎟️';

/** Whether a lottery ticket hit, and for how much. */
export interface LotteryResult {
  won: boolean;
  prize: number;
}

/** Charges the ticket price and rolls the long-odds jackpot. */
export function buyLottery(state: GameState, reg: ContentRegistry): LotteryResult {
  const c = state.character;
  if (tableClosed(state) || bankroll(state) < TICKET_PRICE) return { won: false, prize: 0 };

  charge(state, TICKET_PRICE);
  const rng = createRng(state);
  const roll = rng.next();

  let prize = 0;
  let joy = 0;
  let edge = 0;
  for (const tier of LOTTERY_TIERS) {
    edge += tier.chance;
    if (roll < edge) {
      prize = tier.prize;
      joy = tier.joy;
      break;
    }
  }

  /* Half a point of habit per ticket, booked as a whole point on every second
     one — a counter rather than a coin flip, so buying tickets never shifts the
     sequence the rest of the year is drawn from. */
  if (bumpCounter(state, 'casino:ticketsBought') % 2 === 0) addAddiction(state, 1);

  if (prize <= 0) return { won: false, prize: 0 };

  payOut(state, prize);
  c.stats.happiness = clampStat(c.stats.happiness + joy);
  if (prize >= LOTTERY_WIN_PRIZE) c.flags['casino:lotteryWin'] = true;
  if (prize >= LOTTERY_LOG_PRIZE) {
    const text =
      prize >= LOTTERY_WIN_PRIZE
        ? `Lottery jackpot: ${fmtMoney(prize)} on a $5 ticket. You read it eleven times.`
        : `Lottery: your ticket paid ${fmtMoney(prize)}.`;
    logLine(state, LOTTERY_ICON, text, 'money');
  }
  return { won: true, prize };
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

/** Not behind bars. The prison pack owns those years; a casino floor is not in them. */
function free(ctx: Ctx): boolean {
  return ctx.c.prison === null;
}

/** Already has the habit, to at least this severity. Widened against a junk save. */
function hooked(minSeverity: number): (ctx: Ctx) => boolean {
  return (ctx: Ctx): boolean => free(ctx) && gamblingSeverity(ctx.state) >= minSeverity;
}

const events: EventDef[] = [
  {
    id: 'ev-gamble-comp-night',
    area: 'nightlife',
    icon: '🎰',
    minAge: 18,
    maxAge: 95,
    weight: 3,
    condition: free,
    text: 'The casino comped you a buffet and $100 in chips. The buffet was fine.',
    choices: [
      {
        label: 'Cash the chips and leave',
        outcomes: [
          {
            weight: 5,
            text: 'You walked out $100 up and slept like a baby.',
            effects: [
              { kind: 'money', delta: 100 },
              { kind: 'stat', stat: 'happiness', delta: 3 },
            ],
          },
        ],
      },
      {
        label: 'Play them out',
        outcomes: [
          {
            weight: 3,
            text: 'The chips ran hot. You left with $2,400 and a story you still tell.',
            effects: [
              { kind: 'money', delta: 2400 },
              { kind: 'stat', stat: 'happiness', delta: 8 },
              { kind: 'addiction', which: 'gambling', delta: 3 },
            ],
          },
          {
            weight: 5,
            text: 'The chips went first. Then $600 of your own.',
            effects: [
              { kind: 'money', delta: -600 },
              { kind: 'stat', stat: 'happiness', delta: -5 },
              { kind: 'addiction', which: 'gambling', delta: 3 },
            ],
          },
          {
            weight: 2,
            text: 'Four hours, one free soda, exactly even.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: -2 },
              { kind: 'addiction', which: 'gambling', delta: 2 },
            ],
          },
        ],
      },
    ],
  },

  {
    id: 'ev-gamble-poker-buddies',
    area: 'fun',
    icon: '🃏',
    minAge: 18,
    maxAge: 90,
    weight: 4,
    condition: free,
    text: "Thursday poker in somebody's garage. $100 buy-in, snacks provided.",
    choices: [
      {
        label: 'Play tight',
        outcomes: [
          {
            weight: 5,
            text: 'You folded all night, won two big pots and left up $80.',
            effects: [
              { kind: 'money', delta: 80 },
              { kind: 'stat', stat: 'happiness', delta: 2 },
              { kind: 'addiction', which: 'gambling', delta: 1 },
            ],
          },
          {
            weight: 3,
            text: 'Tight, patient and card-dead. There went the buy-in.',
            effects: [
              { kind: 'money', delta: -100 },
              { kind: 'stat', stat: 'happiness', delta: -2 },
              { kind: 'addiction', which: 'gambling', delta: 1 },
            ],
          },
        ],
      },
      {
        label: 'Bluff big',
        outcomes: [
          {
            weight: 3,
            text: 'You represented a flush you did not have. They are still talking about it.',
            effects: [
              { kind: 'money', delta: 700 },
              { kind: 'stat', stat: 'happiness', delta: 9 },
              { kind: 'addiction', which: 'gambling', delta: 2 },
            ],
          },
          {
            weight: 5,
            text: 'You represented a flush. Somebody called. You did not have it.',
            effects: [
              { kind: 'money', delta: -600 },
              { kind: 'stat', stat: 'happiness', delta: -6 },
              { kind: 'addiction', which: 'gambling', delta: 2 },
            ],
          },
        ],
      },
      {
        label: 'Stay home',
        outcomes: [
          {
            weight: 4,
            text: 'You kept the buy-in and watched something forgettable.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: 1 }],
          },
        ],
      },
    ],
  },

  {
    id: 'ev-gamble-scratch-ticket',
    area: 'money',
    icon: '🎟️',
    minAge: 12,
    maxAge: 100,
    weight: 3,
    text: 'You found an unscratched lottery ticket in an old coat.',
    choices: [
      {
        label: 'Scratch it',
        outcomes: [
          {
            weight: 6,
            text: 'Three matching symbols. Forty dollars, from a coat.',
            effects: [
              { kind: 'money', delta: 40 },
              { kind: 'stat', stat: 'happiness', delta: 3 },
            ],
          },
          {
            weight: 5,
            text: 'Two symbols and a lot of hope. Silver dust everywhere.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: -1 }],
          },
          {
            weight: 1,
            text: 'Two thousand dollars. You read the small print four times.',
            effects: [
              { kind: 'money', delta: 2000 },
              { kind: 'stat', stat: 'happiness', delta: 12 },
            ],
          },
        ],
      },
      {
        label: 'Put it back in the pocket',
        outcomes: [
          {
            weight: 4,
            text: 'It is still a winner as long as nobody scratches it.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: 2 }],
          },
        ],
      },
    ],
  },

  {
    id: 'ev-gamble-sports-bet',
    area: 'fun',
    icon: '🏈',
    minAge: 18,
    maxAge: 90,
    weight: 3,
    condition: free,
    text: "A friend has a 'lock' on tonight's game and wants $200 of your confidence.",
    choices: [
      {
        label: 'Take the lock',
        condition: (ctx: Ctx): boolean => ctx.c.money >= 200,
        outcomes: [
          {
            weight: 4,
            text: 'The lock landed. He has mentioned it every week since.',
            effects: [
              { kind: 'money', delta: 300 },
              { kind: 'stat', stat: 'happiness', delta: 6 },
              { kind: 'addiction', which: 'gambling', delta: 2 },
            ],
          },
          {
            weight: 6,
            text: 'The lock lost by one point in overtime. Locks do that.',
            effects: [
              { kind: 'money', delta: -200 },
              { kind: 'stat', stat: 'happiness', delta: -5 },
              { kind: 'addiction', which: 'gambling', delta: 2 },
            ],
          },
        ],
      },
      {
        label: 'Bet against him',
        condition: (ctx: Ctx): boolean => ctx.c.money >= 200,
        outcomes: [
          {
            weight: 5,
            text: 'His lock lost. You collected and bought the drinks.',
            effects: [
              { kind: 'money', delta: 250 },
              { kind: 'stat', stat: 'happiness', delta: 7 },
              { kind: 'addiction', which: 'gambling', delta: 1 },
            ],
          },
          {
            weight: 4,
            text: 'His lock hit. He billed you in instalments of gloating.',
            effects: [
              { kind: 'money', delta: -200 },
              { kind: 'stat', stat: 'happiness', delta: -4 },
              { kind: 'addiction', which: 'gambling', delta: 1 },
            ],
          },
        ],
      },
      {
        label: 'Just watch the game',
        outcomes: [
          {
            weight: 5,
            text: 'You watched for free and slept fine either way.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: 2 }],
          },
        ],
      },
    ],
  },

  {
    id: 'ev-gamble-office-pool',
    area: 'work',
    icon: '🏀',
    minAge: 18,
    maxAge: 70,
    weight: 3,
    condition: (ctx: Ctx): boolean => ctx.c.job !== null && ctx.c.prison === null,
    text: 'The office bracket pool is $20 a square. Accounting runs it, badly.',
    choices: [
      {
        label: 'Buy a square',
        outcomes: [
          {
            weight: 4,
            text: 'You won the pot: $340 and a paper crown you wore all afternoon.',
            effects: [
              { kind: 'money', delta: 320 },
              { kind: 'stat', stat: 'happiness', delta: 6 },
              { kind: 'addiction', which: 'gambling', delta: 1 },
            ],
          },
          {
            weight: 6,
            text: 'Your bracket died on the first weekend, along with your commentary.',
            effects: [
              { kind: 'money', delta: -20 },
              { kind: 'stat', stat: 'happiness', delta: -2 },
              { kind: 'addiction', which: 'gambling', delta: 1 },
            ],
          },
        ],
      },
      {
        label: 'Pass',
        outcomes: [
          {
            weight: 5,
            text: 'You kept your $20 and your opinions about brackets.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: 1 }],
          },
        ],
      },
    ],
  },

  {
    id: 'ev-gamble-slot-streak',
    area: 'money',
    icon: '🎰',
    minAge: 18,
    maxAge: 95,
    weight: 3,
    condition: hooked(15),
    text: 'The machine at the end has paid twice tonight. You can feel it warming up.',
    choices: [
      {
        label: 'Feed it',
        outcomes: [
          {
            weight: 3,
            text: 'It paid $1,800. You told that story for a year.',
            effects: [
              { kind: 'money', delta: 1800 },
              { kind: 'stat', stat: 'happiness', delta: 7 },
              { kind: 'addiction', which: 'gambling', delta: 3 },
            ],
          },
          {
            weight: 6,
            text: 'Machines do not warm up. Nine hundred dollars later, you knew that.',
            effects: [
              { kind: 'money', delta: -900 },
              { kind: 'stat', stat: 'happiness', delta: -7 },
              { kind: 'addiction', which: 'gambling', delta: 4 },
            ],
          },
        ],
      },
      {
        label: 'Walk to the car',
        outcomes: [
          {
            weight: 5,
            text: 'You left with money still in your pocket. Rare, that.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 4 },
              { kind: 'addiction', which: 'gambling', delta: -2 },
            ],
          },
        ],
      },
    ],
  },

  {
    id: 'ev-gamble-bingo-night',
    area: 'fun',
    icon: '🔢',
    minAge: 55,
    maxAge: 110,
    weight: 3,
    condition: free,
    text: 'Bingo at the community hall. The regulars play nine cards at once.',
    effects: [
      { kind: 'money', delta: 60 },
      { kind: 'stat', stat: 'happiness', delta: 5 },
    ],
  },

  {
    id: 'ev-gamble-lucky-charm',
    area: 'life',
    icon: '🍀',
    minAge: 12,
    maxAge: 110,
    weight: 2,
    oncePerLife: true,
    text: 'A stranger pressed a worn casino chip into your hand and called it lucky.',
    effects: [
      { kind: 'stat', stat: 'happiness', delta: 4 },
      { kind: 'flag', flag: 'casino:luckyCharm', value: true },
    ],
  },

  {
    id: 'ev-gamble-debt-collector',
    area: 'money',
    icon: '📞',
    minAge: 18,
    maxAge: 95,
    weight: 3,
    condition: hooked(40),
    text: 'The man on the phone knows your name, your job and exactly what you owe.',
    effects: [
      { kind: 'money', delta: -2500 },
      { kind: 'stat', stat: 'happiness', delta: -10 },
      { kind: 'stat', stat: 'health', delta: -3 },
    ],
  },

  {
    id: 'ev-gamble-quit-cold-turkey',
    area: 'health',
    icon: '🛑',
    minAge: 18,
    maxAge: 100,
    weight: 3,
    condition: hooked(30),
    text: "You added up the year's losses on a napkin and stopped halfway down.",
    choices: [
      {
        label: 'Ban yourself from the casino',
        outcomes: [
          {
            weight: 5,
            text: 'You signed the self-exclusion list. The first month was very long.',
            effects: [
              { kind: 'addiction', which: 'gambling', delta: -20 },
              { kind: 'stat', stat: 'happiness', delta: -4 },
              { kind: 'stat', stat: 'health', delta: 2 },
              { kind: 'flag', flag: 'casino:selfExcluded', value: true },
            ],
          },
          {
            weight: 3,
            text: 'You signed it, then drove past the place twice a week anyway.',
            effects: [
              { kind: 'addiction', which: 'gambling', delta: -8 },
              { kind: 'stat', stat: 'happiness', delta: -3 },
            ],
          },
        ],
      },
      {
        label: 'One more night to win it back',
        outcomes: [
          {
            weight: 3,
            text: 'You won it back. That was the worst possible outcome.',
            effects: [
              { kind: 'money', delta: 1200 },
              { kind: 'stat', stat: 'happiness', delta: 6 },
              { kind: 'addiction', which: 'gambling', delta: 5 },
            ],
          },
          {
            weight: 6,
            text: 'You did not win it back.',
            effects: [
              { kind: 'money', delta: -1500 },
              { kind: 'stat', stat: 'happiness', delta: -8 },
              { kind: 'addiction', which: 'gambling', delta: 4 },
            ],
          },
        ],
      },
    ],
  },
];

/** Casino content: the venue interactions and the addiction events they feed. */
export const gamblingPack: ContentPack = {
  id: 'gambling',
  events,
};
