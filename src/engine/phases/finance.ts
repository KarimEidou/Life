/**
 * Finance phase plus every money action the player can take directly.
 *
 * The year is settled in one pass, in this order: investments and assets move,
 * then income and tax less living costs and upkeep are added to the cash on
 * hand, then the loan instalments come out of what that leaves. Only the net
 * result reaches `character.money`, which never goes below zero — a shortfall is
 * covered out of the character's own investments, then by selling assets and,
 * failing both and with something left to seize, by bankruptcy.
 */

import { clampMoney, clampStat } from '@/engine/effects';
import { fmtMoney } from '@/engine/format';
import { currentYearLog } from '@/engine/log';
import { livingOfKind } from '@/engine/people';
import { findById } from '@/engine/registry';
import { MOVE_OUT_AGE } from '@/engine/rules';
import { LIFE_OVER, lifeIsOver } from '@/engine/state';
import type {
  AssetDef,
  Character,
  ContentRegistry,
  CountryDef,
  Ctx,
  GameState,
  Investments,
  Loan,
  LogEntry,
  OwnedAsset,
} from '@/types';

/** Marginal income tax as `[ceiling, rate]`, applied bottom up. */
const TAX_BRACKETS: readonly (readonly [number, number])[] = [
  [10000, 0.1],
  [40000, 0.2],
  [100000, 0.3],
  [300000, 0.35],
  [Number.POSITIVE_INFINITY, 0.4],
];

/** Costs start at 18; before that the family pays for everything. */
const ADULT_AGE = 18;
const LIVING_COST = 8000;
const RENT = 12000;
const CHILD_COST = 6000;
const CHILD_AGE = 18;

const SAVINGS_RATE = 0.02;
const INDEX_MEAN = 0.07;
const INDEX_SD = 0.15;
const CRYPTO_MEAN = 0.15;
const CRYPTO_SD = 0.6;

/** Charged on an asset whose def is missing, so upkeep is never free. */
const DEFAULT_UPKEEP = 0.01;

/** Share of the principal the yearly instalment repays, on top of the interest. */
const LOAN_PAYMENT_SHARE = 0.15;
/**
 * Floor under the principal an instalment repays, so the tail of a loan cannot
 * crawl: a share of a shrinking balance shrinks with it and takes decades to
 * clear the last few thousand dollars. Capped at the balance, so a small debt is
 * simply settled outright.
 */
const LOAN_MIN_PRINCIPAL_PAYMENT = 1000;

const PERSONAL_APR = 0.09;
const MORTGAGE_APR = 0.06;
const AUTO_APR = 0.09;
const MORTGAGE_DOWN = 0.2;
const AUTO_DOWN = 0.3;

/**
 * Borrowing cap: five years of salary, or this floor for anyone without one —
 * and it is the *borrower's* ceiling, not one ticket's. See `takeLoan`.
 */
const LOAN_INCOME_MULT = 5;
const LOAN_MIN_CAP = 10000;
const MAX_PERSONAL_LOANS = 3;

/** Youngest a bank will lend to; every other player action gates on age too. */
const BORROW_MIN_AGE = 18;

const PROPERTY_MIN_AGE = 18;
const VEHICLE_MIN_AGE = 16;
/**
 * Happiness a purchase is worth, at most once a year — see `buyAsset` for why
 * the year matters — recorded in this flag as the age it was last paid at.
 */
const PURCHASE_JOY = 8;
const PURCHASE_JOY_FLAG = 'lastPurchaseJoyAge';
/**
 * Share of an asset's value a sale actually fetches, voluntary or forced: the
 * rest is the spread the trade costs. Values only move in `revalueAssets`, which
 * runs once a year inside `financePhase`, so without it buying and selling the
 * same asset inside one year returned the exact cash it started with — see
 * `sellAsset`.
 */
const RESALE_RATE = 0.9;

const BANKRUPTCY_GRIEF = 20;

function findCountry(reg: ContentRegistry, id: string): CountryDef | undefined {
  return findById(reg.countriesById, reg.countries, id);
}

function findAsset(reg: ContentRegistry, id: string): AssetDef | undefined {
  return findById(reg.assetsById, reg.assets, id);
}

