import { describe, expect, it } from 'vitest';
import { killCharacter } from '@/engine/death';
import { educationPhase } from '@/engine/phases/education';
import {
  buyAsset,
  depositInvestment,
  financePhase,
  netWorth,
  repayLoan,
  sellAsset,
  takeLoan,
  withdrawInvestment,
} from '@/engine/phases/finance';
import { createRng, initialRngState } from '@/engine/rng';
import { addPerson, createLife } from '@/engine/state';
import type {
  AssetDef,
  ContentRegistry,
  CountryDef,
  Ctx,
  GameState,
  JobState,
  Loan,
  LogEntry,
  SchoolDef,
} from '@/types';

/* Built by hand rather than through `buildRegistry`, which is another agent's
   module and still a stub. */
function emptyRegistry(): ContentRegistry {
  return {
    packs: [],
    events: [],
    eventsById: {},
    interactions: [],
    interactionsById: {},
    jobs: [],
    jobsById: {},
    assets: [],
    assetsById: {},
    illnesses: [],
    illnessesById: {},
    schools: [],
    schoolsById: {},
    countries: [],
    countriesById: {},
    crimes: [],
    crimesById: {},
    achievements: [],
    achievementsById: {},
    namePools: {},
  };
}

const COUNTRIES: CountryDef[] = [
  { id: 'us', label: 'the States', flag: '🇺🇸', costMult: 1, taxMult: 1, visaDifficulty: 0.5 },
  { id: 'hi', label: 'Highland', flag: '🏔️', costMult: 1, taxMult: 1.2, visaDifficulty: 0.5 },
  { id: 'px', label: 'Pricey', flag: '💎', costMult: 2, taxMult: 1, visaDifficulty: 0.5 },
];

const ASSETS: AssetDef[] = [
  {
    id: 'condo',
    type: 'property',
    label: 'condo',
    icon: '🏢',
    price: 200000,
    upkeepPct: 0.01,
    apprPct: 0.03,
  },
  {
    id: 'sedan',
    type: 'vehicle',
    label: 'sedan',
    icon: '🚗',
    price: 20000,
    upkeepPct: 0.05,
    apprPct: -0.1,
  },
  {
    id: 'scooter',
    type: 'vehicle',
    label: 'scooter',
    icon: '🛵',
    price: 2000,
    upkeepPct: 0,
    apprPct: -0.1,
    minAge: 16,
  },
  {
    id: 'estate',
    type: 'property',
    label: 'estate',
    icon: '🏰',
    price: 1000000,
    upkeepPct: 0.02,
    apprPct: 0.03,
    minAge: 30,
  },
];

function registry(): ContentRegistry {
  const reg = emptyRegistry();
  reg.countries = COUNTRIES;
  for (const country of COUNTRIES) reg.countriesById[country.id] = country;
  reg.assets = ASSETS;
  for (const asset of ASSETS) reg.assetsById[asset.id] = asset;
  return reg;
}

const REG = registry();

function newLife(seed = 1): GameState {
  const state = createLife(REG, {
    seed,
    firstName: 'Ada',
    lastName: 'Byron',
    gender: 'female',
    countryId: 'us',
    startYear: 2000,
  });
  // Family is generated per seed; tests that care about people build their own.
  state.people = {};
  return state;
}

function ctxFor(state: GameState): Ctx {
  return { state, c: state.character, rng: createRng(state), reg: REG };
}

function job(salary: number): JobState {
  return { jobId: 'x', title: 'Worker', salary, years: 1, performance: 50, workHard: false };
}

function texts(entries: LogEntry[]): string[] {
  return entries.map((e) => e.text);
}

/** Runs `attempt` on a fresh state per rng cursor until `hit` says the branch fired. */
function forceBranch(
  build: () => GameState,
  attempt: (state: GameState) => void,
  hit: (state: GameState) => boolean,
  limit = 400
): GameState {
  for (let cursor = 1; cursor <= limit; cursor += 1) {
    const state = build();
    state.rngState = initialRngState(cursor);
    attempt(state);
    if (hit(state)) return state;
  }
  throw new Error(`branch never fired within ${limit} rng cursors`);
}

/* ---------------------------------------------------------------------------
   Income tax
--------------------------------------------------------------------------- */

/** A minor with a salary: no living costs, so the year's move is income - tax. */
function taxPaidOn(gross: number, countryId = 'us'): number {
  const state = newLife(2);
  state.character.age = 17;
  state.character.countryId = countryId;
  state.character.money = 0;
  state.character.job = job(gross);
  financePhase(ctxFor(state));
  return gross - state.character.money;
}

describe('income tax', () => {
  it('charges each marginal bracket exactly at its boundary', () => {
    expect(taxPaidOn(0)).toBe(0);
    expect(taxPaidOn(10000)).toBe(1000);
    expect(taxPaidOn(40000)).toBe(7000);
    expect(taxPaidOn(100000)).toBe(25000);
    expect(taxPaidOn(300000)).toBe(95000);
    expect(taxPaidOn(400000)).toBe(135000);
  });

  it('taxes only the slice inside each bracket', () => {
    expect(taxPaidOn(25000)).toBe(4000);
    expect(taxPaidOn(70000)).toBe(16000);
    expect(taxPaidOn(200000)).toBe(60000);
  });

  it("scales the whole bill by the country's multiplier", () => {
    expect(taxPaidOn(10000, 'hi')).toBe(1200);
    expect(taxPaidOn(40000, 'hi')).toBe(8400);
    expect(taxPaidOn(100000, 'hi')).toBe(30000);
    expect(taxPaidOn(300000, 'hi')).toBe(114000);
  });

  it('treats an unknown country as multiplier 1', () => {
    const state = newLife(3);
    state.character.age = 17;
    state.character.countryId = 'atlantis';
    state.character.job = job(40000);
    financePhase(ctxFor(state));
    expect(state.character.money).toBe(33000);
  });

  it('taxes a pension like a salary', () => {
    const state = newLife(4);
    state.character.age = 17;
    state.character.flags.pensionSalary = 20000;
    financePhase(ctxFor(state));
    expect(state.character.money).toBe(17000);
  });

  it('adds salary and pension into one gross figure', () => {
    const state = newLife(5);
    state.character.age = 17;
    state.character.job = job(30000);
    state.character.flags.pensionSalary = 10000;
    // 40k gross is taxed 7000, not 3000 + 1000.
    financePhase(ctxFor(state));
    expect(state.character.money).toBe(33000);
  });
});

/* ---------------------------------------------------------------------------
   Living costs
--------------------------------------------------------------------------- */

describe('living costs', () => {
  it('charges a minor nothing', () => {
    const state = newLife(6);
    state.character.age = 17;
    state.character.money = 50000;
    financePhase(ctxFor(state));
    expect(state.character.money).toBe(50000);
  });

  it('charges base costs but no rent while living with parents', () => {
    const state = newLife(7);
    state.character.age = 18;
    state.character.money = 50000;
    const entries = financePhase(ctxFor(state));

    expect(state.character.money).toBe(42000);
    expect(state.character.flags.livesWithParents).toBe(true);
    expect(texts(entries)).toEqual([]);
  });

  it('moves the character out at 22 and starts charging rent that same year', () => {
    const state = newLife(8);
    state.character.age = 22;
    state.character.money = 50000;
    const entries = financePhase(ctxFor(state));

    expect(state.character.flags.livesWithParents).toBe(false);
    expect(texts(entries)).toEqual(['You moved out on your own.']);
    expect(state.character.money).toBe(30000);
  });

  it('announces the move only once', () => {
    const state = newLife(9);
    state.character.age = 22;
    state.character.money = 100000;
    financePhase(ctxFor(state));
    const second = financePhase(ctxFor(state));

    expect(texts(second)).toEqual([]);
    expect(state.character.money).toBe(60000);
  });

  it('moves a married character out early', () => {
    const state = newLife(10);
    state.character.age = 19;
    state.character.money = 50000;
    addPerson(state, {
      kind: 'spouse',
      name: 'Sam Byron',
      gender: 'male',
      age: 22,
      alive: true,
      rel: 80,
      flags: {},
    });

    const entries = financePhase(ctxFor(state));

    expect(state.character.flags.livesWithParents).toBe(false);
    expect(texts(entries)).toEqual(['You moved out on your own.']);
    expect(state.character.money).toBe(30000);
  });

  it('charges no rent to a homeowner, only upkeep', () => {
    const state = newLife(11);
    state.character.age = 30;
    state.character.flags.livesWithParents = false;
    state.character.money = 100000;
    state.character.assets = [
      { id: 'a1-30', defId: 'condo', label: 'condo', paid: 200000, value: 200000, yearBought: 2020 },
    ];

    financePhase(ctxFor(state));

    // 206000 after appreciation, 1% upkeep, 8000 of living costs and no rent.
    expect(state.character.assets[0].value).toBe(206000);
    expect(state.character.money).toBe(89940);
  });

  it('charges 6000 a year for every child still under 18', () => {
    const state = newLife(12);
    state.character.age = 40;
    state.character.flags.livesWithParents = false;
    state.character.money = 100000;
    for (const [name, age, alive] of [
      ['Kid One', 4, true],
      ['Kid Two', 17, true],
      ['Kid Three', 18, true],
      ['Kid Four', 2, false],
    ] as [string, number, boolean][]) {
      addPerson(state, {
        kind: 'child',
        name,
        gender: 'female',
        age,
        alive,
        rel: 70,
        flags: {},
      });
    }

    financePhase(ctxFor(state));

    // 8000 base + 12000 rent + 2 x 6000.
    expect(state.character.money).toBe(68000);
  });

  it("scales every cost by the country's cost multiplier", () => {
    const state = newLife(13);
    state.character.age = 30;
    state.character.countryId = 'px';
    state.character.flags.livesWithParents = false;
    state.character.money = 100000;

    financePhase(ctxFor(state));

    expect(state.character.money).toBe(60000);
  });

  it('charges a student still living at home nothing: the family pays', () => {
    const state = newLife(70);
    const c = state.character;
    c.age = 19;
    // What a summer job left them, and all they have to live on.
    c.money = 5000;
    c.education = { level: 'high', enrolledIn: 'sch-u', year: 1, gpa: 3, studyHard: false };

    const entries = financePhase(ctxFor(state));

    /* A full-time student has no income; billing them a full adult's keep ended
       every school year in the red, and a year in the red with the tuition loan
       outstanding was read as bankruptcy. */
    expect(texts(entries)).toEqual([]);
    expect(c.money).toBe(5000);
    expect(c.flags.livesWithParents).toBe(true);
    expect(c.flags.bankrupt).toBeUndefined();
  });

  it('charges a student who has left home like any other adult', () => {
    const state = newLife(71);
    const c = state.character;
    c.age = 20;
    c.money = 50000;
    c.flags.livesWithParents = false;
    c.education = { level: 'high', enrolledIn: 'sch-u', year: 1, gpa: 3, studyHard: false };

    financePhase(ctxFor(state));

    // Nobody else is paying this rent: 8000 of living costs plus 12000 of it.
    expect(c.money).toBe(30000);
  });

  it('still moves a student out at 22 and starts charging them', () => {
    const state = newLife(73);
    const c = state.character;
    c.age = 22;
    c.money = 50000;
    c.education = { level: 'high', enrolledIn: 'sch-u', year: 4, gpa: 3, studyHard: false };

    const entries = financePhase(ctxFor(state));

    // The exemption is for dependents, not a way to stay a child for ever.
    expect(texts(entries)).toEqual(['You moved out on your own.']);
    expect(c.flags.livesWithParents).toBe(false);
    expect(c.money).toBe(30000);
  });

  it("still feeds a student's own children", () => {
    const state = newLife(74);
    const c = state.character;
    c.age = 20;
    c.money = 50000;
    c.education = { level: 'high', enrolledIn: 'sch-u', year: 1, gpa: 3, studyHard: false };
    addPerson(state, {
      kind: 'child',
      name: 'Kid One',
      gender: 'male',
      age: 1,
      alive: true,
      rel: 70,
      flags: {},
    });

    financePhase(ctxFor(state));

    // The family keeps the student; the student keeps the baby.
    expect(c.money).toBe(44000);
  });

  it('charges nothing while the character is in prison', () => {
    const state = newLife(14);
    state.character.age = 30;
    state.character.flags.livesWithParents = false;
    state.character.money = 50000;
    state.character.prison = { crime: 'theft', yearsLeft: 3, totalYears: 5 };

    financePhase(ctxFor(state));

    expect(state.character.money).toBe(50000);
    expect(state.character.flags.livesWithParents).toBe(false);
  });
});

