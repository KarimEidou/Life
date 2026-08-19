/**
 * Player-initiated actions: activities, relationship moves and crimes.
 *
 * Everything here runs outside the year loop and writes into the current
 * `YearLog`, so the feed reads as one continuous year.
 */

import { currentYearLog } from '@/engine/ageUp';
import { killCharacter } from '@/engine/death';
import { applyEffects, clampMoney, personById } from '@/engine/effects';
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

/** Refusal handed to every player action once the life has ended. */
const LIFE_OVER = 'Your life is over.';

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

/**
 * Price of one use, rounded to whole money and never negative.
 *
 * A price that is not a readable amount is reported as infinite, i.e.
 * unaffordable — never free. `Math.max(0, NaN)` is NaN and an infinite price
 * passes every `> 0` test, so both used to price the row at $0: the wallet check
 * waved it through, `runInteraction` charged nothing and the sheet showed no
 * price, which made an item priced beyond what the game can express the cheapest
 * thing in it. This is the price twin of `clampMoney`, which keeps the balance it
 * cannot read rather than storing it — an unreadable number buys nothing.
 */
function costOf(ctx: Ctx, def: InteractionDef): number {
  const raw = typeof def.cost === 'function' ? def.cost(ctx) : def.cost ?? 0;
  return Number.isFinite(raw) ? Math.max(0, Math.round(raw)) : Number.POSITIVE_INFINITY;
}

/** Death protocol: effects only mark a death, the obituary is settled here. */
function settleDeath(state: GameState, reg: ContentRegistry): void {
  if (state.phase !== 'dead' || state.death) return;
  const cause = String(state.character.flags.pendingDeathCause ?? DEFAULT_DEATH_CAUSE);
  killCharacter(state, reg, cause);
}

/**
 * Checks that the life is still running, then the age window, condition,
 * cooldown and whether the cost is affordable.
 *
 * The price is evaluated **exactly once** here and handed back as `cost`, which
 * is the number the caller must charge. `def.cost` may be a function, and a
 * priced function may draw from `ctx.rng`, so asking for the price a second
 * time would bill an amount this gate never validated — and burn a second draw.
 * `cost` is absent when an earlier gate refused before the price was ever
 * needed, and on the refusal of a price too unreadable to quote: nothing runs in
 * either case, so nothing is charged. `runInteraction` must charge `gate.cost`
 * rather than re-pricing the def.
 *
 * Draw budget: **asking is always free.** Both `condition` and `cost` may draw,
 * so the cursor is rewound before *every* return, refusal and approval alike —
 * this is a read, and a read must never re-roll the future events, illnesses,
 * promotions and death checks that hang off the same cursor. It is the sheet
 * that makes that matter: `availableInteractions` documents a `canUse` per row
 * before enabling it, on rows the player never runs, and the budget used to
 * depend on the answer — a blocked row was free to re-price as often as it
 * repainted while an *affordable* one silently advanced the life on every
 * repaint. Whether looking at a row cost a character their future came down to
 * whether they happened to be able to afford it.
 *
 * The draws a passing gate spent are not thrown away, they are handed back as
 * `rngState`: the cursor as it stood after `condition` and `cost` ran. Exactly
 * one caller is entitled to spend it — `runInteraction`, which is about to
 * charge the player the price those draws priced — and it adopts it the moment
 * the gate passes. That keeps `def.cost` evaluated exactly once per use, with no
 * re-pricing and no second draw. It is absent when the gate spent nothing (an
 * unpriced row, or a `ctx.rng` built on a detached cursor), because then there
 * is nothing to adopt.
 *
 * Only the cursor is rewound. A `condition` or `cost` that mutates anything else
 * is a content bug — they are asked a question, not told to act.
 */
export function canUse(
  ctx: Ctx,
  def: InteractionDef
): { ok: boolean; reason?: string; cost?: number; rngState?: number } {
  const c = ctx.state.character;
  const age = c.age;

  // Snapshotted before any gate can draw; restored by every return below.
  const cursor = ctx.state.rngState;
  type Refusal = { ok: boolean; reason: string; cost?: number };
  const refuse = (reason: string, cost?: number): Refusal => {
    ctx.state.rngState = cursor;
    return cost === undefined ? { ok: false, reason } : { ok: false, reason, cost };
  };

  // A finished life is read-only: no action may touch it or its epitaph stats.
  if (ctx.state.phase === 'dead') return refuse(LIFE_OVER);

  if (age < (def.minAge ?? 0)) return refuse("You're too young.");
  if (age > (def.maxAge ?? DEFAULT_MAX_AGE)) return refuse("You're too old.");
  if (def.condition && !def.condition(ctx)) {
    return refuse("You can't do that right now.");
  }

  // `interactionUse` stores the AGE of the last use, not a year or a timestamp.
  const cooldown = def.cooldownYears ?? 0;
  const lastUsedAge = ctx.state.interactionUse[def.id];
  if (cooldown > 0 && typeof lastUsedAge === 'number' && age - lastUsedAge < cooldown) {
    return refuse('Too soon.');
  }

  const cost = costOf(ctx, def);
  /* Refused before the balance is even consulted, and quoted to nobody: an
     unreadable price is no quote, and `fmtMoney` renders one as "$0" — the free
     row this refusal exists to prevent, printed on the row that refused it. */
  if (!Number.isFinite(cost)) return refuse("You can't afford it.");
  if (c.money < cost) return refuse("You can't afford it.", cost);

  // Rewound like every other exit; the spent cursor goes back as data instead.
  const spent = ctx.state.rngState;
  ctx.state.rngState = cursor;
  return spent === cursor ? { ok: true, cost } : { ok: true, cost, rngState: spent };
}

