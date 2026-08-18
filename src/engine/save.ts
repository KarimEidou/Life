/**
 * Persistence: save slots, global achievements and user settings.
 *
 * All storage goes through `StorageAdapter` so tests can swap in a Map and the
 * engine never touches `window` directly.
 */

import type { GameState, Settings, SlotSummary } from '@/types';

/** The subset of the Web Storage API the game needs. */
export interface StorageAdapter {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

/** Adapter over `window.localStorage`, guarded for non-browser environments. */
export function browserStorage(): StorageAdapter {
  throw new Error('TODO:save.browserStorage');
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
  throw new Error('TODO:save.saveGame');
}

/** Reads a slot, running `migrations` for older versions; newer versions are rejected. */
export function loadGame(storage: StorageAdapter, slot: number): LoadResult {
  throw new Error('TODO:save.loadGame');
}

/** Clears one slot. */
export function deleteSave(storage: StorageAdapter, slot: number): void {
  throw new Error('TODO:save.deleteSave');
}

/** Summarises every slot for the load menu; always returns `SLOT_COUNT` entries. */
export function listSlots(storage: StorageAdapter): SlotSummary[] {
  throw new Error('TODO:save.listSlots');
}

/** Keyed by the version being upgraded *from*; each step returns the next shape. */
export const migrations: Record<number, (old: unknown) => unknown> = {};

/** Reads the cross-life unlocked achievement ids from `ol.achievements`. */
export function loadUnlockedAchievements(storage: StorageAdapter): string[] {
  throw new Error('TODO:save.loadUnlockedAchievements');
}

/** Writes the cross-life unlocked achievement ids to `ol.achievements`. */
export function saveUnlockedAchievements(storage: StorageAdapter, ids: string[]): void {
  throw new Error('TODO:save.saveUnlockedAchievements');
}

/** Reads `ol.settings`, defaulting to `{ theme: 'auto', reduceMotion: false }`. */
export function loadSettings(storage: StorageAdapter): Settings {
  throw new Error('TODO:save.loadSettings');
}

/** Writes user settings to `ol.settings`. */
export function saveSettings(storage: StorageAdapter, s: Settings): void {
  throw new Error('TODO:save.saveSettings');
}
