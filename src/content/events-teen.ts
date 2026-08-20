/**
 * Random events for ages 13-17: high school, peer pressure, dating and rebellion.
 *
 * Same null-safety contract as the childhood pack: parents, siblings and a first
 * romance may all be missing, so anything that names one gates on that person
 * being alive and every affinity nudge is a no-op when they are not.
 *
 * Prison is the one blanket exclusion: `eventsPhase` keeps drawing while the
 * character is inside, and a food-court shift or a bleach job in the bathroom
 * reads as a bug from a cell. The prison pack owns those years, so everything
 * here asks `free` first — either directly or through `inSchool`.
 */

import {
  MILESTONE,
  MILESTONE_ONE_YEAR,
  ROLLED_GENDERS,
  addPerson,
  free,
  hasParent,
  hasSibling,
  inSchool,
  livingKin,
  parentsRel,
  rollName,
  siblingName,
  siblingRel,
} from '@/content/lib';
import type { ContentPack, Ctx, Effect, EffectCtx, EventDef } from '@/types';

/** A dateable teenager is one who is not already attached. */
function isSingle(ctx: Ctx): boolean {
  const people = ctx.state.people;
  return livingKin(people, 'partner').length === 0 && livingKin(people, 'spouse').length === 0;
}

/** Mints a classmate of roughly the character's own age. */
function addPeer(kind: 'friend' | 'partner', relMin: number, relMax: number): Effect {
  return {
    kind: 'fn',
    run: (ctx: EffectCtx) => {
      const gender = ctx.rng.pick(ROLLED_GENDERS);
      addPerson(ctx.state, {
        kind,
        name: rollName(ctx, gender),
        gender,
        age: Math.max(13, ctx.state.character.age + ctx.rng.int(-1, 1)),
        alive: true,
        rel: ctx.rng.int(relMin, relMax),
        flags: {},
      });
    },
  };
}

/** Ends the current romance the way a teenager does: abruptly, and by text. */
function endRomance(): Effect {
  return {
    kind: 'fn',
    run: (ctx: EffectCtx) => {
      const partner = livingKin(ctx.state.people, 'partner')[0];
      if (partner) partner.kind = 'ex';
    },
  };
}

