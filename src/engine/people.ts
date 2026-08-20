/**
 * The people table, asked the questions the engine actually asks of it.
 *
 * A leaf module by design: it imports `@/types` and nothing else — no phase, no
 * registry, no rng, no draws — so the effect writer, the text formatter, the
 * finance phase and the estate can all ask "who is alive" without depending on
 * one another, and a read here can never move the run's cursor.
 *
 * Two rules every reader below keeps, and every hand-written copy of them used
 * to restate for itself:
 *
 * * **The table is widened before it is read.** `state.people` comes back from
 *   `JSON.parse` on every load and the save gate only proves it is an object, so
 *   a row may be missing or damaged; `Object.values` hands that hole to the
 *   filter as `undefined`, and `alive` is only trusted when it is genuinely
 *   `true`. A drifted row is nobody rather than a person with no name.
 * * **`Object.values` order is part of the answer.** "The first living spouse"
 *   means the one who joined the life first, which is what every call site
 *   relied on already — insertion order through `addPerson`.
 */

import type { GameState, Person, RelKind } from '@/types';

/** Everyone still alive, in the order they joined the life. */
export function livingPeople(state: GameState): Person[] {
  const list: (Person | undefined)[] = Object.values(state.people);
  return list.filter((p): p is Person => p !== undefined && p.alive === true);
}

/** Everyone still alive of one relationship kind, in that same order. */
export function livingOfKind(state: GameState, kind: RelKind): Person[] {
  return livingPeople(state).filter((p) => p.kind === kind);
}

/**
 * The current spouse, else the current partner, else nobody.
 *
 * A marriage outranks a relationship even when the partner was met later, so
 * this is two passes rather than one: `{partner}` in a template, a `rel` effect
 * aimed at `'partner'` and the survivor an heir inherits a parent from must all
 * name the same person.
 */
export function partnerOf(state: GameState): Person | undefined {
  const alive = livingPeople(state);
  return alive.find((p) => p.kind === 'spouse') ?? alive.find((p) => p.kind === 'partner');
}
