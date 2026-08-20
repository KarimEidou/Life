import { beforeEach, describe, expect, it } from 'vitest';

import { getRegistry, resetRegistryForTests } from '@/content';
import { MILESTONE, MILESTONE_ONE_YEAR } from '@/content/lib';
import { buildRegistry } from '@/engine/registry';
import type { ContentPack, ContentRegistry, EventDef } from '@/types';

/**
 * Reachability: every once-in-a-life card has to be able to happen.
 *
 * `oncePerLife` is a promise that a card is a beat rather than filler, and it
 * is the one flag that makes a card's weight a whole life's odds instead of a
 * yearly one. Nothing checked those odds, and thirteen cards shipped under a
 * 15% lifetime chance with nine of them under 8% — prom at 4.6%, the yearbook
 * quote at 1.9%. They were not rare on purpose; they were weight 4 in a pool of
 * 255, which is what weight 4 buys at seventeen.
 *
 * So this file computes the number nobody was computing, straight out of the
 * built registry — no RNG, no state, no simulation:
 *
 *   DRAWS       = 0.85 + 0.85 * 0.4          the yearly event budget
 *   total(age)  = Σ weight over every card whose window covers `age`
 *   p(e, age)   = min(1, DRAWS * e.weight / total(age))
 *   ceiling(e)  = 1 - Π p-misses across e's window
 *
 * Every term is deliberately generous, which is what makes it a ceiling rather
 * than a forecast: conditions are ignored (a card gated on a spouse is counted
 * as if everyone had one), mortality is ignored (nobody dies before their window
 * opens), and the two yearly draws are counted as independent when a choice card
 * actually blocks the second. One term pulls the other way — a `oncePerLife`
 * card that fires leaves the pool, so the survivors' share grows as a window
 * empties — but it is small beside the conditions, and what this number is for
 * is holding a card against the pool it was authored into rather than predicting
 * a cohort. `simulation.test.ts` is where a real cohort gets measured.
 *
 * The floor is a life in ten. It is not the 25% the audit first proposed, and
 * the reason is arithmetic rather than taste: age seventeen alone carries eight
 * narrow once-per-life cards, and 8 × 0.25 is two expected firings out of the
 * 1.19 draws that year has. No weight can buy that, so a 25% floor would have
 * been a rule no content could satisfy — it is a statement about how many
 * milestones a year holds, not about any one card's weight. A tenth is the
 * strongest floor the draw budget leaves room for: with the band applied the
 * tightest shipped card sits at 13.5%, and the two that shipped at 1.9% are at
 * 13.8%.
 */

/**
 * `FIRST_EVENT_CHANCE` and `SECOND_EVENT_CHANCE`, mirrored from
 * `engine/phases/events.ts` — both are module-private there and neither is
 * worth exporting for a lint. They scale every ceiling by the same factor, so
 * drift here moves how strict the floor is and never which card is the tightest;
 * `eventsPhase`'s own tests are what hold the values themselves.
 */
const FIRST = 0.85;
const SECOND = 0.4;

/** At most 1.19 events a year: 85% for the first, then 40% for a second. */
const DRAWS = FIRST + FIRST * SECOND;

/**
 * Ages counted, ignoring the tail. `deathCheckPhase` allows 110, but a window
 * whose `maxAge` is 110 or 120 is asking for years hardly any life reaches, and
 * counting them would let a card pay for a thin weight with birthdays nobody
 * has. Truncating understates those ceilings, which keeps the floor honest.
 */
const OLDEST = 90;

/** One life in ten. Under this a card is content nobody will see. */
const FLOOR = 0.1;

/** Total weight of every card whose window covers each age, indexed by age. */
function poolByAge(reg: ContentRegistry): number[] {
  const totals: number[] = [];
  for (let age = 0; age <= OLDEST; age += 1) {
    totals[age] = reg.events.reduce(
      (sum, def) => (age >= def.minAge && age <= def.maxAge ? sum + def.weight : sum),
      0
    );
  }
  return totals;
}

/** The share of lives in which an event fires at least once, at its ceiling. */
function ceiling(def: EventDef, totals: number[]): number {
  let missed = 1;
  for (let age = Math.max(0, def.minAge); age <= Math.min(def.maxAge, OLDEST); age += 1) {
    const total = totals[age] ?? 0;
    // A pool of zero is a window no card covers, this one included; nothing to divide by.
    if (total <= 0) continue;
    missed *= 1 - Math.min(1, (DRAWS * def.weight) / total);
  }
  return 1 - missed;
}