const events: EventDef[] = [
  {
    id: 'ev-teen-first-crush',
    area: 'love',
    icon: '💘',
    minAge: 13,
    maxAge: 17,
    weight: 5,
    condition: (ctx) => free(ctx) && isSingle(ctx),
    text: 'There is someone in your class you think about more than you think about anything else.',
    choices: [
      {
        label: 'Ask them out',
        outcomes: [
          {
            weight: 5,
            text: 'They said yes. You went for pancakes and talked until the place closed.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 12 },
              { kind: 'stat', stat: 'looks', delta: 1 },
              addPeer('partner', 55, 80),
            ],
          },
          {
            weight: 4,
            text: 'They were very kind about it. The whole row heard anyway.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: -8 },
              { kind: 'stat', stat: 'looks', delta: -1 },
            ],
          },
        ],
      },
      {
        label: 'Write it in a note',
        outcomes: [
          {
            weight: 4,
            text: 'The note reached them. They kept it in their wallet for a year.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: 6 }],
          },
          {
            weight: 4,
            text: 'The note reached the wrong desk, and then the whole year group.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: -7 },
              { kind: 'fame', delta: 1 },
            ],
          },
        ],
      },
      {
        label: 'Say nothing',
        outcomes: [
          {
            weight: 2,
            text: 'You said nothing for two years. It was a great deal of nothing.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: -3 },
              { kind: 'stat', stat: 'smarts', delta: 1 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-teen-acne',
    area: 'health',
    icon: '🧴',
    minAge: 13,
    maxAge: 17,
    weight: 4,
    condition: free,
    text: (ctx) =>
      `Your skin declared war ${ctx.rng.pick([
        'the week of the school photo',
        'two days before the dance',
        'the morning of a first date',
        'for no reason at all',
      ])}. The chemist did not help.`,
    effects: [
      { kind: 'stat', stat: 'looks', delta: -2 },
      { kind: 'stat', stat: 'happiness', delta: -4 },
      { kind: 'money', delta: -25 },
    ],
  },
  {
    id: 'ev-teen-voice-crack',
    area: 'health',
    icon: '🎙️',
    minAge: 13,
    maxAge: 15,
    weight: 3,
    condition: (ctx) => free(ctx) && ctx.c.gender !== 'female',
    text: 'Your voice cracked while reading aloud. Then it cracked twice more, out of spite.',
    effects: [
      { kind: 'stat', stat: 'happiness', delta: -4 },
      { kind: 'stat', stat: 'looks', delta: -1 },
    ],
  },
  {
    id: 'ev-teen-social-drama',
    area: 'life',
    icon: '📱',
    minAge: 13,
    maxAge: 17,
    weight: 4,
    condition: free,
    text: (ctx) =>
      `A group chat screenshot got out and you spent ${ctx.rng.pick([
        'three days',
        'a whole week',
        'one very long weekend',
      ])} as the main character.`,
    effects: [
      { kind: 'stat', stat: 'happiness', delta: -7 },
      { kind: 'fame', delta: 1 },
    ],
  },
  {
    id: 'ev-teen-game-marathon',
    area: 'life',
    icon: '🎮',
    minAge: 13,
    maxAge: 17,
    weight: 4,
    condition: free,
    text: (ctx) =>
      `You and ${ctx.rng.pick([
        'two friends',
        'the group chat',
        'a stranger three time zones away',
      ])} played until the sun came up. Twice.`,
    effects: [
      { kind: 'stat', stat: 'happiness', delta: 7 },
      { kind: 'stat', stat: 'health', delta: -4 },
      { kind: 'stat', stat: 'smarts', delta: -1 },
    ],
  },
  {
    id: 'ev-teen-family-dinner',
    area: 'family',
    icon: '🍽️',
    minAge: 13,
    maxAge: 17,
    weight: 4,
    condition: (ctx) => free(ctx) && hasParent(ctx),
    text: (ctx) =>
      `Family dinner. Somebody asked about ${ctx.rng.pick([
        'your grades',
        'your future',
        'the state of your room',
        'that person from the photos',
      ])} and the table went quiet.`,
    effects: [
      { kind: 'stat', stat: 'happiness', delta: -4 },
      { kind: 'stat', stat: 'smarts', delta: 1 },
      parentsRel(-2),
    ],
  },
  {
    id: 'ev-teen-grounded',
    area: 'family',
    icon: '🚫',
    minAge: 13,
    maxAge: 16,
    weight: 4,
    condition: (ctx) => free(ctx) && hasParent(ctx),
    text: (ctx) =>
      `You were grounded for ${ctx.rng.pick([
        'a week',
        'two weeks',
        'the entire half term',
      ])} over something you still say was unfair.`,
    effects: [
      { kind: 'stat', stat: 'happiness', delta: -6 },
      { kind: 'stat', stat: 'smarts', delta: 3 },
      parentsRel(-3),
    ],
  },
  {
    id: 'ev-teen-sibling-borrow',
    area: 'family',
    icon: '👕',
    minAge: 13,
    maxAge: 17,
    weight: 4,
    condition: (ctx) => free(ctx) && hasSibling(ctx),
    text: (ctx) =>
      `${siblingName(ctx)} took your best jacket without asking and returned it smelling of smoke.`,
    choices: [
      {
        label: 'Start a war',
        outcomes: [
          {
            weight: 5,
            text: 'Two weeks of slammed doors. You had it cleaned and kept the moral high ground.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: -3 },
              { kind: 'money', delta: -40 },
              siblingRel(-10),
            ],
          },
          {
            weight: 3,
            text: 'They cried, the house took their side, and the jacket still smells.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: -6 },
              siblingRel(-5),
              parentsRel(-4),
            ],
          },
        ],
      },
      {
        label: 'Let it go',
        outcomes: [
          {
            weight: 6,
            text: 'You said nothing and quietly started locking your door.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: -2 },
              { kind: 'stat', stat: 'smarts', delta: 2 },
              siblingRel(5),
            ],
          },
        ],
      },
      {
        label: 'Borrow something of theirs',
        outcomes: [
          {
            weight: 5,
            text: 'An even trade. Neither of you has mentioned it since.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: 4 }, siblingRel(-2)],
          },
          {
            weight: 3,
            text: 'You broke it. Somehow you are now the problem.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: -5 }, siblingRel(-8)],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-teen-skip-class',
    area: 'school',
    icon: '🏃',
    minAge: 13,
    maxAge: 17,
    weight: 4,
    condition: inSchool,
    text: 'You walked out of the gate at lunch and the attendance office noticed.',
    choices: [
      {
        label: 'Blame a dentist appointment',
        outcomes: [
          {
            weight: 5,
            text: 'They believed it. You will need an actual dentist next time.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 4 },
              { kind: 'stat', stat: 'smarts', delta: 2 },
            ],
          },
          {
            weight: 4,
            text: 'They rang your house inside the hour.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: -6 }, parentsRel(-7)],
          },
        ],
      },
      {
        label: 'Own it',
        outcomes: [
          {
            weight: 6,
            text: 'You took the detention without arguing and got a little credit for it.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: -3 },
              { kind: 'stat', stat: 'smarts', delta: 1 },
            ],
          },
        ],
      },
      {
        label: 'Do it again tomorrow',
        outcomes: [
          {
            weight: 4,
            text: 'A habit is only a decision you keep making.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 5 },
              { kind: 'stat', stat: 'smarts', delta: -3 },
              { kind: 'flag', flag: 'teen:truant', value: true },
            ],
          },
          {
            weight: 4,
            text: 'Two letters home and a meeting with the head of year.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: -7 }, parentsRel(-6)],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-teen-allowance',
    area: 'money',
    icon: '🪙',
    minAge: 13,
    maxAge: 16,
    weight: 4,
    condition: (ctx) => free(ctx) && hasParent(ctx),
    text: 'Everyone in your year gets more pocket money than you, and you have prepared a case.',
    choices: [
      {
        label: 'Present your case',
        outcomes: [
          {
            weight: 5,
            text: 'You got the raise and a lecture about inflation.',
            effects: [
              { kind: 'money', delta: 60 },
              { kind: 'stat', stat: 'smarts', delta: 3 },
              { kind: 'stat', stat: 'happiness', delta: 5 },
            ],
          },
          {
            weight: 4,
            text: 'You were told to get a job. You are {age}.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: -4 }],
          },
        ],
      },
      {
        label: 'Offer to do the yard work',
        outcomes: [
          {
            weight: 6,
            text: 'You mowed lawns all summer and got paid every single week.',
            effects: [
              { kind: 'money', delta: 150 },
              { kind: 'stat', stat: 'health', delta: -2 },
              { kind: 'stat', stat: 'happiness', delta: 2 },
              parentsRel(4),
            ],
          },
        ],
      },
      {
        label: 'Sulk about it',
        outcomes: [
          {
            weight: 2,
            text: 'You sulked for a fortnight. The rate did not move.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: -3 }, parentsRel(-3)],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-teen-tryouts',
    area: 'school',
    icon: '🏀',
    minAge: 13,
    maxAge: 17,
    weight: 4,
    condition: inSchool,
    text: (ctx) =>
      `Tryouts for the school ${ctx.rng.pick([
        'basketball',
        'football',
        'swim',
        'track',
      ])} team are on Friday.`,
    choices: [
      {
        label: 'Leave everything out there',
        outcomes: [
          {
            weight: 5,
            text: 'You made the squad and found out what your lungs are for.',
            effects: [
              { kind: 'stat', stat: 'health', delta: 8 },
              { kind: 'stat', stat: 'happiness', delta: 9 },
              { kind: 'stat', stat: 'looks', delta: 2 },
            ],
          },
          {
            weight: 4,
            text: 'You pulled something in the first drill and watched the rest from a bench.',
            effects: [
              { kind: 'stat', stat: 'health', delta: -6 },
              { kind: 'stat', stat: 'happiness', delta: -6 },
            ],
          },
        ],
      },
      {
        label: 'Turn up and do the minimum',
        outcomes: [
          {
            weight: 5,
            text: 'You made the reserves. It is a place to sit.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 1 },
              { kind: 'stat', stat: 'health', delta: 2 },
            ],
          },
        ],
      },
      {
        label: 'Do not go',
        outcomes: [
          {
            weight: 2,
            text: 'You went home and did not think about it again until you were forty.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: -2 }],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-teen-summer-camp',
    area: 'life',
    icon: '🏕️',
    minAge: 13,
    maxAge: 16,
    weight: 4,
    condition: free,
    text: (ctx) =>
      `Two weeks at ${ctx.rng.pick([
        'a lake camp',
        'a music camp',
        'a camp with far too many rope courses',
        'a camp nobody has ever asked you about since',
      ])}. You came back with a friendship bracelet and a tan line.`,
    effects: [
      { kind: 'stat', stat: 'happiness', delta: 8 },
      { kind: 'stat', stat: 'health', delta: 3 },
      { kind: 'stat', stat: 'smarts', delta: 1 },
    ],
  },
  {
    id: 'ev-teen-smoking',
    area: 'health',
    icon: '🚬',
    minAge: 14,
    maxAge: 17,
    weight: 4,
    condition: free,
    text: 'Somebody behind the sports hall holds out a cigarette and waits for an answer.',
    choices: [
      {
        label: 'Take one',
        outcomes: [
          {
            weight: 6,
            text: 'You coughed like a chimney and did it again the next day anyway.',
            effects: [
              { kind: 'addiction', which: 'smoking', delta: 10 },
              { kind: 'stat', stat: 'happiness', delta: 3 },
              { kind: 'stat', stat: 'health', delta: -2 },
            ],
          },
          {
            weight: 3,
            text: 'You coughed so badly that nobody has offered you anything since.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: -3 },
              { kind: 'stat', stat: 'health', delta: -1 },
            ],
          },
        ],
      },
      {
        label: 'Pass',
        outcomes: [
          {
            weight: 6,
            text: 'You said no and nothing happened. That is usually how it goes.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 1 },
              { kind: 'stat', stat: 'health', delta: 1 },
            ],
          },
          {
            weight: 3,
            text: 'You said no and heard about it for a week.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: -3 },
              { kind: 'stat', stat: 'smarts', delta: 1 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-teen-study-group',
    area: 'school',
    icon: '📓',
    minAge: 14,
    maxAge: 17,
    weight: 4,
    condition: inSchool,
    text: 'You joined a study group that turned out to be about twenty percent studying.',
    effects: [
      { kind: 'stat', stat: 'smarts', delta: 4 },
      { kind: 'stat', stat: 'happiness', delta: 5 },
      addPeer('friend', 50, 75),
    ],
  },
  {
    id: 'ev-teen-heartbreak',
    area: 'love',
    icon: '🥀',
    minAge: 14,
    maxAge: 17,
    weight: 4,
    /* A spouse would win `{partner}` in the text while `endRomance` ends the
       boyfriend/girlfriend, so this only fires when the romance is the only one. */
    condition: (ctx) =>
      free(ctx) &&
      livingKin(ctx.state.people, 'partner').length > 0 &&
      livingKin(ctx.state.people, 'spouse').length === 0,
    text: '{partner} ended it by text. At 11pm. On a Tuesday.',
    effects: [
      endRomance(),
      { kind: 'stat', stat: 'happiness', delta: -13 },
      { kind: 'stat', stat: 'health', delta: -2 },
    ],
  },
  {
    id: 'ev-teen-curfew-fight',
    area: 'family',
    icon: '🕚',
    minAge: 14,
    maxAge: 17,
    weight: 4,
    condition: (ctx) => free(ctx) && hasParent(ctx),
    text: 'You came in forty minutes late. The hall light was on, and the talk lasted longer.',
    effects: [{ kind: 'stat', stat: 'happiness', delta: -5 }, parentsRel(-6)],
  },
  {
    id: 'ev-teen-garage-band',
    area: 'life',
    icon: '🎸',
    minAge: 14,
    maxAge: 17,
    weight: 4,
    condition: free,
    text: "There is a drum kit in a friend's garage and nobody's parents are home until six.",
    choices: [
      {
        label: 'Start a band',
        outcomes: [
          {
            weight: 5,
            text: 'Three chords, one gig at a birthday party, and forty people who know your name.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 9 },
              { kind: 'fame', delta: 2 },
            ],
          },
          {
            weight: 4,
            text: 'You broke up over the band name before learning a whole song.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: -3 },
              { kind: 'stat', stat: 'smarts', delta: 1 },
            ],
          },
        ],
      },
      {
        label: 'Be the one who books the gigs',
        outcomes: [
          {
            weight: 4,
            text: 'You never played a note and ran the entire operation.',
            effects: [
              { kind: 'stat', stat: 'smarts', delta: 4 },
              { kind: 'stat', stat: 'happiness', delta: 5 },
              { kind: 'fame', delta: 1 },
            ],
          },
        ],
      },
      {
        label: 'Just listen',
        outcomes: [
          {
            weight: 2,
            text: 'You sat on the spare amp all summer and had a great time.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: 3 }],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-teen-dyed-hair',
    area: 'life',
    icon: '💈',
    minAge: 14,
    maxAge: 17,
    weight: 4,
    condition: free,
    text: 'There is a box of bleach in the bathroom and forty minutes before anyone gets home.',
    choices: [
      {
        label: 'Just one streak',
        outcomes: [
          {
            weight: 6,
            text: 'One streak, clean job, quietly excellent.',
            effects: [
              { kind: 'stat', stat: 'looks', delta: 3 },
              { kind: 'stat', stat: 'happiness', delta: 4 },
            ],
          },
        ],
      },
      {
        label: 'Go platinum',
        outcomes: [
          {
            weight: 4,
            text: 'It came out perfect. You were unbearable about it for a month.',
            effects: [
              { kind: 'stat', stat: 'looks', delta: 6 },
              { kind: 'stat', stat: 'happiness', delta: 8 },
            ],
          },
          {
            weight: 5,
            text: 'It came out orange. School had opinions and so did the house.',
            effects: [
              { kind: 'stat', stat: 'looks', delta: -6 },
              { kind: 'stat', stat: 'happiness', delta: -7 },
              parentsRel(-4),
            ],
          },
        ],
      },
      {
        label: 'Put the box back',
        outcomes: [
          {
            weight: 2,
            text: 'You put it back. Your hair lived to fight another day.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: -1 }],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-teen-volunteering',
    area: 'life',
    icon: '🤝',
    minAge: 14,
    maxAge: 17,
    weight: 3,
    condition: free,
    text: (ctx) =>
      `You spent a Saturday ${ctx.rng.pick([
        'at the animal shelter',
        'sorting tins at the food bank',
        'painting over graffiti',
        'walking dogs for the whole street',
      ])} and it went on your record.`,
    effects: [
      { kind: 'stat', stat: 'happiness', delta: 5 },
      { kind: 'stat', stat: 'smarts', delta: 2 },
      { kind: 'stat', stat: 'health', delta: -1 },
    ],
  },
  {
    id: 'ev-teen-learner-permit',
    area: 'life',
    icon: '🪪',
    minAge: 15,
    maxAge: 16,
    weight: MILESTONE,
    oncePerLife: true,
    condition: free,
    text: 'You passed the written test and got your learner permit. The photo is permanent.',
    effects: [
      { kind: 'stat', stat: 'happiness', delta: 7 },
      { kind: 'stat', stat: 'smarts', delta: 2 },
      { kind: 'money', delta: -35 },
      { kind: 'flag', flag: 'teen:permit', value: true },
    ],
  },
  {
    id: 'ev-teen-job-nudge',
    area: 'work',
    icon: '🧾',
    minAge: 15,
    maxAge: 17,
    weight: 4,
    condition: (ctx) => free(ctx) && ctx.c.job === null,
    text:
      'The hardware shop on the corner has a card in the window: weekend help wanted, ask inside.',
    effects: [
      { kind: 'stat', stat: 'happiness', delta: 2 },
      { kind: 'stat', stat: 'smarts', delta: 1 },
      { kind: 'flag', flag: 'teen:jobLead', value: true },
    ],
  },
  {
    id: 'ev-teen-food-court',
    area: 'work',
    icon: '🍟',
    minAge: 15,
    maxAge: 17,
    weight: 3,
    condition: free,
    text: 'One trial shift at the food court. You smell of fryer oil and you got paid in cash.',
    effects: [
      { kind: 'money', delta: 90 },
      { kind: 'stat', stat: 'happiness', delta: 2 },
      { kind: 'stat', stat: 'health', delta: -1 },
    ],
  },
  {
    id: 'ev-teen-first-paycheck',
    area: 'work',
    icon: '💵',
    minAge: 15,
    maxAge: 17,
    weight: MILESTONE,
    oncePerLife: true,
    condition: (ctx) => free(ctx) && ctx.c.job !== null,
    text: 'Your first real paycheck. Taxes took a bite and you took it personally.',
    effects: [
      { kind: 'stat', stat: 'happiness', delta: 8 },
      { kind: 'stat', stat: 'smarts', delta: 3 },
    ],
  },
  {
    id: 'ev-teen-extra-shifts',
    area: 'work',
    icon: '⏰',
    minAge: 15,
    maxAge: 17,
    weight: 3,
    condition: (ctx) => free(ctx) && ctx.c.job !== null,
    text:
      'Your manager offered you every shift going in the week before finals. You took all of them.',
    effects: [
      { kind: 'money', delta: 250 },
      { kind: 'stat', stat: 'smarts', delta: -3 },
      { kind: 'stat', stat: 'health', delta: -2 },
      { kind: 'stat', stat: 'happiness', delta: 2 },
    ],
  },
  {
    id: 'ev-teen-exam-pressure',
    area: 'school',
    icon: '📚',
    minAge: 15,
    maxAge: 17,
    weight: 5,
    condition: inSchool,
    text: 'Finals in four days. You have four subjects and a phone that will not stop buzzing.',
    choices: [
      {
        label: 'Cram every night',
        outcomes: [
          {
            weight: 5,
            text: 'You learned it all in ninety-six hours and forgot half of it by July.',
            effects: [
              { kind: 'stat', stat: 'smarts', delta: 6 },
              { kind: 'stat', stat: 'health', delta: -4 },
              { kind: 'stat', stat: 'happiness', delta: -3 },
            ],
          },
          {
            weight: 3,
            text: 'You fell asleep on the notes and woke at five, underprepared.',
            effects: [
              { kind: 'stat', stat: 'smarts', delta: 1 },
              { kind: 'stat', stat: 'health', delta: -5 },
              { kind: 'stat', stat: 'happiness', delta: -5 },
            ],
          },
        ],
      },
      {
        label: 'Make a schedule and stick to it',
        outcomes: [
          {
            weight: 6,
            text: 'Boring, effective, and eight hours of sleep a night.',
            effects: [
              { kind: 'stat', stat: 'smarts', delta: 5 },
              { kind: 'stat', stat: 'happiness', delta: 2 },
            ],
          },
        ],
      },
      {
        label: 'Wing it',
        outcomes: [
          {
            weight: 5,
            text: 'You winged it. The results were exactly as winged.',
            effects: [
              { kind: 'stat', stat: 'smarts', delta: -3 },
              { kind: 'stat', stat: 'happiness', delta: 4 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-teen-party-invite',
    area: 'life',
    icon: '🎉',
    minAge: 15,
    maxAge: 17,
    weight: 5,
    condition: (ctx) => free(ctx) && hasParent(ctx),
    text: 'There is a party on Friday. You are not allowed to go to the party.',
    choices: [
      {
        label: 'Sneak out the window',
        outcomes: [
          {
            weight: 4,
            text: 'Best night of the year. You also learned what warm cheap beer tastes like.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 10 },
              { kind: 'addiction', which: 'alcohol', delta: 5 },
              { kind: 'stat', stat: 'health', delta: -2 },
            ],
          },
          {
            weight: 4,
            text: 'The porch light was on when you got back. It was on for a reason.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: -8 }, parentsRel(-10)],
          },
        ],
      },
      {
        label: 'Ask one more time',
        outcomes: [
          {
            weight: 5,
            text: 'You were told no again and stayed in with a takeaway.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: -2 }, parentsRel(4)],
          },
          {
            weight: 3,
            text: 'Yes, if you were home by eleven. You were home at eleven.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: 6 }, parentsRel(3)],
          },
        ],
      },
      {
        label: 'Skip it',
        outcomes: [
          {
            weight: 2,
            text: 'You watched three episodes of something and saw the photos on Sunday.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: -3 }],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-teen-driving-lesson',
    area: 'life',
    icon: '🚙',
    minAge: 16,
    maxAge: 17,
    weight: MILESTONE,
    oncePerLife: true,
    condition: (ctx) => free(ctx) && hasParent(ctx),
    text: (ctx) =>
      `Your first driving lesson, in ${ctx.rng.pick([
        'an empty car park',
        'a supermarket lot on a Sunday',
        'the road behind the industrial estate',
      ])}.`,
    choices: [
      {
        label: 'Take it seriously',
        outcomes: [
          {
            weight: 6,
            text: 'You stalled eleven times, and then you never stalled again.',
            effects: [
              { kind: 'stat', stat: 'smarts', delta: 4 },
              { kind: 'stat', stat: 'happiness', delta: 5 },
              { kind: 'flag', flag: 'teen:canDrive', value: true },
            ],
          },
          {
            weight: 3,
            text: 'You clipped a bollard at four miles an hour. The bollard won.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: -4 },
              { kind: 'money', delta: -200 },
              parentsRel(-4),
            ],
          },
        ],
      },
      {
        label: 'Show off a bit',
        outcomes: [
          {
            weight: 4,
            text: 'One handbrake turn, and you were never allowed near that car again.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: 6 }, parentsRel(-8)],
          },
          {
            weight: 5,
            text: 'You went for the handbrake, found the wipers, and heard about it for a year.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: -5 }],
          },
        ],
      },
      {
        label: 'Call it off',
        outcomes: [
          {
            weight: 2,
            text: 'You are not ready and the car park is not going anywhere.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: -1 }],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-teen-preprom',
    area: 'school',
    icon: '🚘',
    minAge: 16,
    maxAge: 17,
    weight: MILESTONE,
    oncePerLife: true,
    condition: inSchool,
    text: "Somebody's cousin is hosting a pre-prom party in a basement two hours before the dance.",
    choices: [
      {
        label: 'Go for one hour',
        outcomes: [
          {
            weight: 6,
            text: 'One hour, three photos, and you arrived at the dance on time and famous.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 8 },
              { kind: 'stat', stat: 'looks', delta: 1 },
              { kind: 'fame', delta: 1 },
            ],
          },
          {
            weight: 3,
            text: 'One hour became three. You missed the good part of the night entirely.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: -4 }],
          },
        ],
      },
      {
        label: 'Skip it and get ready properly',
        outcomes: [
          {
            weight: 5,
            text: 'You arrived fresh, photographed well, and remember all of it.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 5 },
              { kind: 'stat', stat: 'looks', delta: 3 },
            ],
          },
        ],
      },
      {
        label: 'Host it yourself',
        outcomes: [
          {
            weight: 4,
            text: 'Forty people, one basement, and a carpet that never recovered.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 9 },
              { kind: 'money', delta: -150 },
              { kind: 'fame', delta: 2 },
              parentsRel(-6),
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-teen-yearbook-quote',
    area: 'school',
    icon: '✍️',
    minAge: 17,
    maxAge: 17,
    weight: MILESTONE_ONE_YEAR,
    oncePerLife: true,
    condition: inSchool,
    text: 'The yearbook wants your quote by Friday, and it is permanent.',
    choices: [
      {
        label: 'A song lyric nobody will get',
        outcomes: [
          {
            weight: 5,
            text: 'Nobody got it. You still stand by it.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 4 },
              { kind: 'stat', stat: 'smarts', delta: 1 },
            ],
          },
        ],
      },
      {
        label: 'Something genuinely funny',
        outcomes: [
          {
            weight: 5,
            text: 'It got quoted at three separate reunions.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 7 },
              { kind: 'fame', delta: 2 },
            ],
          },
          {
            weight: 3,
            text: 'It read as mean in print. Two people never spoke to you again.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: -5 }],
          },
        ],
      },
      {
        label: 'Just your name',
        outcomes: [
          {
            weight: 2,
            text: 'Clean, classic, and completely forgotten.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 1 },
              { kind: 'stat', stat: 'smarts', delta: 2 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-teen-graduation-nerves',
    area: 'school',
    icon: '😰',
    minAge: 17,
    maxAge: 17,
    weight: MILESTONE_ONE_YEAR,
    oncePerLife: true,
    condition: inSchool,
    text:
      'One year of school left and everybody keeps asking what you are going to do with your life.',
    effects: [
      { kind: 'stat', stat: 'happiness', delta: -5 },
      { kind: 'stat', stat: 'smarts', delta: 3 },
    ],
  },
];

/** The teenage years: school pressure, first romances and every bad idea in between. */
export const eventsTeenPack: ContentPack = {
  id: 'events-teen',
  events,
};
