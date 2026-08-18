/**
 * Pure UI state: which screen is showing, the sheet stack, transient toasts and
 * user settings. No game logic lives here — see `gameStore` for that.
 */

import { create } from 'zustand';
import { applyReduceMotion, applyTheme } from '@/design-system/theme';
import { browserStorage, loadSettings, saveSettings } from '@/engine/save';
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
  pushSheet(id: SheetId, props?: Record<string, unknown>): void;
  popSheet(): void;
  closeAllSheets(): void;
  addToast(t: Omit<ToastItem, 'id'>): void;
  dismissToast(id: number): void;
  setTheme(t: ThemeSetting): void;
  setReduceMotion(on: boolean): void;
}

const DEFAULT_SETTINGS: Settings = { theme: 'auto', reduceMotion: false };

let nextToastId = 1;

/* Storage is best-effort: localStorage throws in Safari private mode and is
   absent entirely under the test runner, neither of which should break the UI. */
function readSettings(): Settings {
  try {
    return loadSettings(browserStorage());
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function writeSettings(settings: Settings): void {
  try {
    saveSettings(browserStorage(), settings);
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
    set((state) => ({ sheets: [...state.sheets, { id, props }] }));
  },

  popSheet: (): void => {
    set((state) => ({ sheets: state.sheets.slice(0, -1) }));
  },

  closeAllSheets: (): void => {
    set({ sheets: [] });
  },

  addToast: (t: Omit<ToastItem, 'id'>): void => {
    const item: ToastItem = { ...t, id: nextToastId };
    nextToastId += 1;
    set((state) => ({ toasts: [...state.toasts, item] }));
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
