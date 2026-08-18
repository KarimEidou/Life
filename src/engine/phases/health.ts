/**
 * Health phase: illness onset, progression, recovery and addiction pressure.
 *
 * Nothing here kills: `IllnessDef.lethality` is rolled by the death-check phase,
 * so this phase must never consume a draw on it.
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

    if (!illness.treated) {
      const before = c.stats.health;
      c.stats.health = clampStat(before - def.healthHit / 2);
      if (before >= SERIOUS_HEALTH && c.stats.health < SERIOUS_HEALTH) {
        entries.push({ icon: '🤕', kind: 'bad', text: `Your ${def.label} is getting serious.` });
      }
      continue;
    }

    // Treatment holds a chronic condition steady; it never resolves on its own.
    if (def.chronic) continue;

    if (rng.chance(def.cureChance)) {
      c.illnesses = c.illnesses.filter((other) => other !== illness);
      entries.push({ icon: '💚', kind: 'good', text: `You recovered from ${def.label}.` });
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
