/**
 * Persistence: save slots, global achievements and user settings.
 *
 * All storage goes through `StorageAdapter` so tests can swap in a Map and the
 * engine never touches `window` directly.
 */

import { SAVE_VERSION } from '@/types';
import type { GameState, SaveEnvelope, Settings, SlotSummary, ThemeSetting } from '@/types';

/** The subset of the Web Storage API the game needs. */
export interface StorageAdapter {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

const SLOT_PREFIX = 'ol.save.';
const ACHIEVEMENTS_KEY = 'ol.achievements';
const SETTINGS_KEY = 'ol.settings';

const DEFAULT_SETTINGS: Settings = { theme: 'auto', reduceMotion: false };
const THEMES: readonly ThemeSetting[] = ['auto', 'light', 'dark'];

function slotKey(slot: number): string {
  return `${SLOT_PREFIX}${slot}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function stringOr(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

/** Adapter over `window.localStorage`, guarded for non-browser environments. */
export function browserStorage(): StorageAdapter {
  if (typeof localStorage === 'undefined') {
    throw new Error('browserStorage: localStorage is unavailable in this environment');
  }
  const store = localStorage;
  return {
    getItem(k: string): string | null {
      return store.getItem(k);
    },
    setItem(k: string, v: string): void {
      store.setItem(k, v);
    },
    removeItem(k: string): void {
      store.removeItem(k);
    },
  };
}

/** In-memory adapter, for tests and for environments without storage. */
export function memoryStorage(): StorageAdapter {
  const map = new Map<string, string>();
  return {
    getItem(k: string): string | null {
      const value = map.get(k);
      return value === undefined ? null : value;
    },
    setItem(k: string, v: string): void {
      map.set(k, v);
    },
    removeItem(k: string): void {
      map.delete(k);
    },
  };
}

/** How many save slots the load menu shows. */
export const SLOT_COUNT = 6;

/** Outcome of reading a slot; `future` means the save is newer than this build. */
export type LoadResult =
  | { ok: true; state: GameState }
  | { ok: false; reason: 'empty' | 'corrupt' | 'future' };

/** Writes a `SaveEnvelope` as JSON under `ol.save.<slot>`. */
export function saveGame(storage: StorageAdapter, slot: number, state: GameState): void {
  /* The one place a wall clock is allowed: `savedAt` is slot metadata, never an
     input to a game rule. */
  const envelope: SaveEnvelope = { version: SAVE_VERSION, savedAt: Date.now(), slot, state };
  storage.setItem(slotKey(slot), JSON.stringify(envelope));
}

/** Reads a slot, running `migrations` for older versions; newer versions are rejected. */
export function loadGame(storage: StorageAdapter, slot: number): LoadResult {
  const raw = storage.getItem(slotKey(slot));
  if (raw === null || raw === '') {
    return { ok: false, reason: 'empty' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'corrupt' };
  }

  if (!isRecord(parsed) || typeof parsed.version !== 'number') {
    return { ok: false, reason: 'corrupt' };
  }
  /* Checked before the payload shape: a newer build is exactly the case where
     `GameState` may have been reshaped, so shape-checking first would report the
     newest saves as `corrupt` and invite the player to delete a good save. */
  if (parsed.version > SAVE_VERSION) {
    return { ok: false, reason: 'future' };
  }
  const stored = parsed.state;
  if (!isRecord(stored) || !isRecord(stored.character)) {
    return { ok: false, reason: 'corrupt' };
  }

  /* Widened so a missing step reads as `undefined` instead of an always-defined
     function type. */
  const steps: Record<number, ((old: unknown) => unknown) | undefined> = migrations;
  let version = parsed.version;
  let state: unknown = stored;
  while (version < SAVE_VERSION) {
    const step = steps[version + 1];
    if (step === undefined) {
      return { ok: false, reason: 'corrupt' };
    }
    state = step(state);
    version += 1;
  }

  if (!isRecord(state) || !isRecord(state.character)) {
    return { ok: false, reason: 'corrupt' };
  }
  return { ok: true, state: state as unknown as GameState };
}

/** Clears one slot. */
export function deleteSave(storage: StorageAdapter, slot: number): void {
  storage.removeItem(slotKey(slot));
}

/* Slot-list rows are read shallowly and never validated: a slot that cannot be
   summarised is shown as empty rather than crashing the load menu. */
function summarise(storage: StorageAdapter, slot: number): SlotSummary {
  try {
    const raw = storage.getItem(slotKey(slot));
    if (raw === null || raw === '') {
      return { slot, empty: true };
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !isRecord(parsed.state)) {
      return { slot, empty: true };
    }
    const state = parsed.state;
    const character = state.character;
    if (!isRecord(character)) {
      return { slot, empty: true };
    }
    const first = stringOr(character.firstName, '');
    const last = stringOr(character.lastName, '');
    return {
      slot,
      empty: false,
      name: `${first} ${last}`.trim(),
      age: numberOr(character.age, 0),
      money: numberOr(character.money, 0),
      generation: numberOr(state.generation, 1),
      savedAt: numberOr(parsed.savedAt, 0),
      dead: state.phase === 'dead',
    };
  } catch {
    return { slot, empty: true };
  }
}

/** Summarises every slot for the load menu; always returns `SLOT_COUNT` entries. */
export function listSlots(storage: StorageAdapter): SlotSummary[] {
  const out: SlotSummary[] = [];
  for (let slot = 1; slot <= SLOT_COUNT; slot += 1) {
    out.push(summarise(storage, slot));
  }
  return out;
}

/**
 * Keyed by the version being upgraded *to*: loading a save at version `v` runs
 * `migrations[v + 1]` over the stored state until it reaches `SAVE_VERSION`.
 * A gap in the chain makes the save unreadable rather than half-migrated.
 */
export const migrations: Record<number, (old: unknown) => unknown> = {};

/** Reads the cross-life unlocked achievement ids from `ol.achievements`. */
export function loadUnlockedAchievements(storage: StorageAdapter): string[] {
  const raw = storage.getItem(ACHIEVEMENTS_KEY);
  if (raw === null || raw === '') {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((id): id is string => typeof id === 'string');
  } catch {
    return [];
  }
}

/** Writes the cross-life unlocked achievement ids to `ol.achievements`. */
export function saveUnlockedAchievements(storage: StorageAdapter, ids: string[]): void {
  storage.setItem(ACHIEVEMENTS_KEY, JSON.stringify([...new Set(ids)]));
}

/** Reads `ol.settings`, defaulting to `{ theme: 'auto', reduceMotion: false }`. */
export function loadSettings(storage: StorageAdapter): Settings {
  const raw = storage.getItem(SETTINGS_KEY);
  if (raw === null || raw === '') {
    return { ...DEFAULT_SETTINGS };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return { ...DEFAULT_SETTINGS };
    }
    const theme = THEMES.find((t) => t === parsed.theme);
    return {
      theme: theme ?? DEFAULT_SETTINGS.theme,
      reduceMotion:
        typeof parsed.reduceMotion === 'boolean'
          ? parsed.reduceMotion
          : DEFAULT_SETTINGS.reduceMotion,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Writes user settings to `ol.settings`. */
export function saveSettings(storage: StorageAdapter, s: Settings): void {
  storage.setItem(SETTINGS_KEY, JSON.stringify({ theme: s.theme, reduceMotion: s.reduceMotion }));
}
