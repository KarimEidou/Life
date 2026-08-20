import { beforeEach, describe, expect, it } from 'vitest';

import * as lib from '@/content/lib';
import { applyEffects, clampMoney, clampStat } from '@/engine/effects';
import { fmtMoney } from '@/engine/format';
import { sellAsset } from '@/engine/phases/finance';
import { buildRegistry } from '@/engine/registry';
import { createRng } from '@/engine/rng';
import { addPerson, createLife } from '@/engine/state';
import type { ContentRegistry, Ctx, EffectCtx, GameState, NamePool, Person } from '@/types';

/**
 * The shared content library.
 *
 * These helpers were seven copy-pasted definitions before they were one, and
 * the copies had already drifted: two `Person.rel` roundings, two addiction
 * readers with different clamping. So the point of this file is the exact
 * widening each one promises — what a drifted save, a hole in the people table
 * or a truthy-but-not-`true` flag actually produces — plus the draw shape of
 * the name rollers, which is the only thing in here a replay can notice.
 */

/** Every pack module's source, read through Vite so no node typings are needed. */
const SOURCES: Record<string, string> = import.meta.glob('../*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const POOL: NamePool = {
  countryId: 'zz',
  male: ['Ander', 'Bo'],
  female: ['Cala', 'Dee'],
  last: ['Vega', 'Wren'],
};

function testRegistry(): ContentRegistry {
  return buildRegistry([
    {
      id: 'lib-test',
      countries: [
        { id: 'zz', label: 'Zedland', flag: '🏳️', costMult: 1, taxMult: 1, visaDifficulty: 0.5 },
      ],
      namePools: [POOL],
    },
  ]);
}

function life(reg: ContentRegistry): GameState {
  return createLife(reg, { seed: 11, firstName: 'Ada', lastName: 'Moreno', countryId: 'zz' });
}

function ctxOf(state: GameState, reg: ContentRegistry, target?: Person): Ctx {
  return { state, c: state.character, rng: createRng(state), reg, target };
}

function effectCtxOf(state: GameState, reg: ContentRegistry): EffectCtx {
  return { state, rng: createRng(state), reg };
}

function kin(over: Partial<Person> & Pick<Person, 'kind' | 'name' | 'age'>): Omit<Person, 'id'> {
  return { gender: 'female', alive: true, rel: 70, flags: {}, ...over };
}

/** How many draws a call consumed, measured against a detached replay cursor. */
function drawsSpent(before: number, after: number): number {
  const probe = { rngState: before };
  const rng = createRng(probe);
  for (let n = 0; n <= 8; n += 1) {
    if (probe.rngState === after) return n;
    rng.next();
  }
  return -1;
}

describe('content lib — the sanctioned engine edge', () => {
  it('re-exports the engine functions content is allowed to call, unwrapped', () => {
    expect(lib.addPerson).toBe(addPerson);
    expect(lib.sellAsset).toBe(sellAsset);
    expect(lib.clampMoney).toBe(clampMoney);
    expect(lib.clampStat).toBe(clampStat);
    expect(lib.fmtMoney).toBe(fmtMoney);
  });

  it('is the only content module that imports the engine', () => {
    /* `index.ts` is the manifest, not a pack: it calls `buildRegistry`.
       `gambling.ts` still holds the casino sub-engine, which is player-driven
       simulation rather than data and is being moved to `src/engine/` under its
       own change; until it lands it is a named, temporary exception. */
    const allowed = new Set(['lib.ts', 'index.ts', 'gambling.ts']);
    const offenders: string[] = [];

    for (const [path, source] of Object.entries(SOURCES)) {
      const name = path.slice(path.lastIndexOf('/') + 1);
      if (allowed.has(name)) continue;
      // `import type` counts: a type-only edge is still an edge in the contract.
      for (const match of source.matchAll(/(?:from|import)\s+'([^']+)'/g)) {
        if (match[1].startsWith('@/engine')) offenders.push(`${name} -> ${match[1]}`);
      }
    }

    expect(Object.keys(SOURCES).length).toBeGreaterThan(15);
    expect(offenders).toEqual([]);
  });
});