/** Reads a numeric flag that older saves or content may have left unset. */
function numberFlag(value: boolean | number | string | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Whole, non-negative dollars; `keep` is held when the amount is unreadable.
 * The one money-write helper in this module, and `clampMoney` is the engine's —
 * see it for why `Math.max(0, NaN)` had to stop being the shape of a balance.
 */
function money(n: number, keep = 0): number {
  return clampMoney(n, keep);
}

/**
 * A rate, multiplier or price read straight out of content, with `fallback` for
 * anything that is not a readable number.
 *
 * Content packs author every one of these by hand, and a single NaN or Infinity
 * among them used to reach `character.money` — a `costMult` of NaN made the
 * year's living costs NaN, a salary of NaN made the year's gross NaN — with no
 * way back. Each one is read exactly once, here, so a broken number costs the
 * player nothing instead of the whole balance sheet.
 */
function contentNumber(n: number, fallback: number): number {
  return Number.isFinite(n) ? n : fallback;
}

/** Flags holding the monotonic id counters; see `mintLoanId`. */
const LOAN_ID_FLAG = 'nextLoanId';
const ASSET_ID_FLAG = 'nextAssetId';

/**
 * One of those counters as a usable id number, or `undefined` when it cannot be
 * trusted — the same guard `state.counterValue` puts in front of `Person.id`.
 *
 * These are ordinary entries in `Character.flags`: content writes flags through
 * `{ kind: 'flag' }` with no reserved-name protection, and a save is just JSON,
 * so this may hold a string, a boolean, zero, a fraction, NaN or Infinity.
 * Non-finite and unsafe magnitudes are refused along with the rest, because they
 * do not survive being incremented: `1e300 + 1` is `1e300`, so the counter
 * freezes and every call after the first mints the id the first one did.
 */
function counterValue(raw: boolean | number | string | undefined): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 1) {
    return undefined;
  }
  const floored = Math.floor(raw);
  return Number.isSafeInteger(floored) ? floored : undefined;
}

/**
 * Next id under `prefix`, with the counter bumped for the caller.
 *
 * A life created before the counters existed has neither flag, so an absent
 * value restarts at 1: every id such a save already holds was minted in the old
 * `l<n>-<age>` shape, which this scheme never produces, so restarting cannot
 * hand out an id that is still live. A *damaged* value takes that same branch
 * and that argument does not carry — a counter a pack effect or a hand-edited
 * save overwrote can sit beside a live `l1` — so the candidate is walked past
 * everything `held` already holds before it is used, exactly as `addPerson`
 * walks past `state.people`. The probe is bounded by the collection: each step
 * it takes consumes a distinct record of it, so `held.length` steps always
 * reach a free id.
 */
function mintId(
  c: Character,
  flag: string,
  prefix: string,
  held: readonly { readonly id: string }[]
): string {
  let next = counterValue(c.flags[flag]) ?? 1;
  let steps = held.length;
  while (steps > 0 && held.some((row) => row.id === `${prefix}${next}`)) {
    next += 1;
    steps -= 1;
  }
  c.flags[flag] = next + 1;
  return `${prefix}${next}`;
}

/**
 * The only supported way to mint a `Loan.id`, mirroring `addPerson`.
 * Deriving the id from `loans.length` hands out an id that is still owed as soon
 * as a loan other than the last one is cleared, and every lookup, payment and
 * removal here matches loans by id — a repayment would then settle two debts at
 * once. Exported because tuition is financed from the education phase.
 */
export function mintLoanId(c: Character): string {
  return mintId(c, LOAN_ID_FLAG, 'l', c.loans);
}

/** The only supported way to mint an `OwnedAsset.id`; see `mintLoanId`. */
function mintAssetId(c: Character): string {
  return mintId(c, ASSET_ID_FLAG, 'a', c.assets);
}

/** Tax owed on `gross`, scaled by the country's multiplier. */
function incomeTax(gross: number, taxMult: number): number {
  if (!(gross > 0)) return 0;
  let owed = 0;
  let floor = 0;
  for (const [ceiling, rate] of TAX_BRACKETS) {
    if (gross <= floor) break;
    owed += (Math.min(gross, ceiling) - floor) * rate;
    floor = ceiling;
  }
  return Math.round(owed * taxMult);
}

