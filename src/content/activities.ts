import {
  ROLLED_GENDERS,
  addPerson,
  alivePets,
  counter,
  firstNameOf,
  free,
} from '@/content/lib';
import type { ContentPack, Ctx, Effect, EffectCtx, InteractionDef } from '@/types';

/**
 * Self-directed activities: gym, library, travel, nightlife, shopping and pets.
 *
 * Every row is a player action, so each one is priced, age-gated and — where
 * spamming it would be degenerate — put on a cooldown. Nothing here reads a
 * person or a flag without proving it exists first: a save can hold a pet that
 * died two phases ago, and `Character.flags` is plain JSON that may hold a
 * string where a counter is expected.
 *
 * Most rows also ask `free`, under the prison policy documented above `free` in
 * `@/content/lib`: a weekend in Bali from a cell reads as a bug. The two that
 * survive incarceration are the two the institution provides — a library and a
 * book — and they deliberately do not ask. The yard is not among them: it is
 * the crime pack's own `act-prison-workout`, and `act-gym` is the $40
 * membership outside it.
 */

/* ------------------------------------------------------------------ */
/* Lookups                                                             */
/* ------------------------------------------------------------------ */

function hasPet(ctx: Ctx): boolean {
  return alivePets(ctx.state).length > 0;
}