describe('content lib — gates', () => {
  let reg: ContentRegistry;
  let state: GameState;

  beforeEach(() => {
    reg = testRegistry();
    state = life(reg);
  });

  it('reads prison in both directions', () => {
    expect(lib.free(ctxOf(state, reg))).toBe(true);
    expect(lib.inside(ctxOf(state, reg))).toBe(false);

    state.character.prison = { crime: 'Burglary', yearsLeft: 2, totalYears: 2 };
    expect(lib.free(ctxOf(state, reg))).toBe(false);
    expect(lib.inside(ctxOf(state, reg))).toBe(true);
  });

  it('wants a job and an outside to do it in', () => {
    expect(lib.employed(ctxOf(state, reg))).toBe(false);

    state.character.job = {
      jobId: 'job-x',
      title: 'Clerk',
      salary: 30000,
      years: 1,
      performance: 50,
      workHard: false,
    };
    expect(lib.employed(ctxOf(state, reg))).toBe(true);

    state.character.prison = { crime: 'Fraud', yearsLeft: 1, totalYears: 1 };
    expect(lib.employed(ctxOf(state, reg))).toBe(false);
  });

  it('wants a desk, and a cell is not one', () => {
    expect(lib.inSchool(ctxOf(state, reg))).toBe(false);

    state.character.education.enrolledIn = 'primary';
    expect(lib.inSchool(ctxOf(state, reg))).toBe(true);

    state.character.prison = { crime: 'Vandalism', yearsLeft: 1, totalYears: 1 };
    expect(lib.inSchool(ctxOf(state, reg))).toBe(false);
  });
});

describe('content lib — people', () => {
  let reg: ContentRegistry;
  let state: GameState;

  beforeEach(() => {
    reg = testRegistry();
    state = life(reg);
    state.people = {};
  });

  it('skips a hole in the people table instead of throwing', () => {
    const real = addPerson(state, kin({ kind: 'friend', name: 'Nell Ray', age: 30 }));
    // A drifted save can carry a key with nothing behind it.
    (state.people as Record<string, Person | undefined>)['p9'] = undefined;

    expect(lib.alivePeople(state)).toEqual([real]);
    expect(lib.alivePets(state)).toEqual([]);
  });

  it('counts only the living', () => {
    addPerson(state, kin({ kind: 'sibling', name: 'Dead Sib', age: 20, alive: false }));
    const alive = addPerson(state, kin({ kind: 'sibling', name: 'Live Sib', age: 22 }));

    expect(lib.alivePeople(state)).toEqual([alive]);
    expect(lib.siblingOf(state)).toBe(alive);
    expect(lib.livingKin(state.people, 'sibling')).toEqual([alive]);
    expect(lib.hasSibling(ctxOf(state, reg))).toBe(true);
  });

  it('prefers a spouse to a partner and finds nobody when there is nobody', () => {
    expect(lib.romanceOf(state)).toBeUndefined();

    addPerson(state, kin({ kind: 'partner', name: 'Pat Lee', age: 30 }));
    const spouse = addPerson(state, kin({ kind: 'spouse', name: 'Sam Reid', age: 31 }));

    expect(lib.romanceOf(state)).toBe(spouse);
    expect(lib.spouseOf(state)).toBe(spouse);
    expect(lib.firstOfKind(state, 'partner')?.name).toBe('Pat Lee');
  });

  it('finds a child inside an inclusive age band', () => {
    const kid = addPerson(state, kin({ kind: 'child', name: 'Ivo Moreno', age: 8 }));

    expect(lib.childAged(state, 8, 8)).toBe(kid);
    expect(lib.childAged(state, 0, 7)).toBeUndefined();
    expect(lib.childAged(state, 9, 18)).toBeUndefined();
  });

  it('picks the warmest friend, and only friends', () => {
    addPerson(state, kin({ kind: 'friend', name: 'Cool Cass', age: 30, rel: 40 }));
    const best = addPerson(state, kin({ kind: 'friend', name: 'Warm Wren', age: 30, rel: 90 }));
    addPerson(state, kin({ kind: 'enemy', name: 'Rival Rae', age: 30, rel: 99 }));

    expect(lib.bestFriend(state)).toBe(best);
  });

  it('names the first living sibling and falls back when there is none', () => {
    expect(lib.siblingName(ctxOf(state, reg))).toBe('Your sibling');
    expect(lib.firstSibling(state.people)).toBeUndefined();

    addPerson(state, kin({ kind: 'sibling', name: 'Rui Moreno', age: 15 }));
    expect(lib.siblingName(ctxOf(state, reg))).toBe('Rui');
  });

  it('asks for a living parent of either kind', () => {
    expect(lib.hasParent(ctxOf(state, reg))).toBe(false);

    addPerson(state, kin({ kind: 'father', name: 'Leo Moreno', age: 50, gender: 'male' }));
    expect(lib.hasParent(ctxOf(state, reg))).toBe(true);
  });

  it('never hands a sentence an empty name', () => {
    const named = { id: 'p1', name: 'Ada Moreno' } as Person;
    const blank = { id: 'p2', name: '   ' } as Person;
    // `Person.name` is typed `string`, but it comes back out of JSON.
    const drifted = { id: 'p3' } as Person;

    expect(lib.firstNameOf(named, 'somebody')).toBe('Ada');
    expect(lib.firstNameOf(blank, 'somebody')).toBe('somebody');
    expect(lib.firstNameOf(drifted, 'somebody')).toBe('somebody');
    expect(lib.firstNameOf(drifted)).toBe('them');
  });
});

