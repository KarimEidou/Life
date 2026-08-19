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
  saveNow(): boolean;
}

/* Storage is best-effort: localStorage throws in Safari private mode and is
   absent entirely under the test runner; without it the game still plays, it
   just does not persist. */
let storagePersists = true;
let storage: StorageAdapter = (() => {
  try {
    return browserStorage();
  } catch {
    /* The fallback Map dies with the tab, so a write into it is not a save the
       player will find again: `saveNow` is the one write whose outcome is
       reported, and it reports this one as a failure. */
    storagePersists = false;
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
    } else if (!slotTakenOver) {
      /* Not once another window owns the slot: the stake behind this hand is
         charged in a state that is no longer being autosaved, so leaving the
         hand to be restored on top of that window's save would pay it out of a
         balance it was never taken from. */
      storage.setItem(tableKey(slot), JSON.stringify(table));
    }
  } catch {
    // The hand simply does not survive a reload this session.
  }
}

/** A dealt hand as the sidecar has to hold it: display strings such as `A♠`. */
function isHand(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((card) => typeof card === 'string');
}

/** A stake, total or payout the arithmetic downstream can actually use. */
function isAmount(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Restores the hand a mid-hand reload left behind; null unless the sidecar
 * holds a whole, still-open table.
 *
 * Every field is checked, not just the ones that decide whether a hand shows:
 * what comes back is adopted straight into `casino`, and its consumers
 * dereference the rest without a guard — the casino sheet maps over `dealer`
 * during render and `blackjackStand` spreads it, neither behind an error
 * boundary, so half a table blanks the app rather than costing one hand.
 * Refusing forfeits only the stake this key exists to protect, which is the
 * cheaper failure. The key carries no version of its own, so this gate is also
 * the only thing standing between a reshaped `BlackjackTable` and live state.
 */
function readTableSidecar(slot: number): BlackjackTable | null {
  try {
    const raw = storage.getItem(tableKey(slot));
    if (raw === null) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    // `typeof null === 'object'`, so the null sidecar needs its own refusal.
    if (parsed === null || typeof parsed !== 'object') {
      return null;
    }
    const table = parsed as Partial<BlackjackTable>;
    const openHand =
      isHand(table.player) &&
      table.player.length > 0 &&
      isHand(table.dealer) &&
      table.done === false &&
      isAmount(table.bet) &&
      table.bet > 0 &&
      isAmount(table.playerTotal) &&
      isAmount(table.dealerTotal) &&
      isAmount(table.payout);
    return openHand ? (table as BlackjackTable) : null;
  } catch {
    return null;
  }
}

/* `saveGame` owns this key; the store spells it out too because the ownership
   check below needs one slot's envelope stamp, and the only exported reader of
   it is `listSlots`, which parses all six saves. */
function saveKey(slot: number): string {
  return `ol.save.${String(slot)}`;
}

/**
 * When this window last held the slot's newest state, and whether the player
 * has already been told that it lost it.
 *
 * `ol.save.<slot>` is last-writer-wins while the store keeps whatever it read
 * when the slot was opened, and the game installs as a PWA — the same slot open
 * in the installed window and in a browser tab is an ordinary state that no
 * action guards against. A commit from the window that is behind would autosave
 * its own age over the other's, silently rolling the slot back years. A stored
 * stamp later than this window's last write can only be another writer's, so
 * the autosave stands down rather than erase it.
 */
let slotOwnedAt: { slot: number; at: number } | null = null;
let slotTakenOver = false;

/** Records this window as the writer of the slot's newest state. */
function claimSlot(slot: number): void {
  /* A wall clock, as in `saveGame`'s own stamp: slot metadata, never an input
     to a game rule. Taken after the write it describes, so this window's own
     stamp can never read back as newer than its claim. */
  slotOwnedAt = { slot, at: Date.now() };
  slotTakenOver = false;
}

/** The stamp `ol.save.<slot>` carries now; 0 when it holds nothing readable. */
function storedSavedAt(slot: number): number {
  try {
    const raw = storage.getItem(saveKey(slot));
    if (raw === null) {
      return 0;
    }
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') {
      return 0;
    }
    const at: unknown = (parsed as { savedAt?: unknown }).savedAt;
    return isAmount(at) ? at : 0;
  } catch {
    return 0;
  }
}

/**
 * True when the slot holds a write this window did not make.
 *
 * An unclaimed slot reads as this window's: every path that opens or creates a
 * life claims the slot, so no claim means there is nothing to compare against
 * and the write goes through exactly as it did before.
 */
