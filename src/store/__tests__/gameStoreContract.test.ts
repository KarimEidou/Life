/**
 * The facade's commit contract, as a table rather than as one test per action.
 *
 * `gameStore.ts`'s header states it: the engine mutates `GameState` in place, so
 * every mutating action has to re-spread the game object, autosave the slot and
 * sweep achievements — that is `commit`, and `withLife` is how most actions
 * reach it. Nothing in the types can see an action that skips it: the life plays
 * out in the engine exactly as it should, while React re-renders nothing and the
 * slot saves nothing, and the game looks fine until a reload comes back years
 * behind. So the table below names every action that must reach `commit` and
 * every action that must not, and the first test holds that pair against the
 * store's own key list — adding an action without deciding which side it falls
 * on fails here rather than shipping.
 *
 * The other half of the facade contract — every action answering in its own
 * shape with no life loaded, writing nothing — is `gameStore.test.ts`'s
 * `with no life loaded` table, which also pins that the store object itself is
 * left untouched. It is not repeated here.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { getRegistry } from '@/content';
import { killCharacter } from '@/engine/death';
import { memoryStorage, saveUnlockedAchievements } from '@/engine/save';
import type { StorageAdapter } from '@/engine/save';
import { resetGameStoreForTests, useGameStore } from '@/store/gameStore';
import { resetUiStoreForTests } from '@/store/uiStore';
import type { GameState, Person } from '@/types';

type Store = ReturnType<typeof useGameStore.getState>;

/** The loaded life, or a loud failure when a step expected one and it is gone. */
function game(): GameState {
  const g = useGameStore.getState().game;
  if (g === null) {
    throw new Error('expected a loaded life');
  }
  return g;
}

/**
 * An unlock this window did not earn, already on the wall before the store reads
 * it — what a second window unlocked while this one was open.
 *
 * Not a shipped id: `commit` toasts only ids it just earned, so an id no
 * achievement defines can ride along without changing what the player sees.
 */
const CARRIED = 'ach-from-another-window';

let adapter: StorageAdapter;

beforeEach(() => {
  adapter = memoryStorage();
  saveUnlockedAchievements(adapter, [CARRIED]);
  resetGameStoreForTests(adapter);
  resetUiStoreForTests(memoryStorage());
});

/**
 * A thirty-year-old with a job, a desk, a car, a loan, savings and a bankroll,
 * so most rows below take their accepted path rather than their refusal.
 *
 * The direct mutations are flushed through a cheap committed action, exactly as
 * `gameStore.test.ts`'s setups do it.
 */
function setUpFullLife(): void {
  useGameStore.getState().newLife({ slot: 1, seed: 21 });
  const c = game().character;
  c.age = 30;
  c.money = 5000;
  c.job = {
    jobId: 'job-barista-pt',
    title: 'Barista',
    salary: 30000,
    years: 2,
    performance: 40,
    workHard: false,
  };
  c.education.enrolledIn = 'uni';
  c.assets.push({
    id: 'a1',
    defId: 'veh-beater',
    label: 'Rusty Beater',
    paid: 2000,
    value: 1800,
    yearBought: 28,
  });
  c.loans.push({ id: 'l1', kind: 'personal', principal: 4000, apr: 0.09 });
  c.investments.savings = 1000;
  useGameStore.getState().setStudyHard(false);
}

/** Deals until a hand survives the deal; an immediate blackjack settles at once. */
function dealOpenHand(): void {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    useGameStore.getState().startBlackjack(50);
    if (useGameStore.getState().casino?.done === false) {
      return;
    }
    useGameStore.getState().clearCasino();
  }
  throw new Error('never dealt an open hand');
}

/** Parks the life on a card the registry no longer has, so a choice is due. */
function queueDriftedCard(): void {
  game().pending.push({
    eventId: 'ev-no-longer-shipped',
    text: 'A moment passes.',
    icon: '❓',
    choices: [{ label: 'Shrug' }],
  });
  game().phase = 'awaitingChoice';
}

/** Ends the life with a child to continue it as. */
function leaveAnHeir(): void {
  const child: Person = {
    id: 'p99',
    kind: 'child',
    name: 'Kid Heir',
    gender: 'male',
    age: 10,
    alive: true,
    rel: 80,
    flags: {},
  };
  game().people[child.id] = child;
  killCharacter(game(), getRegistry(), 'test');
  // Flushed through an action, so the dead life is the one the row starts from.
  useGameStore.getState().setWorkHard(false);
}

/** One action, and whatever it needs in place beyond the loaded life. */
interface CommitCase {
  name: string;
  prepare?: () => void;
  run: (s: Store) => void;
}

/**
 * Every action that must end in `commit`, and the setup each one needs to reach
 * it.
 *
 * For the actions written through `withLife` a refused call belongs here as much
 * as an accepted one: it commits either way on purpose, because nothing about a
 * refusal argues for leaving the life unflushed. The ones with hand-written
 * bodies get the setup that takes them down their accepted path instead, since
 * their `commit` is spelled out one branch at a time — and `startBlackjack` is
 * the one action whose refusal must *not* commit, a refused deal having moved
 * nothing at all.
 */