describe('content lib — flags, numbers and widened readers', () => {
  let reg: ContentRegistry;
  let state: GameState;

  beforeEach(() => {
    reg = testRegistry();
    state = life(reg);
  });

  it('rounds affinity to the one decimal place the engine stores', () => {
    expect(lib.clampStat(62.5 + 1)).toBe(63.5);
    expect(lib.clampStat(62.44)).toBe(62.4);
    expect(lib.clampStat(150)).toBe(100);
    expect(lib.clampStat(-5)).toBe(0);
    // The integers the parent/sibling nudges deal in come back out unchanged,
    // which is what the whole-number clamp this replaced was there for.
    expect([-5, 0, 40, 79, 100, 150].map(lib.clampStat)).toEqual([0, 0, 40, 79, 100, 100]);
    // A poisoned affinity heals, and heals to the number `applyEffects` and
    // `relationshipsPhase.drift` would write for the same person.
    expect(lib.clampStat(NaN)).toBe(0);
    expect(lib.clampStat(Infinity)).toBe(100);
    expect(lib.clampStat(-Infinity)).toBe(0);
  });

  it('reads a flag as a number, a string or strictly true', () => {
    const c = state.character;
    c.flags.count = 3.5;
    c.flags.wordy = 'yes';
    c.flags.bad = NaN;

    expect(lib.numFlag(c, 'count')).toBe(3.5);
    expect(lib.numFlag(c, 'wordy')).toBe(0);
    expect(lib.numFlag(c, 'bad')).toBe(0);
    expect(lib.numFlag(c, 'missing')).toBe(0);

    expect(lib.strFlag(c, 'wordy')).toBe('yes');
    expect(lib.strFlag(c, 'count')).toBe('');

    // Strict `=== true`: a truthy string is not the marker a pack set.
    expect(lib.trueFlag(c, 'wordy')).toBe(false);
    c.flags.marked = true;
    expect(lib.trueFlag(c, 'marked')).toBe(true);
  });

  it('floors a counter and refuses anything that is not one', () => {
    const flags = state.character.flags;

    expect(lib.counter(state, 'nope')).toBe(0);
    flags.n = 4.9;
    expect(lib.counter(state, 'n')).toBe(4);
    flags.n = -3;
    expect(lib.counter(state, 'n')).toBe(0);
    flags.n = 'seven';
    expect(lib.counter(state, 'n')).toBe(0);
  });

  it('reads an addiction as 0..100, whatever the save holds', () => {
    const c = state.character;
    const addictions = c.addictions as Record<string, unknown>;

    expect(lib.addiction(c, 'gambling')).toBe(0);
    addictions.gambling = 150;
    expect(lib.addiction(c, 'gambling')).toBe(100);
    addictions.gambling = -20;
    expect(lib.addiction(c, 'gambling')).toBe(0);
    addictions.gambling = 'lots';
    expect(lib.addiction(c, 'gambling')).toBe(0);
    addictions.gambling = 42.5;
    expect(lib.addiction(c, 'gambling')).toBe(42.5);
  });

  it('holds a condition whether or not it is being treated', () => {
    const c = state.character;
    expect(lib.holds(c, 'ill-flu')).toBe(false);

    c.illnesses.push({ defId: 'ill-flu', years: 0, treated: true });
    expect(lib.holds(c, 'ill-flu')).toBe(true);
    expect(lib.holds(c, 'ill-cancer')).toBe(false);
  });
});

