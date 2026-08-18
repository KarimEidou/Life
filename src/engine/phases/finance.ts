/**
 * Finance phase plus every money action the player can take directly.
 *
 * The year is settled in one pass: income and tax, living costs, loan interest
 * and its automatic payment, then investment and asset movement. Only the net
 * result reaches `character.money`, which never goes below zero — a shortfall is
 * covered out of the character's own investments, then by selling assets and,
 * failing both and with something left to seize, by bankruptcy.
 */

import { currentYearLog } from '@/engine/ageUp';
import { clampStat } from '@/engine/effects';
import { fmtMoney } from '@/engine/format';
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
const MOVE_OUT_AGE = 22;
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

/** Borrowing cap: five years of salary, or this floor for anyone without one. */
const LOAN_INCOME_MULT = 5;
const LOAN_MIN_CAP = 10000;
const MAX_PERSONAL_LOANS = 3;

/** Youngest a bank will lend to; every other player action gates on age too. */
const BORROW_MIN_AGE = 18;

const PROPERTY_MIN_AGE = 18;
const VEHICLE_MIN_AGE = 16;
const PURCHASE_JOY = 8;

const BANKRUPTCY_GRIEF = 20;

/* Registry maps are typed as total records, so widen before lookup: a hand-built
   or partially loaded registry can still miss the id we ask for. */
function findCountry(reg: ContentRegistry, id: string): CountryDef | undefined {
  const byId: Record<string, CountryDef | undefined> = reg.countriesById;
  return byId[id] ?? reg.countries.find((country) => country.id === id);
}

function findAsset(reg: ContentRegistry, id: string): AssetDef | undefined {
  const byId: Record<string, AssetDef | undefined> = reg.assetsById;
  return byId[id] ?? reg.assets.find((asset) => asset.id === id);
}

