import { alivePeople } from '@/content/lib';
import type {
  ContentPack,
  Ctx,
  Effect,
  EffectCtx,
  EventDef,
  GameState,
  YearLog,
} from '@/types';

/**
 * Life after the move: the homesickness, the paperwork and the year the passport
 * finally arrives.
 *
 * The visa roll itself belongs to the engine — `emigrateTo` charges the fee,
 * stamps `flags.lastVisaAge` and either moves the character or denies them — so
 * nothing here applies for anything. This pack is the flavour that hangs off
 * having gone, and every card is gated on `abroad` — the renewal queue on the
 * narrower `onAVisa`, since a naturalised citizen has nothing left to renew.
 *
 * That gate is deliberately not "has a visa stamp". `lastVisaAge` is written
 * whether the application was approved or refused, so a character who paid
 * $2,000 and stayed exactly where they were would otherwise start missing food
 * they never left behind. The record of an approved move is the line the engine
 * logs on success, so `abroad` reads the log for that: a refusal leaves nothing
 * behind to find, and a legacy heir — whose log opens with a different sentence
 * and who inherits no stamp — is held to the same evidence as everyone else.
 *
 * That line also dates the arrival, so residence is counted from the year it was
 * logged rather than from the stamp. A refused second application leaves a fresh
 * stamp on a life that has not moved an inch, and must not restart the years.
 */

/* ------------------------------------------------------------------ */
/* Readers                                                             */
/* ------------------------------------------------------------------ */

/** The line `emigrateTo` logs when a visa lands, and only then. */
const MOVED_PREFIX = 'You moved to ';

/**
 * The year of the latest approved move, or nothing when there has never been
 * one. Searched newest first: the country a life is settling into is the one it
 * arrived in last, not the one it left on the way.
 */
function arrivalYear(state: GameState): YearLog | undefined {
  /* Widened as in `alivePeople`: this walks a loaded save's whole log from
     inside an event condition, where a throw would strand a half-run year. */
  const years: (YearLog | undefined)[] = state.log;
  for (let i = years.length - 1; i >= 0; i -= 1) {
    const year = years[i];
    for (const entry of year?.entries ?? []) {
      const text: unknown = entry?.text;
      if (typeof text === 'string' && text.startsWith(MOVED_PREFIX)) return year;
    }
  }
  return undefined;
}

/** True once the engine has actually moved this life to another country. */
function everMoved(state: GameState): boolean {
  return arrivalYear(state) !== undefined;
}

/**
 * Years lived where the life last landed; 0 in the year of the move itself, and
 * `Infinity` when no move is datable, which reads as "long since settled" and
 * so keeps the newly-arrived cards quiet.
 */
function yearsSettled(ctx: Ctx): number {
  const arrived: unknown = arrivalYear(ctx.state)?.age;
  if (typeof arrived !== 'number' || !Number.isFinite(arrived)) return Infinity;
  const since = ctx.c.age - arrived;
  return Number.isFinite(since) && since > 0 ? since : 0;
}

/** True once the life is being lived somewhere other than where it opened. */
function abroad(ctx: Ctx): boolean {
  const c = ctx.c;
  if (c.prison !== null) return false;
  if (c.flags['emigration:done'] === true) return true;
  if (!everMoved(ctx.state)) return false;
  /* Home again. The birth line is the only record of where a life opened, so
     only generation 1 can be back — an heir's log opens with another sentence
     and names no birthplace. The country slot is matched whole: `includes`
     would read a character surnamed `France` who moved to France as never
     having left. */
  const label = typeof c.flags.countryLabel === 'string' ? c.flags.countryLabel : '';
  const opening = ctx.state.log[0]?.entries[0]?.text ?? '';
  if (label !== '' && opening.startsWith('You were born') && opening.endsWith(` in ${label}.`)) {
    return false;
  }
  return true;
}

/**
 * Abroad on somebody else's paperwork. The ceremony is the storyline's terminal
 * beat and sets `emigration:done` for good, so the residency admin has to read
 * that flag rather than `abroad`, which the same flag pins open for life.
 */
function onAVisa(ctx: Ctx): boolean {
  return abroad(ctx) && ctx.c.flags['emigration:done'] !== true;
}

/** Abroad, and still inside the first `n` years of it. */
function settlingIn(n: number): (ctx: Ctx) => boolean {
  return (ctx) => abroad(ctx) && yearsSettled(ctx) <= n;
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
    condition: onAVisa,
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
    condition: (ctx) => abroad(ctx) && yearsSettled(ctx) >= 5,
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