/**
 * Interactions in `area` that are age-appropriate and pass their `condition`.
 *
 * Rows that fail only on cost or cooldown are deliberately kept so the sheet can
 * render them greyed out with the reason from `canUse` — call `canUse` per row
 * before enabling it, since this list is wider than what `runInteraction` allows.
 * That is free however often the sheet repaints and whatever the answer is:
 * `canUse` rewinds the cursor before it returns, for a row that passes as well
 * as one that is blocked.
 */
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
 * Runs one interaction: resolves `targetId` into `ctx.target`, charges the price
 * `canUse` validated, applies the resolved effects, records the cooldown in
 * `interactionUse` and appends the entries to the current year log. Returns null
 * when unavailable.
 *
 * A refusal costs the player nothing at all: no money, no cooldown stamp, no log
 * line — and no draw, since `canUse` rewinds the cursor whatever it answers.
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
  /* `personById`, never `state.people[targetId]`: the id is whatever a UI row
     carried (and on a load, whatever JSON held), so `__proto__` or `constructor`
     would otherwise resolve to an inherited member. That object is truthy, and a
     `{who:'target'}` effect cannot recover — it looks the canonical person up by
     `target.id`, which such an object does not have, and falls back to the
     polluting object itself. An id nobody owns is simply no target. */
  const target: Person | undefined =
    targetId !== undefined ? personById(state.people, targetId) : undefined;
  const ctx: Ctx = { state, c, rng, reg, target };

  const gate = canUse(ctx, def);
  if (!gate.ok) {
    return { text: gate.reason ?? "You can't do that.", icon: BLOCKED_ICON, entries: [] };
  }
  /* The gate is a pure read for every other caller, so it left the cursor where
     it found it. This is the one caller entitled to what `condition` and `cost`
     spent — it is about to charge the player the price those draws priced — so
     it adopts the cursor they left rather than re-running either. */
  if (gate.rngState !== undefined) state.rngState = gate.rngState;

  /* Charge the price the gate validated — never re-run `def.cost`. A priced
     function holds the live cursor, so a second call would roll a different
     number: the player would be billed an amount no affordability check ever
     saw (and the clamp below would quietly empty the wallet to $0 when that
     number came in over the balance), on top of spending a second draw. */
  const cost = gate.cost ?? 0;
  if (cost > 0) c.money = clampMoney(c.money - cost, c.money);

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
  if (state.phase === 'dead') return { text: LIFE_OVER, icon: BLOCKED_ICON, entries: [] };
  if (c.prison) return { text: "You're already in prison.", icon: BLOCKED_ICON, entries: [] };
  // Guard before the roll, like `canUse`: a refused crime must not spend a draw.
  if (c.age < def.minAge) {
    return { text: "You're too young for that.", icon: BLOCKED_ICON, entries: [] };
  }

  const rng = createRng(state);
  const ctx: Ctx = { state, c, rng, reg };

  if (rng.chance(def.successChance(ctx))) {
    /* `rng.int` hands back NaN for a NaN bound (the draw is spent either way, so
       the sequence is unaffected), and a NaN payout used to be written straight
       into the balance, where nothing could ever remove it. An unreadable score
       is worth nothing rather than everything. */
    const rolled = rng.int(def.payout[0], def.payout[1]);
    const payout = Number.isFinite(rolled) ? rolled : 0;
    c.money = clampMoney(c.money + payout, c.money);
    const text = `You got away with ${def.label}. +${fmtMoney(payout)}`;
    const entries: LogEntry[] = [{ icon: def.icon, kind: 'legal', text }];
    currentYearLog(state).entries.push(...entries);
    return { text, icon: def.icon, entries };
  }

  /* Guarded like the payout above, and against a worse outcome: `rng.int` hands
     back NaN for a NaN bound and Infinity for an infinite one (the draw is
     spent either way, so the sequence is unaffected), and `careerPhase` serves
     a sentence by subtracting a year until `yearsLeft <= 0` — a bound neither
     one ever reaches. An unreadable term is no term: a conviction with no time
     to serve, rather than a cell with no exit. */
  const rolled = rng.int(def.sentenceYears[0], def.sentenceYears[1]);
  const sentence = Number.isFinite(rolled) ? rolled : 0;
  const convictions = Number(c.flags.convictions ?? 0);
  const priors = Number.isFinite(convictions) && convictions > 0 ? convictions : 0;
  const years = priors > 0 ? Math.round(sentence * REPEAT_OFFENDER_MULT) : sentence;

  const text = `GUILTY. ${def.label}.`;
  /* The headline lands before the line `applyEffects` writes for the term. That
     line is a cell only when there is time to serve — a term of no years is a
     conviction, not a jailing, which is half of every conviction on a crime
     whose `sentenceYears` start at 0 — and that rule stays at the one place a
     `PrisonState` is built rather than being restated here. */
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
