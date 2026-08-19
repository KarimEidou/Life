import { sellAsset } from '@/engine/phases/finance';
import type {
  AssetDef,
  ContentPack,
  ContentRegistry,
  Ctx,
  Effect,
  EffectCtx,
  EventDef,
  GameState,
  OwnedAsset,
  Person,
} from '@/types';

/**
 * Random events for ages 65+: retirement, grandchildren, frailty and legacy.
 *
 * Same defensive rule the other event packs follow: every condition here runs
 * against whatever `GameState` the engine is holding — a save from an older
 * build, a life whose spouse died two phases ago, a character who never had
 * children — so nothing reads a person, a pension or a property without proving
 * it exists first. The lookups at the top are the only place that happens.
 *
 * Prison is the blanket exclusion: `eventsPhase` keeps drawing while the
 * character is inside, and a garden club in a cell reads as a bug, so almost
 * everything below asks `free` first.
 *
 * There are no grandchildren in the type contract, so an adult child stands in
 * for one: a living child of 25 or more is treated as somebody with kids of
 * their own.
 */

/* ------------------------------------------------------------------ */
/* Lookups                                                             */
/* ------------------------------------------------------------------ */

/** Everyone still alive. Widened first: a loaded save can hold a hole. */
function alivePeople(state: GameState): Person[] {
  const list: (Person | undefined)[] = Object.values(state.people);
  return list.filter((p): p is Person => p !== undefined && p.alive === true);
}

function spouseOf(state: GameState): Person | undefined {
  return alivePeople(state).find((p) => p.kind === 'spouse');
}

/** A living child old enough to plausibly have children of their own. */
function grownChild(state: GameState): Person | undefined {
  return alivePeople(state).find((p) => p.kind === 'child' && p.age >= 25);
}

/** The name a sentence should call somebody, never an empty string. */
function firstNameOf(person: Person, fallback: string): string {
  const parts = person.name.trim().split(/\s+/);
  return parts[0] || fallback;
}

/** Not behind bars. Asked by nearly everything: the prison pack owns those years. */
function free(ctx: Ctx): boolean {
  return ctx.c.prison === null;
}

/** True while the character is already carrying this condition, treated or not. */
function holds(ctx: Ctx, defId: string): boolean {
  return ctx.c.illnesses.some((illness) => illness.defId === defId);
}

/** Flags are free-form JSON; only a genuine finite number counts as a pension. */
function drawingPension(ctx: Ctx): boolean {
  const pension = ctx.c.flags.pensionSalary;
  return typeof pension === 'number' && Number.isFinite(pension) && pension > 0;
}

/**
 * There was a career behind this life.
 *
 * `jobsHeld` counts every hire and promotion, `lastJobTitle` is stamped by all
 * four ways out of a job — retirement, a firing, a layoff, a resignation — and
 * nothing in a life clears either, so between them they are the only record that
 * a character who holds no job today ever held one. The obituary reads the same
 * pair. Flags are free-form JSON, so neither is trusted to hold what it usually
 * holds, and the counter a legacy heir starts at zero is no career.
 */
function everWorked(ctx: Ctx): boolean {
  const held = ctx.c.flags.jobsHeld;
  if (typeof held === 'number' && Number.isFinite(held) && held > 0) return true;
  const title = ctx.c.flags.lastJobTitle;
  return typeof title === 'string' && title !== '';
}

/** Enough of the world to find an owned asset in it; `Ctx` and `EffectCtx` both fit. */
interface World {
  state: GameState;
  reg: ContentRegistry;
}

/**
 * The most valuable property owned, or nobody.
 *
 * The registry is the truth; the id prefix is the fallback for a save naming a
 * def this build no longer ships, which is exactly when a `prop-` row would
 * otherwise stop counting as a house.
 */
