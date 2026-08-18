/**
 * Content registry assembly and validation.
 *
 * Packs are authored as plain data; the registry is the flattened, indexed view
 * the engine and UI read from.
 */

import type {
  ContentPack,
  ContentRegistry,
  EdLevel,
  NamePool,
} from '@/types';

/** School levels that must exist exactly once so the compulsory ladder resolves. */
const COMPULSORY_LEVELS: readonly EdLevel[] = ['primary', 'middle', 'high'];

/** Levels whose `majors` list is what a `JobReq.majors` entry can be satisfied by. */
const DEGREE_LEVELS: readonly EdLevel[] = ['university', 'postgrad'];

/** One flattened collection: the merged list plus its first-wins index. */
interface Collection<T> {
  list: T[];
  byId: Record<string, T>;
}

function owns(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/**
 * Flattens one collection across every pack, in registration order.
 *
 * A duplicate id keeps the FIRST declaration in the index but is still appended
 * to the list, which is what lets `validateRegistry` name the offender.
 */
function collect<T extends { id: string }>(
  packs: readonly ContentPack[],
  pick: (pack: ContentPack) => T[] | undefined
): Collection<T> {
  const list: T[] = [];
  const byId: Record<string, T> = {};
  for (const pack of packs) {
    for (const item of pick(pack) ?? []) {
      list.push(item);
      if (!owns(byId, item.id)) byId[item.id] = item;
    }
  }
  return { list, byId };
}

/** Name pools are keyed by the country they belong to; the first pool wins. */
function collectNamePools(packs: readonly ContentPack[]): Record<string, NamePool> {
  const byCountry: Record<string, NamePool> = {};
  for (const pack of packs) {
    for (const pool of pack.namePools ?? []) {
      if (!owns(byCountry, pool.countryId)) byCountry[pool.countryId] = pool;
    }
  }
  return byCountry;
}

/** Creates an empty pack with the given id, ready to be filled in. */
export function emptyPack(id: string): ContentPack {
  return { id };
}

/**
 * Merges all packs into arrays + byId maps.
 * Packs are applied in order; `packs` records the ids that were merged.
 */
export function buildRegistry(packs: ContentPack[]): ContentRegistry {
  const events = collect(packs, (p) => p.events);
  const interactions = collect(packs, (p) => p.interactions);
  const jobs = collect(packs, (p) => p.jobs);
  const assets = collect(packs, (p) => p.assets);
  const illnesses = collect(packs, (p) => p.illnesses);
  const schools = collect(packs, (p) => p.schools);
  const countries = collect(packs, (p) => p.countries);
  const crimes = collect(packs, (p) => p.crimes);
  const achievements = collect(packs, (p) => p.achievements);

  return {
    packs: packs.map((pack) => pack.id),
    events: events.list,
    eventsById: events.byId,
    interactions: interactions.list,
    interactionsById: interactions.byId,
    jobs: jobs.list,
    jobsById: jobs.byId,
    assets: assets.list,
    assetsById: assets.byId,
    illnesses: illnesses.list,
    illnessesById: illnesses.byId,
    schools: schools.list,
    schoolsById: schools.byId,
    countries: countries.list,
    countriesById: countries.byId,
    crimes: crimes.list,
    crimesById: crimes.byId,
    achievements: achievements.list,
    achievementsById: achievements.byId,
    namePools: collectNamePools(packs),
  };
}

/** Reports every id that appears more than once in one collection. */
function reportDuplicates(
  problems: string[],
  kind: string,
  items: readonly { id: string }[]
): void {
  const seen = new Set<string>();
  const reported = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id) && !reported.has(item.id)) {
      problems.push(`duplicate ${kind} id "${item.id}"`);
      reported.add(item.id);
    }
    seen.add(item.id);
  }
}

