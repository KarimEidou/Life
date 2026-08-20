import { beforeEach, describe, expect, it } from 'vitest';

import { getRegistry, resetRegistryForTests } from '@/content';
import { healthPack } from '@/content/health';
import { relationshipsPack } from '@/content/relationships';
import { eventsPhase } from '@/engine/phases/events';
import { buildRegistry } from '@/engine/registry';
import { addPerson, createLife } from '@/engine/state';
import type {
  ContentPack,
  ContentRegistry,
  Ctx,
  Effect,
  EventDef,
  GameState,
  Person,
  RelKind,
  Rng,
} from '@/types';

/**
 * One beat, one home: no two cards may be the same card.
 *
 * A pack author picks a weight against the pool they can see, which is their own
 * file. Nothing checked the pool they cannot see, and four beats were being
 * billed twice — one card written down in two places, each at the weight its
 * author thought was the whole story:
 *
 *   ev-adult-anniversary    + ev-rel-anniversary      identical effect rows
 *   ev-adult-in-law-drama   + ev-rel-in-laws          the same card down to the sentence
 *   ev-adult-sleepless-week + ev-health-insomnia      the same bad week, harsher numbers
 *   ev-adult-layoff-rumor   + ev-adult-terrible-boss  one pack doing it to itself
 *
 * A married character therefore drew "another year together" on eight weight
 * rather than the four either author wrote. The fix is editorial: the pack whose
 * window covers the whole life keeps the beat and takes the other telling with
 * it as a second `text`, and the twin goes. This file is what stops the next one
 * from shipping.
 *
 * What the rule can see is a card's declarative payload — its `area` and its
 * `effects` rows — which is a deliberately narrow window. Three of the four
 * pairs above were found by reading rather than by this, and the reasons are
 * worth naming so the rule is not mistaken for a proof:
 *
 * - A choice card carries no `effects` at all; its numbers live under
 *   `choices[].outcomes[].effects`. So the in-law twins were invisible here and
 *   still would be. Cards with nothing declarative are skipped rather than
 *   grouped, or every choice card in an area would read as a twin of every other.
 * - Any difference at all reads as a different card, so the two sleepless weeks
 *   (both -2 health, but -3/-1 of mood and smarts against -5/-2) slip through.
 *   The rule catches the copy-paste, not the paraphrase.
 * - Rows are compared as a set rather than a list, which is the one place this
 *   is stricter than the description: a twin that shuffles its rows is still a
 *   twin, and no shipped card pays for the strictness.
 * - A `{kind:'fn'}` row is compared by function identity, so two cards sharing an
 *   imported helper still match while two different closures never do.
 *   `JSON.stringify` drops functions, which would instead have made every `fn`
 *   row equal to every other and reported cards with nothing in common.
 */

/** One effect row as a string: every field, sorted, `fn` by identity. */
function rowKey(row: Effect, fns: Map<unknown, number>): string {
  const fields: [string, unknown][] = Object.entries(row);
  return fields
    .map(([field, value]) => {
      if (typeof value !== 'function') return `${field}=${JSON.stringify(value)}`;
      if (!fns.has(value)) fns.set(value, fns.size);
      return `${field}=fn#${String(fns.get(value))}`;
    })
    .sort()
    .join(',');
}

/** An event's payload: the area it is drawn into, plus its rows as a set. */
function payloadOf(def: EventDef, fns: Map<unknown, number>): string {
  const rows = (def.effects ?? []).map((row) => rowKey(row, fns)).sort();
  return `${def.area}|${rows.join(';')}`;
}

/** Every group of cards that are the same card, id-sorted for a stable message. */
function twins(reg: ContentRegistry): string[] {
  const fns = new Map<unknown, number>();
  const groups = new Map<string, EventDef[]>();
  for (const def of reg.events) {
    // A card with no declarative rows says nothing this rule can read.
    if ((def.effects ?? []).length === 0) continue;
    const key = payloadOf(def, fns);
    groups.set(key, [...(groups.get(key) ?? []), def]);
  }
  return [...groups.values()]
    .filter((defs) => defs.length > 1)
    .map((defs) => [...defs].sort((a, b) => a.id.localeCompare(b.id)))
    .sort((a, b) => (a[0]?.id ?? '').localeCompare(b[0]?.id ?? ''))
    .map((defs) => {
      const ids = defs.map((def) => `"${def.id}"`).join(' and ');
      return `events ${ids} share area "${defs[0]?.area ?? ''}" and apply the same effects`;
    });
}

