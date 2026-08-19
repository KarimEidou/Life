/**
 * Education content: the school ladder from elementary through postgrad, plus
 * the small disasters and triumphs that happen while a desk is occupied.
 *
 * `SchoolDef.majors` means two different things by level, and the engine reads
 * it both ways: on `uni` it is the list of majors offered, on a postgrad
 * programme it is the list of undergrad majors that programme accepts.
 */

import type { ContentPack, Ctx, EventDef, SchoolDef } from '@/types';

/** The eight shared majors. University teaches all of them. */
const ALL_MAJORS = [
  'cs',
  'engineering',
  'business',
  'biology',
  'polisci',
  'psychology',
  'nursing',
  'art',
];

const schools: SchoolDef[] = [
  {
    id: 'school-primary',
    label: 'Elementary School',
    level: 'primary',
    years: 5,
    tuitionPerYear: 0,
  },
  {
    id: 'school-middle',
    label: 'Middle School',
    level: 'middle',
    years: 3,
    tuitionPerYear: 0,
  },
  {
    id: 'school-high',
    label: 'High School',
    level: 'high',
    years: 4,
    tuitionPerYear: 0,
  },
  {
    id: 'uni',
    label: 'University',
    level: 'university',
    years: 4,
    tuitionPerYear: 15000,
    majors: ALL_MAJORS,
    minGpa: 2.0,
  },
  {
    id: 'med-school',
    label: 'Medical School',
    level: 'postgrad',
    years: 4,
    tuitionPerYear: 25000,
    // Accepted undergrad majors, not subjects taught.
    majors: ['biology', 'nursing'],
    minGpa: 3.4,
  },
  {
    id: 'law-school',
    label: 'Law School',
    level: 'postgrad',
    years: 3,
    tuitionPerYear: 22000,
    majors: ['polisci', 'business', 'psychology'],
    minGpa: 3.0,
  },
  {
    id: 'mba',
    label: 'Business School (MBA)',
    level: 'postgrad',
    years: 2,
    tuitionPerYear: 30000,
    majors: ALL_MAJORS,
    minGpa: 2.8,
  },
  {
    id: 'phd',
    label: 'PhD Program',
    level: 'postgrad',
    years: 4,
    tuitionPerYear: 8000,
    majors: ALL_MAJORS,
    minGpa: 3.5,
  },
];

/** The age the high school diploma lands on; the education phase's own `HIGH_END`. */
const GRADUATION_AGE = 18;

/**
 * Every event below is school life, so it needs a desk to happen at. A prison
 * cell is not one: a sentence keeps the enrolment record but ends attendance.
 */
function inSchool(ctx: Ctx): boolean {
  return ctx.c.education.enrolledIn !== undefined && !ctx.c.prison;
}

/**
 * In school, or standing in the year high school ended.
 *
 * The education phase runs 3rd and the events phase 7th, so the year the diploma
 * lands reaches the draw with the desk already emptied. A graduation-year moment
 * gated on `inSchool` alone therefore loses that whole year and can only ever be
 * logged before the graduation line it is written to follow. Only a graduate
 * gets the year back: a dropout's `level` never reaches `high`, and a cell still
 * ends attendance.
 */
function inSchoolOrGraduating(ctx: Ctx): boolean {
  const c = ctx.c;
  if (inSchool(ctx)) return true;
  return c.age === GRADUATION_AGE && c.education.level === 'high' && !c.prison;
}

