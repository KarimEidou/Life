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

/**
 * The load-time shape gate: every container the engine and the UI dereference
 * without a guard once a save has been adopted (`character.job.title` in the
 * header, `Object.values(state.people)` in the text formatter, `state.log.map`
 * in the feed, …). `loadGame` is the only validation boundary for this data and
 * there is no error boundary above the screens, so a payload that gets past
 * here and then throws during render takes the whole app down; `corrupt` routes
 * to the Continue/Delete alert instead. Values inside the containers stay
 * unchecked — this rejects unusable saves, it does not certify sound ones.
 */
function isGameStateShaped(v: unknown): v is Record<string, unknown> {
  if (!isRecord(v)) {
    return false;
  }
  const c = v.character;
  if (!isRecord(c)) {
    return false;
  }
  if (!isRecord(c.stats) || !isRecord(c.education) || !isRecord(c.pronouns)) {
    return false;
  }
  if (!isRecord(c.flags) || !isRecord(c.investments) || !isRecord(c.addictions)) {
    return false;
  }
  if (!Array.isArray(c.assets) || !Array.isArray(c.loans) || !Array.isArray(c.illnesses)) {
    return false;
  }
  // Legitimately null, so only the alternative to a record can be admitted.
  if (c.job !== null && !isRecord(c.job)) {
    return false;
  }
  if (c.prison !== null && !isRecord(c.prison)) {
    return false;
  }
  if (!isRecord(v.people) || !isRecord(v.interactionUse)) {
    return false;
  }
  if (!Array.isArray(v.log) || !Array.isArray(v.pending)) {
    return false;
  }
  if (!Array.isArray(v.firedEvents) || !Array.isArray(v.ancestors)) {
    return false;
  }
  return typeof v.phase === 'string';
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
  /* Only "is it an object at all" before the chain: a migration exists precisely
     to reshape `GameState`, so shape-gating here would make the one change a
     step most plausibly has to perform — creating, renaming or moving a
     top-level key — unreachable behind a `corrupt` verdict. */
  if (!isRecord(stored)) {
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

  // The single shape gate, judging what the migrations actually produced.
  if (!isGameStateShaped(state)) {
    return { ok: false, reason: 'corrupt' };
  }
  return { ok: true, state: state as unknown as GameState };
}

/** Clears one slot. */
export function deleteSave(storage: StorageAdapter, slot: number): void {
  storage.removeItem(slotKey(slot));
}

/* Slot-list rows are read shallowly and never validated: a slot this build
   cannot describe loses its details rather than crashing the load menu.
   `empty`, though, has to keep meaning what `loadGame` means by it — nothing is
   stored here. `loadGame` answers `corrupt` or `future` for every payload it
   cannot read, never `empty`, and the load menu hands an `empty` row straight
   to `startNew`, which overwrites the slot with no confirmation and no undo.
   So anything actually written here stays occupied whether this build can make
   sense of it or not — a newer envelope (which Continue reports as `future`), a
   legacy one only a migration understands, a damaged payload the player may
   still want to recover — and keeps its Continue/Delete alert. */
function summarise(storage: StorageAdapter, slot: number): SlotSummary {
  /* Declared outside the try so the catch can tell a read that never returned —
     which says nothing about the slot — from a payload that is there and would
     not parse. Only the second one keeps the slot occupied. */
  let raw: string | null = null;
  try {
    raw = storage.getItem(slotKey(slot));
    if (raw === null || raw === '') {
      return { slot, empty: true };
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return { slot, empty: false };
    }
    // Occupied, with nothing read out of it yet beyond the envelope stamp.
    const unreadable: SlotSummary = { slot, empty: false, savedAt: numberOr(parsed.savedAt, 0) };
    const state = parsed.state;
    if (!isRecord(state)) {
      return unreadable;
    }
    const character = state.character;
    if (!isRecord(character)) {
      return unreadable;
    }
    const first = stringOr(character.firstName, '');
    const last = stringOr(character.lastName, '');
    const label = `${first} ${last}`.trim();
    return {
      slot,
      empty: false,
      /* Absent rather than empty: the load menu titles the row and its
         confirmation alert `name ?? 'Saved life'`, and nullish coalescing keeps
         `''`, leaving the player to Continue-or-Delete an unlabelled slot. */
      name: label === '' ? undefined : label,
      age: numberOr(character.age, 0),
      money: numberOr(character.money, 0),
      generation: numberOr(state.generation, 1),
      savedAt: numberOr(parsed.savedAt, 0),
      dead: state.phase === 'dead',
    };
  } catch {
    return { slot, empty: raw === null || raw === '' };
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
