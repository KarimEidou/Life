import { describe, expect, it } from 'vitest';

import { killCharacter, startLegacy } from '@/engine/death';
import { applyEffects } from '@/engine/effects';
import { fillTemplate } from '@/engine/format';
import { livingOfKind, livingPeople, partnerOf } from '@/engine/people';
import { financePhase } from '@/engine/phases/finance';
import { buildRegistry } from '@/engine/registry';
import { createRng } from '@/engine/rng';
import { addPerson, createLife } from '@/engine/state';
import type { Ctx, EffectCtx, GameState, Person, RelKind } from '@/types';

/**
 * The one people-query vocabulary.
 *
 * "Who is alive", "everyone of this kind" and "spouse else partner" were written
 * by hand in the effect writer, the text formatter, the finance phase and the
 * estate, in three variants (plain filter, widened filter, `.some`). These pin
 * the single answer they now share, and the two rules the shared readers keep:
 * the table is widened before it is read, and `Object.values` order is part of
 * the answer.
 */

const REG = buildRegistry([]);

/** Costs the finance phase charges per dependent child, at `costMult` 1. */
const CHILD_COST = 6000;

function life(seed = 1, age = 40): GameState {
  const state = createLife(REG, {
    seed,
    firstName: 'Ada',
    lastName: 'Byron',
    gender: 'female',
    startYear: 2000,
  });
  state.character.age = age;
  // Family is generated per seed; these tests state the cast they need themselves.
  state.people = {};
  return state;
}

function join(state: GameState, kind: RelKind, over: Partial<Person> = {}): Person {
  return addPerson(state, {
    kind,
    name: `${kind} one`,
    gender: 'female',
    age: 40,
    alive: true,
    rel: 60,
    flags: {},
    ...over,
  });
}

/** A row a save lost: `state.people` only survives the load gate as an object. */
function loseRow(state: GameState, id: string): void {
  (state.people as Record<string, Person | undefined>)[id] = undefined;
}

function ctxFor(state: GameState): Ctx {
  return { state, c: state.character, rng: createRng(state), reg: REG };
}

function effectCtxFor(state: GameState): EffectCtx {
  return { state, rng: createRng(state), reg: REG };
}

describe('livingPeople', () => {
  it('answers in the order people joined the life', () => {
    const state = life();
    const first = join(state, 'friend', { name: 'Rosa' });
    const second = join(state, 'friend', { name: 'Yuki' });
    const third = join(state, 'child', { name: 'Nina', age: 8 });

    expect(livingPeople(state)).toEqual([first, second, third]);
  });

  it('leaves out the dead', () => {
    const state = life();
    join(state, 'spouse', { name: 'Yuki', alive: false });
    join(state, 'friend', { name: 'Rosa' });

    expect(livingPeople(state).map((p) => p.name)).toEqual(['Rosa']);
  });

  it('steps over a row a save lost instead of throwing on it', () => {
    const state = life();
    const kept = join(state, 'friend', { name: 'Rosa' });
    loseRow(state, 'p99');

    expect(livingPeople(state)).toEqual([kept]);
  });

  it('trusts `alive` only when it is genuinely true', () => {
    /* The flag comes back from `JSON.parse`, so a hand-edited save can hold a 1
       where the engine only ever writes a boolean. A truthy test would count
       that row as a living person for every reader below. */
    const state = life();
    const damaged = join(state, 'friend', { name: 'Rosa' });
    (damaged as { alive: unknown }).alive = 1;

    expect(livingPeople(state)).toEqual([]);
  });
});

describe('livingOfKind', () => {
  it('keeps only that kind, alive, in the order they joined', () => {
    const state = life();
    join(state, 'child', { name: 'Nina', age: 8 });
    join(state, 'friend', { name: 'Rosa' });
    join(state, 'child', { name: 'Bo', age: 12, alive: false });
    join(state, 'child', { name: 'Sam', age: 3 });

    expect(livingOfKind(state, 'child').map((p) => p.name)).toEqual(['Nina', 'Sam']);
  });

  it('is empty rather than undefined when nobody qualifies', () => {
    expect(livingOfKind(life(), 'spouse')).toEqual([]);
  });
});

