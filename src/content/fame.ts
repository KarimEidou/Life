import { fmtMoney } from '@/engine/format';
import type {
  Character,
  ContentPack,
  Ctx,
  Effect,
  EffectCtx,
  EventDef,
  InteractionDef,
} from '@/types';

/**
 * Being known: the grind that builds an audience, and everything that audience
 * does back to you.
 *
 * `Character.fame` is a 0..100 stat the engine clamps on every write, and every
 * row and card here is gated on a threshold of it — so an ordinary life never
 * sees any of this, and a famous one gets more of it the further up it climbs.
 * The thresholds are read through `fameOf`, which trusts nothing: a save can
 * come back with anything in that field, and `NaN >= 40` is false in a way that
 * silently retires half a pack.
 *
 * Prison owns its own years, so nothing here fires from a cell. The crime pack
 * has that block.
 */

/* ------------------------------------------------------------------ */
/* Readers                                                             */
/* ------------------------------------------------------------------ */

/** Fame as a usable 0..100 number, whatever the save actually holds. */
function fameOf(c: Character): number {
  const raw = c.fame;
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw > 100 ? 100 : raw;
}

/** A stat as a usable 0..100 number, for the same reason. */
function statOf(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw > 100 ? 100 : raw;
}

/** Out in the world, where an audience can actually reach you. */
function free(ctx: Ctx): boolean {
  return ctx.c.prison === null;
}

/** Famous enough for this row, and out where it matters. */
function famous(min: number): (ctx: Ctx) => boolean {
  return (ctx) => free(ctx) && fameOf(ctx.c) >= min;
}

/* ------------------------------------------------------------------ */
/* Flavour pools                                                       */
/* ------------------------------------------------------------------ */

const POST_LINES: readonly string[] = [
  'You posted a thirty-second video about your morning. People watched it.',
  'You posted a photo of your lunch. The internet had opinions.',
  'You filmed a dance you cannot do. It did numbers anyway.',
  'You posted a hot take and then refreshed for two hours.',
  'You went live for an hour and mostly rearranged a shelf.',
];

const ENDORSEMENTS: readonly string[] = [
  'an energy drink you have never opened',
  'a mattress company',
  'a watch you cannot pronounce',
  'a protein powder that tastes like chalk',
  'a betting app, tastefully',
  'an airline you have complained about publicly',
];

const SCANDAL_FLAG = 'fame:scandal';

/** A scandal is remembered; the flag is what later content reads it by. */
const markScandal: Effect = {
  kind: 'fn',
  run: (ctx: EffectCtx) => {
    ctx.state.character.flags[SCANDAL_FLAG] = true;
  },
};

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

const interactions: InteractionDef[] = [
  {
    id: 'act-post-content',
    area: 'fame',
    label: 'Post Content',
    icon: '📱',
    minAge: 13,
    // Free and uncapped on purpose: this is the grind every other row is gated behind.
    condition: free,
    resolve: (ctx: Ctx) => {
      const c = ctx.c;
      const flair = (statOf(c.stats.looks) + statOf(c.stats.smarts)) / 2;
      let gain = ctx.rng.int(0, 3) + (flair >= 70 ? 2 : flair >= 45 ? 1 : 0);
      let text = ctx.rng.pick(POST_LINES);
      // An audience is its own engine: past 25 fame a post can catch fire.
      if (fameOf(c) >= 25 && ctx.rng.chance(0.2)) {
        gain += 5;
        text = 'A clip of you went viral. Strangers are quoting you back to you.';
      }
      return {
        text,
        effects: [
          { kind: 'fame', delta: gain },
          { kind: 'stat', stat: 'happiness', delta: 1 },
        ],
      };
    },
  },
  {
    id: 'act-interview',
    area: 'fame',
    label: 'Do an Interview',
    icon: '🎙️',
    cooldownYears: 1,
    condition: famous(20),
    resolve: (ctx: Ctx) => ({
      text: ctx.rng.chance(0.5)
        ? 'Twenty minutes of questions, four of which were about your childhood.'
        : 'You told the story about the audition again. It gets better every year.',
      effects: [
        { kind: 'fame', delta: 4 },
        { kind: 'stat', stat: 'happiness', delta: 2 },
      ],
    }),
  },
  {
    id: 'act-endorse',
    area: 'fame',
    label: 'Sign an Endorsement',
    icon: '💼',
    cooldownYears: 1,
    condition: famous(40),
    resolve: (ctx: Ctx) => {
      const fee = Math.round(fameOf(ctx.c) * 1200);
      return {
        text: `You put your name on ${ctx.rng.pick(ENDORSEMENTS)}. The cheque cleared.`,
        effects: [
          { kind: 'money', delta: fee },
          { kind: 'stat', stat: 'happiness', delta: 1 },
          /* A `money` effect writes the balance and logs nothing, so a fee that
             scales with fame — and is the largest repeatable payout in the game —
             would reach the player nowhere. Named the way `rel-ask-money` names
             its own rolled cheque. */
          { kind: 'log', icon: '💵', text: `+${fmtMoney(fee)}`, logKind: 'money' },
        ],
      };
    },
  },
  {
    id: 'act-fan-meetup',
    area: 'fame',
    label: 'Meet Your Fans',
    icon: '🤳',
    cooldownYears: 1,
    condition: famous(30),
    resolve: () => ({
      text: 'Three hours of selfies. Somebody cried. You signed a cast.',
      effects: [
        { kind: 'stat', stat: 'happiness', delta: 5 },
        { kind: 'fame', delta: 2 },
      ],
    }),
  },
  {
    id: 'act-publicist',
    area: 'fame',
    label: 'Hire a Publicist',
    icon: '🕴️',
    cost: 20000,
    cooldownYears: 2,
    condition: famous(10),
    resolve: () => ({
      text: 'She put you in three magazines and took your phone away for a week.',
      effects: [{ kind: 'fame', delta: 8 }],
    }),
  },
  {
    id: 'act-charity-gala',
    area: 'fame',
    label: 'Host a Charity Gala',
    icon: '🎗️',
    cost: 5000,
    cooldownYears: 1,
    condition: famous(30),
    resolve: () => ({
      text: 'A ballroom, a silent auction, and a very long speech. Yours.',
      effects: [
        { kind: 'fame', delta: 3 },
        { kind: 'stat', stat: 'happiness', delta: 3 },
      ],
    }),
  },
];

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