/* ---------------------------------------------------------------------------
   Loans
--------------------------------------------------------------------------- */

describe('loans in the finance phase', () => {
  it('charges the year of interest and repays 15% of the principal on top of it', () => {
    const state = newLife(15);
    state.character.age = 17;
    state.character.money = 50000;
    state.character.loans = [{ id: 'l1-17', kind: 'personal', principal: 10000, apr: 0.09 }];

    financePhase(ctxFor(state));

    /* 900 of interest, then 1500 off the balance: the instalment covers the
       interest before it repays anything, so the 15% is real. Taking 15% of the
       compounded balance instead leaves only 735 of it against the debt. */
    expect(state.character.loans[0].principal).toBe(8500);
    expect(state.character.money).toBe(50000 - 2400);
  });

  it('pays only what the cash covers', () => {
    const state = newLife(16);
    state.character.age = 17;
    state.character.money = 500;
    state.character.loans = [{ id: 'l1-17', kind: 'student', principal: 10000, apr: 0 }];

    financePhase(ctxFor(state));

    expect(state.character.money).toBe(0);
    expect(state.character.loans[0].principal).toBe(9500);
  });

  it('sweeps the last few dollars and logs the payoff', () => {
    const state = newLife(17);
    state.character.age = 17;
    state.character.money = 500;
    state.character.loans = [{ id: 'l1-17', kind: 'mortgage', principal: 3, apr: 0 }];

    const entries = financePhase(ctxFor(state));

    expect(state.character.loans).toEqual([]);
    expect(state.character.money).toBe(497);
    expect(entries).toEqual([
      { icon: '✅', kind: 'good', text: 'You paid off your mortgage loan.' },
    ]);
  });

  it('shrinks a loan year after year', () => {
    const state = newLife(18);
    state.character.age = 17;
    state.character.money = 1000000;
    state.character.loans = [{ id: 'l1-17', kind: 'personal', principal: 100000, apr: 0.09 }];

    let previous = 100000;
    for (let year = 0; year < 10; year += 1) {
      financePhase(ctxFor(state));
      const now = state.character.loans[0].principal;
      expect(now).toBeLessThan(previous);
      previous = now;
    }
  });

  it('pays every loan off inside a lifetime, at each apr the game charges', () => {
    /* Every rate the engine actually issues: 5% on tuition, 6% on a mortgage and
       the 9% both a personal loan and a car loan carry. Charging the share to
       the already compounded balance made 9% mathematically immortal — the
       balance settled on a fixed point and the payoff line was unreachable —
       and left 5% and 6% still owed after 74 and 103 years. */
    const debts: readonly (readonly [Loan['kind'], number, number])[] = [
      ['student', 60000, 0.05],
      ['mortgage', 200000, 0.06],
      ['auto', 14000, 0.09],
      ['personal', 15000, 0.09],
    ];
    const LIMIT = 40;

    for (const [kind, principal, apr] of debts) {
      const state = newLife(67);
      const c = state.character;
      c.age = 25;
      c.flags.livesWithParents = false;
      c.loans = [{ id: 'l1', kind, principal, apr }];
      const feed: string[] = [];
      let years = 0;

      while (c.loans.length > 0 && years < LIMIT) {
        // Never cash-constrained: what is left is the schedule, not poverty.
        c.money = 10_000_000;
        feed.push(...texts(financePhase(ctxFor(state))));
        c.age += 1;
        years += 1;
      }

      expect(c.loans).toEqual([]);
      expect(years).toBeLessThan(LIMIT);
      expect(feed).toEqual([`You paid off your ${kind} loan.`]);
    }
  });

  it('never parks a balance on a fixed point it cannot leave', () => {
    const state = newLife(68);
    const c = state.character;
    c.age = 25;
    c.flags.livesWithParents = false;
    c.money = 100000;
    // The exact balance a 9% loan used to sit on for ever: 8 -> 9, pay 1, back to 8.
    c.loans = [{ id: 'l1', kind: 'auto', principal: 8, apr: 0.09 }];

    const entries = financePhase(ctxFor(state));

    expect(c.loans).toEqual([]);
    expect(texts(entries)).toEqual(['You paid off your auto loan.']);
  });
});

/* ---------------------------------------------------------------------------
   A debt with no way to pay it
--------------------------------------------------------------------------- */

/** A graduate on their own with tuition owed and, by default, no way to pay it. */
function jobless(seed: number): GameState {
  const state = newLife(seed);
  const c = state.character;
  c.age = 22;
  c.money = 0;
  c.flags.livesWithParents = false;
  c.education = { level: 'university', year: 0, gpa: 3, studyHard: false };
  c.loans = [{ id: 'l1', kind: 'student', principal: 88000, apr: 0.05 }];
  return state;
}

