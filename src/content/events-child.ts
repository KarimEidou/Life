/**
 * Random events for ages 0-12: family, school, friends and first experiences.
 *
 * Everything here has to survive a state where the family tree is thin: parents
 * die, siblings are never guaranteed, and a life can reach ten with nobody in it
 * but the character. So every event that names somebody gates on that person
 * being alive, and every affinity nudge is a no-op when the person is gone.
 *
 * School is the other gate: `eventsPhase` draws every year whether or not the
 * character has a desk — the ladder only enrols at six, and a dropout never sits
 * down again — so everything premised on a school day asks `inSchool` first.
 *
 * Prison is the third, and it reaches further into this pack than it looks:
 * `crime-shoplift` opens at twelve and every card below whose window still
 * covers twelve can therefore be dealt to a child serving a sentence. A
 * lemonade stand at the end of the driveway and a sleepover at a friend's house
 * are exactly what the prison policy documented above `free` in `@/content/lib`
 * calls class 2, so they ask `free` — directly or through `inSchool`, which
 * folds it in. A growth spurt is not: a cell delivers one as readily as a house
 * does, and gating it would be the over-correction the policy warns about.
 * Cards that close before twelve are out of a sentence's reach and stay plain.
 */

import {
  ROLLED_GENDERS,
  addPerson,
  free,
  hasSibling,
  inSchool,
  parentsRel,
  rollName,
  siblingName,
  siblingRel,
} from '@/content/lib';
import type { ContentPack, Effect, EffectCtx, EventDef } from '@/types';

/** Countries where "school is closed for snow" is a thing that happens. */
const SNOW_COUNTRIES: readonly string[] = ['us', 'uk', 'ca', 'de', 'fr', 'jp'];

/** Mints a friend of roughly the character's own age. */
function addFriend(): Effect {
  return {
    kind: 'fn',
    run: (ctx: EffectCtx) => {
      const gender = ctx.rng.pick(ROLLED_GENDERS);
      addPerson(ctx.state, {
        kind: 'friend',
        name: rollName(ctx, gender),
        gender,
        age: Math.max(1, ctx.state.character.age + ctx.rng.int(-1, 1)),
        alive: true,
        rel: ctx.rng.int(55, 80),
        flags: {},
      });
    },
  };
}

