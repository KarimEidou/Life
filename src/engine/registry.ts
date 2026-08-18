/**
 * Content registry assembly and validation.
 *
 * Packs are authored as plain data; the registry is the flattened, indexed view
 * the engine and UI read from.
 */

import type { ContentPack, ContentRegistry } from '@/types';

/** Creates an empty pack with the given id, ready to be filled in. */
export function emptyPack(id: string): ContentPack {
  return { id };
}

/**
 * Merges all packs into arrays + byId maps.
 * Packs are applied in order; `packs` records the ids that were merged.
 */
export function buildRegistry(packs: ContentPack[]): ContentRegistry {
  throw new Error('TODO:registry.buildRegistry');
}

/**
 * Returns problem list - duplicate ids registry-wide; dangling refs
 * (promotesTo, prevJobId, majors vs school majors, illness ids, countryId in
 * name pools); minAge<=maxAge; weight>0; every choice has >=1 outcome.
 */
export function validateRegistry(reg: ContentRegistry): string[] {
  throw new Error('TODO:registry.validateRegistry');
}
