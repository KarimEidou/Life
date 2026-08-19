import { describe, expect, it } from 'vitest';

import { famePack } from '@/content/fame';
import { resolveChoice } from '@/engine/ageUp';
import { runInteraction } from '@/engine/interactions';
import { eventsPhase } from '@/engine/phases/events';
import { buildRegistry } from '@/engine/registry';
import { createRng } from '@/engine/rng';
import { createLife } from '@/engine/state';
import type {
  ContentRegistry,
  Ctx,
  EventDef,
  GameState,
  InteractionDef,
  LogEntry,
  Rng,
} from '@/types';

/**
 * Fame pack contract.
 *
 * The pack's rows buy through `canUse`, which refuses a price the balance
 * cannot meet. Its one elective purchase on the *event* path has no such gate:
 * `applyEffects` writes money through `clampMoney`, which floors a negative
 * balance at $0 instead of refusing, so a priced branch with no `condition`
 * hands the reward to a character who paid nothing — or empties a partial
 * balance for it. `EventChoice.condition` is the whole defence: `openChoices`
 * keeps the label off the card, and the queue stores only what survived it.
 *
 * The pack's other money losses are involuntary by design (`ev-fame-paparazzi`
 * rolls its lawsuit, `ev-fame-stalker` offers no choice at all) and are
 * deliberately not gated.
 *
 * Its one *payout* has the mirror obligation. `applyEffects` writes a `money`
 * effect and pushes no entry, and `runInteraction` builds the feed from the
 * flavour line plus whatever the effects returned — so an amount a row does not
 * name itself is paid invisibly. `act-endorse` scales with fame, which makes the
 * figure the only thing that tells the player the row scales at all.
 */

const EMPTY = buildRegistry([]);
const fameEvents: EventDef[] = famePack.events ?? [];
const fameRows: InteractionDef[] = famePack.interactions ?? [];

function defOf(id: string): EventDef {
  const def = fameEvents.find((candidate) => candidate.id === id);
  if (!def) throw new Error(`fame ships no "${id}"`);
  return def;
}

/** A registry holding only the def under test, so the drawn pool is exactly it. */
function registryOf(defs: EventDef[]): ContentRegistry {
  return buildRegistry([{ id: 'fame-under-test', events: defs }]);
}

/** The pack's rows, which `runInteraction` looks up by id. */
function rowRegistry(): ContentRegistry {
  return buildRegistry([{ id: 'fame-under-test', interactions: fameRows }]);
}

/** Famous enough for the nomination, out of prison, inside its age window. */
function newCelebrity(seed: number, money: number): GameState {
  const state = createLife(EMPTY, { seed, firstName: 'Ada', lastName: 'Moreno' });
  state.character.age = 40;
  state.character.fame = 65;
  state.character.money = money;
  return state;
}

/** Both yearly rolls pass and `weighted` is a pure pick, so the draw is fixed. */
function alwaysDraws(): Rng {
  return {
    next: () => 0.5,
    int: (min: number) => min,
    pick: <T,>(arr: readonly T[]): T => arr[0] as T,
    chance: () => true,
    weighted: <T,>(items: readonly T[]): T => items[0] as T,
    normal: (mean: number) => mean,
  };
}

function ctxOf(state: GameState, reg: ContentRegistry, rng?: Rng): Ctx {
  return { state, c: state.character, rng: rng ?? createRng(state), reg };
}

function labelsOffered(state: GameState): string[] {
  return (state.pending[0]?.choices ?? []).map((choice) => choice.label);
}

/** The figure the prompt advertises, charged by both of the branch's outcomes. */
const CAMPAIGN_PRICE = 20000;