describe('partnerOf', () => {
  it('prefers the spouse over a partner who joined the life first', () => {
    const state = life();
    join(state, 'partner', { name: 'Rosa' });
    join(state, 'spouse', { name: 'Yuki' });

    expect(partnerOf(state)?.name).toBe('Yuki');
  });

  it('falls back to the living partner once the spouse is dead', () => {
    const state = life();
    join(state, 'spouse', { name: 'Yuki', alive: false });
    join(state, 'partner', { name: 'Rosa' });

    expect(partnerOf(state)?.name).toBe('Rosa');
  });

  it('is nobody when only an ex is left', () => {
    const state = life();
    join(state, 'ex', { name: 'Rosa' });

    expect(partnerOf(state)).toBeUndefined();
  });
});

describe('every reader asks the same question', () => {
  it('names the partner the same way in a template and in a `rel` effect', () => {
    const state = life();
    join(state, 'spouse', { name: 'Yuki', alive: false });
    const rosa = join(state, 'partner', { name: 'Rosa', rel: 50 });

    expect(fillTemplate('{partner}', state)).toBe('Rosa');
    applyEffects(effectCtxFor(state), [{ kind: 'rel', who: 'partner', delta: 10 }]);
    expect(rosa.rel).toBe(60);
    expect(partnerOf(state)).toBe(rosa);
  });

  it('counts the same living children in the obituary as `livingOfKind`', () => {
    const state = life(2, 80);
    join(state, 'child', { name: 'Nina', age: 40 });
    join(state, 'child', { name: 'Bo', age: 38, alive: false });

    killCharacter(state, REG, 'old age');

    expect(livingOfKind(state, 'child')).toHaveLength(1);
    expect(state.death?.epitaphStats.kids).toBe(1);
    expect(state.death?.obituary).toContain('and 1 child.');
  });

  it('gives the heir the surviving partner as a parent', () => {
    const state = life(3, 80);
    state.character.money = 0;
    join(state, 'spouse', { name: 'Yuki Byron', alive: false });
    join(state, 'partner', { name: 'Rosa Byron', gender: 'female' });
    const heir = join(state, 'child', { name: 'Nina Byron', age: 20 });

    killCharacter(state, REG, 'old age');
    const next = startLegacy(state, REG, heir.id);

    expect(livingOfKind(next, 'mother').map((p) => p.name)).toEqual(['Rosa Byron']);
  });

  it('refuses an heir the estate split would not count', () => {
    /* The guard and the split have to read `alive` the same way, or the
       inheritance is divided between no children at all. */
    const state = life(3, 80);
    const heir = join(state, 'child', { name: 'Nina Byron', age: 20 });
    (heir as { alive: unknown }).alive = 1;

    expect(livingOfKind(state, 'child')).toEqual([]);
    expect(() => startLegacy(state, REG, heir.id)).toThrow('is not alive');
  });

  it('charges living costs for living children only', () => {
    const withNobody = life(4, 30);
    const withDead = life(4, 30);
    join(withDead, 'child', { name: 'Nina', age: 5, alive: false });
    const withLiving = life(4, 30);
    join(withLiving, 'child', { name: 'Nina', age: 5 });

    for (const state of [withNobody, withDead, withLiving]) {
      state.character.money = 200_000;
      state.character.flags.livesWithParents = false;
      financePhase(ctxFor(state));
    }

    expect(withDead.character.money).toBe(withNobody.character.money);
    expect(withLiving.character.money).toBe(withNobody.character.money - CHILD_COST);
  });

  it('settles a year whose people table lost a row', () => {
    /* Every reader used to widen for itself or not at all: the finance phase's
       spouse test read `p.alive` off whatever `Object.values` handed it. */
    const state = life(5, 30);
    state.character.money = 200_000;
    loseRow(state, 'p42');

    expect(() => financePhase(ctxFor(state))).not.toThrow();
    expect(fillTemplate('{partner}', state)).toBe('your partner');
  });
});

describe('the random-family pool still guards before it picks', () => {
  it('spends no draw when nobody in the family is alive', () => {
    const state = life(6);
    join(state, 'mother', { name: 'Yuki', alive: false });
    join(state, 'friend', { name: 'Rosa' });
    const before = state.rngState;

    applyEffects(effectCtxFor(state), [{ kind: 'rel', who: 'random-family', delta: 10 }]);

    expect(state.rngState).toBe(before);
  });

  it('spends one draw on a pool of living family', () => {
    const state = life(6);
    const mother = join(state, 'mother', { name: 'Yuki', rel: 50 });
    const before = state.rngState;

    applyEffects(effectCtxFor(state), [{ kind: 'rel', who: 'random-family', delta: 10 }]);

    expect(state.rngState).not.toBe(before);
    expect(mother.rel).toBe(60);
  });
});