/**
 * Whether the character has a roof of their own.
 *
 * `OwnedAsset` carries no type of its own, so only the registry can answer this,
 * and a save naming a def this build no longer ships used to answer "owns
 * nothing at all". Everything else here treats such an asset as owned —
 * `revalueAssets` holds its value and bills `DEFAULT_UPKEEP` on it, `netWorth`
 * and the estate count it — so giving up on it alone charged a homeowner `RENT`
 * on the house they were living in, every year for the rest of the life, and
 * kept one who still lived with their parents there until `MOVE_OUT_AGE`. The
 * label is the fallback this side can afford: the content packs recover the same
 * drifted row from its id prefix, which only content is allowed to know.
 */
function ownsProperty(reg: ContentRegistry, state: GameState): boolean {
  return state.character.assets.some(
    (asset) =>
      (findAsset(reg, asset.defId) ?? reg.assets.find((def) => def.label === asset.label))?.type ===
      'property'
  );
}

function hasSpouse(state: GameState): boolean {
  return livingOfKind(state, 'spouse').length > 0;
}

function dependentChildren(state: GameState): number {
  return livingOfKind(state, 'child').filter((p) => p.age < CHILD_AGE).length;
}

/**
 * A student still living at home: the family keeps paying for them.
 *
 * Asked by `livingCosts`, the one place that has to know whether the character
 * is really on their own. Enrolment alone is not enough: a student who has moved
 * out pays their own way and is nobody's dependent.
 */
function dependentStudent(c: Character): boolean {
  return c.flags.livesWithParents === true && c.education.enrolledIn !== undefined;
}

/** Yearly living costs; zero for a minor, for a student at home and behind bars. */
function livingCosts(ctx: Ctx, costMult: number, entries: LogEntry[]): number {
  const state = ctx.state;
  const c = state.character;
  if (c.age < ADULT_AGE || c.prison) return 0;

  const home = ownsProperty(ctx.reg, state);
  if (c.flags.livesWithParents === true && (c.age >= MOVE_OUT_AGE || hasSpouse(state) || home)) {
    c.flags.livesWithParents = false;
    entries.push({ icon: '📦', kind: 'info', text: 'You moved out on your own.' });
  }

  /* A student still at home is a dependent and the family keeps paying, exactly
     as it does for a minor. Charging a full adult's keep to someone whose year
     is spent in class and whose tuition was just financed ends every school year
     short, and a shortfall with a loan outstanding is what the block at the
     bottom of `financePhase` calls bankruptcy: undergraduates were declared
     bankrupt in their first year and had that very tuition debt written off. The
     survivors of the move-out above are all under `MOVE_OUT_AGE`, unmarried and
     without a home of their own, so no independent adult reaches this. Their own
     children are still their own to feed. */
  let total = dependentStudent(c) ? 0 : LIVING_COST * costMult;
  if (c.flags.livesWithParents !== true && !home) total += RENT * costMult;
  total += dependentChildren(state) * CHILD_COST * costMult;
  return Math.round(total);
}

/**
 * Charges every loan its year of interest, then takes the automatic instalment
 * out of the money the character has — the year's cash first and the investment
 * pots after it. Returns what is left of that cash; cleared loans drop off the
 * character.
 *
 * The instalment is the year's interest *plus* a share of the balance, so what
 * it repays is real: taking the share out of the already compounded balance
 * instead makes a loan immortal at the rates the game actually charges. At 9%
 * the two round-trips cancel — a principal of 8 compounds to 9, 15% of that is
 * 1, and the balance returns to 8 for ever — so a personal or auto loan could
 * never be paid off and the payoff line was unreachable. The floor under the
 * repaid share keeps the tail from crawling once the balance is small; the
 * instalment is capped at the balance, so nobody overpays.
 *
 * Above all: **no balance ever ends a year larger than it started it.** The part
 * of the year's interest the instalment could not cover is forborne rather than
 * capitalised. Capitalising it compounds a debt against a character who has no
 * way to pay it: anyone whose year nets zero or less, with no pot to reach into,
 * arrives here with nothing whatever their income was, pays nothing, and watches
 * the balance grow for ever. A graduate on a $25,000 wage turned $88,000 of
 * tuition into $1.3M by 81, and a pensioner on $6,000 turned it into $380,000 —
 * ordinary ways to play, and the HUD, the finance sheet and the death screen all
 * quoted the result. Asking instead whether the character has *any* income at
 * all only ever excused someone with literally nothing.
 *
 * Forbearance is the honest floor: the debt is still owed in full and it is
 * still charged its interest, it simply cannot grow. Every payment that beats
 * the interest still buys the balance down on exactly the schedule above — that
 * is the only way `owed - pay` lands under the old principal — so a solvent
 * borrower amortises to zero as before. It matters most to tuition, which
 * survives the bankruptcy block at the bottom of `financePhase` on purpose and
 * so has no other terminal state at all.
 *
 * **Solvent means net worth, not wallet balance.** An instalment cash cannot
 * meet reaches into the investment pots first, exactly as a shortfall does in
 * `drawOnInvestments` and for exactly the same reason: the pots are the
 * character's, `withdrawInvestment` moves them back for free, and `netWorth`
 * and the estate both count them as wealth. Without that the forbearance floor
 * above cut the other way — a character with a million in savings and nothing
 * in the current account paid *nothing*, for ever, on a balance that could no
 * longer grow, and `depositInvestment` turned any loan into a free perpetual
 * capital injection. Assets are not touched: a house is not spending money, and
 * only a shortfall big enough to threaten the whole year forces a sale.
 */