function priciestProperty(world: World): OwnedAsset | undefined {
  const byId: Record<string, AssetDef | undefined> = world.reg.assetsById;
  let best: OwnedAsset | undefined;
  for (const owned of world.state.character.assets) {
    const def = byId[owned.defId];
    const isProperty = def ? def.type === 'property' : owned.defId.startsWith('prop-');
    if (!isProperty) continue;
    if (!best || owned.value > best.value) best = owned;
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Effect helpers                                                      */
/* ------------------------------------------------------------------ */

/** Same 0..100 rounding the engine applies to stats, for the fields it does not own. */
function clamped(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const bounded = n < 0 ? 0 : n > 100 ? 100 : n;
  return Math.round(bounded * 10) / 10;
}

/**
 * Moves affinity with one person picked out of the table.
 * `{kind:'rel'}` addresses people by sentinel or explicit id, and neither names
 * "the child who drove over on Sunday", so those land here instead.
 */
function relWith(pick: (state: GameState) => Person | undefined, delta: number): Effect {
  return {
    kind: 'fn',
    run: (ctx: EffectCtx) => {
      const person = pick(ctx.state);
      if (!person) return;
      person.rel = clamped(person.rel + delta);
    },
  };
}

/**
 * Sells the big house.
 *
 * `sellAsset` is the engine's own sale: it fetches the resale rate, settles any
 * loan secured against the place and writes its own money line, none of which a
 * hand-rolled effect would get right. It logs before the outcome text, so the
 * lines below are written to read after a sale, not before one.
 */
const sellTheHouse: Effect = {
  kind: 'fn',
  run: (ctx: EffectCtx) => {
    const home = priciestProperty(ctx);
    if (!home) return;
    sellAsset(ctx.state, home.id);
  },
};

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

const events: EventDef[] = [
  {
    id: 'ev-senior-retirement-party',
    area: 'work',
    icon: '🏖️',
    minAge: 65,
    /* The window has to reach well past retirement, which the career phase puts
       at 70: a worker holds their job until then, so a window closing at 72 left
       a whole career three years to draw its own send-off while a life that
       never worked had eight of them. */
    maxAge: 80,
    weight: 5,
    oncePerLife: true,
    /* Out of work and once in it, not merely out of work: `job === null` alone is
       true of everyone who never worked at all. The pension cannot carry the
       second half by itself either — the career phase only mints one for a seat
       still held at retirement, so a career ended by a firing, a layoff or a
       resignation leaves none behind. */
    condition: (ctx: Ctx) =>
      free(ctx) && ctx.c.job === null && (drawingPension(ctx) || everWorked(ctx)),
    text: 'Your old department threw you a retirement party. The sheet cake spelled your name wrong.',
    effects: [
      { kind: 'stat', stat: 'happiness', delta: 9 },
      { kind: 'money', delta: 250 },
    ],
  },
  {
    id: 'ev-senior-grandkid-visit',
    area: 'family',
    icon: '👶',
    minAge: 65,
    maxAge: 120,
    weight: 6,
    condition: (ctx: Ctx) => free(ctx) && grownChild(ctx.state) !== undefined,
    text: (ctx: Ctx) => {
      const child = grownChild(ctx.state);
      const who = child ? firstNameOf(child, 'Your child') : 'Your child';
      return `${who} brought the grandkids over. They ate everything in the house and left glitter in the rug.`;
    },
    effects: [
      { kind: 'stat', stat: 'happiness', delta: 8 },
      { kind: 'stat', stat: 'health', delta: -1 },
      relWith(grownChild, 3),
    ],
  },
  {
    id: 'ev-senior-scam-call',
    area: 'money',
    icon: '📞',
    minAge: 65,
    maxAge: 120,
    weight: 6,
    condition: free,
    text: 'A very polite young man called about a problem with your bank account. He needs it settled in gift cards.',
    choices: [
      {
        label: 'Hang up',
        outcomes: [
          {
            weight: 5,
            text: 'You hung up mid-sentence. Nobody teaches manners any more.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: 2 }],
          },
          {
            weight: 2,
            text: 'You hung up and reported the number. Two neighbours thanked you for it.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 4 },
              { kind: 'stat', stat: 'smarts', delta: 1 },
            ],
          },
        ],
      },
      {
        label: 'Hear him out',
        outcomes: [
          {
            weight: 4,
            text: 'You bought twelve hundred dollars in gift cards for a man calling himself Officer Dave.',
            effects: [
              { kind: 'money', delta: -1200 },
              { kind: 'stat', stat: 'happiness', delta: -8 },
            ],
          },
          {
            weight: 3,
            text: 'You strung him along for forty minutes until he hung up on you.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 6 },
              { kind: 'stat', stat: 'smarts', delta: 1 },
            ],
          },
          {
            weight: 2,
            text: 'He got the account number. The bank got most of it back. Most.',
            effects: [
              { kind: 'money', delta: -4000 },
              { kind: 'stat', stat: 'happiness', delta: -10 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-senior-bucket-list',
    area: 'life',
    icon: '🪂',
    minAge: 65,
    maxAge: 120,
    weight: 4,
    condition: free,
    text: 'One line is left on the bucket list: jump out of a perfectly good plane.',
    choices: [
      {
        label: 'Jump',
        outcomes: [
          {
            weight: 5,
            text: 'You screamed the whole way down and would do it again tomorrow.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 12 },
              { kind: 'stat', stat: 'health', delta: -2 },
            ],
          },
          {
            weight: 2,
            text: 'The landing was harder than advertised. Worth it, said your hip, lying.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 7 },
              { kind: 'stat', stat: 'health', delta: -8 },
            ],
          },
          {
            weight: 1,
            text: 'You came down badly. The instructor called it a firm landing; the x-ray disagreed.',
            effects: [
              { kind: 'illness', add: 'ill-broken-bone' },
              { kind: 'stat', stat: 'health', delta: -6 },
              { kind: 'stat', stat: 'happiness', delta: 4 },
            ],
          },
        ],
      },
      {
        label: 'Stay on the ground',
        outcomes: [
          {
            weight: 1,
            text: 'You watched from the field and took the photographs. Somebody has to.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: 3 }],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-senior-memoirs',
    area: 'life',
    icon: '📓',
    minAge: 65,
    maxAge: 120,
    weight: 4,
    condition: free,
    text: 'A website says anybody can publish a memoir now. You certainly have the material.',
    choices: [
      {
        label: 'Write the book',
        outcomes: [
          {
            weight: 4,
            text: 'Three hundred pages. Your family features heavily and inaccurately.',
            effects: [
              { kind: 'stat', stat: 'smarts', delta: 3 },
              { kind: 'stat', stat: 'happiness', delta: 5 },
            ],
          },
          {
            weight: 3,
            text: 'It sold eleven copies, nine of them to relatives.',
            effects: [
              { kind: 'money', delta: 150 },
              { kind: 'stat', stat: 'smarts', delta: 2 },
              { kind: 'stat', stat: 'happiness', delta: 3 },
            ],
          },
          {
            weight: 1,
            text: 'The local paper reviewed it kindly and the print run sold out by Christmas.',
            effects: [
              { kind: 'money', delta: 4000 },
              { kind: 'fame', delta: 3 },
              { kind: 'stat', stat: 'happiness', delta: 8 },
            ],
          },
        ],
      },
      {
        label: 'Just tell the stories',
        outcomes: [
          {
            weight: 1,
            text: 'You told them out loud instead. Better audience, worse fact-checking.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: 4 }],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-senior-garden-club',
    area: 'life',
    icon: '🌱',
    minAge: 65,
    maxAge: 120,
    weight: 5,
    condition: free,
    text: 'You joined the garden club. The politics are vicious and the tomatoes are outstanding.',
    effects: [
      { kind: 'stat', stat: 'happiness', delta: 5 },
      { kind: 'stat', stat: 'health', delta: 2 },
    ],
  },
  {
    id: 'ev-senior-hip-trouble',
    area: 'health',
    icon: '🦴',
    minAge: 68,
    maxAge: 120,
    weight: 5,
    /* Once per bad back, not once a year: the illness effect is idempotent but
       the health and mood it costs are not, so a second telling would charge for
       a diagnosis the character already has. */
    condition: (ctx: Ctx) => free(ctx) && !holds(ctx, 'ill-back-pain'),
    text: 'Your hip started announcing the weather a day in advance.',
    effects: [
      { kind: 'illness', add: 'ill-back-pain' },
      { kind: 'stat', stat: 'health', delta: -4 },
      { kind: 'stat', stat: 'happiness', delta: -3 },
    ],
  },
  {
    id: 'ev-senior-early-bird',
    area: 'money',
    icon: '🍽️',
    minAge: 65,
    maxAge: 120,
    weight: 5,
    condition: free,
    text: 'You made the early bird special by four minutes. Soup, entree and pie, all in before five.',
    effects: [
      { kind: 'money', delta: -10 },
      { kind: 'stat', stat: 'happiness', delta: 4 },
      { kind: 'stat', stat: 'health', delta: 1 },
    ],
  },
  {
    id: 'ev-senior-tech-struggle',
    area: 'life',
    icon: '📱',
    minAge: 65,
    maxAge: 120,
    weight: 5,
    condition: free,
    text: 'Your phone updated itself overnight into something unrecognisable.',
    choices: [
      {
        label: 'Call a grandkid',
        /* The pack's grandchild stand-in, same as `ev-senior-grandkid-visit`: a
           child of 25 or more. Any living child would offer the call to the
           parent of a toddler — `rel-adopt` has no upper age — and land the
           affinity on whichever child the table lists first, grown or not. */
        condition: (ctx: Ctx) => grownChild(ctx.state) !== undefined,
        outcomes: [
          {
            weight: 4,
            text: 'Fixed in ninety seconds. You were told, again, to stop tapping so hard.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 5 },
              { kind: 'stat', stat: 'smarts', delta: 1 },
              relWith(grownChild, 3),
            ],
          },
          {
            weight: 2,
            text: 'They fixed it and signed you up for three streaming services on the way out.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 3 },
              { kind: 'money', delta: -40 },
            ],
          },
        ],
      },
      {
        label: 'Work it out yourself',
        outcomes: [
          {
            weight: 3,
            text: 'Two hours later you had it beaten, plus a new ringtone called Cosmic Frog.',
            effects: [
              { kind: 'stat', stat: 'smarts', delta: 2 },
              { kind: 'stat', stat: 'happiness', delta: 2 },
            ],
          },
          {
            weight: 3,
            text: 'You turned every setting to maximum size and surrendered.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: -3 }],
          },
        ],
      },
      {
        label: 'Put it in a drawer',
        outcomes: [
          {
            weight: 1,
            text: 'The phone lives in the drawer now. The house has never been quieter.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: 2 }],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-senior-photo-albums',
    area: 'family',
    icon: '📷',
    minAge: 65,
    maxAge: 120,
    weight: 5,
    condition: free,
    text: 'You went looking for a receipt and found the old albums instead. Three hours vanished.',
    effects: [{ kind: 'stat', stat: 'happiness', delta: 6 }],
  },
  {
    id: 'ev-senior-war-stories',
    area: 'life',
    icon: '🎖️',
    minAge: 65,
    maxAge: 120,
    weight: 4,
    condition: free,
    text: 'You told the one about the storm and the ferry again. It has grown a helicopter since last year.',
    effects: [
      { kind: 'stat', stat: 'happiness', delta: 4 },
      { kind: 'stat', stat: 'smarts', delta: -1 },
    ],
  },
  {
    id: 'ev-senior-senior-discount',
    area: 'money',
    icon: '🎫',
    minAge: 65,
    maxAge: 120,
    weight: 5,
    condition: free,
    text: 'The cashier gave you the senior discount without being asked. Mixed feelings, cheaper coffee.',
    effects: [
      { kind: 'money', delta: 25 },
      { kind: 'stat', stat: 'happiness', delta: 2 },
      { kind: 'stat', stat: 'looks', delta: -1 },
    ],
  },
  {
    id: 'ev-senior-pickleball',
    area: 'life',
    icon: '🏓',
    minAge: 65,
    maxAge: 120,
    weight: 5,
    condition: free,
    text: 'The pickleball league is recruiting. The average age is 71 and the average temper is worse.',
    choices: [
      {
        label: 'Sign up',
        outcomes: [
          {
            weight: 4,
            text: 'You are a doubles specialist now, with a nemesis named Dennis.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 7 },
              { kind: 'stat', stat: 'health', delta: 4 },
            ],
          },
          {
            weight: 2,
            text: 'You rolled an ankle in week two and coached loudly from a folding chair.',
            effects: [
              { kind: 'stat', stat: 'health', delta: -6 },
              { kind: 'stat', stat: 'happiness', delta: 2 },
            ],
          },
        ],
      },
      {
        label: 'Watch from the bench',
        outcomes: [
          {
            weight: 1,
            text: 'You kept score and judged everybody silently. Bliss.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: 3 }],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-senior-downsizing',
    area: 'money',
    icon: '📦',
    minAge: 65,
    maxAge: 120,
    weight: 4,
    condition: (ctx: Ctx) => free(ctx) && priciestProperty(ctx) !== undefined,
    text: 'The place has four bedrooms and one occupant. The stairs have started having opinions.',
    choices: [
      {
        label: 'Sell and downsize',
        outcomes: [
          {
            weight: 4,
            text: 'Somewhere with one floor and no gutters to clean. You slept beautifully.',
            effects: [
              sellTheHouse,
              { kind: 'stat', stat: 'happiness', delta: 5 },
              { kind: 'stat', stat: 'health', delta: 2 },
            ],
          },
          {
            weight: 2,
            text: 'You cried in the empty kitchen for ten minutes, then felt lighter than you had in years.',
            effects: [
              sellTheHouse,
              { kind: 'stat', stat: 'happiness', delta: -2 },
              { kind: 'stat', stat: 'health', delta: 2 },
            ],
          },
        ],
      },
      {
        label: 'Keep every room',
        outcomes: [
          {
            weight: 1,
            text: 'You kept all four bedrooms and the stairs kept their opinions.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 2 },
              { kind: 'stat', stat: 'health', delta: -2 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-senior-lost-glasses',
    area: 'life',
    icon: '👓',
    minAge: 65,
    maxAge: 120,
    weight: 6,
    condition: free,
    text: 'You searched the whole house for your glasses. They were on your head the entire time.',
    effects: [
      { kind: 'stat', stat: 'happiness', delta: -1 },
      { kind: 'stat', stat: 'smarts', delta: -1 },
    ],
  },
  {
    id: 'ev-senior-birdwatching',
    area: 'life',
    icon: '🐦',
    minAge: 65,
    maxAge: 120,
    weight: 4,
    condition: free,
    text: "You started a bird list. Today's entries: one heron, one goldfinch, one deeply suspicious pigeon.",
    effects: [
      { kind: 'stat', stat: 'happiness', delta: 4 },
      { kind: 'stat', stat: 'health', delta: 1 },
      { kind: 'stat', stat: 'smarts', delta: 1 },
    ],
  },
  {
    id: 'ev-senior-volunteer-mentor',
    area: 'life',
    icon: '🤝',
    minAge: 65,
    maxAge: 120,
    weight: 4,
    condition: free,
    text: 'You started mentoring at the community centre. The kids use your first name and mean it kindly.',
    effects: [
      { kind: 'stat', stat: 'happiness', delta: 8 },
      { kind: 'stat', stat: 'health', delta: 1 },
    ],
  },
  {
    id: 'ev-senior-coworker-reunion',
    area: 'work',
    icon: '🍻',
    minAge: 65,
    maxAge: 120,
    weight: 4,
    // There is no old team to meet if there was never a job. Still working is fine.
    condition: (ctx: Ctx) => free(ctx) && everWorked(ctx),
    text: 'The old team met for lunch. Half of them are retired and half are pretending not to be.',
    effects: [
      { kind: 'stat', stat: 'happiness', delta: 6 },
      { kind: 'money', delta: -35 },
    ],
  },
  {
    id: 'ev-senior-slow-dance',
    area: 'love',
    icon: '💃',
    minAge: 65,
    maxAge: 120,
    weight: 5,
    condition: (ctx: Ctx) => free(ctx) && spouseOf(ctx.state) !== undefined,
    text: '{partner} put the old record on and you danced in the kitchen until the song ran out.',
    effects: [
      { kind: 'stat', stat: 'happiness', delta: 8 },
      { kind: 'rel', who: 'partner', delta: 6 },
    ],
  },
  {
    id: 'ev-senior-road-trip',
    area: 'life',
    icon: '🚐',
    minAge: 75,
    maxAge: 120,
    weight: 4,
    oncePerLife: true,
    condition: free,
    text: 'There is one more drive in you: the coast road, no schedule, nobody expecting you anywhere.',
    choices: [
      {
        label: 'Go',
        outcomes: [
          {
            weight: 4,
            text: 'Eleven days, six diners and one alarming mountain pass. Worth all of it.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 12 },
              { kind: 'stat', stat: 'health', delta: -3 },
              { kind: 'money', delta: -1200 },
            ],
          },
          {
            weight: 2,
            text: 'You broke down outside a town with one mechanic and left with a friend.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 8 },
              { kind: 'money', delta: -2500 },
              { kind: 'stat', stat: 'health', delta: -2 },
            ],
          },
          {
            weight: 1,
            text: 'You made two hundred miles before your back called the whole thing off.',
            effects: [
              { kind: 'stat', stat: 'health', delta: -7 },
              { kind: 'stat', stat: 'happiness', delta: -4 },
              { kind: 'money', delta: -400 },
            ],
          },
        ],
      },
      {
        label: 'Stay home',
        outcomes: [
          {
            weight: 1,
            text: 'You planned the whole route, framed the map and stayed exactly where you were.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: 3 }],
          },
        ],
      },
    ],
  },
];

/** Random events for ages 65+: retirement, grandchildren, frailty and legacy. */
export const eventsSeniorPack: ContentPack = {
  id: 'events-senior',
  events,
};