const events: EventDef[] = [
  {
    id: 'ev-child-slept-through',
    area: 'family',
    icon: '😴',
    minAge: 0,
    maxAge: 1,
    weight: 5,
    oncePerLife: true,
    text: 'You slept through the night for the first time. The household wept with relief.',
    effects: [
      { kind: 'stat', stat: 'health', delta: 2 },
      { kind: 'stat', stat: 'happiness', delta: 3 },
      parentsRel(5),
    ],
  },
  {
    id: 'ev-child-teething',
    area: 'health',
    icon: '🍼',
    minAge: 0,
    maxAge: 1,
    weight: 5,
    oncePerLife: true,
    text: 'Your first tooth arrived at 3am, loudly, and took several weeks about it.',
    effects: [
      { kind: 'stat', stat: 'health', delta: 1 },
      { kind: 'stat', stat: 'happiness', delta: -3 },
      parentsRel(-2),
    ],
  },
  {
    id: 'ev-child-first-word',
    area: 'life',
    icon: '🗣️',
    minAge: 1,
    maxAge: 2,
    weight: 6,
    oncePerLife: true,
    text: (ctx) =>
      `You said your first word: "${ctx.rng.pick([
        'mama',
        'dada',
        'no',
        'dog',
        'more',
        'uh-oh',
      ])}". Somebody wrote it down.`,
    effects: [
      { kind: 'stat', stat: 'smarts', delta: 3 },
      { kind: 'stat', stat: 'happiness', delta: 4 },
      parentsRel(4),
    ],
  },
  {
    id: 'ev-child-first-steps',
    area: 'life',
    icon: '👣',
    minAge: 1,
    maxAge: 2,
    weight: 6,
    oncePerLife: true,
    text: 'You let go of the coffee table and made it four steps before gravity won.',
    effects: [
      { kind: 'stat', stat: 'health', delta: 2 },
      { kind: 'stat', stat: 'happiness', delta: 5 },
      parentsRel(4),
    ],
  },
  {
    id: 'ev-child-wall-drawing',
    area: 'family',
    icon: '🖍️',
    minAge: 2,
    maxAge: 6,
    weight: 4,
    text: (ctx) =>
      `You drew ${ctx.rng.pick([
        'a horse',
        'the whole family',
        'a truck',
        'something nobody could identify',
      ])} on the hallway wall in permanent marker.`,
    effects: [
      { kind: 'stat', stat: 'happiness', delta: 4 },
      { kind: 'stat', stat: 'smarts', delta: 1 },
      parentsRel(-4),
    ],
  },
  {
    id: 'ev-child-tantrum',
    area: 'family',
    icon: '😤',
    minAge: 2,
    maxAge: 4,
    weight: 4,
    text: (ctx) =>
      `You lay down in ${ctx.rng.pick([
        'the supermarket aisle',
        'a shoe shop',
        'the post office queue',
        'a car park',
      ])} and screamed about ${ctx.rng.pick([
        'a yoghurt',
        'the wrong colour cup',
        'a door somebody else opened',
        'nothing anybody could identify',
      ])}.`,
    effects: [{ kind: 'stat', stat: 'happiness', delta: -2 }, parentsRel(-3)],
  },
  {
    id: 'ev-child-favourite-toy',
    area: 'life',
    icon: '🐰',
    minAge: 2,
    maxAge: 5,
    weight: 4,
    text: (ctx) =>
      `You would not go anywhere without ${ctx.rng.pick([
        'a one-eared rabbit',
        'a plastic dinosaur',
        'a blanket with a hole in it',
        'a wooden spoon',
      ])}.`,
    effects: [
      { kind: 'stat', stat: 'happiness', delta: 5 },
      { kind: 'stat', stat: 'smarts', delta: 1 },
    ],
  },
  {
    id: 'ev-child-imaginary-friend',
    area: 'life',
    icon: '👻',
    minAge: 3,
    maxAge: 7,
    weight: 4,
    text: (ctx) =>
      `Your new best friend is called ${ctx.rng.pick([
        'Mr. Buttons',
        'Gorp',
        'Susan',
        'The Captain',
        'Blue Steve',
      ])}. Nobody else can see them.`,
    effects: [
      { kind: 'stat', stat: 'happiness', delta: 6 },
      { kind: 'stat', stat: 'smarts', delta: 2 },
    ],
  },
  {
    id: 'ev-child-nightmare',
    area: 'life',
    icon: '😱',
    minAge: 3,
    maxAge: 10,
    weight: 4,
    text: (ctx) =>
      `You dreamt about ${ctx.rng.pick([
        'a hallway that kept getting longer',
        'the thing under the stairs',
        'losing every tooth at once',
        'a door that would not close',
      ])} and woke the whole house.`,
    effects: [
      { kind: 'stat', stat: 'happiness', delta: -5 },
      { kind: 'stat', stat: 'health', delta: -1 },
    ],
  },
  {
    id: 'ev-child-scraped-knee',
    area: 'health',
    icon: '🩹',
    minAge: 3,
    maxAge: 10,
    weight: 4,
    text: (ctx) =>
      `You came off your bike on ${ctx.rng.pick([
        'gravel',
        'a speed bump',
        "somebody else's driveway",
        'the one wet leaf on the whole road',
      ])}. The knee was spectacular.`,
    effects: [
      { kind: 'stat', stat: 'health', delta: -3 },
      { kind: 'stat', stat: 'happiness', delta: -3 },
      { kind: 'stat', stat: 'looks', delta: -1 },
    ],
  },
  {
    id: 'ev-child-grandma-visit',
    area: 'family',
    icon: '👵',
    minAge: 3,
    maxAge: 12,
    weight: 4,
    condition: free,
    text: 'Your grandmother visited with a tin of biscuits and a folded note with money in it.',
    effects: [
      { kind: 'stat', stat: 'happiness', delta: 6 },
      { kind: 'money', delta: 20 },
      { kind: 'stat', stat: 'health', delta: -1 },
    ],
  },
  {
    id: 'ev-child-road-trip',
    area: 'family',
    icon: '🚗',
    minAge: 4,
    maxAge: 12,
    weight: 4,
    condition: free,
    text: (ctx) =>
      `Nine hours in the back seat to ${ctx.rng.pick([
        'the coast',
        'a cousin you had never met',
        'a very large hole in the ground',
        'a lake with one broken pedalo',
      ])}. You were sick exactly once.`,
    effects: [
      { kind: 'stat', stat: 'happiness', delta: 6 },
      { kind: 'stat', stat: 'health', delta: -2 },
      { kind: 'rel', who: 'random-family', delta: 3 },
    ],
  },
  {
    id: 'ev-child-frog',
    area: 'life',
    icon: '🐸',
    minAge: 4,
    maxAge: 10,
    weight: 4,
    text:
      'You found a frog by the drain and kept it in a shoebox. It escaped into the kitchen at 6am.',
    effects: [
      { kind: 'stat', stat: 'happiness', delta: 5 },
      { kind: 'stat', stat: 'smarts', delta: 2 },
    ],
  },
  {
    id: 'ev-child-birthday-party',
    area: 'family',
    icon: '🎂',
    minAge: 4,
    maxAge: 12,
    weight: 5,
    condition: free,
    text: 'Your birthday is Saturday and you get to decide what it looks like.',
    choices: [
      {
        label: 'Invite the whole class',
        outcomes: [
          {
            weight: 5,
            text: 'Twenty kids, one bouncy castle, zero survivors. Best day of your life.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 10 },
              { kind: 'stat', stat: 'health', delta: -2 },
            ],
          },
          {
            weight: 3,
            text: 'Four kids came. You ate a lot of cake and nobody talked about it after.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: -4 },
              { kind: 'stat', stat: 'health', delta: -1 },
            ],
          },
        ],
      },
      {
        label: 'Just your two best friends',
        outcomes: [
          {
            weight: 1,
            text: 'Pizza, a rented film, and nobody cried. A clean operation.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: 7 }],
          },
        ],
      },
      {
        label: 'Cake at home with family',
        outcomes: [
          {
            weight: 1,
            text: 'Candles, one photo, and a card with money folded inside it.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 4 },
              { kind: 'money', delta: 25 },
              { kind: 'rel', who: 'random-family', delta: 4 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-child-lost-at-mall',
    area: 'life',
    icon: '🛍️',
    minAge: 4,
    maxAge: 9,
    weight: 4,
    text: 'You looked up in the department store and the person you came with was gone.',
    choices: [
      {
        label: 'Stay exactly where you are',
        outcomes: [
          {
            weight: 7,
            text: 'They found you in four minutes, standing very still by the towels.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: -2 },
              { kind: 'stat', stat: 'smarts', delta: 3 },
            ],
          },
        ],
      },
      {
        label: 'Ask someone at a till',
        outcomes: [
          {
            weight: 6,
            text: 'A cashier called it in over the speakers. You got a lollipop out of it.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 2 },
              { kind: 'stat', stat: 'smarts', delta: 4 },
            ],
          },
        ],
      },
      {
        label: 'Go looking',
        outcomes: [
          {
            weight: 5,
            text: 'You found the food court instead and were paged by name twice.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: -6 },
              { kind: 'stat', stat: 'smarts', delta: -1 },
            ],
          },
          {
            weight: 3,
            text: 'You found them two aisles over. Nobody had noticed you were gone.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: 2 }],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-child-lost-tooth',
    area: 'health',
    icon: '🦷',
    minAge: 5,
    maxAge: 9,
    weight: 5,
    oncePerLife: true,
    text: (ctx) =>
      `Your first tooth came out ${ctx.rng.pick([
        'in an apple',
        'on a door handle and a piece of string',
        'halfway through dinner',
        'all by itself in class',
      ])}. There was more blood than anyone expected.`,
    effects: [
      { kind: 'stat', stat: 'looks', delta: -2 },
      { kind: 'stat', stat: 'happiness', delta: 4 },
    ],
  },
  {
    id: 'ev-child-tooth-fairy',
    area: 'money',
    icon: '🧚',
    minAge: 5,
    maxAge: 9,
    weight: 4,
    text: 'Tooth under the pillow. In the morning: cash, and some very familiar handwriting.',
    effects: [
      { kind: 'money', delta: 10 },
      { kind: 'stat', stat: 'happiness', delta: 5 },
    ],
  },
  {
    id: 'ev-child-candy-stash',
    area: 'life',
    icon: '🍬',
    minAge: 5,
    maxAge: 11,
    weight: 4,
    text: 'You have a shoebox of candy under the bed and it is not going to last forever.',
    choices: [
      {
        label: 'Eat the whole box tonight',
        outcomes: [
          {
            weight: 6,
            text: 'You were vibrating by nine and full of regret by ten.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 6 },
              { kind: 'stat', stat: 'health', delta: -4 },
            ],
          },
          {
            weight: 3,
            text: 'You got halfway and were sick on the good rug.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: -4 },
              { kind: 'stat', stat: 'health', delta: -5 },
            ],
          },
        ],
      },
      {
        label: 'Trade it at school',
        outcomes: [
          {
            weight: 5,
            text: 'You ran the playground candy economy for a week and retired undefeated.',
            effects: [
              { kind: 'money', delta: 12 },
              { kind: 'stat', stat: 'smarts', delta: 3 },
              { kind: 'stat', stat: 'happiness', delta: 3 },
            ],
          },
        ],
      },
      {
        label: 'Share it with the family',
        outcomes: [
          {
            weight: 2,
            text: 'Gone in four minutes. Everybody loved you for three of them.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 4 },
              { kind: 'rel', who: 'random-family', delta: 6 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-child-swim-lesson',
    area: 'health',
    icon: '🏊',
    minAge: 5,
    maxAge: 10,
    weight: 4,
    text: 'Swimming lessons. The instructor wants everyone off the wall and into the deep end.',
    choices: [
      {
        label: 'Jump in',
        outcomes: [
          {
            weight: 6,
            text: 'You sank, panicked, then swam. Water has never scared you since.',
            effects: [
              { kind: 'stat', stat: 'health', delta: 5 },
              { kind: 'stat', stat: 'happiness', delta: 7 },
              { kind: 'flag', flag: 'child:canSwim', value: true },
            ],
          },
          {
            weight: 3,
            text: 'You swallowed half the pool and were fished out with a pole.',
            effects: [
              { kind: 'stat', stat: 'health', delta: -3 },
              { kind: 'stat', stat: 'happiness', delta: -6 },
            ],
          },
        ],
      },
      {
        label: 'Cling to the wall',
        outcomes: [
          {
            weight: 1,
            text: 'You held that rail for six weeks of lessons. Water is still not your friend.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: -3 },
              { kind: 'stat', stat: 'health', delta: -1 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-child-goldfish',
    area: 'life',
    icon: '🐠',
    minAge: 5,
    maxAge: 12,
    weight: 3,
    condition: free,
    text: (ctx) =>
      `The goldfish you won at the fair did not make it to spring. ${ctx.rng.pick([
        'Bubbles',
        'Sharkbait',
        'Goldie',
        'Mr. Fish',
      ])} was seen off with full honours.`,
    effects: [
      { kind: 'stat', stat: 'happiness', delta: -5 },
      { kind: 'stat', stat: 'smarts', delta: 1 },
    ],
  },
  {
    id: 'ev-child-hide-and-seek',
    area: 'life',
    icon: '🫣',
    minAge: 5,
    maxAge: 11,
    weight: 4,
    text: 'You found a hiding place so good that everyone gave up and went home for dinner.',
    effects: [
      { kind: 'stat', stat: 'happiness', delta: 4 },
      { kind: 'stat', stat: 'smarts', delta: 2 },
    ],
  },
  {
    id: 'ev-child-broken-vase',
    area: 'family',
    icon: '🏺',
    minAge: 5,
    maxAge: 12,
    weight: 4,
    condition: (ctx) => free(ctx) && hasSibling(ctx),
    text: (ctx) =>
      `You broke the good vase in the hall. ${siblingName(ctx)} is the only other person home.`,
    choices: [
      {
        label: 'Confess',
        outcomes: [
          {
            weight: 6,
            text: 'You were grounded for a week and quietly respected for it.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: -3 }, parentsRel(6)],
          },
          {
            weight: 3,
            text: 'You were grounded for two weeks. Nobody mentioned the respect part.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: -6 }, parentsRel(2)],
          },
        ],
      },
      {
        label: 'Blame your sibling',
        outcomes: [
          {
            weight: 5,
            text: 'They took the blame and the punishment. They know exactly what you did.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: 2 }, siblingRel(-12)],
          },
          {
            weight: 4,
            text: 'The story fell apart in ninety seconds. Now you broke a vase and lied about it.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: -7 },
              parentsRel(-8),
              siblingRel(-5),
            ],
          },
        ],
      },
      {
        label: 'Sweep it up and say nothing',
        outcomes: [
          {
            weight: 2,
            text: 'The vase was never mentioned again. You still think about it.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: -2 },
              { kind: 'stat', stat: 'smarts', delta: 1 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-child-caught-lying',
    area: 'school',
    icon: '🤥',
    minAge: 6,
    maxAge: 12,
    weight: 4,
    condition: inSchool,
    text: 'You said your homework was finished. The teacher emailed home to say otherwise.',
    choices: [
      {
        label: 'Double down',
        outcomes: [
          {
            weight: 5,
            text: 'You invented a second lie to hold up the first. Neither survived dinner.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: -7 }, parentsRel(-8)],
          },
          {
            weight: 3,
            text: 'Somehow it held. You are now a person who does that.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 3 },
              { kind: 'stat', stat: 'smarts', delta: 2 },
              { kind: 'flag', flag: 'child:practisedLiar', value: true },
            ],
          },
        ],
      },
      {
        label: 'Come clean',
        outcomes: [
          {
            weight: 6,
            text: 'You lost a week of screen time and kept your reputation.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: -3 }, parentsRel(5)],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-child-snow-day',
    area: 'school',
    icon: '❄️',
    minAge: 6,
    maxAge: 12,
    weight: 4,
    condition: (ctx) => inSchool(ctx) && SNOW_COUNTRIES.includes(ctx.c.countryId),
    text: 'School was cancelled for snow. The entire day belongs to you.',
    choices: [
      {
        label: 'Sledge until dark',
        outcomes: [
          {
            weight: 6,
            text: 'Six hours on a bin lid. You could not feel your hands and did not care.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 9 },
              { kind: 'stat', stat: 'health', delta: -3 },
            ],
          },
          {
            weight: 3,
            text: 'You met the fence at speed. The bin lid did not survive either.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 2 },
              { kind: 'stat', stat: 'health', delta: -6 },
            ],
          },
        ],
      },
      {
        label: 'Build a fort in the garden',
        outcomes: [
          {
            weight: 5,
            text: 'It had a working door and you defended it from everybody until dinner.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 7 },
              { kind: 'stat', stat: 'smarts', delta: 2 },
              { kind: 'stat', stat: 'health', delta: -2 },
            ],
          },
        ],
      },
      {
        label: 'Stay in with cocoa',
        outcomes: [
          {
            weight: 2,
            text: 'You watched it come down through the window under a blanket. Excellent day.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: 5 }],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-child-new-neighbor',
    area: 'life',
    icon: '🚚',
    minAge: 5,
    maxAge: 12,
    weight: 4,
    condition: free,
    text: 'A moving truck pulled up next door. There is a kid your age carrying a box of comics.',
    choices: [
      {
        label: 'Go say hi',
        outcomes: [
          {
            weight: 6,
            text: 'You spent the entire summer in their garden. New best friend.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: 8 }, addFriend()],
          },
          {
            weight: 2,
            text: 'They were not interested. The comics were excellent, though.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: -3 }],
          },
        ],
      },
      {
        label: 'Watch from the window',
        outcomes: [
          {
            weight: 1,
            text: 'You watched the whole move-in from behind a curtain. Very normal.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: -1 },
              { kind: 'stat', stat: 'smarts', delta: 1 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-child-playground-fight',
    area: 'school',
    icon: '🥊',
    minAge: 6,
    maxAge: 12,
    weight: 5,
    condition: inSchool,
    text: 'A kid took the swing you were waiting for and told you to cry about it.',
    choices: [
      {
        label: 'Push them off',
        outcomes: [
          {
            weight: 5,
            text: 'You got the swing and a two-day suspension. Worth it, on balance.',
            effects: [
              { kind: 'stat', stat: 'health', delta: -2 },
              { kind: 'stat', stat: 'happiness', delta: 5 },
              parentsRel(-5),
            ],
          },
          {
            weight: 4,
            text: 'You missed, hit the pole, and cried about it.',
            effects: [
              { kind: 'stat', stat: 'health', delta: -4 },
              { kind: 'stat', stat: 'happiness', delta: -6 },
              { kind: 'stat', stat: 'looks', delta: -1 },
            ],
          },
        ],
      },
      {
        label: 'Tell the teacher',
        outcomes: [
          {
            weight: 6,
            text: 'You both apologised and you got the swing back in a way nobody respected.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: 1 }],
          },
          {
            weight: 3,
            text: 'The teacher was busy. You waited out the entire recess.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: -4 }],
          },
        ],
      },
      {
        label: 'Find another swing',
        outcomes: [
          {
            weight: 2,
            text: 'You took the wobbly swing and let it go. Very grown up.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: -1 },
              { kind: 'stat', stat: 'smarts', delta: 2 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-child-hidden-talent',
    area: 'school',
    icon: '🎯',
    minAge: 6,
    maxAge: 12,
    weight: 5,
    oncePerLife: true,
    condition: inSchool,
    text: (ctx) =>
      `A teacher noticed you were unusually good at ${ctx.rng.pick([
        'mental arithmetic',
        'drawing hands',
        'remembering everything',
        'perfect pitch',
        'beating adults at chess',
      ])}. Word got around.`,
    effects: [
      { kind: 'stat', stat: 'smarts', delta: 6 },
      { kind: 'stat', stat: 'looks', delta: 2 },
      { kind: 'stat', stat: 'happiness', delta: 5 },
      { kind: 'flag', flag: 'child:talentFound', value: true },
    ],
  },
  {
    id: 'ev-child-chores',
    area: 'family',
    icon: '🧹',
    minAge: 6,
    maxAge: 12,
    weight: 5,
    condition: free,
    text: 'There is a chore chart on the fridge with your name on it and an allowance attached.',
    choices: [
      {
        label: 'Do them all properly',
        outcomes: [
          {
            weight: 6,
            text: 'Every box ticked. You got paid and, worse, you got trusted.',
            effects: [
              { kind: 'money', delta: 30 },
              { kind: 'stat', stat: 'happiness', delta: -2 },
              parentsRel(6),
            ],
          },
          {
            weight: 2,
            text: 'You did them so well that two more chores appeared on the chart.',
            effects: [
              { kind: 'money', delta: 30 },
              { kind: 'stat', stat: 'happiness', delta: -5 },
            ],
          },
        ],
      },
      {
        label: 'Do the easy half',
        outcomes: [
          {
            weight: 2,
            text: 'You took the money and hoped nobody checked the bathroom.',
            effects: [
              { kind: 'money', delta: 15 },
              { kind: 'stat', stat: 'happiness', delta: 2 },
            ],
          },
        ],
      },
      {
        label: 'Hide until it is over',
        outcomes: [
          {
            weight: 2,
            text: 'Nobody found you. Nobody paid you either.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: 3 }, parentsRel(-5)],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-child-photo-day',
    area: 'school',
    icon: '📸',
    minAge: 6,
    maxAge: 12,
    weight: 4,
    condition: inSchool,
    text: (ctx) =>
      `School photo day. ${ctx.rng.pick([
        'Your hair had other plans.',
        'You blinked.',
        'You were mid-sentence.',
        'Your collar was inside out.',
      ])} They printed forty copies.`,
    effects: [
      { kind: 'stat', stat: 'looks', delta: -2 },
      { kind: 'stat', stat: 'happiness', delta: -3 },
    ],
  },
  {
    id: 'ev-child-lemonade-stand',
    area: 'money',
    icon: '🍋',
    minAge: 6,
    maxAge: 12,
    weight: 4,
    condition: free,
    text:
      'You set up a folding table at the end of the driveway with a jug of lemonade and a sign.',
    choices: [
      {
        label: 'Charge two dollars a cup',
        outcomes: [
          {
            weight: 5,
            text: 'Nine cups sold to people who felt sorry for you. Money is money.',
            effects: [
              { kind: 'money', delta: 18 },
              { kind: 'stat', stat: 'smarts', delta: 3 },
              { kind: 'stat', stat: 'happiness', delta: 5 },
            ],
          },
          {
            weight: 3,
            text: 'Nobody paid two dollars. You drank the profits yourself.',
            effects: [
              { kind: 'money', delta: 2 },
              { kind: 'stat', stat: 'happiness', delta: -3 },
            ],
          },
        ],
      },
      {
        label: 'Charge fifty cents',
        outcomes: [
          {
            weight: 6,
            text: 'Sold out in an hour and made almost nothing. Volume is not everything.',
            effects: [
              { kind: 'money', delta: 7 },
              { kind: 'stat', stat: 'happiness', delta: 6 },
              { kind: 'stat', stat: 'smarts', delta: 1 },
            ],
          },
        ],
      },
      {
        label: 'Give it away free',
        outcomes: [
          {
            weight: 2,
            text: 'You made no money and every neighbour now knows your name.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: 7 }],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-child-tree-climb',
    area: 'life',
    icon: '🌳',
    minAge: 6,
    maxAge: 12,
    weight: 4,
    condition: free,
    text: 'There is a tree at the end of the road that everyone says nobody can climb.',
    choices: [
      {
        label: 'Go all the way up',
        outcomes: [
          {
            weight: 6,
            text: 'You reached the top branch and could see three streets over. Legend.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 10 },
              { kind: 'stat', stat: 'health', delta: 2 },
              { kind: 'stat', stat: 'looks', delta: 1 },
            ],
          },
          {
            weight: 3,
            text: 'You reached the top branch and then the ground, much faster.',
            effects: [
              { kind: 'illness', add: 'ill-broken-bone' },
              { kind: 'stat', stat: 'health', delta: -8 },
              { kind: 'stat', stat: 'happiness', delta: -7 },
            ],
          },
        ],
      },
      {
        label: 'Stop at the low branch',
        outcomes: [
          {
            weight: 2,
            text: 'You sat on the low branch and let everybody else be legends.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: 2 }],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-child-piggy-bank',
    area: 'money',
    icon: '🐷',
    minAge: 6,
    maxAge: 12,
    weight: 4,
    condition: free,
    text: 'You cracked open the piggy bank and counted everything twice, out loud.',
    effects: [
      { kind: 'money', delta: 40 },
      { kind: 'stat', stat: 'smarts', delta: 2 },
      { kind: 'stat', stat: 'happiness', delta: 3 },
    ],
  },
  {
    id: 'ev-child-talent-show',
    area: 'school',
    icon: '🎤',
    minAge: 7,
    maxAge: 12,
    weight: 4,
    condition: inSchool,
    text: 'The school talent show needs one more act and your name is already on the clipboard.',
    choices: [
      {
        label: 'Sing',
        outcomes: [
          {
            weight: 5,
            text: 'You held the last note far too long and the hall cheered anyway.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 8 },
              { kind: 'stat', stat: 'looks', delta: 2 },
              { kind: 'fame', delta: 2 },
            ],
          },
          {
            weight: 3,
            text: 'Your voice left you in the second verse. The video went around the year group.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: -7 },
              { kind: 'fame', delta: 1 },
            ],
          },
        ],
      },
      {
        label: 'Do a magic trick',
        outcomes: [
          {
            weight: 5,
            text: 'The card was wrong but the patter was excellent. Second place.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 6 },
              { kind: 'stat', stat: 'smarts', delta: 3 },
            ],
          },
          {
            weight: 3,
            text: 'You dropped the deck. Twice.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: -4 },
              { kind: 'stat', stat: 'smarts', delta: 1 },
            ],
          },
        ],
      },
      {
        label: 'Pull out',
        outcomes: [
          {
            weight: 2,
            text: 'You watched from the third row and felt fine about it. Mostly.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: -2 }],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-child-sleepover',
    area: 'life',
    icon: '🛏️',
    minAge: 7,
    maxAge: 12,
    weight: 4,
    condition: free,
    text: "Sleepover at a friend's house. At 3am you were arguing about who was more tired.",
    effects: [
      { kind: 'stat', stat: 'happiness', delta: 7 },
      { kind: 'stat', stat: 'health', delta: -3 },
    ],
  },
  {
    id: 'ev-child-growth-spurt',
    area: 'health',
    icon: '📏',
    minAge: 8,
    maxAge: 12,
    weight: 4,
    text: 'You grew two inches over one summer. None of your trousers survived it.',
    effects: [
      { kind: 'stat', stat: 'health', delta: 3 },
      { kind: 'stat', stat: 'looks', delta: 3 },
      { kind: 'stat', stat: 'happiness', delta: 3 },
    ],
  },
];

/** Childhood: milestones, playground politics and the first money you ever made. */
export const eventsChildPack: ContentPack = {
  id: 'events-child',
  events,
};