function settleLoans(ctx: Ctx, cash: number, entries: LogEntry[]): number {
  const c = ctx.state.character;
  const kept: Loan[] = [];
  let left = cash;

  for (const loan of c.loans) {
    const interest = Math.round(loan.principal * loan.apr);
    const owed = loan.principal + interest;
    const repaid = Math.max(
      Math.round(loan.principal * LOAN_PAYMENT_SHARE),
      LOAN_MIN_PRINCIPAL_PAYMENT
    );
    const due = Math.min(interest + repaid, owed);
    // The instalment is met out of the character's own money wherever it sits.
    if (left < due) left = drawOnInvestments(ctx, left - due) + due;
    const pay = Math.max(0, Math.min(left, due));
    // Interest the payment did not reach is forborne, never capitalised. See above.
    loan.principal = Math.min(loan.principal, owed - pay);
    left -= pay;
    if (loan.principal <= 0) {
      entries.push({ icon: '✅', kind: 'good', text: `You paid off your ${loan.kind} loan.` });
    } else {
      kept.push(loan);
    }
  }

  c.loans = kept;
  return left;
}

/** Moves each investment pot by its own return; a negative draw is a loss. */
function growInvestments(ctx: Ctx): void {
  const inv = ctx.state.character.investments;
  // Drawn every year whatever the balances are, so the sequence never depends on them.
  const indexReturn = ctx.rng.normal(INDEX_MEAN, INDEX_SD);
  const cryptoReturn = ctx.rng.normal(CRYPTO_MEAN, CRYPTO_SD);
  inv.savings = money(inv.savings * (1 + SAVINGS_RATE), inv.savings);
  inv.index = money(inv.index * (1 + indexReturn), inv.index);
  inv.crypto = money(inv.crypto * (1 + cryptoReturn), inv.crypto);
}

/** Revalues every asset and returns the upkeep the year owes on them. */
function revalueAssets(ctx: Ctx): number {
  const c = ctx.state.character;
  let upkeep = 0;
  for (const asset of c.assets) {
    const def = findAsset(ctx.reg, asset.defId);
    /* Content owns the rate (roughly +3% a year on property, -10% on vehicles);
       an asset whose def has gone missing — or one whose rate is not a readable
       number — simply holds its value. */
    const rate = def ? contentNumber(def.apprPct, 0) : 0;
    asset.value = money(asset.value * (1 + rate), asset.value);
    upkeep += contentNumber(def ? def.upkeepPct : DEFAULT_UPKEEP, DEFAULT_UPKEEP) * asset.value;
  }
  return Math.round(upkeep);
}

/**
 * The order a shortfall eats the investment pots in: the safe, liquid one first,
 * then the fund, and the volatile pot last.
 */
const DRAWDOWN_ORDER: readonly (keyof Investments)[] = ['savings', 'index', 'crypto'];

/**
 * Covers a shortfall out of the investment pots, taking only what it needs.
 *
 * The player can already do this by hand for free with `withdrawInvestment`, and
 * both `netWorth` and the estate count the pots as wealth, so a character who
 * holds them is not short of money at all: skipping this step force-sells the
 * house of a millionaire whose cash happens to sit in a savings account, and
 * then writes their debts off as if they had nothing. What the shortfall cannot
 * reach is left where it is — a forced sale and bankruptcy follow.
 */
