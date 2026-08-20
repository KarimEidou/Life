import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getRegistry } from '@/content';
import type { BlackjackTable } from '@/content/gambling';
import { killCharacter } from '@/engine/death';
import {
  loadUnlockedAchievements,
  memoryStorage,
  saveGame,
  saveUnlockedAchievements,
} from '@/engine/save';
import type { StorageAdapter } from '@/engine/save';
import { resetGameStoreForTests, useGameStore } from '@/store/gameStore';
import type { ActionResult, ActionResultWith } from '@/store/gameStore';
import { resetUiStoreForTests, useUiStore } from '@/store/uiStore';
import type { SheetEntry } from '@/store/uiStore';
import { SAVE_VERSION } from '@/types';
import type { AchievementDef, GameState, PendingEvent, Person } from '@/types';

/** The loaded life, or a loud failure when a step expected one and it is gone. */
function game(): GameState {
  const g = useGameStore.getState().game;
  if (g === null) {
    throw new Error('expected a loaded life');
  }
  return g;
}

/** The open blackjack table, or a loud failure when a step expected one. */
function casinoTable(): BlackjackTable {
  const t = useGameStore.getState().casino;
  if (t === null) {
    throw new Error('expected an open blackjack table');
  }
  return t;
}

/** What the table paid out, or a loud failure when it refused the bet instead. */
function played<T>(result: ActionResultWith<T>): T {
  if (!result.ok) {
    throw new Error(`expected the bet to be taken, refused with: ${result.reason}`);
  }
  return result.result;
}

function hasEventSheet(): boolean {
  return useUiStore.getState().sheets.some((s) => s.id === 'event');
}

/** Ages `years` years, answering every pending choice with the first option. */
function stepYears(years: number, cap = 60): void {
  const start = game().character.age;
  let steps = 0;
  while (game().character.age < start + years && game().phase !== 'dead' && steps < cap) {
    if (game().phase === 'awaitingChoice') {
      useGameStore.getState().choose(0);
    } else {
      useGameStore.getState().ageUp();
    }
    steps += 1;
  }
}

/** A memory adapter that can be made to refuse writes, as a full origin does. */
function blockableStorage(): { adapter: StorageAdapter; block: () => void; unblock: () => void } {
  const inner = memoryStorage();
  let blocked = false;
  return {
    adapter: {
      getItem: (k: string): string | null => inner.getItem(k),
      setItem: (k: string, v: string): void => {
        if (blocked) {
          throw new Error('QuotaExceededError');
        }
        inner.setItem(k, v);
      },
      removeItem: (k: string): void => {
        inner.removeItem(k);
      },
    },
    block: (): void => {
      blocked = true;
    },
    unblock: (): void => {
      blocked = false;
    },
  };
}

beforeEach(() => {
  resetGameStoreForTests(memoryStorage());
  /* The ui store's own seam, not a hand-rolled `setState`: that one has to
     restate the store's field list — it silently left `settings` and the toast-id
     counter behind — and the router these tests drive writes into both stores. */
  resetUiStoreForTests(memoryStorage());
});

describe('newLife', () => {
  it('respects provided names, gender and country', () => {
    useGameStore.getState().newLife({
      slot: 2,
      seed: 5,
      firstName: 'Zed',
      lastName: 'Quux',
      gender: 'nonbinary',
      countryId: 'jp',
    });
    const c = game().character;
    expect(c.firstName).toBe('Zed');
    expect(c.lastName).toBe('Quux');
    expect(c.gender).toBe('nonbinary');
    expect(c.countryId).toBe('jp');
    expect(game().seed).toBe(5);
  });

  it('rolls a finite seed when none is given', () => {
    useGameStore.getState().newLife({ slot: 1 });
    expect(Number.isFinite(game().seed)).toBe(true);
  });

  it('rolls the same first name and stats for the same seed', () => {
    useGameStore.getState().newLife({ slot: 1, seed: 1234 });
    const firstName = game().character.firstName;
    const stats = { ...game().character.stats };

    resetGameStoreForTests(memoryStorage());
    useGameStore.getState().newLife({ slot: 1, seed: 1234 });
    expect(game().character.firstName).toBe(firstName);
    expect(game().character.stats).toEqual(stats);
  });

  it('writes the slot and routes to the life screen', () => {
    useGameStore.getState().newLife({ slot: 1, seed: 7 });
    expect(useGameStore.getState().slotSummaries()[0]?.empty).toBe(false);
    expect(useUiStore.getState().screen).toBe('life');
  });
});

/* The half of creating a life that happens before the create screen: the load
   menu names a slot, and that slot has to survive the trip with nothing else
   changed — the player has not agreed to overwrite anything yet, and Back is
   still an answer. */
describe('beginNewLife', () => {
  it('arms the chosen slot without opening it or erasing what is in it', () => {
    useGameStore.getState().newLife({ slot: 4, seed: 7 });
    useGameStore.getState().abandonLife();

    useGameStore.getState().beginNewLife(4);

    const s = useGameStore.getState();
    expect(s.slot).toBe(4);
    expect(s.game).toBeNull();
    expect(s.casino).toBeNull();
    // Still the old life on disk: only `newLife` writes over a slot.
    expect(s.slotSummaries()[3]?.empty).toBe(false);
    // And the navigation is the screen's to do, not this action's.
    expect(useUiStore.getState().screen).toBe('slots');
  });

  it('lets go of the life in memory, leaving its own slot saved', () => {
    useGameStore.getState().newLife({ slot: 1, seed: 42 });
    stepYears(3);
    const age = game().character.age;

    useGameStore.getState().beginNewLife(5);
    expect(useGameStore.getState().game).toBeNull();
    expect(useGameStore.getState().slot).toBe(5);

    // The life it dropped is where it was left, reachable from the load menu.
    expect(useGameStore.getState().loadSlot(1).ok).toBe(true);
    expect(game().character.age).toBe(age);
  });
});