/** A card with everything `EventDef` demands, so a fixture only states its point. */
function card(over: Partial<EventDef> & { id: string }): EventDef {
  return {
    area: 'life',
    icon: '🎈',
    minAge: 0,
    maxAge: 90,
    weight: 4,
    text: 'Something happened.',
    ...over,
  };
}

/** Two packs, one card each: the shape a cross-pack twin actually ships in. */
function twoPacks(first: EventDef, second: EventDef): ContentRegistry {
  const packs: ContentPack[] = [
    { id: 'pack-one', events: [first] },
    { id: 'pack-two', events: [second] },
  ];
  return buildRegistry(packs);
}

const SAD: Effect[] = [
  { kind: 'stat', stat: 'happiness', delta: -5 },
  { kind: 'stat', stat: 'health', delta: -1 },
];

describe('duplicate cards', () => {
  let reg: ContentRegistry;

  beforeEach(() => {
    resetRegistryForTests();
    reg = getRegistry();
  });

  it('ships no card whose payload is already in its area', () => {
    expect(twins(reg)).toEqual([]);
  });

  it('has payloads to compare in the first place', () => {
    // A rule that iterates nothing passes, so the table it reads is asserted too.
    const declarative = reg.events.filter((def) => (def.effects ?? []).length > 0);
    expect(declarative.length).toBeGreaterThanOrEqual(100);
    expect(new Set(declarative.map((def) => def.area)).size).toBeGreaterThanOrEqual(6);
    expect(twins(buildRegistry([]))).toEqual([]);
  });

  it('names a beat two packs shipped separately', () => {
    const doubled = twoPacks(
      card({ id: 'ev-one-bad-week', area: 'health', effects: SAD }),
      card({ id: 'ev-two-bad-week', area: 'health', effects: [...SAD] })
    );

    expect(twins(doubled)).toEqual([
      'events "ev-one-bad-week" and "ev-two-bad-week" share area "health" and apply the same effects',
    ]);
  });

  it('sees past the order the rows were written in', () => {
    const shuffled = twoPacks(
      card({ id: 'ev-one-bad-week', area: 'health', effects: SAD }),
      card({ id: 'ev-two-bad-week', area: 'health', effects: [...SAD].reverse() })
    );

    expect(twins(shuffled)).toHaveLength(1);
  });

  it('reads a different area or a different number as a different card', () => {
    const elsewhere = twoPacks(
      card({ id: 'ev-one-bad-week', area: 'health', effects: SAD }),
      card({ id: 'ev-two-bad-week', area: 'work', effects: [...SAD] })
    );
    const cheaper = twoPacks(
      card({ id: 'ev-one-bad-week', area: 'health', effects: SAD }),
      card({
        id: 'ev-two-bad-week',
        area: 'health',
        effects: [
          { kind: 'stat', stat: 'happiness', delta: -5 },
          { kind: 'stat', stat: 'health', delta: -2 },
        ],
      })
    );

    expect(twins(elsewhere)).toEqual([]);
    expect(twins(cheaper)).toEqual([]);
  });

  it('says nothing about cards that declare no rows', () => {
    // Two choice cards carry no `effects`; grouping them on an empty payload
    // would report every choice card in an area as a twin of every other.
    const choices = twoPacks(
      card({ id: 'ev-one-question', choices: [] }),
      card({ id: 'ev-two-question', choices: [] })
    );

    expect(twins(choices)).toEqual([]);
  });

  it('tells apart two cards whose only row is a function', () => {
    const shared: Effect = { kind: 'fn', run: () => undefined };
    const other: Effect = { kind: 'fn', run: () => undefined };
    const pair = (second: Effect): ContentRegistry =>
      twoPacks(
        card({ id: 'ev-one-fn', effects: [shared] }),
        card({ id: 'ev-two-fn', effects: [second] })
      );

    expect(twins(pair(shared))).toHaveLength(1);
    expect(twins(pair(other))).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* The beats themselves                                                */
/* ------------------------------------------------------------------ */

const EMPTY = buildRegistry([]);

function newLife(seed: number, age: number): GameState {
  const state = createLife(EMPTY, { seed, firstName: 'Ada', lastName: 'Moreno' });
  state.character.age = age;
  return state;
}

function addKin(state: GameState, kind: RelKind, name: string): Person {
  return addPerson(state, {
    kind,
    name,
    gender: 'female',
    age: 34,
    alive: true,
    rel: 60,
    flags: {},
  });
}

/** Both yearly rolls pass, `weighted` takes the only card, `pick` takes `index`. */
function drawing(index: number): Rng {
  return {
    next: () => 0.5,
    int: (min: number) => min,
    pick: <T,>(arr: readonly T[]): T => arr[Math.min(index, arr.length - 1)] as T,
    chance: () => true,
    weighted: <T,>(items: readonly T[]): T => items[0] as T,
    normal: (mean: number) => mean,
  };
}

function ctxOf(state: GameState, reg: ContentRegistry, rng: Rng): Ctx {
  return { state, c: state.character, rng, reg };
}

function packDef(pack: ContentPack, id: string): EventDef {
  const def = (pack.events ?? []).find((candidate) => candidate.id === id);
  if (!def) throw new Error(`pack "${pack.id}" ships no "${id}"`);
  return def;
}

/** A registry holding one card, so the drawn pool is exactly it. */
function only(def: EventDef): ContentRegistry {
  return buildRegistry([{ id: 'pack-under-test', events: [def] }]);
}

/**
 * The line one card puts in front of the player, on the `index`-th variant.
 * A choice card carries its text on the pending card rather than the feed.
 */
function told(state: GameState, def: EventDef, index: number): string {
  const entries = eventsPhase(ctxOf(state, only(def), drawing(index)));
  return entries[0]?.text ?? state.pending[0]?.text ?? '';
}

describe('the deduplicated beats', () => {
  let reg: ContentRegistry;

  beforeEach(() => {
    resetRegistryForTests();
    reg = getRegistry();
  });

  it('keeps exactly one home for each of them', () => {
    for (const id of [
      'ev-adult-anniversary',
      'ev-adult-in-law-drama',
      'ev-adult-sleepless-week',
      'ev-adult-layoff-rumor',
    ]) {
      expect(reg.eventsById[id], `event "${id}" is still shipped`).toBeUndefined();
    }
    for (const id of [
      'ev-rel-anniversary',
      'ev-rel-in-laws',
      'ev-health-insomnia',
      'ev-adult-terrible-boss',
    ]) {
      expect(reg.eventsById[id], `event "${id}" went missing with its twin`).toBeDefined();
    }
  });

  it('still gives an unmarried romance its anniversary', () => {
    // The reach the deleted adult card had, which is why the survivor asks for a
    // romance rather than a spouse: dropping the twin must not drop the beat.
    const state = newLife(1, 30);
    addKin(state, 'partner', 'Nina Ortiz');

    expect(told(state, packDef(relationshipsPack, 'ev-rel-anniversary'), 0)).toBe(
      'You and Nina Ortiz hit another year together. They remembered first.'
    );
  });

  it('still counts the years for a marriage', () => {
    const state = newLife(2, 34);
    const spouse = addKin(state, 'spouse', 'Nina Ortiz');
    state.character.flags['rel:weddingAge'] = 30;

    expect(told(state, packDef(relationshipsPack, 'ev-rel-anniversary'), 0)).toBe(
      '4 years married. Nina Ortiz remembered first.'
    );
    expect(spouse.rel).toBe(66);
  });

  it('counts no years for a marriage that ended', () => {
    // `rel:weddingAge` is never cleared, so a divorced character dating again
    // would otherwise be told how long they have been married to somebody else.
    const state = newLife(3, 40);
    addKin(state, 'partner', 'Nina Ortiz');
    state.character.flags['rel:weddingAge'] = 30;

    expect(told(state, packDef(relationshipsPack, 'ev-rel-anniversary'), 0)).toBe(
      'You and Nina Ortiz hit another year together. They remembered first.'
    );
  });

  it('tells the in-laws both ways', () => {
    const def = packDef(relationshipsPack, 'ev-rel-in-laws');
    const married = (): GameState => {
      const state = newLife(4, 40);
      addKin(state, 'spouse', 'Nina Ortiz');
      return state;
    };

    expect(told(married(), def, 0)).toBe(
      'Your in-laws have opinions about your kitchen, your job and your haircut.'
    );
    expect(told(married(), def, 1)).toBe(
      'Your mother-in-law has opinions about your home, your job and your cooking.'
    );
  });

  it('tells the sleepless week both ways, at any age and in any bed', () => {
    const def = packDef(healthPack, 'ev-health-insomnia');

    expect(told(newLife(5, 40), def, 0)).toBe(
      'You did not sleep properly for a week. The ceiling has 412 tiles.'
    );
    expect(told(newLife(5, 40), def, 1)).toBe(
      'You did not sleep properly for a week. Everything got harder.'
    );
    // The adult twin asked `free`; the survivor is Class 1 and stays ungated.
    const inside = newLife(5, 40);
    inside.character.prison = { crime: 'Burglary', yearsLeft: 3, totalYears: 3 };
    expect(told(inside, def, 1)).toBe(
      'You did not sleep properly for a week. Everything got harder.'
    );
  });
});