describe('a year that cannot service a loan', () => {
  it('holds the balance instead of compounding it for the rest of the life', () => {
    const state = jobless(80);
    const c = state.character;
    const feed: string[] = [];

    for (let year = 0; year < 60; year += 1) {
      feed.push(...texts(financePhase(ctxFor(state))));
      c.age += 1;
      /* Not one dollar of it moves: an instalment is taken out of the cash on
         hand, and a graduate with no wage, no pots and nothing to sell never has
         any. Tuition also survives bankruptcy on purpose, so the balance had no
         exit of any kind and simply compounded at 5% for sixty years — 88000
         reached 182947 by 37, 790687 by 67 and 1643781 by 82, all of it quoted
         by the HUD, the finance sheet and the death screen. */
      expect(c.loans).toEqual([{ id: 'l1', kind: 'student', principal: 88000, apr: 0.05 }]);
    }

    expect(c.age).toBe(82);
    expect(netWorth(state)).toBe(-88000);
    // Sixty years of it, and the feed never says a word about any of them.
    expect(feed).toEqual([]);
    expect(c.money).toBe(0);
    expect(c.flags.bankrupt).toBeUndefined();
  });

  it('is a hold and not a write-off: the debt is still owed in full', () => {
    const state = jobless(81);
    const c = state.character;

    for (let year = 0; year < 20; year += 1) {
      financePhase(ctxFor(state));
      c.age += 1;
    }
    expect(c.loans).toEqual([{ id: 'l1', kind: 'student', principal: 88000, apr: 0.05 }]);

    // A wage at 42 puts the same 88000 back on the schedule it was always on.
    c.job = job(70000);
    const feed: string[] = [];
    let years = 0;
    while (c.loans.length > 0 && years < 60) {
      feed.push(...texts(financePhase(ctxFor(state))));
      c.age += 1;
      years += 1;
    }

    // 23 instalments: the wage is earned and paid over inside the same year.
    expect(years).toBe(23);
    expect(feed).toEqual(['You paid off your student loan.']);
  });

  it('takes the instalment out of the pots, but never out of the roof overhead', () => {
    /* The pots are the character's own money — `withdrawInvestment` moves them
       back for free and `netWorth` counts them — so an instalment reaches them
       exactly as the year's shortfall does. Leaving them out meant a millionaire
       whose cash happened to sit in a savings account paid nothing at all, for
       ever, on a balance the forbearance floor had already frozen. */
    const pots = jobless(82);
    pots.character.investments = { savings: 100000, index: 0, crypto: 0 };
    financePhase(ctxFor(pots));
    // 4400 of interest and 13200 off the balance, out of the pot.
    expect(pots.character.loans[0].principal).toBe(74800);
    // 102000 after the 2%, less the 20000 the year cost and the 17600 instalment.
    expect(pots.character.investments.savings).toBe(64400);

    /* An asset is another matter: a house is not spending money. It is sold by a
       shortfall big enough to threaten the whole year and by nothing else, so it
       never funds an instalment and the balance simply holds. */
    const owner = jobless(83);
    owner.character.assets = [
      { id: 'a1', defId: 'scooter', label: 'scooter', paid: 2000, value: 2000, yearBought: 2020 },
    ];
    financePhase(ctxFor(owner));
    expect(owner.character.loans[0].principal).toBe(88000);
    expect(owner.character.assets).toEqual([]);
  });

  it('puts a pensioner on the schedule in the very year the pension lands', () => {
    const state = jobless(84);
    const c = state.character;
    c.flags.pensionSalary = 30000;

    financePhase(ctxFor(state));

    /* 30000 of pension, 5000 of tax and 20000 of keep: the year ends 5000 up and
       all 5000 of it reaches the lender. Settling the loan out of the cash the
       year *opened* with instead meant this pensioner paid nothing in their
       first year — and, ending every year at zero, nothing in any year after
       either. 5000 does not cover the 4400 of interest plus a share, so the rest
       is forborne and the balance still falls rather than growing. */
    expect(c.loans[0].principal).toBe(87400);
    expect(c.money).toBe(0);

    // And it goes on falling, every year, out of the same pension.
    let previous = 87400;
    for (let year = 0; year < 5; year += 1) {
      c.age += 1;
      financePhase(ctxFor(state));
      expect(c.loans[0].principal).toBeLessThan(previous);
      previous = c.loans[0].principal;
    }
    expect(c.money).toBe(0);
  });

  it('holds the balance when a payment cannot cover the year of interest', () => {
    const state = jobless(85);
    const c = state.character;
    // 20000 of keep and 100 over, so exactly 100 reaches the lender.
    c.money = 20100;

    financePhase(ctxFor(state));

    /* 100 against 4400 of interest: the lender takes it, and the rest of the
       interest is forborne instead of being added to the balance. Growing it to
       92300 on the strength of a token payment is the same compounding by
       another name. */
    expect(c.loans[0].principal).toBe(88000);
    expect(c.money).toBe(0);
  });

  it('leaves a working graduate on exactly the schedule it always had', () => {
    const state = jobless(86);
    const c = state.character;
    c.job = job(70000);
    const feed: string[] = [];
    let years = 0;

    while (c.loans.length > 0 && years < 60) {
      feed.push(...texts(financePhase(ctxFor(state))));
      c.age += 1;
      years += 1;
    }

    /* The control the hold must not touch: someone who can service the debt
       clears it on the amortisation schedule, in one payoff line. 23 years of
       instalments, starting with the first wage the graduate earns rather than
       the year after it. */
    expect(years).toBe(23);
    expect(feed).toEqual(['You paid off your student loan.']);
  });

  it('keeps a graduate on a modest wage bounded for the whole of their life', () => {
    /* The ordinary way to play, and the case a rule written around whether an
       income *exists* let straight through: a clerk nets +1000 a year against
       4400 of interest, so the balance grew ~3400 a year and compounded — 212099
       by 42, 529695 by 62 and 1307976 by 81, all of it quoted by the HUD, the
       finance sheet and the death screen. What matters is whether anything can
       actually reach the loan, and 1000 a year cannot. */
    const state = jobless(87);
    const c = state.character;
    c.job = { jobId: 'clerk', title: 'Clerk', salary: 25000, years: 1, performance: 50, workHard: false };
    let worst = 0;

    for (let age = 22; age <= 81; age += 1) {
      financePhase(ctxFor(state));
      worst = Math.max(worst, c.loans[0].principal);
      c.age += 1;
    }

    expect(c.age).toBe(82);
    expect(worst).toBe(88000);
    expect(c.loans).toEqual([{ id: 'l1', kind: 'student', principal: 88000, apr: 0.05 }]);
    expect(netWorth(state)).toBe(-88000 + c.money);
  });

  it('keeps a retiree on a pension bounded too', () => {
    // 6000 of pension against 20000 of keep: the year still cannot reach the
    // loan, and the balance ran to 380334 by 99 when it was allowed to compound.
    const state = jobless(88);
    const c = state.character;
    c.age = 70;
    c.flags.pensionSalary = 6000;

    for (let age = 70; age <= 99; age += 1) {
      financePhase(ctxFor(state));
      c.age += 1;
    }

    expect(c.loans).toEqual([{ id: 'l1', kind: 'student', principal: 88000, apr: 0.05 }]);
    expect(c.money).toBe(0);
  });

  it('never grows a balance, at any income and any rate the game charges', () => {
    /* The invariant itself, swept across the incomes that used to decide it —
       nothing at all, a pension, a wage — and every rate the engine issues. */
    const incomes: readonly (readonly [string, number, number])[] = [
      ['destitute', 0, 0],
      ['pensioner', 0, 6000],
      ['clerk', 25000, 0],
      ['earner', 25000, 6000],
    ];
    const debts: readonly (readonly [Loan['kind'], number, number])[] = [
      ['student', 88000, 0.05],
      ['mortgage', 200000, 0.06],
      ['auto', 14000, 0.09],
      ['personal', 15000, 0.09],
    ];

    for (const [label, salary, pension] of incomes) {
      for (const [kind, principal, apr] of debts) {
        const state = newLife(89);
        const c = state.character;
        c.age = 25;
        c.money = 0;
        c.flags.livesWithParents = false;
        if (salary > 0) c.job = job(salary);
        if (pension > 0) c.flags.pensionSalary = pension;
        c.loans = [{ id: 'l1', kind, principal, apr }];

        let previous = principal;
        for (let year = 0; year < 60 && c.loans.length > 0; year += 1) {
          financePhase(ctxFor(state));
          const now = c.loans.length > 0 ? c.loans[0].principal : 0;
          expect({ label, kind, now }).toEqual({ label, kind, now: Math.min(now, previous) });
          previous = now;
        }
      }
    }
  });

  it('still amortises a solvent borrower to zero on the same schedule', () => {
    /* The other half of the invariant: forbearance only ever holds back interest
       a payment could not cover, so a borrower whose instalment clears it pays
       the loan down exactly as before, year on year, and clears it once. */
    const state = newLife(90);
    const c = state.character;
    c.age = 30;
    c.money = 40000;
    c.flags.livesWithParents = false;
    c.job = job(90000);
    c.loans = [{ id: 'l1', kind: 'student', principal: 88000, apr: 0.05 }];

    const feed: string[] = [];
    let previous = 88000;
    let years = 0;

    while (c.loans.length > 0 && years < 60) {
      feed.push(...texts(financePhase(ctxFor(state))));
      const now = c.loans.length > 0 ? c.loans[0].principal : 0;
      expect(now).toBeLessThan(previous);
      previous = now;
      c.age += 1;
      years += 1;
    }

    // 23 years of the 15% share and its 1000 floor, never cash-constrained.
    expect(years).toBe(23);
    expect(feed).toEqual(['You paid off your student loan.']);
  });
});

/* ---------------------------------------------------------------------------
   Money in the other pocket
--------------------------------------------------------------------------- */

describe('a borrower whose money is not in the current account', () => {
  it('amortises a pot-rich borrower to zero instead of freezing them for ever', () => {
    /* The instalment used to be the first move of the year, taken against the
       cash the year *opened* with and against nothing else — and `financePhase`
       ends every short year at zero. So a millionaire whose money sat in a
       savings account paid exactly nothing, and the forbearance floor that stops
       an unpayable balance growing froze it there: 30 years, $50,000 still owed,
       $8.2M in the bank, not one dollar of it repaid. */
    const state = newLife(121);
    const c = state.character;
    c.age = 40;
    c.money = 0;
    c.flags.livesWithParents = false;
    c.investments = { savings: 5_000_000, index: 0, crypto: 0 };
    c.loans = [{ id: 'l1', kind: 'personal', principal: 50000, apr: 0.09 }];

    const feed: string[] = [];
    let previous = 50000;
    let years = 0;

    while (c.loans.length > 0 && years < 30) {
      feed.push(...texts(financePhase(ctxFor(state))));
      const now = c.loans.length > 0 ? c.loans[0].principal : 0;
      // Every year buys the balance down: 9% of interest plus the 15% share.
      expect(now).toBeLessThan(previous);
      previous = now;
      c.age += 1;
      years += 1;
    }

    expect(c.loans).toEqual([]);
    expect(feed).toEqual(['You paid off your personal loan.']);
    // Paid out of the pot the drawdown already treats as the character's money.
    expect(c.investments.savings).toBeLessThan(5_000_000 * 1.02 ** years);
    expect(netWorth(state)).toBe(c.money + c.investments.savings);
  });

  it('is not a free perpetual capital injection to bank the loan and never pay it', () => {
    /* The deliberate version: `depositInvestment` moves cash out of reach for
       nothing, so every year opened at zero, every instalment was zero, and a
       9% loan that could neither grow nor shrink handed the player 600,000
       dollars to invest for the rest of their life. */
    const state = newLife(21);
    const c = state.character;
    c.age = 30;
    c.flags.livesWithParents = false;
    c.job = job(120000);

    expect(takeLoan(state, REG, 600000)).toEqual({ ok: true });
    expect(c.money).toBe(600000);

    const feed: string[] = [];
    for (let year = 0; year < 40; year += 1) {
      depositInvestment(state, 'savings', c.money);
      feed.push(...texts(financePhase(ctxFor(state))));
      c.age += 1;
    }

    expect(c.loans).toEqual([]);
    expect(feed).toEqual(['You paid off your personal loan.']);
  });

  it('still freezes the balance of a borrower who genuinely has nothing', () => {
    /* The control the drawdown must not touch: reaching into the pots is not the
       same as inventing money. With nothing in them and nothing coming in, the
       instalment is still zero and the balance still cannot grow — and the pots
       are left at zero rather than going negative. Tuition, because that is the
       debt with no other terminal state: anything else here is discharged by the
       bankruptcy block on the first short year. */
    const state = jobless(122);
    const c = state.character;

    for (let year = 0; year < 30; year += 1) {
      expect(texts(financePhase(ctxFor(state)))).toEqual([]);
      c.age += 1;
    }

    expect(c.loans).toEqual([{ id: 'l1', kind: 'student', principal: 88000, apr: 0.05 }]);
    expect(c.investments).toEqual({ savings: 0, index: 0, crypto: 0 });
    expect(c.money).toBe(0);
    expect(netWorth(state)).toBe(-88000);
  });

  it('takes only what the instalment needs, in the drawdown order', () => {
    const state = newLife(123);
    const c = state.character;
    // A minor pays no keep, so the only draw on the pots is the instalment.
    c.age = 17;
    c.money = 0;
    c.investments = { savings: 5000, index: 100000, crypto: 50000 };
    state.rngState = initialRngState(99);
    c.loans = [{ id: 'l1', kind: 'personal', principal: 40000, apr: 0.09 }];

    const probe = { rngState: initialRngState(99) };
    const mirror = createRng(probe);
    const grownIndex = Math.round(100000 * (1 + mirror.normal(0.07, 0.15)));
    const grownCrypto = Math.round(50000 * (1 + mirror.normal(0.15, 0.6)));

    financePhase(ctxFor(state));

    // 3600 of interest plus 6000 off the balance: 5100 of savings, then 4500 more.
    expect(c.loans[0].principal).toBe(34000);
    expect(c.investments.savings).toBe(0);
    expect(c.investments.index).toBe(grownIndex - 4500);
    // The volatile pot is last and was never reached.
    expect(c.investments.crypto).toBe(grownCrypto);
    expect(c.money).toBe(0);
  });
});

/* ---------------------------------------------------------------------------
   Investments and assets
--------------------------------------------------------------------------- */

