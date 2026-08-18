/**
 * The content manifest: every pack in the game, plus the cached registry built
 * from them. This file is final — packs change, this list does not.
 */

import { buildRegistry } from '@/engine/registry';
import type { ContentPack, ContentRegistry } from '@/types';

import { achievementsPack } from './achievements';
import { activitiesPack } from './activities';
import { assetsPack } from './assets';
import { countriesPack } from './countries';
import { crimePack } from './crime';
import { educationPack } from './education';
import { emigrationPack } from './emigration';
import { eventsAdultPack } from './events-adult';
import { eventsChildPack } from './events-child';
import { eventsSeniorPack } from './events-senior';
import { eventsTeenPack } from './events-teen';
import { famePack } from './fame';
import { financePack } from './finance';
import { gamblingPack } from './gambling';
import { healthPack } from './health';
import { jobsOrdinaryPack } from './jobs-ordinary';
import { jobsProfessionalPack } from './jobs-professional';
import { namesPack } from './names';
import { relationshipsPack } from './relationships';

/** Registration order: later packs may reference ids declared by earlier ones. */
export const allPacks: ContentPack[] = [
  countriesPack,
  namesPack,
  educationPack,
  achievementsPack,
  jobsOrdinaryPack,
  jobsProfessionalPack,
  eventsChildPack,
  eventsTeenPack,
  eventsAdultPack,
  eventsSeniorPack,
  healthPack,
  relationshipsPack,
  activitiesPack,
  assetsPack,
  financePack,
  gamblingPack,
  crimePack,
  famePack,
  emigrationPack,
];

let cached: ContentRegistry | null = null;

/** The one registry the whole app reads; built on first call and reused after. */
export function getRegistry(): ContentRegistry {
  if (cached === null) {
    cached = buildRegistry(allPacks);
  }
  return cached;
}

/** Drops the cached registry so a test can rebuild it. */
export function resetRegistryForTests(): void {
  cached = null;
}
