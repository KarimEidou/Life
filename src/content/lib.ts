/**
 * The content authoring library — and the one place in `src/content/` that may
 * import the engine.
 *
 * Two jobs, in two halves.
 *
 * Below: the predicates, readers and effect builders every pack needs, written
 * once. They were copied by hand into pack after pack — `free` alone had seven
 * identical definitions, `alivePeople` five — which meant a fix to any shared
 * reader had to land seven times, and in practice did not: the same 0..100
 * affinity rounding shipped under two names in two halves of the packs before
 * they were reconciled, and the addiction readers still disagree.
 *
 * Above: a narrow, deliberate re-export of the handful of engine functions no
 * declarative `Effect` covers. Content calls those through here so the layering
 * rule stays checkable — adding a symbol to this file is a visible line in a
 * diff — instead of being a sentence in a comment that seven files quietly
 * ignored. Nothing else under `src/content/` may import `@/engine/*`, and
 * `src/content/__tests__/lib.test.ts` fails the build when something does.
 */

import { clampStat } from '@/engine/effects';
import type {
  AddictionKey,
  Character,
  ContentRegistry,
  Ctx,
  Effect,
  EffectCtx,
  GameState,
  Gender,
  NamePool,
  Person,
  RelKind,
  Rng,
} from '@/types';

/* ------------------------------------------------------------------ */
/* The sanctioned engine edge                                          */
/* ------------------------------------------------------------------ */

/** Mints a person with a fresh id; content may not write `state.people` itself. */
export { addPerson } from '@/engine/state';
/** The engine's own sale: resale rate, loan settlement and the log line. */
export { sellAsset } from '@/engine/phases/finance';
/** The only sanctioned money write, for the two `fn` effects that move cash directly. */
export { clampMoney } from '@/engine/effects';
/**
 * The 0..100 stat rounding, for the two fields no declarative `Effect` covers:
 * `Person.rel` and `JobState.performance`.
 *
 * The engine's own function, not a copy of it. `applyEffects` and
 * `relationshipsPhase.drift` write affinity through this exact code, so a pack
 * clamp that rounded to whole numbers would re-round the 1dp value the engine
 * had just written — and affinity guards `rng.chance` rolls (`DIVORCE_REL`,
 * `BREAKUP_REL`), so a tenth of a point there adds or drops a draw and shifts
 * every later event in the life.
 */
export { clampStat };
/** Money formatting for log lines a pack builds itself. */
export { fmtMoney } from '@/engine/format';

/* ------------------------------------------------------------------ */
/* Weights                                                             */
/* ------------------------------------------------------------------ */

/*
 * The milestone band, and why a band rather than a number chosen per card.
 *
 * `eventsPhase` draws at most 1.19 events a year — 85% for the first, then 40%
 * for a second — and picks by weight from every card whose window covers the
 * age. The rest of the table lives in a 2..6 band, nearly half of it on exactly
 * 4, so what a card is actually worth is its weight against the whole pool at
 * that age: 255 weight over 63 definitions at seventeen. A weight-4 card with a
 * one-year window therefore fires in 1.9% of lives no matter what it is about.
 * Prom, the yearbook quote, the learner permit and the valedictorian speech all
 * shipped at 4..6, which is how ninety-five lives in a hundred never went to
 * prom: the beats the game exists to show lost to a bad haircut on arithmetic
 * alone, not on any judgement anybody made.
 *
 * So the cards that are the point of a year get a band of their own, well clear
 * of the flat table. Membership is not a ranking — it is a window measurement.
 * A once-per-life card pinned by its own subject to a year or two (prom is not
 * at fifteen) gets one or two shots at the pool and needs the weight; a card
 * with room to roam does not, and thirteen years of draws carry a weight-4
 * class reunion to 13.5% unaided. Handing the band to a wide window would
 * overshoot as badly as the flat weight undershoots.
 *
 * `__tests__/milestones.test.ts` owns the numbers: it recomputes every
 * once-per-life card's lifetime ceiling from the built registry and fails when
 * one falls under a life in ten. These two constants are the knob it grades,
 * not the rule — new content dilutes a window without touching either of them,
 * and the lint is what notices.
 */

