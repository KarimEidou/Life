import { beforeEach, describe, expect, it } from 'vitest';

import { getRegistry, resetRegistryForTests } from '@/content';
import { free } from '@/content/lib';
import { availableInteractions } from '@/engine/interactions';
import { createRng } from '@/engine/rng';
import { addPerson, createLife } from '@/engine/state';
import type {
  ContentRegistry,
  Ctx,
  Effect,
  EventDef,
  GameState,
  InteractionDef,
  OwnedAsset,
  Person,
  PrisonState,
  RelKind,
} from '@/types';

/**
 * The prison policy, held registry-wide.
 *
 * The rule itself is written above `free` in `@/content/lib`; this file is the
 * half a machine can check. Nothing upstream sits a sentence out — `eventsPhase`
 * draws from the whole table while the character is inside, `canUse` and
 * `availableInteractions` read `condition` and never `c.prison` — so a card that
 * forgets to ask is dealt from a cell, and the only place that can notice is
 * here.
 *
 * The lists below are the policy's membership: everything a sentence does
 * *not* take away. Everything else in the registry has to be refused from a
 * cell, so a new card is either classified deliberately or it fails this file.
 * Both directions are asserted, because both are bugs: a lemonade stand at the
 * end of the driveway dealt to a twelve-year-old serving eight years, and a
 * conversation with your own mother refused because somebody gated the whole
 * relationships pack.
 *
 * The refusal is checked against three different lives — stocked, stripped and
 * unattached — so a condition that is false for some other reason (no spouse,
 * no job, no ex) cannot be mistaken for a gate. A row that is genuinely
 * prison-gated is false in all three; a row that merely happens to be false in
 * one of them is true in another, and is caught.
 */

/* ------------------------------------------------------------------ */
/* The policy's membership                                             */
/* ------------------------------------------------------------------ */

/**
 * Class 1 — a cell delivers these as readily as a house does.
 *
 * The prison pack's own years, the bouts a body has wherever it is kept, and
 * the two gambling flavour cards that name no place, buy nothing and mint
 * nobody: a ticket found in a coat and a chip pressed into your hand.
 */
const INSIDE_EVENTS: readonly string[] = [
  'ev-prison-cellmate',
  'ev-prison-shakedown',
  'ev-prison-visiting-day',
  'ev-prison-contraband',
  'ev-prison-talent-show',
  'ev-prison-parole',
  'ev-prison-lights-out',
  'ev-prison-guard-favour',
  'ev-health-flu-season',
  'ev-health-insomnia',
  'ev-health-allergies',
  'ev-health-back-tweak',
  'ev-child-growth-spurt',
  'ev-gamble-scratch-ticket',
  'ev-gamble-lucky-charm',
];

/** Class 1 again, as rows: what the institution provides, plus its own pack. */
const INSTITUTION_ROWS: readonly string[] = [
  'act-prison-job',
  'act-prison-workout',
  'act-prison-library',
  'act-prison-riot',
  'act-prison-escape',
  'act-doctor',
  'act-therapy',
  'act-checkup',
  'act-meditation',
  'act-library',
  'act-read-book',
];

/**
 * Class 3 — words, paper and money between people the life already holds.
 *
 * `ev-prison-visiting-day` is the crime pack's own statement that contact
 * survives a sentence, so gating these would be the over-correction. Every one
 * of them is talk, a signature or a cheque between two people the life already
 * holds: no place out there, nothing bought out there, nobody new.
 */
const CONTACT_ROWS: readonly string[] = [
  'rel-spend-time',
  'rel-deep-talk',
  'rel-compliment',
  'rel-insult',
  'rel-ask-money',
  'rel-divorce',
  'rel-disown',
];

const INSIDE_ROWS: readonly string[] = [...INSTITUTION_ROWS, ...CONTACT_ROWS];

