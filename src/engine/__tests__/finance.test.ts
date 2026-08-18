import { describe, expect, it } from 'vitest';
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
  LogEntry,
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
  it('compounds the principal, then takes 15% of it out of cash', () => {
    const state = newLife(15);
    state.character.age = 17;
    state.character.money = 50000;
    state.character.loans = [{ id: 'l1-17', kind: 'personal', principal: 10000, apr: 0.09 }];

    financePhase(ctxFor(state));

    // 10000 -> 10900, of which 1635 is paid.
    expect(state.character.loans[0].principal).toBe(9265);
    expect(state.character.money).toBe(48365);
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
    expect(state.character.money).toBe(8840);
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
    // Investments survive the wipe.
    expect(c.investments.savings).toBe(4080);
  });

  it('never leaves the balance below zero', () => {
    const state = newLife(26);
    state.character.age = 30;
    state.character.flags.livesWithParents = false;
    state.character.money = 100;

    financePhase(ctxFor(state));

    expect(state.character.money).toBe(0);
    expect(state.character.flags.bankrupt).toBe(true);
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
      { id: 'l1-30', kind: 'personal', principal: 150000, apr: 0.09 },
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

  it('refuses a fourth personal loan', () => {
    const state = newLife(33);
    state.character.age = 30;

    for (let i = 0; i < 3; i += 1) expect(takeLoan(state, REG, 1000).ok).toBe(true);
    const fourth = takeLoan(state, REG, 1000);

    expect(fourth.ok).toBe(false);
    expect(state.character.loans).toHaveLength(3);
    expect(state.character.money).toBe(3000);
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
        id: 'a1-30',
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
      { id: 'l1-30', kind: 'mortgage', principal: 160000, apr: 0.06, assetId: 'a1-30' },
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
      { id: 'l1-30', kind: 'auto', principal: 14000, apr: 0.09, assetId: 'a1-30' },
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
  it('pays out the current value and clears the loan secured against it', () => {
    const state = newLife(46);
    state.character.age = 30;
    state.character.money = 50000;
    buyAsset(state, REG, 'condo', true);

    sellAsset(state, 'a1-30');
    const c = state.character;

    // 10000 left after the deposit, plus 200000 of proceeds, less the 160000 owed.
    expect(c.money).toBe(50000);
    expect(c.assets).toEqual([]);
    expect(c.loans).toEqual([]);
    expect(state.log[state.log.length - 1].entries.slice(-1)).toEqual([
      { icon: '💵', kind: 'money', text: 'You sold your condo for $200,000.' },
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
    expect(state.character.money).toBe(10000);
    expect(state.character.loans).toHaveLength(1);
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
