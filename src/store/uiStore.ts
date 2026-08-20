/**
 * Pure UI state: which screen is showing, the sheet stack, transient toasts and
 * user settings. No game logic lives here — see `gameStore` for that.
 */

import { create } from 'zustand';
import { applyReduceMotion, applyTheme } from '@/design-system/theme';
import { browserStorage, loadSettings, memoryStorage, saveSettings } from '@/engine/save';
import type { StorageAdapter } from '@/engine/save';
import type { Settings, ThemeSetting } from '@/types';

/** Top-level destinations; only one renders at a time. */
export type ScreenId = 'slots' | 'create' | 'life' | 'death';

/** Every modal sheet the game can present. */
export type SheetId =
  | 'event'
  | 'occupation'
  | 'education'
  | 'relationships'
  | 'person'
  | 'activities'
  | 'health'
  | 'crime'
  | 'casino'
  | 'assets'
  | 'finance'
  | 'more'
  | 'achievements'
  | 'settings';

/** One entry on the sheet stack; `props` is read by the sheet it belongs to. */
export interface SheetEntry {
  id: SheetId;
  /** What `SheetHost` mounts this entry under, minted once when it is created.
      The identity has to follow the entry rather than its position: a stack
      index re-keys every sheet above one that is removed from the middle, so
      React tears them down and builds them again, losing the local state they
      hold (a half-typed amount, an open buy dialog, the last spin) and
      replaying the open animation. Two `person` sheets cannot collide either. */
  readonly key: number;
  props?: Record<string, unknown>;
}

/** A queued toast; `id` is assigned by the store, never by the caller. */
export interface ToastItem {
  id: number;
  icon: string;
  title: string;
  subtitle?: string;
}

interface UiStore {
  screen: ScreenId;
  sheets: SheetEntry[];
  toasts: ToastItem[];
  settings: Settings;
  setScreen(s: ScreenId): void;
  /** Opens a sheet, unless the stack is already `MAX_SHEETS` deep or the very
      same sheet (id and props alike) is on top of it. Not the way to the
      `event` sheet: that one belongs to the phase router — see `setEventSheet`. */
  pushSheet(id: SheetId, props?: Record<string, unknown>): void;
  popSheet(): void;
  closeAllSheets(): void;
  /** Puts the event sheet up or takes it down: `true` leaves exactly one, on
      top of the stack; `false` removes it wherever on the stack it sits. */
  setEventSheet(open: boolean): void;
  /** Queues a toast, dropping the oldest once `MAX_TOASTS` are on screen. */
  addToast(t: Omit<ToastItem, 'id'>): void;
  dismissToast(id: number): void;
  setTheme(t: ThemeSetting): void;
  setReduceMotion(on: boolean): void;
}

const DEFAULT_SETTINGS: Settings = { theme: 'auto', reduceMotion: false };

/* Both collections are appended to by taps that can repeat faster than they
   drain, so both are bounded. Four is what the toast host can stack before it
   runs off the top of the frame and covers the sheet it annotates; the newest
   toast is the one worth keeping, so the queue drops from the front. */
const MAX_TOASTS = 4;

/* Far past the deepest legitimate path (`more` → `casino`, or `relationships`
   → `person`, both 2), so this only ever catches a runaway: every sheet is a
   full-screen backdrop that has to be dismissed one at a time. */
const MAX_SHEETS = 8;

let nextToastId = 1;
let nextSheetKey = 1;

/** Builds a stack entry, taking the next key for it. Every `SheetEntry` the
    store creates comes from here, so no two live entries share a key. */
function newSheetEntry(id: SheetId, props?: Record<string, unknown>): SheetEntry {
  const entry: SheetEntry = { id, key: nextSheetKey, props };
  nextSheetKey += 1;
  return entry;
}

/** Whether this push would re-open the sheet already on top — a double-tap
    landing during the ~300 ms slide, as opposed to the legitimate "same id,
    different props" case (a `person` sheet for a second person). */
function isRepeatPush(top: SheetEntry, id: SheetId, props?: Record<string, unknown>): boolean {
  if (top.id !== id) {
    return false;
  }
  if (top.props === props) {
    return true;
  }
  if (top.props === undefined || props === undefined) {
    return false;
  }
  try {
    return JSON.stringify(top.props) === JSON.stringify(props);
  } catch {
    // Props that cannot be serialised (a cycle) never count as a repeat.
    return false;
  }
}

/* Resolved once, the way `gameStore` resolves its own: `browserStorage` throws
   only when `localStorage` is absent — under the test runner, or in a build with
   no DOM — and that cannot become true or false mid-session, so asking again on
   every write buys nothing. The Map it falls back to dies with the tab, which is
   what "preferences do not persist this session" already meant. Kept in a `let`
   so `resetUiStoreForTests` can hand the store a storage a test can read back. */
