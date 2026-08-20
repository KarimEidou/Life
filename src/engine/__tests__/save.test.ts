import { describe, expect, it } from 'vitest';
import { ageUp } from '@/engine/ageUp';
import { buildRegistry } from '@/engine/registry';
import { initialRngState } from '@/engine/rng';
import {
  SLOT_COUNT,
  browserStorage,
  deleteSave,
  listSlots,
  loadGame,
  loadSettings,
  loadUnlockedAchievements,
  memoryStorage,
  migrate,
  migrations,
  saveGame,
  saveSettings,
  saveUnlockedAchievements,
  slotKey,
  tableKey,
} from '@/engine/save';
import type { StorageAdapter } from '@/engine/save';
import { SAVE_VERSION } from '@/types';
import type { GameState } from '@/types';

/* Built by hand rather than through `createLife`, which depends on the rng
   module another agent still owns. */
function fixture(firstName: string, extra: Partial<GameState> = {}): GameState {
  const state: GameState = {
    rngState: 987654321,
    seed: 42,
    generation: 2,
    year: 2031,
    character: {
      id: 'me',
      firstName,
      lastName: 'Byron',
      gender: 'female',
      pronouns: { sub: 'she', obj: 'her', pos: 'her' },
      countryId: 'us',
      age: 34,
      stats: { health: 80, happiness: 61, smarts: 77, looks: 40 },
      money: 12500,
      education: {
        level: 'university',
        major: 'Computer Science',
        year: 0,
        gpa: 3.4,
        studyHard: false,
      },
      job: {
        jobId: 'job.dev',
        title: 'Software Engineer',
        salary: 90000,
        years: 3,
        performance: 66,
        workHard: true,
      },
      prison: null,
      assets: [
        { id: 'a1', defId: 'asset.condo', label: 'Condo', paid: 200000, value: 215000, yearBought: 2029 },
      ],
      loans: [{ id: 'l1', kind: 'mortgage', principal: 150000, apr: 0.06, assetId: 'a1' }],
      investments: { savings: 4000, index: 9000, crypto: 0 },
      illnesses: [{ defId: 'ill.flu', years: 1, treated: true }],
      addictions: { alcohol: 12 },
      fame: 3,
      flags: { livesWithParents: false, nextPersonId: 3, jobsHeld: 2, countryLabel: 'the United States' },
    },
    people: {
      p1: {
        id: 'p1',
        kind: 'mother',
        name: 'Mary Byron',
        gender: 'female',
        age: 61,
        alive: true,
        rel: 82,
        flags: {},
      },
      p2: {
        id: 'p2',
        kind: 'spouse',
        name: 'Kit Lowe',
        gender: 'male',
        age: 35,
        alive: true,
        rel: 74,
        stats: { looks: 55 },
        occupation: 'Nurse',
        flags: { metAtWork: true },
      },
    },
    log: [{ age: 34, year: 2031, entries: [{ icon: '💼', kind: 'money', text: 'You got a raise.' }] }],
    pending: [],
    firedEvents: ['ev.first-kiss'],
    interactionUse: { 'act.gym': 33 },
    ancestors: [{ name: 'Ada Byron', years: '1970-2029', cause: 'old age' }],
    phase: 'alive',
  };
  return { ...state, ...extra };
}

function readRaw(storage: StorageAdapter, slot: number): Record<string, unknown> {
  const raw = storage.getItem(`ol.save.${slot}`);
  if (raw === null) {
    throw new Error(`slot ${slot} is empty`);
  }
  return JSON.parse(raw) as Record<string, unknown>;
}

function loadedState(storage: StorageAdapter, slot: number): GameState {
  const res = loadGame(storage, slot);
  if (!res.ok) {
    throw new Error(`expected slot ${slot} to load, got ${res.reason}`);
  }
  return res.state;
}

/** The fixture as it comes back out of storage: plain JSON, free to damage. */
function drifted(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(fixture('Ada'))) as Record<string, unknown>;
}

/** Stores `state` in slot 1 under an envelope this build accepts. */
function write(storage: StorageAdapter, state: unknown): void {
  const envelope = { version: SAVE_VERSION, savedAt: 1, slot: 1, state };
  storage.setItem('ol.save.1', JSON.stringify(envelope));
}

/** Resolves a dotted path to the record holding its last segment. */
function at(
  host: Record<string, unknown>,
  path: string
): { parent: Record<string, unknown>; key: string } {
  const parts = path.split('.');
  let parent = host;
  for (const part of parts.slice(0, -1)) {
    parent = parent[part] as Record<string, unknown>;
  }
  return { parent, key: parts[parts.length - 1] };
}