/** Class 2, in the one area where both classes share a sheet. */
const GATED_RELATIONSHIP_ROWS: readonly string[] = [
  'rel-gift',
  'rel-prank',
  'rel-propose',
  'rel-reconcile',
  'rel-make-friend',
  'rel-start-dating',
  'rel-date-night',
  'rel-honeymoon',
  'rel-try-baby',
  'rel-adopt',
];

/* ------------------------------------------------------------------ */
/* Scope                                                               */
/* ------------------------------------------------------------------ */

/** True when any of a def's declarative effects hands out a sentence. */
function emitsJail(def: EventDef): boolean {
  const isJail = (effect: Effect): boolean => effect.kind === 'jail';
  const outcomes = (def.choices ?? []).flatMap((choice) => choice.outcomes);
  return (def.effects ?? []).some(isJail) || outcomes.some((o) => o.effects.some(isJail));
}

/**
 * The youngest age at which a sentence can begin, read out of the content.
 *
 * Today that is `crime-shoplift` at twelve, which is why the childhood pack is
 * in scope at all. Nothing is hard-coded: lower a crime's `minAge`, or ship the
 * first `{kind:'jail'}` outcome on a younger card, and the lint reaches further
 * on its own rather than going quietly out of date.
 */
function minSentenceAge(reg: ContentRegistry): number {
  const ages = [
    ...reg.crimes.map((def) => def.minAge),
    ...reg.events.filter(emitsJail).map((def) => def.minAge),
  ].filter((age) => Number.isFinite(age));
  return ages.length > 0 ? Math.min(...ages) : 0;
}

/* ------------------------------------------------------------------ */
/* The three lives, each of them mid-sentence                          */
/* ------------------------------------------------------------------ */

const SENTENCE: PrisonState = { crime: 'Robbery', yearsLeft: 2, totalYears: 8 };

