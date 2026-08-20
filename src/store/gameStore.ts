/**
 * The game facade: the only thing the UI calls to change a life.
 *
 * Implementation contract for every mutating action — the engine mutates
 * `GameState` in place, so each action must re-spread the game object into
 * `set()` for React to see the change, autosave the slot via `saveGame`, and
 * run `evaluateAchievements`, pushing a toast for each newly unlocked id. That
 * contract is `commit`, and `withLife` is how an ordinary action reaches it:
 * guard, engine call, commit, written once rather than once per action.
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
import { fmtMoney } from '@/engine/format';
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
  slotKey,
  tableKey,
} from '@/engine/save';
import type { LoadFailure, LoadResult, SlotRow, StorageAdapter } from '@/engine/save';
import { createLife, emigrateTo, LIFE_OVER, lifeIsOver } from '@/engine/state';
import { useUiStore } from '@/store/uiStore';
import type {
  AchievementDef,
  ContentRegistry,
  GameState,
  Gender,
  Investments,
  PendingEvent,
} from '@/types';

/**
 * What `loadSlot` answers: the loader's own verdict on the read it just made.
 *
 * The reason travels with the refusal so the load menu can word it without
 * parsing the slot a second time — a second read is both the wasted work of
 * re-parsing a whole life and a chance for the two answers to disagree.
 * `repairs`, when present, names the fields the loader had to fill in, so a
 * recovered life can say so instead of resuming as if nothing had happened.
 */
export type SlotLoadResult = { ok: true; repairs?: string[] } | { ok: false; reason: LoadFailure };

/**
 * What a mutating action answers: an outcome a sheet can put straight in a
 * toast, refusals included.
 *
 * The refusal carries prose rather than a code because the refusal is decided
 * here, and it has to be decided somewhere only one layer knows: a sheet that
 * infers "was that allowed?" from the state afterwards, or that re-types a
 * threshold the engine owns, is one engine change away from telling the player
 * something that is no longer true. `text` is the headline a success carries
 * when the engine wrote one worth repeating.
 */
export type ActionResult = { ok: true; text?: string } | { ok: false; reason: string };

/** The same answer, carrying whatever the action produced on the way. */
export type ActionResultWith<T> = { ok: true; result: T } | { ok: false; reason: string };

/**
 * What an activity or a crime narrates back.
 *
 * A headline, not a verdict — it is what happened, and it is shown whether the
 * attempt went well or badly — which is why these two actions are the ones that
 * do not answer in `ActionResult`.
 */
export interface Headline {
  text: string;
  icon: string;
}

/** What the create-a-life screen collects; unset fields are rolled from the seed. */
export interface NewLifeOptions {
  slot: number;
  seed?: number;
  firstName?: string;
  lastName?: string;
  gender?: Gender;
  countryId?: string;
}

/**
 * Two answer shapes, and no third one: `ActionResult` for anything the player
 * asks the life to do — so every button can say what happened, including the
 * ones whose engine call is a no-op — and `Headline` for the two actions that
 * narrate rather than decide. The few that pass an engine's own `{ ok, reason? }`
 * straight through keep that shape, which `ActionResult` is the narrowing of.
 */
interface GameStore {
  game: GameState | null;
  slot: number | null;
  unlocked: string[];
  casino: BlackjackTable | null;

  beginNewLife(slot: number): void;
  newLife(opts: NewLifeOptions): void;
  loadSlot(slot: number): SlotLoadResult;
  deleteSlot(slot: number): void;
  slotSummaries(): SlotRow[];

  ageUp(): void;
  choose(index: number): void;

  interact(id: string, targetId?: string): Headline | null;
  crime(crimeId: string): Headline | null;

  applyForJob(jobId: string): { ok: boolean; reason?: string };
  quitJob(): ActionResult;
  setWorkHard(on: boolean): ActionResult;
  askForRaise(): ActionResult;

  applyToSchool(schoolId: string, major?: string): { ok: boolean; reason?: string };
  dropOut(): ActionResult;
  setStudyHard(on: boolean): ActionResult;

  buyAsset(defId: string, withLoan?: boolean): { ok: boolean; reason?: string };
  sellAsset(assetId: string): ActionResult;
  deposit(kind: keyof Investments, amount: number): ActionResult;
  withdraw(kind: keyof Investments, amount: number): ActionResult;
  takeLoan(amount: number): { ok: boolean; reason?: string };
  repayLoan(loanId: string, amount: number): ActionResult;