describe('content lib — effect builders', () => {
  let reg: ContentRegistry;
  let state: GameState;

  beforeEach(() => {
    reg = testRegistry();
    state = life(reg);
    state.people = {};
  });

  it('moves every living parent at one decimal place, not to the nearest whole', () => {
    const mum = addPerson(state, kin({ kind: 'mother', name: 'Isa Moreno', age: 50, rel: 62.5 }));
    const dad = addPerson(
      state,
      kin({ kind: 'father', name: 'Leo Moreno', age: 52, gender: 'male', rel: 99.8 })
    );
    const gone = addPerson(
      state,
      kin({ kind: 'mother', name: 'Step Mum', age: 60, rel: 10, alive: false })
    );

    applyEffects(effectCtxOf(state, reg), [lib.parentsRel(1)]);

    expect(mum.rel).toBe(63.5);
    expect(dad.rel).toBe(100);
    expect(gone.rel).toBe(10);
  });

  it('lands a nudge on exactly the number an engine `rel` effect would', () => {
    const mine = addPerson(state, kin({ kind: 'mother', name: 'Isa Moreno', age: 50, rel: 62.44 }));
    const theirs = addPerson(state, kin({ kind: 'friend', name: 'Nell Ray', age: 30, rel: 62.44 }));

    applyEffects(effectCtxOf(state, reg), [
      lib.parentsRel(1.06),
      { kind: 'rel', who: theirs.id, delta: 1.06 },
    ]);

    // One clamp: a content copy rounding to whole numbers would say 64 here.
    expect(mine.rel).toBe(63.5);
    expect(theirs.rel).toBe(mine.rel);
  });

  it('moves the first living sibling and no-ops when there is none', () => {
    applyEffects(effectCtxOf(state, reg), [lib.siblingRel(5)]);

    const sib = addPerson(state, kin({ kind: 'sibling', name: 'Rui Moreno', age: 15, rel: 62.5 }));
    applyEffects(effectCtxOf(state, reg), [lib.siblingRel(1)]);

    expect(sib.rel).toBe(63.5);
  });

  it('moves whoever a picker finds when the effect lands, not when it was built', () => {
    const effect = lib.relWith(lib.spouseOf, 4);
    applyEffects(effectCtxOf(state, reg), [effect]);

    const spouse = addPerson(state, kin({ kind: 'spouse', name: 'Sam Reid', age: 31, rel: 50 }));
    applyEffects(effectCtxOf(state, reg), [effect]);

    expect(spouse.rel).toBe(54);
  });

  it('addresses one person by id, and never through the prototype', () => {
    const friend = addPerson(state, kin({ kind: 'friend', name: 'Nell Ray', age: 30 }));
    let touched = 0;

    applyEffects(effectCtxOf(state, reg), [
      lib.withPerson(friend.id, (person) => {
        person.rel = 12;
        touched += 1;
      }),
      lib.withPerson('__proto__', () => {
        touched += 1;
      }),
      lib.withPerson('p404', () => {
        touched += 1;
      }),
    ]);

    expect(friend.rel).toBe(12);
    expect(touched).toBe(1);
  });
});