describe('saveGame / loadGame', () => {
  it('round-trips a state unchanged', () => {
    const storage = memoryStorage();
    const state = fixture('Ada');
    saveGame(storage, 1, state);
    expect(loadedState(storage, 1)).toEqual(state);
  });

  it('writes a versioned envelope under the slot key', () => {
    const storage = memoryStorage();
    const before = Date.now();
    saveGame(storage, 3, fixture('Ada'));
    const env = readRaw(storage, 3);
    expect(env.version).toBe(SAVE_VERSION);
    expect(env.slot).toBe(3);
    expect(typeof env.savedAt).toBe('number');
    expect(Number(env.savedAt)).toBeGreaterThanOrEqual(before);
    expect(Number(env.savedAt)).toBeLessThanOrEqual(Date.now());
  });

  it('keeps slots isolated', () => {
    const storage = memoryStorage();
    saveGame(storage, 1, fixture('Ada'));
    saveGame(storage, 2, fixture('Grace'));
    expect(loadedState(storage, 1).character.firstName).toBe('Ada');
    expect(loadedState(storage, 2).character.firstName).toBe('Grace');
    expect(loadGame(storage, 4)).toEqual({ ok: false, reason: 'empty' });
  });

  it('reports an unwritten slot as empty', () => {
    const storage = memoryStorage();
    expect(loadGame(storage, 1)).toEqual({ ok: false, reason: 'empty' });
    storage.setItem('ol.save.2', '');
    expect(loadGame(storage, 2)).toEqual({ ok: false, reason: 'empty' });
  });

  it('reports unparseable JSON as corrupt', () => {
    const storage = memoryStorage();
    storage.setItem('ol.save.1', '{"version":1,"state":');
    expect(loadGame(storage, 1)).toEqual({ ok: false, reason: 'corrupt' });
  });

  it('reports structurally invalid envelopes as corrupt', () => {
    const storage = memoryStorage();
    storage.setItem('ol.save.1', JSON.stringify({ version: '1', savedAt: 0, slot: 1, state: {} }));
    storage.setItem('ol.save.2', JSON.stringify({ version: SAVE_VERSION, state: { year: 2031 } }));
    storage.setItem('ol.save.3', JSON.stringify([1, 2, 3]));
    expect(loadGame(storage, 1)).toEqual({ ok: false, reason: 'corrupt' });
    expect(loadGame(storage, 2)).toEqual({ ok: false, reason: 'corrupt' });
    expect(loadGame(storage, 3)).toEqual({ ok: false, reason: 'corrupt' });
  });

  it('refuses saves written by a newer build', () => {
    const storage = memoryStorage();
    saveGame(storage, 1, fixture('Ada'));
    const env = readRaw(storage, 1);
    env.version = SAVE_VERSION + 1;
    storage.setItem('ol.save.1', JSON.stringify(env));
    expect(loadGame(storage, 1)).toEqual({ ok: false, reason: 'future' });
  });

  it('reports a newer save as future even when its state shape differs', () => {
    /* A newer build is exactly where `GameState` may have been reshaped, so the
       version gate has to win over the shape check — `corrupt` would invite the
       player to delete a perfectly good save instead of updating the game. */
    const storage = memoryStorage();
    const newer = SAVE_VERSION + 98;
    storage.setItem(
      'ol.save.1',
      JSON.stringify({ version: newer, savedAt: 1, slot: 1, state: { hero: {} } })
    );
    storage.setItem('ol.save.2', JSON.stringify({ version: newer, savedAt: 1, slot: 2, state: 7 }));
    storage.setItem('ol.save.3', JSON.stringify({ version: newer, savedAt: 1, slot: 3 }));
    expect(loadGame(storage, 1)).toEqual({ ok: false, reason: 'future' });
    expect(loadGame(storage, 2)).toEqual({ ok: false, reason: 'future' });
    expect(loadGame(storage, 3)).toEqual({ ok: false, reason: 'future' });
  });

  it('reports a save whose character is an empty object as corrupt', () => {
    /* `loadGame` is the only validation boundary for this data and nothing above
       the screens catches a render throw, so an `ok` verdict here is a blank app
       the player can only escape by deleting the slot: the header reads
       `character.job.title` the moment `job` is anything but exactly `null`. */
    const storage = memoryStorage();
    storage.setItem(
      'ol.save.1',
      JSON.stringify({
        version: SAVE_VERSION,
        savedAt: 0,
        slot: 1,
        state: { character: { firstName: 'Ada', lastName: 'Byron', age: 30, money: 0 } },
      })
    );
    expect(loadGame(storage, 1)).toEqual({ ok: false, reason: 'corrupt' });
  });

  it('refuses a payload that is not a character at all', () => {
    /* The reject set is deliberately tiny: a name, an age, and the records the
       repair pass fills in key by key. Everything on it is a field where
       inventing a value would hand the player a character they never played,
       and a refusal costs them the whole life — the load menu answers `corrupt`
       with a Delete button. */
    const storage = memoryStorage();

    // The intact fixture has to pass, or every case below succeeds vacuously.
    write(storage, drifted());
    expect(loadGame(storage, 1).ok).toBe(true);

    const state = drifted();
    delete state.character;
    write(storage, state);
    expect(loadGame(storage, 1), 'state.character').toEqual({ ok: false, reason: 'corrupt' });

    for (const key of ['stats', 'education', 'investments', 'flags', 'pronouns']) {
      const damaged = drifted();
      delete (damaged.character as Record<string, unknown>)[key];
      write(storage, damaged);
      expect(loadGame(storage, 1), `character.${key}`).toEqual({ ok: false, reason: 'corrupt' });
    }

    for (const [key, value] of [
      ['firstName', 7],
      ['lastName', null],
      ['age', 'thirty'],
      ['age', null],
    ] as const) {
      const damaged = drifted();
      (damaged.character as Record<string, unknown>)[key] = value;
      write(storage, damaged);
      expect(loadGame(storage, 1), `character.${key}`).toEqual({ ok: false, reason: 'corrupt' });
    }
  });

  it('repairs the fields a life can resume from instead of refusing the save', () => {
    /* The likely damage is not "this is not a save" but a save one field short —
       a write truncated by a quota error, a hand-edited entry, a slot written by
       a build that carried a field this one dropped. Every replacement below is
       a value `createLife` already starts a life at, so resuming from one costs
       a number rather than the life. */
    const storage = memoryStorage();
    const cases: { path: string; expected: unknown }[] = [
      { path: 'character.money', expected: 0 },
      { path: 'character.fame', expected: 0 },
      { path: 'character.stats.health', expected: 50 },
      { path: 'character.stats.happiness', expected: 50 },
      { path: 'character.stats.smarts', expected: 50 },
      { path: 'character.stats.looks', expected: 50 },
      { path: 'character.assets', expected: [] },
      { path: 'character.loans', expected: [] },
      { path: 'character.illnesses', expected: [] },
      { path: 'character.addictions', expected: {} },
      { path: 'character.job', expected: null },
      { path: 'character.prison', expected: null },
      { path: 'character.education.level', expected: 'none' },
      { path: 'character.education.year', expected: 0 },
      { path: 'character.education.gpa', expected: 0 },
      { path: 'character.investments.savings', expected: 0 },
      { path: 'character.investments.index', expected: 0 },
      { path: 'character.investments.crypto', expected: 0 },
      { path: 'people', expected: {} },
      { path: 'interactionUse', expected: {} },
      { path: 'log', expected: [] },
      { path: 'pending', expected: [] },
      { path: 'firedEvents', expected: [] },
      { path: 'ancestors', expected: [] },
      { path: 'phase', expected: 'alive' },
      { path: 'seed', expected: 0 },
      { path: 'rngState', expected: initialRngState(42) },
      { path: 'generation', expected: 1 },
      { path: 'year', expected: 2025 },
    ];

    for (const { path, expected } of cases) {
      for (const damage of ['delete', 'wrong type'] as const) {
        const state = drifted();
        const { parent, key } = at(state, path);
        if (damage === 'delete') {
          delete parent[key];
        } else {
          parent[key] = 'nope';
        }
        write(storage, state);

        const res = loadGame(storage, 1);
        expect(res.ok, `${path} (${damage})`).toBe(true);
        if (!res.ok) {
          continue;
        }
        // Exactly one field named: a repair may not cascade into its neighbours.
        expect(res.repairs, `${path} (${damage})`).toEqual([path]);
        const { parent: got, key: field } = at(
          res.state as unknown as Record<string, unknown>,
          path
        );
        expect(got[field], `${path} (${damage})`).toEqual(expected);
      }
    }
  });

  it('keeps a finished life finished and a legitimately absent field absent', () => {
    /* Only an *unrecognised* phase is rewritten: resurrecting `dead` would deny
       the player their death screen and their heir. `death` is the mirror case —
       a living character has none, so absence must not read as damage. */
    const storage = memoryStorage();
    write(storage, drifted());
    const clean = loadGame(storage, 1);
    expect(clean.ok && clean.repairs).toBeUndefined();

    const dead = drifted();
    dead.phase = 'dead';
    dead.death = { cause: 'old age', age: 80, obituary: 'Gone.', epitaphStats: {} };
    write(storage, dead);
    const res = loadGame(storage, 1);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.repairs).toBeUndefined();
      expect(res.state.phase).toBe('dead');
      expect(res.state.death?.cause).toBe('old age');
    }

    const damaged = drifted();
    damaged.death = 'gone';
    write(storage, damaged);
    const dropped = loadGame(storage, 1);
    expect(dropped.ok).toBe(true);
    if (dropped.ok) {
      expect(dropped.repairs).toEqual(['death']);
      expect('death' in (dropped.state as unknown as Record<string, unknown>)).toBe(false);
    }
  });

  it('heals a balance JSON could not carry', () => {
    /* JSON has no NaN or Infinity: a poisoned balance comes back as `null`,
       which `typeof` reads as an object and every affordability gate reads as
       `false` — a wallet that can never buy anything again. */
    const storage = memoryStorage();
    const state = drifted();
    // What `JSON.stringify` writes for `NaN` and `Infinity` alike.
    (state.character as Record<string, unknown>).money = null;
    write(storage, state);

    const res = loadGame(storage, 1);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.character.money).toBe(0);
      expect(res.repairs).toEqual(['character.money']);
    }
  });

  it('hands the engine a state it can go on playing', () => {
    /* The assertion that justifies repairing at all: the containers the year
       loop walks unguarded — `state.log`, `state.people`, `state.pending` — are
       all there again, so the load no longer reports success and then throws one
       interaction later with no way back to the slot list. */
    const storage = memoryStorage();
    const state = drifted();
    delete state.log;
    delete state.people;
    delete state.pending;
    write(storage, state);

    const res = loadGame(storage, 1);
    expect(res.ok).toBe(true);
    if (!res.ok) {
      return;
    }
    expect(res.repairs).toEqual(['people', 'log', 'pending']);

    const reg = buildRegistry([]);
    const resumed = res.state;
    expect(() => {
      ageUp(resumed, reg);
      ageUp(resumed, reg);
    }).not.toThrow();
    expect(resumed.log.length).toBeGreaterThan(0);
  });

  it('leaves a healthy save exactly as it was written', () => {
    const storage = memoryStorage();
    const state = fixture('Ada');
    saveGame(storage, 1, state);
    const res = loadGame(storage, 1);
    expect(res.ok).toBe(true);
    if (res.ok) {
      // Absent rather than empty, so "recovered" is a presence check.
      expect('repairs' in res).toBe(false);
      expect(res.state).toEqual(state);
    }

    // `job` and `prison` are legitimately null, never a repair.
    saveGame(storage, 2, fixture('Ada', { character: { ...state.character, job: null } }));
    const nulls = loadGame(storage, 2);
    expect(nulls.ok && nulls.repairs).toBeUndefined();
    expect(nulls.ok && nulls.state.character.job).toBeNull();
  });

  it('still reports a same-or-older save with a bad shape as corrupt', () => {
    const storage = memoryStorage();
    storage.setItem(
      'ol.save.1',
      JSON.stringify({ version: SAVE_VERSION, savedAt: 1, slot: 1, state: { hero: {} } })
    );
    storage.setItem(
      'ol.save.2',
      JSON.stringify({ version: SAVE_VERSION - 1, savedAt: 1, slot: 2, state: { hero: {} } })
    );
    expect(loadGame(storage, 1)).toEqual({ ok: false, reason: 'corrupt' });
    expect(loadGame(storage, 2)).toEqual({ ok: false, reason: 'corrupt' });
  });
});