/** Reads a numeric flag that older saves or content may have left unset. */
function numberFlag(value: boolean | number | string | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function money(n: number): number {
  return Math.max(0, Math.round(n));
}

/** Flags holding the monotonic id counters; see `mintLoanId`. */
const LOAN_ID_FLAG = 'nextLoanId';
const ASSET_ID_FLAG = 'nextAssetId';

/**
 * Next value of one of those counters, bumped for the caller.
 * A life created before the counters existed has neither flag, so an absent (or
 * damaged) value restarts at 1: every id such a save already holds was minted in
 * the old `l<n>-<age>` shape, which this scheme never produces, so restarting
 * cannot hand out an id that is still live.
 */
function nextId(c: Character, flag: string): number {
  const raw = c.flags[flag];
  const next = typeof raw === 'number' && raw >= 1 ? Math.floor(raw) : 1;
  c.flags[flag] = next + 1;
  return next;
}

/**
 * The only supported way to mint a `Loan.id`, mirroring `addPerson`.
 * Deriving the id from `loans.length` hands out an id that is still owed as soon
 * as a loan other than the last one is cleared, and every lookup, payment and
 * removal here matches loans by id — a repayment would then settle two debts at
 * once. Exported because tuition is financed from the education phase.
 */
export function mintLoanId(c: Character): string {
  return `l${nextId(c, LOAN_ID_FLAG)}`;
}

/** The only supported way to mint an `OwnedAsset.id`; see `mintLoanId`. */
function mintAssetId(c: Character): string {
  return `a${nextId(c, ASSET_ID_FLAG)}`;
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

function ownsProperty(reg: ContentRegistry, state: GameState): boolean {
  return state.character.assets.some((asset) => findAsset(reg, asset.defId)?.type === 'property');
}

function hasSpouse(state: GameState): boolean {
  return Object.values(state.people).some((p) => p.alive && p.kind === 'spouse');
}

function dependentChildren(state: GameState): number {
  return Object.values(state.people).filter(
    (p) => p.alive && p.kind === 'child' && p.age < CHILD_AGE
  ).length;
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
  const dependentStudent =
    c.flags.livesWithParents === true && c.education.enrolledIn !== undefined;

  let total = dependentStudent ? 0 : LIVING_COST * costMult;
  if (c.flags.livesWithParents !== true && !home) total += RENT * costMult;
  total += dependentChildren(state) * CHILD_COST * costMult;
  return Math.round(total);
}

/**
 * Charges every loan its year of interest, then takes the automatic instalment
 * out of the cash on hand. Returns what is left of that cash; cleared loans drop
 * off the character.
 *
 * The instalment is the year's interest *plus* a share of the balance, so what
 * it repays is real: taking the share out of the already compounded balance
 * instead makes a loan immortal at the rates the game actually charges. At 9%
 * the two round-trips cancel — a principal of 8 compounds to 9, 15% of that is
 * 1, and the balance returns to 8 for ever — so a personal or auto loan could
 * never be paid off and the payoff line was unreachable. The floor under the
 * repaid share keeps the tail from crawling once the balance is small; the
 * instalment is capped at the balance, so nobody overpays.
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
    const pay = Math.max(0, Math.min(left, due));
    loan.principal = owed - pay;
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
  inv.savings = money(inv.savings * (1 + SAVINGS_RATE));
  inv.index = money(inv.index * (1 + indexReturn));
  inv.crypto = money(inv.crypto * (1 + cryptoReturn));
}

/** Revalues every asset and returns the upkeep the year owes on them. */
function revalueAssets(ctx: Ctx): number {
  const c = ctx.state.character;
  let upkeep = 0;
  for (const asset of c.assets) {
    const def = findAsset(ctx.reg, asset.defId);
    /* Content owns the rate (roughly +3% a year on property, -10% on vehicles);
       an asset whose def has gone missing simply holds its value. */
    const rate = def ? def.apprPct : 0;
    asset.value = money(asset.value * (1 + rate));
    upkeep += (def ? def.upkeepPct : DEFAULT_UPKEEP) * asset.value;
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

/**
 * Sells assets cheapest-first until the books balance again.
 *
 * A forced sale settles the same way a voluntary one does — see `sellAsset` —
 * because a loan must never outlive the collateral it is secured against: the
 * `assetId` would point at an `OwnedAsset` that no longer exists and the debt
 * would go on compounding and taking its yearly share of cash for good.
 */
function forceSales(ctx: Ctx, cash: number, entries: LogEntry[]): number {
  const c = ctx.state.character;
  let left = cash;
  const cheapestFirst = [...c.assets].sort((a, b) => a.value - b.value);

  for (const asset of cheapestFirst) {
    if (left >= 0) break;
    left += asset.value;
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
  const costMult = country ? country.costMult : 1;
  const taxMult = country ? country.taxMult : 1;

  // A prisoner has no job (the sentence took it) but a pension keeps paying.
  const gross = (c.job ? c.job.salary : 0) + numberFlag(c.flags.pensionSalary);
  const tax = incomeTax(gross, taxMult);
  const expenses = livingCosts(ctx, costMult, entries);

  let cash = settleLoans(ctx, c.money, entries);
  growInvestments(ctx);
  const upkeep = revalueAssets(ctx);

  cash += gross - tax - expenses - upkeep;

  // Own money first: the pots are the character's, and moving them costs nothing.
  if (cash < 0) cash = drawOnInvestments(ctx, cash);
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
    /* Bankruptcy is also the transition, not the condition: someone with nothing
       left stays short of money every year after, and the estate was already
       seized, so a repeat year only writes the shortfall off. Reporting it again
       would fill a whole life with the same line. */
    if (seizable && c.flags.bankrupt !== true) {
      c.loans = c.loans.filter((loan) => loan.kind === 'student');
      c.assets = [];
      c.stats.happiness = clampStat(c.stats.happiness - BANKRUPTCY_GRIEF);
      c.flags.bankrupt = true;
      entries.push({ icon: '🏦', kind: 'bad', text: 'You went bankrupt.' });
    }
    cash = 0;
  } else if (c.flags.bankrupt === true && cash > 0) {
    // Back on their feet with money to spare, so a later collapse is news again.
    c.flags.bankrupt = false;
  }

  // Deliberately silent about the balance itself: the HUD already shows it.
  c.money = money(cash);
  return entries;
}

/** Cash plus investments plus asset values, minus outstanding loan principal. */
export function netWorth(state: GameState): number {
  const c = state.character;
  const invested = c.investments.savings + c.investments.index + c.investments.crypto;
  const assets = c.assets.reduce((sum, asset) => sum + asset.value, 0);
  const debt = c.loans.reduce((sum, loan) => sum + loan.principal, 0);
  return Math.round(c.money + invested + assets - debt);
}

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

/** Borrows against income and existing debt, adding a personal loan on success. */
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

  const cap = Math.max(LOAN_MIN_CAP, LOAN_INCOME_MULT * (c.job ? c.job.salary : 0));
  if (wanted > cap) {
    return { ok: false, reason: `The bank will only lend you ${fmtMoney(cap)}.` };
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

  const property = def.type === 'property';
  const minAge = def.minAge ?? (property ? PROPERTY_MIN_AGE : VEHICLE_MIN_AGE);
  if (c.age < minAge) return { ok: false, reason: `You must be ${minAge} to buy that.` };

  const price = Math.round(def.price);
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
  c.stats.happiness = clampStat(c.stats.happiness + PURCHASE_JOY);
  currentYearLog(state).entries.push({
    icon: def.icon,
    kind: 'money',
    text: `You bought a ${def.label} for ${fmtMoney(price)}.`,
  });
  return { ok: true };
}

/** Sells an owned asset at its current value, settling any loan secured against it. */
export function sellAsset(state: GameState, assetId: string): void {
  // A finished life is read-only; see `lifeIsOver`.
  if (lifeIsOver(state)) return;

  const c = state.character;
  const asset = c.assets.find((held) => held.id === assetId);
  if (!asset) return;

  c.assets = c.assets.filter((held) => held.id !== assetId);
  let cash = c.money + asset.value;
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
    text: `You sold your ${asset.label} for ${fmtMoney(asset.value)}.`,
  });
}