const events: EventDef[] = [
  {
    id: 'ev-fame-first-recognition',
    area: 'fame',
    icon: '👀',
    minAge: 8,
    maxAge: 110,
    weight: 6,
    oncePerLife: true,
    condition: famous(10),
    text: 'Somebody recognised you in a coffee shop. You pretended not to notice for a full minute.',
    effects: [
      { kind: 'stat', stat: 'happiness', delta: 5 },
      { kind: 'fame', delta: 1 },
    ],
  },
  {
    id: 'ev-fame-superfan-letter',
    area: 'fame',
    icon: '💌',
    minAge: 8,
    maxAge: 110,
    weight: 4,
    condition: famous(20),
    text: 'A fan wrote to say you got them through a bad year. Handwritten. Six pages.',
    effects: [
      { kind: 'stat', stat: 'happiness', delta: 4 },
      { kind: 'fame', delta: 1 },
    ],
  },
  {
    id: 'ev-fame-lookalike',
    area: 'fame',
    icon: '🪞',
    minAge: 10,
    maxAge: 110,
    weight: 3,
    condition: famous(30),
    text: 'A lookalike of you is charging for photos two towns over. He is better at it than you.',
    effects: [
      { kind: 'fame', delta: 2 },
      { kind: 'stat', stat: 'happiness', delta: -1 },
    ],
  },
  {
    id: 'ev-fame-paparazzi',
    area: 'fame',
    icon: '📸',
    minAge: 12,
    maxAge: 110,
    weight: 4,
    condition: famous(40),
    text: 'Two photographers were waiting outside the restaurant. So was a third, in a bush.',
    choices: [
      {
        label: 'Smile for them',
        outcomes: [
          {
            weight: 6,
            text: 'You gave them the shot. It ran everywhere, flatteringly.',
            effects: [
              { kind: 'fame', delta: 3 },
              { kind: 'stat', stat: 'happiness', delta: -1 },
            ],
          },
          {
            weight: 3,
            text: 'They caught you mid-blink. That photo will outlive you.',
            effects: [
              { kind: 'fame', delta: 2 },
              { kind: 'stat', stat: 'looks', delta: -1 },
              { kind: 'stat', stat: 'happiness', delta: -3 },
            ],
          },
        ],
      },
      {
        label: 'Cover your face',
        outcomes: [
          {
            weight: 5,
            text: 'A jacket over the head, a fast car, and a quiet evening.',
            effects: [
              { kind: 'fame', delta: -1 },
              { kind: 'stat', stat: 'happiness', delta: 2 },
            ],
          },
          {
            weight: 2,
            text: 'You knocked a lens. The lawsuit was cheaper than the headline.',
            effects: [
              { kind: 'money', delta: -8000 },
              { kind: 'fame', delta: 4 },
              { kind: 'stat', stat: 'happiness', delta: -5 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-fame-brand-windfall',
    area: 'fame',
    icon: '💸',
    minAge: 14,
    maxAge: 110,
    weight: 3,
    condition: famous(50),
    text: 'A sneaker brand put your name on a shoe. $60,000 landed before you saw the design.',
    effects: [
      { kind: 'money', delta: 60000 },
      { kind: 'stat', stat: 'happiness', delta: 4 },
      { kind: 'fame', delta: 2 },
    ],
  },
  {
    id: 'ev-fame-scandal',
    area: 'fame',
    icon: '📰',
    minAge: 14,
    maxAge: 110,
    weight: 3,
    condition: famous(50),
    text: 'A tabloid has something on you. Their lawyer has already called yours.',
    choices: [
      {
        label: 'Deny everything',
        outcomes: [
          {
            weight: 6,
            text: 'You denied it flatly and often. The story died by Thursday.',
            effects: [
              markScandal,
              { kind: 'fame', delta: -3 },
              { kind: 'stat', stat: 'happiness', delta: -3 },
            ],
          },
          {
            weight: 4,
            text: 'They had receipts. The denial became the story.',
            effects: [
              markScandal,
              { kind: 'fame', delta: -12 },
              { kind: 'stat', stat: 'happiness', delta: -10 },
            ],
          },
        ],
      },
      {
        label: 'Own it',
        outcomes: [
          {
            weight: 5,
            text: 'You said it first, in your own words. The internet decided you were refreshing.',
            effects: [
              markScandal,
              { kind: 'fame', delta: 6 },
              { kind: 'stat', stat: 'happiness', delta: -2 },
            ],
          },
          {
            weight: 4,
            text: 'You owned it and nobody was in a forgiving mood that week.',
            effects: [
              markScandal,
              { kind: 'fame', delta: -6 },
              { kind: 'stat', stat: 'happiness', delta: -7 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-fame-award-nomination',
    area: 'fame',
    icon: '🏆',
    minAge: 16,
    maxAge: 110,
    weight: 3,
    oncePerLife: true,
    condition: famous(60),
    text: 'You were nominated. Your publicist says the campaign costs $20,000 and works.',
    choices: [
      {
        label: 'Campaign for it',
        condition: (ctx: Ctx) => ctx.c.money >= 20000,
        outcomes: [
          {
            weight: 5,
            text: 'You won. You thanked eleven people and forgot your mother.',
            effects: [
              { kind: 'money', delta: -20000 },
              { kind: 'fame', delta: 12 },
              { kind: 'stat', stat: 'happiness', delta: 10 },
            ],
          },
          {
            weight: 5,
            text: 'You lost on camera, gracefully, for four full seconds.',
            effects: [
              { kind: 'money', delta: -20000 },
              { kind: 'fame', delta: 3 },
              { kind: 'stat', stat: 'happiness', delta: -6 },
            ],
          },
        ],
      },
      {
        label: 'Stay home',
        outcomes: [
          {
            weight: 1,
            text: 'You watched it in a dressing gown and slept beautifully.',
            effects: [
              { kind: 'fame', delta: 1 },
              { kind: 'stat', stat: 'happiness', delta: 3 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-fame-stalker',
    area: 'fame',
    icon: '😨',
    minAge: 14,
    maxAge: 110,
    weight: 2,
    condition: famous(70),
    text: 'Someone has been outside your gate for three nights. They know your schedule.',
    effects: [
      { kind: 'stat', stat: 'happiness', delta: -8 },
      { kind: 'stat', stat: 'health', delta: -2 },
      { kind: 'money', delta: -2500 },
    ],
  },
  {
    id: 'ev-fame-documentary',
    area: 'fame',
    icon: '🎬',
    minAge: 18,
    maxAge: 110,
    weight: 3,
    oncePerLife: true,
    condition: famous(80),
    text: 'A streamer wants to make a documentary about you. Full access, final cut theirs.',
    choices: [
      {
        label: 'Let them film',
        outcomes: [
          {
            weight: 6,
            text: 'Three episodes, one of them kind. It played in ninety countries.',
            effects: [
              { kind: 'money', delta: 150000 },
              { kind: 'fame', delta: 9 },
              { kind: 'stat', stat: 'happiness', delta: -2 },
            ],
          },
          {
            weight: 3,
            text: 'They used the footage of you at 3am. Everyone has seen it now.',
            effects: [
              { kind: 'money', delta: 150000 },
              { kind: 'fame', delta: 5 },
              { kind: 'stat', stat: 'happiness', delta: -9 },
            ],
          },
        ],
      },
      {
        label: 'Refuse',
        outcomes: [
          {
            weight: 4,
            text: 'You said no. They made it anyway, from old clips and a bitter ex-manager.',
            effects: [
              { kind: 'fame', delta: 4 },
              { kind: 'stat', stat: 'happiness', delta: -6 },
            ],
          },
          {
            weight: 3,
            text: 'You said no and it quietly went away. Some things stay yours.',
            effects: [
              { kind: 'fame', delta: -2 },
              { kind: 'stat', stat: 'happiness', delta: 4 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-fame-hometown-honours',
    area: 'fame',
    icon: '🏅',
    minAge: 20,
    maxAge: 110,
    weight: 3,
    oncePerLife: true,
    condition: famous(60),
    text: 'Your hometown put your face on a road sign and gave you a key that opens nothing.',
    effects: [
      { kind: 'stat', stat: 'happiness', delta: 10 },
      { kind: 'fame', delta: 2 },
    ],
  },
];

/** Fame-gated content: social posts, interviews, scandals and endorsement deals. */
export const famePack: ContentPack = {
  id: 'fame',
  interactions,
  events,
};