describe('save/load roundtrip', () => {
  it('restores age and log length from the saved slot', () => {
    useGameStore.getState().newLife({ slot: 1, seed: 42 });
    stepYears(3);
    const age = game().character.age;
    const logLength = game().log.length;
    expect(age).toBeGreaterThan(0);

    useGameStore.setState({ game: null });
    // A save that needed nothing filling in reports no repairs at all.
    expect(useGameStore.getState().loadSlot(1)).toEqual({ ok: true });
    expect(game().character.age).toBe(age);
    expect(game().log.length).toBe(logLength);
  });

  it('refuses to load an empty slot', () => {
    useGameStore.getState().newLife({ slot: 1, seed: 42 });
    expect(useGameStore.getState().loadSlot(3)).toEqual({ ok: false, reason: 'empty' });
  });

  it('reports a payload it cannot parse as corrupt', () => {
    const storage = memoryStorage();
    resetGameStoreForTests(storage);
    // A write cut short by a full origin: the key is occupied, the JSON is not.
    storage.setItem('ol.save.3', '{');

    expect(useGameStore.getState().loadSlot(3)).toEqual({ ok: false, reason: 'corrupt' });
    // Nothing was adopted: a refused slot leaves the store where it was.
    expect(useGameStore.getState().game).toBeNull();
  });

  it('reports a save from a newer build as future', () => {
    const storage = memoryStorage();
    resetGameStoreForTests(storage);
    storage.setItem(
      'ol.save.3',
      JSON.stringify({
        version: SAVE_VERSION + 1,
        savedAt: 6,
        slot: 3,
        state: { character: { firstName: 'Ada', lastName: 'Byron', age: 34 } },
      })
    );

    expect(useGameStore.getState().loadSlot(3)).toEqual({ ok: false, reason: 'future' });
  });

  it('reports a storage read that throws as corrupt', () => {
    /* The slot may well still hold the life this adapter would not hand over,
       so the read that failed must not come back as "nothing is stored here". */
    resetGameStoreForTests({
      getItem: (): string | null => {
        throw new Error('storage is unavailable');
      },
      setItem: (): void => {},
      removeItem: (): void => {},
    });

    expect(useGameStore.getState().loadSlot(1)).toEqual({ ok: false, reason: 'corrupt' });
  });

  it('names the fields a damaged save had to have filled in', () => {
    const storage = memoryStorage();
    resetGameStoreForTests(storage);
    useGameStore.getState().newLife({ slot: 1, seed: 42 });
    stepYears(2);

    // A save a field short: readable as a life, but not as the one written.
    const raw = storage.getItem('ol.save.1');
    if (raw === null) {
      throw new Error('expected an autosaved slot');
    }
    const envelope = JSON.parse(raw) as { state: Record<string, unknown> };
    envelope.state.log = 'not a log';
    storage.setItem('ol.save.1', JSON.stringify(envelope));

    resetGameStoreForTests(storage);
    expect(useGameStore.getState().loadSlot(1)).toEqual({ ok: true, repairs: ['log'] });
    // Recovered, and playable: the repaired container is the one the feed reads.
    expect(game().log).toEqual([]);
  });
});

describe('event routing', () => {
  it('opens the event sheet on awaitingChoice and pops it when the queue empties', () => {
    useGameStore.getState().newLife({ slot: 1, seed: 7 });
    let sawChoice = false;

    for (let i = 0; i < 80 && game().phase !== 'dead'; i += 1) {
      if (game().phase === 'awaitingChoice') {
        sawChoice = true;
        expect(hasEventSheet()).toBe(true);
        useGameStore.getState().choose(0);
        if (game().phase === 'alive') {
          // Queue drained: the router must have popped the sheet it pushed.
          expect(hasEventSheet()).toBe(false);
        } else if (game().phase === 'dead') {
          expect(useUiStore.getState().screen).toBe('death');
          expect(useUiStore.getState().sheets).toEqual([]);
        }
      } else {
        useGameStore.getState().ageUp();
      }
    }

    expect(sawChoice).toBe(true);
  });

  /** The stack the router has to answer for as well as the ones it builds: an
      event entry under another sheet renders no card and cannot be dismissed,
      so leaving it there costs the player the life. */
  function buryEventSheet(): void {
    /* Hand-built entries: no action can bury one. The keys are well past
       anything the store's counter reaches from a reset, so an entry the test
       wrote and one the router mints can never collide on a key. */
    const buried: SheetEntry[] = [
      { id: 'event', key: 101 },
      { id: 'more', key: 102 },
    ];
    useUiStore.setState({ sheets: buried });
  }

  it('brings a buried event sheet back on top when a choice is due', () => {
    useGameStore.getState().newLife({ slot: 1, seed: 9 });
    game().pending.push({
      eventId: 'drifted',
      text: 'A moment passes.',
      icon: '❓',
      choices: [{ label: 'Shrug' }],
    });
    game().phase = 'awaitingChoice';
    buryEventSheet();
    const age = game().character.age;

    // The phase guard sends this straight to the router instead of aging.
    useGameStore.getState().ageUp();

    expect(game().character.age).toBe(age);
    expect(useUiStore.getState().sheets.map((s) => s.id)).toEqual(['more', 'event']);
  });

  it('clears a buried event sheet when no choice is due', () => {
    useGameStore.getState().newLife({ slot: 1, seed: 9 });
    expect(game().phase).toBe('alive');
    buryEventSheet();

    // Any committing action re-routes; this one refuses and commits regardless.
    useGameStore.getState().setWorkHard(false);

    expect(useUiStore.getState().sheets.map((s) => s.id)).toEqual(['more']);
  });
});

describe('death routing', () => {
  it('routes to the death screen and freezes the finished life', () => {
    useGameStore.getState().newLife({ slot: 1, seed: 11 });
    for (let i = 0; i < 150 && game().phase !== 'dead'; i += 1) {
      if (game().phase === 'awaitingChoice') {
        useGameStore.getState().choose(0);
      } else {
        useGameStore.getState().ageUp();
      }
    }

    expect(game().phase).toBe('dead');
    expect(useUiStore.getState().screen).toBe('death');
    expect(useUiStore.getState().sheets).toEqual([]);
    expect(game().death).toBeDefined();

    const age = game().character.age;
    expect(() => useGameStore.getState().ageUp()).not.toThrow();
    expect(game().character.age).toBe(age);
  });
});

describe('achievements', () => {
  it('unlocks once, toasts once per id, and re-hydrates from storage', () => {
    const adapter = memoryStorage();
    resetGameStoreForTests(adapter);
    useGameStore.getState().newLife({ slot: 1, seed: 3 });
    expect(useGameStore.getState().unlocked).toEqual([]);

    const toastsBefore = useUiStore.getState().toasts.length;
    game().character.money = 2_000_000;
    useGameStore.getState().setWorkHard(false);

    const unlocked = useGameStore.getState().unlocked;
    expect(unlocked).toContain('ach-millionaire');
    expect(unlocked.length).toBeGreaterThan(0);
    expect(useUiStore.getState().toasts.length).toBe(toastsBefore + unlocked.length);

    // A later commit against the same state must not re-toast the same ids.
    useGameStore.getState().setWorkHard(false);
    expect(useGameStore.getState().unlocked).toEqual(unlocked);
    expect(useUiStore.getState().toasts.length).toBe(toastsBefore + unlocked.length);

    // Unlocks are cross-life: a reset against the same adapter reads them back.
    resetGameStoreForTests(adapter);
    expect(useGameStore.getState().game).toBeNull();
    expect(useGameStore.getState().unlocked).toEqual(unlocked);
  });
});

describe('casino', () => {
  /** An adult with a bankroll; the direct mutation is committed via a cheap action. */
  function setUpAdult(): void {
    useGameStore.getState().newLife({ slot: 1, seed: 21 });
    game().character.age = 25;
    game().character.money = 5000;
    useGameStore.getState().setWorkHard(false);
  }

  it('charges the blackjack bet up front and saves the post-bet balance', () => {
    setUpAdult();
    useGameStore.getState().startBlackjack(50);
    const table = casinoTable();
    expect(table.player.length).toBeGreaterThanOrEqual(2);
    // An open table has payout 0; an immediate blackjack settles at once —
    // either way the balance is the bankroll minus the stake plus the payout.
    expect(game().character.money).toBe(5000 - 50 + table.payout);
    expect(useGameStore.getState().slotSummaries()[0]?.money).toBe(game().character.money);
  });

  it('plays a hand to done and conserves money', () => {
    setUpAdult();
    useGameStore.getState().startBlackjack(50);
    if (!casinoTable().done) {
      useGameStore.getState().blackjackHit();
    }
    if (!casinoTable().done) {
      useGameStore.getState().blackjackStand();
    }
    const table = casinoTable();
    expect(table.done).toBe(true);
    expect(game().character.money).toBe(5000 - 50 + table.payout);
  });

  it('clearCasino drops the table and touches nothing else', () => {
    setUpAdult();
    useGameStore.getState().startBlackjack(50);
    const before = game();
    const money = before.character.money;
    useGameStore.getState().clearCasino();
    expect(useGameStore.getState().casino).toBeNull();
    expect(useGameStore.getState().game).toBe(before);
    expect(game().character.money).toBe(money);
  });

  it('spinSlots conserves money and returns three reels', () => {
    setUpAdult();
    const before = game().character.money;
    const spin = played(useGameStore.getState().spinSlots(5));
    expect(spin.reels).toHaveLength(3);
    expect(game().character.money).toBe(before - 5 + spin.payout);
  });

  it('refuses a below-minimum spin for free', () => {
    setUpAdult();
    const before = game().character.money;
    expect(useGameStore.getState().spinSlots(1)).toEqual({
      ok: false,
      reason: 'The minimum bet is $5.',
    });
    expect(game().character.money).toBe(before);
  });
});

