import { describe, expect, it } from 'vitest';

import { currentYearLog as reExported } from '@/engine/ageUp';
import { currentYearLog } from '@/engine/log';
import { buildRegistry } from '@/engine/registry';
import { createLife } from '@/engine/state';
import type { GameState } from '@/types';

function newLife(seed: number): GameState {
  return createLife(buildRegistry([]), {
    seed,
    firstName: 'Ada',
    lastName: 'Byron',
    gender: 'female',
    startYear: 2000,
  });
}

describe('currentYearLog', () => {
  it('returns the year the log is currently on, without opening another', () => {
    const state = newLife(1);
    const first = currentYearLog(state);

    expect(first).toBe(state.log[0]);
    expect(currentYearLog(state)).toBe(first);
    expect(state.log).toHaveLength(1);
  });

  it('opens a year for the current age when the log is empty', () => {
    const state = newLife(2);
    state.log = [];
    state.character.age = 7;
    state.year = 2007;

    const year = currentYearLog(state);

    expect(year).toEqual({ age: 7, year: 2007, entries: [] });
    expect(state.log).toEqual([year]);
  });

  it('hands back the newest year, not the first one', () => {
    const state = newLife(3);
    state.log.push({ age: 1, year: 2001, entries: [] });

    expect(currentYearLog(state).age).toBe(1);
  });

  /* The helper moved out of `ageUp` to break the engine's import cycles; the old
     path stays a re-export so callers outside the engine need no edit. */
  it('is the same function `@/engine/ageUp` still re-exports', () => {
    expect(reExported).toBe(currentYearLog);
  });
});
