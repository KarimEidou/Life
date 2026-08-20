/**
 * Shared boot for component tests. Importing this file installs the jsdom
 * harness (`@/test/setup`: fresh stores per test, RTL cleanup, the matchMedia
 * and ResizeObserver stubs) — which the `dom` project already loads for every
 * `*.test.tsx`, so the import is only load-bearing for a DOM test that lives
 * outside that project.
 *
 * Render with React Testing Library directly: the app holds its state in
 * module-scope zustand stores, so there is no provider to wrap anything in.
 */

import '@/test/setup';

import { useGameStore } from '@/store/gameStore';
import type { GameState } from '@/types';

/** The loaded life, or a loud failure when a step expected one. */
export function currentGame(): GameState {
  const game = useGameStore.getState().game;
  if (game === null) {
    throw new Error('expected a loaded life');
  }
  return game;
}

/**
 * Boots a fresh seeded life into `slot`, the way the create screen does. Every
 * action re-spreads the top-level game object, so the returned reference goes
 * stale for `phase`, `rngState` and the other top-level fields: read the live
 * one back with `currentGame()` after anything that commits.
 */
export function startLife(seed = 1234, slot = 1): GameState {
  useGameStore.getState().newLife({ slot, seed });
  return currentGame();
}

/**
 * Ages the life until it reaches `age`, answering every card with its first
 * choice. A life that dies on the way stops early — check the age you got.
 */
export function ageTo(age: number, cap = 150): void {
  let steps = 0;
  while (currentGame().character.age < age && currentGame().phase !== 'dead') {
    if (steps >= cap) {
      throw new Error(`ageTo(${String(age)}) gave up after ${String(cap)} steps`);
    }
    if (currentGame().phase === 'awaitingChoice') {
      useGameStore.getState().choose(0);
    } else {
      useGameStore.getState().ageUp();
    }
    steps += 1;
  }
}