/** The band, for a milestone whose window spans a few years. */
export const MILESTONE = 30;

/**
 * Double, for a window exactly one year wide.
 *
 * Reachability compounds over the years a window offers, so a single-year card
 * has to win its one draw where a two-year card may lose the first. At the band
 * proper the two seventeen-only cards sit at 7.8% against the 16.5% their
 * two-year neighbours reach on the same weight; doubled, they land at 13.8% and
 * the floor is a rule about crowding rather than about window length.
 */
export const MILESTONE_ONE_YEAR = MILESTONE * 2;

/* ------------------------------------------------------------------ */
/* Gates                                                               */
/* ------------------------------------------------------------------ */

/*
 * The prison policy — one rule, for every pack, written down once.
 *
 * Nothing upstream sits a sentence out. `eventsPhase` keeps drawing from the
 * whole table while the character is inside, `canUse` and `availableInteractions`
 * consult `condition` and never `c.prison`, and every sheet stays on the tab bar
 * for the length of the sentence. So each row and card decides for itself, and
 * an author with no rule to follow decides seven different ways.
 *
 * The rule is three questions, asked in this order:
 *
 * 1. **Does a cell deliver it as readily as a house does?** The infirmary, the
 *    counsellor, the library, a book, sitting still, a bout of flu, a sleepless
 *    week, a growth spurt — and everything the prison pack ships, which is what
 *    those years are made of. These run inside and ask nothing.
 * 2. **Does it need the world outside?** It names a place out there, buys
 *    something out there, or mints somebody the life did not have. A gym
 *    membership, a restaurant, a coffee with an ex, a stranger met in a queue.
 *    These must ask `free`.
 * 3. **Otherwise it is words, paper or money between people already in the
 *    life** — a conversation, a compliment, an insult, a request for cash,
 *    divorce papers, a will. `ev-prison-visiting-day` is the crime pack's own
 *    statement that contact survives a sentence, so these run inside too.
 *    Gating them is the over-correction, and it is as much a bug as leaving a
 *    holiday in Bali bookable from a cell.
 *
 * Nothing is decided twice: `__tests__/prison-policy.test.ts` holds the
 * membership of 1 and 3 as an explicit list and requires every other card and
 * row in the registry to be refused from a cell — in a stocked life, a stripped
 * one and an unattached one, so a condition that happens to be false for some
 * other reason cannot pass for a gate. A new card that forgets to ask is a
 * failing test rather than something a player finds.
 *
 * The one thing the rule does not ask for is a gate on a card a sentence can
 * never reach. The lint reads the youngest age a sentence can begin out of the
 * content itself — the lowest `minAge` in `reg.crimes`, and of any event whose
 * effects carry a `{kind:'jail'}` — and holds only the cards whose window still
 * covers it. Lower a crime's age and the rule reaches further on its own.
 */

/** Not behind bars. Asked by everything in class 2, directly or via `inSchool`. */
export function free(ctx: Ctx): boolean {
  return ctx.c.prison === null;
}

/** Behind bars. The mirror of `free`, for the rows the prison pack owns. */
export function inside(ctx: Ctx): boolean {
  return ctx.c.prison !== null;
}

/** Holding a job and out in the world to do it. */
export function employed(ctx: Ctx): boolean {
  return ctx.c.job !== null && ctx.c.prison === null;
}

/**
 * Every school-life event needs a desk to happen at; a cell is not one — a
 * sentence keeps the enrolment record but ends attendance. The desk is empty
 * until the year the ladder enrols a six-year-old, and empty for good after a
 * dropout: `flags.droppedOut` stops it re-enrolling anyone.
 */
export function inSchool(ctx: Ctx): boolean {
  return free(ctx) && ctx.c.education.enrolledIn !== undefined;
}

/* ------------------------------------------------------------------ */
/* People                                                              */
/* ------------------------------------------------------------------ */

/** Everyone still alive. Widened first: a loaded save can hold a hole. */
export function alivePeople(state: GameState): Person[] {
  const list: (Person | undefined)[] = Object.values(state.people);
  return list.filter((p): p is Person => p !== undefined && p.alive === true);
}

