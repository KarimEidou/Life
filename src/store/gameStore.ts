/**
 * The game facade: the only thing the UI calls to change a life.
 *
 * Implementation contract for every mutating action — the engine mutates
 * `GameState` in place, so each action must re-spread the game object into
 * `set()` for React to see the change, autosave the slot via `saveGame`, and
 * run `evaluateAchievements`, pushing a toast for each newly unlocked id.
 */

import { create } from 'zustand';
import type { BlackjackTable, LotteryResult, SlotsResult } from '@/content/gambling';
import type { GameState, Gender, Investments, SlotSummary } from '@/types';

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

export const useGameStore = create<GameStore>()(() => ({
  game: null,
  slot: null,
  unlocked: [],
  casino: null,

  /** Creates a character in the given slot and switches to the life screen. */
  newLife: (opts: NewLifeOptions): void => {
    throw new Error('TODO:gameStore.newLife');
  },

  /** Loads a slot into the store; false when the slot is empty or unreadable. */
  loadSlot: (slot: number): boolean => {
    throw new Error('TODO:gameStore.loadSlot');
  },

  /** Erases a slot, clearing the store when that slot is the one loaded. */
  deleteSlot: (slot: number): void => {
    throw new Error('TODO:gameStore.deleteSlot');
  },

  /** Slot descriptions for the load menu. */
  slotSummaries: (): SlotSummary[] => {
    throw new Error('TODO:gameStore.slotSummaries');
  },

  /** Advances one year; opens the event sheet when the year queues a choice. */
  ageUp: (): void => {
    throw new Error('TODO:gameStore.ageUp');
  },

  /** Answers the pending event with the choice at `index`. */
  choose: (index: number): void => {
    throw new Error('TODO:gameStore.choose');
  },

  /** Runs an activity or relationship action; returns its headline for the UI. */
  interact: (id: string, targetId?: string): { text: string; icon: string } | null => {
    throw new Error('TODO:gameStore.interact');
  },

  /** Commits a crime; returns its headline for the UI. */
  crime: (crimeId: string): { text: string; icon: string } | null => {
    throw new Error('TODO:gameStore.crime');
  },

  applyForJob: (jobId: string): { ok: boolean; reason?: string } => {
    throw new Error('TODO:gameStore.applyForJob');
  },

  quitJob: (): void => {
    throw new Error('TODO:gameStore.quitJob');
  },

  setWorkHard: (on: boolean): void => {
    throw new Error('TODO:gameStore.setWorkHard');
  },

  askForRaise: (): { ok: boolean; text: string } => {
    throw new Error('TODO:gameStore.askForRaise');
  },

  applyToSchool: (schoolId: string, major?: string): { ok: boolean; reason?: string } => {
    throw new Error('TODO:gameStore.applyToSchool');
  },

  dropOut: (): void => {
    throw new Error('TODO:gameStore.dropOut');
  },

  setStudyHard: (on: boolean): void => {
    throw new Error('TODO:gameStore.setStudyHard');
  },

  buyAsset: (defId: string, withLoan?: boolean): { ok: boolean; reason?: string } => {
    throw new Error('TODO:gameStore.buyAsset');
  },

  sellAsset: (assetId: string): void => {
    throw new Error('TODO:gameStore.sellAsset');
  },

  deposit: (kind: keyof Investments, amount: number): boolean => {
    throw new Error('TODO:gameStore.deposit');
  },

  withdraw: (kind: keyof Investments, amount: number): boolean => {
    throw new Error('TODO:gameStore.withdraw');
  },

  takeLoan: (amount: number): { ok: boolean; reason?: string } => {
    throw new Error('TODO:gameStore.takeLoan');
  },

  repayLoan: (loanId: string, amount: number): void => {
    throw new Error('TODO:gameStore.repayLoan');
  },

  emigrate: (countryId: string): { ok: boolean; reason?: string; text?: string } => {
    throw new Error('TODO:gameStore.emigrate');
  },

  /** Deals a hand and holds the table in `casino` until it is cleared. */
  startBlackjack: (bet: number): void => {
    throw new Error('TODO:gameStore.startBlackjack');
  },

  blackjackHit: (): void => {
    throw new Error('TODO:gameStore.blackjackHit');
  },

  blackjackStand: (): void => {
    throw new Error('TODO:gameStore.blackjackStand');
  },

  /** Drops the finished table so the casino sheet returns to its menu. */
  clearCasino: (): void => {
    throw new Error('TODO:gameStore.clearCasino');
  },

  spinSlots: (bet: number): SlotsResult | null => {
    throw new Error('TODO:gameStore.spinSlots');
  },

  buyLottery: (): LotteryResult | null => {
    throw new Error('TODO:gameStore.buyLottery');
  },

  /** Continues into the next generation as the chosen child. */
  startLegacy: (childId: string): void => {
    throw new Error('TODO:gameStore.startLegacy');
  },

  /** Leaves the current life without continuing it and returns to the slot list. */
  abandonLife: (): void => {
    throw new Error('TODO:gameStore.abandonLife');
  },

  /** Forces a write of the loaded slot. */
  saveNow: (): void => {
    throw new Error('TODO:gameStore.saveNow');
  },
}));
