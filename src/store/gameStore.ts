/**
 * The game facade: the only thing the UI calls to change a life.
 *
 * Implementation contract for every mutating action — the engine mutates
 * `GameState` in place, so each action must re-spread the game object into
 * `set()` for React to see the change, autosave the slot via `saveGame`, and
 * run `evaluateAchievements`, pushing a toast for each newly unlocked id.
 *
 * Because only the top-level `game` object gets a fresh identity per commit
 * (nested objects are mutated in place), components must subscribe to the
 * top-level fields — `useGameStore((s) => s.game)` — and derive everything
 * inside the component; a selector on a nested object would never re-render.
 */

import { create } from 'zustand';
import { getRegistry } from '@/content';
import * as gambling from '@/content/gambling';
import type { BlackjackTable, LotteryResult, SlotsResult } from '@/content/gambling';
import { evaluateAchievements } from '@/engine/achievements';
import { ageUp as engineAgeUp, resolveChoice } from '@/engine/ageUp';
import { startLegacy as engineStartLegacy } from '@/engine/death';
import { commitCrime, runInteraction } from '@/engine/interactions';
import * as career from '@/engine/phases/career';
import * as education from '@/engine/phases/education';
import * as finance from '@/engine/phases/finance';
import {
  browserStorage,
  deleteSave,
  listSlots,
  loadGame,
  loadUnlockedAchievements,
  memoryStorage,
  saveGame,
  saveUnlockedAchievements,
} from '@/engine/save';
import type { LoadResult, StorageAdapter } from '@/engine/save';
import { createLife, emigrateTo } from '@/engine/state';
import { useUiStore } from '@/store/uiStore';
import type {
  AchievementDef,
  GameState,
  Gender,
  Investments,
  PendingEvent,
  SlotSummary,
} from '@/types';

/** What the create-a-life screen collects; unset fields are rolled from the seed. */
export interface NewLifeOptions {
  slot: number;
  seed?: number;
  firstName?: string;
  lastName?: string;
  gender?: Gender;
  countryId?: string;
}

interface GameStore {
  game: GameState | null;
  slot: number | null;
  unlocked: string[];
  casino: BlackjackTable | null;

  newLife(opts: NewLifeOptions): void;
  loadSlot(slot: number): boolean;
  deleteSlot(slot: number): void;
  slotSummaries(): SlotSummary[];

  ageUp(): void;
  choose(index: number): void;

  interact(id: string, targetId?: string): { text: string; icon: string } | null;
  crime(crimeId: string): { text: string; icon: string } | null;

  applyForJob(jobId: string): { ok: boolean; reason?: string };
  quitJob(): void;
  setWorkHard(on: boolean): void;
  askForRaise(): { ok: boolean; text: string };

  applyToSchool(schoolId: string, major?: string): { ok: boolean; reason?: string };
  dropOut(): void;
  setStudyHard(on: boolean): void;

  buyAsset(defId: string, withLoan?: boolean): { ok: boolean; reason?: string };
  sellAsset(assetId: string): void;
  deposit(kind: keyof Investments, amount: number): boolean;
  withdraw(kind: keyof Investments, amount: number): boolean;
  takeLoan(amount: number): { ok: boolean; reason?: string };
  repayLoan(loanId: string, amount: number): void;

  emigrate(countryId: string): { ok: boolean; reason?: string; text?: string };

  startBlackjack(bet: number): void;
  blackjackHit(): void;
  blackjackStand(): void;
  clearCasino(): void;
  spinSlots(bet: number): SlotsResult | null;
  buyLottery(): LotteryResult | null;

  startLegacy(childId: string): void;
  abandonLife(): void;
  saveNow(): void;
}

/* Storage is best-effort: localStorage throws in Safari private mode and is
   absent entirely under the test runner; without it the game still plays, it
   just does not persist. */
let storage: StorageAdapter = (() => {
  try {
    return browserStorage();
  } catch {
    return memoryStorage();
  }
})();

function readUnlocked(): string[] {
  try {
    return loadUnlockedAchievements(storage);
  } catch {
    return [];
  }
}

/* An unfinished blackjack hand is app-layer state, not part of the engine's
   save envelope — but its stake is already charged and autosaved, so the
   table rides in a sidecar key and is restored on load instead of being
   silently forfeited by a mid-hand reload. */
function tableKey(slot: number): string {
  return `ol.table.${String(slot)}`;
}

