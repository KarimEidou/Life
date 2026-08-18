/**
 * Game state construction and whole-life mutations that no phase owns.
 */

import type { ContentRegistry, GameState, Gender, Pronouns } from '@/types';

/** Everything the character generator needs; unset fields are rolled from the seed. */
export interface CreateLifeOptions {
  seed: number;
  firstName?: string;
  lastName?: string;
  gender?: Gender;
  countryId?: string;
  startYear?: number;
}

/** Builds a newborn plus a generated family: mother, father and 0-3 siblings. */
export function createLife(reg: ContentRegistry, opts: CreateLifeOptions): GameState {
  throw new Error('TODO:state.createLife');
}

/** Subject/object/possessive forms for a gender, used by narrative templating. */
export function pronounsFor(gender: Gender): Pronouns {
  throw new Error('TODO:state.pronounsFor');
}

/** Attempts to move the character to another country, rolling against its visa difficulty. */
export function emigrateTo(
  state: GameState,
  reg: ContentRegistry,
  countryId: string
): { ok: boolean; reason?: string; text?: string } {
  throw new Error('TODO:state.emigrateTo');
}
