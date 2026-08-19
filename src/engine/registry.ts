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
  Effect,
  EventChoiceOutcome,
  EventDef,
  NamePool,
} from '@/types';

/** School levels that must exist exactly once so the compulsory ladder resolves. */
const COMPULSORY_LEVELS: readonly EdLevel[] = ['primary', 'middle', 'high'];

/** One flattened collection: the merged list plus its first-wins index. */
interface Collection<T> {
  list: T[];
  byId: Record<string, T>;
}

function owns(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/**
 * An id map that inherits nothing.
 *
 * Every index the registry hands out is read through a widened lookup —
 * `findJob`, `findSchool`, `findIllness`, `findCountry`, `findAsset`,
 * `findEvent`, `findInteraction`, `findCrime` all do `byId[id]` against a
 * `Record<string, T | undefined>` — and a plain object literal answers
 * `toString`, `constructor`, `valueOf`, `hasOwnProperty` and `__proto__` with an
 * inherited member instead of `undefined`. That truthy answer defeats every
 * missing-def guard downstream: a `jobId` of `toString` reaches
 * `job.salary * (1 + def.raisePct)` and turns the whole balance sheet into NaN,
 * an `enrolledIn` of `valueOf` never trips the education self-heal, and a
 * `countryId` of `constructor` builds a character with no country at all. A
 * content id is data, so the table it is looked up in must hold data only.
 * `fillTemplate` is hardened the same way for the same reason.
 */
function idMap<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
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
  const byId: Record<string, T> = idMap<T>();
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
  const byCountry: Record<string, NamePool> = idMap<NamePool>();
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

/**
 * Names a content number that is not a readable amount.
 *
 * `Math.max(0, NaN)` is NaN, and until the money writes were hardened one such
 * number anywhere in a pack — a salary, a multiplier, a tuition, a payout —
 * turned `character.money` into NaN with no way back, taking `Loan.principal`,
 * `netWorth`, the finance sheet and the epitaph with it. The engine now refuses
 * to store them; this is where the pack that authored them gets told. Infinity
 * is named for the same reason a weight of Infinity is: it passes every `> 0`
 * test and then produces nonsense.
 *
 * `floor` is the smallest value that makes sense for the field (0 for anything
 * priced, `-Infinity` for a rate that may legitimately be negative, such as a
 * depreciating asset's appreciation or a pay cut).
 */
function checkNumber(
  problems: string[],
  subject: string,
  field: string,
  value: number,
  floor = 0
): void {
  if (!(Number.isFinite(value) && value >= floor)) {
    problems.push(`${subject} has ${field} ${value}`);
  }
}

function checkJobs(reg: ContentRegistry, problems: string[]): void {
  /* Universities only. `SchoolDef.majors` is overloaded by level: on a postgrad
     programme it lists the undergrad majors that programme *accepts*, which
     `applyToSchool` matches against the degree already held. `education.major` is
     written in one place — that same function's university branch — so a major
     only a postgrad names can never be held, and counting it here let a job
     requiring it validate clean while every application, at every age, for the
     whole life, answers 'Your major does not qualify.' */
  const offered = new Set<string>();
  for (const school of reg.schools) {
    if (school.level !== 'university') continue;
    for (const major of school.majors ?? []) offered.add(major);
  }

  for (const job of reg.jobs) {
    checkNumber(problems, `job "${job.id}"`, 'baseSalary', job.baseSalary);
    // A pay cut is a legitimate raise; an unreadable one is not.
    checkNumber(problems, `job "${job.id}"`, 'raisePct', job.raisePct, Number.NEGATIVE_INFINITY);
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

/**
 * Reports any illness id an event names that no `IllnessDef` defines.
 *
 * A dangling `add` is not cosmetic: `applyEffects` pushes the row onto
 * `Character.illnesses` regardless, then `healthPhase` fails to find a def and
 * skips it, so it never ages, never rolls recovery, is invisible to
 * `deathCheckPhase` and sits on the sheet for the rest of the life. Events are
 * the only place effect lists can be read statically — an `InteractionDef`
 * builds its own in `resolve` — so this is as far as the lint reaches.
 */
function checkIllnessRefs(
  reg: ContentRegistry,
  event: EventDef,
  effects: readonly Effect[] | undefined,
  reported: Set<string>,
  problems: string[]
): void {
  for (const effect of effects ?? []) {
    if (effect.kind !== 'illness') continue;
    for (const [verb, id] of [
      ['adds', effect.add],
      ['cures', effect.cure],
    ] as const) {
      if (id === undefined || owns(reg.illnessesById, id)) continue;
      // One line per event/verb/id: three outcomes naming the same typo is one problem.
      const problem = `event "${event.id}" ${verb} unknown illness "${id}"`;
      if (reported.has(problem)) continue;
      reported.add(problem);
      problems.push(problem);
    }
  }
}

/**
 * Names a number an effect carries that is not readable: the `delta` on every
 * kind that has one, plus a jail sentence's `years`. Only finiteness is checked:
 * a negative delta is the ordinary way to spend money, lose a stat or sour a
 * relationship, and `applyEffects` floors a sentence at 0 itself. What it cannot
 * do is read an unreadable one — a NaN or Infinity `years` buys no time at all
 * there, so the sentence the pack wrote never happens and nothing says why.
 *
 * Events are the only place effect lists can be read statically — an
 * `InteractionDef` builds its own inside `resolve` — so, exactly like
 * `checkIllnessRefs`, this is as far as the lint reaches.
 */
function checkEffectNumbers(
  subject: string,
  effects: readonly Effect[] | undefined,
  problems: string[]
): void {
  for (const effect of effects ?? []) {
    switch (effect.kind) {
      case 'money':
      case 'stat':
      case 'rel':
      case 'fame':
      case 'addiction':
        if (!Number.isFinite(effect.delta)) {
          problems.push(`${subject} has a ${effect.kind} delta of ${effect.delta}`);
        }
        break;
      case 'jail':
        if (!Number.isFinite(effect.years)) {
          problems.push(`${subject} has a jail sentence of ${effect.years} years`);
        }
        break;
      default:
        break;
    }
  }
}

function checkEvents(reg: ContentRegistry, problems: string[]): void {
  const reportedIllnesses = new Set<string>();
  for (const event of reg.events) {
    if (event.minAge > event.maxAge) {
      problems.push(`event "${event.id}" has minAge ${event.minAge} above maxAge ${event.maxAge}`);
    }
    /* Finite AND strictly positive, the same predicate `rng.weighted` applies
       and `eventsPhase.isEligible` mirrors. `Infinity > 0` is true, so a looser
       test lets an infinite weight validate clean and then throw at draw time —
       precisely the class of bug this lint exists to name before it ships. */
    if (!(Number.isFinite(event.weight) && event.weight > 0)) {
      problems.push(`event "${event.id}" has weight ${event.weight}`);
    }
    checkIllnessRefs(reg, event, event.effects, reportedIllnesses, problems);
    checkEffectNumbers(`event "${event.id}"`, event.effects, problems);
    const labels = new Set<string>();
    for (const choice of event.choices ?? []) {
      if (labels.has(choice.label)) {
        problems.push(`event "${event.id}" has duplicate choice label "${choice.label}"`);
      }
      labels.add(choice.label);
      /* Widened exactly like `ageUp`'s `canRollOutcome`: a hand-built or
         partially loaded pack can ship a choice with no outcome list at all, and
         this lint exists to name that pack's problems, not to die on them. It is
         the same problem an empty list has, so it gets the same line. */
      const outcomes: readonly EventChoiceOutcome[] | undefined = choice.outcomes;
      if (!outcomes || outcomes.length === 0) {
        problems.push(`event "${event.id}" choice "${choice.label}" has no outcomes`);
        continue;
      }
      outcomes.forEach((outcome, index) => {
        /* Same predicate as the event weight above, for the same reason: an
           infinite outcome weight is what `canRollOutcome` rejects, so the card
           is dealt and then discarded with 'The moment passed...' every single
           time — a permanently dead branch this lint has to name. */
        if (!(Number.isFinite(outcome.weight) && outcome.weight > 0)) {
          problems.push(
            `event "${event.id}" choice "${choice.label}" outcome ${index} has weight ${outcome.weight}`
          );
        }
        checkIllnessRefs(reg, event, outcome.effects, reportedIllnesses, problems);
        checkEffectNumbers(
          `event "${event.id}" choice "${choice.label}" outcome ${index}`,
          outcome.effects,
          problems
        );
      });
    }
  }
}

/**
 * Returns problem list - duplicate ids registry-wide; dangling refs
 * (promotesTo, prevJobId, majors vs university majors, illness ids, countryId in
 * name pools); minAge<=maxAge; finite weight>0 (the predicate `rng.weighted`
 * itself applies, so Infinity and NaN are named too); every choice has >=1
 * outcome; and every number a pack authors that the engine spends, scales or
 * banks — salaries and raises, prices, upkeep and appreciation, country
 * multipliers, illness odds and costs, tuition and programme length, crime
 * payouts and sentences, interaction cooldowns, and the numbers on every
 * statically readable event effect (each delta, and a jail sentence's years) —
 * is a readable amount rather than NaN, Infinity or a negative where only a
 * positive makes sense.
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
    /* Through `checkNumber` like every other authored number, because a bare
       `< 0` is false for NaN and for Infinity and both are worse than a negative
       one: `canUse` gates on `cooldown > 0`, so NaN skips the gate entirely and
       the row becomes unlimited-use within a single year, while Infinity keeps
       `age - lastUsedAge < cooldown` true forever — 'Too soon.' for the rest of
       the life after one use. Neither is a metering any pack meant to author. */
    const cooldown = interaction.cooldownYears;
    if (cooldown !== undefined) {
      checkNumber(problems, `interaction "${interaction.id}"`, 'cooldownYears', cooldown);
    }
  }

  for (const crime of reg.crimes) {
    if (crime.sentenceYears[0] > crime.sentenceYears[1]) {
      problems.push(`crime "${crime.id}" has a reversed sentenceYears range`);
    }
    /* `rng.int` answers a non-finite bound with NaN, and that NaN used to be
       written straight into the balance. The range is linted as a range so a
       pack hears about both bounds at once. */
    if (!crime.payout.every((bound) => Number.isFinite(bound))) {
      problems.push(`crime "${crime.id}" has a non-finite payout range`);
    } else if (crime.payout[0] > crime.payout[1]) {
      problems.push(`crime "${crime.id}" has a reversed payout range`);
    }
    if (!crime.sentenceYears.every((bound) => Number.isFinite(bound))) {
      problems.push(`crime "${crime.id}" has a non-finite sentenceYears range`);
    }
  }

  for (const asset of reg.assets) {
    /* Strictly positive, so it cannot go through `checkNumber`'s `>= floor`: a
       free asset is a bug. Finite for the reason a weight is — `Infinity > 0`
       is true, so a bare `> 0` let an infinite price validate clean, and
       `buyAsset` then answers 'That is not for sale.' at every balance and
       every age while the sheet renders the row as $0. */
    if (!(Number.isFinite(asset.price) && asset.price > 0)) {
      problems.push(`asset "${asset.id}" has price ${asset.price}`);
    }
    checkNumber(problems, `asset "${asset.id}"`, 'upkeepPct', asset.upkeepPct);
    // Vehicles depreciate, so a negative rate is the point; NaN is not.
    checkNumber(
      problems,
      `asset "${asset.id}"`,
      'apprPct',
      asset.apprPct,
      Number.NEGATIVE_INFINITY
    );
  }

  for (const country of reg.countries) {
    const subject = `country "${country.id}"`;
    checkNumber(problems, subject, 'costMult', country.costMult);
    checkNumber(problems, subject, 'taxMult', country.taxMult);
    checkNumber(problems, subject, 'visaDifficulty', country.visaDifficulty);
  }

  for (const illness of reg.illnesses) {
    const subject = `illness "${illness.id}"`;
    checkNumber(problems, subject, 'lethality', illness.lethality);
    checkNumber(problems, subject, 'cureChance', illness.cureChance);
    checkNumber(problems, subject, 'healthHit', illness.healthHit);
    checkNumber(problems, subject, 'treatCost', illness.treatCost);
  }

  for (const school of reg.schools) {
    checkNumber(problems, `school "${school.id}"`, 'tuitionPerYear', school.tuitionPerYear);
    // A programme of no years is one nobody can ever be enrolled in or graduate from.
    if (!(Number.isFinite(school.years) && school.years > 0)) {
      problems.push(`school "${school.id}" has years ${school.years}`);
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

  /* The other direction, guarded the same way: a pool keyed to a country nobody
     declared is dead weight `createLife` can never reach, but a pool authored
     before its country pack exists is early, not wrong. */
  if (reg.countries.length > 0) {
    for (const countryId of Object.keys(reg.namePools)) {
      if (!owns(reg.countriesById, countryId)) {
        problems.push(`name pool for unknown country "${countryId}"`);
      }
    }
  }

  return problems;
}
