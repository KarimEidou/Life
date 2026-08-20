import {
  ROLLED_GENDERS,
  addPerson,
  alivePeople,
  childAged,
  clampStat,
  employed,
  firstNameOf,
  free,
  holds,
  relWith,
  rollFirstName,
  rollLastName,
  romanceOf,
  siblingOf,
  spouseOf,
} from '@/content/lib';
import type {
  AssetDef,
  ContentPack,
  Ctx,
  Effect,
  EffectCtx,
  EventDef,
  GameState,
  OwnedAsset,
  Person,
} from '@/types';

/**
 * Random events for ages 18-64: work, money, love, family and misfortune.
 *
 * Every condition here runs against whatever `GameState` the engine happens to
 * be holding — a fresh life, a save written by an older build, a year in which
 * the partner died two phases ago — so nothing below reads a person, a job or an
 * asset without first proving it exists. The helpers at the top are the only
 * place that lookup happens; the event list itself just composes them.
 *
 * Prison is the one blanket exclusion: `eventsPhase` keeps drawing while the
 * character is inside, and an office party or a flat tire in a cell reads as a
 * bug. The prison pack owns those years, so almost everything here asks `free`
 * first.
 */

/* ------------------------------------------------------------------ */
/* Lookups                                                             */
/* ------------------------------------------------------------------ */

function childCount(state: GameState): number {
  return alivePeople(state).filter((p) => p.kind === 'child').length;
}

/** A living parent old enough for the character to start worrying about. */
function agingParent(state: GameState): Person | undefined {
  return alivePeople(state).find(
    (p) => (p.kind === 'mother' || p.kind === 'father') && p.age >= 65
  );
}

function hasBloodFamily(state: GameState): boolean {
  return alivePeople(state).some(
    (p) => p.kind === 'mother' || p.kind === 'father' || p.kind === 'sibling'
  );
}

/**
 * Owns at least one asset of this kind.
 *
 * The registry is the truth; the id prefix is the fallback for a save naming a
 * def this build no longer ships, which is exactly when a `veh-` row would
 * otherwise stop counting as a car.
 */
function ownsType(ctx: Ctx, type: 'property' | 'vehicle'): boolean {
  const byId: Record<string, AssetDef | undefined> = ctx.reg.assetsById;
  const prefix = type === 'vehicle' ? 'veh-' : 'prop-';
  /* Widened like the people table: the save gate proves `assets` is an array and
     stops there, so a drifted row can be a hole or carry no `defId`. This one
     runs inside `isEligible`, which means a throw kills the whole year's pool —
     including the events that would never have been drawn. */
  const owned: readonly (OwnedAsset | undefined)[] = ctx.c.assets;
  return owned.some((asset) => {
    const defId: unknown = asset?.defId;
    if (typeof defId !== 'string') return false;
    const def = byId[defId];
    return def ? def.type === type : defId.startsWith(prefix);
  });
}

/** Paying somebody else for a roof: moved out, no property of their own. */
function renting(ctx: Ctx): boolean {
  return (
    ctx.c.prison === null &&
    ctx.c.flags.livesWithParents !== true &&
    !ownsType(ctx, 'property')
  );
}

/* ------------------------------------------------------------------ */
/* Effect helpers                                                      */
/* ------------------------------------------------------------------ */

/**
 * Moves standing with the employer.
 * `JobState.performance` has no declarative effect, and the job can be gone by
 * the time a card is answered, so this is a guarded `fn`.
 */
function performance(delta: number): Effect {
  return {
    kind: 'fn',
    run: (ctx: EffectCtx) => {
      const job = ctx.state.character.job;
      if (!job) return;
      job.performance = clampStat(job.performance + delta);
    },
  };
}

/** One more entry on the record, counted the way `runCrime` counts them. */
const convicted: Effect = {
  kind: 'fn',
  run: (ctx: EffectCtx) => {
    const flags = ctx.state.character.flags;
    const priors = flags.convictions;
    const count = typeof priors === 'number' && Number.isFinite(priors) && priors > 0 ? priors : 0;
    flags.convictions = count + 1;
  },
};

/* ------------------------------------------------------------------ */
/* Minting people                                                      */
/* ------------------------------------------------------------------ */

const PET_NAMES: readonly string[] = [
  'Biscuit',
  'Noodle',
  'Waffles',
  'Pickle',
  'Bandit',
  'Mochi',
  'Scout',
  'Pepper',
  'Tofu',
  'Olive',
];

/**
 * Starts a romance with somebody new.
 * Guarded against a second partner: the card is answered a moment after it is
 * dealt, but the relationships phase can also hand one out in between.
 */
const startRomance: Effect = {
  kind: 'fn',
  run: (ctx: EffectCtx) => {
    if (romanceOf(ctx.state)) return;
    const gender = ctx.rng.pick(ROLLED_GENDERS);
    const age = Math.max(18, ctx.state.character.age + ctx.rng.int(-6, 6));
    addPerson(ctx.state, {
      kind: 'partner',
      name: `${rollFirstName(ctx, gender)} ${rollLastName(ctx)}`,
      gender,
      age,
      alive: true,
      rel: ctx.rng.int(55, 80),
      flags: {},
    });
  },
};

/** A newborn, carrying the character's surname and their own starting stats. */
const haveBaby: Effect = {
  kind: 'fn',
  run: (ctx: EffectCtx) => {
    const c = ctx.state.character;
    const gender = ctx.rng.pick(ROLLED_GENDERS);
    addPerson(ctx.state, {
      kind: 'child',
      name: `${rollFirstName(ctx, gender)} ${c.lastName}`.trim(),
      gender,
      age: 0,
      alive: true,
      rel: ctx.rng.int(75, 95),
      stats: {
        health: ctx.rng.int(70, 100),
        happiness: ctx.rng.int(60, 95),
        smarts: ctx.rng.int(20, 80),
        looks: ctx.rng.int(20, 80),
      },
      flags: {},
    });
  },
};

function adoptPet(species: string): Effect {
  return {
    kind: 'fn',
    run: (ctx: EffectCtx) => {
      addPerson(ctx.state, {
        kind: 'pet',
        name: ctx.rng.pick(PET_NAMES),
        gender: ctx.rng.pick(ROLLED_GENDERS),
        age: ctx.rng.int(0, 3),
        alive: true,
        rel: ctx.rng.int(60, 85),
        petSpecies: species,
        flags: {},
      });
    },
  };
}