/** Every pet still alive, widened the same way. */
export function alivePets(state: GameState): Person[] {
  const list: (Person | undefined)[] = Object.values(state.people);
  return list.filter((p): p is Person => p !== undefined && p.alive === true && p.kind === 'pet');
}

/** Every living person of one relationship kind, in the order they joined the life. */
export function livingKin(people: Record<string, Person>, kind: RelKind): Person[] {
  return Object.values(people).filter((person) => person.alive && person.kind === kind);
}

/** The first living person of a kind, in the order they joined the life. */
export function firstOfKind(state: GameState, kind: RelKind): Person | undefined {
  return alivePeople(state).find((p) => p.kind === kind);
}

/** The current spouse, else the current partner, else nobody. */
export function romanceOf(state: GameState): Person | undefined {
  const alive = alivePeople(state);
  return alive.find((p) => p.kind === 'spouse') ?? alive.find((p) => p.kind === 'partner');
}

export function spouseOf(state: GameState): Person | undefined {
  return firstOfKind(state, 'spouse');
}

export function siblingOf(state: GameState): Person | undefined {
  return firstOfKind(state, 'sibling');
}

export function childAged(state: GameState, min: number, max: number): Person | undefined {
  return alivePeople(state).find((p) => p.kind === 'child' && p.age >= min && p.age <= max);
}

/** The friend who would notice if you vanished: highest affinity, alive. */
export function bestFriend(state: GameState): Person | undefined {
  const friends = alivePeople(state).filter((p) => p.kind === 'friend');
  return friends.reduce<Person | undefined>(
    (best, p) => (best === undefined || p.rel > best.rel ? p : best),
    undefined
  );
}

/** The sibling the texts name and the effects hit: always the first one listed. */
export function firstSibling(people: Record<string, Person>): Person | undefined {
  return livingKin(people, 'sibling')[0];
}

/** Given name of the first living sibling, or a neutral stand-in. */
export function siblingName(ctx: Ctx): string {
  const sibling = firstSibling(ctx.state.people);
  if (!sibling) return 'Your sibling';
  const given = sibling.name.split(' ')[0];
  return given.length > 0 ? given : sibling.name;
}

export function hasParent(ctx: Ctx): boolean {
  const people = ctx.state.people;
  return livingKin(people, 'mother').length > 0 || livingKin(people, 'father').length > 0;
}

export function hasSibling(ctx: Ctx): boolean {
  return livingKin(ctx.state.people, 'sibling').length > 0;
}

/**
 * The name a sentence should call somebody, never an empty string.
 *
 * `name` is typed `string`, but it comes out of `state.people`, which the save
 * gate only proves is an object — a drifted row can carry no name at all. This
 * runs inside `resolveText`, so a throw here unwinds out of `eventsPhase` with
 * the year already half applied.
 */
export function firstNameOf(person: Person, fallback = 'them'): string {
  const raw: unknown = person.name;
  if (typeof raw !== 'string') return fallback;
  const parts = raw.trim().split(/\s+/);
  return parts[0] || fallback;
}

/* ------------------------------------------------------------------ */
/* Flags, numbers and other widened readers                            */
/* ------------------------------------------------------------------ */

