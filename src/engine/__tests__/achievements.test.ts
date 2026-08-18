import { describe, expect, it } from 'vitest';

import { evaluateAchievements } from '@/engine/achievements';
import { buildRegistry } from '@/engine/registry';
import { createLife } from '@/engine/state';
import type { AchievementDef, ContentRegistry, GameState } from '@/types';

const EMPTY = buildRegistry([]);

function achievement(over: Partial<AchievementDef> = {}): AchievementDef {
  return { id: 'rich', label: 'Rich', desc: 'Bank a million.', icon: '💰', check: () => true, ...over };
}

function regOf(achievements: AchievementDef[]): ContentRegistry {
  return buildRegistry([{ id: 'test-achievements', achievements }]);
}

function newLife(seed = 1): GameState {
  return createLife(EMPTY, { seed, firstName: 'Ada', lastName: 'Moreno' });
}

describe('evaluateAchievements', () => {
  it('unlocks nothing when the registry ships none', () => {
    expect(evaluateAchievements(newLife(), EMPTY, [])).toEqual([]);
  });

  it('returns only the checks that pass, in registry order', () => {
    const reg = regOf([
      achievement({ id: 'first', check: () => true }),
      achievement({ id: 'nope', check: () => false }),
      achievement({ id: 'second', check: () => true }),
    ]);

    expect(evaluateAchievements(newLife(), reg, [])).toEqual(['first', 'second']);
  });

  it('skips ids that are already unlocked', () => {
    const reg = regOf([achievement({ id: 'first' }), achievement({ id: 'second' })]);

    expect(evaluateAchievements(newLife(), reg, ['first'])).toEqual(['second']);
    expect(evaluateAchievements(newLife(), reg, ['first', 'second'])).toEqual([]);
  });

  it('runs the check against the whole game state', () => {
    const state = newLife();
    state.character.money = 1_000_000;
    state.generation = 3;
    const reg = regOf([
      achievement({ id: 'millionaire', check: (s) => s.character.money >= 1_000_000 }),
      achievement({ id: 'dynasty', check: (s) => s.generation >= 5 }),
    ]);

    expect(evaluateAchievements(state, reg, [])).toEqual(['millionaire']);
  });

  it('treats a throwing check as a miss and keeps sweeping', () => {
    const reg = regOf([
      achievement({
        id: 'broken',
        check: () => {
          throw new Error('content bug');
        },
      }),
      achievement({ id: 'fine' }),
    ]);

    expect(() => evaluateAchievements(newLife(), reg, [])).not.toThrow();
    expect(evaluateAchievements(newLife(), reg, [])).toEqual(['fine']);
  });

  it('reports a duplicated definition once', () => {
    const reg = buildRegistry([
      { id: 'a', achievements: [achievement({ id: 'twin' })] },
      { id: 'b', achievements: [achievement({ id: 'twin' })] },
    ]);

    expect(evaluateAchievements(newLife(), reg, [])).toEqual(['twin']);
  });

  it('leaves the caller-owned unlock list untouched', () => {
    const already = ['first'];
    const reg = regOf([achievement({ id: 'first' }), achievement({ id: 'second' })]);

    evaluateAchievements(newLife(), reg, already);

    expect(already).toEqual(['first']);
  });
});
