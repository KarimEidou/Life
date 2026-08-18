import { describe, expect, it } from 'vitest';
import {
  SLOT_COUNT,
  browserStorage,
  deleteSave,
  listSlots,
  loadGame,
  loadSettings,
  loadUnlockedAchievements,
  memoryStorage,
  migrations,
  saveGame,
  saveSettings,
  saveUnlockedAchievements,
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
  });

  it('marks a finished life as dead', () => {
    const storage = memoryStorage();
    const target = listSlots(storage)[0].slot;
    saveGame(storage, target, fixture('Ada', { phase: 'dead' }));
    expect(listSlots(storage).find((s) => s.slot === target)?.dead).toBe(true);
  });

  it('treats an unreadable slot as empty instead of throwing', () => {
    const storage = memoryStorage();
    const target = listSlots(storage)[0].slot;
    storage.setItem(`ol.save.${target}`, 'not json at all');
    expect(listSlots(storage).find((s) => s.slot === target)?.empty).toBe(true);

    storage.setItem(`ol.save.${target}`, JSON.stringify({ version: 1, state: 7 }));
    expect(listSlots(storage).find((s) => s.slot === target)?.empty).toBe(true);
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