/** Bumps one of the character's own counters by a step. */
function bumpCounter(flag: string, step = 1): Effect {
  return {
    kind: 'fn',
    run: (ctx: EffectCtx) => {
      ctx.state.character.flags[flag] = counter(ctx.state, flag) + step;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Flavour pools                                                       */
/* ------------------------------------------------------------------ */

const LANGUAGES: readonly string[] = [
  'Spanish',
  'Japanese',
  'German',
  'Portuguese',
  'Arabic',
  'French',
  'Hindi',
];

const BOOKS: readonly string[] = [
  'a doorstop of a biography',
  'a thriller you guessed in chapter two',
  'a book about fungi',
  'a novel everyone pretends to have read',
  'a self-help book you argued with',
];

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
  'Marbles',
  'Gravy',
];

/** The house limit; a fifth animal is a lifestyle, not an activity. */
const MAX_PETS = 4;

/* ------------------------------------------------------------------ */
/* Row factories                                                       */
/* ------------------------------------------------------------------ */

interface TripSpec {
  id: string;
  label: string;
  icon: string;
  price: number;
  text: string;
  effects: Effect[];
}

/** One holiday: 18+, priced up front, one a year. */
function tripRow(spec: TripSpec): InteractionDef {
  return {
    id: spec.id,
    area: 'travel',
    label: spec.label,
    icon: spec.icon,
    cost: spec.price,
    minAge: 18,
    cooldownYears: 1,
    condition: free,
    resolve: () => ({ text: spec.text, effects: spec.effects }),
  };
}

interface PetSpec {
  id: string;
  label: string;
  icon: string;
  species: string;
  price: number;
  /** Cash the character must already be sitting on, beyond the price itself. */
  minMoney?: number;
  line: (name: string) => string;
}

/** One adoption: mints the animal and hands back the line that names it. */
function petRow(spec: PetSpec): InteractionDef {
  return {
    id: spec.id,
    area: 'pets',
    label: spec.label,
    icon: spec.icon,
    cost: spec.price,
    minAge: 6,
    condition: (ctx: Ctx) =>
      free(ctx) &&
      alivePets(ctx.state).length < MAX_PETS &&
      (spec.minMoney === undefined || ctx.c.money >= spec.minMoney),
    resolve: (ctx: Ctx) => {
      const name = ctx.rng.pick(PET_NAMES);
      const gender = ctx.rng.pick(ROLLED_GENDERS);
      const age = ctx.rng.int(0, 2);
      const rel = ctx.rng.int(70, 90);
      return {
        text: spec.line(name),
        effects: [
          {
            kind: 'fn',
            run: (ec: EffectCtx) => {
              addPerson(ec.state, {
                kind: 'pet',
                name,
                gender,
                age,
                alive: true,
                rel,
                petSpecies: spec.species,
                flags: {},
              });
            },
          },
          { kind: 'stat', stat: 'happiness', delta: 6 },
        ],
      };
    },
  };
}

/* ------------------------------------------------------------------ */
/* Mind and body                                                       */
/* ------------------------------------------------------------------ */

const mindBody: InteractionDef[] = [
  {
    id: 'act-gym',
    area: 'mind-body',
    label: 'Hit the Gym',
    icon: '🏋️',
    cost: 40,
    minAge: 12,
    /* A membership, a leg day and a lift home. `act-prison-workout` is the yard
       version, and `ev-health-gym-injury` already reads the habit as an outside
       one — it asks `free` before it will hand out the torn shoulder. */
    condition: free,
    resolve: (ctx: Ctx) => ({
      text: ctx.rng.chance(0.5)
        ? 'You lifted things and put them back down. It counts.'
        : 'Leg day. You took the lift home.',
      effects: [
        { kind: 'stat', stat: 'health', delta: 2 },
        { kind: 'stat', stat: 'happiness', delta: 2 },
        { kind: 'flag', flag: 'gymRegular', value: true },
      ],
    }),
  },
  {
    id: 'act-diet',
    area: 'mind-body',
    label: 'Start a Diet',
    icon: '🥗',
    cost: 100,
    minAge: 12,
    condition: free,
    resolve: () => ({
      text: 'You bought vegetables and, remarkably, ate them.',
      effects: [
        { kind: 'stat', stat: 'health', delta: 1 },
        { kind: 'flag', flag: 'goodDiet', value: true },
      ],
    }),
  },
  {
    id: 'act-library',
    area: 'mind-body',
    label: 'Go to the Library',
    icon: '📚',
    minAge: 6,
    resolve: () => ({
      text: 'You read three chapters and fell asleep on the fourth.',
      effects: [{ kind: 'stat', stat: 'smarts', delta: 2 }],
    }),
  },
  {
    id: 'act-read-book',
    area: 'mind-body',
    label: 'Read a Book',
    icon: '📖',
    minAge: 6,
    resolve: (ctx: Ctx) => ({
      text: `You finished ${ctx.rng.pick(BOOKS)}.`,
      effects: [
        { kind: 'stat', stat: 'smarts', delta: 1 },
        { kind: 'stat', stat: 'happiness', delta: 1 },
        bumpCounter('act:booksRead'),
      ],
    }),
  },
  {
    id: 'act-learn-language',
    area: 'mind-body',
    label: 'Learn a Language',
    icon: '🗣️',
    cost: 300,
    minAge: 8,
    cooldownYears: 1,
    condition: free,
    resolve: (ctx: Ctx) => ({
      text: `A year of ${ctx.rng.pick(LANGUAGES)}. You can now order food and apologise.`,
      effects: [
        { kind: 'stat', stat: 'smarts', delta: 3 },
        { kind: 'stat', stat: 'happiness', delta: 1 },
      ],
    }),
  },
  {
    id: 'act-instrument',
    area: 'mind-body',
    label: 'Play an Instrument',
    icon: '🎸',
    // The instrument is bought once; after that you are only paying for lessons.
    cost: (ctx: Ctx) => (ctx.c.flags['act:instrument'] === true ? 50 : 500),
    minAge: 6,
    condition: free,
    resolve: (ctx: Ctx) => {
      const owned = ctx.c.flags['act:instrument'] === true;
      return {
        text: owned
          ? 'A year of practice. The neighbours have stopped banging on the wall.'
          : 'You bought a guitar and learned four chords out of order.',
        effects: [
          { kind: 'stat', stat: 'smarts', delta: 2 },
          { kind: 'stat', stat: 'happiness', delta: 2 },
          { kind: 'flag', flag: 'act:instrument', value: true },
        ],
      };
    },
  },
  {
    id: 'act-meditate',
    area: 'mind-body',
    label: 'Meditate',
    icon: '🧘',
    minAge: 8,
    condition: free,
    resolve: () => ({
      text: 'Twenty minutes of sitting still. Eighteen of them were thinking about lunch.',
      effects: [
        { kind: 'stat', stat: 'happiness', delta: 3 },
        { kind: 'stat', stat: 'health', delta: 1 },
      ],
    }),
  },
  {
    id: 'act-paint',
    area: 'mind-body',
    label: 'Paint Something',
    icon: '🎨',
    cost: 60,
    minAge: 5,
    condition: free,
    resolve: () => ({
      text: 'You painted a landscape. It is on the fridge, where it belongs.',
      effects: [{ kind: 'stat', stat: 'happiness', delta: 3 }],
    }),
  },
  {
    id: 'act-garden',
    area: 'mind-body',
    label: 'Garden',
    icon: '🌱',
    minAge: 25,
    condition: free,
    resolve: () => ({
      text: 'You grew tomatoes. Two of them survived the slugs.',
      effects: [
        { kind: 'stat', stat: 'happiness', delta: 2 },
        { kind: 'stat', stat: 'health', delta: 1 },
      ],
    }),
  },
  {
    id: 'act-hike',
    area: 'mind-body',
    label: 'Go Hiking',
    icon: '🥾',
    minAge: 8,
    condition: free,
    resolve: () => ({
      text: 'Six hours uphill for a view and a sandwich. Worth it.',
      effects: [
        { kind: 'stat', stat: 'health', delta: 2 },
        { kind: 'stat', stat: 'happiness', delta: 2 },
      ],
    }),
  },
  {
    id: 'act-volunteer',
    area: 'mind-body',
    label: 'Volunteer',
    icon: '🙋',
    minAge: 14,
    condition: free,
    resolve: () => ({
      text: 'A Saturday at the shelter. You served soup and got the better end of it.',
      effects: [
        { kind: 'stat', stat: 'happiness', delta: 4 },
        bumpCounter('act:volunteerYears'),
      ],
    }),
  },
  {
    id: 'act-donate',
    area: 'mind-body',
    label: 'Donate to Charity',
    icon: '💝',
    cost: 1000,
    minAge: 16,
    condition: (ctx: Ctx) => free(ctx) && ctx.c.money > 5000,
    resolve: () => ({
      text: 'You gave a thousand away and told nobody. Almost nobody.',
      effects: [{ kind: 'stat', stat: 'happiness', delta: 3 }],
    }),
  },
];

/* ------------------------------------------------------------------ */
/* Fun                                                                 */
/* ------------------------------------------------------------------ */

const fun: InteractionDef[] = [
  {
    id: 'act-video-games',
    area: 'fun',
    label: 'Play Video Games',
    icon: '🎮',
    minAge: 5,
    condition: free,
    resolve: (ctx: Ctx) => ({
      text: ctx.rng.chance(0.5)
        ? 'You beat the final boss on the eleventh try.'
        : 'One more match, you said, six hours ago.',
      effects: [{ kind: 'stat', stat: 'happiness', delta: 3 }],
    }),
  },
  {
    id: 'act-movies',
    area: 'fun',
    label: 'Go to the Movies',
    icon: '🍿',
    cost: 20,
    minAge: 4,
    condition: free,
    resolve: () => ({
      text: 'Big screen, small popcorn, enormous drink.',
      effects: [{ kind: 'stat', stat: 'happiness', delta: 2 }],
    }),
  },
  {
    id: 'act-concert',
    area: 'fun',
    label: 'See a Concert',
    icon: '🎤',
    cost: 120,
    minAge: 15,
    condition: free,
    resolve: () => ({
      text: 'You could not hear anything for two days. Excellent night.',
      effects: [
        { kind: 'stat', stat: 'happiness', delta: 5 },
        { kind: 'stat', stat: 'health', delta: -1 },
      ],
    }),
  },
  {
    id: 'act-karaoke',
    area: 'fun',
    label: 'Sing Karaoke',
    icon: '🎙️',
    cost: 30,
    minAge: 16,
    condition: free,
    resolve: (ctx: Ctx) => {
      if (ctx.rng.chance(0.55)) {
        return {
          text: 'You held the last note. Strangers bought you a drink.',
          effects: [{ kind: 'stat', stat: 'happiness', delta: 5 }],
        };
      }
      return {
        text: 'You picked a song two octaves above your ceiling. There is video.',
        effects: [
          { kind: 'stat', stat: 'happiness', delta: -2 },
          { kind: 'stat', stat: 'looks', delta: -1 },
        ],
      };
    },
  },
  {
    id: 'act-fishing',
    area: 'fun',
    label: 'Go Fishing',
    icon: '🎣',
    minAge: 6,
    condition: free,
    resolve: (ctx: Ctx) => ({
      text: ctx.rng.chance(0.4)
        ? 'You caught something big enough to mention twice.'
        : 'You caught nothing and did not mind at all.',
      effects: [
        { kind: 'stat', stat: 'happiness', delta: 2 },
        { kind: 'stat', stat: 'health', delta: 1 },
      ],
    }),
  },
  {
    id: 'act-board-games',
    area: 'fun',
    label: 'Board Game Night',
    icon: '🎲',
    minAge: 5,
    condition: free,
    resolve: () => ({
      text: 'Four hours, one winner, three people rereading the rulebook.',
      effects: [
        { kind: 'stat', stat: 'happiness', delta: 2 },
        { kind: 'stat', stat: 'smarts', delta: 1 },
      ],
    }),
  },
  {
    id: 'act-social-post',
    area: 'fun',
    label: 'Post Online',
    icon: '📱',
    minAge: 13,
    condition: free,
    resolve: (ctx: Ctx) => {
      const stats = ctx.c.stats;
      if (stats.looks > 60 || stats.smarts > 70) {
        const gain = ctx.rng.int(1, 3);
        return {
          text: 'The post got away from you. In a good way, this time.',
          effects: [
            { kind: 'fame', delta: gain },
            { kind: 'stat', stat: 'happiness', delta: 3 },
          ],
        };
      }
      return {
        text: 'Three likes. Two of them were bots.',
        effects: [{ kind: 'stat', stat: 'happiness', delta: 1 }],
      };
    },
  },
];

/* ------------------------------------------------------------------ */
/* Nightlife                                                           */
/* ------------------------------------------------------------------ */

const nightlife: InteractionDef[] = [
  {
    id: 'act-nightclub',
    area: 'nightlife',
    label: 'Hit the Club',
    icon: '🪩',
    cost: 80,
    minAge: 18,
    condition: free,
    resolve: () => ({
      text: 'You danced until the lights came on and everyone looked worse.',
      effects: [
        { kind: 'stat', stat: 'happiness', delta: 5 },
        { kind: 'stat', stat: 'health', delta: -2 },
        { kind: 'addiction', which: 'alcohol', delta: 3 },
      ],
    }),
  },
  {
    id: 'act-bar-night',
    area: 'nightlife',
    label: 'Night at the Bar',
    icon: '🍺',
    cost: 50,
    minAge: 18,
    condition: free,
    resolve: () => ({
      text: 'Two rounds became five. Somebody solved politics.',
      effects: [
        { kind: 'stat', stat: 'happiness', delta: 3 },
        { kind: 'stat', stat: 'health', delta: -1 },
        { kind: 'addiction', which: 'alcohol', delta: 4 },
      ],
    }),
  },
  {
    id: 'act-house-party',
    area: 'nightlife',
    label: 'House Party',
    icon: '🏚️',
    minAge: 18,
    condition: free,
    resolve: (ctx: Ctx) => {
      const roll = ctx.rng.int(1, 10);
      if (roll <= 5) {
        return {
          text: 'You knew nobody at the start and everybody by 2am.',
          effects: [
            { kind: 'stat', stat: 'happiness', delta: 6 },
            { kind: 'addiction', which: 'alcohol', delta: 2 },
          ],
        };
      }
      if (roll <= 8) {
        return {
          text: 'A lamp was broken. It was, on inspection, your lamp.',
          effects: [
            { kind: 'money', delta: -200 },
            { kind: 'stat', stat: 'happiness', delta: 2 },
          ],
        };
      }
      return {
        text: 'You spent the night queueing for a bathroom and left at eleven.',
        effects: [{ kind: 'stat', stat: 'happiness', delta: -2 }],
      };
    },
  },
];

/* ------------------------------------------------------------------ */
/* Travel                                                              */
/* ------------------------------------------------------------------ */

const travel: InteractionDef[] = [
  tripRow({
    id: 'act-trip-nyc',
    label: 'Trip to New York',
    icon: '🗽',
    price: 2500,
    text: 'A week of walking, bagels and being shouted at by a stranger.',
    effects: [
      { kind: 'stat', stat: 'happiness', delta: 8 },
      { kind: 'stat', stat: 'smarts', delta: 1 },
    ],
  }),
  tripRow({
    id: 'act-trip-rome',
    label: 'Trip to Rome',
    icon: '🏛️',
    price: 3000,
    text: 'Ruins in the morning, pasta at midnight. You threw a coin in the fountain.',
    effects: [
      { kind: 'stat', stat: 'happiness', delta: 9 },
      { kind: 'stat', stat: 'smarts', delta: 2 },
    ],
  }),
  tripRow({
    id: 'act-trip-paris',
    label: 'Trip to Paris',
    icon: '🗼',
    price: 3500,
    text: 'You queued for a museum, ate four pastries and called it culture.',
    effects: [
      { kind: 'stat', stat: 'happiness', delta: 10 },
      { kind: 'stat', stat: 'smarts', delta: 1 },
    ],
  }),
  tripRow({
    id: 'act-trip-bali',
    label: 'Trip to Bali',
    icon: '🏖️',
    price: 4000,
    text: 'Two weeks of sea, rice fields and no email whatsoever.',
    effects: [
      { kind: 'stat', stat: 'happiness', delta: 12 },
      { kind: 'stat', stat: 'health', delta: 2 },
    ],
  }),
  tripRow({
    id: 'act-trip-tokyo',
    label: 'Trip to Tokyo',
    icon: '🗾',
    price: 6000,
    text: 'You got lost in a train station for an hour and loved every minute.',
    effects: [
      { kind: 'stat', stat: 'happiness', delta: 12 },
      { kind: 'stat', stat: 'smarts', delta: 2 },
    ],
  }),
  tripRow({
    id: 'act-trip-dubai',
    label: 'Trip to Dubai',
    icon: '🕌',
    price: 8000,
    text: 'Everything was air conditioned, gold plated and forty floors up.',
    effects: [
      { kind: 'stat', stat: 'happiness', delta: 14 },
      { kind: 'stat', stat: 'looks', delta: 1 },
    ],
  }),
];

/* ------------------------------------------------------------------ */
/* Shopping and looks                                                  */
/* ------------------------------------------------------------------ */

const shopping: InteractionDef[] = [
  {
    id: 'act-shop-basics',
    area: 'shopping',
    label: 'Buy Basics',
    icon: '🛒',
    cost: 100,
    minAge: 10,
    condition: free,
    resolve: () => ({
      text: 'New socks, new towels, small joy.',
      effects: [{ kind: 'stat', stat: 'happiness', delta: 2 }],
    }),
  },
  {
    id: 'act-shop-spree',
    area: 'shopping',
    label: 'Shopping Spree',
    icon: '🛍️',
    cost: 1500,
    minAge: 16,
    condition: free,
    resolve: () => ({
      text: 'You bought a whole new wardrobe and hid the receipts.',
      effects: [
        { kind: 'stat', stat: 'happiness', delta: 5 },
        { kind: 'stat', stat: 'looks', delta: 1 },
      ],
    }),
  },
  {
    id: 'act-shop-luxury',
    area: 'shopping',
    label: 'Buy Something Luxury',
    icon: '💎',
    cost: 10000,
    minAge: 18,
    condition: free,
    resolve: () => ({
      text: 'It is heavier than it looks and costs more than it weighs.',
      effects: [
        { kind: 'stat', stat: 'happiness', delta: 8 },
        { kind: 'stat', stat: 'looks', delta: 1 },
      ],
    }),
  },
  {
    id: 'act-spa-day',
    area: 'shopping',
    label: 'Spa Day',
    icon: '💆',
    cost: 300,
    minAge: 14,
    condition: free,
    resolve: () => ({
      text: 'Steam, cucumber and a stranger telling you to breathe.',
      effects: [
        { kind: 'stat', stat: 'looks', delta: 2 },
        { kind: 'stat', stat: 'happiness', delta: 4 },
      ],
    }),
  },
  {
    id: 'act-haircut',
    area: 'shopping',
    label: 'Get a Haircut',
    icon: '✂️',
    cost: 40,
    minAge: 3,
    condition: free,
    resolve: () => ({
      text: 'You asked for a trim and got a trim. A good year.',
      effects: [{ kind: 'stat', stat: 'looks', delta: 1 }],
    }),
  },
  {
    id: 'act-tattoo',
    area: 'shopping',
    label: 'Get a Tattoo',
    icon: '🖋️',
    cost: 200,
    minAge: 18,
    cooldownYears: 1,
    condition: free,
    resolve: (ctx: Ctx) => {
      if (ctx.rng.chance(0.6)) {
        return {
          text: 'Clean lines, no regrets, everyone asks about it.',
          effects: [
            { kind: 'stat', stat: 'looks', delta: 2 },
            { kind: 'stat', stat: 'happiness', delta: 2 },
          ],
        };
      }
      return {
        text: 'The lettering is in a language you do not speak. It is spelled wrong.',
        effects: [
          { kind: 'stat', stat: 'looks', delta: -2 },
          { kind: 'stat', stat: 'happiness', delta: -2 },
        ],
      };
    },
  },
  {
    id: 'act-plastic-surgery',
    area: 'shopping',
    label: 'Plastic Surgery',
    icon: '💉',
    cost: 15000,
    minAge: 21,
    cooldownYears: 3,
    condition: free,
    resolve: (ctx: Ctx) => {
      if (ctx.rng.chance(0.75)) {
        return {
          text: 'Nobody can say what changed. Everybody says you look well.',
          effects: [
            { kind: 'stat', stat: 'looks', delta: 12 },
            { kind: 'stat', stat: 'happiness', delta: 5 },
          ],
        };
      }
      return {
        text: 'Botched. The surgeon has stopped answering the phone.',
        effects: [
          { kind: 'stat', stat: 'looks', delta: -15 },
          { kind: 'stat', stat: 'health', delta: -5 },
          { kind: 'stat', stat: 'happiness', delta: -8 },
        ],
      };
    },
  },
];

/* ------------------------------------------------------------------ */
/* Pets                                                                */
/* ------------------------------------------------------------------ */

const pets: InteractionDef[] = [
  petRow({
    id: 'act-adopt-dog',
    label: 'Adopt a Dog',
    icon: '🐶',
    species: 'dog',
    price: 100,
    line: (name) => `You adopted a dog. ${name} owns the sofa now.`,
  }),
  petRow({
    id: 'act-adopt-cat',
    label: 'Adopt a Cat',
    icon: '🐱',
    species: 'cat',
    price: 80,
    line: (name) => `You adopted a cat. ${name} has decided to tolerate you.`,
  }),
  petRow({
    id: 'act-adopt-bird',
    label: 'Adopt a Bird',
    icon: '🦜',
    species: 'bird',
    price: 60,
    line: (name) => `You brought home a bird. ${name} has learned one word already.`,
  }),
  petRow({
    id: 'act-adopt-fish',
    label: 'Get a Fish',
    icon: '🐠',
    species: 'fish',
    price: 20,
    line: (name) => `A tank, a plastic castle and ${name}. Low maintenance company.`,
  }),
  petRow({
    id: 'act-adopt-rabbit',
    label: 'Adopt a Rabbit',
    icon: '🐰',
    species: 'rabbit',
    price: 50,
    line: (name) => `You adopted a rabbit. ${name} has eaten one cable so far.`,
  }),
  petRow({
    id: 'act-adopt-hamster',
    label: 'Get a Hamster',
    icon: '🐹',
    species: 'hamster',
    price: 30,
    line: (name) => `${name} runs on that wheel all night. All night.`,
  }),
  petRow({
    id: 'act-adopt-snake',
    label: 'Get a Snake',
    icon: '🐍',
    species: 'snake',
    price: 400,
    line: (name) => `You got a snake. Guests have opinions about ${name}.`,
  }),
  petRow({
    id: 'act-adopt-horse',
    label: 'Buy a Horse',
    icon: '🐴',
    species: 'horse',
    price: 4000,
    minMoney: 20000,
    line: (name) => `You bought a horse. ${name} costs more to park than a car.`,
  }),
  {
    id: 'act-walk-pet',
    area: 'pets',
    label: 'Walk the Pet',
    icon: '🦮',
    minAge: 5,
    condition: (ctx: Ctx) => free(ctx) && hasPet(ctx),
    resolve: (ctx: Ctx) => {
      const list = alivePets(ctx.state);
      const pet = list.length > 0 ? ctx.rng.pick(list) : undefined;
      if (!pet) {
        return { text: 'You looked for the lead and thought better of it.', effects: [] };
      }
      const name = firstNameOf(pet, 'your pet');
      return {
        text: `You took ${name} out. Two miles, one squirrel, no dignity.`,
        effects: [
          { kind: 'rel', who: pet.id, delta: ctx.rng.int(3, 8) },
          { kind: 'stat', stat: 'happiness', delta: 3 },
          { kind: 'stat', stat: 'health', delta: 1 },
        ],
      };
    },
  },
  {
    id: 'act-vet-visit',
    area: 'pets',
    label: 'Take Pet to the Vet',
    icon: '🩺',
    cost: 200,
    minAge: 10,
    condition: (ctx: Ctx) => free(ctx) && hasPet(ctx),
    resolve: (ctx: Ctx) => {
      const list = alivePets(ctx.state);
      const pet = list.length > 0 ? ctx.rng.pick(list) : undefined;
      if (!pet) {
        // The `cost` above is the charge the line describes; refunding it here
        // would net the visit to $0 and say the opposite of what happened.
        return { text: 'You had nobody to take, and the vet charged you anyway.', effects: [] };
      }
      const name = firstNameOf(pet, 'your pet');
      return {
        text: `${name} was very brave about the whole thing. You were not.`,
        effects: [
          { kind: 'rel', who: pet.id, delta: 5 },
          { kind: 'stat', stat: 'happiness', delta: 1 },
        ],
      };
    },
  },
];

/** Self-directed activities: gym, library, travel, nightlife, meditation and vices. */
export const activitiesPack: ContentPack = {
  id: 'activities',
  interactions: [...mindBody, ...fun, ...nightlife, ...travel, ...shopping, ...pets],
};