/* The three games used to report a refusal by sentinel — an empty table, three
   blocked reels, a ticket indistinguishable from a losing one — which left the
   casino sheet re-deriving the engine's own rules in order to word them. The
   rule and its wording have one author now, and these tests pin the wording to
   the rule: every limit is played at its first refused and first accepted bet,
   through the engine itself, so a limit that moves in `content/gambling` fails
   a test here rather than quietly mis-wording a toast. */
describe('the casino refuses in its own words', () => {
  /** An adult with a bankroll; the direct mutation is committed via a cheap action. */
  function setUpAdult(money = 5000): void {
    useGameStore.getState().newLife({ slot: 1, seed: 21 });
    game().character.age = 25;
    game().character.money = money;
    useGameStore.getState().setWorkHard(false);
  }

  it('holds blackjack to its minimum, and deals at it', () => {
    setUpAdult();
    const bank = game().character.money;
    expect(useGameStore.getState().startBlackjack(9)).toEqual({
      ok: false,
      reason: 'The minimum bet is $10.',
    });
    expect(useGameStore.getState().casino).toBeNull();
    expect(game().character.money).toBe(bank);

    expect(useGameStore.getState().startBlackjack(10)).toEqual({ ok: true });
    expect(casinoTable().player.length).toBeGreaterThanOrEqual(2);
  });

  it('refuses a blackjack bet the bankroll cannot cover', () => {
    setUpAdult();
    expect(useGameStore.getState().startBlackjack(5001)).toEqual({
      ok: false,
      reason: "You can't cover that bet.",
    });
    expect(useGameStore.getState().casino).toBeNull();
  });

  it('names the hand already on the table rather than dealing over it', () => {
    setUpAdult();
    for (let attempt = 0; attempt < 6 && useGameStore.getState().casino?.done !== false; attempt += 1) {
      useGameStore.getState().clearCasino();
      useGameStore.getState().startBlackjack(50);
    }
    expect(casinoTable().done).toBe(false);
    expect(useGameStore.getState().startBlackjack(50)).toEqual({
      ok: false,
      reason: 'Finish the hand you are playing.',
    });
  });

  it('holds the slot machine to both of its limits', () => {
    setUpAdult(2000);
    const bank = game().character.money;
    expect(useGameStore.getState().spinSlots(4)).toEqual({
      ok: false,
      reason: 'The minimum bet is $5.',
    });
    expect(useGameStore.getState().spinSlots(1001)).toEqual({
      ok: false,
      reason: 'The most you can bet is $1,000.',
    });
    expect(game().character.money).toBe(bank);

    /* And the first bet either limit allows is one the machine really takes:
       a spin this store lets through must never come back blocked. */
    expect(played(useGameStore.getState().spinSlots(5)).reels).not.toContain('🚫');
    expect(played(useGameStore.getState().spinSlots(1000)).reels).not.toContain('🚫');
  });

  it('refuses a ticket nobody can afford, and spends no draw on the asking', () => {
    setUpAdult();
    game().character.money = 4;
    const cursor = game().rngState;
    expect(useGameStore.getState().buyLottery()).toEqual({
      ok: false,
      reason: "You can't afford a ticket.",
    });
    expect(game().rngState).toBe(cursor);
    expect(game().character.money).toBe(4);

    // One dollar more is the price, and a refused ticket stops looking like a
    // losing one: the sale goes through and the draw is spent.
    game().character.money = 5;
    const ticket = played(useGameStore.getState().buyLottery());
    expect(game().rngState).not.toBe(cursor);
    expect(game().character.money).toBe(ticket.won ? ticket.prize : 0);
  });
});

/* The `void` dialect and what it cost: six actions whose engine call can be a
   complete no-op the caller cannot see — quit with no job, drop out of nothing,
   sell what is not owned, repay with an empty wallet — where the button did
   nothing and said nothing at all. Each answers why now, and each still runs
   through the same commit it always did, refusal or not. */