describe('investments', () => {
  it('pays 2% on savings and the drawn return on index and crypto', () => {
    const state = newLife(19);
    state.character.age = 17;
    state.character.investments = { savings: 10000, index: 10000, crypto: 5000 };
    state.rngState = initialRngState(99);

    const probe = { rngState: initialRngState(99) };
    const mirror = createRng(probe);
    const indexReturn = mirror.normal(0.07, 0.15);
    const cryptoReturn = mirror.normal(0.15, 0.6);

    financePhase(ctxFor(state));

    expect(state.character.investments.savings).toBe(10200);
    expect(state.character.investments.index).toBe(Math.round(10000 * (1 + indexReturn)));
    expect(state.character.investments.crypto).toBe(Math.round(5000 * (1 + cryptoReturn)));
    // Both draws were taken from the shared cursor, in that order.
    expect(state.rngState).toBe(probe.rngState);
  });

  it('replays identically from the same cursor', () => {
    const runOnce = (): number[] => {
      const state = newLife(20);
      state.character.age = 17;
      state.character.investments = { savings: 100, index: 5000, crypto: 5000 };
      state.rngState = initialRngState(7);
      financePhase(ctxFor(state));
      const inv = state.character.investments;
      return [inv.savings, inv.index, inv.crypto];
    };
    expect(runOnce()).toEqual(runOnce());
  });

  it('never lets a crash take a balance below zero', () => {
    const wiped = forceBranch(
      () => {
        const state = newLife(21);
        state.character.age = 17;
        state.character.investments = { savings: 0, index: 0, crypto: 10000 };
        return state;
      },
      (state) => financePhase(ctxFor(state)),
      (state) => state.character.investments.crypto === 0
    );
    expect(wiped.character.investments.crypto).toBe(0);
  });
});

describe('assets', () => {
  it('appreciates property, depreciates vehicles and bills upkeep on the new value', () => {
    const state = newLife(22);
    state.character.age = 17;
    state.character.money = 100000;
    state.character.assets = [
      { id: 'a1-17', defId: 'condo', label: 'condo', paid: 200000, value: 200000, yearBought: 2000 },
      { id: 'a2-17', defId: 'sedan', label: 'sedan', paid: 20000, value: 20000, yearBought: 2000 },
    ];

    financePhase(ctxFor(state));

    expect(state.character.assets[0].value).toBe(206000);
    expect(state.character.assets[1].value).toBe(18000);
    // 1% of 206000 plus 5% of 18000.
    expect(state.character.money).toBe(100000 - 2060 - 900);
  });

  it('holds the value of an asset whose def is missing and bills 1% upkeep', () => {
    const state = newLife(23);
    state.character.age = 17;
    state.character.money = 100000;
    state.character.assets = [
      { id: 'a1-17', defId: 'ghost', label: 'time machine', paid: 50000, value: 50000, yearBought: 2000 },
    ];

    financePhase(ctxFor(state));

    expect(state.character.assets[0].value).toBe(50000);
    expect(state.character.money).toBe(99500);
  });
});

/* ---------------------------------------------------------------------------
   Shortfalls
--------------------------------------------------------------------------- */

describe('a shortfall drawing on the investment pots', () => {
  it('pays the year out of savings rather than declaring a millionaire bankrupt', () => {
    const state = newLife(61);
    const c = state.character;
    c.age = 40;
    c.money = 0;
    c.flags.livesWithParents = false;
    c.investments = { savings: 2000000, index: 0, crypto: 0 };
    c.loans = [{ id: 'l1', kind: 'student', principal: 120000, apr: 0.05 }];

    const entries = financePhase(ctxFor(state));

    expect(texts(entries)).toEqual([]);
    expect(c.flags.bankrupt).toBeUndefined();
    /* 8000 of living plus 12000 of rent, then the 24000 instalment — 6000 of
       interest and 18000 off the balance — out of the 2,040,000 the pot grew to.
       Nothing was written off: a character who can pay does not get their debts
       discharged for keeping their money in the bank. */
    expect(c.investments.savings).toBe(1996000);
    expect(c.money).toBe(0);
    expect(c.loans).toEqual([{ id: 'l1', kind: 'student', principal: 102000, apr: 0.05 }]);
    expect(netWorth(state)).toBe(1996000 - 102000);
  });

  it('drains savings first, then the index fund, and takes only what it needs', () => {
    const state = newLife(62);
    const c = state.character;
    c.age = 30;
    c.money = 0;
    c.flags.livesWithParents = false;
    c.investments = { savings: 5000, index: 100000, crypto: 50000 };
    state.rngState = initialRngState(99);

    const probe = { rngState: initialRngState(99) };
    const mirror = createRng(probe);
    const grownIndex = Math.round(100000 * (1 + mirror.normal(0.07, 0.15)));
    const grownCrypto = Math.round(50000 * (1 + mirror.normal(0.15, 0.6)));

    const entries = financePhase(ctxFor(state));

    // 20000 of costs: the 5100 the savings pot held, then 14900 from the fund.
    expect(texts(entries)).toEqual([]);
    expect(c.investments.savings).toBe(0);
    expect(c.investments.index).toBe(grownIndex - 14900);
    // The volatile pot is last and was never reached.
    expect(c.investments.crypto).toBe(grownCrypto);
    expect(c.money).toBe(0);
    expect(c.flags.bankrupt).toBeUndefined();
  });

  it('leaves the house standing while the savings account can still pay', () => {
    const state = newLife(63);
    const c = state.character;
    c.age = 45;
    c.money = 0;
    c.flags.livesWithParents = false;
    c.investments = { savings: 5000000, index: 0, crypto: 0 };
    c.assets = [
      { id: 'a1-45', defId: 'condo', label: 'condo', paid: 300000, value: 300000, yearBought: 2020 },
    ];

    const entries = financePhase(ctxFor(state));

    expect(texts(entries)).toEqual([]);
    expect(c.assets.map((asset) => asset.label)).toEqual(['condo']);
    // 5,100,000 after 2%, less 8000 of living costs (an owner pays no rent) and 3090 of upkeep.
    expect(c.investments.savings).toBe(5088910);
    expect(c.money).toBe(0);
  });

  it('does not bankrupt a player the year after they invested their cash', () => {
    const state = newLife(66);
    const c = state.character;
    c.age = 35;
    c.money = 300000;
    c.flags.livesWithParents = false;

    expect(depositInvestment(state, 'index', 300000)).toBe(true);
    expect(c.money).toBe(0);

    const entries = financePhase(ctxFor(state));

    expect(texts(entries)).toEqual([]);
    expect(c.flags.bankrupt).toBeUndefined();
    expect(c.money).toBe(0);
    // The year's 20000 came out of the fund, which is still worth a fortune.
    expect(c.investments.index).toBeGreaterThan(200000);
    expect(netWorth(state)).toBe(c.investments.index);
  });
});

