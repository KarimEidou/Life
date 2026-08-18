/**
 * Aging phase: advances age and year, then applies the natural stat drift that
 * comes with the character's new life stage.
 */

import { clampStat } from '@/engine/effects';
import { stageForAge } from '@/types';
import type { Ctx, LogEntry, Stage } from '@/types';

/** Announced on the birthday that crosses into a new stage; `infant` is never entered. */
const STAGE_LINES: Partial<Record<Stage, LogEntry>> = {
  toddler: { icon: '🧸', kind: 'info', text: "You're a toddler now." },
  child: { icon: '🧒', kind: 'info', text: "You're a child now." },
  teen: { icon: '🎒', kind: 'info', text: "You're a teenager now." },
  adult: { icon: '🧑', kind: 'info', text: "You're an adult now." },
  senior: { icon: '👴', kind: 'info', text: "You're a senior now." },
};

/** Ages the character one year and applies stage-driven stat drift. */
export function agingPhase(ctx: Ctx): LogEntry[] {
  const { state, c } = ctx;

  const before = stageForAge(c.age);
  c.age += 1;
  state.year += 1;
  // This phase opens the year every other phase logs into.
  state.log.push({ age: c.age, year: state.year, entries: [] });
  const after = stageForAge(c.age);

  const entries: LogEntry[] = [];
  if (after !== before) {
    const line = STAGE_LINES[after];
    if (line) entries.push({ ...line });
  }

  const age = c.age;
  const stats = c.stats;
  const flags = c.flags;

  // Bands are tiers, not cumulative: the oldest matching band wins.
  const looksDrift = age > 55 ? -1 : age > 30 ? -0.5 : 0;
  if (looksDrift !== 0) stats.looks = clampStat(stats.looks + looksDrift);

  let healthDrift = age > 60 ? -1 : age > 30 ? -0.3 : 0;
  if (flags.gymRegular) healthDrift += 0.5;
  if (flags.goodDiet) healthDrift += 0.5;
  if (healthDrift !== 0) stats.health = clampStat(stats.health + healthDrift);

  // Mood regresses a tenth of the way back to the 60 baseline every year.
  stats.happiness = clampStat(stats.happiness + (60 - stats.happiness) * 0.1);

  let smartsDrift = c.education.enrolledIn ? 0.5 : 0;
  if (age > 70) smartsDrift -= 0.3;
  if (smartsDrift !== 0) stats.smarts = clampStat(stats.smarts + smartsDrift);

  return entries;
}
