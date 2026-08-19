import { describe, expect, it } from 'vitest';

import { activitiesPack } from '@/content/activities';
import { famePack } from '@/content/fame';
import { resolveChoice } from '@/engine/ageUp';
import { applyEffects } from '@/engine/effects';
import { availableInteractions, runInteraction } from '@/engine/interactions';
import { eventsPhase } from '@/engine/phases/events';
import { buildRegistry } from '@/engine/registry';
import { createRng } from '@/engine/rng';
import { addPerson, createLife } from '@/engine/state';
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

  it('names the cheque, not the balance it landed in', () => {
    const state = newCelebrity(9, 3140);

    const result = runInteraction(state, rowRegistry(), 'act-endorse');

    /* A non-empty wallet is what tells the two apart: the row is paid on top of
       3,140, so a figure read off the new balance would say $81,140. */
    expect(state.character.money).toBe(3140 + feeAtFame(65));
    expect(moneyLines(result?.entries ?? [])).toEqual(['+$78,000']);
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

/**
 * Activities pack: the rows a sentence takes away.
 *
 * The pack's rule is that the prison pack owns those years, and it names the
 * handful that survive one — a book, the yard, the prison library. Every other
 * row has to ask `free`, because nothing else asks for it: `canUse` and
 * `availableInteractions` consult `condition` and never `c.prison`, and the
 * Activities tab stays on the bar for the whole sentence. A row that forgets is
 * playable from a cell — free, uncooled and unlimited — beside a prison pack
 * that puts its own mood rows on a yearly cooldown for exactly that reason.
 */

const activityRows: InteractionDef[] = activitiesPack.interactions ?? [];

/** Every area the pack ships, so a new one cannot slip past this contract. */
const ACTIVITY_AREAS = [...new Set(activityRows.map((row) => row.area))];

/** The three the pack documents as surviving a sentence. */
const PRISON_SAFE = ['act-gym', 'act-library', 'act-read-book'];

/** Reads as a bug from a cell: a console, a games night, a retreat. */
const OUTSIDE_ONLY = ['act-board-games', 'act-meditate', 'act-video-games'];

function activitiesRegistry(): ContentRegistry {
  return buildRegistry([{ id: 'activities-under-test', interactions: activityRows }]);
}

/** Mid-sentence, past every age gate the pack sets and able to afford every row. */
function inmate(seed: number): GameState {
  const state = createLife(EMPTY, { seed, firstName: 'Ada', lastName: 'Moreno' });
  state.character.age = 30;
  state.character.money = 50000;
  state.character.prison = { crime: 'Robbery', yearsLeft: 6, totalYears: 6 };
  return state;
}

/** What the Activities sheet would list, across all of its sections. */
function offeredIds(state: GameState, reg: ContentRegistry): string[] {
  return ACTIVITY_AREAS.flatMap((area) => availableInteractions(state, reg, area))
    .map((def) => def.id)
    .sort();
}

describe('activities during a sentence', () => {
  it('offers from a cell exactly the rows it documents as surviving one', () => {
    const state = inmate(11);

    expect(offeredIds(state, activitiesRegistry())).toEqual([...PRISON_SAFE].sort());
  });

  it('hands the rest back the year the sentence ends', () => {
    const state = inmate(11);
    const jailed = offeredIds(state, activitiesRegistry());
    state.character.prison = null;

    const released = offeredIds(state, activitiesRegistry());

    // Gated, not deleted: the same character out of the cell sees them again.
    expect(released).toEqual(expect.arrayContaining([...PRISON_SAFE, ...OUTSIDE_ONLY]));
    expect(released).toEqual(expect.arrayContaining(jailed));
    expect(released.length).toBeGreaterThan(jailed.length);
  });

  it('refuses the row itself, not merely its place in the sheet', () => {
    const state = inmate(12);
    const before = state.character.stats.happiness;
    const cursor = state.rngState;

    // The sheet drops the row, but the store can still be asked for it by id.
    const result = runInteraction(state, activitiesRegistry(), 'act-video-games');

    expect(result?.text).toBe("You can't do that right now.");
    expect(result?.entries).toEqual([]);
    expect(state.character.stats.happiness).toBe(before);
    /* A refusal costs nothing at all: no cooldown stamp, and no draw — the row's
       own `chance(0.5)` is never reached, so the year's rolls are untouched. */
    expect(state.interactionUse['act-video-games']).toBeUndefined();
    expect(state.rngState).toBe(cursor);
  });

  it('still runs the rows it does offer from inside', () => {
    const state = inmate(13);
    const before = state.character.stats.smarts;

    const result = runInteraction(state, activitiesRegistry(), 'act-read-book');

    expect(result?.text).toContain('You finished');
    expect(state.character.stats.smarts).toBeGreaterThan(before);
  });
});

/**
 * `act-vet-visit` prices the visit through `cost`, which `runInteraction` takes
 * before `resolve` is ever reached — so the fee is already gone by the time the
 * row picks a branch. Its petless branch is a guard the row's own `condition`
 * keeps off the live path, which leaves nothing but this contract holding its
 * sign: money handed back there is a refund that nets the visit to $0 while the
 * line it ships says the vet charged anyway.
 */

/** The price the row declares, and therefore what the engine takes up front. */
const VET_FEE = 200;

function activityRow(id: string): InteractionDef {
  const def = activityRows.find((candidate) => candidate.id === id);
  if (!def) throw new Error(`activities ships no "${id}"`);
  return def;
}

/** Out of prison, past the row's age gate, holding a household of `pets`. */
function petOwner(seed: number, pets: number): GameState {
  const state = createLife(EMPTY, { seed, firstName: 'Ada', lastName: 'Moreno' });
  state.character.age = 30;
  state.character.money = 1000;
  for (let i = 0; i < pets; i += 1) {
    addPerson(state, {
      kind: 'pet',
      name: 'Biscuit',
      gender: 'female',
      age: 3,
      alive: true,
      rel: 80,
      petSpecies: 'dog',
      flags: {},
    });
  }
  return state;
}

describe('act-vet-visit', () => {
  it('takes the fee once when there is a pet to take', () => {
    const state = petOwner(21, 1);
    const before = state.character.money;

    const result = runInteraction(state, activitiesRegistry(), 'act-vet-visit');

    expect(result?.text).toContain('was very brave');
    expect(state.character.money).toBe(before - VET_FEE);
  });

  it('hands nothing back on the branch whose line says it was charged', () => {
    /* `condition` keeps this branch off the live path, so the row is asked
       directly: the guard still has to agree with its own copy the day the
       condition loosens — greying the row out for a petless household instead
       of dropping it is exactly what `availableInteractions` documents. */
    const state = petOwner(22, 0);
    const reg = activitiesRegistry();
    const charged = state.character.money - VET_FEE; // where runInteraction leaves it
    state.character.money = charged;
    const cursor = state.rngState;

    const branch = activityRow('act-vet-visit').resolve(ctxOf(state, reg));
    applyEffects({ state, rng: createRng(state), reg }, branch.effects);

    // Not vacuous: this is the petless branch, and it says it was charged.
    expect(branch.text).toContain('charged you anyway');
    expect(state.character.money).toBe(charged);
    // The branch guards before picking, so a no-op costs no draw either.
    expect(state.rngState).toBe(cursor);
  });
});