describe('forced sales and bankruptcy', () => {
  it('sells the cheapest assets first and stops as soon as the books balance', () => {
    const state = newLife(24);
    state.character.age = 30;
    state.character.flags.livesWithParents = false;
    state.character.money = 0;
    state.character.assets = [
      { id: 'a1-30', defId: 'condo', label: 'condo', paid: 200000, value: 200000, yearBought: 2020 },
      { id: 'a2-30', defId: 'sedan', label: 'sedan', paid: 20000, value: 20000, yearBought: 2020 },
      { id: 'a3-30', defId: 'scooter', label: 'scooter', paid: 2000, value: 2000, yearBought: 2020 },
    ];

    const entries = financePhase(ctxFor(state));

    // Costs: 8000 of living (a homeowner pays no rent) plus 2960 of upkeep.
    expect(texts(entries)).toEqual([
      'You sold your scooter to stay afloat.',
      'You sold your sedan to stay afloat.',
    ]);
    expect(state.character.assets.map((a) => a.label)).toEqual(['condo']);
    // A forced sale fetches the same 90% a voluntary one does: 1620 for the
    // scooter, then 16200 for the sedan, against 10960 of costs.
    expect(state.character.money).toBe(6860);
    expect(state.character.flags.bankrupt).toBeUndefined();
  });

  it('goes bankrupt when selling everything is still not enough', () => {
    const state = newLife(25);
    state.character.age = 30;
    state.character.flags.livesWithParents = false;
    state.character.money = 0;
    state.character.stats.happiness = 50;
    state.character.investments = { savings: 4000, index: 0, crypto: 0 };
    state.character.assets = [
      { id: 'a1-30', defId: 'scooter', label: 'scooter', paid: 2000, value: 2000, yearBought: 2020 },
    ];
    state.character.loans = [{ id: 'l1-30', kind: 'personal', principal: 50000, apr: 0.09 }];

    const entries = financePhase(ctxFor(state));
    const c = state.character;

    expect(texts(entries)).toEqual([
      'You sold your scooter to stay afloat.',
      'You went bankrupt.',
    ]);
    expect(c.money).toBe(0);
    expect(c.loans).toEqual([]);
    expect(c.assets).toEqual([]);
    expect(c.flags.bankrupt).toBe(true);
    expect(c.stats.happiness).toBe(30);
    /* The pot the character actually owned went into the 20000 shortfall before
       any of this: 4080 of savings, then 1620 from the scooter, leaving 14300
       the estate could not cover. Bankruptcy never reaches into the pots — by
       the time it fires there is nothing left in them to reach for. */
    expect(c.investments).toEqual({ savings: 0, index: 0, crypto: 0 });
  });

  it('never leaves the balance below zero, and being broke is not being bankrupt', () => {
    const state = newLife(26);
    state.character.age = 30;
    state.character.flags.livesWithParents = false;
    state.character.money = 100;
    state.character.stats.happiness = 70;

    const entries = financePhase(ctxFor(state));

    expect(state.character.money).toBe(0);
    // No debt to discharge and no estate to seize: there is nothing to declare.
    expect(texts(entries)).toEqual([]);
    expect(state.character.flags.bankrupt).toBeUndefined();
    // And no grief either: running out of money is not the same as collapsing.
    expect(state.character.stats.happiness).toBe(70);
  });

  it('still goes bankrupt when there is a debt to discharge', () => {
    const state = newLife(64);
    const c = state.character;
    c.age = 30;
    c.flags.livesWithParents = false;
    c.money = 100;
    c.stats.happiness = 50;
    c.loans = [{ id: 'l1', kind: 'personal', principal: 20000, apr: 0 }];

    const entries = financePhase(ctxFor(state));

    expect(texts(entries)).toEqual(['You went bankrupt.']);
    expect(c.money).toBe(0);
    expect(c.loans).toEqual([]);
    expect(c.flags.bankrupt).toBe(true);
    expect(c.stats.happiness).toBe(30);
  });

  it('never calls a broke graduate bankrupt over tuition alone', () => {
    const state = newLife(72);
    const c = state.character;
    c.age = 30;
    c.flags.livesWithParents = false;
    c.money = 100;
    c.stats.happiness = 50;
    c.loans = [{ id: 'l1', kind: 'student', principal: 20000, apr: 0 }];

    const entries = financePhase(ctxFor(state));

    /* An education cannot be repossessed, so tuition is not an estate to seize.
       Counting it made every graduate who ended one year short bankrupt on the
       strength of the loan the engine had just issued them — and then wrote that
       loan off, so no degree was ever paid for. */
    expect(texts(entries)).toEqual([]);
    expect(c.flags.bankrupt).toBeUndefined();
    expect(c.stats.happiness).toBe(50);
    // The 100 went on the year's keep, which is settled before any lender is,
    // so nothing reached the loan and the balance holds rather than compounding.
    expect(c.loans).toEqual([{ id: 'l1', kind: 'student', principal: 20000, apr: 0 }]);
    expect(c.money).toBe(0);
  });

  it('discharges what it can and leaves the tuition owed', () => {
    const state = newLife(75);
    const c = state.character;
    c.age = 30;
    c.flags.livesWithParents = false;
    c.money = 0;
    c.stats.happiness = 60;
    c.loans = [
      { id: 'l1', kind: 'personal', principal: 5000, apr: 0 },
      { id: 'l2', kind: 'student', principal: 30000, apr: 0 },
    ];

    const entries = financePhase(ctxFor(state));

    expect(texts(entries)).toEqual(['You went bankrupt.']);
    expect(c.flags.bankrupt).toBe(true);
    expect(c.stats.happiness).toBe(40);
    // The bank's money goes; the tuition survives the collapse, as it does in life.
    expect(c.loans).toEqual([{ id: 'l2', kind: 'student', principal: 30000, apr: 0 }]);
  });

  it('reports the collapse once and still discharges a debt taken on after it', () => {
    const state = newLife(54);
    const c = state.character;
    c.age = 30;
    c.flags.livesWithParents = false;
    c.money = 0;
    c.stats.happiness = 60;
    c.loans = [{ id: 'l1', kind: 'personal', principal: 4000, apr: 0 }];

    expect(texts(financePhase(ctxFor(state)))).toEqual(['You went bankrupt.']);
    expect(c.loans).toEqual([]);
    expect(c.flags.bankrupt).toBe(true);
    expect(c.stats.happiness).toBe(40);

    // Still broke a year later, and now owing money again.
    c.age = 31;
    c.loans = [{ id: 'l9', kind: 'personal', principal: 4000, apr: 0 }];
    const second = financePhase(ctxFor(state));

    /* The flag governs the notice and the grief, not the write-off: the line is
       not repeated and no further grief is charged, but the new debt is still
       discharged. Gating the discharge on it too locked the character out of the
       only terminal state non-student debt has — the balance could not shrink,
       could not grow and could not be written off, and dragged `netWorth` down
       for the rest of the life. */
    expect(texts(second)).toEqual([]);
    expect(c.money).toBe(0);
    expect(c.stats.happiness).toBe(40);
    expect(c.loans).toEqual([]);
    expect(netWorth(state)).toBe(0);
  });

  it('reports a second collapse once the character has recovered', () => {
    const state = newLife(55);
    const c = state.character;
    c.age = 30;
    c.flags.livesWithParents = false;
    c.money = 0;
    c.loans = [{ id: 'l1', kind: 'personal', principal: 1000, apr: 0 }];

    expect(texts(financePhase(ctxFor(state)))).toEqual(['You went bankrupt.']);

    // A salaried year ends in the black, so the character is solvent again.
    c.age = 31;
    c.job = job(60000);
    expect(texts(financePhase(ctxFor(state)))).toEqual([]);
    expect(c.flags.bankrupt).toBe(false);
    expect(c.money).toBe(27000);

    // Losing it all a second time, with a fresh debt to discharge, is news.
    c.age = 32;
    c.job = null;
    c.money = 0;
    c.loans = [{ id: 'l9', kind: 'personal', principal: 2000, apr: 0 }];
    expect(texts(financePhase(ctxFor(state)))).toEqual(['You went bankrupt.']);
    expect(c.flags.bankrupt).toBe(true);
    expect(c.loans).toEqual([]);
  });

  it('settles the mortgage out of the proceeds of a forced sale', () => {
    const state = newLife(57);
    const c = state.character;
    c.age = 30;
    c.flags.livesWithParents = false;
    c.money = 50000;
    expect(buyAsset(state, REG, 'condo', true)).toEqual({ ok: true });
    // The deposit left 10000; the year then opens with nothing to pay with.
    c.money = 0;

    const entries = financePhase(ctxFor(state));

    expect(texts(entries)).toEqual(['You sold your condo to stay afloat.']);
    expect(c.assets).toEqual([]);
    /* The loan went with the collateral instead of outliving it: a mortgage on a
       house that no longer exists compounds at 6% and takes 15% of the cash on
       hand every year for the rest of the life. */
    expect(c.loans).toEqual([]);
    /* 185400 of proceeds (90% of the 206000 the condo revalued to), less the
       160000 still owed — the balance held rather than compounding, because the
       year opened with no cash to pay an instalment with — less 10060 short. */
    expect(c.money).toBe(15340);
  });

  it('writes off the part of a secured loan a forced sale cannot cover', () => {
    const state = newLife(58);
    const c = state.character;
    c.age = 30;
    c.flags.livesWithParents = false;
    c.money = 0;
    c.assets = [
      { id: 'a1-30', defId: 'condo', label: 'condo', paid: 200000, value: 20000, yearBought: 2020 },
    ];
    c.loans = [{ id: 'l1-30', kind: 'mortgage', principal: 160000, apr: 0, assetId: 'a1-30' }];

    financePhase(ctxFor(state));

    // Same contract as `sellAsset`: the shortfall stays with the asset.
    expect(c.assets).toEqual([]);
    expect(c.loans).toEqual([]);
    expect(c.money).toBe(0);
    expect(c.flags.bankrupt).toBeUndefined();
  });

  it('never leaves a loan behind the collateral it is secured against', () => {
    const state = newLife(59);
    const c = state.character;
    c.age = 30;
    c.flags.livesWithParents = false;
    c.money = 60000;
    expect(buyAsset(state, REG, 'condo', true)).toEqual({ ok: true });
    expect(buyAsset(state, REG, 'sedan', true)).toEqual({ ok: true });
    c.money = 0;

    for (let year = 0; year < 15; year += 1) {
      financePhase(ctxFor(state));
      const held = new Set(c.assets.map((asset) => asset.id));
      for (const loan of c.loans) {
        if (loan.assetId !== undefined) expect(held.has(loan.assetId)).toBe(true);
      }
      c.age += 1;
    }

    expect(c.assets).toEqual([]);
    expect(c.loans).toEqual([]);
  });

  it('says it once across a lifetime of insolvency', () => {
    const state = newLife(56);
    const c = state.character;
    c.money = 0;
    c.stats.happiness = 90;
    c.loans = [{ id: 'l1', kind: 'personal', principal: 30000, apr: 0.05 }];
    const feed: string[] = [];

    for (let age = 18; age <= 98; age += 1) {
      c.age = age;
      feed.push(...texts(financePhase(ctxFor(state))));
    }

    expect(feed.filter((text) => text === 'You went bankrupt.')).toEqual(['You went bankrupt.']);
    // 81 broke years, one grief hit.
    expect(c.stats.happiness).toBe(70);
    expect(c.money).toBe(0);
  });

  it('discharges a debt taken on after a collapse the character never recovered from', () => {
    /* The once-per-life flag only clears on a year that ends with money to
       spare, so a character who never has one was locked out of the only
       terminal state non-student debt has: the balance could not be paid, could
       not grow and was never written off, and `netWorth` was 10000 too low on
       the HUD, the finance sheet and the epitaph for fifty-five years. */
    const state = newLife(91);
    const c = state.character;
    c.age = 40;
    c.money = 0;
    c.stats.happiness = 55;
    c.flags.livesWithParents = false;
    c.flags.bankrupt = true;

    expect(takeLoan(state, REG, 10000)).toEqual({ ok: true });
    c.money = 0;
    const feed: string[] = [];

    for (let age = 40; age <= 94; age += 1) {
      feed.push(...texts(financePhase(ctxFor(state))));
      c.age += 1;
    }

    expect(c.loans).toEqual([]);
    expect(netWorth(state)).toBe(0);
    // Silent and free: the flag still governs the notice and the grief.
    expect(feed).toEqual([]);
    expect(c.stats.happiness).toBe(55);
  });

  it('never calls a lifetime of being broke a bankruptcy when there is nothing to seize', () => {
    const state = newLife(65);
    const c = state.character;
    c.money = 0;
    c.stats.happiness = 90;
    const feed: string[] = [];

    for (let age = 18; age <= 98; age += 1) {
      c.age = age;
      feed.push(...texts(financePhase(ctxFor(state))));
    }

    /* Eighty-one years with no income, no debts and nothing owned: the only
       thing that ever happened is moving out at 22. Charging the collapse here
       put the line in nearly every life, on the eighteenth birthday. */
    expect(feed).toEqual(['You moved out on your own.']);
    expect(c.flags.bankrupt).toBeUndefined();
    expect(c.stats.happiness).toBe(90);
    expect(c.money).toBe(0);
  });
});

/* ---------------------------------------------------------------------------
   Net worth and investment moves
--------------------------------------------------------------------------- */

describe('netWorth', () => {
  it('adds cash, investments and assets, then subtracts debt', () => {
    const state = newLife(27);
    const c = state.character;
    c.money = 100;
    c.investments = { savings: 200, index: 300, crypto: 400 };
    c.assets = [
      { id: 'a1-0', defId: 'condo', label: 'condo', paid: 900, value: 1000, yearBought: 2000 },
    ];
    c.loans = [{ id: 'l1-0', kind: 'personal', principal: 500, apr: 0.09 }];

    expect(netWorth(state)).toBe(1500);
  });

  it('goes negative when the debt is bigger than everything owned', () => {
    const state = newLife(28);
    state.character.money = 10;
    state.character.loans = [{ id: 'l1-0', kind: 'student', principal: 5000, apr: 0.05 }];
    expect(netWorth(state)).toBe(-4990);
  });
});

