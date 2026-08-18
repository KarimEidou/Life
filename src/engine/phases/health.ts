/**
 * Health phase: illness onset, progression, recovery and addiction pressure.
 *
 * Nothing here kills: `IllnessDef.lethality` is rolled by the death-check phase,
 * so this phase must never consume a draw on it.
 *
 * Draw budget for one year: one onset roll per registry illness the character is
 * not already carrying, then one recovery roll per *non-chronic* illness held at
 * the start of the year whose definition still exists. Both loops roll
 * unconditionally — `rng.chance` always draws — so the budget is a function of
 * the registry and of what is held, never of a probability or of whether the
 * condition is being treated. Chronic conditions never resolve, so they are the
 * one case that consumes no recovery draw.
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

import { clampStat } from '@/engine/effects';
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

/* Registry maps are typed as total records, so widen before lookup: a save can
   outlive the content that defined one of its illnesses. */
function findIllness(reg: ContentRegistry, id: string): IllnessDef | undefined {
  const byId: Record<string, IllnessDef | undefined> = reg.illnessesById;
  return byId[id] ?? reg.illnesses.find((def) => def.id === id);
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

  for (const def of ctx.reg.illnesses) {
    if (held.has(def.id)) continue;
    const p = def.onsetWeight(ctx);
    // `chance` always draws, so the roll budget depends only on the registry.
    if (!rng.chance(Math.min(1, Math.max(0, p)))) continue;
    c.illnesses.push({ defId: def.id, years: 0, treated: false });
    c.stats.health = clampStat(c.stats.health - def.healthHit);
    entries.push({ icon: '🤒', kind: 'health', text: `You came down with ${def.label}.` });
  }

  for (const illness of carried) {
    const def = findIllness(ctx.reg, illness.defId);
    if (!def) continue;
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

  for (const key of ADDICTION_KEYS) {
    const before = c.addictions[key] ?? 0;
    if (before <= 0) continue;
    const severity = clampStat(before + ADDICTION_GROWTH);
    c.addictions[key] = severity;
    c.stats.health = clampStat(c.stats.health - severity / ADDICTION_HEALTH_DIVISOR);
    c.stats.happiness = clampStat(c.stats.happiness - severity / ADDICTION_HAPPINESS_DIVISOR);
    c.money = Math.max(0, Math.round(c.money - severity * ADDICTION_COST_PER_SEVERITY));
    if (before < ADDICTION_ALARM && severity >= ADDICTION_ALARM) {
      entries.push({
        icon: ADDICTION_ICON[key],
        kind: 'bad',
        text: `Your ${key} addiction is taking over your life.`,
      });
    }
  }

  return entries;
}
