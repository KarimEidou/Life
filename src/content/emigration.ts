import type {
  Character,
  ContentPack,
  Ctx,
  Effect,
  EffectCtx,
  EventDef,
  GameState,
  Person,
} from '@/types';

/**
 * Life after the move: the homesickness, the paperwork and the year the passport
 * finally arrives.
 *
 * The visa roll itself belongs to the engine — `emigrateTo` charges the fee,
 * stamps `flags.lastVisaAge` and either moves the character or denies them — so
 * nothing here applies for anything. This pack is the flavour that hangs off
 * having gone, and every card is gated on `abroad`.
 *
 * That gate is deliberately not just "has a visa stamp". `lastVisaAge` is
 * written whether the application was approved or refused, so a character who
 * paid $2,000 and stayed exactly where they were would otherwise start missing
 * food they never left behind. The birth line the log opens with names the
 * country the life began in, which is the one record of the move the engine
 * keeps; where that line is missing — a legacy heir's log opens differently —
 * the stamp is all there is to go on, and the pack takes it.
 */

/* ------------------------------------------------------------------ */
/* Readers                                                             */
/* ------------------------------------------------------------------ */

/** The age the last visa was applied for, or nothing readable at all. */
function visaAge(c: Character): number | undefined {
  const raw = c.flags.lastVisaAge;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return undefined;
  return raw;
}

/** Years since that application; `Infinity` when there was never one. */
function yearsSinceVisa(c: Character): number {
  const applied = visaAge(c);
  if (applied === undefined) return Infinity;
  const since = c.age - applied;
  return Number.isFinite(since) && since > 0 ? since : 0;
}

/** True once the life is being lived somewhere other than where it opened. */
function abroad(ctx: Ctx): boolean {
  const c = ctx.c;
  if (c.prison !== null) return false;
  if (c.flags['emigration:done'] === true) return true;
  if (visaAge(c) === undefined) return false;
  const label = typeof c.flags.countryLabel === 'string' ? c.flags.countryLabel : '';
  const opening = ctx.state.log[0]?.entries[0]?.text ?? '';
  // No birth line to compare against: the stamp is the only evidence there is.
  if (label === '' || !opening.startsWith('You were born')) return true;
  return !opening.includes(label);
}

/** Abroad, and still inside the first `n` years of it. */
function settlingIn(n: number): (ctx: Ctx) => boolean {
  return (ctx) => abroad(ctx) && yearsSinceVisa(ctx.c) <= n;
}

/** Everyone still alive. Widened first: a loaded save can hold a hole. */
function alivePeople(state: GameState): Person[] {
  const list: (Person | undefined)[] = Object.values(state.people);
  return list.filter((p): p is Person => p !== undefined && p.alive === true);
}

/** Somebody back home who would get on a plane for you. */
function hasFamily(state: GameState): boolean {
  return alivePeople(state).some(
    (p) => p.kind === 'mother' || p.kind === 'father' || p.kind === 'sibling'
  );
}

/**
 * The marker the world-citizen achievement reads.
 * Set in exactly one place — the ceremony — so it means the passport, not the
 * plane ticket.
 */
const markCitizen: Effect = {
  kind: 'fn',
  run: (ctx: EffectCtx) => {
    ctx.state.character.flags['emigration:done'] = true;
  },
};

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