describe('investment moves', () => {
  it('moves cash in and back out again', () => {
    const state = newLife(29);
    state.character.money = 1000;

    expect(depositInvestment(state, 'index', 400)).toBe(true);
    expect(state.character.money).toBe(600);
    expect(state.character.investments.index).toBe(400);

    expect(withdrawInvestment(state, 'index', 150)).toBe(true);
    expect(state.character.money).toBe(750);
    expect(state.character.investments.index).toBe(250);
  });

  it('refuses amounts the balances cannot cover', () => {
    const state = newLife(30);
    state.character.money = 100;
    state.character.investments = { savings: 50, index: 0, crypto: 0 };

    expect(depositInvestment(state, 'savings', 101)).toBe(false);
    expect(depositInvestment(state, 'savings', 0)).toBe(false);
    expect(depositInvestment(state, 'savings', -20)).toBe(false);
    expect(withdrawInvestment(state, 'savings', 51)).toBe(false);
    expect(withdrawInvestment(state, 'crypto', 1)).toBe(false);
    expect(state.character.money).toBe(100);
    expect(state.character.investments.savings).toBe(50);
  });
});

/* ---------------------------------------------------------------------------
   Borrowing
--------------------------------------------------------------------------- */

describe('takeLoan', () => {
  it('lends up to five years of salary', () => {
    const state = newLife(31);
    state.character.age = 30;
    state.character.job = job(30000);

    expect(takeLoan(state, REG, 150001).ok).toBe(false);
    expect(takeLoan(state, REG, 150000)).toEqual({ ok: true });
    expect(state.character.money).toBe(150000);
    expect(state.character.loans).toEqual([
      { id: 'l1', kind: 'personal', principal: 150000, apr: 0.09 },
    ]);
  });

  it('still lends 10000 to someone with no salary at all', () => {
    const state = newLife(32);
    state.character.age = 30;

    const refused = takeLoan(state, REG, 10001);
    expect(refused.ok).toBe(false);
    expect(refused.reason).toContain('$10,000');
    expect(takeLoan(state, REG, 10000).ok).toBe(true);
  });

  it('caps what the borrower owes in total, not one ticket at a time', () => {
    /* The cap was compared against the amount being asked for and nothing else,
       so `MAX_PERSONAL_LOANS` was the only real brake and the true ceiling was
       *fifteen* years of salary: three maximal loans, in one year, $3,000,000 of
       unsecured credit against the $1,000,000 the header promises. */
    const state = newLife(94);
    const c = state.character;
    c.age = 30;
    c.job = job(200000);

    expect(takeLoan(state, REG, 1000000)).toEqual({ ok: true });
    expect(takeLoan(state, REG, 1000000)).toEqual({
      ok: false,
      reason: 'The bank will only lend you $0.',
    });
    expect(takeLoan(state, REG, 1)).toEqual({
      ok: false,
      reason: 'The bank will only lend you $0.',
    });

    expect(c.money).toBe(1000000);
    expect(c.loans).toHaveLength(1);
  });

  it('lends the headroom that is left, and lends it again once it is repaid', () => {
    const state = newLife(95);
    const c = state.character;
    c.age = 30;
    c.job = job(20000);

    // 100000 of ceiling: 60000 of it goes, so 40000 is what is left to lend.
    expect(takeLoan(state, REG, 60000)).toEqual({ ok: true });
    expect(takeLoan(state, REG, 40001)).toEqual({
      ok: false,
      reason: 'The bank will only lend you $40,000.',
    });
    expect(takeLoan(state, REG, 40000)).toEqual({ ok: true });
    expect(takeLoan(state, REG, 1).ok).toBe(false);

    // Paying it down is what reopens the ceiling, exactly as far as it was paid.
    repayLoan(state, c.loans[0].id, 25000);
    expect(takeLoan(state, REG, 25001).ok).toBe(false);
    expect(takeLoan(state, REG, 25000)).toEqual({ ok: true });
    expect(c.loans.reduce((sum, loan) => sum + loan.principal, 0)).toBe(100000);
  });

  it('counts a mortgage against the same ceiling, and tuition against none of it', () => {
    /* Secured principal is money this same bank is already owed, and `buyAsset`
       opens those without asking for anything at all — leaving them out reopens
       the whole hole through the showroom. Tuition is the other way round: the
       engine issues it to a student who never chose the amount, so counting it
       would leave a graduate unable to borrow for years on the strength of a
       debt they were handed. */
    const state = newLife(96);
    const c = state.character;
    c.age = 30;
    c.job = job(50000);
    c.money = 40000;
    c.loans = [{ id: 'l9', kind: 'student', principal: 88000, apr: 0.05 }];

    // 40000 down on a 200000 condo leaves a 160000 mortgage against a 250000 cap.
    expect(buyAsset(state, REG, 'condo', true)).toEqual({ ok: true });
    expect(c.money).toBe(0);

    expect(takeLoan(state, REG, 90001)).toEqual({
      ok: false,
      reason: 'The bank will only lend you $90,000.',
    });
    expect(takeLoan(state, REG, 90000)).toEqual({ ok: true });
    expect(c.money).toBe(90000);
  });

  it('refuses a fourth personal loan', () => {
    const state = newLife(33);
    state.character.age = 30;

    for (let i = 0; i < 3; i += 1) expect(takeLoan(state, REG, 1000).ok).toBe(true);
    const fourth = takeLoan(state, REG, 1000);

    expect(fourth.ok).toBe(false);
    expect(state.character.loans).toHaveLength(3);
    expect(state.character.money).toBe(3000);
  });

  it('refuses to lend to anyone under 18, whatever the cap would allow', () => {
    const state = newLife(76);
    const before = state.log[state.log.length - 1].entries.length;

    /* Every other action the player drives gates itself on age — `buyAsset`,
       `emigrateTo`, `commitCrime`, `canUse` — and the engine cannot lean on the
       UI to gate this one. Without it a three-year-old could take the bank's
       floor of 10000 three times over and end up owing 30000. */
    for (const age of [0, 3, 10, 15, 17]) {
      state.character.age = age;
      expect(takeLoan(state, REG, 10000)).toEqual({
        ok: false,
        reason: 'You must be 18 to borrow.',
      });
    }

    // A refusal touches nothing: no debt, no cash, no line in the feed.
    expect(state.character.loans).toEqual([]);
    expect(state.character.money).toBe(0);
    expect(state.log[state.log.length - 1].entries).toHaveLength(before);

    state.character.age = 18;
    expect(takeLoan(state, REG, 10000)).toEqual({ ok: true });
    expect(state.character.money).toBe(10000);
  });

  it('refuses amounts that are not money', () => {
    const state = newLife(34);
    state.character.age = 30;

    expect(takeLoan(state, REG, 0).ok).toBe(false);
    expect(takeLoan(state, REG, -500).ok).toBe(false);
    expect(takeLoan(state, REG, Number.NaN).ok).toBe(false);
    expect(state.character.loans).toEqual([]);
  });

  it('logs the borrowing into the current year', () => {
    const state = newLife(35);
    state.character.age = 30;
    takeLoan(state, REG, 5000);

    expect(state.log[state.log.length - 1].entries.slice(-1)).toEqual([
      { icon: '🏦', kind: 'money', text: 'You borrowed $5,000.' },
    ]);
  });
});

describe('repayLoan', () => {
  it('pays down the principal by what is asked', () => {
    const state = newLife(36);
    state.character.money = 5000;
    state.character.loans = [{ id: 'l1-0', kind: 'personal', principal: 4000, apr: 0.09 }];

    repayLoan(state, 'l1-0', 1500);

    expect(state.character.loans[0].principal).toBe(2500);
    expect(state.character.money).toBe(3500);
  });

  it('caps the payment at the cash on hand and at the principal', () => {
    const state = newLife(37);
    state.character.money = 300;
    state.character.loans = [{ id: 'l1-0', kind: 'personal', principal: 4000, apr: 0.09 }];
    repayLoan(state, 'l1-0', 9999);
    expect(state.character.money).toBe(0);
    expect(state.character.loans[0].principal).toBe(3700);

    const rich = newLife(38);
    rich.character.money = 5000;
    rich.character.loans = [{ id: 'l1-0', kind: 'auto', principal: 1200, apr: 0.09 }];
    repayLoan(rich, 'l1-0', 9999);
    expect(rich.character.money).toBe(3800);
    expect(rich.character.loans).toEqual([]);
    expect(rich.log[rich.log.length - 1].entries.slice(-1)).toEqual([
      { icon: '✅', kind: 'good', text: 'You paid off your auto loan.' },
    ]);
  });

  it('ignores an unknown loan and a payment of nothing', () => {
    const state = newLife(39);
    state.character.money = 500;
    state.character.loans = [{ id: 'l1-0', kind: 'personal', principal: 400, apr: 0.09 }];

    repayLoan(state, 'nope', 100);
    repayLoan(state, 'l1-0', 0);

    expect(state.character.money).toBe(500);
    expect(state.character.loans[0].principal).toBe(400);
  });
});

/* ---------------------------------------------------------------------------
   Buying and selling
--------------------------------------------------------------------------- */

describe('buyAsset', () => {
  it('buys outright and books the asset at its price', () => {
    const state = newLife(40);
    state.character.age = 30;
    state.character.money = 250000;
    state.character.stats.happiness = 50;

    expect(buyAsset(state, REG, 'condo')).toEqual({ ok: true });
    const c = state.character;

    expect(c.money).toBe(50000);
    expect(c.assets).toEqual([
      {
        id: 'a1',
        defId: 'condo',
        label: 'condo',
        paid: 200000,
        value: 200000,
        yearBought: 2000,
      },
    ]);
    expect(c.loans).toEqual([]);
    expect(c.stats.happiness).toBe(58);
    expect(state.log[state.log.length - 1].entries.slice(-1)).toEqual([
      { icon: '🏢', kind: 'money', text: 'You bought a condo for $200,000.' },
    ]);
  });

  it('takes a 20% deposit and a 6% mortgage on a property', () => {
    const state = newLife(41);
    state.character.age = 30;
    state.character.money = 50000;

    expect(buyAsset(state, REG, 'condo', true)).toEqual({ ok: true });
    const c = state.character;

    expect(c.money).toBe(10000);
    expect(c.loans).toEqual([
      { id: 'l1', kind: 'mortgage', principal: 160000, apr: 0.06, assetId: 'a1' },
    ]);
  });

  it('takes a 30% deposit and a 9% loan on a vehicle', () => {
    const state = newLife(42);
    state.character.age = 30;
    state.character.money = 10000;

    expect(buyAsset(state, REG, 'sedan', true)).toEqual({ ok: true });
    const c = state.character;

    expect(c.money).toBe(4000);
    expect(c.loans).toEqual([
      { id: 'l1', kind: 'auto', principal: 14000, apr: 0.09, assetId: 'a1' },
    ]);
  });

  it('refuses what the character cannot pay for', () => {
    const state = newLife(43);
    state.character.age = 30;
    state.character.money = 39999;

    expect(buyAsset(state, REG, 'condo').ok).toBe(false);
    const short = buyAsset(state, REG, 'condo', true);
    expect(short.ok).toBe(false);
    expect(short.reason).toContain('$40,000');
    expect(state.character.assets).toEqual([]);
    expect(state.character.loans).toEqual([]);
  });

  it('gates on age: 18 for property, 16 for vehicles, and whatever a def asks for', () => {
    const teen = newLife(44);
    teen.character.age = 15;
    teen.character.money = 5000000;
    expect(buyAsset(teen, REG, 'scooter').ok).toBe(false);
    expect(buyAsset(teen, REG, 'condo').ok).toBe(false);

    teen.character.age = 16;
    expect(buyAsset(teen, REG, 'scooter').ok).toBe(true);
    expect(buyAsset(teen, REG, 'condo').ok).toBe(false);

    teen.character.age = 18;
    expect(buyAsset(teen, REG, 'condo').ok).toBe(true);
    expect(buyAsset(teen, REG, 'estate').ok).toBe(false);

    teen.character.age = 30;
    expect(buyAsset(teen, REG, 'estate').ok).toBe(true);
  });

  it('refuses an asset the registry does not list', () => {
    const state = newLife(45);
    state.character.age = 30;
    state.character.money = 100000;
    expect(buyAsset(state, REG, 'yacht')).toEqual({ ok: false, reason: 'That is not for sale.' });
  });
});