describe('content lib — name rolling', () => {
  let reg: ContentRegistry;
  let state: GameState;

  beforeEach(() => {
    reg = testRegistry();
    state = life(reg);
  });

  it('finds the pool for the character country and nothing for a missing one', () => {
    expect(lib.poolFor(effectCtxOf(state, reg))).toEqual(POOL);

    state.character.countryId = 'nowhere';
    expect(lib.poolFor(effectCtxOf(state, reg))).toBeUndefined();
  });

  it('rolls one name from the pool and falls back without spending a draw', () => {
    const ctx = effectCtxOf(state, reg);

    const before = state.rngState;
    const first = lib.rollFirstName(ctx, 'female');
    expect(POOL.female).toContain(first);
    expect(drawsSpent(before, state.rngState)).toBe(1);

    const last = lib.rollLastName(ctx);
    expect(POOL.last).toContain(last);

    state.character.countryId = 'nowhere';
    const empty = effectCtxOf(state, reg);
    const noPool = state.rngState;
    expect(lib.rollFirstName(empty, 'female')).toBe('Riley');
    expect(lib.rollFirstName(empty, 'male')).toBe('Alex');
    expect(lib.rollLastName(empty)).toBe('Moreno');
    expect(drawsSpent(noPool, state.rngState)).toBe(0);
  });

  it('drops a name already spoken for without spending an extra draw', () => {
    const ctx = effectCtxOf(state, reg);

    const before = state.rngState;
    const twin = lib.rollFirstName(ctx, 'female', 'Cala');
    expect(twin).toBe('Dee');
    expect(drawsSpent(before, state.rngState)).toBe(1);

    // A name the pool never held filters nothing out.
    const untouched = state.rngState;
    expect(POOL.female).toContain(lib.rollFirstName(ctx, 'female', 'Zola'));
    expect(drawsSpent(untouched, state.rngState)).toBe(1);
  });

  it('rolls a full name as exactly two draws, given name first', () => {
    const ctx = effectCtxOf(state, reg);

    const before = state.rngState;
    const full = lib.rollName(ctx, 'male');
    expect(drawsSpent(before, state.rngState)).toBe(2);

    const [given, family] = full.split(' ');
    expect(POOL.male).toContain(given);
    expect(POOL.last).toContain(family);

    // Same two picks, in the same order, off a replay of the same cursor.
    const probe = { rngState: before };
    const replay = createRng(probe);
    expect(`${replay.pick(POOL.male)} ${replay.pick(POOL.last)}`).toBe(full);
  });

  it('falls back to a stock full name and spends nothing when no pool is loaded', () => {
    state.character.countryId = 'nowhere';
    const ctx = effectCtxOf(state, reg);

    const before = state.rngState;
    // Deliberately not `rollFirstName` + `rollLastName`: this one ignores the
    // character's own surname, which is what the schoolfriend packs want.
    expect(lib.rollName(ctx, 'female')).toBe('Alex Doe');
    expect(drawsSpent(before, state.rngState)).toBe(0);
  });

  it('rolls only the two genders a generated person can be', () => {
    expect([...lib.ROLLED_GENDERS]).toEqual(['male', 'female']);
  });
});