function drawOnInvestments(ctx: Ctx, cash: number): number {
  const inv = ctx.state.character.investments;
  let left = cash;

  for (const kind of DRAWDOWN_ORDER) {
    if (left >= 0) break;
    // Whole dollars, so a fractional shortfall can never leave the pot short.
    const taken = Math.min(inv[kind], Math.ceil(-left));
    if (!(taken > 0)) continue;
    inv[kind] = money(inv[kind] - taken);
    left += taken;
  }

  return left;
}

/** What a sale hands over: the value less the spread every trade costs. */
function resaleValue(asset: OwnedAsset): number {
  return money(asset.value * RESALE_RATE);
}

/**
 * Sells assets cheapest-first until the books balance again.
 *
 * A forced sale settles the same way a voluntary one does — see `sellAsset` — at
 * the same `RESALE_RATE`, and because a loan must never outlive the collateral
 * it is secured against: the `assetId` would point at an `OwnedAsset` that no
 * longer exists and the debt would go on taking its yearly share of cash for
 * good.
 */
function forceSales(ctx: Ctx, cash: number, entries: LogEntry[]): number {
  const c = ctx.state.character;
  let left = cash;
  const cheapestFirst = [...c.assets].sort((a, b) => a.value - b.value);

  for (const asset of cheapestFirst) {
    if (left >= 0) break;
    left += resaleValue(asset);
    c.assets = c.assets.filter((held) => held.id !== asset.id);
    /* The secured loan is paid out of what the books can spare and goes with the
       asset either way; a pot still in the red covers none of it and the balance
       is written off rather than following the character. */
    const secured = c.loans.find((loan) => loan.assetId === asset.id);
    if (secured) {
      left -= Math.max(0, Math.min(left, secured.principal));
      c.loans = c.loans.filter((loan) => loan.id !== secured.id);
    }
    entries.push({
      icon: '💸',
      kind: 'money',
      text: `You sold your ${asset.label} to stay afloat.`,
    });
  }

  return left;
}

/** Charges living costs, taxes, upkeep and loan interest; grows investments and assets. */
export function financePhase(ctx: Ctx): LogEntry[] {
  const c = ctx.state.character;
  const entries: LogEntry[] = [];

  const country = findCountry(ctx.reg, c.countryId);
  const costMult = country ? contentNumber(country.costMult, 1) : 1;
  const taxMult = country ? contentNumber(country.taxMult, 1) : 1;

  // A prisoner has no job (the sentence took it) but a pension keeps paying.
  const salary = c.job ? contentNumber(c.job.salary, 0) : 0;
  const gross = salary + numberFlag(c.flags.pensionSalary);
  const tax = incomeTax(gross, taxMult);
  const expenses = livingCosts(ctx, costMult, entries);

  growInvestments(ctx);
  const upkeep = revalueAssets(ctx);

  /* The whole year lands before any of it is settled. Opening with `settleLoans`
     instead charged the instalment against the cash the year *started* with, and
     `financePhase` ends every short year at zero — so a borrower who earned the
     money to service the debt still paid nothing, and only paid at all in the
     second year and after. `money(c.money)` is also the recovery path for a
     balance a save or an old content typo left unreadable: it heals to 0 here
     rather than poisoning the loans below. Neither `settleLoans` nor
     `drawOnInvestments` consumes randomness, so the year's draw sequence is
     exactly what it was — `growInvestments` still takes the same two. */
  let cash = money(c.money) + gross - tax - expenses - upkeep;

  // Own money first: the pots are the character's, and moving them costs nothing.
  if (cash < 0) cash = drawOnInvestments(ctx, cash);
  // The instalment reaches those same pots on its own; see `settleLoans`.
  cash = settleLoans(ctx, cash, entries);
  if (cash < 0) cash = forceSales(ctx, cash, entries);
  if (cash < 0) {
    /* Bankruptcy needs something to be bankrupt over. Without a debt to discharge
       or an estate to seize the block does no work at all — a teenager with no
       income is broke, not bankrupt, and announcing it (and charging the grief)
       every time a life opens in the red puts the line in almost every life at
       18. Forced sales normally empty `assets` before we get here; the check
       stays honest about both halves of the wipe anyway.
       Student debt is not part of that estate: an education cannot be
       repossessed, so tuition survives the collapse the way it does in life.
       Counting it made every graduate who ended a year short bankrupt on the
       strength of the loan the engine had just issued them, and then wrote that
       loan off — tuition financed itself, and no degree was ever paid for. */
    const seizable =
      c.loans.some((loan) => loan.kind !== 'student') || c.assets.length > 0;
    if (seizable) {
      c.loans = c.loans.filter((loan) => loan.kind === 'student');
      c.assets = [];
      /* The flag governs the notice and the grief, not the write-off. Bankruptcy
         is the transition, not the condition: someone with nothing left stays
         short of money every year after, and reporting it again would fill a
         whole life with the same line and the same grief. But `seizable` is
         already exactly 'there is something to wipe', so a repeat year with
         nothing left is silent and free on its own — while gating the discharge
         on the flag as well locked a character out of the only terminal state
         non-student debt has. Borrowing again after a collapse, and never having
         another year that ends in the black, left a balance that could not
         shrink, could not grow and could not be written off, dragging `netWorth`
         down on the HUD, the finance sheet and the epitaph for the rest of the
         life. */
      if (c.flags.bankrupt !== true) {
        c.stats.happiness = clampStat(c.stats.happiness - BANKRUPTCY_GRIEF);
        c.flags.bankrupt = true;
        entries.push({ icon: '🏦', kind: 'bad', text: 'You went bankrupt.' });
      }
    }
    cash = 0;
  } else if (c.flags.bankrupt === true && cash > 0) {
    // Back on their feet with money to spare, so a later collapse is news again.
    c.flags.bankrupt = false;
  }

  // Deliberately silent about the balance itself: the HUD already shows it.
  c.money = money(cash, c.money);
  return entries;
}