describe('actions that used to refuse in silence', () => {
  /** A life with a job, a desk, a car and a loan to act on. */
  function setUpWorkingLife(): void {
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
    c.education.enrolledIn = 'school-university';
    c.assets.push({
      id: 'a1',
      defId: 'veh-hatchback',
      label: 'Hatchback',
      paid: 8000,
      value: 6000,
      yearBought: 28,
    });
    c.loans.push({ id: 'l1', kind: 'personal', principal: 4000, apr: 0.09 });
    // Committed through an action, exactly as the other setups do it.
    useGameStore.getState().setStudyHard(false);
  }

  it('names what a job action has nothing to act on', () => {
    useGameStore.getState().newLife({ slot: 1, seed: 21 });
    const noJob = { ok: false, reason: "You don't have a job." };
    expect(useGameStore.getState().quitJob()).toEqual(noJob);
    expect(useGameStore.getState().setWorkHard(true)).toEqual(noJob);
    // The engine words this one itself; only the field name changes.
    expect(useGameStore.getState().askForRaise()).toEqual({
      ok: false,
      reason: 'You need a job first.',
    });
  });

  it('acts on the job it does have, denial included', () => {
    setUpWorkingLife();
    expect(useGameStore.getState().setWorkHard(true)).toEqual({ ok: true });
    expect(game().character.job?.workHard).toBe(true);

    // A denied raise is a refusal like any other: the prose arrives as `reason`.
    expect(useGameStore.getState().askForRaise()).toEqual({
      ok: false,
      reason: 'Denied. Maybe next year.',
    });

    expect(useGameStore.getState().quitJob()).toEqual({ ok: true });
    expect(game().character.job).toBeNull();
  });

  it('reports a granted raise as prose under `ok`', () => {
    setUpWorkingLife();
    const job = game().character.job;
    if (job === null) {
      throw new Error('expected a job');
    }
    job.performance = 100;
    job.years = 5;
    /* Deterministic rather than flaky: the roll comes from the seeded RNG, and
       the ask is capped at one per age, so this walks years until it lands. */
    let granted: ActionResult | null = null;
    for (let tries = 0; tries < 20 && granted === null; tries += 1) {
      game().character.age += 1;
      const asked = useGameStore.getState().askForRaise();
      if (asked.ok) {
        granted = asked;
      }
    }
    expect(granted).toEqual({ ok: true, text: 'Your boss gave you an 8% raise.' });
  });

  it('names an enrolment action with no desk to act on', () => {
    useGameStore.getState().newLife({ slot: 1, seed: 21 });
    expect(useGameStore.getState().dropOut()).toEqual({
      ok: false,
      reason: "You're not enrolled.",
    });
    // Studying hard needs no desk: the engine records the intent either way.
    expect(useGameStore.getState().setStudyHard(true)).toEqual({ ok: true });
  });

  it('drops out of the school it is enrolled in', () => {
    setUpWorkingLife();
    expect(useGameStore.getState().dropOut()).toEqual({ ok: true });
    expect(game().character.education.enrolledIn).toBeUndefined();
  });

  it('names a sale with nothing to sell', () => {
    setUpWorkingLife();
    expect(useGameStore.getState().sellAsset('a404')).toEqual({
      ok: false,
      reason: "You don't own that.",
    });
    expect(game().character.assets).toHaveLength(1);

    expect(useGameStore.getState().sellAsset('a1')).toEqual({ ok: true });
    expect(game().character.assets).toEqual([]);
  });

  it('names a repayment with nothing to pay it with', () => {
    setUpWorkingLife();
    expect(useGameStore.getState().repayLoan('l404', 100)).toEqual({
      ok: false,
      reason: "You don't owe that.",
    });

    game().character.money = 0;
    expect(useGameStore.getState().repayLoan('l1', 100)).toEqual({
      ok: false,
      reason: 'Nothing to pay with.',
    });
    expect(game().character.loans[0]?.principal).toBe(4000);

    game().character.money = 500;
    expect(useGameStore.getState().repayLoan('l1', 100)).toEqual({ ok: true });
    expect(game().character.loans[0]?.principal).toBe(3900);
    expect(game().character.money).toBe(400);
  });

  it('says which side of an investment move ran out', () => {
    setUpWorkingLife();
    expect(useGameStore.getState().deposit('savings', 1_000_000)).toEqual({
      ok: false,
      reason: "You don't have that much.",
    });
    expect(useGameStore.getState().deposit('savings', 1000)).toEqual({ ok: true });
    expect(game().character.investments.savings).toBe(1000);

    expect(useGameStore.getState().withdraw('savings', 2000)).toEqual({
      ok: false,
      reason: 'Not that much invested.',
    });
    expect(useGameStore.getState().withdraw('savings', 1000)).toEqual({ ok: true });
    expect(game().character.money).toBe(5000);
  });

  it('gives a finished life one answer for all of them', () => {
    setUpWorkingLife();
    killCharacter(game(), getRegistry(), 'test');
    const over = { ok: false, reason: 'Your life is over.' };
    const s = useGameStore.getState();

    expect(s.quitJob()).toEqual(over);
    expect(s.setWorkHard(true)).toEqual(over);
    expect(s.askForRaise()).toEqual(over);
    expect(s.dropOut()).toEqual(over);
    expect(s.setStudyHard(true)).toEqual(over);
    expect(s.sellAsset('a1')).toEqual(over);
    expect(s.repayLoan('l1', 100)).toEqual(over);
    expect(s.deposit('savings', 100)).toEqual(over);
    expect(s.withdraw('savings', 100)).toEqual(over);
    expect(s.spinSlots(5)).toEqual(over);
    expect(s.buyLottery()).toEqual(over);
    expect(s.startBlackjack(50)).toEqual(over);
  });
});

describe('legacy', () => {
  it('continues the family line as the chosen child', () => {
    useGameStore
      .getState()
      .newLife({ slot: 1, seed: 9, firstName: 'Ada', lastName: 'Root', gender: 'female' });
    const g = game();
    g.character.age = 40;
    g.character.money = 5000;
    const child: Person = {
      id: 'p99',
      kind: 'child',
      name: 'Kid Root',
      gender: 'male',
      age: 10,
      alive: true,
      rel: 80,
      flags: {},
    };
    g.people[child.id] = child;
    /* A hand dealt before the end: death settles it but leaves the finished
       table in `casino`, which is exactly what startLegacy must clear. */
    useGameStore.getState().startBlackjack(100);
    expect(useGameStore.getState().casino).not.toBeNull();

    // Re-read: the deal committed, so the live state is a fresh top-level copy.
    killCharacter(game(), getRegistry(), 'test');
    useGameStore.getState().setWorkHard(false);

    expect(game().phase).toBe('dead');
    expect(useUiStore.getState().screen).toBe('death');
    expect(useGameStore.getState().casino).not.toBeNull();

    const before = game();
    useGameStore.getState().startLegacy('p99');
    const after = game();
    expect(after).not.toBe(before);
    expect(after.generation).toBe(2);
    expect(after.character.firstName).toBe('Kid');
    expect(after.character.lastName).toBe('Root');
    expect(useUiStore.getState().screen).toBe('life');
    expect(useGameStore.getState().casino).toBeNull();

    const row = useGameStore.getState().slotSummaries()[0];
    expect(row?.empty).toBe(false);
    expect(row?.name).toBe('Kid Root');
    expect(row?.generation).toBe(2);
  });
});

describe('deleteSlot', () => {
  it('clears the store when deleting the loaded slot', () => {
    useGameStore.getState().newLife({ slot: 1, seed: 7 });
    useGameStore.getState().deleteSlot(1);
    const s = useGameStore.getState();
    expect(s.game).toBeNull();
    expect(s.slot).toBeNull();
    expect(s.casino).toBeNull();
    expect(s.slotSummaries()[0]?.empty).toBe(true);
  });

  it('leaves the loaded life untouched when deleting a different slot', () => {
    useGameStore.getState().newLife({ slot: 2, seed: 8 });
    useGameStore.getState().newLife({ slot: 1, seed: 7 });
    const loaded = game();
    useGameStore.getState().deleteSlot(2);
    const s = useGameStore.getState();
    expect(s.game).toBe(loaded);
    expect(s.slot).toBe(1);
    expect(s.slotSummaries()[1]?.empty).toBe(true);
    expect(s.slotSummaries()[0]?.empty).toBe(false);
  });

  it("erases the deleted slot's blackjack sidecar, and only that one", () => {
    const adapter = memoryStorage();
    resetGameStoreForTests(adapter);
    useGameStore.getState().newLife({ slot: 1, seed: 7 });
    useGameStore.getState().newLife({ slot: 2, seed: 8 });
    /* An open hand parked in each slot, as a mid-hand reload leaves one: the
       stake is charged in the save beside it, so it must not outlive that save
       and be dealt back on top of the next life in the slot. */
    const openHand = JSON.stringify({
      bet: 50,
      player: ['A♠', '5♥'],
      dealer: ['K♦'],
      playerTotal: 16,
      dealerTotal: 10,
      done: false,
      payout: 0,
    });
    adapter.setItem('ol.table.1', openHand);
    adapter.setItem('ol.table.2', openHand);

    useGameStore.getState().deleteSlot(1);

    expect(adapter.getItem('ol.table.1')).toBeNull();
    expect(adapter.getItem('ol.table.2')).toBe(openHand);

    // And the next life to occupy that slot inherits no hand from the last one.
    saveGame(adapter, 1, game());
    expect(useGameStore.getState().loadSlot(1).ok).toBe(true);
    expect(useGameStore.getState().casino).toBeNull();
  });
});