function writeTableSidecar(slot: number | null, table: BlackjackTable | null): void {
  if (slot === null) {
    return;
  }
  try {
    if (table === null || table.done) {
      storage.removeItem(tableKey(slot));
    } else {
      storage.setItem(tableKey(slot), JSON.stringify(table));
    }
  } catch {
    // The hand simply does not survive a reload this session.
  }
}

function readTableSidecar(slot: number): BlackjackTable | null {
  try {
    const raw = storage.getItem(tableKey(slot));
    if (raw === null) {
      return null;
    }
    const table = JSON.parse(raw) as BlackjackTable;
    const openHand =
      typeof table === 'object' &&
      Array.isArray(table.player) &&
      table.player.length > 0 &&
      table.done === false &&
      typeof table.bet === 'number';
    return openHand ? table : null;
  } catch {
    return null;
  }
}

/** Sends the UI wherever the life's phase demands after a mutation. */
function routePhase(game: GameState): void {
  const ui = useUiStore.getState();
  if (game.phase === 'dead') {
    ui.closeAllSheets();
    ui.setScreen('death');
    return;
  }
  if (game.phase === 'awaitingChoice') {
    if (!ui.sheets.some((s) => s.id === 'event')) {
      ui.pushSheet('event');
    }
    return;
  }
  // Back to plain living: drop any event sheet this router itself put up.
  for (;;) {
    const { sheets, popSheet } = useUiStore.getState();
    const top = sheets[sheets.length - 1];
    if (top === undefined || top.id !== 'event') {
      break;
    }
    popSheet();
  }
}