describe('migrations', () => {
  it('upgrades an older save through the registered chain', () => {
    const storage = memoryStorage();
    const modern = fixture('Ada');
    const legacy: Record<string, unknown> = { ...modern };
    delete legacy.log;
    legacy.entries = modern.log;
    storage.setItem(
      'ol.save.1',
      JSON.stringify({ version: SAVE_VERSION - 1, savedAt: 1, slot: 1, state: legacy })
    );

    migrations[SAVE_VERSION] = (old: unknown): unknown => {
      const { entries, ...rest } = old as Record<string, unknown>;
      return { ...rest, log: entries };
    };

    try {
      const state = loadedState(storage, 1);
      expect(state).toEqual(modern);
      expect('entries' in (state as unknown as Record<string, unknown>)).toBe(false);
    } finally {
      delete migrations[SAVE_VERSION];
    }

    // Without a step for the gap the save is unreadable rather than half-migrated.
    expect(loadGame(storage, 1)).toEqual({ ok: false, reason: 'corrupt' });
  });

  it('runs the chain before the shape gate, so a step can create `character`', () => {
    /* The gate used to run first, which put the one reshape a migration most
       plausibly has to perform — introducing, renaming or moving a top-level
       key — out of reach: the save was reported `corrupt`, and the player
       offered Delete, before the step that repairs it ever ran. */
    const storage = memoryStorage();
    const modern = fixture('Ada');
    const legacy: Record<string, unknown> = { ...modern };
    delete legacy.character;
    legacy.hero = modern.character;
    storage.setItem(
      'ol.save.1',
      JSON.stringify({ version: SAVE_VERSION - 1, savedAt: 1, slot: 1, state: legacy })
    );

    migrations[SAVE_VERSION] = (old: unknown): unknown => {
      const { hero, ...rest } = old as Record<string, unknown>;
      return { ...rest, character: hero };
    };

    try {
      const state = loadedState(storage, 1);
      expect(state).toEqual(modern);
      expect('hero' in (state as unknown as Record<string, unknown>)).toBe(false);
    } finally {
      delete migrations[SAVE_VERSION];
    }
  });

  it('shape-gates what the chain produced, not what was stored', () => {
    /* The other half of moving the gate behind the chain: a step that *breaks* a
       shape must not ride that move into an `ok` verdict, which would hand the
       screens a payload no boundary ever checked. */
    const storage = memoryStorage();
    storage.setItem(
      'ol.save.1',
      JSON.stringify({ version: SAVE_VERSION - 1, savedAt: 1, slot: 1, state: fixture('Ada') })
    );

    migrations[SAVE_VERSION] = (old: unknown): unknown => {
      const next = { ...(old as Record<string, unknown>) };
      const character = { ...(next.character as Record<string, unknown>) };
      delete character.stats;
      next.character = character;
      return next;
    };

    try {
      expect(loadGame(storage, 1)).toEqual({ ok: false, reason: 'corrupt' });
    } finally {
      delete migrations[SAVE_VERSION];
    }
  });

  it('repairs what the chain produced as well, and names what it filled in', () => {
    /* The repair half of the same rule: a step that drops a container the engine
       can resume from must leave the save playable rather than deletable, and
       must still name what it filled in, so an unfinished migration reads as a
       recovered save rather than a clean one. */
    const storage = memoryStorage();
    storage.setItem(
      'ol.save.1',
      JSON.stringify({ version: SAVE_VERSION - 1, savedAt: 1, slot: 1, state: fixture('Ada') })
    );

    migrations[SAVE_VERSION] = (old: unknown): unknown => {
      const next = { ...(old as Record<string, unknown>) };
      delete next.people;
      return next;
    };

    try {
      const res = loadGame(storage, 1);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.repairs).toEqual(['people']);
        expect(res.state.people).toEqual({});
      }
    } finally {
      delete migrations[SAVE_VERSION];
    }
  });

  it('walks a two-step chain in order, running each step exactly once', () => {
    /* `SAVE_VERSION` is 1 and `migrations` is empty, so nothing in shipped play
       has ever made more than the zero hops a current save makes. The versions
       below are faked because `SAVE_VERSION` is a `const` a test cannot bump:
       what is rehearsed here is the walk, not the number. */
    const storage = memoryStorage();
    const modern = fixture('Ada');
    const ancient: Record<string, unknown> = { ...modern };
    delete ancient.log;
    delete ancient.character;
    ancient.entries = modern.log;
    ancient.hero = modern.character;
    storage.setItem(
      'ol.save.1',
      JSON.stringify({ version: SAVE_VERSION - 2, savedAt: 1, slot: 1, state: ancient })
    );

    const handedOver: Record<string, unknown>[] = [];
    migrations[SAVE_VERSION - 1] = (old: unknown): unknown => {
      const rec = old as Record<string, unknown>;
      handedOver.push(rec);
      const { entries, ...rest } = rec;
      return { ...rest, log: entries };
    };
    migrations[SAVE_VERSION] = (old: unknown): unknown => {
      const rec = old as Record<string, unknown>;
      handedOver.push(rec);
      const { hero, ...rest } = rec;
      return { ...rest, character: hero };
    };

    try {
      expect(loadedState(storage, 1)).toEqual(modern);
      // One hop each, oldest first: the first step read the stored payload...
      expect(handedOver).toHaveLength(2);
      expect(handedOver[0].entries).toEqual(modern.log);
      // ...and the second read what the first returned, not what was stored.
      expect(handedOver[1].log).toEqual(modern.log);
      expect('entries' in handedOver[1]).toBe(false);
      /* Between the two steps the state is no life at all: the shape gate runs
         once, after the last step, so a step may hand the next one a payload
         with `character` still missing. */
      expect('character' in handedOver[1]).toBe(false);
    } finally {
      delete migrations[SAVE_VERSION - 1];
      delete migrations[SAVE_VERSION];
    }
  });

  it('drives the chain without going through storage', () => {
    /* The seam the rehearsals lean on: `SAVE_VERSION` is a `const`, so the only
       way to exercise an upgrade is to hand `migrate` a version directly. */
    const current = fixture('Ada');
    // Nothing to walk: a save already at this version is handed straight back.
    expect(migrate(current, SAVE_VERSION)?.state).toBe(current);

    migrations[SAVE_VERSION] = (old: unknown): unknown => ({
      ...(old as Record<string, unknown>),
      year: 2099,
    });
    try {
      expect(migrate({ year: 2031 }, SAVE_VERSION - 1)?.state).toEqual({ year: 2099 });
      /* A gap two hops down: the walk stops at the first missing step instead of
         skipping it, so the save is refused rather than half-migrated. */
      expect(migrate({ year: 2031 }, SAVE_VERSION - 2)).toBeNull();
    } finally {
      delete migrations[SAVE_VERSION];
    }
  });

  it('has a step for every version gap it will ever have to cross', () => {
    /* Vacuous while `SAVE_VERSION` is 1 and live from 2 onward, which is exactly
       when it is needed: the mistake it catches is bumping the version and
       shipping without the step, which turns every existing player's save into
       `corrupt` — a verdict the load menu offers next to a Delete button. */
    for (let from = 1; from < SAVE_VERSION; from += 1) {
      expect(migrations[from + 1], `missing migration to version ${String(from + 1)}`).toBeTypeOf(
        'function'
      );
    }
    // Asked the way the loader asks it: the oldest save this build can meet arrives.
    expect(migrate(fixture('Ada'), 1)).not.toBeNull();
  });

  it('registers every step under the version it upgrades to', () => {
    /* The same mistake spelled the other way round: a step keyed by the version
       it upgrades *from* is never looked up, so the save it was written for
       reports `corrupt` with its own fix sitting in the file. Nothing upgrades
       *to* version 1 — there is no version 0 to come from — and nothing above
       `SAVE_VERSION` is ever reached. */
    for (const key of Object.keys(migrations)) {
      const to = Number(key);
      expect(Number.isInteger(to), `migrations[${key}] is not keyed by a version`).toBe(true);
      expect(to >= 2 && to <= SAVE_VERSION, `migrations[${key}] is never reached`).toBe(true);
    }
  });
});