describe('sellAsset', () => {
  it('pays out the resale value and clears the loan secured against it', () => {
    const state = newLife(46);
    state.character.age = 30;
    state.character.money = 50000;
    buyAsset(state, REG, 'condo', true);

    sellAsset(state, 'a1');
    const c = state.character;

    /* 10000 left after the deposit, plus 180000 of proceeds — 90% of the value,
       because a trade costs the spread — less the 160000 owed. Refunding the
       whole 200000 made the round trip exactly cash-neutral. */
    expect(c.money).toBe(30000);
    expect(c.assets).toEqual([]);
    expect(c.loans).toEqual([]);
    expect(state.log[state.log.length - 1].entries.slice(-1)).toEqual([
      { icon: '💵', kind: 'money', text: 'You sold your condo for $180,000.' },
    ]);
  });

  it('writes off what the proceeds cannot cover', () => {
    const state = newLife(47);
    state.character.age = 30;
    state.character.money = 0;
    state.character.assets = [
      { id: 'a1-30', defId: 'condo', label: 'condo', paid: 200000, value: 100000, yearBought: 2000 },
    ];
    state.character.loans = [
      { id: 'l1-30', kind: 'mortgage', principal: 160000, apr: 0.06, assetId: 'a1-30' },
    ];

    sellAsset(state, 'a1-30');

    expect(state.character.money).toBe(0);
    expect(state.character.loans).toEqual([]);
  });

  it('leaves an unsecured sale alone and ignores an unknown asset', () => {
    const state = newLife(48);
    state.character.age = 30;
    state.character.money = 1000;
    state.character.assets = [
      { id: 'a1-30', defId: 'sedan', label: 'sedan', paid: 20000, value: 9000, yearBought: 2000 },
    ];
    state.character.loans = [{ id: 'l1-30', kind: 'personal', principal: 500, apr: 0.09 }];

    sellAsset(state, 'nope');
    expect(state.character.assets).toHaveLength(1);

    sellAsset(state, 'a1-30');
    // 1000 in hand plus 8100: 90% of the 9000 the sedan is now worth.
    expect(state.character.money).toBe(9100);
    expect(state.character.loans).toHaveLength(1);
  });
});

describe('buying and selling the same year', () => {
  it('pays the purchase joy once a year however many times the player buys', () => {
    const state = newLife(92);
    const c = state.character;
    c.age = 30;
    c.money = 1000000;
    c.stats.happiness = 20;

    for (let round = 0; round < 20; round += 1) {
      expect(buyAsset(state, REG, 'scooter')).toEqual({ ok: true });
      sellAsset(state, c.assets[0].id);
    }

    /* Twenty round trips inside one year used to be a free ride from 20 to the
       cap: the joy had no cooldown and no limit, and the sale refunded the whole
       value, so the cash came back too. Happiness is charged for everywhere else
       in the engine (`WORK_HARD_HAPPINESS`, `STUDY_HAPPINESS_COST`, the grief
       above) and it holds a romance together and goes on the epitaph. */
    expect(c.stats.happiness).toBe(28);
    // And the churn is not free either: 200 a round, the spread on the resale.
    expect(c.money).toBe(1000000 - 20 * 200);
    expect(c.assets).toEqual([]);
    expect(c.loans).toEqual([]);

    // A purchase is still rewarding — once a year, not once a click.
    c.age = 31;
    expect(buyAsset(state, REG, 'scooter')).toEqual({ ok: true });
    expect(c.stats.happiness).toBe(36);
    expect(buyAsset(state, REG, 'scooter')).toEqual({ ok: true });
    expect(c.stats.happiness).toBe(36);
  });

  it('leaves a financed round trip out of pocket instead of exactly where it started', () => {
    const state = newLife(93);
    const c = state.character;
    c.age = 30;
    // Exactly the 30% down payment on a sedan, and nothing else.
    c.money = 6000;
    c.stats.happiness = 20;

    for (let round = 0; round < 20; round += 1) {
      buyAsset(state, REG, 'sedan', true);
      const held = c.assets[0];
      if (held) sellAsset(state, held.id);
    }

    /* The secured loan is settled out of the proceeds and the deposit came back
       whole, so the loop returned the exact 6000 it started with and could run
       for ever. It now costs the spread, and the second round cannot even be
       afforded. */
    expect(c.money).toBeLessThan(6000);
    expect(c.money).toBe(4000);
    expect(c.stats.happiness).toBe(28);
    expect(c.assets).toEqual([]);
    expect(c.loans).toEqual([]);
  });
});

/* ---------------------------------------------------------------------------
   Generated ids
--------------------------------------------------------------------------- */

describe('generated ids', () => {
  it('ids stay unique when a non-last loan is repaid and another is taken the same year', () => {
    const state = newLife(51);
    const c = state.character;
    c.age = 30;
    c.money = 0;
    // A salary the borrowing cap has room inside; this is about ids, not limits.
    c.job = job(50000);

    expect(takeLoan(state, REG, 10000).ok).toBe(true);
    expect(takeLoan(state, REG, 10000).ok).toBe(true);
    const [first, second] = c.loans.map((loan) => loan.id);
    expect(first).not.toBe(second);

    // The first loan goes; the second is still owed in full.
    repayLoan(state, first, 10000);
    expect(c.loans).toEqual([{ id: second, kind: 'personal', principal: 10000, apr: 0.09 }]);
    expect(c.money).toBe(10000);

    expect(takeLoan(state, REG, 5000).ok).toBe(true);
    const third = c.loans[1].id;
    expect(third).not.toBe(second);
    expect(third).not.toBe(first);
    expect(c.money).toBe(15000);

    // Settling the older debt must leave the newer one standing, principal intact.
    repayLoan(state, second, 10000);
    expect(c.money).toBe(5000);
    expect(c.loans).toEqual([{ id: third, kind: 'personal', principal: 5000, apr: 0.09 }]);
  });

  it('ids stay unique when an asset is sold and another bought the same year', () => {
    const state = newLife(52);
    const c = state.character;
    c.age = 30;
    c.money = 2000000;

    expect(buyAsset(state, REG, 'sedan').ok).toBe(true);
    expect(buyAsset(state, REG, 'condo', true).ok).toBe(true);
    const [sedanId, condoId] = c.assets.map((asset) => asset.id);
    const mortgage = c.loans[0];
    expect(mortgage.assetId).toBe(condoId);

    sellAsset(state, sedanId);
    expect(c.assets.map((asset) => asset.label)).toEqual(['condo']);

    expect(buyAsset(state, REG, 'estate').ok).toBe(true);
    const estateId = c.assets[1].id;
    expect(estateId).not.toBe(condoId);
    expect(estateId).not.toBe(sedanId);

    // Selling the estate pays out the estate and touches nothing else.
    const before = c.money;
    sellAsset(state, estateId);

    expect(c.money).toBe(before + 900000);
    expect(c.assets.map((asset) => asset.label)).toEqual(['condo']);
    expect(c.loans).toEqual([mortgage]);
    expect(c.loans[0].principal).toBe(160000);
  });

  it('never reuses an id across a run of buying, borrowing and selling', () => {
    const state = newLife(53);
    const c = state.character;
    c.age = 30;
    c.job = job(200000);
    const loanIds: string[] = [];
    const assetIds: string[] = [];

    // Eight rounds inside one year: the counters must not restart with the arrays.
    for (let round = 0; round < 8; round += 1) {
      c.money = 500000;
      expect(takeLoan(state, REG, 1000).ok).toBe(true);
      expect(buyAsset(state, REG, 'sedan', true).ok).toBe(true);
      for (const loan of c.loans) loanIds.push(loan.id);
      for (const asset of c.assets) assetIds.push(asset.id);
      for (const asset of [...c.assets]) sellAsset(state, asset.id);
      c.loans = [];
    }

    expect(loanIds).toHaveLength(16);
    expect(assetIds).toHaveLength(8);
    expect(new Set([...loanIds, ...assetIds]).size).toBe(24);
  });
});

/* ---------------------------------------------------------------------------
   Whole years
--------------------------------------------------------------------------- */

describe('a run of finance years', () => {
  it('replays identically from the same cursor', () => {
    const play = (): string => {
      const state = newLife(49);
      state.character.age = 30;
      state.character.money = 120000;
      state.character.investments = { savings: 1000, index: 20000, crypto: 5000 };
      state.rngState = initialRngState(1234);
      state.character.job = job(80000);
      for (let year = 0; year < 20; year += 1) {
        financePhase(ctxFor(state));
        state.character.age += 1;
      }
      return JSON.stringify(state.character);
    };
    expect(play()).toBe(play());
  });

  it('says nothing at all in a quiet year', () => {
    const state = newLife(50);
    state.character.age = 30;
    state.character.flags.livesWithParents = false;
    state.character.money = 500000;
    state.character.job = job(90000);

    expect(financePhase(ctxFor(state))).toEqual([]);
  });
});

/* ---------------------------------------------------------------------------
   Financing a degree
--------------------------------------------------------------------------- */

const UNI: SchoolDef = {
  id: 'sch-u',
  label: 'State University',
  level: 'university',
  years: 4,
  tuitionPerYear: 15000,
};

/** The finance registry plus one university, so tuition can actually be billed. */
function campusRegistry(): ContentRegistry {
  const reg = registry();
  reg.schools = [UNI];
  reg.schoolsById[UNI.id] = UNI;
  return reg;
}

