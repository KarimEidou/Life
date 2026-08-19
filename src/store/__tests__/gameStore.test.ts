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
import { useUiStore } from '@/store/uiStore';
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

beforeEach(() => {
  resetGameStoreForTests(memoryStorage());
  useUiStore.setState({ screen: 'slots', sheets: [], toasts: [] });
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

describe('save/load roundtrip', () => {
  it('restores age and log length from the saved slot', () => {
    useGameStore.getState().newLife({ slot: 1, seed: 42 });
    stepYears(3);
    const age = game().character.age;
    const logLength = game().log.length;
    expect(age).toBeGreaterThan(0);

    useGameStore.setState({ game: null });
    expect(useGameStore.getState().loadSlot(1)).toBe(true);
    expect(game().character.age).toBe(age);
    expect(game().log.length).toBe(logLength);
  });

  it('refuses to load an empty slot', () => {
    useGameStore.getState().newLife({ slot: 1, seed: 42 });
    expect(useGameStore.getState().loadSlot(3)).toBe(false);
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
    const spin = useGameStore.getState().spinSlots(5);
    expect(spin).not.toBeNull();
    expect(spin?.reels).toHaveLength(3);
    expect(game().character.money).toBe(before - 5 + (spin?.payout ?? 0));
  });

  it('refuses a below-minimum spin for free', () => {
    setUpAdult();
    const before = game().character.money;
    const spin = useGameStore.getState().spinSlots(1);
    expect(spin).toEqual({ reels: ['🚫', '🚫', '🚫'], payout: 0 });
    expect(game().character.money).toBe(before);
  });
});

describe('legacy', () => {
  it('continues the family line as the chosen child', () => {
    useGameStore
      .getState()
      .newLife({ slot: 1, seed: 9, firstName: 'Ada', lastName: 'Root', gender: 'female' });
    const g = game();
    g.character.age = 40;
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
    killCharacter(g, getRegistry(), 'test');
    useGameStore.getState().setWorkHard(false);

    expect(game().phase).toBe('dead');
    expect(useUiStore.getState().screen).toBe('death');

    // A refused deal on a dead life still parks an inert table in `casino`,
    // which is exactly what startLegacy must clear.
    useGameStore.getState().startBlackjack(100);
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

/* The Settings sheet toasts this call's result, so a write that never reached
   durable storage must not come back as a save. */
describe('saveNow', () => {
  /** A memory adapter that can be made to refuse writes, as a full origin does. */
  function blockableStorage(): { adapter: StorageAdapter; block: () => void } {
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
    };
  }

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

describe('slotSummaries', () => {
  it('returns six rows without touching store state', () => {
    useGameStore.getState().newLife({ slot: 4, seed: 7 });
    const before = useGameStore.getState();
    const rows = before.slotSummaries();
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.slot)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(useGameStore.getState()).toBe(before);
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

  it('reopens a save parked on awaitingChoice with an empty queue', () => {
    const adapter = memoryStorage();
    resetGameStoreForTests(adapter);
    useGameStore.getState().newLife({ slot: 1, seed: 9 });
    stallOnEmptyChoice();
    saveGame(adapter, 1, game());

    // A reload: the event sheet this phase routes to is non-dismissible and
    // renders no card, so adopting the phase as-is would lock the slot for good.
    resetGameStoreForTests(adapter);
    expect(useGameStore.getState().loadSlot(1)).toBe(true);
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
    const age = game().character.age;

    useGameStore.getState().ageUp();
    expect(game().character.age).toBe(age + 1);
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
    expect(useGameStore.getState().loadSlot(1)).toBe(true);
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
    expect(useGameStore.getState().loadSlot(1)).toBe(true);
    expect(useGameStore.getState().casino).toBeNull();
  });

  /** Plants a raw table sidecar over a saved slot 1; what a reload adopts from it. */
  function adoptSidecar(raw: string): BlackjackTable | null {
    const adapter = memoryStorage();
    resetGameStoreForTests(adapter);
    setUpAdult();
    adapter.setItem('ol.table.1', raw);

    resetGameStoreForTests(adapter);
    expect(useGameStore.getState().loadSlot(1)).toBe(true);
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
    expect(useGameStore.getState().loadSlot(1)).toBe(true);
    stepYears(1);
    expect(useGameStore.getState().slotSummaries()[0]?.age).toBe(game().character.age);
    expect(pausedToasts()).toBe(0);
  });
});
