import { addPerson } from '@/engine/state';
import type {
  ContentPack,
  ContentRegistry,
  Ctx,
  Effect,
  EffectCtx,
  EventDef,
  GameState,
  Gender,
  InteractionDef,
  NamePool,
  Person,
  RelKind,
  Rng,
  Stats,
} from '@/types';

/**
 * Person-targeted interactions and the events the people in a life throw at it.
 *
 * Every row here can be run at whoever the sheet had selected, so nothing below
 * trusts `ctx.target`: it may be absent (the area listed before a person is
 * picked), dead, or of the wrong kind entirely by the time an effect lands. The
 * gates at the top are the only place that check happens — with a target they
 * ask about that person, without one they ask whether anybody in the life could
 * be aimed at, so the sheet can still show the row.
 *
 * Events are worse: a card is dealt in one phase and answered in another, so an
 * outcome's `fn` re-finds its person and quietly does nothing when they are gone.
 */

/* ------------------------------------------------------------------ */
/* Lookups                                                             */
/* ------------------------------------------------------------------ */

/** Everyone still alive. Widened first: a loaded save can hold a hole. */
function alivePeople(state: GameState): Person[] {
  const list: (Person | undefined)[] = Object.values(state.people);
  return list.filter((p): p is Person => p !== undefined && p.alive === true);
}

const ANYONE: readonly RelKind[] = [
  'mother',
  'father',
  'sibling',
  'partner',
  'spouse',
  'ex',
  'child',
  'friend',
  'enemy',
  'pet',
];

/** Everybody a conversation works on, which is everybody but the dog. */
const PEOPLE: readonly RelKind[] = [
  'mother',
  'father',
  'sibling',
  'partner',
  'spouse',
  'ex',
  'child',
  'friend',
  'enemy',
];

const ROMANCE: readonly RelKind[] = ['partner', 'spouse'];

/** The current spouse, else the current partner, else nobody. */
function romanceOf(state: GameState): Person | undefined {
  const alive = alivePeople(state);
  return alive.find((p) => p.kind === 'spouse') ?? alive.find((p) => p.kind === 'partner');
}

function firstOfKind(state: GameState, kind: RelKind): Person | undefined {
  return alivePeople(state).find((p) => p.kind === kind);
}

/** The friend who would notice if you vanished: highest affinity, alive. */
function bestFriend(state: GameState): Person | undefined {
  const friends = alivePeople(state).filter((p) => p.kind === 'friend');
  return friends.reduce<Person | undefined>(
    (best, p) => (best === undefined || p.rel > best.rel ? p : best),
    undefined
  );
}

function childAged(state: GameState, minAge: number, maxAge: number): Person | undefined {
  return alivePeople(state).find(
    (p) => p.kind === 'child' && p.age >= minAge && p.age <= maxAge
  );
}

/** The name a sentence should call somebody, never an empty string. */
function firstNameOf(person: Person, fallback = 'them'): string {
  const parts = person.name.trim().split(/\s+/);
  return parts[0] || fallback;
}

/** Not behind bars. The prison pack owns those years, so anything out in the
 *  world asks this first. */
function free(ctx: Ctx): boolean {
  return ctx.c.prison === null;
}

/* ------------------------------------------------------------------ */
/* Target gates                                                        */
/* ------------------------------------------------------------------ */

/** The aimed-at person when they still qualify, else nobody. */
function targetOfKind(ctx: Ctx, kinds: readonly RelKind[]): Person | undefined {
  const t = ctx.target;
  if (!t || t.alive !== true) return undefined;
  return kinds.includes(t.kind) ? t : undefined;
}

/**
 * Row gate for a person-targeted action.
 *
 * With a target it asks about that person; with none — the sheet listing the
 * area before anybody is picked — it asks whether the life holds somebody the
 * row could be aimed at, so the row is offered rather than silently missing.
 */
function needs(
  kinds: readonly RelKind[],
  extra?: (person: Person, ctx: Ctx) => boolean
): (ctx: Ctx) => boolean {
  return (ctx: Ctx): boolean => {
    const ok = (p: Person): boolean => kinds.includes(p.kind) && (extra ? extra(p, ctx) : true);
    const t = ctx.target;
    if (t) return t.alive === true && ok(t);
    return alivePeople(ctx.state).some(ok);
  };
}

/** Resolution for a row that was run at somebody who no longer qualifies. */
function noTarget(refund = 0): { text: string; effects: Effect[] } {
  return {
    text: 'You thought better of it.',
    effects: refund > 0 ? [{ kind: 'money', delta: refund }] : [],
  };
}

/* ------------------------------------------------------------------ */
/* Effect helpers                                                      */
/* ------------------------------------------------------------------ */

/** Same 0..100 rounding the engine applies, for the fields it does not own. */
function clamped(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const bounded = n < 0 ? 0 : n > 100 ? 100 : n;
  return Math.round(bounded * 10) / 10;
}