/** Every once-per-life card whose ceiling is under the floor, worst first. */
function unreachable(reg: ContentRegistry): string[] {
  const totals = poolByAge(reg);
  return reg.events
    .filter((def) => def.oncePerLife === true)
    .map((def) => ({ def, reach: ceiling(def, totals) }))
    .filter(({ reach }) => reach < FLOOR)
    .sort((a, b) => a.reach - b.reach)
    .map(
      ({ def, reach }) =>
        `event "${def.id}" (weight ${def.weight}, ages ${def.minAge}-${def.maxAge}) fires in ${(reach * 100).toFixed(1)}% of lives`
    );
}

/** A pack of one milestone against `filler` weight of ordinary cards sharing its window. */
function crowded(milestone: Partial<EventDef>, filler: number): ContentRegistry {
  const card = (over: Partial<EventDef>): EventDef => ({
    id: 'ev-test-card',
    area: 'life',
    icon: '🎈',
    minAge: 17,
    maxAge: 17,
    weight: 4,
    text: 'Something happened.',
    ...over,
  });
  const pack: ContentPack = {
    id: 'events-under-test',
    events: [
      card({ id: 'ev-test-milestone', oncePerLife: true, ...milestone }),
      card({ id: 'ev-test-filler', minAge: 0, maxAge: OLDEST, weight: filler }),
    ],
  };
  return buildRegistry([pack]);
}

describe('milestone reachability', () => {
  let reg: ContentRegistry;

  beforeEach(() => {
    resetRegistryForTests();
    reg = getRegistry();
  });

  it('gives every once-in-a-life card a real chance of happening', () => {
    expect(unreachable(reg)).toEqual([]);
  });

  it('has once-in-a-life cards to lint in the first place', () => {
    // A lint that iterates nothing passes; these are what keep it honest when a
    // pack falls out of `allPacks`. The shipped table carries 33 such cards.
    const once = reg.events.filter((def) => def.oncePerLife === true);
    expect(once.length).toBeGreaterThanOrEqual(25);
    expect(new Set(once.map((def) => def.area)).size).toBeGreaterThanOrEqual(4);
    expect(unreachable(buildRegistry([]))).toEqual([]);
  });

  it('names a milestone the pool has crowded out', () => {
    // Weight 4 in a one-year window against a 250-weight pool: the shape every
    // card in the audit's table had, and the shape the next one will have.
    expect(unreachable(crowded({ weight: 4 }, 250))).toEqual([
      'event "ev-test-milestone" (weight 4, ages 17-17) fires in 1.9% of lives',
    ]);
    expect(unreachable(crowded({ weight: MILESTONE_ONE_YEAR }, 250))).toEqual([]);
  });

  it('reads a wide window as reachable on ordinary weight', () => {
    // Same weight, same pool, thirteen years instead of one: the reason the band
    // is applied by window and not by how important a card sounds.
    expect(unreachable(crowded({ weight: 4, minAge: 28, maxAge: 40 }, 250))).toEqual([]);
  });

  it('ignores a card that may fire more than once', () => {
    // A repeatable card at weight 4 has a whole life to come round again, and
    // `firedEvents` never holds it out of the pool. Nothing to measure.
    expect(unreachable(crowded({ oncePerLife: false }, 250))).toEqual([]);
  });

  it('keeps the milestone band clear of the flat table', () => {
    // Read off the registry rather than hardcoded, so a pack that starts
    // authoring weight-40 filler is what fails rather than this number.
    const banded: readonly number[] = [MILESTONE, MILESTONE_ONE_YEAR];
    const ordinary = reg.events
      .filter((def) => !banded.includes(def.weight))
      .map((def) => def.weight);

    // `Math.max()` of nothing is -Infinity, which would pass on an empty table.
    expect(ordinary.length).toBeGreaterThanOrEqual(150);
    expect(Math.max(...ordinary)).toBeLessThan(MILESTONE);
  });

  it('carries the beats the audit measured', () => {
    // The named cards, so the band cannot quietly be taken back off them.
    const byId = new Map(reg.events.map((def) => [def.id, def]));
    for (const id of [
      'ev-teen-preprom',
      'ev-teen-learner-permit',
      'ev-teen-first-paycheck',
      'ev-teen-driving-lesson',
      'ev-school-prom',
      'ev-school-valedictorian',
      'ev-school-yearbook',
      'ev-school-science-fair',
      'ev-school-spelling-bee',
    ]) {
      expect(byId.get(id)?.weight, id).toBe(MILESTONE);
    }
    for (const id of ['ev-teen-yearbook-quote', 'ev-teen-graduation-nerves']) {
      const def = byId.get(id);
      expect(def?.weight, id).toBe(MILESTONE_ONE_YEAR);
      // The doubling is for a one-year window; widen one and it is the wrong band.
      expect(def?.maxAge, id).toBe(def?.minAge);
    }
  });
});
