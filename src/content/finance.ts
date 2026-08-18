import type { ContentPack, Ctx, EventDef } from '@/types';

/**
 * Money events: the letters, bills and windfalls that move a balance without
 * the player asking for it.
 *
 * Every condition here runs against whatever `GameState` the engine is holding —
 * a fresh life, a save from an older build, a year that started in a cell — so
 * nothing below reads anything it has not proved exists first. Only
 * `Character` fields the type guarantees (`age`, `money`, `prison`, `flags`) are
 * touched, and the flags are read through the widened helpers at the top.
 *
 * Almost everything asks `free`: the prison pack owns those years, and a
 * cold-snap heating bill or a side hustle from a cell reads as a bug.
 */

/* ------------------------------------------------------------------ */
/* Lookups                                                             */
/* ------------------------------------------------------------------ */

/** Not behind bars. Asked by everything that happens out in the world. */
function free(ctx: Ctx): boolean {
  return ctx.c.prison === null;
}

/** Paying their own bills: nobody's spare room, so a utility spike lands. */
function payingOwnBills(ctx: Ctx): boolean {
  return ctx.c.prison === null && ctx.c.flags.livesWithParents !== true;
}

/** Has this much cash on hand right now; used to hide a stake nobody can cover. */
function affords(amount: number): (ctx: Ctx) => boolean {
  return (ctx: Ctx): boolean => ctx.c.money >= amount;
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

const events: EventDef[] = [
  {
    id: 'ev-fin-tax-audit',
    area: 'money',
    icon: '🧾',
    minAge: 21,
    maxAge: 80,
    weight: 3,
    condition: free,
    text: "A letter from the tax office. They'd like a word about last year.",
    choices: [
      {
        label: 'Hire an accountant',
        outcomes: [
          {
            weight: 5,
            text: 'She charged $900 and found deductions worth more than that. Case closed.',
            effects: [
              { kind: 'money', delta: 700 },
              { kind: 'stat', stat: 'happiness', delta: 4 },
            ],
          },
          {
            weight: 4,
            text: 'The accountant cost $900 and the office still wanted its $1,500.',
            effects: [
              { kind: 'money', delta: -2400 },
              { kind: 'stat', stat: 'happiness', delta: -5 },
            ],
          },
          {
            weight: 2,
            text: 'He filed one form you had never heard of and the audit evaporated.',
            effects: [
              { kind: 'money', delta: -900 },
              { kind: 'stat', stat: 'happiness', delta: 2 },
              { kind: 'stat', stat: 'smarts', delta: 2 },
            ],
          },
        ],
      },
      {
        label: 'Wing it',
        outcomes: [
          {
            weight: 4,
            text: 'You arrived with a shoebox of receipts and walked out clean.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 6 },
              { kind: 'stat', stat: 'smarts', delta: 1 },
            ],
          },
          {
            weight: 5,
            text: "They found the year you 'forgot'. The bill came with interest.",
            effects: [
              { kind: 'money', delta: -3200 },
              { kind: 'stat', stat: 'happiness', delta: -7 },
            ],
          },
          {
            weight: 2,
            text: 'The auditor found their own mistake and refunded you on the spot.',
            effects: [
              { kind: 'money', delta: 1100 },
              { kind: 'stat', stat: 'happiness', delta: 5 },
            ],
          },
        ],
      },
    ],
  },

  {
    id: 'ev-fin-bank-error',
    area: 'money',
    icon: '🏦',
    minAge: 18,
    maxAge: 95,
    weight: 3,
    condition: free,
    text: "Your balance is $4,000 heavier than it should be. The bank hasn't noticed.",
    choices: [
      {
        label: 'Say nothing',
        outcomes: [
          {
            weight: 5,
            text: 'Nobody ever came looking. You never spent it all in one place.',
            effects: [
              { kind: 'money', delta: 4000 },
              { kind: 'stat', stat: 'happiness', delta: 5 },
              { kind: 'flag', flag: 'fin:bankError', value: true },
            ],
          },
          {
            weight: 3,
            text: 'The quarterly sweep caught it. They took it back and charged you for the trouble.',
            effects: [
              { kind: 'money', delta: -350 },
              { kind: 'stat', stat: 'happiness', delta: -6 },
            ],
          },
          {
            weight: 2,
            text: "A very polite lawyer explained what 'theft by finding' means.",
            effects: [
              { kind: 'money', delta: -1500 },
              { kind: 'stat', stat: 'happiness', delta: -9 },
              { kind: 'flag', flag: 'fin:bankError', value: true },
            ],
          },
        ],
      },
      {
        label: 'Report it',
        outcomes: [
          {
            weight: 5,
            text: 'The teller called you a rare bird. Head office sent a $200 gift card.',
            effects: [
              { kind: 'money', delta: 200 },
              { kind: 'stat', stat: 'happiness', delta: 7 },
            ],
          },
          {
            weight: 3,
            text: 'Nobody thanked you. You slept fine anyway.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: 5 }],
          },
        ],
      },
    ],
  },

  {
    id: 'ev-fin-crypto-craze',
    area: 'money',
    icon: '🪙',
    minAge: 18,
    maxAge: 85,
    weight: 4,
    condition: free,
    text: 'Everyone at work is talking about a coin named after a frog.',
    choices: [
      {
        label: 'Dump $2,000 in',
        condition: affords(2000),
        outcomes: [
          {
            weight: 2,
            text: "It 5x'd in a month and you sold near the top, entirely by accident.",
            effects: [
              { kind: 'money', delta: 8000 },
              { kind: 'stat', stat: 'happiness', delta: 10 },
              { kind: 'flag', flag: 'fin:cryptoWin', value: true },
            ],
          },
          {
            weight: 3,
            text: 'It doubled, halved, doubled and halved. You got out exactly even.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: 1 }],
          },
          {
            weight: 3,
            text: 'A slow bleed all year. You sold for half and stopped checking.',
            effects: [
              { kind: 'money', delta: -1000 },
              { kind: 'stat', stat: 'happiness', delta: -4 },
            ],
          },
          {
            weight: 5,
            text: 'The frog rugged. Your $2,000 is a screenshot now.',
            effects: [
              { kind: 'money', delta: -2000 },
              { kind: 'stat', stat: 'happiness', delta: -8 },
              { kind: 'stat', stat: 'smarts', delta: 2 },
            ],
          },
        ],
      },
      {
        label: 'Stay boring',
        outcomes: [
          {
            weight: 5,
            text: 'Boring compounded quietly in the index fund. You will take it.',
            effects: [
              { kind: 'money', delta: 300 },
              { kind: 'stat', stat: 'happiness', delta: 2 },
            ],
          },
          {
            weight: 3,
            text: 'It mooned without you. You read the headline twice.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: -4 }],
          },
        ],
      },
    ],
  },

  {
    id: 'ev-fin-identity-theft',
    area: 'money',
    icon: '🕵️',
    minAge: 18,
    maxAge: 95,
    weight: 2,
    oncePerLife: true,
    condition: free,
    text: 'Someone opened three credit cards in your name and bought a jet ski.',
    effects: [
      { kind: 'money', delta: -2500 },
      { kind: 'stat', stat: 'happiness', delta: -8 },
      { kind: 'flag', flag: 'fin:identityTheft', value: true },
    ],
  },

  {
    id: 'ev-fin-side-hustle',
    area: 'money',
    icon: '💡',
    minAge: 16,
    maxAge: 75,
    weight: 4,
    condition: free,
    text: 'You had an idea at 2am that still looked good at breakfast.',
    choices: [
      {
        label: 'Build it on weekends',
        outcomes: [
          {
            weight: 4,
            text: 'It cleared $4,000 and cost you every Saturday for a year.',
            effects: [
              { kind: 'money', delta: 4000 },
              { kind: 'stat', stat: 'happiness', delta: 3 },
              { kind: 'stat', stat: 'health', delta: -3 },
              { kind: 'flag', flag: 'fin:sideHustle', value: true },
            ],
          },
          {
            weight: 4,
            text: 'It made beer money and forty browser tabs you never closed.',
            effects: [
              { kind: 'money', delta: 600 },
              { kind: 'stat', stat: 'smarts', delta: 2 },
            ],
          },
          {
            weight: 3,
            text: 'You spent $800 on a logo and lost interest by March.',
            effects: [
              { kind: 'money', delta: -800 },
              { kind: 'stat', stat: 'happiness', delta: -4 },
            ],
          },
        ],
      },
      {
        label: 'Sell the idea to a friend',
        outcomes: [
          {
            weight: 4,
            text: 'He paid $500 for it and did nothing with it either.',
            effects: [
              { kind: 'money', delta: 500 },
              { kind: 'stat', stat: 'happiness', delta: 2 },
            ],
          },
          {
            weight: 3,
            text: 'He built it, it worked, and now he thanks you in interviews.',
            effects: [
              { kind: 'money', delta: 500 },
              { kind: 'stat', stat: 'happiness', delta: -5 },
            ],
          },
        ],
      },
      {
        label: 'Go back to sleep',
        outcomes: [
          {
            weight: 5,
            text: 'The idea died where it was born. You were very well rested.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 1 },
              { kind: 'stat', stat: 'health', delta: 1 },
            ],
          },
        ],
      },
    ],
  },

  {
    id: 'ev-fin-utility-spike',
    area: 'money',
    icon: '⚡',
    minAge: 18,
    maxAge: 100,
    weight: 4,
    condition: payingOwnBills,
    text: 'Cold snap. The heating bill arrived looking like a car payment.',
    effects: [
      { kind: 'money', delta: -600 },
      { kind: 'stat', stat: 'happiness', delta: -3 },
    ],
  },

  {
    id: 'ev-fin-coupon-jackpot',
    area: 'money',
    icon: '🏷️',
    minAge: 14,
    maxAge: 100,
    weight: 3,
    condition: free,
    text: 'You stacked a coupon, a sale and a store card. The cashier looked impressed.',
    effects: [
      { kind: 'money', delta: 180 },
      { kind: 'stat', stat: 'happiness', delta: 4 },
      { kind: 'stat', stat: 'smarts', delta: 1 },
    ],
  },

  {
    id: 'ev-fin-old-debt-repaid',
    area: 'money',
    icon: '🤝',
    minAge: 25,
    maxAge: 100,
    weight: 3,
    condition: free,
    text: "A number you stopped saving calls. It's the friend who owed you money.",
    effects: [
      { kind: 'money', delta: 1200 },
      { kind: 'stat', stat: 'happiness', delta: 6 },
    ],
  },
];

/** Banking and investment interactions plus the money events that shake them up. */
export const financePack: ContentPack = {
  id: 'finance',
  events,
};