/**
 * Runs against one person by id, or does nothing.
 *
 * An interaction's effects land a moment after `resolve` picked its person, and
 * an event outcome lands a whole phase after its card was dealt — either way the
 * table is re-read here rather than trusted. Own-property only: the id came from
 * data, so `__proto__` must resolve to nobody.
 */
function withPerson(id: string, run: (person: Person, ctx: EffectCtx) => void): Effect {
  return {
    kind: 'fn',
    run: (ctx: EffectCtx) => {
      const people = ctx.state.people;
      if (!Object.prototype.hasOwnProperty.call(people, id)) return;
      const person: Person | undefined = people[id];
      if (!person) return;
      run(person, ctx);
    },
  };
}

/**
 * Moves affinity with whoever a picker finds when the effect lands.
 * `{kind:'rel'}` addresses people by sentinel or explicit id, and neither names
 * "the sibling this card was about", so those land here instead.
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

/* ------------------------------------------------------------------ */
/* Minting people                                                      */
/* ------------------------------------------------------------------ */

/** Everything the name and stat rollers need; `Ctx` and `EffectCtx` both fit. */
interface RollCtx {
  state: GameState;
  rng: Rng;
  reg: ContentRegistry;
}

const ROLLED_GENDERS: readonly Gender[] = ['male', 'female'];

function poolFor(ctx: RollCtx): NamePool | undefined {
  const pools: Record<string, NamePool | undefined> = ctx.reg.namePools;
  return pools[ctx.state.character.countryId];
}

/** A plausible local given name, or a neutral stand-in when no pool is loaded. */
function rollFirstName(ctx: RollCtx, gender: Gender): string {
  const pool = poolFor(ctx);
  const given = gender === 'female' ? pool?.female : pool?.male;
  if (given && given.length > 0) return ctx.rng.pick(given);
  return gender === 'female' ? 'Riley' : 'Alex';
}

function rollLastName(ctx: RollCtx): string {
  const pool = poolFor(ctx);
  if (pool && pool.last.length > 0) return ctx.rng.pick(pool.last);
  return ctx.state.character.lastName || 'Doe';
}

/** A child's opening hand: half the character, half whoever the other parent was. */
function babyStats(ctx: RollCtx): Stats {
  const own = ctx.state.character.stats;
  const mix = (mine: number, lo: number, hi: number): number =>
    clamped((mine + ctx.rng.int(lo, hi)) / 2 + ctx.rng.int(-4, 4));
  return {
    health: mix(own.health, 70, 100),
    happiness: mix(own.happiness, 60, 95),
    smarts: mix(own.smarts, 20, 85),
    looks: mix(own.looks, 20, 85),
  };
}

/** A newborn under the character's surname; the name was rolled in `resolve`. */
function newborn(name: string, gender: Gender): Effect {
  return {
    kind: 'fn',
    run: (ctx: EffectCtx) => {
      addPerson(ctx.state, {
        kind: 'child',
        name,
        gender,
        age: 0,
        alive: true,
        rel: ctx.rng.int(75, 95),
        stats: babyStats(ctx),
        flags: {},
      });
    },
  };
}

const GIFTS: readonly string[] = [
  'a scarf',
  'a scented candle',
  'a bad novel',
  'concert tickets',
  'a houseplant',
  'a very large mug',
  'socks',
];

const MEETING_PLACES: readonly string[] = [
  'in a queue',
  'at a wedding nobody enjoyed',
  'at the gym',
  'in a lift that stopped',
  'over a shared taxi',
  'at a work thing',
  'at the laundromat',
];

const DATE_NIGHTS: readonly string[] = [
  'dinner and a long walk',
  'a terrible film and good popcorn',
  'a bar with no menu',
  'the aquarium, for some reason',
  'a picnic that got rained on',
];

/* ------------------------------------------------------------------ */
/* Interactions                                                        */
/* ------------------------------------------------------------------ */