export const useGameStore = create<GameStore>()((set, get) => {
  /** The funnel every mutating action ends in: sweeps achievements against the
      cross-life list, autosaves the loaded slot, re-spreads the game object so
      React sees the in-place mutation, then routes the UI on the phase. */
  const commit = (game: GameState, extra?: { casino: BlackjackTable | null }): void => {
    const reg = getRegistry();
    const { slot, unlocked } = get();

    const fresh = evaluateAchievements(game, reg, unlocked);
    let nextUnlocked = unlocked;
    if (fresh.length > 0) {
      nextUnlocked = [...unlocked, ...fresh];
      try {
        saveUnlockedAchievements(storage, nextUnlocked);
      } catch {
        // Unlocks simply do not persist this session.
      }
      const ui = useUiStore.getState();
      for (const id of fresh) {
        const def: AchievementDef | undefined = reg.achievementsById[id];
        ui.addToast({
          icon: def?.icon ?? '🏆',
          title: 'Achievement unlocked!',
          subtitle: def?.label ?? id,
        });
      }
    }

    if (slot !== null) {
      try {
        saveGame(storage, slot, game);
      } catch {
        // The autosave is lost but play continues.
      }
    }

    set({ game: { ...game }, unlocked: nextUnlocked, ...extra });
    routePhase(game);
  };

  return {
    game: null,
    slot: null,
    unlocked: readUnlocked(),
    casino: null,

    /** Creates a character in the given slot and switches to the life screen. */
    newLife: (opts: NewLifeOptions): void => {
      // The one sanctioned Math.random outside the engine: rolling the seed itself.
      const seed = opts.seed ?? Math.floor(Math.random() * 4294967296);
      const game = createLife(getRegistry(), {
        seed,
        firstName: opts.firstName,
        lastName: opts.lastName,
        gender: opts.gender,
        countryId: opts.countryId,
      });
      writeTableSidecar(opts.slot, null);
      set({ game, slot: opts.slot, casino: null });
      commit(game);
      useUiStore.getState().setScreen('life');
    },

    /** Loads a slot into the store; false when the slot is empty or unreadable. */
    loadSlot: (slot: number): boolean => {
      let result: LoadResult;
      try {
        result = loadGame(storage, slot);
      } catch {
        return false;
      }
      if (!result.ok) {
        return false;
      }
      set({ game: result.state, slot, casino: readTableSidecar(slot) });
      const ui = useUiStore.getState();
      ui.closeAllSheets();
      ui.setScreen('life');
      routePhase(result.state);
      return true;
    },

    /** Erases a slot, clearing the store when that slot is the one loaded. */
    deleteSlot: (slot: number): void => {
      try {
        deleteSave(storage, slot);
      } catch {
        // Nothing readable to erase.
      }
      writeTableSidecar(slot, null);
      if (get().slot === slot) {
        set({ game: null, slot: null, casino: null });
      }
    },

    /** Slot descriptions for the load menu. */
    slotSummaries: (): SlotSummary[] => {
      return listSlots(storage);
    },

    /** Advances one year; opens the event sheet when the year queues a choice. */
    ageUp: (): void => {
      const game = get().game;
      if (game === null) {
        return;
      }
      if (game.phase !== 'alive') {
        // A dismissed event sheet or a finished life: re-route instead of aging.
        routePhase(game);
        return;
      }
      engineAgeUp(game, getRegistry());
      commit(game);
    },

    /** Answers the pending event with the choice at `index`. */
    choose: (index: number): void => {
      const game = get().game;
      if (game === null || game.phase !== 'awaitingChoice') {
        return;
      }
      const card: PendingEvent | undefined = game.pending[0];
      if (card === undefined) {
        return;
      }
      /* Only a populated card with an out-of-range index is refused (the
         engine would throw). A card with no choices — drifted save data —
         must still reach resolveChoice, whose discard path is the designed
         recovery for exactly that card. */
      const choices: PendingEvent['choices'] | undefined = card.choices;
      if (choices !== undefined && choices.length > 0 && choices[index] === undefined) {
        return;
      }
      resolveChoice(game, getRegistry(), index);
      commit(game);
    },

    /** Runs an activity or relationship action; returns its headline for the UI. */
    interact: (id: string, targetId?: string): { text: string; icon: string } | null => {
      const game = get().game;
      if (game === null) {
        return null;
      }
      const result = runInteraction(game, getRegistry(), id, targetId);
      commit(game);
      return result === null ? null : { text: result.text, icon: result.icon };
    },

    /** Commits a crime; returns its headline for the UI. */
    crime: (crimeId: string): { text: string; icon: string } | null => {
      const game = get().game;
      if (game === null) {
        return null;
      }
      const result = commitCrime(game, getRegistry(), crimeId);
      commit(game);
      return { text: result.text, icon: result.icon };
    },

    applyForJob: (jobId: string): { ok: boolean; reason?: string } => {
      const game = get().game;
      if (game === null) {
        return { ok: false, reason: 'No life loaded.' };
      }
      const result = career.applyForJob(game, getRegistry(), jobId);
      commit(game);
      return result;
    },

    quitJob: (): void => {
      const game = get().game;
      if (game === null) {
        return;
      }
      career.quitJob(game);
      commit(game);
    },

    setWorkHard: (on: boolean): void => {
      const game = get().game;
      if (game === null) {
        return;
      }
      career.setWorkHard(game, on);
      commit(game);
    },

    askForRaise: (): { ok: boolean; text: string } => {
      const game = get().game;
      if (game === null) {
        return { ok: false, text: 'No life loaded.' };
      }
      const result = career.askForRaise(game, getRegistry());
      commit(game);
      return result;
    },

    applyToSchool: (schoolId: string, major?: string): { ok: boolean; reason?: string } => {
      const game = get().game;
      if (game === null) {
        return { ok: false, reason: 'No life loaded.' };
      }
      const result = education.applyToSchool(game, getRegistry(), schoolId, major);
      commit(game);
      return result;
    },

    dropOut: (): void => {
      const game = get().game;
      if (game === null) {
        return;
      }
      education.dropOut(game);
      commit(game);
    },

    setStudyHard: (on: boolean): void => {
      const game = get().game;
      if (game === null) {
        return;
      }
      education.setStudyHard(game, on);
      commit(game);
    },

    buyAsset: (defId: string, withLoan?: boolean): { ok: boolean; reason?: string } => {
      const game = get().game;
      if (game === null) {
        return { ok: false, reason: 'No life loaded.' };
      }
      const result = finance.buyAsset(game, getRegistry(), defId, withLoan);
      commit(game);
      return result;
    },

    sellAsset: (assetId: string): void => {
      const game = get().game;
      if (game === null) {
        return;
      }
      finance.sellAsset(game, assetId);
      commit(game);
    },

    deposit: (kind: keyof Investments, amount: number): boolean => {
      const game = get().game;
      if (game === null) {
        return false;
      }
      const ok = finance.depositInvestment(game, kind, amount);
      commit(game);
      return ok;
    },

    withdraw: (kind: keyof Investments, amount: number): boolean => {
      const game = get().game;
      if (game === null) {
        return false;
      }
      const ok = finance.withdrawInvestment(game, kind, amount);
      commit(game);
      return ok;
    },

    takeLoan: (amount: number): { ok: boolean; reason?: string } => {
      const game = get().game;
      if (game === null) {
        return { ok: false, reason: 'No life loaded.' };
      }
      const result = finance.takeLoan(game, getRegistry(), amount);
      commit(game);
      return result;
    },

    repayLoan: (loanId: string, amount: number): void => {
      const game = get().game;
      if (game === null) {
        return;
      }
      finance.repayLoan(game, loanId, amount);
      commit(game);
    },

    emigrate: (countryId: string): { ok: boolean; reason?: string; text?: string } => {
      const game = get().game;
      if (game === null) {
        return { ok: false, reason: 'No life loaded.' };
      }
      // A denied application still charges the fee and logs, so commit either way.
      const result = emigrateTo(game, getRegistry(), countryId);
      commit(game);
      return result;
    },

    /** Deals a hand and holds the table in `casino` until it is cleared. */
    startBlackjack: (bet: number): void => {
      const { game, casino } = get();
      if (game === null) {
        return;
      }
      // Dealing over an unfinished hand would silently forfeit its stake.
      if (casino !== null && !casino.done) {
        return;
      }
      const table = gambling.startBlackjack(game, getRegistry(), bet);
      commit(game, { casino: table });
      writeTableSidecar(get().slot, table);
    },

    blackjackHit: (): void => {
      const { game, casino } = get();
      if (game === null || casino === null || casino.done) {
        return;
      }
      const table = gambling.blackjackHit(game, casino);
      commit(game, { casino: table });
      writeTableSidecar(get().slot, table);
    },

    blackjackStand: (): void => {
      const { game, casino } = get();
      if (game === null || casino === null || casino.done) {
        return;
      }
      const table = gambling.blackjackStand(game, casino);
      commit(game, { casino: table });
      writeTableSidecar(get().slot, table);
    },

    /** Drops the finished table so the casino sheet returns to its menu. */
    clearCasino: (): void => {
      writeTableSidecar(get().slot, null);
      set({ casino: null });
    },

    spinSlots: (bet: number): SlotsResult | null => {
      const game = get().game;
      if (game === null) {
        return null;
      }
      const result = gambling.spinSlots(game, getRegistry(), bet);
      commit(game);
      return result;
    },

    buyLottery: (): LotteryResult | null => {
      const game = get().game;
      if (game === null) {
        return null;
      }
      const result = gambling.buyLottery(game, getRegistry());
      commit(game);
      return result;
    },

    /** Continues into the next generation as the chosen child. */
    startLegacy: (childId: string): void => {
      const game = get().game;
      if (game === null) {
        return;
      }
      let next: GameState;
      try {
        next = engineStartLegacy(game, getRegistry(), childId);
      } catch {
        // The UI only offers living children; a stale id is ignored.
        return;
      }
      writeTableSidecar(get().slot, null);
      set({ game: next, casino: null });
      commit(next);
      const ui = useUiStore.getState();
      ui.closeAllSheets();
      ui.setScreen('life');
    },

    /** Leaves the current life without continuing it and returns to the slot list. */
    abandonLife: (): void => {
      set({ game: null, slot: null, casino: null });
      const ui = useUiStore.getState();
      ui.closeAllSheets();
      ui.setScreen('slots');
    },

    /** Forces a write of the loaded slot. */
    saveNow: (): void => {
      const { game, slot } = get();
      if (game === null || slot === null) {
        return;
      }
      try {
        saveGame(storage, slot, game);
      } catch {
        // The save is lost but play continues.
      }
    },
  };
});

/** Why a slot refuses to load, for UI copy; null when it would load fine. */
export function slotLoadFailure(slot: number): 'empty' | 'corrupt' | 'future' | null {
  try {
    const result = loadGame(storage, slot);
    return result.ok ? null : result.reason;
  } catch {
    return 'corrupt';
  }
}

/** Swaps the storage adapter and clears any loaded life; tests only. */
export function resetGameStoreForTests(adapter?: StorageAdapter): void {
  storage = adapter ?? memoryStorage();
  useGameStore.setState({ game: null, slot: null, casino: null, unlocked: readUnlocked() });
}