/* The persistence contract, asserted rather than described: four `ol.*` keys,
   all of them named here. The sidecar is the store's to read and write — its
   payload is a content type — but a key this module cannot name is a key it
   cannot erase. */
describe('storage keys', () => {
  it('writes each of the four under its documented name', () => {
    const storage = memoryStorage();
    expect(slotKey(3)).toBe('ol.save.3');
    expect(tableKey(3)).toBe('ol.table.3');

    saveGame(storage, 3, fixture('Ada'));
    expect(storage.getItem('ol.save.3')).not.toBeNull();
    saveUnlockedAchievements(storage, ['ach.rich']);
    expect(storage.getItem('ol.achievements')).not.toBeNull();
    saveSettings(storage, { theme: 'dark', reduceMotion: true });
    expect(storage.getItem('ol.settings')).not.toBeNull();
  });
});

describe('deleteSave', () => {
  it('clears one slot and leaves the others alone', () => {
    const storage = memoryStorage();
    saveGame(storage, 1, fixture('Ada'));
    saveGame(storage, 2, fixture('Grace'));
    deleteSave(storage, 1);
    expect(loadGame(storage, 1)).toEqual({ ok: false, reason: 'empty' });
    expect(loadedState(storage, 2).character.firstName).toBe('Grace');
  });

  it("erases the slot's blackjack sidecar along with the save", () => {
    const storage = memoryStorage();
    saveGame(storage, 1, fixture('Ada'));
    saveGame(storage, 2, fixture('Grace'));
    /* An unfinished hand, as the store parks one: the stake behind it is
       charged in the save beside it, so a sidecar that outlives that save is
       restored on top of whatever life the slot holds next. */
    storage.setItem(tableKey(1), '{"bet":50,"done":false}');
    storage.setItem(tableKey(2), '{"bet":10,"done":false}');

    deleteSave(storage, 1);

    expect(storage.getItem(tableKey(1))).toBeNull();
    // One slot's worth of state, not the sidecar shelf.
    expect(storage.getItem(tableKey(2))).toBe('{"bet":10,"done":false}');
    expect(loadedState(storage, 2).character.firstName).toBe('Grace');
  });
});