const events: EventDef[] = [
  {
    id: 'ev-emig-homesickness',
    area: 'emigration',
    icon: '🏠',
    minAge: 18,
    maxAge: 110,
    weight: 3,
    condition: abroad,
    text: 'A song you have not heard since childhood came on in a supermarket in {country}.',
    effects: [{ kind: 'stat', stat: 'happiness', delta: -4 }],
  },
  {
    id: 'ev-emig-culture-shock',
    area: 'emigration',
    icon: '😵',
    minAge: 18,
    maxAge: 110,
    weight: 4,
    // Only while it is still new; by year four this is just Tuesday.
    condition: settlingIn(3),
    text: 'Nothing here works the way it did at home. Not the queues, not the bread, not the small talk.',
    choices: [
      {
        label: 'Lean in',
        outcomes: [
          {
            weight: 6,
            text: 'You said yes to everything for a year. You now have opinions about the bread.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 6 },
              { kind: 'stat', stat: 'smarts', delta: 2 },
            ],
          },
          {
            weight: 3,
            text: 'You tried the local delicacy in front of witnesses. Once.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: -2 },
              { kind: 'stat', stat: 'smarts', delta: 1 },
            ],
          },
        ],
      },
      {
        label: 'Stick to what you know',
        outcomes: [
          {
            weight: 4,
            text: 'You found the one shop that sells home. You go there weekly.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: 2 }],
          },
          {
            weight: 3,
            text: 'Six months in and your whole life is three streets wide.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: -3 }],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-emig-language-wall',
    area: 'emigration',
    icon: '🗣️',
    minAge: 18,
    maxAge: 110,
    weight: 3,
    condition: settlingIn(5),
    text: 'You understood the joke a full minute after everyone else laughed.',
    effects: [
      { kind: 'stat', stat: 'smarts', delta: 2 },
      { kind: 'stat', stat: 'happiness', delta: -2 },
    ],
  },
  {
    id: 'ev-emig-paperwork',
    area: 'emigration',
    icon: '🗂️',
    minAge: 18,
    maxAge: 110,
    weight: 3,
    condition: abroad,
    text: 'Renewal season. Another appointment, another stamp, another morning in a plastic chair.',
    effects: [
      { kind: 'money', delta: -400 },
      { kind: 'stat', stat: 'happiness', delta: -3 },
    ],
  },
  {
    id: 'ev-emig-taste-of-home',
    area: 'emigration',
    icon: '🥘',
    minAge: 18,
    maxAge: 110,
    weight: 3,
    condition: abroad,
    text: 'You found a shop selling the snacks from home. You bought an unreasonable amount.',
    effects: [
      { kind: 'money', delta: -60 },
      { kind: 'stat', stat: 'happiness', delta: 5 },
    ],
  },
  {
    id: 'ev-emig-old-friend',
    area: 'emigration',
    icon: '✈️',
    minAge: 18,
    maxAge: 110,
    weight: 3,
    condition: abroad,
    text: 'An old friend flew out for a week. You spoke your own language at full speed for six days.',
    effects: [{ kind: 'stat', stat: 'happiness', delta: 6 }],
  },
  {
    id: 'ev-emig-family-visit',
    area: 'emigration',
    icon: '👵',
    minAge: 18,
    maxAge: 110,
    weight: 3,
    condition: (ctx) => abroad(ctx) && hasFamily(ctx.state),
    text: 'Your family booked flights to {country} and asked what the weather does here.',
    choices: [
      {
        label: 'Play tour guide',
        outcomes: [
          {
            weight: 5,
            text: 'Ten days, four museums and one argument about the tap water. Worth it.',
            effects: [
              { kind: 'money', delta: -900 },
              { kind: 'stat', stat: 'happiness', delta: 7 },
              { kind: 'rel', who: 'random-family', delta: 6 },
            ],
          },
          {
            weight: 2,
            text: 'You showed them everything and they said it was fine. Just fine.',
            effects: [
              { kind: 'money', delta: -900 },
              { kind: 'stat', stat: 'happiness', delta: 1 },
              { kind: 'rel', who: 'random-family', delta: 2 },
            ],
          },
        ],
      },
      {
        label: 'Work through it',
        outcomes: [
          {
            weight: 3,
            text: 'You gave them a map and three evenings. It was noticed.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: -2 },
              { kind: 'rel', who: 'random-family', delta: -5 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-emig-citizenship',
    area: 'emigration',
    icon: '🛂',
    minAge: 18,
    maxAge: 110,
    weight: 5,
    oncePerLife: true,
    // Five years of residence, then a small room, a flag and a photocopier.
    condition: (ctx) => abroad(ctx) && yearsSinceVisa(ctx.c) >= 5,
    text: 'You swore an oath in a municipal room in {country} and got a passport out of it.',
    effects: [
      markCitizen,
      { kind: 'stat', stat: 'happiness', delta: 8 },
      {
        kind: 'log',
        icon: '🛂',
        text: 'You are a citizen of {country}.',
        logKind: 'good',
      },
    ],
  },
];

/** Moving abroad: visa interactions and the events of settling into a new country. */
export const emigrationPack: ContentPack = {
  id: 'emigration',
  events,
};