/** Flags are free-form JSON; only a genuine finite number counts as one. */
export function numFlag(c: Character, key: string): number {
  const raw = c.flags[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

/** Strict `=== true`: a truthy string or a 1 is not the marker a pack set. */
export function trueFlag(c: Character, key: string): boolean {
  return c.flags[key] === true;
}

export function strFlag(c: Character, key: string): string {
  const raw = c.flags[key];
  return typeof raw === 'string' ? raw : '';
}

/** A flag counter that survives a save holding a string, a boolean or NaN. */
export function counter(state: GameState, flag: string): number {
  const raw = state.character.flags[flag];
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return 0;
  return Math.floor(raw);
}

/** Severity 0..100 of one addiction; anything unreadable counts as none. */
export function addiction(c: Character, which: AddictionKey): number {
  const raw = c.addictions[which];
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return 0;
  return raw > 100 ? 100 : raw;
}

/** True while the character is already carrying this condition, treated or not. */
export function holds(c: Character, defId: string): boolean {
  return c.illnesses.some((illness) => illness.defId === defId);
}

/* ------------------------------------------------------------------ */
/* Effect builders                                                     */
/* ------------------------------------------------------------------ */

/**
 * Moves affinity with whoever a picker finds when the effect lands.
 * `{kind:'rel'}` addresses people by sentinel or explicit id, and neither names
 * "the sibling this card was about", so those land here instead.
 */
export function relWith(pick: (state: GameState) => Person | undefined, delta: number): Effect {
  return {
    kind: 'fn',
    run: (ctx: EffectCtx) => {
      const person = pick(ctx.state);
      if (!person) return;
      person.rel = clampStat(person.rel + delta);
    },
  };
}

/**
 * Runs against one person by id, or does nothing.
 *
 * An interaction's effects land a moment after `resolve` picked its person, and
 * an event outcome lands a whole phase after its card was dealt — either way the
 * table is re-read here rather than trusted. Own-property only: the id came from
 * data, so `__proto__` must resolve to nobody.
 */
export function withPerson(id: string, run: (person: Person, ctx: EffectCtx) => void): Effect {
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

/** Nudges every living parent; a no-op when both are gone. */
export function parentsRel(delta: number): Effect {
  return {
    kind: 'fn',
    run: (ctx: EffectCtx) => {
      for (const person of Object.values(ctx.state.people)) {
        if (!person.alive) continue;
        if (person.kind === 'mother' || person.kind === 'father') {
          person.rel = clampStat(person.rel + delta);
        }
      }
    },
  };
}

/** Nudges the sibling the surrounding text named; a no-op when there is none. */
export function siblingRel(delta: number): Effect {
  return {
    kind: 'fn',
    run: (ctx: EffectCtx) => {
      const sibling = firstSibling(ctx.state.people);
      if (sibling) sibling.rel = clampStat(sibling.rel + delta);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Names                                                               */
/* ------------------------------------------------------------------ */

/** Everything the name and stat rollers need; `Ctx` and `EffectCtx` both fit. */
export interface RollCtx {
  state: GameState;
  rng: Rng;
  reg: ContentRegistry;
}

export const ROLLED_GENDERS: readonly Gender[] = ['male', 'female'];

/** Widened like every other registry lookup: a partial registry can miss the key. */
export function poolFor(ctx: RollCtx): NamePool | undefined {
  const pools: Record<string, NamePool | undefined> = ctx.reg.namePools;
  return pools[ctx.state.character.countryId];
}

/**
 * A plausible local given name, or a neutral stand-in when no pool is loaded.
 *
 * `taken` drops a name already spoken for by a sibling minted in the same
 * breath, so twins under one surname cannot answer to the same name. It costs
 * no extra draw — the pick is still exactly one, whatever the list ends up
 * holding — and a name this pool never held filters nothing out, so a birth
 * that could not have collided rolls exactly as it did before.
 */
export function rollFirstName(ctx: RollCtx, gender: Gender, taken?: string): string {
  const pool = poolFor(ctx);
  const all = gender === 'female' ? pool?.female : pool?.male;
  const given = taken === undefined ? all : all?.filter((name) => name !== taken);
  if (given && given.length > 0) return ctx.rng.pick(given);
  return gender === 'female' ? 'Riley' : 'Alex';
}

export function rollLastName(ctx: RollCtx): string {
  const pool = poolFor(ctx);
  if (pool && pool.last.length > 0) return ctx.rng.pick(pool.last);
  return ctx.state.character.lastName || 'Doe';
}

/**
 * A plausible full name for the character's country, with a safe fallback.
 *
 * Two draws in this order — given name, then surname — and none at all when the
 * matching list is empty. Deliberately not `rollFirstName` + `rollLastName`:
 * this one falls back to a stock name rather than the character's own surname,
 * which is what the packs that mint schoolfriends want.
 */
export function rollName(ctx: RollCtx, gender: Gender): string {
  const pool = poolFor(ctx);
  const given = gender === 'female' ? pool?.female : pool?.male;
  const first = given && given.length > 0 ? ctx.rng.pick(given) : 'Alex';
  const last = pool && pool.last.length > 0 ? ctx.rng.pick(pool.last) : 'Doe';
  return `${first} ${last}`;
}
