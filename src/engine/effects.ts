/**
 * The single write path from content data into game state.
 *
 * Content declares `Effect`s; only this module knows how each kind mutates the
 * world, so clamping and log side effects stay in one place.
 */

import type { Effect, EffectCtx, LogEntry, Person, RelKind } from '@/types';
import { fillTemplate } from '@/engine/format';

/** Kinds `{kind:'rel', who:'random-family'}` may land on. */
const FAMILY_KINDS: readonly RelKind[] = ['mother', 'father', 'sibling', 'child'];

/** Clamps a stat into 0..100 and rounds it to one decimal place. */
export function clampStat(n: number): number {
  if (Number.isNaN(n)) return 0;
  const bounded = n < 0 ? 0 : n > 100 ? 100 : n;
  return Math.round(bounded * 10) / 10;
}

/**
 * Resolves the `who` field of a `rel` effect.
 * Returns undefined when the sentinel matches nobody, in which case the effect
 * is silently skipped.
 */
function resolvePerson(ctx: EffectCtx, who: string): Person | undefined {
  const people = ctx.state.people;
  if (who === 'target') {
    const target = ctx.target;
    if (!target) return undefined;
    // Prefer the canonical object so the mutation lands in `state.people`.
    return people[target.id] ?? target;
  }
  if (who === 'partner') {
    const list = Object.values(people);
    return (
      list.find((p) => p.alive && p.kind === 'spouse') ??
      list.find((p) => p.alive && p.kind === 'partner')
    );
  }
  if (who === 'random-family') {
    const family = Object.values(people).filter(
      (p) => p.alive && FAMILY_KINDS.includes(p.kind)
    );
    // Guard before picking: an empty pool must not consume a draw.
    return family.length > 0 ? ctx.rng.pick(family) : undefined;
  }
  return people[who];
}

/**
 * Applies every effect in order and returns the log entries they produced.
 *
 * The entries are returned, never appended to `state.log`: phase functions hand
 * them back to `ageUp` and everyone else appends them via `currentYearLog`.
 * A `{kind:'death'}` effect sets `phase`/`flags.pendingDeathCause` and stops the
 * list — the obituary entry belongs to `killCharacter`, not here.
 */
export function applyEffects(ctx: EffectCtx, effects: Effect[]): LogEntry[] {
  const entries: LogEntry[] = [];
  const state = ctx.state;
  const c = state.character;

  for (const effect of effects) {
    switch (effect.kind) {
      case 'stat': {
        c.stats[effect.stat] = clampStat(c.stats[effect.stat] + effect.delta);
        break;
      }
      case 'money': {
        c.money = Math.max(0, Math.round(c.money + effect.delta));
        break;
      }
      case 'rel': {
        const person = resolvePerson(ctx, effect.who);
        if (person) person.rel = clampStat(person.rel + effect.delta);
        break;
      }
      case 'flag': {
        c.flags[effect.flag] = effect.value;
        break;
      }
      case 'addiction': {
        const severity = clampStat((c.addictions[effect.which] ?? 0) + effect.delta);
        if (severity <= 0) delete c.addictions[effect.which];
        else c.addictions[effect.which] = severity;
        break;
      }
      case 'illness': {
        const add = effect.add;
        if (add !== undefined && !c.illnesses.some((i) => i.defId === add)) {
          c.illnesses.push({ defId: add, years: 0, treated: false });
        }
        const cure = effect.cure;
        if (cure !== undefined) {
          c.illnesses = c.illnesses.filter((i) => i.defId !== cure);
        }
        break;
      }
      case 'fame': {
        c.fame = clampStat(c.fame + effect.delta);
        break;
      }
      case 'jail': {
        const years = Math.max(0, Math.round(effect.years));
        c.prison = { crime: effect.crime, yearsLeft: years, totalYears: years };
        /* The fifth job-ending path (career.ts owns the other four): remember the
           title before the sentence clears it, or the obituary reads "Unemployed". */
        if (c.job) c.flags.lastJobTitle = c.job.title;
        c.job = null;
        entries.push({
          icon: '⚖️',
          text: `You were sentenced to ${years} year${years === 1 ? '' : 's'} in prison.`,
          kind: 'legal',
        });
        break;
      }
      case 'death': {
        state.phase = 'dead';
        c.flags.pendingDeathCause = effect.cause;
        return entries;
      }
      case 'log': {
        entries.push({
          icon: effect.icon,
          text: fillTemplate(effect.text, state),
          kind: effect.logKind ?? 'info',
        });
        break;
      }
      case 'fn': {
        effect.run(ctx);
        break;
      }
    }
  }

  return entries;
}
