import { addPerson } from '@/engine/state';
import type {
  Character,
  ContentPack,
  CrimeDef,
  Ctx,
  Effect,
  EffectCtx,
  EventDef,
  GameState,
  InteractionDef,
  Person,
  PrisonState,
} from '@/types';

/**
 * Crime, the odds of getting away with it, and the years that follow when you
 * don't.
 *
 * `CrimeDef.successChance` is asked once per attempt by `commitCrime`, against
 * whatever `GameState` the run is holding — including a save whose `convictions`
 * flag came back from JSON as a string, and a character whose stats are anything
 * at all. So every number below is read defensively and the answer is always
 * clamped into a band that leaves both outcomes reachable: no crime is a
 * guaranteed payday and none is a guaranteed cell.
 *
 * The prison rows and events own the years after a conviction. Everything here
 * asks `ctx.c.prison` first, in both directions: the yard rows are unavailable
 * to a free character, and the events are unavailable to one, because
 * `eventsPhase` keeps drawing while the character is inside and the other packs
 * deliberately sit those years out.
 */

/* ------------------------------------------------------------------ */
/* Odds                                                                */
/* ------------------------------------------------------------------ */

/** Nothing is a sure thing; the floor keeps every crime a gamble. */
const MIN_CHANCE = 0.05;

/** And the ceiling keeps every crime a risk, however clever the criminal.  */
const MAX_CHANCE = 0.9;

/** A prior conviction is worth this much less confidence, per prior. */
const PRIOR_PENALTY = 0.05;

/** Priors on the record. Flags are free-form JSON, so this trusts nothing. */
function convictions(c: Character): number {
  const raw = c.flags.convictions;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return 0;
  return Math.floor(raw);
}

/**
 * The shared curve: a base rate, plus a quarter of a point per point of smarts,
 * less five points for every prior. `cap` lowers the ceiling for the jobs no
 * amount of planning makes safe.
 */
function odds(base: number, cap: number = MAX_CHANCE): (ctx: Ctx) => number {
  return (ctx) => {
    const smarts = ctx.c.stats.smarts;
    const clever = Number.isFinite(smarts) ? smarts : 0;
    const raw = base + clever / 400 - convictions(ctx.c) * PRIOR_PENALTY;
    if (!Number.isFinite(raw)) return MIN_CHANCE;
    return Math.min(cap, Math.max(MIN_CHANCE, raw));
  };
}

const crimes: CrimeDef[] = [
  {
    id: 'crime-shoplift',
    label: 'Shoplifting',
    icon: '🛍️',
    minAge: 12,
    successChance: odds(0.7),
    payout: [20, 200],
    sentenceYears: [0, 1],
  },
  {
    id: 'crime-pickpocket',
    label: 'Pickpocketing',
    icon: '👛',
    minAge: 14,
    successChance: odds(0.6),
    payout: [50, 400],
    sentenceYears: [0, 1],
  },
  {
    id: 'crime-porch-pirate',
    label: 'Porch Piracy',
    icon: '📦',
    minAge: 14,
    successChance: odds(0.65),
    payout: [30, 300],
    sentenceYears: [0, 1],
  },
  {
    id: 'crime-vandalism',
    label: 'Vandalism',
    icon: '🎨',
    minAge: 13,
    successChance: odds(0.75),
    // Nothing to steal; the point is the wall, not the wallet.
    payout: [0, 0],
    sentenceYears: [0, 1],
  },
  {
    id: 'crime-car-theft',
    label: 'Grand Theft Auto',
    icon: '🚗',
    minAge: 16,
    successChance: odds(0.4),
    payout: [2000, 15000],
    sentenceYears: [1, 4],
  },
  {
    id: 'crime-burglary',
    label: 'Burglary',
    icon: '🪟',
    minAge: 16,
    successChance: odds(0.35),
    payout: [1000, 20000],
    sentenceYears: [2, 6],
  },
  {
    id: 'crime-bank-robbery',
    label: 'Bank Robbery',
    icon: '🏦',
    minAge: 18,
    /* Capped well under the others: cameras, dye packs and a silent alarm do not
       care how well you planned it. */
    successChance: odds(0.15, 0.5),
    payout: [50000, 500000],
    sentenceYears: [5, 12],
  },
  {
    id: 'crime-tax-fraud',
    label: 'Tax Fraud',
    icon: '🧾',
    minAge: 18,
    successChance: odds(0.5),
    payout: [10000, 100000],
    sentenceYears: [2, 5],
  },
  {
    id: 'crime-smuggling',
    label: 'Smuggling',
    icon: '🚢',
    minAge: 18,
    successChance: odds(0.3),
    payout: [20000, 200000],
    sentenceYears: [3, 8],
  },
  {
    id: 'crime-assault',
    label: 'Assault',
    icon: '🥊',
    minAge: 14,
    successChance: odds(0.55),
    // Fists pay nothing. The sentence is the whole transaction.
    payout: [0, 0],
    sentenceYears: [1, 3],
  },
];