describe('abandonLife', () => {
  it('clears the store and returns to slots, keeping the save', () => {
    useGameStore.getState().newLife({ slot: 1, seed: 7 });
    useGameStore.getState().abandonLife();
    const s = useGameStore.getState();
    expect(s.game).toBeNull();
    expect(s.slot).toBeNull();
    expect(s.casino).toBeNull();
    expect(useUiStore.getState().screen).toBe('slots');
    expect(s.slotSummaries()[0]?.empty).toBe(false);
  });
});

/* Every action that runs against the loaded life shares one guard — `withLife`
   for the ones written through it, a hand-written one for the few whose shape
   differs — and one promise behind it: with nothing loaded there is nothing to
   run, so the action answers in the shape its caller expects, `commit` never
   runs, and neither the store nor storage is touched. The slot list is reachable
   in exactly this state, and every sheet that calls these actions is one stale
   render away from being mounted over it. */
describe('with no life loaded', () => {
  type Store = ReturnType<typeof useGameStore.getState>;

  /** Each action's call, and the answer it owes a caller with nothing loaded. */
  const refusals: { name: string; run: (s: Store) => unknown; answer: unknown }[] = [
    { name: 'interact', run: (s) => s.interact('act-gym'), answer: null },
    { name: 'interactWithTarget', run: (s) => s.interact('act-gym', 'p1'), answer: null },
    { name: 'crime', run: (s) => s.crime('crime-shoplift'), answer: null },
    {
      name: 'applyForJob',
      run: (s) => s.applyForJob('job-barista-pt'),
      answer: { ok: false, reason: 'No life loaded.' },
    },
    { name: 'quitJob', run: (s) => s.quitJob(), answer: { ok: false, reason: 'No life loaded.' } },
    {
      name: 'setWorkHard',
      run: (s) => s.setWorkHard(true),
      answer: { ok: false, reason: 'No life loaded.' },
    },
    {
      name: 'askForRaise',
      run: (s) => s.askForRaise(),
      answer: { ok: false, reason: 'No life loaded.' },
    },
    {
      name: 'applyToSchool',
      run: (s) => s.applyToSchool('school-high'),
      answer: { ok: false, reason: 'No life loaded.' },
    },
    { name: 'dropOut', run: (s) => s.dropOut(), answer: { ok: false, reason: 'No life loaded.' } },
    {
      name: 'setStudyHard',
      run: (s) => s.setStudyHard(true),
      answer: { ok: false, reason: 'No life loaded.' },
    },
    {
      name: 'buyAsset',
      run: (s) => s.buyAsset('prop-studio', true),
      answer: { ok: false, reason: 'No life loaded.' },
    },
    {
      name: 'sellAsset',
      run: (s) => s.sellAsset('a1'),
      answer: { ok: false, reason: 'No life loaded.' },
    },
    {
      name: 'deposit',
      run: (s) => s.deposit('savings', 100),
      answer: { ok: false, reason: 'No life loaded.' },
    },
    {
      name: 'withdraw',
      run: (s) => s.withdraw('savings', 100),
      answer: { ok: false, reason: 'No life loaded.' },
    },
    {
      name: 'takeLoan',
      run: (s) => s.takeLoan(1000),
      answer: { ok: false, reason: 'No life loaded.' },
    },
    {
      name: 'repayLoan',
      run: (s) => s.repayLoan('l1', 100),
      answer: { ok: false, reason: 'No life loaded.' },
    },
    {
      name: 'emigrate',
      run: (s) => s.emigrate('jp'),
      answer: { ok: false, reason: 'No life loaded.' },
    },
    {
      name: 'spinSlots',
      run: (s) => s.spinSlots(5),
      answer: { ok: false, reason: 'No life loaded.' },
    },
    {
      name: 'buyLottery',
      run: (s) => s.buyLottery(),
      answer: { ok: false, reason: 'No life loaded.' },
    },
    // The rest need a loaded life too, and guard themselves for it.
    { name: 'ageUp', run: (s) => s.ageUp(), answer: undefined },
    { name: 'choose', run: (s) => s.choose(0), answer: undefined },
    {
      name: 'startBlackjack',
      run: (s) => s.startBlackjack(50),
      answer: { ok: false, reason: 'No life loaded.' },
    },
    { name: 'blackjackHit', run: (s) => s.blackjackHit(), answer: undefined },
    { name: 'blackjackStand', run: (s) => s.blackjackStand(), answer: undefined },
    { name: 'startLegacy', run: (s) => s.startLegacy('p99'), answer: undefined },
    { name: 'saveNow', run: (s) => s.saveNow(), answer: false },
  ];

  it('refuses every action in its own shape, mutating and writing nothing', () => {
    const inner = memoryStorage();
    let writes = 0;
    const adapter: StorageAdapter = {
      getItem: (k: string): string | null => inner.getItem(k),
      setItem: (k: string, v: string): void => {
        writes += 1;
        inner.setItem(k, v);
      },
      removeItem: (k: string): void => {
        writes += 1;
        inner.removeItem(k);
      },
    };
    resetGameStoreForTests(adapter);
    const before = useGameStore.getState();

    const answers: Record<string, unknown> = {};
    for (const refusal of refusals) {
      answers[refusal.name] = refusal.run(useGameStore.getState());
    }

    expect(answers).toEqual(Object.fromEntries(refusals.map((r) => [r.name, r.answer])));
    expect(writes).toBe(0);
    // No `set` either: a refused action leaves the store object it read.
    expect(useGameStore.getState()).toBe(before);
    expect(useUiStore.getState().toasts).toEqual([]);
  });
});

/* The Settings sheet toasts this call's result, so a write that never reached
   durable storage must not come back as a save. */
describe('saveNow', () => {
  it('reports failure when there is no life to write', () => {
    expect(useGameStore.getState().saveNow()).toBe(false);
  });

  it('reports the write it made', () => {
    resetGameStoreForTests(memoryStorage());
    useGameStore.getState().newLife({ slot: 1, seed: 7 });
    stepYears(2);
    expect(useGameStore.getState().saveNow()).toBe(true);
    expect(useGameStore.getState().slotSummaries()[0]?.age).toBe(game().character.age);
  });

  it('reports failure when the write is refused, leaving the slot behind', () => {
    const storage = blockableStorage();
    resetGameStoreForTests(storage.adapter);
    useGameStore.getState().newLife({ slot: 1, seed: 7 });
    const stored = useGameStore.getState().slotSummaries()[0]?.age;

    // A full origin, or one with site data blocked: every write throws.
    storage.block();
    stepYears(3);
    expect(game().character.age).toBeGreaterThan(stored ?? 0);
    expect(useGameStore.getState().saveNow()).toBe(false);
    expect(useGameStore.getState().slotSummaries()[0]?.age).toBe(stored);
  });

  it('reports failure when the app fell back to in-memory storage', async () => {
    /* No localStorage under the test runner — the same state a browser leaves
       the app in when site data is blocked. A fresh import therefore picks the
       in-memory fallback, whose writes die with the tab. */
    vi.resetModules();
    const fresh = await import('@/store/gameStore');
    fresh.useGameStore.getState().newLife({ slot: 1, seed: 7 });

    expect(fresh.useGameStore.getState().saveNow()).toBe(false);
    // The write still happened, so play continues against it this session.
    expect(fresh.useGameStore.getState().slotSummaries()[0]?.empty).toBe(false);
  });
});

