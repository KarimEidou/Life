/**
 * Finance phase plus every money action the player can take directly.
 *
 * The year is settled in one pass: income and tax, living costs, loan interest
 * and its automatic payment, then investment and asset movement. Only the net
 * result reaches `character.money`, which never goes below zero — a shortfall is
 * covered by selling assets and, failing that, by bankruptcy.
 */

import { currentYearLog } from '@/engine/ageUp';
import { clampStat } from '@/engine/effects';
import { fmtMoney } from '@/engine/format';
import type {
  AssetDef,
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

/** Share of the (already compounded) principal the bank takes each year. */
const LOAN_PAYMENT_SHARE = 0.15;

const PERSONAL_APR = 0.09;
const MORTGAGE_APR = 0.06;
const AUTO_APR = 0.09;
const MORTGAGE_DOWN = 0.2;
const AUTO_DOWN = 0.3;

/** Borrowing cap: five years of salary, or this floor for anyone without one. */
const LOAN_INCOME_MULT = 5;
const LOAN_MIN_CAP = 10000;
const MAX_PERSONAL_LOANS = 3;

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

/** Yearly living costs; zero for a minor and for anyone behind bars. */
function livingCosts(ctx: Ctx, costMult: number, entries: LogEntry[]): number {
  const state = ctx.state;
  const c = state.character;
  if (c.age < ADULT_AGE || c.prison) return 0;

  const home = ownsProperty(ctx.reg, state);
  if (c.flags.livesWithParents === true && (c.age >= MOVE_OUT_AGE || hasSpouse(state) || home)) {
    c.flags.livesWithParents = false;
    entries.push({ icon: '📦', kind: 'info', text: 'You moved out on your own.' });
  }

  let total = LIVING_COST * costMult;
  if (c.flags.livesWithParents !== true && !home) total += RENT * costMult;
  total += dependentChildren(state) * CHILD_COST * costMult;
  return Math.round(total);
}

/**
 * Compounds every loan, then takes the automatic payment out of the cash on
 * hand. Returns what is left of that cash; cleared loans drop off the character.
 */
function settleLoans(ctx: Ctx, cash: number, entries: LogEntry[]): number {
  const c = ctx.state.character;
  const kept: Loan[] = [];
  let left = cash;

  for (const loan of c.loans) {
    loan.principal = Math.round(loan.principal * (1 + loan.apr));
    /* A share that rounds down to nothing would leave the last few dollars owed
       for ever, so the remainder is swept whenever the cash covers it. */
    const due = Math.round(loan.principal * LOAN_PAYMENT_SHARE);
    const pay = Math.max(0, Math.min(left, due > 0 ? due : loan.principal));
    loan.principal -= pay;
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

/** Sells assets cheapest-first until the books balance again. */
function forceSales(ctx: Ctx, cash: number, entries: LogEntry[]): number {
  const c = ctx.state.character;
  let left = cash;
  const cheapestFirst = [...c.assets].sort((a, b) => a.value - b.value);

  for (const asset of cheapestFirst) {
    if (left >= 0) break;
    left += asset.value;
    c.assets = c.assets.filter((held) => held.id !== asset.id);
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

  if (cash < 0) cash = forceSales(ctx, cash, entries);
  if (cash < 0) {
    cash = 0;
    c.loans = [];
    c.assets = [];
    c.stats.happiness = clampStat(c.stats.happiness - BANKRUPTCY_GRIEF);
    c.flags.bankrupt = true;
    entries.push({ icon: '🏦', kind: 'bad', text: 'You went bankrupt.' });
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
  const c = state.character;
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
    id: `l${c.loans.length + 1}-${c.age}`,
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
    id: `a${c.assets.length + 1}-${c.age}`,
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
      id: `l${c.loans.length + 1}-${c.age}`,
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