const KIN: readonly RelKind[] = [
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

function kin(state: GameState, kind: RelKind, age: number): Person {
  return addPerson(state, {
    kind,
    name: `Sam ${kind}`,
    gender: 'male',
    age,
    alive: true,
    rel: 80,
    flags: {},
  });
}

/** One bought thing, so `ownsType` answers yes for both kinds. */
function owned(defId: string, label: string, paid: number): OwnedAsset {
  return { id: `own-${defId}`, defId, label, paid, value: paid, yearBought: 2020 };
}

function blank(reg: ContentRegistry, seed: number): GameState {
  const state = createLife(reg, { seed, firstName: 'Ada', lastName: 'Moreno' });
  state.people = {};
  state.character.age = 30;
  state.character.money = 0;
  return state;
}

/**
 * As much as one life can hold at once, so that the sentence is the only thing
 * left to refuse a row: money, fame, a job, a desk, four habits, a roof, a car
 * and one of every relationship. The richer this is, the fewer cards can be
 * refused for a reason other than the gate — which is what stops a missing
 * `free` from hiding behind somebody else's clause.
 */
function stocked(reg: ContentRegistry): GameState {
  const state = blank(reg, 7);
  const c = state.character;
  c.money = 500_000;
  c.fame = 60;
  c.assets = [
    owned('prop-starter-home', 'Starter Home', 250_000),
    owned('veh-sedan', 'Family Sedan', 18_000),
  ];
  c.addictions = { alcohol: 60, smoking: 60, gambling: 60, drugs: 60 };
  c.education.level = 'high';
  c.education.enrolledIn = 'uni';
  c.education.major = 'biology';
  c.job = {
    jobId: 'job-store-manager',
    title: 'Store Manager',
    salary: 42_000,
    years: 3,
    performance: 60,
    workHard: false,
  };
  c.flags.gymRegular = true;
  c.flags.goodDiet = true;
  for (const relKind of KIN) kin(state, relKind, relKind === 'child' ? 18 : 40);
  return state;
}

/** Nobody, nothing, no desk: the shape that catches a gate on an empty life. */
function stripped(reg: ContentRegistry): GameState {
  return blank(reg, 8);
}

/** Single with an ex and a teenager, which is what a reconciliation asks for. */
function unattached(reg: ContentRegistry): GameState {
  const state = blank(reg, 9);
  kin(state, 'ex', 33);
  kin(state, 'child', 14);
  return state;
}

/** Each of the three lives, mid-sentence, named for the failure message. */
function inmates(reg: ContentRegistry): { name: string; state: GameState }[] {
  return [
    { name: 'stocked', state: stocked(reg) },
    { name: 'stripped', state: stripped(reg) },
    { name: 'unattached', state: unattached(reg) },
  ].map((life) => {
    life.state.character.prison = { ...SENTENCE };
    return life;
  });
}

/** A read: the cursor is detached, so evaluating a condition cannot move it. */
function ctxOf(state: GameState, reg: ContentRegistry): Ctx {
  return { state, c: state.character, rng: createRng({ rngState: state.rngState }), reg };
}

/* ------------------------------------------------------------------ */
/* The lint                                                            */
/* ------------------------------------------------------------------ */

describe('the prison policy', () => {
  let reg: ContentRegistry;
  let floor: number;
  let events: EventDef[];
  let rows: InteractionDef[];

  beforeEach(() => {
    resetRegistryForTests();
    reg = getRegistry();
    floor = minSentenceAge(reg);
    // Only what a sentence can actually reach: a card that closes before the
    // youngest jailable age is never dealt from a cell, gate or no gate.
    events = reg.events.filter((def) => def.maxAge >= floor);
    rows = reg.interactions.filter((def) => (def.maxAge ?? Number.POSITIVE_INFINITY) >= floor);
  });

  it('reads the age a sentence can first begin out of the content', () => {
    // Twelve today, from `crime-shoplift`, which is what puts the childhood
    // pack's twelve-year-old windows inside the rule.
    expect(
      floor,
      'the youngest jailable age moved: re-read the packs whose windows now reach it'
    ).toBe(12);

    const inScope = events.map((def) => def.id);
    // A childhood card whose window still covers twelve is in; one that closes
    // years earlier is out, and the filter is what tells them apart.
    expect(inScope).toContain('ev-child-sleepover');
    expect(inScope).not.toContain('ev-child-teething');
    expect(rows.length).toBeGreaterThan(0);
  });

  it('names only rows and cards the registry still ships', () => {
    const eventIds = new Set(reg.events.map((def) => def.id));
    const rowIds = new Set(reg.interactions.map((def) => def.id));

    for (const id of INSIDE_EVENTS) expect(eventIds.has(id), `no event "${id}"`).toBe(true);
    for (const id of INSIDE_ROWS) expect(rowIds.has(id), `no interaction "${id}"`).toBe(true);
    for (const id of GATED_RELATIONSHIP_ROWS) {
      expect(rowIds.has(id), `no interaction "${id}"`).toBe(true);
    }
    // One class each: a row listed twice would satisfy both halves of the lint.
    expect(new Set(INSIDE_EVENTS).size).toBe(INSIDE_EVENTS.length);
    expect(new Set(INSIDE_ROWS).size).toBe(INSIDE_ROWS.length);
    expect(INSIDE_ROWS.filter((id) => GATED_RELATIONSHIP_ROWS.includes(id))).toEqual([]);
  });

  it('refuses every unlisted card from a cell, in all three lives', () => {
    for (const { name, state } of inmates(reg)) {
      const ctx = ctxOf(state, reg);
      for (const def of events) {
        if (INSIDE_EVENTS.includes(def.id)) continue;
        expect(
          def.condition?.(ctx),
          `event "${def.id}" is drawable from a cell (${name} life): it needs \`free\``
        ).toBe(false);
      }
    }
  });

  it('refuses every unlisted row from a cell, in all three lives', () => {
    for (const { name, state } of inmates(reg)) {
      const ctx = ctxOf(state, reg);
      for (const def of rows) {
        if (INSIDE_ROWS.includes(def.id)) continue;
        expect(
          def.condition?.(ctx),
          `interaction "${def.id}" is offered from a cell (${name} life): it needs \`free\``
        ).toBe(false);
      }
    }
  });

  /* The half that stops an over-correction: gating the whole of a pack would
     satisfy every assertion above and take visiting day away with it. */
  it('keeps every listed row and card running inside', () => {
    const [{ state }] = inmates(reg);
    const ctx = ctxOf(state, reg);

    for (const id of INSIDE_EVENTS) {
      const def = reg.eventsById[id];
      expect(def?.condition?.(ctx) !== false, `event "${id}" no longer survives a sentence`).toBe(
        true
      );
    }
    for (const id of INSIDE_ROWS) {
      const def = reg.interactionsById[id];
      expect(
        def?.condition?.(ctx) !== false,
        `interaction "${id}" no longer survives a sentence`
      ).toBe(true);
    }
  });

  it('offers a sheet exactly the contact rows, and hands the rest back on release', () => {
    const lives = inmates(reg);
    const listed = (): string[] =>
      lives.flatMap((life) => availableInteractions(life.state, reg, 'relationship'))
        .map((def) => def.id);

    // Everything the Relationships sheet can show across all three sentences —
    // one of them holds every kind of person, so nothing is missing for want of
    // somebody to aim it at.
    expect([...new Set(listed())].sort()).toEqual([...CONTACT_ROWS].sort());

    // Gated, not deleted: the same three lives, released, see all of them again.
    for (const life of lives) life.state.character.prison = null;
    const released = new Set(listed());
    for (const id of [...CONTACT_ROWS, ...GATED_RELATIONSHIP_ROWS]) {
      expect(released.has(id), `interaction "${id}" never comes back on release`).toBe(true);
    }
  });

  it('hands every gated card back the year the sentence ends', () => {
    const [{ state }] = inmates(reg);
    const ctx = ctxOf(state, reg);
    const refused = events.filter((def) => !INSIDE_EVENTS.includes(def.id));

    state.character.prison = null;
    const backInPlay = refused.filter((def) => {
      // Conditions read the age off the same character, so walk it to a year
      // inside the def's own window before asking.
      state.character.age = Math.min(def.maxAge, Math.max(def.minAge, 30));
      return def.condition?.(ctx) !== false;
    });

    /* Not an equality: plenty of cards stay refused for reasons of their own —
       a country, an illness, an asset the stocked life does not hold. The claim
       is only that the sentence, and not something structural, was what refused
       the bulk of them; 153 of 182 come back today, so the floor has room. */
    expect(backInPlay.length).toBeGreaterThan(refused.length * 0.7);
  });

  /* Proves the two refusal cases above are a test and not a tautology: the
     shape they exist to catch is a card authored with no `condition` at all,
     which is what every one of the packs' gaps looked like. */
  it('would catch a card that forgot to ask', () => {
    const [{ state }] = inmates(reg);
    const ctx = ctxOf(state, reg);
    const forgot: EventDef = {
      id: 'ev-test-forgot-to-ask',
      area: 'life',
      icon: '🚗',
      minAge: 18,
      maxAge: 64,
      weight: 4,
      text: 'Nine hours in the back seat to the coast.',
    };

    expect(forgot.condition?.(ctx)).not.toBe(false);
    expect({ ...forgot, condition: free }.condition(ctx)).toBe(false);
  });

  /* `isEligible` calls `condition` with the phase's live cursor, before any
     roll, so a condition that drew would shift every event after it. */
  it('decides all of it without spending a draw', () => {
    for (const { name, state } of inmates(reg)) {
      const live: Ctx = { state, c: state.character, rng: createRng(state), reg };
      const before = state.rngState;

      for (const def of reg.events) def.condition?.(live);
      for (const def of reg.interactions) def.condition?.(live);

      expect(state.rngState, `a condition drew from the live cursor (${name} life)`).toBe(before);
    }
  });
});
