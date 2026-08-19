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

/**
 * Hard ceiling on a prison sentence, in years.
 *
 * Not a design rule: `deathCheck` forces death at 110, so this never shortens a
 * sentence anyone could live to serve. It exists because `careerPhase` releases
 * a prisoner by `yearsLeft -= 1` reaching 0, and above 2^53 that subtraction
 * stops changing the number — an absurd but finite sentence would be exactly as
 * unescapable as `Infinity`.
 */
const MAX_SENTENCE_YEARS = 200;

/** Clamps a stat into 0..100 and rounds it to one decimal place. */
export function clampStat(n: number): number {
  if (Number.isNaN(n)) return 0;
  const bounded = n < 0 ? 0 : n > 100 ? 100 : n;
  return Math.round(bounded * 10) / 10;
}

/**
 * Whole, non-negative dollars — **the only supported way to write money.**
 *
 * The money counterpart of `clampStat`, and hardened for the same reason. Every
 * balance used to be written as `Math.max(0, Math.round(x))`, and
 * `Math.max(0, NaN)` is NaN: one `{kind:'money', delta:NaN}` in a pack, one
 * `payout:[NaN,NaN]` on a crime, one `price:NaN` on an asset, and the balance
 * was NaN with no way back — every later write is `NaN + delta`, and the poison
 * spreads to `Loan.principal`, `netWorth`, the finance sheet and the epitaph.
 * A stat recovered from the same typo (`clampStat(NaN)` is 0) and money never
 * did.
 *
 * So a non-finite amount is refused rather than stored: `keep` is the balance
 * the write was going to overwrite, which is left exactly as it was — an
 * unreadable number buys nothing, but it must not destroy what is already
 * there. A `keep` that is itself unreadable (a save that came back poisoned)
 * settles at 0, so the balance always heals on the next write.
 */
export function clampMoney(n: number, keep = 0): number {
  if (Number.isFinite(n)) return Math.max(0, Math.round(n));
  return Number.isFinite(keep) ? Math.max(0, Math.round(keep)) : 0;
}

/**
 * Own-property lookup into `state.people` — **the only supported way to read
 * that table by an id a caller supplied.**
 *
 * Ids reach the engine as plain strings: `Effect.who` from content, `targetId`
 * from a UI row, `childId` from a legacy pick, and all three again out of
 * `JSON.parse` on a load. So an ordinary authoring typo — `__proto__`,
 * `toString`, `constructor` — arrives as an id. A plain `people[id]` answers
 * those with an inherited member: `'__proto__'` hands back `Object.prototype`
 * itself, which is truthy, so `person.rel = clampStat(NaN)` writes `rel = 0`
 * onto every object in the process. Unlike the registry's indexes this cannot
 * be fixed with a null prototype at construction, because `state.people` comes
 * back from `JSON.parse` with `Object.prototype` on every load; the guard
 * belongs at the read instead — which is why it is exported rather than
 * re-implemented at each call site (`interactions.runInteraction`,
 * `death.startLegacy`).
 *
 * Own properties still win: a person genuinely stored under `toString` is
 * found, because only the *absence* of a person may not be filled in by the
 * prototype chain.
 */
export function personById(people: Record<string, Person>, id: string): Person | undefined {
  return Object.prototype.hasOwnProperty.call(people, id) ? people[id] : undefined;
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
    return personById(people, target.id) ?? target;
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
  return personById(people, who);
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
        // `clampMoney`, never `Math.max(0, ...)`: a NaN delta must be ignored,
        // not written. See the guard's own comment.
        c.money = clampMoney(c.money + effect.delta, c.money);
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
        /* The one number in this switch no clamp helper covers, so it carries
           `clampMoney`'s policy itself: `Math.max(0, NaN)` is NaN, and a NaN or
           Infinity `yearsLeft` never satisfies `careerPhase`'s `<= 0` release
           test, so an unreadable sentence written verbatim would outlast the
           life. It buys no time at all instead. */
        const raw = effect.years;
        const years = Number.isFinite(raw)
          ? Math.min(MAX_SENTENCE_YEARS, Math.max(0, Math.round(raw)))
          : 0;
        if (years <= 0) {
          /* A sentence of no time is a conviction, not a cell — and a routine
             one, since a crime's `sentenceYears` range may start at 0. Building
             a `PrisonState` for it would cost the job for time never served,
             lock every non-prison sheet for the year, and then pay out
             `careerPhase`'s release relief on the very next age-up. */
          entries.push({
            icon: '⚖️',
            text: `You were convicted of ${effect.crime}, but served no time.`,
            kind: 'legal',
          });
          break;
        }
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