let storage: StorageAdapter = (() => {
  try {
    return browserStorage();
  } catch {
    return memoryStorage();
  }
})();

/* A real localStorage still throws on write in Safari private mode and on a full
   origin, and a hostile one can throw on read, so each call stays guarded. */
function readSettings(): Settings {
  try {
    return loadSettings(storage);
  } catch {
    // A copy: the default is shared, and what this returns becomes store state.
    return { ...DEFAULT_SETTINGS };
  }
}

function writeSettings(settings: Settings): void {
  try {
    saveSettings(storage, settings);
  } catch {
    // Preferences simply do not persist this session.
  }
}

export const useUiStore = create<UiStore>()((set, get) => ({
  screen: 'slots',
  sheets: [],
  toasts: [],
  settings: readSettings(),

  setScreen: (s: ScreenId): void => {
    set({ screen: s });
  },

  pushSheet: (id: SheetId, props?: Record<string, unknown>): void => {
    set((state) => {
      const top = state.sheets[state.sheets.length - 1];
      const refused =
        state.sheets.length >= MAX_SHEETS || (top !== undefined && isRepeatPush(top, id, props));
      /* A refusal returns the state object itself rather than a fresh
         `{ sheets }`: zustand skips the notification entirely, so the stack it
         left alone does not re-render. */
      return refused ? state : { sheets: [...state.sheets, newSheetEntry(id, props)] };
    });
  },

  popSheet: (): void => {
    set((state) => ({ sheets: state.sheets.slice(0, -1) }));
  },

  closeAllSheets: (): void => {
    set({ sheets: [] });
  },

  /**
   * The event sheet is a singleton the phase router owns, and this is the whole
   * rule for it: at most one is on the stack, and while it is up it is the top
   * of it. Stated once, in one direction, so the opening rule and the closing
   * rule cannot disagree — an entry left buried under another sheet is what
   * bricks the game, because it renders nothing, refuses to dismiss, and covers
   * the app with a backdrop that swallows every tap.
   *
   * `MAX_SHEETS` deliberately does not apply. The cap is there to catch a tap
   * repeating faster than the stack drains; this is the phase demanding the one
   * sheet the player has no other way to answer, so it is never refused.
   */
  setEventSheet: (open: boolean): void => {
    set((state) => {
      const rest = state.sheets.filter((s) => s.id !== 'event');
      const hadOne = rest.length !== state.sheets.length;
      if (!open) {
        // As in `pushSheet`: nothing to change means the very same array back.
        return hadOne ? { sheets: rest } : state;
      }
      const top = state.sheets[state.sheets.length - 1];
      const alreadyOnTop =
        top !== undefined && top.id === 'event' && rest.length === state.sheets.length - 1;
      if (alreadyOnTop) {
        return state;
      }
      /* A buried entry is moved by replacing it, key and all: the card it
         renders comes from the game, not from the entry, so nothing is worth
         carrying over, and a fresh key mounts the sheet on top cleanly while
         the sheets it was under keep theirs. */
      return { sheets: [...rest, newSheetEntry('event')] };
    });
  },

  addToast: (t: Omit<ToastItem, 'id'>): void => {
    const item: ToastItem = { ...t, id: nextToastId };
    nextToastId += 1;
    set((state) => ({ toasts: [...state.toasts, item].slice(-MAX_TOASTS) }));
  },

  dismissToast: (id: number): void => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },

  setTheme: (t: ThemeSetting): void => {
    const settings: Settings = { ...get().settings, theme: t };
    applyTheme(t);
    writeSettings(settings);
    set({ settings });
  },

  setReduceMotion: (on: boolean): void => {
    const settings: Settings = { ...get().settings, reduceMotion: on };
    applyReduceMotion(on);
    writeSettings(settings);
    set({ settings });
  },
}));

/**
 * Swaps the storage adapter and puts every field back to its boot value; tests
 * only, and the counterpart of `resetGameStoreForTests`.
 *
 * The two module counters are reset with the state they number. They are the
 * reason a hand-rolled `setState` is not enough: leaving them running lets one
 * test's toast ids and sheet keys decide what the next test reads back, which is
 * exactly the coupling a reset exists to cut. `settings` is re-read through the
 * new adapter, so a test can prove a write survived by resetting onto the same
 * storage and asking again.
 */
export function resetUiStoreForTests(adapter?: StorageAdapter): void {
  storage = adapter ?? memoryStorage();
  nextToastId = 1;
  nextSheetKey = 1;
  useUiStore.setState({ screen: 'slots', sheets: [], toasts: [], settings: readSettings() });
}