/* Storage refusing writes is the one failure the game itself never shows: the
   life in memory plays on, and the loss only surfaces a session later, on the
   reload that comes back years behind. */
describe('an autosave that has stopped landing', () => {
  /** Autosave-failure warnings raised so far. */
  function failureToasts(): number {
    return useUiStore.getState().toasts.filter((t) => t.title === 'Progress is not being saved')
      .length;
  }

  it('warns once per episode while play continues', () => {
    const storage = blockableStorage();
    resetGameStoreForTests(storage.adapter);
    useGameStore.getState().newLife({ slot: 1, seed: 7 });
    const stored = game().character.age;

    storage.block();
    useGameStore.getState().ageUp();
    // Only the write is lost: the year still happened.
    expect(game().character.age).toBeGreaterThan(stored);
    expect(useGameStore.getState().slotSummaries()[0]?.age).toBe(stored);
    expect(failureToasts()).toBe(1);

    // Every later year fails the same way and has nothing new to say.
    stepYears(3);
    expect(failureToasts()).toBe(1);

    // A write that lands re-arms the warning, so the next break is news again.
    storage.unblock();
    useGameStore.getState().setWorkHard(false);
    expect(failureToasts()).toBe(1);
    storage.block();
    useGameStore.getState().setWorkHard(true);
    expect(failureToasts()).toBe(2);
  });

  it('says nothing while the writes are landing', () => {
    resetGameStoreForTests(memoryStorage());
    useGameStore.getState().newLife({ slot: 1, seed: 7 });
    stepYears(3);
    expect(failureToasts()).toBe(0);
  });

  it('leaves an explicit save to report its own failure', () => {
    const storage = blockableStorage();
    resetGameStoreForTests(storage.adapter);
    useGameStore.getState().newLife({ slot: 1, seed: 7 });

    storage.block();
    /* The Settings sheet toasts what this call returns, so the store must not
       toast the same refusal a second time. */
    expect(useGameStore.getState().saveNow()).toBe(false);
    expect(failureToasts()).toBe(0);

    // And the autosave behind it has no news left to break.
    useGameStore.getState().setWorkHard(false);
    expect(failureToasts()).toBe(0);
  });
});

describe('slotSummaries', () => {
  it('returns six rows without touching store state', () => {
    useGameStore.getState().newLife({ slot: 4, seed: 7 });
    const before = useGameStore.getState();
    const rows = before.slotSummaries();
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.slot)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(useGameStore.getState()).toBe(before);
  });

  it('reports a slot the loader will refuse, and why', () => {
    /* The load menu is the only place the player can destroy a life, and the
       only row it hands straight to the create screen is an empty one. A save
       this build cannot open has to arrive as neither empty nor ordinary: the
       row says what is wrong with it and keeps its confirmation. */
    const storage = memoryStorage();
    resetGameStoreForTests(storage);
    useGameStore.getState().newLife({ slot: 1, seed: 7 });

    // A write cut short by a full origin: the envelope is there, the life is not.
    storage.setItem('ol.save.2', '{"version":1,"savedAt":5,"slot":2,"state":{"chara');
    storage.setItem(
      'ol.save.3',
      JSON.stringify({
        version: SAVE_VERSION + 1,
        savedAt: 6,
        slot: 3,
        state: { character: { firstName: 'Ada', lastName: 'Byron', age: 34 } },
      })
    );

    const rows = useGameStore.getState().slotSummaries();
    expect(rows[0]).toMatchObject({ empty: false });
    expect(rows[0]?.unreadable).toBeUndefined();
    expect(rows[1]).toMatchObject({ slot: 2, empty: false, unreadable: 'damaged' });
    // A newer build's save keeps its name: it is healthy data, just not readable here.
    expect(rows[2]).toMatchObject({ slot: 3, empty: false, name: 'Ada Byron', unreadable: 'future' });
    /* The same verdict the rows carry, from the load itself: the menu words a
       refusal off this answer rather than re-reading the slot to ask again. */
    expect(useGameStore.getState().loadSlot(2)).toEqual({ ok: false, reason: 'corrupt' });
    expect(useGameStore.getState().loadSlot(3)).toEqual({ ok: false, reason: 'future' });
    // Only a slot nothing was written to reads as free space.
    expect(rows[3]).toEqual({ slot: 4, empty: true });
  });
});