const COMMITTING: CommitCase[] = [
  { name: 'newLife', run: (s) => s.newLife({ slot: 1, seed: 5 }) },
  { name: 'ageUp', run: (s) => s.ageUp() },
  { name: 'choose', prepare: queueDriftedCard, run: (s) => s.choose(0) },
  { name: 'interact', run: (s) => s.interact('act-gym') },
  { name: 'crime', run: (s) => s.crime('crime-shoplift') },
  { name: 'applyForJob', run: (s) => s.applyForJob('job-barista-pt') },
  { name: 'quitJob', run: (s) => s.quitJob() },
  { name: 'setWorkHard', run: (s) => s.setWorkHard(true) },
  { name: 'askForRaise', run: (s) => s.askForRaise() },
  { name: 'applyToSchool', run: (s) => s.applyToSchool('uni') },
  { name: 'dropOut', run: (s) => s.dropOut() },
  { name: 'setStudyHard', run: (s) => s.setStudyHard(true) },
  { name: 'buyAsset', run: (s) => s.buyAsset('veh-beater') },
  { name: 'sellAsset', run: (s) => s.sellAsset('a1') },
  { name: 'deposit', run: (s) => s.deposit('savings', 100) },
  { name: 'withdraw', run: (s) => s.withdraw('savings', 100) },
  { name: 'takeLoan', run: (s) => s.takeLoan(1000) },
  { name: 'repayLoan', run: (s) => s.repayLoan('l1', 100) },
  { name: 'emigrate', run: (s) => s.emigrate('jp') },
  { name: 'startBlackjack', run: (s) => s.startBlackjack(50) },
  { name: 'blackjackHit', prepare: dealOpenHand, run: (s) => s.blackjackHit() },
  { name: 'blackjackStand', prepare: dealOpenHand, run: (s) => s.blackjackStand() },
  { name: 'spinSlots', run: (s) => s.spinSlots(5) },
  { name: 'buyLottery', run: (s) => s.buyLottery() },
  { name: 'startLegacy', prepare: leaveAnHeir, run: (s) => s.startLegacy('p99') },
];

/** The rest of the facade, and why a commit would be wrong rather than missing. */
const NON_COMMITTING: Record<string, string> = {
  beginNewLife: 'arms a slot for the create screen; there is no life to flush',
  loadSlot: 'adopts a life it just read, and routes it itself',
  deleteSlot: 'erases a slot; the life it clears must not be written back',
  slotSummaries: 'a read the slots screen runs on every render',
  clearCasino: 'drops a settled table only; re-spreading the game would be a lie',
  abandonLife: 'lets a life go, leaving its save exactly where it is',
  saveNow: 'writes the slot itself, and reports that write to its caller',
};

/** Every callable the facade exposes, as the store itself reports them. */
function facadeActions(): string[] {
  const state = useGameStore.getState();
  return Object.keys(state)
    .filter((key) => typeof state[key as keyof Store] === 'function')
    .sort();
}

describe('the facade action surface', () => {
  it('is accounted for, action by action, by the two lists above', () => {
    const named = [...COMMITTING.map((c) => c.name), ...Object.keys(NON_COMMITTING)].sort();
    expect(named).toEqual(facadeActions());
  });
});

/** The three things a commit leaves behind, checked against the life it left. */
function expectCommitted(before: GameState, unlockedBefore: readonly string[]): void {
  const s = useGameStore.getState();
  /* Only the top-level object gets a fresh identity per commit — that is what
     components subscribe to — so an action that skips it changes a life React
     never re-renders. */
  expect(s.game).not.toBe(before);

  // And the slot holds what the screen holds, without waiting for another action.
  const live = game();
  const row = s.slotSummaries()[0];
  expect(row?.age).toBe(live.character.age);
  expect(row?.money).toBe(live.character.money);
  /* The whole life, not just the two fields the load menu shows: a save made
     before an action that only moved a flag still carries the right age and
     money, so those alone would let that action skip its commit unnoticed. */
  const raw = adapter.getItem('ol.save.1');
  const envelope = JSON.parse(raw ?? 'null') as { state: unknown } | null;
  expect(envelope?.state).toEqual(JSON.parse(JSON.stringify(live)));

  // The achievement wall is global and append-only across windows and lives.
  for (const id of unlockedBefore) {
    expect(s.unlocked).toContain(id);
  }
}

describe('every mutating action commits the life it just changed', () => {
  for (const action of COMMITTING) {
    it(action.name, () => {
      setUpFullLife();
      action.prepare?.();
      const before = game();
      const unlockedBefore = useGameStore.getState().unlocked;
      expect(unlockedBefore).toContain(CARRIED);

      action.run(useGameStore.getState());

      expectCommitted(before, unlockedBefore);
    });
  }
});
