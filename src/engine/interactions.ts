/**
 * Player-initiated actions: activities, relationship moves and crimes.
 *
 * Everything here runs outside the year loop and writes into the current
 * `YearLog`, so the feed reads as one continuous year.
 */

import { currentYearLog } from '@/engine/ageUp';
import { killCharacter } from '@/engine/death';
import { applyEffects } from '@/engine/effects';
import { fillTemplate, fmtMoney } from '@/engine/format';
import { createRng } from '@/engine/rng';
import type {
  ContentRegistry,
  CrimeDef,
  Ctx,
  Effect,
  GameState,
  InteractionDef,
  LogEntry,
  Person,
} from '@/types';

/** Upper bound when a def sets no `maxAge`; no life reaches it. */
const DEFAULT_MAX_AGE = 200;

/** Shown on any action the character was not allowed to take. */
const BLOCKED_ICON = '🚫';

/** Second and later convictions carry half again the rolled sentence. */
const REPEAT_OFFENDER_MULT = 1.5;

/** Mood cost of being convicted, on top of the sentence itself. */
const CONVICTION_HAPPINESS = 10;

const DEFAULT_DEATH_CAUSE = 'natural causes';

/* Registry maps are typed as total records, so widen before lookup: a hand-built
   or partially loaded registry can still miss the key we ask for. */
function findInteraction(reg: ContentRegistry, id: string): InteractionDef | undefined {
  const byId: Record<string, InteractionDef | undefined> = reg.interactionsById;
  return byId[id];
}

function findCrime(reg: ContentRegistry, id: string): CrimeDef | undefined {
  const byId: Record<string, CrimeDef | undefined> = reg.crimesById;
  return byId[id];
}

/** Price of one use, rounded to whole money and never negative. */
function costOf(ctx: Ctx, def: InteractionDef): number {
  const raw = typeof def.cost === 'function' ? def.cost(ctx) : def.cost ?? 0;
  return Number.isFinite(raw) ? Math.max(0, Math.round(raw)) : 0;
}

/** Death protocol: effects only mark a death, the obituary is settled here. */
function settleDeath(state: GameState, reg: ContentRegistry): void {
  if (state.phase !== 'dead' || state.death) return;
  const cause = String(state.character.flags.pendingDeathCause ?? DEFAULT_DEATH_CAUSE);
  killCharacter(state, reg, cause);
}

/** Checks the age window, condition, cooldown and whether the cost is affordable. */
export function canUse(ctx: Ctx, def: InteractionDef): { ok: boolean; reason?: string } {
  const c = ctx.state.character;
  const age = c.age;

  if (age < (def.minAge ?? 0)) return { ok: false, reason: "You're too young." };
  if (age > (def.maxAge ?? DEFAULT_MAX_AGE)) return { ok: false, reason: "You're too old." };
  if (def.condition && !def.condition(ctx)) {
    return { ok: false, reason: "You can't do that right now." };
  }

  // `interactionUse` stores the AGE of the last use, not a year or a timestamp.
  const cooldown = def.cooldownYears ?? 0;
  const lastUsedAge = ctx.state.interactionUse[def.id];
  if (cooldown > 0 && typeof lastUsedAge === 'number' && age - lastUsedAge < cooldown) {
    return { ok: false, reason: 'Too soon.' };
  }

  if (c.money < costOf(ctx, def)) return { ok: false, reason: "You can't afford it." };

  return { ok: true };
}

/** All interactions in `area` that currently pass `canUse`. */
export function availableInteractions(
  state: GameState,
  reg: ContentRegistry,
  area: string
): InteractionDef[] {
  /* A detached cursor: listing what a sheet can show is a read, and a read must
     never advance the run's RNG even if a condition draws from it. */
  const ctx: Ctx = {
    state,
    c: state.character,
    rng: createRng({ rngState: state.rngState }),
    reg,
  };
  const age = state.character.age;

  return reg.interactions
    .filter((def) => def.area === area)
    .filter((def) => age >= (def.minAge ?? 0) && age <= (def.maxAge ?? DEFAULT_MAX_AGE))
    .filter((def) => (def.condition ? def.condition(ctx) : true))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Runs one interaction: resolves `targetId` into `ctx.target`, charges the cost,
 * applies the resolved effects, records the cooldown in `interactionUse` and
 * appends the entries to the current year log. Returns null when unavailable.
 */
export function runInteraction(
  state: GameState,
  reg: ContentRegistry,
  id: string,
  targetId?: string
): { text: string; icon: string; entries: LogEntry[] } | null {
  const def = findInteraction(reg, id);
  // null means "no such action"; a refusal is a normal result with a reason.
  if (!def) return null;

  const c = state.character;
  const rng = createRng(state);
  const target: Person | undefined = targetId !== undefined ? state.people[targetId] : undefined;
  const ctx: Ctx = { state, c, rng, reg, target };

  const gate = canUse(ctx, def);
  if (!gate.ok) {
    return { text: gate.reason ?? "You can't do that.", icon: BLOCKED_ICON, entries: [] };
  }

  const cost = costOf(ctx, def);
  if (cost > 0) c.money = Math.max(0, Math.round(c.money - cost));

  const result = def.resolve(ctx);
  const icon = result.icon ?? def.icon;
  const text = fillTemplate(result.text, state);

  const entries: LogEntry[] = [{ icon, kind: 'info', text }];
  entries.push(...applyEffects({ state, rng, reg, target }, result.effects));

  state.interactionUse[def.id] = c.age;
  currentYearLog(state).entries.push(...entries);
  settleDeath(state, reg);

  return { text, icon, entries };
}

/** Rolls the crime's success chance, then applies either the payout or a jail sentence. */
export function commitCrime(
  state: GameState,
  reg: ContentRegistry,
  crimeId: string
): { text: string; icon: string; entries: LogEntry[] } {
  const c = state.character;
  const def = findCrime(reg, crimeId);
  if (!def) return { text: 'You thought better of it.', icon: BLOCKED_ICON, entries: [] };
  if (c.prison) return { text: "You're already in prison.", icon: BLOCKED_ICON, entries: [] };

  const rng = createRng(state);
  const ctx: Ctx = { state, c, rng, reg };

  if (rng.chance(def.successChance(ctx))) {
    const payout = rng.int(def.payout[0], def.payout[1]);
    c.money = Math.max(0, Math.round(c.money + payout));
    const text = `You got away with ${def.label}. +${fmtMoney(payout)}`;
    const entries: LogEntry[] = [{ icon: def.icon, kind: 'legal', text }];
    currentYearLog(state).entries.push(...entries);
    return { text, icon: def.icon, entries };
  }

  const rolled = rng.int(def.sentenceYears[0], def.sentenceYears[1]);
  const convictions = Number(c.flags.convictions ?? 0);
  const priors = Number.isFinite(convictions) && convictions > 0 ? convictions : 0;
  const years = priors > 0 ? Math.round(rolled * REPEAT_OFFENDER_MULT) : rolled;

  const text = `GUILTY. ${def.label}.`;
  // The headline lands before the sentencing line `applyEffects` produces.
  const entries: LogEntry[] = [{ icon: def.icon, kind: 'legal', text }];
  const punishment: Effect[] = [
    { kind: 'jail', years, crime: def.label },
    { kind: 'stat', stat: 'happiness', delta: -CONVICTION_HAPPINESS },
  ];
  entries.push(...applyEffects({ state, rng, reg }, punishment));
  c.flags.convictions = priors + 1;

  currentYearLog(state).entries.push(...entries);
  settleDeath(state, reg);

  return { text, icon: def.icon, entries };
}