describe('review regressions', () => {
  /** An adult with a bankroll; the direct mutation is committed via a cheap action. */
  function setUpAdult(): void {
    useGameStore.getState().newLife({ slot: 1, seed: 21 });
    game().character.age = 25;
    game().character.money = 5000;
    useGameStore.getState().setWorkHard(false);
  }

  /** Deals until a hand survives the deal (an immediate blackjack settles). */
  function dealOpenHand(): void {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      useGameStore.getState().startBlackjack(50);
      if (!casinoTable().done) {
        return;
      }
      useGameStore.getState().clearCasino();
    }
    throw new Error('never dealt an open hand');
  }

  it('discards a drifted zero-choice card instead of stranding the life', () => {
    useGameStore.getState().newLife({ slot: 1, seed: 9 });
    // Simulate a save written with a card that offers no choices at all.
    game().pending.push({ eventId: 'drifted', text: 'A moment passes.', icon: '❓', choices: [] });
    game().phase = 'awaitingChoice';
    useGameStore.getState().choose(0);
    expect(game().phase).toBe('alive');
    expect(game().pending).toHaveLength(0);
    expect(hasEventSheet()).toBe(false);
  });

  /** Parks the loaded life on the drifted state: a choice due, nothing queued. */
  function stallOnEmptyChoice(): void {
    const g = game();
    g.pending = [];
    g.phase = 'awaitingChoice';
  }

  /** True while the life owes an answer it has no card to give — the dead end. */
  function isStalled(): boolean {
    const queued: readonly (PendingEvent | undefined)[] = game().pending;
    return game().phase === 'awaitingChoice' && !queued[0];
  }

  it('reopens a save parked on awaitingChoice with an empty queue', () => {
    const adapter = memoryStorage();
    resetGameStoreForTests(adapter);
    useGameStore.getState().newLife({ slot: 1, seed: 9 });
    stallOnEmptyChoice();
    saveGame(adapter, 1, game());

    // A reload: the event sheet this phase routes to is non-dismissible and
    // renders no card, so adopting the phase as-is would lock the slot for good.
    resetGameStoreForTests(adapter);
    expect(useGameStore.getState().loadSlot(1).ok).toBe(true);
    expect(game().phase).toBe('alive');
    expect(hasEventSheet()).toBe(false);

    // And the life screen is live again: the year still advances.
    const age = game().character.age;
    useGameStore.getState().ageUp();
    expect(game().character.age).toBe(age + 1);
  });

  it('choose() reopens an empty queue instead of stranding the life', () => {
    useGameStore.getState().newLife({ slot: 1, seed: 9 });
    stallOnEmptyChoice();
    useUiStore.getState().pushSheet('event');

    useGameStore.getState().choose(0);
    expect(game().phase).toBe('alive');
    expect(game().pending).toHaveLength(0);
    expect(hasEventSheet()).toBe(false);
  });

  it('choose() survives a queue whose head decoded as null', () => {
    useGameStore.getState().newLife({ slot: 1, seed: 9 });
    const g = game();
    g.pending = [null as unknown as PendingEvent];
    g.phase = 'awaitingChoice';
    useUiStore.getState().pushSheet('event');

    expect(() => {
      useGameStore.getState().choose(0);
    }).not.toThrow();
    expect(game().phase).toBe('alive');
    expect(game().pending).toHaveLength(0);
    expect(hasEventSheet()).toBe(false);
  });

  it('ageUp() advances a life parked on awaitingChoice with nothing queued', () => {
    useGameStore.getState().newLife({ slot: 1, seed: 9 });
    stallOnEmptyChoice();
    /* Put up what the router puts up for that phase, because that sheet is the
       brick: it mounts non-dismissible over a full-screen backdrop and renders
       nothing without a card, so Age Up is the only control still reachable —
       and it used to re-route straight back into this same sheet. */
    useUiStore.getState().pushSheet('event');
    const age = game().character.age;

    useGameStore.getState().ageUp();

    expect(game().character.age).toBe(age + 1);
    expect(isStalled()).toBe(false);
    /* And the router owns the sheet again: up only when a card is in it, which
       the fresh year may well have queued. */
    expect(hasEventSheet()).toBe(game().phase === 'awaitingChoice');
  });

  it('ageUp() advances a life whose queued card decoded as null', () => {
    useGameStore.getState().newLife({ slot: 1, seed: 9 });
    /* Wider than the engine's own repair, which reads the queue's length alone:
       a decoded queue can hold a null head, which the sheet and `resolveChoice`
       both trip on, so the store has to answer for this shape on the way in. */
    game().pending = [null as unknown as PendingEvent];
    game().phase = 'awaitingChoice';
    useUiStore.getState().pushSheet('event');
    const age = game().character.age;

    expect(() => {
      useGameStore.getState().ageUp();
    }).not.toThrow();

    expect(game().character.age).toBe(age + 1);
    expect(isStalled()).toBe(false);
    expect(hasEventSheet()).toBe(game().phase === 'awaitingChoice');
  });

  it('restores an unfinished blackjack hand across a reload', () => {
    const adapter = memoryStorage();
    resetGameStoreForTests(adapter);
    setUpAdult();
    dealOpenHand();
    const open = casinoTable();
    const bankAfterDeal = game().character.money;

    // A reload: fresh store over the same storage, then continue the slot.
    resetGameStoreForTests(adapter);
    expect(useGameStore.getState().loadSlot(1).ok).toBe(true);
    const restored = casinoTable();
    expect(restored.bet).toBe(open.bet);
    expect(restored.player).toEqual(open.player);
    expect(game().character.money).toBe(bankAfterDeal);

    // The restored hand still settles and pays out of the loaded balance.
    while (!casinoTable().done) {
      useGameStore.getState().blackjackStand();
    }
    expect(game().character.money).toBe(bankAfterDeal + casinoTable().payout);
  });

  it('drops the sidecar once the hand settles', () => {
    const adapter = memoryStorage();
    resetGameStoreForTests(adapter);
    setUpAdult();
    dealOpenHand();
    while (!casinoTable().done) {
      useGameStore.getState().blackjackStand();
    }
    resetGameStoreForTests(adapter);
    expect(useGameStore.getState().loadSlot(1).ok).toBe(true);
    expect(useGameStore.getState().casino).toBeNull();
  });

  /** Plants a raw table sidecar over a saved slot 1; what a reload adopts from it. */
  function adoptSidecar(raw: string): BlackjackTable | null {
    const adapter = memoryStorage();
    resetGameStoreForTests(adapter);
    setUpAdult();
    adapter.setItem('ol.table.1', raw);

    resetGameStoreForTests(adapter);
    expect(useGameStore.getState().loadSlot(1).ok).toBe(true);
    return useGameStore.getState().casino;
  }

  it('refuses a table sidecar that is not a whole open hand', () => {
    const openHand = {
      bet: 50,
      player: ['A♠', '5♥'],
      dealer: ['K♦'],
      playerTotal: 16,
      dealerTotal: 10,
      done: false,
      payout: 0,
    };
    // The gate is not a blanket no: an intact hand still comes back.
    expect(adoptSidecar(JSON.stringify(openHand))).toEqual(openHand);

    // The casino sheet maps over `dealer` during render and `blackjackStand`
    // spreads it, with no error boundary above either: a table missing a field
    // the consumers dereference must never reach live state.
    expect(adoptSidecar(JSON.stringify({ ...openHand, dealer: undefined }))).toBeNull();
    expect(adoptSidecar(JSON.stringify({ ...openHand, playerTotal: undefined }))).toBeNull();
    expect(adoptSidecar(JSON.stringify({ ...openHand, dealerTotal: undefined }))).toBeNull();
    expect(adoptSidecar(JSON.stringify({ ...openHand, payout: undefined }))).toBeNull();

    // Card values are sliced to read their rank; a number has no `slice`.
    expect(adoptSidecar(JSON.stringify({ ...openHand, player: [1, 5] }))).toBeNull();
    expect(adoptSidecar(JSON.stringify({ ...openHand, dealer: [{ rank: 'K' }] }))).toBeNull();

    // JSON carries no NaN, but an overflowing literal parses to Infinity, which
    // is a `number` the payout arithmetic cannot use.
    expect(
      adoptSidecar(
        '{"bet":1e999,"player":["A♠","5♥"],"dealer":["K♦"],"playerTotal":16,"dealerTotal":10,"done":false,"payout":0}'
      )
    ).toBeNull();

    // `typeof null === 'object'`, so the null sidecar needs its own refusal.
    expect(adoptSidecar('null')).toBeNull();
    expect(adoptSidecar('[]')).toBeNull();
    expect(adoptSidecar('not json')).toBeNull();
  });

  it('refuses to deal over an unfinished hand', () => {
    setUpAdult();
    dealOpenHand();
    const open = casinoTable();
    const bank = game().character.money;
    useGameStore.getState().startBlackjack(50);
    expect(useGameStore.getState().casino).toBe(open);
    expect(game().character.money).toBe(bank);
  });

  it('folds a hand the life ended in the middle of, and clears its sidecar', () => {
    const adapter = memoryStorage();
    resetGameStoreForTests(adapter);
    setUpAdult();
    dealOpenHand();
    const stake = casinoTable().bet;
    expect(adapter.getItem('ol.table.1')).not.toBeNull();

    /* Death closes the casino for good: the sheet is unreachable from the death
       screen and the engine refuses to deal, hit or stand on a finished life,
       so nothing is left that could ever settle this hand. Kept, it would ride
       the slot for ever holding a stake nothing can hand back. */
    killCharacter(game(), getRegistry(), 'test');
    const bankAtDeath = game().character.money;
    useGameStore.getState().setWorkHard(false);

    const settled = casinoTable();
    expect(settled.done).toBe(true);
    expect(settled.result).toBe('push');
    expect(game().character.money).toBe(bankAtDeath + stake);
    expect(adapter.getItem('ol.table.1')).toBeNull();

    // Once, not once per commit: a later action on the dead life pays nothing.
    useGameStore.getState().setWorkHard(true);
    expect(game().character.money).toBe(bankAtDeath + stake);

    /* And the refund reached the slot, not just the screen: it is decided
       before the autosave, so a reload resumes with the stake back and no hand
       waiting to be played. */
    resetGameStoreForTests(adapter);
    expect(useGameStore.getState().loadSlot(1).ok).toBe(true);
    expect(game().character.money).toBe(bankAtDeath + stake);
    expect(useGameStore.getState().casino).toBeNull();
  });

  it('leaves an abandoned life its hand, because it keeps its save too', () => {
    const adapter = memoryStorage();
    resetGameStoreForTests(adapter);
    setUpAdult();
    dealOpenHand();
    const open = casinoTable();

    /* The other way a life leaves the store, and the opposite call: the save
       stays put, so the hand charged against that balance has to stay beside it
       rather than be forfeited by walking away from the slot. */
    useGameStore.getState().abandonLife();
    expect(useGameStore.getState().casino).toBeNull();
    expect(adapter.getItem('ol.table.1')).not.toBeNull();

    expect(useGameStore.getState().loadSlot(1).ok).toBe(true);
    expect(casinoTable().player).toEqual(open.player);
  });

  it('leaves a life its hand when the player goes off to start another', () => {
    const adapter = memoryStorage();
    resetGameStoreForTests(adapter);
    setUpAdult();
    dealOpenHand();
    const open = casinoTable();

    /* The third way a life leaves the store, and it has to leave the slot the
       way `abandonLife` does: nothing was overwritten, so the stake charged
       against that save keeps its hand beside it until the create screen is
       actually gone through with. */
    useGameStore.getState().beginNewLife(5);
    expect(useGameStore.getState().casino).toBeNull();
    expect(adapter.getItem('ol.table.1')).not.toBeNull();

    expect(useGameStore.getState().loadSlot(1).ok).toBe(true);
    expect(casinoTable().player).toEqual(open.player);
  });

  it('refuses to deal on a dead life without parking a table to interpret', () => {
    setUpAdult();
    killCharacter(game(), getRegistry(), 'test');
    useGameStore.getState().setWorkHard(false);
    const bank = game().character.money;

    /* The refusal is the answer now, so nothing is dealt and nothing is left in
       `casino` for the sheet to recognise as an empty table and hide. */
    expect(useGameStore.getState().startBlackjack(100)).toEqual({
      ok: false,
      reason: 'Your life is over.',
    });
    expect(useGameStore.getState().casino).toBeNull();
    expect(game().character.money).toBe(bank);
  });

  it('writes the table sidecar once per change, not once per action', () => {
    const inner = memoryStorage();
    let sidecarWrites = 0;
    const adapter: StorageAdapter = {
      getItem: (k: string): string | null => inner.getItem(k),
      setItem: (k: string, v: string): void => {
        if (k === 'ol.table.1') {
          sidecarWrites += 1;
        }
        inner.setItem(k, v);
      },
      removeItem: (k: string): void => {
        if (k === 'ol.table.1') {
          sidecarWrites += 1;
        }
        inner.removeItem(k);
      },
    };
    resetGameStoreForTests(adapter);
    setUpAdult();
    dealOpenHand();
    const afterDeal = sidecarWrites;
    expect(afterDeal).toBeGreaterThan(0);

    /* Every action commits, but only the ones that move the table may touch its
       key: `casino` and the sidecar are decided together, so an unchanged table
       is not rewritten. */
    useGameStore.getState().setWorkHard(false);
    useGameStore.getState().spinSlots(5);
    expect(sidecarWrites).toBe(afterDeal);

    // Settling the hand is a change, and clears the key in one write.
    useGameStore.getState().blackjackStand();
    expect(casinoTable().done).toBe(true);
    expect(sidecarWrites).toBe(afterDeal + 1);
    expect(inner.getItem('ol.table.1')).toBeNull();
  });
});