const events: EventDef[] = [
  {
    id: 'ev-school-spelling-bee',
    area: 'school',
    icon: '🐝',
    minAge: 7,
    maxAge: 11,
    weight: 4,
    oncePerLife: true,
    condition: inSchool,
    text: (ctx) =>
      `You won the class spelling bee on "${ctx.rng.pick([
        'onomatopoeia',
        'labyrinth',
        'rhythm',
        'asparagus',
        'bureaucracy',
      ])}". The trophy was plastic.`,
    effects: [
      { kind: 'stat', stat: 'smarts', delta: 5 },
      { kind: 'stat', stat: 'happiness', delta: 5 },
    ],
  },
  {
    id: 'ev-school-bully',
    area: 'school',
    icon: '😠',
    minAge: 6,
    maxAge: 12,
    weight: 5,
    condition: inSchool,
    text: 'A bigger kid corners you by the bike racks and wants your lunch money.',
    choices: [
      {
        label: 'Stand up to them',
        outcomes: [
          {
            weight: 5,
            text: 'You swung first. The bully went looking for someone easier.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 7 },
              { kind: 'stat', stat: 'health', delta: -3 },
              { kind: 'flag', flag: 'school:stoodUp', value: true },
            ],
          },
          {
            weight: 4,
            text: 'You swung first and lost. The nurse had opinions.',
            effects: [
              { kind: 'stat', stat: 'health', delta: -7 },
              { kind: 'stat', stat: 'happiness', delta: -5 },
              { kind: 'stat', stat: 'looks', delta: -3 },
            ],
          },
        ],
      },
      {
        label: 'Tell a teacher',
        outcomes: [
          {
            weight: 6,
            text: 'The bully got a week of detention. You got a new nickname.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: -2 }],
          },
          {
            weight: 3,
            text: 'The teacher made you shake hands. The bully squeezed.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: -4 },
              { kind: 'stat', stat: 'health', delta: -2 },
            ],
          },
        ],
      },
      {
        label: 'Hand over your lunch money',
        outcomes: [
          {
            weight: 1,
            text: 'You paid the toll and went hungry until dinner.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: -6 },
              { kind: 'stat', stat: 'health', delta: -2 },
              { kind: 'money', delta: -20 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-school-science-fair',
    area: 'school',
    icon: '🔬',
    minAge: 10,
    maxAge: 14,
    weight: 4,
    oncePerLife: true,
    condition: inSchool,
    text: (ctx) =>
      `Your ${ctx.rng.pick([
        'baking soda volcano',
        'potato battery',
        'solar oven',
        'mould garden',
        'egg drop rig',
      ])} took second place at the science fair.`,
    effects: [
      { kind: 'stat', stat: 'smarts', delta: 6 },
      { kind: 'stat', stat: 'happiness', delta: 4 },
    ],
  },
  {
    id: 'ev-school-detention',
    area: 'school',
    icon: '🪑',
    minAge: 13,
    maxAge: 17,
    weight: 5,
    condition: inSchool,
    text: (ctx) =>
      `You got detention for ${ctx.rng.pick([
        'arguing with a substitute',
        'a phone that rang during a test',
        'a stunt involving the fire alarm',
        'forging a hall pass',
        'a food fight you did not start',
      ])}.`,
    effects: [
      { kind: 'stat', stat: 'happiness', delta: -4 },
      {
        kind: 'fn',
        run: (ctx) => {
          const flags = ctx.state.character.flags;
          const raw = flags['school:detentions'];
          const held = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
          flags['school:detentions'] = held + 1;
        },
      },
    ],
  },
  {
    id: 'ev-school-cheat',
    area: 'school',
    icon: '📝',
    minAge: 14,
    // 17, not 18: the desk is empty by the time the graduation year draws.
    maxAge: 17,
    weight: 5,
    condition: inSchool,
    text: 'The kid beside you is holding the answer key where you can read it.',
    choices: [
      {
        label: 'Copy the answers',
        outcomes: [
          {
            weight: 6,
            text: 'You aced the test. Nobody asked how.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 5 },
              { kind: 'stat', stat: 'smarts', delta: 1 },
              { kind: 'flag', flag: 'school:cheated', value: true },
            ],
          },
          {
            weight: 4,
            text: 'Two identical papers, two zeros. Your parents were called.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: -8 },
              { kind: 'stat', stat: 'smarts', delta: -2 },
              { kind: 'rel', who: 'random-family', delta: -6 },
              { kind: 'flag', flag: 'school:cheated', value: true },
            ],
          },
        ],
      },
      {
        label: 'Do it the hard way',
        outcomes: [
          {
            weight: 6,
            text: 'You earned an honest B and slept fine.',
            effects: [
              { kind: 'stat', stat: 'smarts', delta: 4 },
              { kind: 'stat', stat: 'happiness', delta: -1 },
            ],
          },
          {
            weight: 3,
            text: 'You studied all night and bombed it anyway.',
            effects: [
              { kind: 'stat', stat: 'smarts', delta: 2 },
              { kind: 'stat', stat: 'happiness', delta: -5 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-school-prom',
    area: 'school',
    icon: '🕺',
    minAge: 16,
    // 17, not 18: see `ev-school-cheat`.
    maxAge: 17,
    weight: 5,
    oncePerLife: true,
    condition: inSchool,
    text: 'Prom is in two weeks and the posters are everywhere.',
    choices: [
      {
        label: 'Ask your crush',
        outcomes: [
          {
            weight: 5,
            text: 'They said yes. You danced badly all night and did not care.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 10 },
              { kind: 'stat', stat: 'looks', delta: 2 },
            ],
          },
          {
            weight: 3,
            text: 'They said no, loudly, next to the vending machines.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: -7 },
              { kind: 'stat', stat: 'looks', delta: -1 },
            ],
          },
        ],
      },
      {
        label: 'Go with your friends',
        outcomes: [
          {
            weight: 1,
            text: 'You went as a pack, ruined every photo and ate all the cake.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 6 },
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
            text: 'You stayed home with a movie and zero regrets.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 2 },
              { kind: 'stat', stat: 'smarts', delta: 2 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-school-valedictorian',
    area: 'school',
    icon: '🎓',
    minAge: 17,
    maxAge: 18,
    weight: 6,
    oncePerLife: true,
    condition: (ctx) => inSchoolOrGraduating(ctx) && ctx.c.education.gpa >= 3.8,
    text: 'You were named valedictorian. You wrote the speech at 2am and it landed anyway.',
    effects: [
      { kind: 'stat', stat: 'happiness', delta: 12 },
      { kind: 'stat', stat: 'smarts', delta: 6 },
      { kind: 'money', delta: 2000 },
      { kind: 'flag', flag: 'school:valedictorian', value: true },
      { kind: 'log', icon: '💵', text: 'A $2,000 scholarship came with it.', logKind: 'money' },
    ],
  },
  {
    id: 'ev-school-play',
    area: 'school',
    icon: '🎭',
    minAge: 8,
    maxAge: 14,
    weight: 4,
    condition: inSchool,
    text: (ctx) =>
      `You were cast as ${ctx.rng.pick([
        'a tree',
        'the narrator',
        'the lead',
        'a talking spoon',
        'the understudy who went on anyway',
      ])} in the school play.`,
    effects: [
      { kind: 'stat', stat: 'happiness', delta: 5 },
      { kind: 'stat', stat: 'looks', delta: 1 },
      { kind: 'fame', delta: 1 },
    ],
  },
  {
    id: 'ev-school-field-trip',
    area: 'school',
    icon: '🚌',
    minAge: 7,
    maxAge: 15,
    weight: 5,
    condition: inSchool,
    text: (ctx) =>
      `Field trip to ${ctx.rng.pick([
        'the natural history museum',
        'the aquarium',
        'a working dairy farm',
        'the planetarium',
        'a water treatment plant',
      ])}. You slept on the bus both ways.`,
    effects: [
      { kind: 'stat', stat: 'smarts', delta: 3 },
      { kind: 'stat', stat: 'happiness', delta: 5 },
    ],
  },
  {
    id: 'ev-school-yearbook',
    area: 'school',
    icon: '📖',
    minAge: 17,
    maxAge: 18,
    weight: 5,
    oncePerLife: true,
    condition: inSchoolOrGraduating,
    text: 'You signed forty yearbooks with "stay cool, never change" and were voted Most Likely To Vanish.',
    effects: [
      { kind: 'stat', stat: 'happiness', delta: 6 },
      { kind: 'stat', stat: 'looks', delta: 1 },
    ],
  },
];

/** Schools from primary through postgrad, with tuition, majors and school-life events. */
export const educationPack: ContentPack = {
  id: 'education',
  schools,
  events,
};