/** An undergraduate with nothing to their name, one year into the degree. */
function undergraduate(seed: number, reg: ContentRegistry): { state: GameState; ctx: Ctx } {
  const state = createLife(reg, { seed, countryId: 'us', startYear: 2000 });
  state.people = {};
  const c = state.character;
  c.age = 19;
  c.money = 0;
  c.stats.happiness = 82;
  c.education = { level: 'high', enrolledIn: UNI.id, year: 0, gpa: 3, studyHard: false };
  return { state, ctx: { state, c, rng: createRng(state), reg } };
}

describe('a degree paid for on credit', () => {
  it('does not bankrupt the undergraduate it just lent the tuition to', () => {
    const reg = campusRegistry();
    const { state, ctx } = undergraduate(600, reg);
    const c = state.character;

    const schooling = educationPhase(ctx);
    expect(texts(schooling)).toEqual(['You took a student loan.']);
    expect(c.loans).toEqual([{ id: 'l1', kind: 'student', principal: 15000, apr: 0.05 }]);

    const money = financePhase(ctx);

    /* The same year that financed the first year of the degree used to end with
       'You went bankrupt.', 20 points of grief and the tuition written off. */
    expect(texts(money)).toEqual([]);
    expect(c.flags.bankrupt).toBeUndefined();
    expect(c.stats.happiness).toBe(82);
    expect(c.money).toBe(0);
    /* The debt stands in full, with nothing paid off it and nothing added to it:
       an undergraduate with no cash cannot pay an instalment, and interest an
       instalment never reached is forborne rather than capitalised. The next
       school year adds its own tuition to this same debt. */
    expect(c.loans).toEqual([{ id: 'l1', kind: 'student', principal: 15000, apr: 0.05 }]);
  });

  it('holds the tuition of a student who is paying their own way with nothing', () => {
    const reg = campusRegistry();
    const { state, ctx } = undergraduate(602, reg);
    const c = state.character;
    // Out of the family home: nobody is keeping them, and there is no job yet.
    c.flags.livesWithParents = false;

    expect(texts(educationPhase(ctx))).toEqual(['You took a student loan.']);
    const money = financePhase(ctx);

    /* The other side of the household line drawn above. This year ends 20000
       short with no pot, no asset and no wage, so nothing can reach the loan —
       and tuition is not an estate to seize, so bankruptcy will not clear it
       either. Compounding it here is what put a graduate seven figures under. */
    expect(c.loans).toEqual([{ id: 'l1', kind: 'student', principal: 15000, apr: 0.05 }]);
    expect(texts(money)).toEqual([]);
    expect(c.flags.bankrupt).toBeUndefined();
    expect(c.money).toBe(0);
  });

  it('carries one debt through the degree and pays it off exactly once', () => {
    const reg = campusRegistry();
    const { state, ctx } = undergraduate(601, reg);
    const c = state.character;
    const feed: string[] = [];

    for (let year = 0; year < 4; year += 1) {
      feed.push(...texts(educationPhase(ctx)));
      feed.push(...texts(financePhase(ctx)));
      c.age += 1;
    }

    expect(c.education.level).toBe('university');
    // One debt for one degree, not one record per school year.
    expect(c.loans).toHaveLength(1);
    /* The graduating year is also the year the character leaves home and starts
       paying rent with no income yet — the year the collapse used to move to
       once the student years stopped ending short. It is quiet too. */
    expect(feed).toEqual([
      'You took a student loan.',
      'You earned your State University degree.',
      'You moved out on your own.',
    ]);
    expect(c.flags.bankrupt).toBeUndefined();

    // A graduate with a job clears the debt, and the feed says so once.
    c.job = job(400000);
    for (let year = 0; year < 40 && c.loans.length > 0; year += 1) {
      feed.push(...texts(financePhase(ctx)));
      c.age += 1;
    }

    expect(c.loans).toEqual([]);
    expect(feed.filter((text) => text === 'You paid off your student loan.')).toEqual([
      'You paid off your student loan.',
    ]);
  });
});

/* ---------------------------------------------------------------------------
   Content numbers that are not numbers
--------------------------------------------------------------------------- */

/** The finance registry plus one deliberately broken def of some kind. */
function brokenRegistry(country?: Partial<CountryDef>, asset?: Partial<AssetDef>): ContentRegistry {
  const reg = registry();
  if (country) {
    const def: CountryDef = {
      id: 'broken',
      label: 'Broken',
      flag: '❓',
      costMult: 1,
      taxMult: 1,
      visaDifficulty: 0.5,
      ...country,
    };
    reg.countries = [...reg.countries, def];
    reg.countriesById[def.id] = def;
  }
  if (asset) {
    const def: AssetDef = {
      id: 'mystery',
      type: 'vehicle',
      label: 'mystery',
      icon: '❓',
      price: 1000,
      upkeepPct: 0.05,
      apprPct: -0.1,
      ...asset,
    };
    reg.assets = [...reg.assets, def];
    reg.assetsById[def.id] = def;
  }
  return reg;
}

function ctxIn(state: GameState, reg: ContentRegistry): Ctx {
  return { state, c: state.character, rng: createRng(state), reg };
}

describe('a balance sheet a broken content number cannot poison', () => {
  it('earns nothing from a salary that is not a number, rather than losing the balance', () => {
    /* `Math.max(0, NaN)` is NaN, so a single unreadable number anywhere in the
       year used to turn `character.money` into NaN with no way back — and from
       there into `Loan.principal`, `netWorth`, the finance sheet and the
       epitaph. Content packs author every one of these by hand. */
    for (const salary of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const state = newLife(130);
      const c = state.character;
      c.age = 17;
      c.money = 1000;
      c.job = job(salary);

      financePhase(ctxFor(state));

      expect(c.money).toBe(1000);
      expect(Number.isFinite(c.money)).toBe(true);
    }
  });

  it('treats a country whose multipliers are unreadable as an ordinary one', () => {
    const costly = newLife(131);
    costly.character.age = 30;
    costly.character.countryId = 'broken';
    costly.character.flags.livesWithParents = false;
    costly.character.money = 50000;
    financePhase(ctxIn(costly, brokenRegistry({ costMult: Number.NaN })));
    // Falls back to a multiplier of 1: 8000 of living plus 12000 of rent.
    expect(costly.character.money).toBe(30000);

    const taxed = newLife(132);
    taxed.character.age = 17;
    taxed.character.countryId = 'broken';
    taxed.character.money = 0;
    taxed.character.job = job(40000);
    financePhase(ctxIn(taxed, brokenRegistry({ taxMult: Number.NaN })));
    expect(taxed.character.money).toBe(33000);
  });

  it('holds an asset whose rates are unreadable at the value it had', () => {
    const state = newLife(133);
    const c = state.character;
    c.age = 17;
    c.money = 10000;
    c.assets = [
      { id: 'a1', defId: 'mystery', label: 'mystery', paid: 4000, value: 4000, yearBought: 2020 },
    ];

    financePhase(ctxIn(state, brokenRegistry(undefined, { apprPct: Number.NaN, upkeepPct: Number.NaN })));

    // The same answer a missing def gets: hold the value, charge the 1% default.
    expect(c.assets[0].value).toBe(4000);
    expect(c.money).toBe(9960);
    expect(netWorth(state)).toBe(13960);
  });

  it('heals a balance that arrived unreadable, and never passes it to the loans', () => {
    /* The contagion case: a poisoned balance used to make `settleLoans` compute
       `Math.min(principal, owed - NaN)`, so the debt went NaN too and `netWorth`
       with it. The year now starts by healing the balance to zero, exactly as a
       stat heals in `clampStat`. */
    const state = newLife(134);
    const c = state.character;
    c.age = 17;
    c.money = Number.NaN;
    c.loans = [{ id: 'l1', kind: 'personal', principal: 5000, apr: 0.09 }];

    financePhase(ctxFor(state));

    expect(c.money).toBe(0);
    expect(c.loans).toEqual([{ id: 'l1', kind: 'personal', principal: 5000, apr: 0.09 }]);
    expect(netWorth(state)).toBe(-5000);
    expect(Number.isFinite(netWorth(state))).toBe(true);
  });

  it('refuses an asset with no readable price instead of selling it for nothing', () => {
    /* `c.money < down` is false for NaN, so the affordability gate failed
       *open*: an unpriceable def was affordable to everyone, always, and booked
       an asset worth NaN against a balance of NaN. */
    for (const price of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const state = newLife(135);
      const c = state.character;
      c.age = 30;
      c.money = 5000;
      const reg = brokenRegistry(undefined, { price });

      expect(buyAsset(state, reg, 'mystery')).toEqual({ ok: false, reason: 'That is not for sale.' });
      expect(buyAsset(state, reg, 'mystery', true)).toEqual({
        ok: false,
        reason: 'That is not for sale.',
      });
      expect(c.money).toBe(5000);
      expect(c.assets).toEqual([]);
      expect(c.loans).toEqual([]);
      // A refusal touches nothing at all, the happiness of a purchase included.
      expect(c.flags.lastPurchaseJoyAge).toBeUndefined();
    }
  });
});

/* ---------------------------------------------------------------------------
   A finished life
--------------------------------------------------------------------------- */

describe('money actions after death', () => {
  it('refuses every one of them and leaves the estate exactly as it was', () => {
    const state = newLife(60);
    const c = state.character;
    c.age = 40;
    c.flags.livesWithParents = false;
    c.money = 200000;
    c.investments = { savings: 5000, index: 0, crypto: 0 };
    expect(buyAsset(state, REG, 'sedan')).toEqual({ ok: true });
    expect(takeLoan(state, REG, 5000)).toEqual({ ok: true });
    const assetId = c.assets[0].id;
    const loanId = c.loans[0].id;

    killCharacter(state, REG, 'a heart attack');
    const character = JSON.stringify(c);
    const cursor = state.rngState;
    const feed = state.log[state.log.length - 1].entries.length;
    const epitaph = state.death?.epitaphStats.netWorth;

    expect(takeLoan(state, REG, 50000)).toEqual({ ok: false, reason: 'Your life is over.' });
    expect(buyAsset(state, REG, 'condo')).toEqual({ ok: false, reason: 'Your life is over.' });
    expect(depositInvestment(state, 'index', 1000)).toBe(false);
    expect(withdrawInvestment(state, 'savings', 1000)).toBe(false);
    repayLoan(state, loanId, 1000);
    sellAsset(state, assetId);

    expect(JSON.stringify(c)).toBe(character);
    expect(state.rngState).toBe(cursor);
    // Nothing was appended after the death line either.
    expect(state.log[state.log.length - 1].entries).toHaveLength(feed);
    /* The death screen quotes `epitaphStats`, the character sheet quotes the
       character: an action that survived death would set the two at odds. */
    expect(netWorth(state)).toBe(epitaph);
  });
});