/* The sum lives in `@/engine/wealth`, a leaf module the obituary and the
   achievement checks can read without importing a phase. Re-exported under the
   name the finance sheet and this module's suite already import. */
export { netWorth } from '@/engine/wealth';

/** Moves cash into an investment vehicle; false when the cash is not there. */
export function depositInvestment(
  state: GameState,
  kind: keyof Investments,
  amount: number
): boolean {
  // A finished life is read-only; see `lifeIsOver`.
  if (lifeIsOver(state)) return false;

  const c = state.character;
  const moved = Math.round(amount);
  if (!Number.isFinite(moved) || moved <= 0 || moved > c.money) return false;

  c.money = money(c.money - moved);
  c.investments[kind] = money(c.investments[kind] + moved);
  return true;
}

/** Moves money out of an investment vehicle; false when the balance is too low. */
export function withdrawInvestment(
  state: GameState,
  kind: keyof Investments,
  amount: number
): boolean {
  // A finished life is read-only; see `lifeIsOver`.
  if (lifeIsOver(state)) return false;

  const c = state.character;
  const moved = Math.round(amount);
  if (!Number.isFinite(moved) || moved <= 0 || moved > c.investments[kind]) return false;

  c.investments[kind] = money(c.investments[kind] - moved);
  c.money = money(c.money + moved);
  return true;
}

/**
 * Borrows against income and existing debt, adding a personal loan on success.
 *
 * The cap is the borrower's total, not the size of one ticket. Comparing it
 * against the amount being asked for and nothing else left `MAX_PERSONAL_LOANS`
 * as the only real brake, so the true ceiling was *fifteen* years of salary:
 * three maximal loans in a single year, none of which the header ever promised.
 * What is already owed is subtracted first and the headroom is what the bank
 * will lend.
 *
 * Secured principal counts: a mortgage or a car loan is money this same bank is
 * already owed, and `buyAsset` opens those without asking anything at all, so
 * leaving them out would reopen the same hole through the showroom. Tuition does
 * not: the engine issues it to a student who never chose the amount and has no
 * income yet, and counting it would leave a graduate unable to borrow a dollar
 * for years on the strength of a debt the engine handed them.
 */