/* The game installs as a PWA, so a second window over the same localStorage is
   an ordinary state: neither the global achievement list nor a save slot may be
   overwritten from the snapshot this window happened to load with. */
describe('a second window on the same storage', () => {
  /** Runs `write` with the clock pushed on, so it stamps a later `savedAt`. */
  function asLaterWindow(write: () => void): void {
    const spy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000);
    try {
      write();
    } finally {
      spy.mockRestore();
    }
  }

  /** Conflict toasts raised so far. */
  function pausedToasts(): number {
    return useUiStore.getState().toasts.filter((t) => t.title === 'Autosave paused').length;
  }

  it('keeps achievements the other window unlocked after this one read the list', () => {
    const adapter = memoryStorage();
    resetGameStoreForTests(adapter);
    useGameStore.getState().newLife({ slot: 1, seed: 3 });
    expect(useGameStore.getState().unlocked).toEqual([]);

    // The other window finishes a long life; this store still holds its snapshot.
    saveUnlockedAchievements(adapter, ['ach-centenarian']);

    const toastsBefore = useUiStore.getState().toasts.length;
    game().character.money = 2_000_000;
    useGameStore.getState().setWorkHard(false);

    const stored = loadUnlockedAchievements(adapter);
    expect(stored).toContain('ach-millionaire');
    // The wall is global and append-only: this write must not erase the other id.
    expect(stored).toContain('ach-centenarian');
    expect(useGameStore.getState().unlocked).toContain('ach-centenarian');

    // Adopted, not earned here, so it must not toast.
    const raised = useUiStore.getState().toasts.slice(toastsBefore);
    expect(raised.length).toBeGreaterThan(0);
    const centenarian: AchievementDef | undefined =
      getRegistry().achievementsById['ach-centenarian'];
    expect(raised.some((t) => t.subtitle === centenarian?.label)).toBe(false);
  });

  it('refuses to autosave over a slot the other window has written since', () => {
    const adapter = memoryStorage();
    resetGameStoreForTests(adapter);
    useGameStore.getState().newLife({ slot: 1, seed: 42 });
    stepYears(2);
    const mine = game().character.age;

    // The other window plays the same slot forty years on and saves it.
    const theirs = JSON.parse(JSON.stringify(game())) as GameState;
    theirs.character.age = mine + 40;
    asLaterWindow(() => {
      saveGame(adapter, 1, theirs);
    });

    useGameStore.getState().setWorkHard(false);
    expect(useGameStore.getState().slotSummaries()[0]?.age).toBe(mine + 40);
    expect(pausedToasts()).toBe(1);

    // Still refused on the next action, and said only the once.
    useGameStore.getState().setWorkHard(true);
    expect(useGameStore.getState().slotSummaries()[0]?.age).toBe(mine + 40);
    expect(pausedToasts()).toBe(1);

    // The explicit Save is the deliberate override, and resumes autosaving.
    useGameStore.getState().saveNow();
    expect(useGameStore.getState().slotSummaries()[0]?.age).toBe(mine);
    useGameStore.getState().setWorkHard(false);
    expect(useGameStore.getState().slotSummaries()[0]?.age).toBe(mine);
    expect(pausedToasts()).toBe(1);
  });

  it('keeps autosaving a slot no other window has touched', () => {
    const adapter = memoryStorage();
    resetGameStoreForTests(adapter);
    useGameStore.getState().newLife({ slot: 1, seed: 42 });
    stepYears(2);
    expect(useGameStore.getState().slotSummaries()[0]?.age).toBe(game().character.age);

    // A reload takes the slot back over, older stamp on disk and all.
    resetGameStoreForTests(adapter);
    expect(useGameStore.getState().loadSlot(1).ok).toBe(true);
    stepYears(1);
    expect(useGameStore.getState().slotSummaries()[0]?.age).toBe(game().character.age);
    expect(pausedToasts()).toBe(0);
  });
});
