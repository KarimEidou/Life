import { beforeEach, describe, expect, it } from 'vitest';

import { getRegistry } from '@/content';
import type { BlackjackTable } from '@/content/gambling';
import { killCharacter } from '@/engine/death';
import { memoryStorage } from '@/engine/save';
import { resetGameStoreForTests, useGameStore } from '@/store/gameStore';
import { useUiStore } from '@/store/uiStore';
import type { GameState, Person } from '@/types';

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