const interactions: InteractionDef[] = [
  {
    id: 'rel-spend-time',
    area: 'relationship',
    label: 'Spend Time',
    icon: '🕰️',
    condition: needs(ANYONE),
    resolve: (ctx: Ctx) => {
      const t = targetOfKind(ctx, ANYONE);
      if (!t) return noTarget();
      const first = firstNameOf(t);
      const gain = ctx.rng.int(5, 10);
      const text =
        t.kind === 'pet'
          ? `You threw a ball for ${first} until your arm gave out.`
          : `You spent the afternoon with ${first}. No phones.`;
      return {
        text,
        effects: [
          { kind: 'rel', who: 'target', delta: gain },
          { kind: 'stat', stat: 'happiness', delta: 2 },
        ],
      };
    },
  },
  {
    id: 'rel-deep-talk',
    area: 'relationship',
    label: 'Deep Conversation',
    icon: '🫂',
    minAge: 6,
    condition: needs(PEOPLE),
    resolve: (ctx: Ctx) => {
      const t = targetOfKind(ctx, PEOPLE);
      if (!t) return noTarget();
      const first = firstNameOf(t);
      const gain = ctx.rng.int(4, 9);
      return {
        text: `You and ${first} talked about the things you never talk about.`,
        effects: [
          { kind: 'rel', who: 'target', delta: gain },
          { kind: 'stat', stat: 'happiness', delta: 4 },
        ],
      };
    },
  },
  {
    id: 'rel-gift',
    area: 'relationship',
    label: 'Give a Gift',
    icon: '🎁',
    cost: 100,
    condition: needs(ANYONE),
    resolve: (ctx: Ctx) => {
      const t = targetOfKind(ctx, ANYONE);
      if (!t) return noTarget(100);
      const first = firstNameOf(t);
      const gift = ctx.rng.pick(GIFTS);
      const gain = ctx.rng.int(8, 15);
      return {
        text: `You gave ${first} ${gift}. It went down better than it should have.`,
        effects: [
          { kind: 'rel', who: 'target', delta: gain },
          { kind: 'stat', stat: 'happiness', delta: 2 },
        ],
      };
    },
  },
  {
    id: 'rel-compliment',
    area: 'relationship',
    label: 'Compliment',
    icon: '😊',
    condition: needs(ANYONE),
    resolve: (ctx: Ctx) => {
      const t = targetOfKind(ctx, ANYONE);
      if (!t) return noTarget();
      const first = firstNameOf(t);
      if (ctx.rng.chance(0.15)) {
        return {
          text: `You complimented ${first}'s haircut. It was not new.`,
          effects: [
            { kind: 'rel', who: 'target', delta: 1 },
            { kind: 'stat', stat: 'happiness', delta: -1 },
          ],
        };
      }
      return {
        text: `You told ${first} something nice and meant every word.`,
        effects: [{ kind: 'rel', who: 'target', delta: ctx.rng.int(3, 8) }],
      };
    },
  },
  {
    id: 'rel-insult',
    area: 'relationship',
    label: 'Insult',
    icon: '😤',
    condition: needs(ANYONE),
    resolve: (ctx: Ctx) => {
      const t = targetOfKind(ctx, ANYONE);
      if (!t) return noTarget();
      const first = firstNameOf(t);
      const drop = ctx.rng.int(10, 20);
      const effects: Effect[] = [
        { kind: 'rel', who: 'target', delta: -drop },
        { kind: 'stat', stat: 'happiness', delta: -2 },
      ];
      // Known here, not in the effect: `resolve` can read the affinity the drop
      // will land on, so the log line and the flip agree.
      if (t.kind === 'friend' && t.rel - drop < 15) {
        effects.push(
          withPerson(t.id, (person) => {
            if (person.kind === 'friend') person.kind = 'enemy';
          }),
          { kind: 'log', icon: '🗡️', text: `${first} is an enemy now.`, logKind: 'bad' }
        );
      }
      return { text: `You told ${first} exactly what you think.`, effects };
    },
  },
  {
    id: 'rel-prank',
    area: 'relationship',
    label: 'Prank',
    icon: '🤡',
    minAge: 5,
    condition: needs(PEOPLE),
    resolve: (ctx: Ctx) => {
      const t = targetOfKind(ctx, PEOPLE);
      if (!t) return noTarget();
      const first = firstNameOf(t);
      if (ctx.rng.chance(0.6)) {
        return {
          text: `You filled ${first}'s shoes with glitter. ${first} laughed hardest.`,
          effects: [
            { kind: 'rel', who: 'target', delta: ctx.rng.int(3, 7) },
            { kind: 'stat', stat: 'happiness', delta: 4 },
          ],
        };
      }
      return {
        text: `The prank landed badly. ${first} is not speaking to you.`,
        effects: [
          { kind: 'rel', who: 'target', delta: -ctx.rng.int(5, 12) },
          { kind: 'stat', stat: 'happiness', delta: -3 },
        ],
      };
    },
  },
  {
    id: 'rel-ask-money',
    area: 'relationship',
    label: 'Ask for Money',
    icon: '🤲',
    cooldownYears: 1,
    condition: needs(PEOPLE, (p) => p.age >= 16),
    resolve: (ctx: Ctx) => {
      const t = targetOfKind(ctx, PEOPLE);
      if (!t) return noTarget();
      const first = firstNameOf(t);
      if (t.rel > 60) {
        const amount = ctx.rng.int(200, 2000);
        return {
          text: `${first} wrote you a cheque and did not ask what for.`,
          effects: [
            { kind: 'money', delta: amount },
            { kind: 'rel', who: 'target', delta: -3 },
            { kind: 'log', icon: '💵', text: `+$${amount}`, logKind: 'money' },
          ],
        };
      }
      return {
        text: `${first} said no, slowly, so it would sink in.`,
        effects: [
          { kind: 'rel', who: 'target', delta: -ctx.rng.int(3, 8) },
          { kind: 'stat', stat: 'happiness', delta: -2 },
        ],
      };
    },
  },
  {
    id: 'rel-date-night',
    area: 'relationship',
    label: 'Date Night',
    icon: '🍷',
    cost: 150,
    minAge: 16,
    condition: (ctx: Ctx) => free(ctx) && needs(ROMANCE)(ctx),
    resolve: (ctx: Ctx) => {
      const t = targetOfKind(ctx, ROMANCE);
      if (!t) return noTarget(150);
      const first = firstNameOf(t);
      const plan = ctx.rng.pick(DATE_NIGHTS);
      return {
        text: `You took ${first} out: ${plan}.`,
        effects: [
          { kind: 'rel', who: 'target', delta: ctx.rng.int(5, 10) },
          { kind: 'stat', stat: 'happiness', delta: 5 },
        ],
      };
    },
  },
  {
    id: 'rel-propose',
    area: 'relationship',
    label: 'Propose',
    icon: '💍',
    minAge: 18,
    condition: needs(['partner'], (p) => p.rel > 55),
    resolve: (ctx: Ctx) => {
      const t = targetOfKind(ctx, ['partner']);
      if (!t || t.rel <= 55) return noTarget();
      const first = firstNameOf(t);
      const odds = Math.min(0.95, Math.max(0.05, t.rel / 100));
      if (ctx.rng.chance(odds)) {
        return {
          text: 'You got down on one knee in front of everyone.',
          effects: [
            withPerson(t.id, (person) => {
              if (person.kind === 'partner') person.kind = 'spouse';
              person.rel = clamped(person.rel + 10);
              person.flags.married = true;
            }),
            { kind: 'stat', stat: 'happiness', delta: 20 },
            { kind: 'flag', flag: 'rel:weddingAge', value: ctx.c.age },
            { kind: 'log', icon: '💍', text: `${first} said yes!`, logKind: 'good' },
          ],
        };
      }
      return {
        text: `${first} said no. The restaurant clapped anyway.`,
        effects: [
          { kind: 'rel', who: 'target', delta: -ctx.rng.int(10, 20) },
          { kind: 'stat', stat: 'happiness', delta: -15 },
        ],
      };
    },
  },
  {
    id: 'rel-honeymoon',
    area: 'relationship',
    label: 'Honeymoon',
    icon: '🏝️',
    cost: 5000,
    minAge: 18,
    cooldownYears: 30,
    condition: (ctx: Ctx) => free(ctx) && needs(['spouse'])(ctx),
    resolve: (ctx: Ctx) => {
      const t = targetOfKind(ctx, ['spouse']);
      if (!t) return noTarget(5000);
      const first = firstNameOf(t);
      return {
        text: `Two weeks somewhere warm with ${first}. You both got sunburnt.`,
        effects: [
          { kind: 'rel', who: 'target', delta: 15 },
          { kind: 'stat', stat: 'happiness', delta: 12 },
          { kind: 'stat', stat: 'health', delta: 2 },
        ],
      };
    },
  },
  {
    id: 'rel-try-baby',
    area: 'relationship',
    label: 'Try for a Baby',
    icon: '🍼',
    minAge: 18,
    maxAge: 45,
    cooldownYears: 1,
    condition: (ctx: Ctx) => free(ctx) && needs(ROMANCE)(ctx),
    resolve: (ctx: Ctx) => {
      const t = targetOfKind(ctx, ROMANCE);
      if (!t) return noTarget();
      if (!ctx.rng.chance(0.6)) {
        return {
          text: 'No luck this year. You are told to relax about it.',
          effects: [{ kind: 'stat', stat: 'happiness', delta: -2 }],
        };
      }
      const surname = ctx.c.lastName;
      const genderA = ctx.rng.pick(ROLLED_GENDERS);
      const nameA = `${rollFirstName(ctx, genderA)} ${surname}`.trim();
      if (ctx.rng.chance(0.05)) {
        const genderB = ctx.rng.pick(ROLLED_GENDERS);
        const nameB = `${rollFirstName(ctx, genderB)} ${surname}`.trim();
        return {
          text: `Twins. Meet ${nameA} and ${nameB}. Nobody is sleeping again.`,
          effects: [
            newborn(nameA, genderA),
            newborn(nameB, genderB),
            { kind: 'rel', who: 'target', delta: 8 },
            { kind: 'stat', stat: 'happiness', delta: 14 },
            { kind: 'stat', stat: 'health', delta: -4 },
          ],
        };
      }
      return {
        text: `It worked. Meet ${nameA}.`,
        effects: [
          newborn(nameA, genderA),
          { kind: 'rel', who: 'target', delta: 6 },
          { kind: 'stat', stat: 'happiness', delta: 12 },
          { kind: 'stat', stat: 'health', delta: -2 },
        ],
      };
    },
  },
  {
    id: 'rel-adopt',
    area: 'relationship',
    label: 'Adopt a Child',
    icon: '👨‍👧',
    cost: 30000,
    minAge: 25,
    cooldownYears: 1,
    condition: free,
    resolve: (ctx: Ctx) => {
      const gender = ctx.rng.pick(ROLLED_GENDERS);
      const age = ctx.rng.int(0, 8);
      const name = `${rollFirstName(ctx, gender)} ${ctx.c.lastName}`.trim();
      const rel = ctx.rng.int(55, 80);
      return {
        text: `The paperwork took a year. ${name}, age ${age}, is home.`,
        effects: [
          {
            kind: 'fn',
            run: (ec: EffectCtx) => {
              addPerson(ec.state, {
                kind: 'child',
                name,
                gender,
                age,
                alive: true,
                rel,
                stats: babyStats(ec),
                flags: { adopted: true },
              });
            },
          },
          { kind: 'stat', stat: 'happiness', delta: 12 },
        ],
      };
    },
  },
  {
    id: 'rel-divorce',
    area: 'relationship',
    label: 'File for Divorce',
    icon: '📄',
    minAge: 18,
    condition: needs(['spouse']),
    resolve: (ctx: Ctx) => {
      const t = targetOfKind(ctx, ['spouse']);
      if (!t) return noTarget();
      const first = firstNameOf(t);
      return {
        text: `You and ${first} signed the papers. The lawyers did well out of it.`,
        effects: [
          withPerson(t.id, (person) => {
            person.kind = 'ex';
            person.rel = clamped(person.rel - 20);
          }),
          {
            kind: 'fn',
            run: (ec: EffectCtx) => {
              const c = ec.state.character;
              if (!Number.isFinite(c.money)) return;
              c.money = Math.max(0, Math.round(c.money * 0.6));
            },
          },
          { kind: 'stat', stat: 'happiness', delta: -15 },
          { kind: 'log', icon: '⚖️', text: 'The settlement took 40% of your cash.', logKind: 'money' },
        ],
      };
    },
  },
  {
    id: 'rel-reconcile',
    area: 'relationship',
    label: 'Reconcile',
    icon: '🕊️',
    minAge: 16,
    cooldownYears: 1,
    condition: (ctx: Ctx) => romanceOf(ctx.state) === undefined && needs(['ex'])(ctx),
    resolve: (ctx: Ctx) => {
      const t = targetOfKind(ctx, ['ex']);
      if (!t) return noTarget();
      const first = firstNameOf(t);
      const odds = Math.min(0.9, Math.max(0.05, t.rel / 200));
      if (ctx.rng.chance(odds)) {
        return {
          text: `One coffee turned into four. ${first} is back.`,
          effects: [
            withPerson(t.id, (person) => {
              if (person.kind === 'ex') person.kind = 'partner';
              person.rel = clamped(person.rel + 10);
            }),
            { kind: 'stat', stat: 'happiness', delta: 8 },
          ],
        };
      }
      return {
        text: `${first} listened politely and left before dessert.`,
        effects: [
          { kind: 'rel', who: 'target', delta: -5 },
          { kind: 'stat', stat: 'happiness', delta: -5 },
        ],
      };
    },
  },
  {
    id: 'rel-disown',
    area: 'relationship',
    label: 'Disown',
    icon: '💔',
    minAge: 18,
    // Old enough to have earned it; a disowned toddler is not a game mechanic.
    condition: needs(['child'], (p) => p.age >= 13),
    resolve: (ctx: Ctx) => {
      const t = targetOfKind(ctx, ['child']);
      if (!t || t.age < 13) return noTarget();
      const first = firstNameOf(t);
      const age = ctx.c.age;
      return {
        text: `You cut ${first} out of the will and out of the house.`,
        effects: [
          withPerson(t.id, (person) => {
            person.rel = 0;
            person.flags.disowned = true;
            person.flags.disownedAtAge = age;
          }),
          { kind: 'stat', stat: 'happiness', delta: -8 },
        ],
      };
    },
  },
  {
    id: 'rel-make-friend',
    area: 'relationship',
    label: 'Make a Friend',
    icon: '🤝',
    minAge: 5,
    cooldownYears: 1,
    /* `MEETING_PLACES` is a gym, a queue and a laundromat, none of which is a
       cell; inside, `ev-prison-cellmate` is how the block hands out a friend. */
    condition: free,
    resolve: (ctx: Ctx) => {
      const gender = ctx.rng.pick(ROLLED_GENDERS);
      const name = `${rollFirstName(ctx, gender)} ${rollLastName(ctx)}`.trim();
      const lo = Math.max(3, ctx.c.age - 5);
      const age = ctx.rng.int(lo, Math.max(lo, ctx.c.age + 5));
      const rel = ctx.rng.int(40, 60);
      const where = ctx.rng.pick(MEETING_PLACES);
      return {
        text: `You met ${name} ${where}. You get on.`,
        effects: [
          {
            kind: 'fn',
            run: (ec: EffectCtx) => {
              addPerson(ec.state, {
                kind: 'friend',
                name,
                gender,
                age,
                alive: true,
                rel,
                flags: {},
              });
            },
          },
          { kind: 'stat', stat: 'happiness', delta: 3 },
        ],
      };
    },
  },
  {
    id: 'rel-start-dating',
    area: 'relationship',
    label: 'Start Dating',
    icon: '💘',
    minAge: 16,
    condition: (ctx: Ctx) => free(ctx) && romanceOf(ctx.state) === undefined,
    resolve: (ctx: Ctx) => {
      const gender = ctx.rng.pick(ROLLED_GENDERS);
      const name = `${rollFirstName(ctx, gender)} ${rollLastName(ctx)}`.trim();
      const lo = Math.max(16, ctx.c.age - 5);
      const hi = ctx.c.age < 18 ? Math.max(lo, ctx.c.age + 2) : Math.max(lo, ctx.c.age + 5);
      const age = ctx.rng.int(lo, hi);
      const rel = ctx.rng.int(50, 70);
      const where = ctx.rng.pick(MEETING_PLACES);
      return {
        text: `You met ${name} ${where}. You hit it off.`,
        effects: [
          {
            kind: 'fn',
            run: (ec: EffectCtx) => {
              // The relationships phase can hand out a romance between the roll
              // and the effect; two partners at once is a bug, not a scandal.
              if (romanceOf(ec.state)) return;
              addPerson(ec.state, {
                kind: 'partner',
                name,
                gender,
                age,
                alive: true,
                rel,
                flags: {},
              });
            },
          },
          { kind: 'stat', stat: 'happiness', delta: 5 },
        ],
      };
    },
  },
];

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

