/**
 * Health phase: illness onset, progression, recovery and addiction pressure.
 *
 * Nothing here kills: `IllnessDef.lethality` is rolled by the death-check phase,
 * so this phase must never consume a draw on it.
 *
 * Draw budget for one year: one onset roll per registry illness the character is
 * not already holding — carried in from last year, or caught earlier in the same
 * loop through a duplicate id — then one recovery roll per *non-chronic* illness
 * held at the start of the year whose definition still exists. Both loops roll
 * unconditionally — `rng.chance` always draws — so the budget is a function of
 * the registry and of what is held, never of a probability or of whether the
 * condition is being treated. Chronic conditions never resolve, so they are the
 * one case that consumes no recovery draw. A held row whose definition is gone
 * is dropped rather than skipped — silently and without a draw, so it never
 * enters the budget at all; see the progression loop.
 *
 * `Illness.treated` is a modifier, not a gate: treatment holds a condition steady
 * (it stops costing health) and doubles the odds of shaking a non-chronic one off.
 * Recovery has to work without it, because an untreated cold still passes.
 *
 * `IllnessDef.label` carries its own article ('the flu', 'a bad back') because the
 * death line reads `You died of ${label}.`, so every sentence built here has to take
 * the label as the object of a verb or preposition. A possessive frame (`Your
 * ${label} ...`) would demand a bare noun and no single label can satisfy both.
 */

import { clampMoney, clampStat } from '@/engine/effects';
import { findById } from '@/engine/registry';
import type {
  AddictionKey,
  ContentRegistry,
  Ctx,
  Illness,
  IllnessDef,
  LogEntry,
} from '@/types';

/** Health level a condition has to drag the character under to be worth a warning. */
const SERIOUS_HEALTH = 30;

/** How much treatment multiplies the yearly odds of shaking a condition off. */
const TREATED_CURE_MULT = 2;

/** Severity every live addiction gains each year it is left alone. */
const ADDICTION_GROWTH = 3;

/** Severity at which an addiction starts running the character's life. */
const ADDICTION_ALARM = 50;

/** Divisors turning severity into the yearly toll it takes. */
const ADDICTION_HEALTH_DIVISOR = 20;
const ADDICTION_HAPPINESS_DIVISOR = 25;
const ADDICTION_COST_PER_SEVERITY = 20;

const ADDICTION_ICON: Record<AddictionKey, string> = {
  alcohol: '🍺',
  smoking: '🚬',
  gambling: '🎰',
  drugs: '💊',
};

/* Fixed order so the yearly toll never depends on key insertion order in a save. */
const ADDICTION_KEYS: readonly AddictionKey[] = ['alcohol', 'smoking', 'gambling', 'drugs'];

/**
 * Flag marking that an addiction has already been announced as taking over.
 *
 * The warning has to be a latch rather than a comparison of this year's
 * severity against last year's: severity also moves through
 * `{kind:'addiction'}` effects — from events, choices and interactions, all of
 * which run later in the year than this phase — so a crossing of the alarm can
 * happen where nothing is watching, and by the next health phase the severity
 * is already past the threshold and no comparison can recover the crossing.
 * The flag records that the line was announced instead of when it was crossed,
 * and is cleared again whenever severity falls back under the alarm, so a
 * relapse after rehab is announced afresh. Flags are free-form and saved as
 * they stand, so this needs no save migration: a life already over the alarm
 * when the flag arrives hears the line once, which is the line its own crossing
 * never got.
 */
function alarmFlag(key: AddictionKey): string {
  return `addictionAlarm.${key}`;
}

/* A save can outlive the content that defined one of its illnesses. */
function findIllness(reg: ContentRegistry, id: string): IllnessDef | undefined {
  return findById(reg.illnessesById, reg.illnesses, id);
}

/** Yearly odds of recovering: the def's own chance, doubled by treatment. */
function cureOdds(def: IllnessDef, illness: Illness): number {
  const p = def.cureChance * (illness.treated ? TREATED_CURE_MULT : 1);
  return Math.min(1, Math.max(0, p));
}

