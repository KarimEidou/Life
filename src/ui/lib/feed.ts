/**
 * Small helpers the screens and sheets share: feed colours, stat colours and
 * draw-free availability checks.
 */

import { canUse } from '@/engine/interactions';
import { createRng } from '@/engine/rng';
import type {
  ContentRegistry,
  Ctx,
  GameState,
  InteractionDef,
  LogKind,
  Person,
} from '@/types';

/** Feed row colour per log kind. */
export const LOG_KIND_COLOR: Record<LogKind, string> = {
  info: 'var(--label)',
  good: 'var(--c-green)',
  bad: 'var(--c-red)',
  choice: 'var(--c-purple)',
  money: 'var(--c-green)',
  health: 'var(--c-orange)',
  death: 'var(--c-red)',
  achievement: 'var(--c-yellow)',
  legal: 'var(--c-orange)',
};

/** Meter colour for a 0..100 stat. */
export function statColor(value: number): string {
  if (value >= 70) {
    return 'var(--stat-high)';
  }
  if (value >= 35) {
    return 'var(--stat-mid)';
  }
  return 'var(--stat-low)';
}

/** Availability of one interaction, read on a detached RNG cursor so listing
    never advances the run. */
export function gateFor(
  game: GameState,
  reg: ContentRegistry,
  def: InteractionDef,
  target?: Person,
): { ok: boolean; reason?: string; cost?: number } {
  const ctx: Ctx = {
    state: game,
    c: game.character,
    rng: createRng({ rngState: game.rngState }),
    reg,
    target,
  };
  return canUse(ctx, def);
}

/** The living children a legacy can continue as. */
export function aliveChildren(game: GameState): Person[] {
  return Object.values(game.people).filter((p) => p.alive && p.kind === 'child');
}