/** Somebody from the old days, back in the address book. */
const reconnectFriend: Effect = {
  kind: 'fn',
  run: (ctx: EffectCtx) => {
    const gender = ctx.rng.pick(ROLLED_GENDERS);
    addPerson(ctx.state, {
      kind: 'friend',
      name: `${rollFirstName(ctx, gender)} ${rollLastName(ctx)}`,
      gender,
      age: Math.max(18, ctx.state.character.age + ctx.rng.int(-4, 4)),
      alive: true,
      rel: ctx.rng.int(55, 85),
      flags: {},
    });
  },
};

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

const events: EventDef[] = [
  /* --- Work ------------------------------------------------------- */
  {
    id: 'ev-adult-promotion-rival',
    area: 'work',
    icon: '🏢',
    minAge: 20,
    maxAge: 64,
    weight: 4,
    condition: employed,
    text: "A promotion opened up. So did your coworker's campaign for it.",
    choices: [
      {
        label: 'Out-work them',
        outcomes: [
          {
            weight: 5,
            text: 'You buried them in results. The job was yours on merit.',
            effects: [
              performance(8),
              { kind: 'stat', stat: 'happiness', delta: 5 },
              { kind: 'stat', stat: 'health', delta: -2 },
            ],
          },
          {
            weight: 4,
            text: 'You worked yourself ragged and they got it anyway.',
            effects: [
              performance(3),
              { kind: 'stat', stat: 'happiness', delta: -6 },
              { kind: 'stat', stat: 'health', delta: -3 },
            ],
          },
        ],
      },
      {
        label: 'Start a rumor',
        outcomes: [
          {
            weight: 4,
            text: 'The rumor stuck. They withdrew. You never bring it up.',
            effects: [
              performance(6),
              { kind: 'stat', stat: 'happiness', delta: 3 },
              { kind: 'flag', flag: 'work:sabotage', value: true },
            ],
          },
          {
            weight: 4,
            text: 'It traced back to you. HR keeps a file now.',
            effects: [
              performance(-12),
              { kind: 'stat', stat: 'happiness', delta: -7 },
            ],
          },
        ],
      },
      {
        label: 'Wish them luck',
        outcomes: [
          {
            weight: 1,
            text: 'You wished them luck and meant most of it.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: 2 }],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-adult-office-party',
    area: 'work',
    icon: '🎉',
    minAge: 20,
    maxAge: 64,
    weight: 4,
    condition: employed,
    text: 'The office party has an open bar and a karaoke machine.',
    choices: [
      {
        label: 'Two drinks, then leave',
        outcomes: [
          {
            weight: 1,
            text: 'You left at nine and woke up fine. Adulthood.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: 3 }],
          },
        ],
      },
      {
        label: 'Close the place down',
        outcomes: [
          {
            weight: 4,
            text: 'You sang. There is footage.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 6 },
              { kind: 'stat', stat: 'looks', delta: -1 },
              performance(-5),
            ],
          },
          {
            weight: 4,
            text: 'You were the best thing at that party. Even your boss laughed.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 8 },
              performance(4),
            ],
          },
        ],
      },
      {
        label: 'Skip it',
        outcomes: [
          {
            weight: 1,
            text: 'You stayed home in sweatpants. No regrets.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 2 },
              performance(-2),
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-adult-terrible-boss',
    area: 'work',
    icon: '👔',
    minAge: 18,
    maxAge: 64,
    weight: 5,
    condition: employed,
    /* A bad year at work, told two ways. `ev-adult-layoff-rumor` shipped beside
       this card with the same area, the same gate and the same two stat rows, so
       the pack was charging ten weight for one beat; the rumour is a second
       telling of it rather than a second card. */
    text: (ctx) =>
      ctx.rng.pick([
        'Your boss called a 7am meeting to explain that email is faster than meetings.',
        'Layoff rumors went around the office. Nobody would say who.',
      ]),
    effects: [
      { kind: 'stat', stat: 'happiness', delta: -5 },
      { kind: 'stat', stat: 'health', delta: -1 },
    ],
  },
  {
    id: 'ev-adult-workplace-crush',
    area: 'work',
    icon: '💌',
    minAge: 20,
    maxAge: 64,
    weight: 3,
    condition: employed,
    text: 'Somebody two desks over keeps finding reasons to visit yours.',
    choices: [
      {
        label: 'Keep it professional',
        outcomes: [
          {
            weight: 1,
            text: 'You kept it to small talk. The whole thing faded by spring.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: 1 }],
          },
        ],
      },
      {
        label: 'Flirt back',
        condition: (ctx) => romanceOf(ctx.state) === undefined,
        outcomes: [
          {
            weight: 4,
            text: 'Coffee turned into dinner turned into six months of dinners.',
            effects: [startRomance, { kind: 'stat', stat: 'happiness', delta: 8 }],
          },
          {
            weight: 3,
            text: 'They were flattered, taken, and quick about mentioning it.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: -3 }],
          },
        ],
      },
      {
        label: 'Flirt back anyway',
        condition: (ctx) => romanceOf(ctx.state) !== undefined,
        outcomes: [
          {
            weight: 4,
            text: '{partner} read the messages. That was an expensive night.',
            effects: [
              { kind: 'rel', who: 'partner', delta: -25 },
              { kind: 'stat', stat: 'happiness', delta: -10 },
            ],
          },
          {
            weight: 3,
            text: 'You stopped before it started. Nobody ever found out.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: -2 }],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-adult-overtime-crunch',
    area: 'work',
    icon: '⏰',
    minAge: 18,
    maxAge: 64,
    weight: 5,
    condition: employed,
    text: 'The deadline moved up three weeks. Nobody moved the work.',
    choices: [
      {
        label: 'Grind it out',
        outcomes: [
          {
            weight: 6,
            text: 'You shipped it on fumes and the overtime cleared.',
            effects: [
              performance(8),
              { kind: 'money', delta: 700 },
              { kind: 'stat', stat: 'health', delta: -5 },
              { kind: 'stat', stat: 'happiness', delta: -4 },
            ],
          },
          {
            weight: 3,
            text: 'You shipped it and nobody said a word about it.',
            effects: [
              performance(3),
              { kind: 'stat', stat: 'health', delta: -5 },
              { kind: 'stat', stat: 'happiness', delta: -7 },
            ],
          },
        ],
      },
      {
        label: 'Clock out at five',
        outcomes: [
          {
            weight: 5,
            text: 'You slept eight hours a night through the whole thing.',
            effects: [
              performance(-6),
              { kind: 'stat', stat: 'happiness', delta: 5 },
              { kind: 'stat', stat: 'health', delta: 2 },
            ],
          },
          {
            weight: 3,
            text: 'The deadline slipped for everyone. Nobody noticed you left.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: 3 }],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-adult-credit-stolen',
    area: 'work',
    icon: '📊',
    minAge: 20,
    maxAge: 64,
    weight: 4,
    condition: employed,
    text: 'A coworker presented your work. Your name never came up.',
    choices: [
      {
        label: 'Say something in the meeting',
        outcomes: [
          {
            weight: 4,
            text: 'You walked the room through the timeline. They got the point.',
            effects: [performance(6), { kind: 'stat', stat: 'happiness', delta: 4 }],
          },
          {
            weight: 3,
            text: 'You came off petty. The room sided with them.',
            effects: [performance(-5), { kind: 'stat', stat: 'happiness', delta: -5 }],
          },
        ],
      },
      {
        label: 'Let it slide',
        outcomes: [
          {
            weight: 1,
            text: 'You let it go and quietly updated your résumé.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: -4 }],
          },
        ],
      },
      {
        label: 'Take their next idea',
        outcomes: [
          {
            weight: 1,
            text: "You returned the favor in the next meeting. It's a culture now.",
            effects: [performance(3), { kind: 'stat', stat: 'happiness', delta: -1 }],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-adult-work-from-home',
    area: 'work',
    icon: '💻',
    minAge: 20,
    maxAge: 64,
    weight: 4,
    condition: employed,
    text: 'Your job went remote for a stretch. Pants became optional.',
    effects: [
      { kind: 'stat', stat: 'happiness', delta: 5 },
      { kind: 'stat', stat: 'health', delta: -1 },
      { kind: 'money', delta: 500 },
    ],
  },

  /* --- Money ------------------------------------------------------ */
  {
    id: 'ev-adult-tax-refund',
    area: 'money',
    icon: '🧾',
    minAge: 19,
    maxAge: 64,
    weight: 4,
    condition: free,
    text: 'Your tax refund came back bigger than the math you did.',
    effects: [
      { kind: 'money', delta: 1200 },
      { kind: 'stat', stat: 'happiness', delta: 4 },
    ],
  },
  {
    id: 'ev-adult-unexpected-bill',
    area: 'money',
    icon: '📬',
    minAge: 19,
    maxAge: 64,
    weight: 5,
    condition: free,
    text: 'A bill arrived for something you are fairly sure you already paid.',
    effects: [
      { kind: 'money', delta: -700 },
      { kind: 'stat', stat: 'happiness', delta: -4 },
    ],
  },
  {
    id: 'ev-adult-wallet-stolen',
    area: 'money',
    icon: '👛',
    minAge: 18,
    maxAge: 64,
    weight: 3,
    condition: free,
    text: 'Someone lifted your wallet on the train. Cards cancelled by lunch.',
    effects: [
      { kind: 'money', delta: -350 },
      { kind: 'stat', stat: 'happiness', delta: -5 },
    ],
  },
  {
    id: 'ev-adult-scam-email',
    area: 'money',
    icon: '📧',
    minAge: 18,
    maxAge: 64,
    weight: 4,
    condition: free,
    text: 'An email says a foreign bank is holding a fortune in your name. They just need a transfer fee.',
    choices: [
      {
        label: 'Delete it',
        outcomes: [
          {
            weight: 1,
            text: 'You deleted it and felt smug about it for a week.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: 2 }],
          },
        ],
      },
      {
        label: 'Wire the fee',
        condition: (ctx) => ctx.c.money >= 800,
        outcomes: [
          {
            weight: 6,
            text: 'The bank never existed. Neither does your $800.',
            effects: [
              { kind: 'money', delta: -800 },
              { kind: 'stat', stat: 'happiness', delta: -8 },
              { kind: 'stat', stat: 'smarts', delta: -1 },
            ],
          },
          {
            weight: 2,
            text: 'Your bank flagged the transfer and stopped it. A teller explained why.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: -3 },
              { kind: 'stat', stat: 'smarts', delta: 1 },
            ],
          },
        ],
      },
      {
        label: 'Waste their time',
        outcomes: [
          {
            weight: 1,
            text: 'You strung them along for three weeks. Free entertainment.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 4 },
              { kind: 'stat', stat: 'smarts', delta: 1 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-adult-garage-sale-find',
    area: 'money',
    icon: '🏷️',
    minAge: 18,
    maxAge: 64,
    weight: 3,
    condition: free,
    text: 'You bought a lamp at a yard sale. The base turned out to be worth something.',
    effects: [
      { kind: 'money', delta: 700 },
      { kind: 'stat', stat: 'happiness', delta: 4 },
    ],
  },
  {
    id: 'ev-adult-rent-hike',
    area: 'money',
    icon: '🏚️',
    minAge: 19,
    maxAge: 64,
    weight: 4,
    condition: renting,
    text: 'Your landlord raised the rent, then repainted the hallway to justify it.',
    effects: [
      { kind: 'money', delta: -900 },
      { kind: 'stat', stat: 'happiness', delta: -5 },
    ],
  },
  {
    id: 'ev-adult-investment-tip',
    area: 'money',
    icon: '📈',
    minAge: 20,
    maxAge: 64,
    weight: 3,
    condition: free,
    text: 'A guy at the gym has a stock tip. He is extremely confident.',
    choices: [
      {
        label: 'Put in $1,000',
        condition: (ctx) => ctx.c.money >= 1000,
        outcomes: [
          {
            weight: 3,
            text: 'It tripled by autumn. You sold and told nobody.',
            effects: [
              { kind: 'money', delta: 2500 },
              { kind: 'stat', stat: 'happiness', delta: 7 },
            ],
          },
          {
            weight: 4,
            text: 'It went to zero by Thursday.',
            effects: [
              { kind: 'money', delta: -1000 },
              { kind: 'stat', stat: 'happiness', delta: -6 },
            ],
          },
          {
            weight: 3,
            text: 'It went nowhere for a year. You broke even and got bored.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: -1 }],
          },
        ],
      },
      {
        label: 'Pass',
        outcomes: [
          {
            weight: 1,
            text: 'You passed. He posted about the loss for months.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: 2 }],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-adult-inheritance',
    area: 'money',
    icon: '💰',
    minAge: 26,
    maxAge: 64,
    weight: 2,
    oncePerLife: true,
    condition: free,
    text: 'A great-aunt you barely remember left you something in her will.',
    effects: [
      { kind: 'money', delta: 9000 },
      { kind: 'stat', stat: 'happiness', delta: 5 },
    ],
  },

  /* --- Love and family -------------------------------------------- */
  {
    id: 'ev-adult-meet-cute',
    area: 'love',
    icon: '☕',
    minAge: 18,
    maxAge: 64,
    weight: 5,
    condition: (ctx) => free(ctx) && romanceOf(ctx.state) === undefined,
    text: 'You and a stranger reached for the same thing at the same time. They laughed first.',
    choices: [
      {
        label: 'Ask for their number',
        outcomes: [
          {
            weight: 5,
            text: 'They typed it into your phone before you finished asking.',
            effects: [startRomance, { kind: 'stat', stat: 'happiness', delta: 9 }],
          },
          {
            weight: 3,
            text: 'They were kind about it, which somehow made it worse.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: -3 }],
          },
        ],
      },
      {
        label: 'Smile and move on',
        outcomes: [
          {
            weight: 1,
            text: 'You smiled, walked off, and thought about it all week.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: 1 }],
          },
        ],
      },
    ],
  },
  /* The anniversary and the in-laws used to live here too, at ages 18-64, and
     the relationships pack ships both for the whole life. A married character
     therefore carried eight weight of "another year together" and six of "your
     in-laws have opinions" instead of the four and three either author wrote,
     so this pack dropped its copies: `ev-rel-anniversary` and `ev-rel-in-laws`
     are the single home for both beats, and they took the flavour with them. */
  {
    id: 'ev-adult-partner-wants-pet',
    area: 'love',
    icon: '🐕',
    minAge: 18,
    maxAge: 64,
    weight: 3,
    condition: (ctx) => free(ctx) && romanceOf(ctx.state) !== undefined,
    text: '{partner} has sent you seventeen photos of the same shelter dog.',
    choices: [
      {
        label: 'Adopt the dog',
        condition: (ctx) => ctx.c.money >= 300,
        outcomes: [
          {
            weight: 1,
            text: 'The dog moved in that weekend and took the good side of the bed.',
            effects: [
              adoptPet('dog'),
              { kind: 'money', delta: -300 },
              { kind: 'stat', stat: 'happiness', delta: 8 },
              { kind: 'rel', who: 'partner', delta: 6 },
            ],
          },
        ],
      },
      {
        label: 'Not right now',
        outcomes: [
          {
            weight: 1,
            text: 'You said maybe next year. {partner} kept the photos.',
            effects: [
              { kind: 'rel', who: 'partner', delta: -6 },
              { kind: 'stat', stat: 'happiness', delta: -2 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-adult-baby-fever',
    area: 'love',
    icon: '👶',
    minAge: 20,
    maxAge: 45,
    weight: 3,
    condition: (ctx) =>
      free(ctx) && spouseOf(ctx.state) !== undefined && childCount(ctx.state) < 3,
    text: '{partner} keeps leaving nursery catalogues where you will find them.',
    choices: [
      {
        label: 'Try for a baby',
        outcomes: [
          {
            weight: 6,
            text: 'It happened faster than either of you expected.',
            effects: [
              haveBaby,
              { kind: 'stat', stat: 'happiness', delta: 10 },
              { kind: 'stat', stat: 'health', delta: -2 },
              { kind: 'money', delta: -1200 },
              { kind: 'rel', who: 'partner', delta: 6 },
            ],
          },
          {
            weight: 4,
            text: 'Not this year. You are both trying not to make it a thing.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: -3 },
              { kind: 'rel', who: 'partner', delta: 2 },
            ],
          },
        ],
      },
      {
        label: 'Not yet',
        outcomes: [
          {
            weight: 1,
            text: 'You said not yet. {partner} heard something shorter.',
            effects: [
              { kind: 'rel', who: 'partner', delta: -6 },
              { kind: 'stat', stat: 'happiness', delta: -2 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-adult-toddler-chaos',
    area: 'family',
    icon: '🖍️',
    minAge: 18,
    maxAge: 64,
    weight: 4,
    condition: (ctx) => free(ctx) && childAged(ctx.state, 0, 4) !== undefined,
    text: (ctx) => {
      const kid = childAged(ctx.state, 0, 4);
      const who = kid ? firstNameOf(kid, 'Your toddler') : 'Your toddler';
      return `${who} found a permanent marker and every white wall in the house.`;
    },
    effects: [
      { kind: 'stat', stat: 'happiness', delta: -3 },
      { kind: 'stat', stat: 'health', delta: -1 },
      { kind: 'money', delta: -250 },
    ],
  },
  {
    id: 'ev-adult-teen-rebellion',
    area: 'family',
    icon: '🚪',
    minAge: 28,
    maxAge: 64,
    weight: 3,
    condition: (ctx) => free(ctx) && childAged(ctx.state, 13, 17) !== undefined,
    text: (ctx) => {
      const kid = childAged(ctx.state, 13, 17);
      const who = kid ? firstNameOf(kid, 'Your teenager') : 'Your teenager';
      return `${who} came home at 3am with no explanation and no apology.`;
    },
    choices: [
      {
        label: 'Ground them',
        outcomes: [
          {
            weight: 4,
            text: 'They served the sentence and slammed exactly one door.',
            effects: [
              relWith((state) => childAged(state, 13, 17), -8),
              { kind: 'stat', stat: 'happiness', delta: -2 },
            ],
          },
          {
            weight: 2,
            text: 'They climbed out the window the following Friday.',
            effects: [
              relWith((state) => childAged(state, 13, 17), -12),
              { kind: 'stat', stat: 'happiness', delta: -5 },
            ],
          },
        ],
      },
      {
        label: 'Ask what is going on',
        outcomes: [
          {
            weight: 3,
            text: 'They told you. Half of it, anyway. It was a start.',
            effects: [
              relWith((state) => childAged(state, 13, 17), 8),
              { kind: 'stat', stat: 'happiness', delta: 4 },
            ],
          },
          {
            weight: 2,
            text: 'You got a shrug and a closed door.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: -3 }],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-adult-family-reunion',
    area: 'family',
    icon: '👨‍👩‍👧',
    minAge: 18,
    maxAge: 64,
    weight: 4,
    condition: (ctx) => free(ctx) && hasBloodFamily(ctx.state),
    text: 'There is a family reunion this summer. Somebody already rented a hall.',
    choices: [
      {
        label: 'Go',
        outcomes: [
          {
            weight: 4,
            text: 'You ate too much and laughed at stories you have heard forty times.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 6 },
              { kind: 'rel', who: 'random-family', delta: 6 },
              { kind: 'money', delta: -300 },
            ],
          },
          {
            weight: 2,
            text: 'Two hours in, the old argument restarted from where it left off.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: -4 },
              { kind: 'rel', who: 'random-family', delta: -5 },
              { kind: 'money', delta: -300 },
            ],
          },
        ],
      },
      {
        label: 'Send a card',
        outcomes: [
          {
            weight: 1,
            text: 'You sent a card instead. It was noticed.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 1 },
              { kind: 'rel', who: 'random-family', delta: -5 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-adult-sibling-loan',
    area: 'family',
    icon: '🤝',
    minAge: 20,
    maxAge: 64,
    weight: 3,
    condition: (ctx) => free(ctx) && siblingOf(ctx.state) !== undefined,
    text: (ctx) => {
      const sib = siblingOf(ctx.state);
      const who = sib ? firstNameOf(sib, 'Your sibling') : 'Your sibling';
      return `${who} needs $1,500 and swears this is the last time.`;
    },
    choices: [
      {
        label: 'Lend it',
        condition: (ctx) => ctx.c.money >= 1500,
        outcomes: [
          {
            weight: 4,
            text: 'Paid back inside a year, with interest and a decent bottle of wine.',
            effects: [
              { kind: 'money', delta: -1500 },
              { kind: 'money', delta: 1700 },
              relWith(siblingOf, 8),
              { kind: 'stat', stat: 'happiness', delta: 3 },
            ],
          },
          {
            weight: 4,
            text: 'You never saw it again. Neither, apparently, did they.',
            effects: [
              { kind: 'money', delta: -1500 },
              relWith(siblingOf, -10),
              { kind: 'stat', stat: 'happiness', delta: -6 },
            ],
          },
        ],
      },
      {
        label: 'Say no',
        outcomes: [
          {
            weight: 1,
            text: 'You said no. The holidays will be quiet this year.',
            effects: [
              relWith(siblingOf, -12),
              { kind: 'stat', stat: 'happiness', delta: -3 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-adult-parents-aging',
    area: 'family',
    icon: '🧓',
    minAge: 30,
    maxAge: 64,
    weight: 4,
    condition: (ctx) => free(ctx) && agingParent(ctx.state) !== undefined,
    text: (ctx) => {
      const parent = agingParent(ctx.state);
      if (!parent) return 'Your parents are getting older faster than you had planned for.';
      const who = parent.kind === 'mother' ? 'mother' : 'father';
      return `Your ${who} is ${parent.age} now and moves slower than ${parent.name} will admit.`;
    },
    effects: [
      { kind: 'stat', stat: 'happiness', delta: -5 },
      { kind: 'money', delta: -400 },
      relWith(agingParent, 5),
    ],
  },

  /* --- Health-adjacent -------------------------------------------- */
  {
    id: 'ev-adult-gym-resolution',
    area: 'health',
    icon: '🏋️',
    minAge: 18,
    maxAge: 64,
    weight: 5,
    condition: free,
    text: 'January. The gym has a deal and you have a plan.',
    choices: [
      {
        label: 'Sign up and actually go',
        condition: (ctx) => ctx.c.money >= 400,
        outcomes: [
          {
            weight: 4,
            text: 'Three months in, it stopped being a chore.',
            effects: [
              { kind: 'flag', flag: 'gymRegular', value: true },
              { kind: 'money', delta: -400 },
              { kind: 'stat', stat: 'health', delta: 6 },
              { kind: 'stat', stat: 'looks', delta: 3 },
              { kind: 'stat', stat: 'happiness', delta: 4 },
            ],
          },
          {
            weight: 3,
            text: 'You went twice. The membership renews automatically.',
            effects: [
              { kind: 'money', delta: -400 },
              { kind: 'stat', stat: 'happiness', delta: -3 },
            ],
          },
        ],
      },
      {
        label: 'Just run outside',
        outcomes: [
          {
            weight: 3,
            text: 'Free, miserable, effective.',
            effects: [
              { kind: 'stat', stat: 'health', delta: 5 },
              { kind: 'stat', stat: 'happiness', delta: 1 },
            ],
          },
          {
            weight: 2,
            text: 'You ran once. It rained for the rest of the year.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: -2 }],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-adult-food-poisoning',
    area: 'health',
    icon: '🍣',
    minAge: 18,
    maxAge: 64,
    weight: 4,
    /* The illness effect is idempotent but the health and mood it costs are not,
       so a second telling while the first bout is still running would charge for
       a diagnosis the character already has. */
    condition: (ctx) => free(ctx) && !holds(ctx.c, 'ill-food-poisoning'),
    text: 'The gas station sushi seemed fine at the time.',
    effects: [
      { kind: 'illness', add: 'ill-food-poisoning' },
      { kind: 'stat', stat: 'health', delta: -3 },
      { kind: 'stat', stat: 'happiness', delta: -5 },
    ],
  },
  /* A sleepless week used to sit here as well, at slightly harsher numbers than
     the health pack's `ev-health-insomnia` — the same bad-sleep card, drawn
     twice, and a bout the body has wherever it is kept. The health pack keeps
     it, for every age rather than only 18-64, and took the second telling. */
  {
    id: 'ev-adult-desk-back-pain',
    area: 'health',
    icon: '🪑',
    minAge: 25,
    maxAge: 64,
    weight: 3,
    // A bad back is developed once, not caught every few years.
    oncePerLife: true,
    /* And not developed at all once `healthPhase` has already handed it over:
       the illness effect would add nothing, but the health and mood it costs
       would still land and the once-per-life slot would be spent on a no-op. */
    condition: (ctx) => employed(ctx) && !holds(ctx.c, 'ill-back-pain'),
    text: 'Your chair, your posture and your job have been arguing about your spine.',
    effects: [
      { kind: 'illness', add: 'ill-back-pain' },
      { kind: 'stat', stat: 'health', delta: -2 },
      { kind: 'stat', stat: 'happiness', delta: -3 },
    ],
  },
  {
    id: 'ev-adult-midlife-crisis',
    area: 'health',
    icon: '🏎️',
    minAge: 45,
    maxAge: 55,
    weight: 5,
    oncePerLife: true,
    condition: free,
    text: 'You caught yourself doing the math on how many summers are left.',
    choices: [
      {
        label: 'Buy the convertible',
        condition: (ctx) => ctx.c.money >= 18000,
        outcomes: [
          {
            weight: 1,
            text: 'Impractical, loud, and the best money you ever spent.',
            effects: [
              { kind: 'money', delta: -18000 },
              { kind: 'stat', stat: 'happiness', delta: 14 },
              { kind: 'stat', stat: 'looks', delta: 3 },
            ],
          },
        ],
      },
      {
        label: 'Train for a marathon',
        outcomes: [
          {
            weight: 3,
            text: 'You finished. Slowly. You have the shirt and you wear it.',
            effects: [
              { kind: 'stat', stat: 'health', delta: 7 },
              { kind: 'stat', stat: 'happiness', delta: 6 },
            ],
          },
          {
            weight: 2,
            text: 'You made it to week four and a shin splint.',
            effects: [
              { kind: 'stat', stat: 'health', delta: -2 },
              { kind: 'stat', stat: 'happiness', delta: -2 },
            ],
          },
        ],
      },
      {
        label: 'Ride it out',
        outcomes: [
          {
            weight: 1,
            text: 'You bought a nicer coffee machine and let it pass.',
            effects: [
              { kind: 'money', delta: -400 },
              { kind: 'stat', stat: 'happiness', delta: 2 },
            ],
          },
        ],
      },
    ],
  },

  /* --- Random life ------------------------------------------------ */
  {
    id: 'ev-adult-jury-duty',
    area: 'life',
    icon: '⚖️',
    minAge: 18,
    maxAge: 64,
    weight: 5,
    oncePerLife: true,
    condition: free,
    text: 'A jury summons arrived with your name spelled correctly.',
    choices: [
      {
        label: 'Serve',
        outcomes: [
          {
            weight: 4,
            text: 'Two weeks of testimony. You took it seriously and the room noticed.',
            effects: [
              { kind: 'stat', stat: 'smarts', delta: 3 },
              { kind: 'stat', stat: 'happiness', delta: -2 },
              { kind: 'money', delta: 150 },
            ],
          },
          {
            weight: 2,
            text: 'It settled on day one. You read an entire novel in the hallway.',
            effects: [
              { kind: 'stat', stat: 'smarts', delta: 2 },
              { kind: 'stat', stat: 'happiness', delta: 2 },
              { kind: 'money', delta: 80 },
            ],
          },
        ],
      },
      {
        label: 'Get out of it',
        outcomes: [
          {
            weight: 3,
            text: 'You shared your views on the legal system. Dismissed by noon.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: 3 }],
          },
          {
            weight: 2,
            text: 'The judge did not buy a word of it. You served anyway, resentfully.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: -5 },
              { kind: 'stat', stat: 'smarts', delta: 1 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-adult-flat-tire',
    area: 'life',
    icon: '🛞',
    minAge: 18,
    maxAge: 64,
    weight: 4,
    condition: (ctx) => free(ctx) && ownsType(ctx, 'vehicle'),
    text: 'Flat tire, pouring rain, no spare.',
    effects: [
      { kind: 'money', delta: -220 },
      { kind: 'stat', stat: 'happiness', delta: -4 },
    ],
  },
  {
    id: 'ev-adult-house-leak',
    area: 'life',
    icon: '💧',
    minAge: 18,
    maxAge: 64,
    weight: 4,
    condition: (ctx) => free(ctx) && ownsType(ctx, 'property'),
    text: 'Water is coming through your ceiling and it is not raining.',
    choices: [
      {
        label: 'Call a plumber',
        outcomes: [
          {
            weight: 1,
            text: 'Fixed in a day. The invoice hurt more than the leak.',
            effects: [
              { kind: 'money', delta: -1800 },
              { kind: 'stat', stat: 'happiness', delta: -3 },
            ],
          },
        ],
      },
      {
        label: 'Fix it yourself',
        outcomes: [
          {
            weight: 3,
            text: 'One video and three hours later, it stopped.',
            effects: [
              { kind: 'money', delta: -250 },
              { kind: 'stat', stat: 'happiness', delta: 5 },
              { kind: 'stat', stat: 'smarts', delta: 2 },
            ],
          },
          {
            weight: 4,
            text: 'You made it worse. The plumber charged extra to undo your work.',
            effects: [
              { kind: 'money', delta: -2600 },
              { kind: 'stat', stat: 'happiness', delta: -6 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-adult-neighbor-feud',
    area: 'life',
    icon: '🔊',
    minAge: 19,
    maxAge: 64,
    weight: 4,
    condition: (ctx) => free(ctx) && ctx.c.flags.livesWithParents !== true,
    text: "Your neighbor's music starts at eleven and ends whenever.",
    choices: [
      {
        label: 'Knock on their door',
        outcomes: [
          {
            weight: 4,
            text: 'You talked it out over a beer. It genuinely stopped.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: 5 }],
          },
          {
            weight: 3,
            text: 'They turned it up the second you left the hallway.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: -4 }],
          },
        ],
      },
      {
        label: 'Report them',
        outcomes: [
          {
            weight: 3,
            text: 'The complaint worked. The hallway is a cold place now.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: 2 }],
          },
          {
            weight: 3,
            text: 'Your bike disappeared the following week. No witnesses.',
            effects: [
              { kind: 'money', delta: -450 },
              { kind: 'stat', stat: 'happiness', delta: -6 },
            ],
          },
        ],
      },
      {
        label: 'Buy earplugs',
        outcomes: [
          {
            weight: 1,
            text: 'Twenty dollars solved what a year of resentment could not.',
            effects: [
              { kind: 'money', delta: -20 },
              { kind: 'stat', stat: 'happiness', delta: 1 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-adult-lost-phone',
    area: 'life',
    icon: '📱',
    minAge: 18,
    maxAge: 64,
    weight: 4,
    condition: free,
    text: 'Your phone is gone. Last seen in a taxi, probably.',
    choices: [
      {
        label: 'Buy the new model',
        condition: (ctx) => ctx.c.money >= 900,
        outcomes: [
          {
            weight: 1,
            text: 'Painful, immediate, and honestly a nice upgrade.',
            effects: [
              { kind: 'money', delta: -900 },
              { kind: 'stat', stat: 'happiness', delta: 2 },
            ],
          },
        ],
      },
      {
        label: 'Get a cheap replacement',
        outcomes: [
          {
            weight: 1,
            text: 'It works. Barely. The camera is more of a rumor.',
            effects: [
              { kind: 'money', delta: -150 },
              { kind: 'stat', stat: 'happiness', delta: -3 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-adult-found-cash',
    area: 'life',
    icon: '💵',
    minAge: 18,
    maxAge: 64,
    weight: 5,
    condition: free,
    text: 'You found a folded hundred in an old coat.',
    effects: [
      { kind: 'money', delta: 100 },
      { kind: 'stat', stat: 'happiness', delta: 4 },
    ],
  },
  {
    id: 'ev-adult-viral-post',
    area: 'life',
    icon: '📲',
    minAge: 18,
    maxAge: 64,
    weight: 2,
    oncePerLife: true,
    condition: free,
    text: 'You posted something stupid at midnight. It got two million views.',
    effects: [
      { kind: 'fame', delta: 5 },
      { kind: 'stat', stat: 'happiness', delta: 6 },
    ],
  },
  {
    id: 'ev-adult-power-outage',
    area: 'life',
    icon: '🔌',
    minAge: 18,
    maxAge: 64,
    weight: 4,
    condition: free,
    text: 'The power was out for two days. Everything in the fridge went with it.',
    effects: [
      { kind: 'money', delta: -180 },
      { kind: 'stat', stat: 'happiness', delta: -3 },
    ],
  },
  {
    id: 'ev-adult-wrong-delivery',
    area: 'life',
    icon: '🍜',
    minAge: 18,
    maxAge: 64,
    weight: 4,
    condition: free,
    text: "The driver handed you somebody else's order. It smells incredible.",
    choices: [
      {
        label: 'Eat it',
        outcomes: [
          {
            weight: 1,
            text: "You ate a stranger's dinner and enjoyed every bite.",
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 4 },
              { kind: 'stat', stat: 'health', delta: -1 },
            ],
          },
        ],
      },
      {
        label: 'Call it in',
        outcomes: [
          {
            weight: 1,
            text: 'They sent your correct order and refunded the wrong one.',
            effects: [
              { kind: 'money', delta: 25 },
              { kind: 'stat', stat: 'happiness', delta: 2 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-adult-red-light',
    area: 'life',
    icon: '🚦',
    minAge: 18,
    maxAge: 64,
    weight: 4,
    condition: free,
    text: 'You ran a red light. The camera flashed behind you.',
    choices: [
      {
        label: 'Pay the fine',
        outcomes: [
          {
            weight: 1,
            text: 'You paid it online and drove like a grandparent for a month.',
            effects: [
              { kind: 'money', delta: -280 },
              { kind: 'stat', stat: 'happiness', delta: -3 },
            ],
          },
        ],
      },
      {
        label: 'Ignore the notice',
        outcomes: [
          {
            weight: 3,
            text: 'Nothing ever came of it.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: 3 }],
          },
          {
            weight: 3,
            text: 'It became a court date, a bigger fine and a line on your record.',
            effects: [
              { kind: 'money', delta: -900 },
              { kind: 'stat', stat: 'happiness', delta: -7 },
              convicted,
              {
                kind: 'log',
                icon: '⚖️',
                text: 'You were convicted of reckless driving.',
                logKind: 'legal',
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-adult-airport-nightmare',
    area: 'life',
    icon: '🛫',
    minAge: 18,
    maxAge: 64,
    weight: 3,
    condition: free,
    text: "Your flight was cancelled at midnight. So was everybody else's.",
    choices: [
      {
        label: 'Sleep in the terminal',
        outcomes: [
          {
            weight: 1,
            text: 'Four hours on a metal bench. You have never been more awake.',
            effects: [
              { kind: 'stat', stat: 'health', delta: -2 },
              { kind: 'stat', stat: 'happiness', delta: -6 },
            ],
          },
        ],
      },
      {
        label: 'Book a hotel room',
        condition: (ctx) => ctx.c.money >= 250,
        outcomes: [
          {
            weight: 1,
            text: 'You slept like a person. Nobody reimbursed anything.',
            effects: [
              { kind: 'money', delta: -250 },
              { kind: 'stat', stat: 'happiness', delta: -1 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-adult-surprise-party',
    area: 'life',
    icon: '🎂',
    minAge: 21,
    maxAge: 64,
    weight: 4,
    oncePerLife: true,
    condition: free,
    text: 'You walked into a dark room. Twenty people shouted at once.',
    effects: [
      { kind: 'stat', stat: 'happiness', delta: 12 },
      { kind: 'rel', who: 'random-family', delta: 5 },
    ],
  },

  /* --- Wildcards: the rest of being alive -------------------------- */
  {
    id: 'ev-adult-lottery-ticket',
    area: 'life',
    icon: '🎟️',
    minAge: 18,
    maxAge: 64,
    weight: 2,
    condition: free,
    text: 'There is an unscratched lottery ticket on the sidewalk.',
    choices: [
      {
        label: 'Scratch it',
        outcomes: [
          {
            weight: 6,
            text: 'Four dollars. You bought a coffee with it.',
            effects: [
              { kind: 'money', delta: 4 },
              { kind: 'stat', stat: 'happiness', delta: 1 },
            ],
          },
          {
            weight: 3,
            text: 'Two thousand five hundred dollars. You checked it eleven times.',
            effects: [
              { kind: 'money', delta: 2500 },
              { kind: 'stat', stat: 'happiness', delta: 10 },
            ],
          },
          {
            weight: 1,
            text: 'Sixty thousand dollars. You had to sit down on the curb.',
            effects: [
              { kind: 'money', delta: 60000 },
              { kind: 'stat', stat: 'happiness', delta: 20 },
              { kind: 'flag', flag: 'casino:lotteryWin', value: true },
            ],
          },
        ],
      },
      {
        label: 'Leave it',
        outcomes: [
          {
            weight: 1,
            text: 'You left it for somebody who needed it more.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: 2 }],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-adult-street-performer',
    area: 'life',
    icon: '🎻',
    minAge: 18,
    maxAge: 64,
    weight: 5,
    condition: free,
    text: 'A busker in the square was far too good for the square.',
    effects: [
      { kind: 'money', delta: -10 },
      { kind: 'stat', stat: 'happiness', delta: 5 },
    ],
  },
  {
    id: 'ev-adult-stray-cat',
    area: 'life',
    icon: '🐈',
    minAge: 18,
    maxAge: 64,
    weight: 3,
    condition: free,
    text: 'A stray cat followed you home and sat down like it had been invited.',
    choices: [
      {
        label: 'Keep it',
        condition: (ctx) => ctx.c.money >= 150,
        outcomes: [
          {
            weight: 1,
            text: 'It picked you. The vet bill confirmed the arrangement.',
            effects: [
              adoptPet('cat'),
              { kind: 'money', delta: -150 },
              { kind: 'stat', stat: 'happiness', delta: 8 },
            ],
          },
        ],
      },
      {
        label: 'Take it to a shelter',
        outcomes: [
          {
            weight: 1,
            text: 'The shelter took it in. You checked their website twice a day.',
            effects: [
              { kind: 'money', delta: -20 },
              { kind: 'stat', stat: 'happiness', delta: 2 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-adult-old-friend',
    area: 'life',
    icon: '📞',
    minAge: 20,
    maxAge: 64,
    weight: 3,
    condition: free,
    text: 'An old friend messaged out of nowhere. Three hours went by.',
    effects: [reconnectFriend, { kind: 'stat', stat: 'happiness', delta: 6 }],
  },
  {
    id: 'ev-adult-class-reunion',
    area: 'life',
    icon: '🎓',
    minAge: 28,
    maxAge: 40,
    weight: 4,
    oncePerLife: true,
    condition: free,
    text: 'Your high school reunion is this weekend. The group chat is unbearable.',
    choices: [
      {
        label: 'Go and work the room',
        outcomes: [
          {
            weight: 4,
            text: 'You looked good, you knew it, and everybody else knew it too.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 8 },
              { kind: 'money', delta: -120 },
            ],
          },
          {
            weight: 3,
            text: 'Everyone asked what you do now. You had practiced the answer in the car.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: -5 },
              { kind: 'money', delta: -120 },
            ],
          },
        ],
      },
      {
        label: 'Skip it',
        outcomes: [
          {
            weight: 1,
            text: 'You stayed home and looked everybody up online instead.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: 1 }],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-adult-blackout-karaoke',
    area: 'life',
    icon: '🎤',
    minAge: 21,
    maxAge: 55,
    weight: 3,
    condition: free,
    text: 'You do not remember the second half of karaoke night. Others do.',
    effects: [
      { kind: 'stat', stat: 'happiness', delta: 5 },
      { kind: 'stat', stat: 'health', delta: -1 },
      { kind: 'stat', stat: 'looks', delta: -1 },
      { kind: 'money', delta: -90 },
    ],
  },
  {
    id: 'ev-adult-gym-celebrity',
    area: 'life',
    icon: '🕶️',
    minAge: 18,
    maxAge: 64,
    weight: 3,
    condition: (ctx) => free(ctx) && ctx.c.flags.gymRegular === true,
    text: 'Somebody genuinely famous was on the treadmill next to you.',
    effects: [
      { kind: 'stat', stat: 'happiness', delta: 5 },
      { kind: 'fame', delta: 2 },
    ],
  },
  {
    id: 'ev-adult-deja-vu',
    area: 'life',
    icon: '🌀',
    minAge: 18,
    maxAge: 64,
    weight: 5,
    condition: free,
    text: 'You have stood in this exact spot saying this exact sentence before.',
    effects: [
      { kind: 'stat', stat: 'happiness', delta: 2 },
      { kind: 'stat', stat: 'smarts', delta: 1 },
    ],
  },
  {
    id: 'ev-adult-charity-ask',
    area: 'life',
    icon: '🎗️',
    minAge: 18,
    maxAge: 64,
    weight: 4,
    condition: free,
    text: 'Somebody with a clipboard blocked the sidewalk for a good cause.',
    choices: [
      {
        label: 'Donate $200',
        condition: (ctx) => ctx.c.money >= 200,
        outcomes: [
          {
            weight: 1,
            text: 'You gave more than you meant to and felt good about it for weeks.',
            effects: [
              { kind: 'money', delta: -200 },
              { kind: 'stat', stat: 'happiness', delta: 6 },
              { kind: 'flag', flag: 'adult:charityGiven', value: true },
            ],
          },
        ],
      },
      {
        label: 'Give what is in your pocket',
        outcomes: [
          {
            weight: 1,
            text: 'Twenty dollars and a genuine thank you.',
            effects: [
              { kind: 'money', delta: -20 },
              { kind: 'stat', stat: 'happiness', delta: 3 },
            ],
          },
        ],
      },
      {
        label: 'Keep walking',
        outcomes: [
          {
            weight: 1,
            text: 'You studied your phone until you were safely past.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: -2 }],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-adult-new-hobby',
    area: 'life',
    icon: '🎨',
    minAge: 18,
    maxAge: 64,
    weight: 4,
    condition: free,
    text: "You bought a beginner's kit for something you had never tried.",
    effects: [
      { kind: 'money', delta: -180 },
      { kind: 'stat', stat: 'happiness', delta: 5 },
      { kind: 'stat', stat: 'smarts', delta: 2 },
    ],
  },
  {
    id: 'ev-adult-bad-haircut',
    area: 'life',
    icon: '💇',
    minAge: 18,
    maxAge: 64,
    weight: 4,
    condition: free,
    text: 'You asked for a trim and got a statement.',
    effects: [
      { kind: 'stat', stat: 'looks', delta: -2 },
      { kind: 'stat', stat: 'happiness', delta: -3 },
    ],
  },
  {
    id: 'ev-adult-caught-in-rain',
    area: 'life',
    icon: '🌧️',
    minAge: 18,
    maxAge: 64,
    weight: 5,
    condition: free,
    text: 'The rain caught you halfway home, so you stopped hurrying.',
    effects: [{ kind: 'stat', stat: 'happiness', delta: 3 }],
  },
];

/** Random events for ages 18-64: work, money, love, family and misfortune. */
export const eventsAdultPack: ContentPack = {
  id: 'events-adult',
  events,
};