export function takeLoan(
  state: GameState,
  reg: ContentRegistry,
  amount: number
): { ok: boolean; reason?: string } {
  // A finished life is read-only; see `lifeIsOver`.
  if (lifeIsOver(state)) return { ok: false, reason: LIFE_OVER };

  const c = state.character;
  /* Gated here rather than in the UI, like every other action the player drives:
     `buyAsset`, `emigrateTo`, `commitCrime` and `canUse` all refuse a character
     who is too young, and nothing but this check stood between a toddler and
     three personal loans. Refused before anything is read or written, so the
     state is untouched. */
  if (c.age < BORROW_MIN_AGE) {
    return { ok: false, reason: `You must be ${BORROW_MIN_AGE} to borrow.` };
  }

  const wanted = Math.round(amount);
  if (!Number.isFinite(wanted) || wanted <= 0) {
    return { ok: false, reason: 'Enter an amount to borrow.' };
  }

  const salary = c.job ? contentNumber(c.job.salary, 0) : 0;
  const cap = Math.max(LOAN_MIN_CAP, LOAN_INCOME_MULT * salary);
  // Everything this bank is already owed, tuition aside; see the docstring.
  const owed = c.loans.reduce(
    (sum, loan) => (loan.kind === 'student' ? sum : sum + loan.principal),
    0
  );
  const room = Math.max(0, cap - owed);
  if (wanted > room) {
    return { ok: false, reason: `The bank will only lend you ${fmtMoney(room)}.` };
  }
  if (c.loans.filter((loan) => loan.kind === 'personal').length >= MAX_PERSONAL_LOANS) {
    return { ok: false, reason: 'You already owe the bank enough.' };
  }

  c.loans.push({
    id: mintLoanId(c),
    kind: 'personal',
    principal: wanted,
    apr: PERSONAL_APR,
  });
  c.money = money(c.money + wanted);
  currentYearLog(state).entries.push({
    icon: '🏦',
    kind: 'money',
    text: `You borrowed ${fmtMoney(wanted)}.`,
  });
  return { ok: true };
}

/** Pays down a loan's principal by up to `amount`, clearing it when it reaches zero. */
export function repayLoan(state: GameState, loanId: string, amount: number): void {
  // A finished life is read-only; see `lifeIsOver`.
  if (lifeIsOver(state)) return;

  const c = state.character;
  const loan = c.loans.find((held) => held.id === loanId);
  if (!loan) return;

  const pay = Math.round(Math.min(amount, c.money, loan.principal));
  if (!(pay > 0)) return;

  loan.principal -= pay;
  c.money = money(c.money - pay);
  if (loan.principal <= 0) {
    c.loans = c.loans.filter((held) => held.id !== loan.id);
    currentYearLog(state).entries.push({
      icon: '✅',
      kind: 'good',
      text: `You paid off your ${loan.kind} loan.`,
    });
  }
}