describe('listSlots', () => {
  it('always returns one row per slot', () => {
    const slots = listSlots(memoryStorage());
    expect(slots).toHaveLength(SLOT_COUNT);
    expect(slots.every((s) => s.empty)).toBe(true);
    expect(new Set(slots.map((s) => s.slot)).size).toBe(SLOT_COUNT);
  });

  it('summarises a written slot', () => {
    const storage = memoryStorage();
    const state = fixture('Ada');
    const target = listSlots(storage)[0].slot;
    saveGame(storage, target, state);

    const summary = listSlots(storage).find((s) => s.slot === target);
    expect(summary).toBeDefined();
    expect(summary?.empty).toBe(false);
    expect(summary?.name).toBe('Ada Byron');
    expect(summary?.age).toBe(34);
    expect(summary?.money).toBe(12500);
    expect(summary?.generation).toBe(2);
    expect(summary?.dead).toBe(false);
    expect(typeof summary?.savedAt).toBe('number');
    // A slot this build opens carries no warning at all, not a false one.
    expect(summary?.unreadable).toBeUndefined();
  });

  it('marks a finished life as dead', () => {
    const storage = memoryStorage();
    const target = listSlots(storage)[0].slot;
    saveGame(storage, target, fixture('Ada', { phase: 'dead' }));
    expect(listSlots(storage).find((s) => s.slot === target)?.dead).toBe(true);
  });

  it('keeps a slot from a newer build occupied even when its state shape differs', () => {
    /* An empty row is offered straight to the create screen, which overwrites the
       slot without a confirmation, so every envelope `loadGame` answers `future`
       for has to stay occupied whether this build can shape-check it or not. */
    const storage = memoryStorage();
    const newer = SAVE_VERSION + 98;
    storage.setItem(
      'ol.save.1',
      JSON.stringify({ version: newer, savedAt: 1, slot: 1, state: { hero: {} } })
    );
    storage.setItem('ol.save.2', JSON.stringify({ version: newer, savedAt: 2, slot: 2, state: 7 }));
    storage.setItem('ol.save.3', JSON.stringify({ version: newer, savedAt: 3, slot: 3 }));

    const slots = listSlots(storage);
    for (const slot of [1, 2, 3]) {
      expect(loadGame(storage, slot)).toEqual({ ok: false, reason: 'future' });
      /* Flagged, not merely occupied: an unlabelled row that reads like any
         other save is the one the player replaces without meaning to. */
      expect(slots.find((s) => s.slot === slot)).toEqual({
        slot,
        empty: false,
        savedAt: slot,
        unreadable: 'future',
      });
    }
  });

  it('still summarises a newer save whose shape this build can read', () => {
    const storage = memoryStorage();
    saveGame(storage, 1, fixture('Ada'));
    const env = readRaw(storage, 1);
    env.version = SAVE_VERSION + 1;
    storage.setItem('ol.save.1', JSON.stringify(env));

    const summary = listSlots(storage).find((s) => s.slot === 1);
    expect(summary?.empty).toBe(false);
    /* The life keeps its details next to the warning: this save is healthy
       data an older build simply cannot open, and the row saying whose life it
       is is what keeps the warning from reading as "this one is gone". */
    expect(summary?.name).toBe('Ada Byron');
    expect(summary?.age).toBe(34);
    expect(summary?.unreadable).toBe('future');
  });

  it('reports no name at all when the stored character has none', () => {
    /* The load menu titles a row and its confirmation alert `name ?? 'Saved
       life'`, so an empty string would render both blank rather than falling
       back. */
    const storage = memoryStorage();
    const nameless = { firstName: 7, lastName: null };
    storage.setItem(
      'ol.save.1',
      JSON.stringify({ version: SAVE_VERSION, savedAt: 1, slot: 1, state: { character: nameless } })
    );
    storage.setItem(
      'ol.save.2',
      JSON.stringify({
        version: SAVE_VERSION,
        savedAt: 2,
        slot: 2,
        state: { character: { firstName: '  ', lastName: '' } },
      })
    );

    const slots = listSlots(storage);
    for (const slot of [1, 2]) {
      const summary = slots.find((s) => s.slot === slot);
      expect(summary?.empty).toBe(false);
      expect(summary?.name).toBeUndefined();
    }
  });

  it('trims a half-named character rather than padding it', () => {
    const storage = memoryStorage();
    storage.setItem(
      'ol.save.1',
      JSON.stringify({
        version: SAVE_VERSION,
        savedAt: 1,
        slot: 1,
        state: { character: { firstName: 'Ada' } },
      })
    );
    expect(listSlots(storage).find((s) => s.slot === 1)?.name).toBe('Ada');
  });

  it('keeps a slot it cannot read occupied instead of throwing or offering it', () => {
    /* `empty` has to mean what `loadGame` means by it — nothing is stored —
       because the load menu hands an empty row straight to the create screen,
       which overwrites the slot with no confirmation and no undo. Every payload
       below is one `loadGame` calls `corrupt`: data that is there, however
       damaged, and the player's to delete rather than the game's to discard. */
    const storage = memoryStorage();
    const target = listSlots(storage)[0].slot;
    const key = `ol.save.${String(target)}`;
    const payloads = [
      'not json at all',
      '{"version":1,"state":',
      'null',
      JSON.stringify([1, 2, 3]),
      JSON.stringify({ version: SAVE_VERSION, savedAt: 5, slot: target, state: 7 }),
      JSON.stringify({ version: SAVE_VERSION, savedAt: 5, slot: target, state: { hero: {} } }),
      JSON.stringify({ version: SAVE_VERSION, savedAt: 5, slot: target }),
    ];

    for (const raw of payloads) {
      storage.setItem(key, raw);
      expect(loadGame(storage, target), raw).toEqual({ ok: false, reason: 'corrupt' });
      const summary = listSlots(storage).find((s) => s.slot === target);
      expect(summary?.empty, raw).toBe(false);
      /* Occupied answers "do not overwrite this"; `damaged` answers "and here
         is why", so the row can say so instead of posing as a save the menu
         merely knows nothing about. Every payload here is one `loadGame` has
         already refused above, so the flag promises nothing it cannot keep. */
      expect(summary?.unreadable, raw).toBe('damaged');
      /* Nothing was read out of the payload, so the row has no life to describe:
         the load menu reads the missing details as "could not be read" rather
         than captioning the slot `Age 0 · Gen 1 · $0`. */
      expect(summary?.name, raw).toBeUndefined();
      expect(summary?.age, raw).toBeUndefined();
      expect(summary?.generation, raw).toBeUndefined();
    }

    // Only a slot nothing was ever written to is free to start a life in.
    storage.setItem(key, '');
    expect(listSlots(storage).find((s) => s.slot === target)?.empty).toBe(true);
    deleteSave(storage, target);
    expect(listSlots(storage).find((s) => s.slot === target)?.empty).toBe(true);
  });

  it('never offers a slot only a migration can read as empty', () => {
    /* The expensive half of that disagreement: `loadGame` runs the migration
       chain before the shape gate, so a legacy envelope can be perfectly
       loadable while the shallow summary finds no `character` at all. Reported
       empty, one tap on the row starts a new life over a healthy save. */
    const storage = memoryStorage();
    const modern = fixture('Ada');
    const legacy: Record<string, unknown> = { ...modern };
    delete legacy.character;
    legacy.hero = modern.character;
    storage.setItem(
      'ol.save.1',
      JSON.stringify({ version: SAVE_VERSION - 1, savedAt: 9, slot: 1, state: legacy })
    );

    migrations[SAVE_VERSION] = (old: unknown): unknown => {
      const { hero, ...rest } = old as Record<string, unknown>;
      return { ...rest, character: hero };
    };

    try {
      expect(loadGame(storage, 1).ok).toBe(true);
      /* Unflagged as well as occupied: the step registered above is exactly
         what the shallow read is missing, so calling this row damaged would
         accuse a save the chain loads fine. */
      expect(listSlots(storage).find((s) => s.slot === 1)).toEqual({
        slot: 1,
        empty: false,
        savedAt: 9,
      });
    } finally {
      delete migrations[SAVE_VERSION];
    }
  });

  it('flags a save the version stamp alone rules out', () => {
    /* The mirror of the case above, and the reason the flag reads the stamp
       before the payload: with no step to reach `SAVE_VERSION` — and with no
       stamp at all — `loadGame` refuses whatever the state turns out to hold,
       so the row can say so even though it read the life out fine. */
    const storage = memoryStorage();
    saveGame(storage, 1, fixture('Ada'));
    saveGame(storage, 2, fixture('Grace'));

    const legacy = readRaw(storage, 1);
    legacy.version = SAVE_VERSION - 1;
    storage.setItem('ol.save.1', JSON.stringify(legacy));
    const unstamped = readRaw(storage, 2);
    delete unstamped.version;
    storage.setItem('ol.save.2', JSON.stringify(unstamped));

    const slots = listSlots(storage);
    for (const [slot, name] of [
      [1, 'Ada Byron'],
      [2, 'Grace Byron'],
    ] as const) {
      expect(loadGame(storage, slot)).toEqual({ ok: false, reason: 'corrupt' });
      const summary = slots.find((s) => s.slot === slot);
      expect(summary?.empty, name).toBe(false);
      expect(summary?.name, name).toBe(name);
      expect(summary?.unreadable, name).toBe('damaged');
    }
  });

  it('flags exactly the current-version payloads the loader refuses', () => {
    /* The row and the load cannot be allowed to disagree: a warning on a save
       that opens fine trains the player to ignore it, and a clean row on one
       that does not is how a damaged save gets replaced. For an envelope no
       migration reshapes, this is the loader's own predicate answering. */
    const storage = memoryStorage();
    const healthy = fixture('Ada');
    const noStats = { ...healthy, character: { ...healthy.character } };
    delete (noStats.character as Partial<GameState['character']>).stats;
    const noLog = { ...healthy };
    delete (noLog as Partial<GameState>).log;
    const states: unknown[] = [healthy, noLog, noStats, { hero: {} }, 7, null];

    states.forEach((state, i) => {
      storage.setItem(
        'ol.save.1',
        JSON.stringify({ version: SAVE_VERSION, savedAt: 1, slot: 1, state })
      );
      const row = listSlots(storage).find((s) => s.slot === 1);
      expect(row?.unreadable === undefined, `state ${String(i)}`).toBe(loadGame(storage, 1).ok);
    });
  });

  it('leaves a save the loader repairs on its way in unflagged', () => {
    /* The flag means "`loadGame` will refuse this", not "something is off":
       damage the repair path absorbs must not cost the row its ordinary
       caption, or every recoverable save would wear a warning it outgrew. */
    const storage = memoryStorage();
    saveGame(storage, 1, fixture('Ada'));
    const env = readRaw(storage, 1);
    delete (env.state as Record<string, unknown>).log;
    storage.setItem('ol.save.1', JSON.stringify(env));

    expect(loadGame(storage, 1).ok).toBe(true);
    const summary = listSlots(storage).find((s) => s.slot === 1);
    expect(summary?.name).toBe('Ada Byron');
    expect(summary?.unreadable).toBeUndefined();
  });
});