function slotWrittenElsewhere(slot: number): boolean {
  if (slotOwnedAt === null || slotOwnedAt.slot !== slot) {
    return false;
  }
  return storedSavedAt(slot) > slotOwnedAt.at;
}

/**
 * Reopens a life parked on `awaitingChoice` with no card to answer; true when
 * it repaired something.
 *
 * The engine never mints that state — `eventsPhase` queues the card and sets the
 * phase in one step, and every exit recomputes the phase from what is left — but
 * a save can carry it (`loadGame` validates only the version and the character),
 * and it is the one state with no way out of the UI: `routePhase` puts up the
 * event sheet, that sheet is mounted non-dismissible over a full-screen backdrop
 * that swallows every tap, and it renders nothing at all without a card. The
 * repair mirrors the engine's own (`ageUp`, `discardPending`): there is no card,
 * so there is nothing to narrate and nothing to roll — it costs no log line and
 * no draw, and replays identically.
 */
function repairStalledChoice(game: GameState): boolean {
  if (game.phase !== 'awaitingChoice') {
    return false;
  }
  /* Widened like the engine's read: a drifted queue can be absent entirely, or
     hold a null head that would throw on the first property access. */
  const queued: readonly (PendingEvent | undefined)[] | undefined = game.pending;
  if (queued?.[0]) {
    return false;
  }
  game.pending = [];
  game.phase = 'alive';
  return true;
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
      /* `ol.achievements` is the one global, append-only list, and this store
         read it once at page load: writing the snapshot back would delete
         whatever another window has unlocked since. Merged on write instead —
         the toasts stay driven by `fresh`, so ids adopted here never toast. */
      nextUnlocked = [...new Set([...readUnlocked(), ...unlocked, ...fresh])];
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
      if (slotWrittenElsewhere(slot)) {
        /* Said once: the check keeps refusing for every later action too, and
           the Settings sheet's explicit Save is the way to take the slot back. */
        if (!slotTakenOver) {
          slotTakenOver = true;
          useUiStore.getState().addToast({
            icon: '⚠️',
            title: 'Autosave paused',
            subtitle: 'This slot is open in another window.',
          });
        }
      } else {
        try {
          saveGame(storage, slot, game);
          claimSlot(slot);
        } catch {
          // The autosave is lost but play continues.
        }
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
      // Creating a life in a slot is a deliberate overwrite of whatever is there.
      claimSlot(opts.slot);
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
      /* Repaired before the state is adopted, not from inside `routePhase`:
         `commit` spreads the game object before routing, so a mutation made
         down there would never reach the copy React renders. */
      repairStalledChoice(result.state);
      // What was just read is the slot's newest state, so this window holds it.
      claimSlot(slot);
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
      /* Checked before the phase guard: the engine makes this same repair on its
         way in, but the guard below would re-route into the event sheet long
         before `engineAgeUp` ever sees the state. */
      repairStalledChoice(game);
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
      /* Nothing to answer is drifted save data too: `resolveChoice` would throw
         on it, and returning would leave the life parked behind the event sheet
         with no move left. Reopen the year instead, then commit so the router
         drops that sheet. */
      if (repairStalledChoice(game)) {
        commit(game);
        return;
      }
      // The repair above cleared every queue with nothing at its head.
      const card: PendingEvent = game.pending[0];
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

    /**
     * Forces a write of the loaded slot; true only when the life reached storage
     * that outlives the tab. This is the only write the player is told about, so
     * the caller must be able to tell a real save from a lost one.
     */
    saveNow: (): boolean => {
      const { game, slot } = get();
      if (game === null || slot === null) {
        return false;
      }
      try {
        /* Deliberately not subject to the autosave's ownership check: asking to
           save is asking to write this life to the slot, and it is the only way
           back to autosaving once another window has taken the slot over. */
        saveGame(storage, slot, game);
        claimSlot(slot);
      } catch {
        // The save is lost but play continues.
        return false;
      }
      return storagePersists;
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
  /* An injected adapter is the caller's storage of record, so writes to it count
     as persisted; only the module's own fallback above reads as ephemeral. */
  storagePersists = true;
  // A fresh page load: this window has written no slot yet.
  slotOwnedAt = null;
  slotTakenOver = false;
  useGameStore.setState({ game: null, slot: null, casino: null, unlocked: readUnlocked() });
}