  emigrate(countryId: string): { ok: boolean; reason?: string; text?: string };

  startBlackjack(bet: number): ActionResult;
  blackjackHit(): void;
  blackjackStand(): void;
  clearCasino(): void;
  spinSlots(bet: number): ActionResultWith<SlotsResult>;
  buyLottery(): ActionResultWith<LotteryResult>;

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
   silently forfeited by a mid-hand reload. `save.ts` owns the key name, as it
   owns every other `ol.*` name; only the reading and writing live here, where
   `BlackjackTable` is a type the layer is allowed to know.

   `commit` is what calls this for a table a life still holds, so `casino` and
   the key are decided by one expression and cannot drift; the three callers
   outside it (`newLife`, `startLegacy`, `clearCasino`) are the ones erasing a
   hand no life in memory holds any more. */
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

/**
 * The table a life in this phase may still hold — the one decision `casino` and
 * its sidecar are both made from.
 *
 * A finished life is closed to play: `gambling` refuses to deal, hit or stand on
 * one, and the casino sheet is unreachable from the death screen. So a hand
 * still open when the character dies can never reach the settlement that pays
 * anything back; left as it is, it sits in `casino` and in the slot for good,
 * holding a stake charged out of a balance nothing will ever return it to.
 * Folding closes the table and hands that stake back — no card drawn, so no
 * later roll moves. A table that is already finished is inert and comes back
 * untouched, which is what keeps a refused deal on a dead life exactly as
 * cheap as it is on a living one, and one stake from being refunded twice.
 */
function tableForPhase(game: GameState, table: BlackjackTable | null): BlackjackTable | null {
  if (table === null || table.done || game.phase !== 'dead') {
    return table;
  }
  return gambling.foldBlackjack(game, table);
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

/**
 * The stamp `ol.save.<slot>` carries now; 0 when it holds nothing readable.
 *
 * Read through `save.ts`'s own key rather than a second spelling of it, and
 * read shallowly rather than through `listSlots`, which parses all six saves to
 * answer a question about one.
 */
function storedSavedAt(slot: number): number {
  try {
    const raw = storage.getItem(slotKey(slot));
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
 * Whether the slot's writes are being refused, and so whether the player has
 * already been told that the game is no longer being saved.
 *
 * A storage that throws — a full origin, or one where site data is blocked
 * mid-session — must not stop play: the life in memory carries on exactly as it
 * did, which is why every write here is wrapped. But that is also the one
 * failure the player cannot see, and it costs them the whole session on reload.
 * So it is said the once, at the moment the guarantee breaks, and said again
 * only after a write has landed in between; a toast a year would drown the game
 * and would say nothing new.
 */
let autosaveBroken = false;

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

/** What every action answers a caller with no life loaded to run it on. */
const NO_LIFE = 'No life loaded.';

/**
 * The bet limits `content/gambling` enforces without exporting them.
 *
 * The refusals are worded here, so the wording has to know the number the table
 * refuses on — the alternative is what these replace: a sheet reading the
 * engine's refusal sentinel back out of the store and writing its own prose
 * around it, three layers from the rule. `gameStore.test.ts` plays each limit's
 * first accepted and first refused bet through the engine itself, so a limit
 * that moves there fails a test here rather than mis-wording a toast.
 */
const MIN_BLACKJACK_BET = 10;
const MIN_SLOT_BET = 5;
const MAX_SLOT_BET = 1000;

/** A stake as the tables read one: whole dollars, and junk is worth nothing. */
function wholeBet(bet: number): number {
  return Number.isFinite(bet) ? Math.floor(bet) : 0;
}

/** What the character can put on a table; an unreadable balance buys nothing. */
function bankroll(game: GameState): number {
  const held = game.character.money;
  return Number.isFinite(held) ? held : 0;
}

/**
 * Why a table would refuse this stake, or null when it would take it.
 *
 * Asked before the engine is called, never after. Every game in `gambling`
 * refuses for free — nothing charged, nothing drawn, nothing logged — so a
 * refusal decided here leaves exactly the state a refusal there would have
 * left, and the player is told the rule instead of being handed an inert table
 * or three blocked reels to interpret.
 */
function betRefusal(game: GameState, stake: number, min: number, max?: number): string | null {
  if (lifeIsOver(game)) {
    return LIFE_OVER;
  }
  if (stake < min) {
    return `The minimum bet is ${fmtMoney(min)}.`;
  }
  if (max !== undefined && stake > max) {
    return `The most you can bet is ${fmtMoney(max)}.`;
  }
  if (stake > bankroll(game)) {
    return "You can't cover that bet.";
  }
  return null;
}

/**
 * Why an action against the job would do nothing, or null when it will.
 *
 * These read the same predicate the engine guards on, before it runs, because
 * the engine answers a refused `quitJob` or `setWorkHard` with nothing at all:
 * the store cannot ask afterwards whether anything happened, and a button that
 * silently does nothing is the one outcome the player cannot tell from a bug.
 */
function jobRefusal(game: GameState): string | null {
  if (lifeIsOver(game)) {
    return LIFE_OVER;
  }
  /* The engine's own falsy test rather than a `=== null` narrowing of it: a
     drifted save can hold nothing at all here, and both must refuse alike. */
  return game.character.job ? null : "You don't have a job.";
}

/** Why an action against a desk would do nothing, or null when it will. */
function enrolmentRefusal(game: GameState): string | null {
  if (lifeIsOver(game)) {
    return LIFE_OVER;
  }
  return game.character.education.enrolledIn === undefined ? "You're not enrolled." : null;
}

/** Why the sale would do nothing, or null when the asset is there to sell. */
function saleRefusal(game: GameState, assetId: string): string | null {
  if (lifeIsOver(game)) {
    return LIFE_OVER;
  }
  const owned = game.character.assets.some((held) => held.id === assetId);
  return owned ? null : "You don't own that.";
}

/**
 * Why the repayment would move nothing, or null when it will.
 *
 * The same arithmetic `finance.repayLoan` refuses on: the payment is capped by
 * the cash on hand and by what is left of the loan, so a tap with an empty
 * wallet moves zero dollars and writes no line.
 */
function repaymentRefusal(game: GameState, loanId: string, amount: number): string | null {
  if (lifeIsOver(game)) {
    return LIFE_OVER;
  }
  const c = game.character;
  const loan = c.loans.find((held) => held.id === loanId);
  if (loan === undefined) {
    return "You don't owe that.";
  }
  return Math.round(Math.min(amount, c.money, loan.principal)) > 0 ? null : 'Nothing to pay with.';
}

/**
 * Why the investment move was refused, read after the engine has answered it.
 *
 * Safe in that order, unlike the ones above: a refused move writes nothing, so
 * the balances read here are the ones the engine read. Only the caller knows
 * which side of the move ran out, so it names that one cause.
 */
function moveRefusal(game: GameState, amount: number, tooMuch: string): string {
  if (lifeIsOver(game)) {
    return LIFE_OVER;
  }
  const moved = Math.round(amount);
  return Number.isFinite(moved) && moved > 0 ? tooMuch : 'Enter an amount to move.';
}

/** Sends the UI wherever the life's phase demands after a mutation. */
function routePhase(game: GameState): void {
  const ui = useUiStore.getState();
  if (game.phase === 'dead') {
    ui.closeAllSheets();
    ui.setScreen('death');
    return;
  }
  /* Both directions out of one expression: the event sheet is up exactly while
     a card is waiting. Split into an opening rule and a closing one, the two
     can disagree about where that sheet may sit, and an entry left under
     another sheet is then neither answerable nor clearable — `setEventSheet`
     is where that whole rule lives. */
  ui.setEventSheet(game.phase === 'awaitingChoice');
}

export const useGameStore = create<GameStore>()((set, get) => {
  /** The funnel every mutating action ends in: settles the blackjack table
      against the life's phase, sweeps achievements against the cross-life list,
      autosaves the loaded slot, re-spreads the game object so React sees the
      in-place mutation, then routes the UI on the phase. */
  const commit = (game: GameState, extra?: { casino: BlackjackTable | null }): void => {
    const reg = getRegistry();
    const { slot, unlocked, casino: heldTable } = get();

    /* Settled first, ahead of the sweep and the write below, because folding
       pays a stake back into `game`: decided after them, the refund would miss
       both the achievement it might unlock and the save the player reloads. */
    const table = tableForPhase(game, extra === undefined ? heldTable : extra.casino);

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
          // A write that landed makes the next break news again.
          autosaveBroken = false;
        } catch {
          /* The autosave is lost but play continues — and the player is told
             that it is, once per episode, because nothing else in the game
             shows it. */
          if (!autosaveBroken) {
            autosaveBroken = true;
            useUiStore.getState().addToast({
              icon: '⚠️',
              title: 'Progress is not being saved',
              subtitle: 'Storage is full or unavailable.',
            });
          }
        }
      }
    }

    set({ game: { ...game }, unlocked: nextUnlocked, casino: table });
    /* The key follows the table it mirrors, once per change rather than once
       per gambling action, and after the ownership check above — whose verdict
       is exactly what `writeTableSidecar` reads before it writes. */
    if (table !== heldTable) {
      writeTableSidecar(slot, table);
    }
    routePhase(game);
  };

  /**
   * The shape an ordinary mutating action has: run `fn` against the loaded life
   * and commit it, or answer `absent` when there is no life to run it on.
   *
   * Only one half of that pair can be left out silently. An action that skips
   * `commit` still mutates `GameState` in place, so it plays out in the engine
   * and leaves both React and the autosave behind the life it just changed —
   * nothing in the types can see the omission, and the game looks fine until a
   * reload. Written here it cannot be omitted, and the actions that keep a body
   * of their own are then exactly the ones that genuinely differ: `ageUp`'s
   * phase guard, `choose`'s card guards, the blackjack trio's table argument,
   * `startLegacy`'s fresh state, and the ones that need no life loaded at all.
   *
   * `getRegistry()` is passed to every `fn`, including the ones that ignore it:
   * it is the same cached build `commit` reads a line later, so an action that
   * does not need it pays nothing for being handed it.
   */
  const withLife = <T>(absent: T, fn: (game: GameState, reg: ContentRegistry) => T): T => {
    const game = get().game;
    if (game === null) {
      return absent;
    }
    const out = fn(game, getRegistry());
    commit(game);
    return out;
  };

  return {
    game: null,
    slot: null,
    unlocked: readUnlocked(),
    casino: null,

    /**
     * Arms the create screen: the chosen slot becomes the pending one the next
     * `newLife` writes into, and whatever life is in memory is let go of.
     *
     * `slot` held with no `game` beside it is the one state where those two
     * disagree, and it is the whole protocol between the two screens — the load
     * menu names the slot, the create screen reads it back and hands it to
     * `newLife`. Written here, beside the action that reads it, rather than as
     * a `set` from the screen that starts it. Nothing on disk moves: the life
     * being let go of keeps its save in its own slot, and its blackjack hand
     * beside it, exactly as `abandonLife` leaves both.
     */
    beginNewLife: (slot: number): void => {
      set({ slot, game: null, casino: null });
    },

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

    /** Loads a slot into the store, reporting why when the slot will not open. */
    loadSlot: (slot: number): SlotLoadResult => {
      let result: LoadResult;
      try {
        result = loadGame(storage, slot);
      } catch {
        /* A read that threw says nothing about the payload — it may well still
           be there, unread — so this is `corrupt` rather than `empty`: what
           failed is the reading, and a slot the player has a life in must never
           report itself as free space. */
        return { ok: false, reason: 'corrupt' };
      }
      if (!result.ok) {
        return { ok: false, reason: result.reason };
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
      /* Absent rather than empty, exactly as `loadGame` reports it: presence is
         the whole test, so a save that needed nothing says nothing. */
      return result.repairs === undefined ? { ok: true } : { ok: true, repairs: result.repairs };
    },

    /** Erases a slot, clearing the store when that slot is the one loaded. */
    deleteSlot: (slot: number): void => {
      try {
        // The whole slot, sidecar included: `deleteSave` erases both keys.
        deleteSave(storage, slot);
      } catch {
        // Nothing readable to erase.
      }
      if (get().slot === slot) {
        set({ game: null, slot: null, casino: null });
      }
    },

    /** Slot descriptions for the load menu, damaged and future ones flagged. */
    slotSummaries: (): SlotRow[] => {
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
    interact: (id: string, targetId?: string): Headline | null => {
      /* Narrowed to the headline after the commit, not inside `fn`: what the UI
         shows is a read of the result, and keeping it out here leaves the
         commit in the one position every other action puts it. */
      const result = withLife(null, (g, reg) => runInteraction(g, reg, id, targetId));
      return result === null ? null : { text: result.text, icon: result.icon };
    },

    /** Commits a crime; returns its headline for the UI. */
    crime: (crimeId: string): Headline | null => {
      const result = withLife<Headline | null>(null, (g, reg) => commitCrime(g, reg, crimeId));
      return result === null ? null : { text: result.text, icon: result.icon };
    },

    applyForJob: (jobId: string): { ok: boolean; reason?: string } =>
      withLife({ ok: false, reason: NO_LIFE }, (g, reg) => career.applyForJob(g, reg, jobId)),

    quitJob: (): ActionResult =>
      withLife<ActionResult>({ ok: false, reason: NO_LIFE }, (g) => {
        /* Refused inside the callback rather than ahead of it, so the refusal
           still ends in the commit every `withLife` action ends in: nothing
           about a refusal argues for skipping it, and an action that quietly
           stopped flushing the life is the one bug no type can catch. */
        const refusal = jobRefusal(g);
        if (refusal !== null) {
          return { ok: false, reason: refusal };
        }
        career.quitJob(g);
        return { ok: true };
      }),

    setWorkHard: (on: boolean): ActionResult =>
      withLife<ActionResult>({ ok: false, reason: NO_LIFE }, (g) => {
        const refusal = jobRefusal(g);
        if (refusal !== null) {
          return { ok: false, reason: refusal };
        }
        career.setWorkHard(g, on);
        return { ok: true };
      }),

    /* The engine's own prose either way, under the field name every other
       action uses for it: the sheet reads one shape, not two. */
    askForRaise: (): ActionResult =>
      withLife<ActionResult>({ ok: false, reason: NO_LIFE }, (g, reg) => {
        const asked = career.askForRaise(g, reg);
        return asked.ok ? { ok: true, text: asked.text } : { ok: false, reason: asked.text };
      }),

    applyToSchool: (schoolId: string, major?: string): { ok: boolean; reason?: string } =>
      withLife({ ok: false, reason: NO_LIFE }, (g, reg) =>
        education.applyToSchool(g, reg, schoolId, major)
      ),

    dropOut: (): ActionResult =>
      withLife<ActionResult>({ ok: false, reason: NO_LIFE }, (g) => {
        const refusal = enrolmentRefusal(g);
        if (refusal !== null) {
          return { ok: false, reason: refusal };
        }
        education.dropOut(g);
        return { ok: true };
      }),

    setStudyHard: (on: boolean): ActionResult =>
      withLife<ActionResult>({ ok: false, reason: NO_LIFE }, (g) => {
        if (lifeIsOver(g)) {
          return { ok: false, reason: LIFE_OVER };
        }
        education.setStudyHard(g, on);
        return { ok: true };
      }),

    buyAsset: (defId: string, withLoan?: boolean): { ok: boolean; reason?: string } =>
      withLife({ ok: false, reason: NO_LIFE }, (g, reg) =>
        finance.buyAsset(g, reg, defId, withLoan)
      ),

    sellAsset: (assetId: string): ActionResult =>
      withLife<ActionResult>({ ok: false, reason: NO_LIFE }, (g) => {
        const refusal = saleRefusal(g, assetId);
        if (refusal !== null) {
          return { ok: false, reason: refusal };
        }
        finance.sellAsset(g, assetId);
        return { ok: true };
      }),

    deposit: (kind: keyof Investments, amount: number): ActionResult =>
      withLife<ActionResult>({ ok: false, reason: NO_LIFE }, (g) =>
        finance.depositInvestment(g, kind, amount)
          ? { ok: true }
          : { ok: false, reason: moveRefusal(g, amount, "You don't have that much.") }
      ),

    withdraw: (kind: keyof Investments, amount: number): ActionResult =>
      withLife<ActionResult>({ ok: false, reason: NO_LIFE }, (g) =>
        finance.withdrawInvestment(g, kind, amount)
          ? { ok: true }
          : { ok: false, reason: moveRefusal(g, amount, 'Not that much invested.') }
      ),

    takeLoan: (amount: number): { ok: boolean; reason?: string } =>
      withLife({ ok: false, reason: NO_LIFE }, (g, reg) => finance.takeLoan(g, reg, amount)),

    repayLoan: (loanId: string, amount: number): ActionResult =>
      withLife<ActionResult>({ ok: false, reason: NO_LIFE }, (g) => {
        const refusal = repaymentRefusal(g, loanId, amount);
        if (refusal !== null) {
          return { ok: false, reason: refusal };
        }
        finance.repayLoan(g, loanId, amount);
        return { ok: true };
      }),

    // A denied application still charges the fee and logs, so commit either way.
    emigrate: (countryId: string): { ok: boolean; reason?: string; text?: string } =>
      withLife({ ok: false, reason: NO_LIFE }, (g, reg) => emigrateTo(g, reg, countryId)),

    /** Deals a hand and holds the table in `casino` until it is cleared. */
    startBlackjack: (bet: number): ActionResult => {
      const { game, casino } = get();
      if (game === null) {
        return { ok: false, reason: NO_LIFE };
      }
      // Dealing over an unfinished hand would silently forfeit its stake.
      if (casino !== null && !casino.done) {
        return { ok: false, reason: 'Finish the hand you are playing.' };
      }
      const refusal = betRefusal(game, wholeBet(bet), MIN_BLACKJACK_BET);
      if (refusal !== null) {
        /* No engine call, so no commit either: a refused deal moves nothing,
           and the table it used to park in `casino` was only ever there for the
           casino sheet to recognise as a refusal and hide. */
        return { ok: false, reason: refusal };
      }
      const table = gambling.startBlackjack(game, getRegistry(), bet);
      commit(game, { casino: table });
      return { ok: true };
    },

    blackjackHit: (): void => {
      const { game, casino } = get();
      if (game === null || casino === null || casino.done) {
        return;
      }
      const table = gambling.blackjackHit(game, casino);
      commit(game, { casino: table });
    },

    blackjackStand: (): void => {
      const { game, casino } = get();
      if (game === null || casino === null || casino.done) {
        return;
      }
      const table = gambling.blackjackStand(game, casino);
      commit(game, { casino: table });
    },

    /** Drops the finished table so the casino sheet returns to its menu. */
    clearCasino: (): void => {
      writeTableSidecar(get().slot, null);
      set({ casino: null });
    },

    spinSlots: (bet: number): ActionResultWith<SlotsResult> =>
      withLife<ActionResultWith<SlotsResult>>({ ok: false, reason: NO_LIFE }, (g, reg) => {
        const refusal = betRefusal(g, wholeBet(bet), MIN_SLOT_BET, MAX_SLOT_BET);
        return refusal !== null
          ? { ok: false, reason: refusal }
          : { ok: true, result: gambling.spinSlots(g, reg, bet) };
      }),

    buyLottery: (): ActionResultWith<LotteryResult> =>
      withLife<ActionResultWith<LotteryResult>>({ ok: false, reason: NO_LIFE }, (g, reg) => {
        if (lifeIsOver(g)) {
          return { ok: false, reason: LIFE_OVER };
        }
        /* The refusal a caller cannot otherwise see: a ticket nobody could
           afford comes back from the engine looking exactly like a losing one,
           which is what had the casino sheet re-checking the price itself. */
        if (bankroll(g) < gambling.TICKET_PRICE) {
          return { ok: false, reason: "You can't afford a ticket." };
        }
        return { ok: true, result: gambling.buyLottery(g, reg) };
      }),

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
        /* Caught rather than pre-guarded, and the only call in the file written
           that way round: `engineStartLegacy` builds a fresh state and this
           adopts it only on success, so a throw leaves the loaded life exactly
           as it was. Where the engine mutates in place — `choose` above — the
           guard has to come first instead, because a throw from there has
           already half-applied the move to the live state. Either way, the UI
           only offers living children and a stale id is ignored. */
        return;
      }
      writeTableSidecar(get().slot, null);
      set({ game: next, casino: null });
      commit(next);
      const ui = useUiStore.getState();
      ui.closeAllSheets();
      ui.setScreen('life');
    },

    /**
     * Leaves the current life without continuing it and returns to the slot list.
     *
     * The one place `casino` is dropped without its sidecar: the save stays
     * exactly where it is, so a hand charged against that balance has to stay
     * beside it and be dealt back the next time the slot is opened — the same
     * way the balance itself survives. Erasing the slot is what erases both.
     */
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
        /* The save is lost but play continues. Counted as told without a toast
           of its own: the caller reports this write's outcome itself, and one
           tap must not raise two warnings about the same storage. */
        autosaveBroken = true;
        return false;
      }
      // A write that landed makes the autosave's next break news again.
      autosaveBroken = false;
      return storagePersists;
    },
  };
});

/** Swaps the storage adapter and clears any loaded life; tests only. */
export function resetGameStoreForTests(adapter?: StorageAdapter): void {
  storage = adapter ?? memoryStorage();
  /* An injected adapter is the caller's storage of record, so writes to it count
     as persisted; only the module's own fallback above reads as ephemeral. */
  storagePersists = true;
  // A fresh page load: this window has written no slot yet.
  slotOwnedAt = null;
  slotTakenOver = false;
  autosaveBroken = false;
  useGameStore.setState({ game: null, slot: null, casino: null, unlocked: readUnlocked() });
}
