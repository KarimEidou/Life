import { describe, expect, it } from 'vitest';

import { eventsAdultPack } from '@/content/events-adult';
import { eventsPhase } from '@/engine/phases/events';
import { buildRegistry } from '@/engine/registry';
import { createRng } from '@/engine/rng';
import { createLife } from '@/engine/state';
import type { ContentRegistry, Ctx, Effect, EventDef, GameState, Rng } from '@/types';

/**
 * Adult pack contract.
 *
 * Prison is the pack's blanket exclusion: `eventsPhase` keeps drawing while the
 * character is inside, so a def with no `condition` is fully eligible in a cell.
 * These tests run the real shipped defs through the real phase.
 */

const EMPTY = buildRegistry([]);
const adultEvents: EventDef[] = eventsAdultPack.events ?? [];

function defOf(id: string): EventDef {
  const def = adultEvents.find((candidate) => candidate.id === id);
  if (!def) throw new Error(`events-adult ships no "${id}"`);
  return def;
}

/** A registry holding only the defs under test, so the drawn pool is exactly them. */
function registryOf(defs: EventDef[]): ContentRegistry {
  return buildRegistry([{ id: 'events-adult-under-test', events: defs }]);
}

function newLife(seed: number, age: number): GameState {
  const state = createLife(EMPTY, { seed, firstName: 'Ada', lastName: 'Moreno' });
  state.character.age = age;
  return state;
}

/** Both yearly rolls pass and `weighted` is a pure pick, so the draw is fixed. */
function alwaysDraws(): Rng {
  return {
    next: () => 0.5,
    int: (min: number) => min,
    pick: <T,>(arr: readonly T[]): T => arr[0] as T,
    chance: () => true,
    weighted: <T,>(items: readonly T[]): T => items[0] as T,
    normal: (mean: number) => mean,
  };
}

function ctxOf(state: GameState, reg: ContentRegistry, rng?: Rng): Ctx {
  return { state, c: state.character, rng: rng ?? createRng(state), reg };
}

/** What `commitCrime` leaves behind on a jail sentence: inside, and out of a job. */
function jail(state: GameState): void {
  state.character.prison = { crime: 'Bank Robbery', yearsLeft: 8, totalYears: 8 };
  state.character.job = null;
}

function effectsOf(def: EventDef): Effect[] {
  return [
    ...(def.effects ?? []),
    ...(def.choices ?? []).flatMap((choice) =>
      choice.outcomes.flatMap((outcome) => outcome.effects)
    ),
  ];
}

function paysMoney(def: EventDef): boolean {
  return effectsOf(def).some((effect) => effect.kind === 'money' && effect.delta > 0);
}

describe('ev-adult-inheritance', () => {
  it('stays out of the pool while the character is inside, and spends no randomness', () => {
    const state = newLife(1, 30);
    jail(state);
    const reg = registryOf([defOf('ev-adult-inheritance')]);
    const before = state.rngState;

    expect(eventsPhase(ctxOf(state, reg))).toEqual([]);
    expect(state.character.money).toBe(0);
    expect(state.rngState).toBe(before);
    // The once-per-life slot must survive the sentence unspent.
    expect(state.firedEvents).toEqual([]);
  });

  it('still pays the windfall to a character who is not inside', () => {
    const state = newLife(1, 30);
    const reg = registryOf([defOf('ev-adult-inheritance')]);

    const entries = eventsPhase(ctxOf(state, reg, alwaysDraws()));

    expect(entries[0]?.text).toBe('A great-aunt you barely remember left you something in her will.');
    expect(state.character.money).toBe(9000);
    expect(state.firedEvents).toEqual(['ev-adult-inheritance']);
  });
});

/** Top-weight flavour whose only gate is `free`, so it is drawable every adult year. */
const FLAVOUR: ReadonlyArray<readonly [id: string, text: string]> = [
  ['ev-adult-caught-in-rain', 'The rain caught you halfway home, so you stopped hurrying.'],
  ['ev-adult-deja-vu', 'You have stood in this exact spot saying this exact sentence before.'],
];

describe('events-adult flavour events', () => {
  it('keeps free-world flavour out of a prison year, and spends no randomness', () => {
    const state = newLife(3, 30);
    jail(state);
    const reg = registryOf(FLAVOUR.map(([id]) => defOf(id)));
    const before = state.rngState;
    const stats = { ...state.character.stats };

    expect(eventsPhase(ctxOf(state, reg))).toEqual([]);
    // Mood and smarts the prison pack is withholding must not arrive by this door.
    expect(state.character.stats).toEqual(stats);
    expect(state.rngState).toBe(before);
  });

  it('still fires for a character who is not inside', () => {
    for (const [id, text] of FLAVOUR) {
      const state = newLife(3, 30);
      const reg = registryOf([defOf(id)]);

      const entries = eventsPhase(ctxOf(state, reg, alwaysDraws()));

      expect(entries[0]?.text, `event "${id}" did not fire`).toBe(text);
    }
  });
});

describe('events-adult prison exclusion', () => {
  /* The whole pack sits a sentence out, not just the events that move money:
     a def with no `condition` is drawable in a cell, and free-world flavour
     drawn against the prison pack's weights is the bug this guards. */
  it('leaves no event in the pack drawable while the character is inside', () => {
    const state = newLife(4, 40);
    jail(state);
    const ctx = ctxOf(state, registryOf(adultEvents));

    expect(adultEvents.length).toBeGreaterThan(0);
    for (const def of adultEvents) {
      expect(def.condition, `event "${def.id}" declares no condition`).toBeDefined();
      expect(def.condition?.(ctx), `event "${def.id}" is drawable in prison`).toBe(false);
    }
  });

  it('gates every money windfall in the pack behind a condition that refuses in prison', () => {
    const state = newLife(2, 40);
    jail(state);
    const reg = registryOf(adultEvents);
    const ctx = ctxOf(state, reg);
    const before = state.rngState;
    const windfalls = adultEvents.filter(paysMoney);

    expect(windfalls.length).toBeGreaterThan(0);
    for (const def of windfalls) {
      expect(def.condition, `event "${def.id}" declares no condition`).toBeDefined();
      expect(def.condition?.(ctx), `event "${def.id}" is drawable in prison`).toBe(false);
    }
    // Conditions are draw-free reads; evaluating the pool must not move the cursor.
    expect(state.rngState).toBe(before);
  });
});