/** Rolls new illnesses by onset weight, then ages and resolves the active ones. */
export function healthPhase(ctx: Ctx): LogEntry[] {
  const entries: LogEntry[] = [];
  const c = ctx.state.character;
  const rng = ctx.rng;

  /* Snapshot first: an illness caught this year takes its onset hit and nothing
     else, so it starts progressing from next year. */
  const carried: Illness[] = [...c.illnesses];
  const held = new Set(carried.map((illness) => illness.defId));

  /* Every onset is rolled against start-of-year state and committed only after
     the loop. `onsetWeight` is handed the live `ctx`, and content reads exactly
     what an onset writes — whether a comorbidity is held, how low health has
     fallen — so committing mid-loop would let an illness caught this year raise
     the odds of every illness rolled after it in the same year, a year before
     the character had any chance to treat it, and would make those odds depend
     on where a def happens to sit in the registry. Draw order and budget are
     untouched: still one `rng.chance` per un-held def, in registry order, and
     the entries are pushed in that same order. */
  const caught: IllnessDef[] = [];

  for (const def of ctx.reg.illnesses) {
    if (held.has(def.id)) continue;
    const p = def.onsetWeight(ctx);
    // `chance` always draws, so the roll budget depends only on the registry.
    if (!rng.chance(Math.min(1, Math.max(0, p)))) continue;
    /* A catch counts as held from here on. `buildRegistry` keeps every duplicate
       id in the flat list — that is what lets `validateRegistry` name the
       offending pack — and nothing runs that lint at load time, so a second def
       sharing this id would otherwise roll again and contract the same illness
       twice in the same year: two rows on the sheet, the health hit paid twice,
       the log line printed twice and double the hazard in the death check. */
    held.add(def.id);
    caught.push(def);
  }

  for (const def of caught) {
    c.illnesses.push({ defId: def.id, years: 0, treated: false });
    c.stats.health = clampStat(c.stats.health - def.healthHit);
    entries.push({ icon: '🤒', kind: 'health', text: `You came down with ${def.label}.` });
  }

  /* Rows whose definition has vanished, collected here and dropped after the
     loop. A save can outlive the pack that defined one of its illnesses, and an
     `{kind:'illness', add}` effect can name an id no pack ever shipped. Nothing
     downstream can move such a row: it never ages, never rolls recovery, is
     invisible to `deathCheckPhase`'s hazard and cause-of-death, has no label the
     UI can render, and cannot even be cured — the `{kind:'illness', cure}`
     effect would have to come from the very pack that is missing — so skipping
     it parks it on the Health sheet for the rest of the life. It is dropped
     instead, exactly as `educationPhase` empties a desk whose school is gone.
     Like `ageUp`'s `discardPending` this consumes no randomness, so the yearly
     budget stays a function of the registry and the year replays identically. */
  const phantom = new Set<Illness>();

  for (const illness of carried) {
    const def = findIllness(ctx.reg, illness.defId);
    if (!def) {
      phantom.add(illness);
      continue;
    }
    illness.years += 1;

    /* A chronic condition is held for life and takes no recovery draw; anything
       else gets exactly one, treated or not — that roll is the whole reason a
       cold ever ends. Recovering ends the year for this illness, so a year that
       resolves costs no further health. */
    if (!def.chronic && rng.chance(cureOdds(def, illness))) {
      c.illnesses = c.illnesses.filter((other) => other !== illness);
      entries.push({ icon: '💚', kind: 'good', text: `You recovered from ${def.label}.` });
      continue;
    }

    // Treatment holds a still-active condition steady instead of curing it.
    if (illness.treated) continue;

    const before = c.stats.health;
    c.stats.health = clampStat(before - def.healthHit / 2);
    if (before >= SERIOUS_HEALTH && c.stats.health < SERIOUS_HEALTH) {
      entries.push({
        icon: '🤕',
        kind: 'bad',
        text: `You are getting seriously ill with ${def.label}.`,
      });
    }
  }

  if (phantom.size > 0) {
    c.illnesses = c.illnesses.filter((illness) => !phantom.has(illness));
  }

  for (const key of ADDICTION_KEYS) {
    const latch = alarmFlag(key);
    const before = c.addictions[key] ?? 0;
    /* Re-armed before the `continue`, so a habit beaten back — all the way to
       zero or merely under the alarm — is announced again if it climbs back. */
    if (before < ADDICTION_ALARM) delete c.flags[latch];
    if (before <= 0) continue;
    const severity = clampStat(before + ADDICTION_GROWTH);
    c.addictions[key] = severity;
    c.stats.health = clampStat(c.stats.health - severity / ADDICTION_HEALTH_DIVISOR);
    c.stats.happiness = clampStat(c.stats.happiness - severity / ADDICTION_HAPPINESS_DIVISOR);
    /* `clampMoney`, never `Math.max(0, ...)`: the toll itself is always readable
       — `severity` is a `clampStat` output — so what this write has to survive
       is the balance it reads. `Math.max(0, NaN)` is NaN, which handed a
       poisoned balance straight back every year instead of settling it. See
       `clampMoney`'s own comment. */
    c.money = clampMoney(c.money - severity * ADDICTION_COST_PER_SEVERITY, c.money);
    if (severity >= ADDICTION_ALARM && c.flags[latch] !== true) {
      c.flags[latch] = true;
      entries.push({
        icon: ADDICTION_ICON[key],
        kind: 'bad',
        text: `Your ${key} addiction is taking over your life.`,
      });
    }
  }

  return entries;
}