/** Buys an asset outright or with a secured loan for the balance. */
export function buyAsset(
  state: GameState,
  reg: ContentRegistry,
  defId: string,
  withLoan?: boolean
): { ok: boolean; reason?: string } {
  // A finished life is read-only; see `lifeIsOver`.
  if (lifeIsOver(state)) return { ok: false, reason: LIFE_OVER };

  const c = state.character;
  const def = findAsset(reg, defId);
  if (!def) return { ok: false, reason: 'That is not for sale.' };

  /* An unreadable price is not a price, so the def is not for sale — the same
     answer a missing def gets, and the gate has to fail *closed*. `c.money <
     down` is false for NaN, so an asset priced NaN was affordable to everyone,
     always: it sold for nothing and booked an asset worth NaN, which then made
     `netWorth`, the finance sheet and the epitaph NaN for the rest of the life.
     `validateRegistry` names the def too, but a pack is playable unvalidated. */
  const price = Math.round(def.price);
  if (!(price >= 0) || !Number.isFinite(price)) {
    return { ok: false, reason: 'That is not for sale.' };
  }

  const property = def.type === 'property';
  /* `??` answers for an absent minimum age only: NaN is a number, so it reached
     the comparison, and `c.age < NaN` is false at every age — the same fail-open
     shape the price gate above had to stop having, and the refusal it never
     printed read "You must be NaN to buy that." `validateRegistry` lints an
     asset's price but never its minAge, so nothing else catches the typo. */
  const defaultMinAge = property ? PROPERTY_MIN_AGE : VEHICLE_MIN_AGE;
  const minAge = contentNumber(def.minAge ?? defaultMinAge, defaultMinAge);
  if (c.age < minAge) return { ok: false, reason: `You must be ${minAge} to buy that.` };

  /* Financing is borrowing, and the bank `takeLoan` refuses a minor is the one
     writing this note: a vehicle's gate opens at 16, so a deposit booked a
     16-year-old a 9% loan that `settleLoans` charges interest on the next year,
     `forceSales` repossesses against, and `takeLoan` counts against the
     headroom the bank offers them at 18 — the only loan under 18 besides
     tuition, which the engine issues rather than the player choosing. Buying
     the same asset outright answers to the asset's gate alone. */
  if (withLoan && c.age < BORROW_MIN_AGE) {
    return { ok: false, reason: `You must be ${BORROW_MIN_AGE} to finance that.` };
  }

  const down = withLoan ? Math.round(price * (property ? MORTGAGE_DOWN : AUTO_DOWN)) : price;
  if (c.money < down) {
    return {
      ok: false,
      reason: withLoan ? `You need ${fmtMoney(down)} up front.` : 'You cannot afford that.',
    };
  }

  const asset: OwnedAsset = {
    id: mintAssetId(c),
    defId: def.id,
    label: def.label,
    paid: price,
    value: price,
    yearBought: state.year,
  };
  c.assets.push(asset);
  c.money = money(c.money - down);
  if (withLoan) {
    c.loans.push({
      id: mintLoanId(c),
      kind: property ? 'mortgage' : 'auto',
      principal: price - down,
      apr: property ? MORTGAGE_APR : AUTO_APR,
      assetId: asset.id,
    });
  }
  /* Rewarding once a year, not once a click. The joy had no cooldown and no
     limit of any kind, while `sellAsset` refunded the whole value and asset
     values only move in `revalueAssets` — so buying and selling the same car
     twenty times inside one year was free, and took a character from 20
     happiness to the cap. Happiness is a currency the rest of the engine
     charges for (`WORK_HARD_HAPPINESS`, `STUDY_HAPPINESS_COST`, `RAISE_SNUB`,
     `BANKRUPTCY_GRIEF`), holds a romance together in `relationshipsPhase` and
     is quoted on the epitaph, so a free pump to 100 defeats all of it. The
     spread on the sale charges for the churn; this charges for the joy. */
  if (c.flags[PURCHASE_JOY_FLAG] !== c.age) {
    c.stats.happiness = clampStat(c.stats.happiness + PURCHASE_JOY);
    c.flags[PURCHASE_JOY_FLAG] = c.age;
  }
  currentYearLog(state).entries.push({
    icon: def.icon,
    kind: 'money',
    text: `You bought a ${def.label} for ${fmtMoney(price)}.`,
  });
  return { ok: true };
}

/**
 * Sells an owned asset, settling any loan secured against it.
 *
 * The sale fetches `RESALE_RATE` of the asset's value rather than all of it.
 * Refunding the whole value made a purchase perfectly reversible: values only
 * move in `revalueAssets`, once a year, so a buy followed by a sale in the same
 * year returned exactly the cash it started with — the deposit and the secured
 * loan included — and `buyAsset` paid its happiness out every time. The spread
 * is what a trade costs, so churning an asset now costs money the way it does
 * in life.
 */
export function sellAsset(state: GameState, assetId: string): void {
  // A finished life is read-only; see `lifeIsOver`.
  if (lifeIsOver(state)) return;

  const c = state.character;
  const asset = c.assets.find((held) => held.id === assetId);
  if (!asset) return;

  c.assets = c.assets.filter((held) => held.id !== assetId);
  const proceeds = resaleValue(asset);
  let cash = c.money + proceeds;
  /* The secured loan is settled out of the proceeds; whatever the sale cannot
     cover goes with the asset rather than following the character. */
  const secured = c.loans.find((loan) => loan.assetId === assetId);
  if (secured) {
    cash -= Math.min(cash, secured.principal);
    c.loans = c.loans.filter((loan) => loan.id !== secured.id);
  }

  c.money = money(cash);
  currentYearLog(state).entries.push({
    icon: '💵',
    kind: 'money',
    text: `You sold your ${asset.label} for ${fmtMoney(proceeds)}.`,
  });
}