/* ------------------------------------------------------------------ */
/* Prison lookups                                                      */
/* ------------------------------------------------------------------ */

/** Behind bars. Every row and event in this half of the pack asks first. */
function inside(ctx: Ctx): boolean {
  return ctx.c.prison !== null;
}

/** A sentence number that survives a save holding anything at all. */
function years(raw: number): number {
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

/** Everyone still alive. Widened first: a loaded save can hold a hole. */
function alivePeople(state: GameState): Person[] {
  const list: (Person | undefined)[] = Object.values(state.people);
  return list.filter((p): p is Person => p !== undefined && p.alive === true);
}

/** Somebody who would actually make the drive on a Sunday. */
function hasVisitor(state: GameState): boolean {
  return alivePeople(state).some(
    (p) =>
      p.kind === 'mother' ||
      p.kind === 'father' ||
      p.kind === 'sibling' ||
      p.kind === 'child' ||
      p.kind === 'spouse' ||
      p.kind === 'partner'
  );
}

/**
 * Adds time to the sentence being served.
 *
 * Both numbers move together: `careerPhase` counts down `yearsLeft`, the parole
 * card reads it against `totalYears`, and a sentence with more left on it than
 * it was ever handed reads as a bug on the character sheet.
 */
function extendSentence(more: number): Effect {
  return {
    kind: 'fn',
    run: (ctx: EffectCtx) => {
      const prison: PrisonState | null = ctx.state.character.prison;
      if (!prison) return;
      prison.yearsLeft = years(prison.yearsLeft) + more;
      prison.totalYears = Math.max(years(prison.totalYears) + more, prison.yearsLeft);
    },
  };
}

/** Out through the front door, sentence served or forgiven. */
const walkFree: Effect = {
  kind: 'fn',
  run: (ctx: EffectCtx) => {
    ctx.state.character.prison = null;
  },
};

/** Out the other way. The achievement reads the flag, so it is set strictly. */
const breakOut: Effect = {
  kind: 'fn',
  run: (ctx: EffectCtx) => {
    const c = ctx.state.character;
    if (!c.prison) return;
    c.prison = null;
    c.flags['crime:escaped'] = true;
  },
};

/* ------------------------------------------------------------------ */
/* Prison rows                                                         */
/* ------------------------------------------------------------------ */

/** Nicknames the block hands out; nobody inside uses a surname. */
const CELLMATE_NAMES: readonly string[] = [
  'Tiny',
  'Books',
  'Whisper',
  'Domino',
  'Preacher',
  'Rabbit',
  'Nine Toes',
  'Cousin Vic',
  'Sunshine',
  'The Professor',
];

const RIOT_LOSS = 10;

const interactions: InteractionDef[] = [
  {
    id: 'act-prison-job',
    area: 'prison',
    label: 'Work a Prison Job',
    icon: '🧼',
    // One shift a year: the only paying row in the pack, so it is not a tap.
    cooldownYears: 1,
    condition: inside,
    resolve: (ctx: Ctx) => ({
      text: ctx.rng.chance(0.5)
        ? 'A year in the laundry. You know every stain by name.'
        : 'A year mopping the same corridor. It paid, technically.',
      effects: [
        { kind: 'money', delta: 600 },
        { kind: 'stat', stat: 'happiness', delta: -1 },
      ],
    }),
  },
  {
    id: 'act-prison-workout',
    area: 'prison',
    label: 'Work Out in the Yard',
    icon: '🏋️',
    condition: inside,
    resolve: () => ({
      text: 'You lifted whatever the yard had. Nobody cuts in front of you now.',
      effects: [
        { kind: 'stat', stat: 'health', delta: 3 },
        { kind: 'stat', stat: 'happiness', delta: 2 },
      ],
    }),
  },
  {
    id: 'act-prison-library',
    area: 'prison',
    label: 'Use the Prison Library',
    icon: '📚',
    condition: inside,
    resolve: () => ({
      text: 'You read the law shelf end to end. Your appeals got noticeably better.',
      effects: [{ kind: 'stat', stat: 'smarts', delta: 2 }],
    }),
  },
  {
    id: 'act-prison-riot',
    area: 'prison',
    label: 'Start a Riot',
    icon: '🔥',
    // Once a year at most: a free mood boost you can spam is not a riot.
    cooldownYears: 1,
    condition: inside,
    resolve: (ctx: Ctx) => {
      const roll = ctx.rng.next();
      if (roll < 0.3) {
        return {
          text: 'The block went up. So did your sentence.',
          icon: '⚖️',
          effects: [extendSentence(1), { kind: 'stat', stat: 'happiness', delta: -2 }],
        };
      }
      if (roll < 0.5) {
        return {
          text: 'You caught a tray, a boot and most of a fire extinguisher.',
          icon: '🚑',
          effects: [{ kind: 'stat', stat: 'health', delta: -RIOT_LOSS }],
        };
      }
      return {
        text: 'Chaos for one glorious afternoon. You let off some steam.',
        effects: [{ kind: 'stat', stat: 'happiness', delta: 4 }],
      };
    },
  },
  {
    id: 'act-prison-escape',
    area: 'prison',
    label: 'Attempt Escape',
    icon: '🪜',
    cooldownYears: 2,
    condition: inside,
    resolve: (ctx: Ctx) => {
      if (ctx.rng.chance(0.25)) {
        return {
          text: 'Laundry truck, second fence, treeline. Gone.',
          icon: '🏃',
          effects: [
            breakOut,
            { kind: 'log', icon: '🏃', text: 'You escaped from prison!', logKind: 'legal' },
            { kind: 'stat', stat: 'happiness', delta: 8 },
          ],
        };
      }
      return {
        text: 'You made it as far as the second fence.',
        icon: '🚨',
        effects: [extendSentence(2), { kind: 'stat', stat: 'health', delta: -5 }],
      };
    },
  },
];

/* ------------------------------------------------------------------ */
/* Prison events                                                       */
/* ------------------------------------------------------------------ */

const events: EventDef[] = [
  {
    id: 'ev-prison-cellmate',
    area: 'prison',
    icon: '🚪',
    minAge: 12,
    maxAge: 110,
    weight: 5,
    condition: inside,
    text: 'A new cellmate moved in. He alphabetised the shelf and asked about your childhood.',
    effects: [
      {
        kind: 'fn',
        run: (ctx: EffectCtx) => {
          addPerson(ctx.state, {
            kind: 'friend',
            name: ctx.rng.pick(CELLMATE_NAMES),
            gender: ctx.state.character.gender,
            age: Math.max(18, ctx.state.character.age + ctx.rng.int(-10, 10)),
            alive: true,
            rel: ctx.rng.int(40, 70),
            occupation: 'Cellmate',
            flags: { 'crime:cellmate': true },
          });
        },
      },
      { kind: 'stat', stat: 'happiness', delta: 2 },
    ],
  },
  {
    id: 'ev-prison-shakedown',
    area: 'prison',
    icon: '🔦',
    minAge: 12,
    maxAge: 110,
    weight: 5,
    condition: inside,
    text: 'Guards tossed the block at four in the morning. Your stash is now evidence.',
    effects: [
      { kind: 'stat', stat: 'happiness', delta: -4 },
      { kind: 'money', delta: -80 },
    ],
  },
  {
    id: 'ev-prison-visiting-day',
    area: 'prison',
    icon: '👨‍👩‍👧',
    minAge: 12,
    maxAge: 110,
    weight: 4,
    condition: (ctx) => inside(ctx) && hasVisitor(ctx.state),
    text: 'Visiting day. Forty minutes, one plexiglass window, and a lot of nodding.',
    /* Two sentinels, because `hasVisitor` counts six kinds and `random-family`
       resolves only four (mother, father, sibling, child): without the second
       row the visit a spouse or partner made would land on nobody and the gain
       would vanish. The two can never name the same person, and `partner`
       resolves without a draw, so the year's roll budget is unchanged. */
    effects: [
      { kind: 'stat', stat: 'happiness', delta: 6 },
      { kind: 'rel', who: 'random-family', delta: 5 },
      { kind: 'rel', who: 'partner', delta: 5 },
    ],
  },
  {
    id: 'ev-prison-contraband',
    area: 'prison',
    icon: '📱',
    minAge: 12,
    maxAge: 110,
    weight: 4,
    condition: inside,
    text: 'Somebody on the tier will sell you a phone for $200.',
    choices: [
      {
        label: 'Buy it',
        outcomes: [
          {
            weight: 5,
            text: 'You heard a familiar voice for eleven minutes. Worth every dollar.',
            effects: [
              { kind: 'money', delta: -200 },
              { kind: 'stat', stat: 'happiness', delta: 6 },
            ],
          },
          {
            weight: 3,
            text: 'It buzzed during a sweep. They took the phone and a year of your life.',
            effects: [
              { kind: 'money', delta: -200 },
              extendSentence(1),
              { kind: 'stat', stat: 'happiness', delta: -6 },
            ],
          },
        ],
      },
      {
        label: 'Pass',
        outcomes: [
          {
            weight: 1,
            text: 'You kept your nose clean. It was a very quiet year.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: -1 }],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-prison-talent-show',
    area: 'prison',
    icon: '🎤',
    minAge: 12,
    maxAge: 110,
    weight: 3,
    condition: inside,
    text: 'The block put on a talent show. You did three minutes of material about the food.',
    effects: [
      { kind: 'stat', stat: 'happiness', delta: 5 },
      { kind: 'fame', delta: 1 },
    ],
  },
  {
    id: 'ev-prison-parole',
    area: 'prison',
    icon: '📋',
    minAge: 12,
    maxAge: 110,
    weight: 6,
    condition: (ctx) => {
      const prison = ctx.c.prison;
      if (!prison) return false;
      // Half the sentence served, give or take the year you are standing in.
      return years(prison.yearsLeft) < years(prison.totalYears) / 2 + 1;
    },
    text: 'The parole board wants to know whether you are a changed person.',
    choices: [
      {
        label: 'Show remorse',
        outcomes: [
          {
            weight: 9,
            text: 'You said the word "accountability" four times. They bought it.',
            effects: [
              walkFree,
              { kind: 'log', icon: '🔓', text: 'Parole granted. You walked out.', logKind: 'legal' },
              { kind: 'stat', stat: 'happiness', delta: 10 },
            ],
          },
          {
            weight: 11,
            text: 'Denied. Come back next year with better answers.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: -5 }],
          },
        ],
      },
      {
        label: 'Tell them the truth',
        outcomes: [
          {
            weight: 3,
            text: 'Honesty startled them. One board member voted for you out of respect.',
            effects: [
              walkFree,
              { kind: 'log', icon: '🔓', text: 'Parole granted. You walked out.', logKind: 'legal' },
              { kind: 'stat', stat: 'happiness', delta: 8 },
            ],
          },
          {
            weight: 7,
            text: 'They wrote "unrepentant" on the form and underlined it.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: -3 }],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-prison-lights-out',
    area: 'prison',
    icon: '🥊',
    minAge: 12,
    maxAge: 110,
    weight: 5,
    condition: inside,
    text: 'Someone stepped to you after lights-out over a stolen bar of soap.',
    choices: [
      {
        label: 'Swing first',
        outcomes: [
          {
            weight: 5,
            text: 'It was over in four seconds. Nobody touches your soap now.',
            effects: [
              { kind: 'stat', stat: 'health', delta: -3 },
              { kind: 'stat', stat: 'happiness', delta: 4 },
            ],
          },
          {
            weight: 4,
            text: 'You lost, loudly, and the guards added a year for the trouble.',
            effects: [
              { kind: 'stat', stat: 'health', delta: -9 },
              extendSentence(1),
              { kind: 'stat', stat: 'happiness', delta: -4 },
            ],
          },
        ],
      },
      {
        label: 'Back down',
        outcomes: [
          {
            weight: 4,
            text: 'You handed over the soap. Word travelled by breakfast.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: -5 }],
          },
          {
            weight: 3,
            text: 'You talked it down to a handshake. Nobody died over soap.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: 1 }],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-prison-guard-favour',
    area: 'prison',
    icon: '🧑‍✈️',
    minAge: 12,
    maxAge: 110,
    weight: 3,
    condition: inside,
    text: 'A guard decided you were alright. Extra yard time, and the tray with food on it.',
    effects: [
      { kind: 'stat', stat: 'happiness', delta: 4 },
      { kind: 'stat', stat: 'health', delta: 2 },
    ],
  },
];

/** Committable crimes with success odds, payouts and sentences, plus prison events. */
export const crimePack: ContentPack = {
  id: 'crime',
  crimes,
  interactions,
  events,
};