const events: EventDef[] = [
  {
    id: 'ev-rel-anniversary',
    area: 'love',
    icon: '💐',
    minAge: 18,
    maxAge: 110,
    weight: 4,
    condition: (ctx: Ctx) => free(ctx) && firstOfKind(ctx.state, 'spouse') !== undefined,
    text: (ctx: Ctx) => {
      const wedding = ctx.c.flags['rel:weddingAge'];
      const years =
        typeof wedding === 'number' && Number.isFinite(wedding) ? ctx.c.age - wedding : 0;
      if (years >= 1) {
        return `${years} year${years === 1 ? '' : 's'} married. {partner} remembered first.`;
      }
      return 'Your anniversary came round. {partner} remembered first.';
    },
    effects: [
      { kind: 'rel', who: 'partner', delta: 6 },
      { kind: 'stat', stat: 'happiness', delta: 6 },
      { kind: 'money', delta: -200 },
    ],
  },
  {
    id: 'ev-rel-argument',
    area: 'love',
    icon: '💢',
    minAge: 16,
    maxAge: 110,
    weight: 5,
    condition: (ctx: Ctx) => free(ctx) && romanceOf(ctx.state) !== undefined,
    text: 'You and {partner} argued about something neither of you can name now.',
    choices: [
      {
        label: 'Apologize first',
        outcomes: [
          {
            weight: 5,
            text: 'You apologized. It cost nothing and bought back the evening.',
            effects: [
              { kind: 'rel', who: 'partner', delta: 7 },
              { kind: 'stat', stat: 'happiness', delta: 3 },
            ],
          },
          {
            weight: 2,
            text: 'You apologized. {partner} was not finished.',
            effects: [
              { kind: 'rel', who: 'partner', delta: 2 },
              { kind: 'stat', stat: 'happiness', delta: -4 },
            ],
          },
        ],
      },
      {
        label: 'Stand your ground',
        outcomes: [
          {
            weight: 4,
            text: 'You won. The flat stayed very quiet for a week.',
            effects: [
              { kind: 'rel', who: 'partner', delta: -10 },
              { kind: 'stat', stat: 'happiness', delta: -5 },
            ],
          },
          {
            weight: 3,
            text: 'You were right, and {partner} said so out loud.',
            effects: [
              { kind: 'rel', who: 'partner', delta: 4 },
              { kind: 'stat', stat: 'happiness', delta: 4 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-rel-caught-flirting',
    area: 'love',
    icon: '👀',
    minAge: 18,
    maxAge: 110,
    weight: 3,
    condition: (ctx: Ctx) => free(ctx) && romanceOf(ctx.state) !== undefined,
    text: "{partner} spent the whole party laughing at somebody else's jokes.",
    choices: [
      {
        label: 'Ask about it',
        outcomes: [
          {
            weight: 4,
            text: 'It was nothing, and saying so out loud made it nothing.',
            effects: [
              { kind: 'rel', who: 'partner', delta: 5 },
              { kind: 'stat', stat: 'happiness', delta: 2 },
            ],
          },
          {
            weight: 3,
            text: 'It was not nothing. The drive home was silent.',
            effects: [
              { kind: 'rel', who: 'partner', delta: -12 },
              { kind: 'stat', stat: 'happiness', delta: -8 },
            ],
          },
        ],
      },
      {
        label: 'Let it go',
        outcomes: [
          {
            weight: 1,
            text: 'You let it go and thought about it for a month.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: -3 }],
          },
        ],
      },
      {
        label: 'Flirt with somebody yourself',
        outcomes: [
          {
            weight: 3,
            text: 'You made your point. Nobody enjoyed the point.',
            effects: [
              { kind: 'rel', who: 'partner', delta: -8 },
              { kind: 'stat', stat: 'happiness', delta: -2 },
            ],
          },
          {
            weight: 2,
            text: 'You both remembered you are supposed to be fun.',
            effects: [
              { kind: 'rel', who: 'partner', delta: 3 },
              { kind: 'stat', stat: 'happiness', delta: 4 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-rel-partner-promotion',
    area: 'love',
    icon: '🥂',
    minAge: 20,
    maxAge: 80,
    weight: 3,
    condition: (ctx: Ctx) => free(ctx) && romanceOf(ctx.state) !== undefined,
    text: '{partner} got promoted. Dinner was on the household this time.',
    effects: [
      { kind: 'money', delta: 1500 },
      { kind: 'rel', who: 'partner', delta: 4 },
      { kind: 'stat', stat: 'happiness', delta: 6 },
    ],
  },
  {
    id: 'ev-rel-in-laws',
    area: 'family',
    icon: '🏡',
    minAge: 20,
    maxAge: 110,
    weight: 3,
    condition: (ctx: Ctx) => free(ctx) && firstOfKind(ctx.state, 'spouse') !== undefined,
    text: 'Your in-laws have opinions about your kitchen, your job and your haircut.',
    choices: [
      {
        label: 'Smile and nod',
        outcomes: [
          {
            weight: 1,
            text: 'You smiled for four hours. Your face still hurts.',
            effects: [
              { kind: 'rel', who: 'partner', delta: 4 },
              { kind: 'stat', stat: 'happiness', delta: -3 },
            ],
          },
        ],
      },
      {
        label: 'Push back',
        outcomes: [
          {
            weight: 3,
            text: 'You said your piece. They left early and texted about it.',
            effects: [
              { kind: 'rel', who: 'partner', delta: -8 },
              { kind: 'stat', stat: 'happiness', delta: 3 },
            ],
          },
          {
            weight: 2,
            text: 'You said your piece and {partner} backed you, loudly.',
            effects: [
              { kind: 'rel', who: 'partner', delta: 6 },
              { kind: 'stat', stat: 'happiness', delta: 5 },
            ],
          },
        ],
      },
      {
        label: 'Book them a hotel',
        outcomes: [
          {
            weight: 2,
            text: 'Money solved it. Money usually does, briefly.',
            effects: [
              { kind: 'money', delta: -600 },
              { kind: 'stat', stat: 'happiness', delta: 4 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-rel-friend-moves-away',
    area: 'life',
    icon: '📦',
    minAge: 8,
    maxAge: 110,
    weight: 3,
    condition: (ctx: Ctx) => bestFriend(ctx.state) !== undefined,
    text: (ctx: Ctx) => {
      const friend = bestFriend(ctx.state);
      const first = friend ? firstNameOf(friend, 'Your best friend') : 'Your best friend';
      return `${first} took a job three time zones away. You helped carry boxes.`;
    },
    effects: [
      relWith(bestFriend, -12),
      { kind: 'stat', stat: 'happiness', delta: -7 },
    ],
  },
  {
    id: 'ev-rel-friend-drama',
    area: 'life',
    icon: '🎭',
    minAge: 12,
    maxAge: 110,
    weight: 4,
    condition: (ctx: Ctx) => bestFriend(ctx.state) !== undefined,
    text: (ctx: Ctx) => {
      const friend = bestFriend(ctx.state);
      const first = friend ? firstNameOf(friend, 'A friend') : 'A friend';
      return `${first} wants you to pick a side in a fight you were not in.`;
    },
    choices: [
      {
        label: 'Back them',
        outcomes: [
          {
            weight: 4,
            text: 'You backed them without asking questions. That is what it was for.',
            effects: [
              relWith(bestFriend, 9),
              { kind: 'stat', stat: 'happiness', delta: 2 },
            ],
          },
          {
            weight: 2,
            text: 'You backed them. They were, it turns out, completely wrong.',
            effects: [
              relWith(bestFriend, 5),
              { kind: 'stat', stat: 'happiness', delta: -4 },
            ],
          },
        ],
      },
      {
        label: 'Stay out of it',
        outcomes: [
          {
            weight: 3,
            text: 'You stayed neutral. Neutral counts as a side, apparently.',
            effects: [
              relWith(bestFriend, -7),
              { kind: 'stat', stat: 'happiness', delta: 1 },
            ],
          },
        ],
      },
      {
        label: 'Tell them to grow up',
        outcomes: [
          {
            weight: 3,
            text: 'They went quiet, then admitted you had a point.',
            effects: [
              relWith(bestFriend, 3),
              { kind: 'stat', stat: 'happiness', delta: 3 },
            ],
          },
          {
            weight: 3,
            text: 'They did not take it well. Nobody ever does.',
            effects: [
              relWith(bestFriend, -14),
              { kind: 'stat', stat: 'happiness', delta: -3 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-rel-enemy-provokes',
    area: 'life',
    icon: '🗯️',
    minAge: 12,
    maxAge: 110,
    weight: 3,
    condition: (ctx: Ctx) => free(ctx) && firstOfKind(ctx.state, 'enemy') !== undefined,
    text: (ctx: Ctx) => {
      const enemy = firstOfKind(ctx.state, 'enemy');
      const first = enemy ? firstNameOf(enemy, 'An old enemy') : 'An old enemy';
      return `${first} said something about you loudly, in a room you were in.`;
    },
    choices: [
      {
        label: 'Ignore it',
        outcomes: [
          {
            weight: 3,
            text: 'You ignored it. It cost you nothing but the evening.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: -2 }],
          },
        ],
      },
      {
        label: 'Answer back',
        outcomes: [
          {
            weight: 4,
            text: 'You answered in one sentence. The room enjoyed it more than they did.',
            effects: [
              { kind: 'stat', stat: 'happiness', delta: 5 },
              relWith((state) => firstOfKind(state, 'enemy'), -5),
            ],
          },
          {
            weight: 3,
            text: 'It turned into shoving. Security walked you both out.',
            effects: [
              { kind: 'stat', stat: 'health', delta: -6 },
              { kind: 'stat', stat: 'happiness', delta: -4 },
              { kind: 'stat', stat: 'looks', delta: -2 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-rel-child-first-steps',
    area: 'family',
    icon: '👣',
    minAge: 18,
    maxAge: 90,
    weight: 5,
    condition: (ctx: Ctx) => childAged(ctx.state, 0, 2) !== undefined,
    text: (ctx: Ctx) => {
      const child = childAged(ctx.state, 0, 2);
      const first = child ? firstNameOf(child, 'Your baby') : 'Your baby';
      return `${first} took three steps and landed on the dog bowl.`;
    },
    effects: [
      relWith((state) => childAged(state, 0, 2), 6),
      { kind: 'stat', stat: 'happiness', delta: 9 },
    ],
  },
  {
    id: 'ev-rel-child-graduates',
    area: 'family',
    icon: '🎓',
    minAge: 30,
    maxAge: 100,
    weight: 4,
    condition: (ctx: Ctx) => childAged(ctx.state, 17, 19) !== undefined,
    text: (ctx: Ctx) => {
      const child = childAged(ctx.state, 17, 19);
      const first = child ? firstNameOf(child, 'Your child') : 'Your child';
      return `${first} graduated. You cried in the third row and denied it after.`;
    },
    effects: [
      relWith((state) => childAged(state, 17, 19), 8),
      { kind: 'stat', stat: 'happiness', delta: 10 },
      { kind: 'money', delta: -500 },
    ],
  },
  {
    id: 'ev-rel-sibling-rivalry',
    area: 'family',
    icon: '⚔️',
    minAge: 8,
    maxAge: 110,
    weight: 3,
    condition: (ctx: Ctx) => firstOfKind(ctx.state, 'sibling') !== undefined,
    text: (ctx: Ctx) => {
      const sibling = firstOfKind(ctx.state, 'sibling');
      const first = sibling ? firstNameOf(sibling, 'Your sibling') : 'Your sibling';
      return `${first} brought up the one thing you are worse at, at dinner, again.`;
    },
    choices: [
      {
        label: 'Let them have it',
        outcomes: [
          {
            weight: 3,
            text: 'You let them win. They enjoyed it enough for both of you.',
            effects: [
              relWith((state) => firstOfKind(state, 'sibling'), 6),
              { kind: 'stat', stat: 'happiness', delta: -1 },
            ],
          },
        ],
      },
      {
        label: 'Beat them at it',
        outcomes: [
          {
            weight: 3,
            text: 'You practised for a month in secret and destroyed them.',
            effects: [
              relWith((state) => firstOfKind(state, 'sibling'), -6),
              { kind: 'stat', stat: 'happiness', delta: 6 },
              { kind: 'stat', stat: 'smarts', delta: 1 },
            ],
          },
          {
            weight: 3,
            text: 'You tried and lost in front of the whole family.',
            effects: [
              relWith((state) => firstOfKind(state, 'sibling'), -3),
              { kind: 'stat', stat: 'happiness', delta: -5 },
            ],
          },
        ],
      },
      {
        label: 'Laugh it off',
        outcomes: [
          {
            weight: 4,
            text: 'You laughed first. It took all the air out of it.',
            effects: [
              relWith((state) => firstOfKind(state, 'sibling'), 3),
              { kind: 'stat', stat: 'happiness', delta: 3 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-rel-pet-chaos',
    area: 'family',
    icon: '🐾',
    minAge: 5,
    maxAge: 110,
    weight: 4,
    condition: (ctx: Ctx) => firstOfKind(ctx.state, 'pet') !== undefined,
    text: (ctx: Ctx) => {
      const pet = firstOfKind(ctx.state, 'pet');
      const first = pet ? firstNameOf(pet, 'Your pet') : 'Your pet';
      const species = pet?.petSpecies ?? 'pet';
      return `${first} ate a shoe, a charger and your homework. The ${species} regrets nothing.`;
    },
    effects: [
      { kind: 'money', delta: -140 },
      { kind: 'stat', stat: 'happiness', delta: 2 },
      relWith((state) => firstOfKind(state, 'pet'), 2),
    ],
  },
];

/** Person-targeted interactions: talk, gift, argue, date, propose, divorce and pets. */
export const relationshipsPack: ContentPack = {
  id: 'relationships',
  interactions,
  events,
};