describe('achievements', () => {
  it('round-trips unlocked ids', () => {
    const storage = memoryStorage();
    expect(loadUnlockedAchievements(storage)).toEqual([]);
    saveUnlockedAchievements(storage, ['ach.rich', 'ach.phd']);
    expect(loadUnlockedAchievements(storage)).toEqual(['ach.rich', 'ach.phd']);
    expect(storage.getItem('ol.achievements')).toBe('["ach.rich","ach.phd"]');
  });

  it('stores each id once', () => {
    const storage = memoryStorage();
    saveUnlockedAchievements(storage, ['ach.rich', 'ach.rich']);
    expect(loadUnlockedAchievements(storage)).toEqual(['ach.rich']);
  });

  it('tolerates corrupt or foreign data', () => {
    const storage = memoryStorage();
    storage.setItem('ol.achievements', '["ach.rich",');
    expect(loadUnlockedAchievements(storage)).toEqual([]);
    storage.setItem('ol.achievements', '{"ach.rich":true}');
    expect(loadUnlockedAchievements(storage)).toEqual([]);
    storage.setItem('ol.achievements', '["ach.rich",7,null]');
    expect(loadUnlockedAchievements(storage)).toEqual(['ach.rich']);
  });
});

describe('settings', () => {
  it('defaults when nothing is stored', () => {
    expect(loadSettings(memoryStorage())).toEqual({ theme: 'auto', reduceMotion: false });
  });

  it('round-trips preferences', () => {
    const storage = memoryStorage();
    saveSettings(storage, { theme: 'dark', reduceMotion: true });
    expect(loadSettings(storage)).toEqual({ theme: 'dark', reduceMotion: true });
  });

  it('falls back to defaults for corrupt or partial data', () => {
    const storage = memoryStorage();
    storage.setItem('ol.settings', '{theme:');
    expect(loadSettings(storage)).toEqual({ theme: 'auto', reduceMotion: false });

    storage.setItem('ol.settings', JSON.stringify({ theme: 'neon', reduceMotion: 'yes' }));
    expect(loadSettings(storage)).toEqual({ theme: 'auto', reduceMotion: false });

    storage.setItem('ol.settings', JSON.stringify({ reduceMotion: true }));
    expect(loadSettings(storage)).toEqual({ theme: 'auto', reduceMotion: true });
  });
});

describe('storage adapters', () => {
  it('keeps memory adapters independent', () => {
    const a = memoryStorage();
    const b = memoryStorage();
    a.setItem('k', 'v');
    expect(b.getItem('k')).toBeNull();
    a.removeItem('k');
    expect(a.getItem('k')).toBeNull();
  });

  it('refuses to fake localStorage outside the browser', () => {
    expect(typeof localStorage).toBe('undefined');
    expect(() => browserStorage()).toThrow(/localStorage/);
  });
});