describe('ev-fame-award-nomination', () => {
  it('keeps the campaign off the card only while the balance cannot cover it', () => {
    const reg = registryOf([defOf('ev-fame-award-nomination')]);
    const short = newCelebrity(1, CAMPAIGN_PRICE - 1);
    const exact = newCelebrity(1, CAMPAIGN_PRICE);

    eventsPhase(ctxOf(short, reg, alwaysDraws()));
    eventsPhase(ctxOf(exact, reg, alwaysDraws()));

    expect(short.phase).toBe('awaitingChoice');
    expect(labelsOffered(short)).toEqual(['Stay home']);
    // A balance of exactly the price still buys it: the gate is inclusive.
    expect(labelsOffered(exact)).toEqual(['Campaign for it', 'Stay home']);
  });

  it('never bills a short balance for the campaign it could not be offered', () => {
    const state = newCelebrity(2, 5000);
    const reg = registryOf([defOf('ev-fame-award-nomination')]);

    eventsPhase(ctxOf(state, reg, alwaysDraws()));
    // The only surviving label; answering it must not touch the wallet.
    resolveChoice(state, reg, 0);

    expect(state.character.money).toBe(5000);
    expect(state.character.fame).toBe(66);
  });

  it('offers the campaign once the balance covers it, and charges the full price', () => {
    const state = newCelebrity(3, CAMPAIGN_PRICE + 5000);
    const reg = registryOf([defOf('ev-fame-award-nomination')]);

    eventsPhase(ctxOf(state, reg, alwaysDraws()));
    expect(labelsOffered(state)).toEqual(['Campaign for it', 'Stay home']);

    // Won or lost, the branch bills the same price, so the balance is the same.
    resolveChoice(state, reg, 0);

    expect(state.character.money).toBe(5000);
  });

  it('spends the same randomness whether or not the campaign was affordable', () => {
    const reg = registryOf([defOf('ev-fame-award-nomination')]);
    const broke = newCelebrity(4, 0);
    const rich = newCelebrity(4, CAMPAIGN_PRICE);

    // The real rng, so the phase's own draws are the ones under measurement.
    eventsPhase(ctxOf(broke, reg));
    eventsPhase(ctxOf(rich, reg));

    // Not vacuous: the card has to have been queued for there to be a gate.
    expect(broke.phase).toBe('awaitingChoice');
    expect(rich.phase).toBe('awaitingChoice');
    // A condition is a read, and a conditioned-out label costs no extra draw.
    expect(broke.rngState).toBe(rich.rngState);
  });
});

/** `Math.round(fame * 1200)`, the fee the row is documented to pay. */
function feeAtFame(fame: number): number {
  return Math.round(fame * 1200);
}

/** The figures the feed actually shows, in order. */
function moneyLines(entries: readonly LogEntry[]): string[] {
  return entries.filter((entry) => entry.kind === 'money').map((entry) => entry.text);
}

describe('act-endorse', () => {
  it('names in the feed the fee it actually paid', () => {
    const state = newCelebrity(5, 0);
    const reg = rowRegistry();

    const result = runInteraction(state, reg, 'act-endorse');

    // fame 65 → $78,000, and the balance started empty, so it *is* the fee.
    expect(state.character.money).toBe(feeAtFame(65));
    expect(moneyLines(result?.entries ?? [])).toEqual(['+$78,000']);
    // The flavour line still leads; the figure is an extra line, not a rewrite.
    expect(result?.entries[0]?.text).toContain('The cheque cleared.');
    // And the feed carries what the caller was handed.
    expect(moneyLines(state.log[state.log.length - 1]?.entries ?? [])).toEqual(['+$78,000']);
  });

  it('scales the figure it names with the fame that earned it', () => {
    const modest = newCelebrity(6, 0);
    modest.character.fame = 40; // the row's own floor
    const star = newCelebrity(6, 0);
    star.character.fame = 100;

    const modestResult = runInteraction(modest, rowRegistry(), 'act-endorse');
    const starResult = runInteraction(star, rowRegistry(), 'act-endorse');

    expect(moneyLines(modestResult?.entries ?? [])).toEqual(['+$48,000']);
    expect(moneyLines(starResult?.entries ?? [])).toEqual(['+$120,000']);
    expect(modest.character.money).toBe(feeAtFame(40));
    expect(star.character.money).toBe(feeAtFame(100));
  });

  it('reports nothing for a refusal, which pays nothing', () => {
    const state = newCelebrity(7, 0);
    state.character.fame = 39; // one short of `famous(40)`

    const result = runInteraction(state, rowRegistry(), 'act-endorse');

    // Genuinely refused, not merely silent: no line of any kind, and no fee.
    expect(result?.text).toBe("You can't do that right now.");
    expect(result?.entries).toEqual([]);
    expect(state.character.money).toBe(0);
  });

  it('spends no draw naming the figure', () => {
    const state = newCelebrity(8, 0);
    const control = newCelebrity(8, 0);

    runInteraction(state, rowRegistry(), 'act-endorse');
    /* The row's only draw is the `pick` that chooses the endorsement — one draw
       whatever the pool holds, so a one-element stand-in reproduces it. The fee
       is arithmetic and the log line is data: neither may cost a second. */
    createRng(control).pick(['the endorsement']);

    expect(state.rngState).toBe(control.rngState);
  });
});