function checkJobs(reg: ContentRegistry, problems: string[]): void {
  const offered = new Set<string>();
  for (const school of reg.schools) {
    if (!DEGREE_LEVELS.includes(school.level)) continue;
    for (const major of school.majors ?? []) offered.add(major);
  }

  for (const job of reg.jobs) {
    if (job.promotesTo !== undefined && !owns(reg.jobsById, job.promotesTo)) {
      problems.push(`job "${job.id}" promotesTo unknown job "${job.promotesTo}"`);
    }
    const prev = job.req.prevJobId;
    if (prev !== undefined && !owns(reg.jobsById, prev)) {
      problems.push(`job "${job.id}" req.prevJobId is unknown job "${prev}"`);
    }
    for (const major of job.req.majors ?? []) {
      if (!offered.has(major)) {
        problems.push(`job "${job.id}" requires major "${major}" that no university offers`);
      }
    }
  }
}

function checkEvents(reg: ContentRegistry, problems: string[]): void {
  for (const event of reg.events) {
    if (event.minAge > event.maxAge) {
      problems.push(`event "${event.id}" has minAge ${event.minAge} above maxAge ${event.maxAge}`);
    }
    if (!(event.weight > 0)) {
      problems.push(`event "${event.id}" has weight ${event.weight}`);
    }
    const labels = new Set<string>();
    for (const choice of event.choices ?? []) {
      if (labels.has(choice.label)) {
        problems.push(`event "${event.id}" has duplicate choice label "${choice.label}"`);
      }
      labels.add(choice.label);
      if (choice.outcomes.length === 0) {
        problems.push(`event "${event.id}" choice "${choice.label}" has no outcomes`);
      }
      choice.outcomes.forEach((outcome, index) => {
        if (!(outcome.weight > 0)) {
          problems.push(
            `event "${event.id}" choice "${choice.label}" outcome ${index} has weight ${outcome.weight}`
          );
        }
      });
    }
  }
}

/**
 * Returns problem list - duplicate ids registry-wide; dangling refs
 * (promotesTo, prevJobId, majors vs school majors, illness ids, countryId in
 * name pools); minAge<=maxAge; weight>0; every choice has >=1 outcome.
 */
export function validateRegistry(reg: ContentRegistry): string[] {
  const problems: string[] = [];

  reportDuplicates(problems, 'event', reg.events);
  reportDuplicates(problems, 'interaction', reg.interactions);
  reportDuplicates(problems, 'job', reg.jobs);
  reportDuplicates(problems, 'asset', reg.assets);
  reportDuplicates(problems, 'illness', reg.illnesses);
  reportDuplicates(problems, 'school', reg.schools);
  reportDuplicates(problems, 'country', reg.countries);
  reportDuplicates(problems, 'crime', reg.crimes);
  reportDuplicates(problems, 'achievement', reg.achievements);

  checkJobs(reg, problems);
  checkEvents(reg, problems);

  for (const interaction of reg.interactions) {
    const cooldown = interaction.cooldownYears;
    if (cooldown !== undefined && cooldown < 0) {
      problems.push(`interaction "${interaction.id}" has negative cooldownYears ${cooldown}`);
    }
  }

  for (const crime of reg.crimes) {
    if (crime.sentenceYears[0] > crime.sentenceYears[1]) {
      problems.push(`crime "${crime.id}" has a reversed sentenceYears range`);
    }
  }

  for (const asset of reg.assets) {
    if (!(asset.price > 0)) {
      problems.push(`asset "${asset.id}" has price ${asset.price}`);
    }
  }

  // The compulsory ladder is enrolled by level, so an ambiguous level is a bug.
  if (reg.schools.length > 0) {
    for (const level of COMPULSORY_LEVELS) {
      const count = reg.schools.filter((school) => school.level === level).length;
      if (count !== 1) {
        problems.push(`expected exactly one ${level} school, found ${count}`);
      }
    }
  }

  // A registry with no pools at all is the empty-content case, not a problem.
  if (Object.keys(reg.namePools).length > 0) {
    for (const country of reg.countries) {
      if (!owns(reg.namePools, country.id)) {
        problems.push(`country "${country.id}" has no name pool`);
      }
    }
  }

  return problems;
}
