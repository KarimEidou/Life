/**
 * Game state construction and whole-life mutations that no phase owns.
 */

import { currentYearLog } from '@/engine/ageUp';
import { clampStat } from '@/engine/effects';
import { createRng, initialRngState } from '@/engine/rng';
import type {
  Character,
  ContentRegistry,
  CountryDef,
  GameState,
  Gender,
  LogEntry,
  NamePool,
  Person,
  Pronouns,
  Rng,
} from '@/types';

/** Everything the character generator needs; unset fields are rolled from the seed. */
export interface CreateLifeOptions {
  seed: number;
  firstName?: string;
  lastName?: string;
  gender?: Gender;
  countryId?: string;
  startYear?: number;
}

/** Used when the registry ships no countries at all (empty-registry tests). */
const FALLBACK_COUNTRY_ID = 'us';

const FALLBACK_LAST_NAME = 'Doe';

/** Only rolled genders; `nonbinary` is reachable through `CreateLifeOptions`. */
const ROLLED_GENDERS: readonly Gender[] = ['male', 'female'];

const PRONOUNS: Record<Gender, Pronouns> = {
  male: { sub: 'he', obj: 'him', pos: 'his' },
  female: { sub: 'she', obj: 'her', pos: 'her' },
  nonbinary: { sub: 'they', obj: 'them', pos: 'their' },
};

const BIRTH_NOUN: Record<Gender, string> = {
  male: 'boy',
  female: 'girl',
  nonbinary: 'child',
};

/** Cost of one visa application, charged whether or not it is approved. */
const VISA_FEE = 2000;

/** Years that must pass after an application before another is accepted. */
const VISA_COOLDOWN_YEARS = 5;

/* Registry maps are typed as total records, so widen before lookup: a hand-built
   or partially loaded registry can still miss the key we ask for. */
function findCountry(reg: ContentRegistry, id: string): CountryDef | undefined {
  const byId: Record<string, CountryDef | undefined> = reg.countriesById;
  return byId[id] ?? reg.countries.find((country) => country.id === id);
}

function findNamePool(reg: ContentRegistry, countryId: string): NamePool | undefined {
  const pools: Record<string, NamePool | undefined> = reg.namePools;
  return pools[countryId];
}

function givenNames(pool: NamePool | undefined, gender: Gender): string[] {
  if (!pool) {
    return [];
  }
  if (gender === 'male') {
    return pool.male;
  }
  if (gender === 'female') {
    return pool.female;
  }
  return [...pool.male, ...pool.female];
}

function rollFirstName(rng: Rng, pool: NamePool | undefined, gender: Gender): string {
  const names = givenNames(pool, gender);
  if (names.length > 0) {
    return rng.pick(names);
  }
  return gender === 'female' ? 'Riley' : 'Alex';
}

function rollLastName(rng: Rng, pool: NamePool | undefined): string {
  if (pool && pool.last.length > 0) {
    return rng.pick(pool.last);
  }
  return FALLBACK_LAST_NAME;
}

/**
 * Registers a person and hands back the stored object.
 * The only supported way to mint a `Person.id`, so ids stay unique per life.
 */
export function addPerson(state: GameState, p: Omit<Person, 'id'>): Person {
  const flags = state.character.flags;
  const nextRaw = flags.nextPersonId;
  const next = typeof nextRaw === 'number' && nextRaw >= 1 ? Math.floor(nextRaw) : 1;
  const person: Person = { ...p, id: `p${next}` };
  flags.nextPersonId = next + 1;
  state.people[person.id] = person;
  return person;
}

/** Builds a newborn plus a generated family: mother, father and 0-3 siblings. */
export function createLife(reg: ContentRegistry, opts: CreateLifeOptions): GameState {
  /* The rng runs against a stand-in container while the state is still being
     assembled; its final cursor becomes `GameState.rngState` so the very next
     draw of the life continues this sequence instead of restarting it. */
  const cursor = { rngState: initialRngState(opts.seed) };
  const rng = createRng(cursor);

  const requested = opts.countryId !== undefined ? findCountry(reg, opts.countryId) : undefined;
  let countryId: string;
  if (requested) {
    countryId = requested.id;
  } else if (reg.countries.length > 0) {
    countryId = rng.pick(reg.countries).id;
  } else {
    countryId = FALLBACK_COUNTRY_ID;
  }
  const country = findCountry(reg, countryId);
  const countryLabel = country ? country.label : countryId;
  const pool = findNamePool(reg, countryId);

  const gender: Gender = opts.gender ?? rng.pick(ROLLED_GENDERS);
  const firstName = opts.firstName ?? rollFirstName(rng, pool, gender);
  const lastName = opts.lastName ?? rollLastName(rng, pool);

  const health = rng.int(70, 100);
  const happiness = rng.int(60, 100);
  const smarts = rng.int(10, 95);
  const looks = rng.int(10, 95);

  const year = opts.startYear ?? 2025;

  const character: Character = {
    id: 'me',
    firstName,
    lastName,
    gender,
    pronouns: pronounsFor(gender),
    countryId,
    age: 0,
    stats: { health, happiness, smarts, looks },
    money: 0,
    education: { level: 'none', year: 0, gpa: 0, studyHard: false },
    job: null,
    prison: null,
    assets: [],
    loans: [],
    investments: { savings: 0, index: 0, crypto: 0 },
    illnesses: [],
    addictions: {},
    fame: 0,
    flags: { livesWithParents: true, nextPersonId: 1, countryLabel },
  };

  const birth: LogEntry = {
    icon: '👶',
    kind: 'info',
    text: `You were born a baby ${BIRTH_NOUN[gender]} named ${firstName} ${lastName} in ${countryLabel}.`,
  };

  const state: GameState = {
    rngState: cursor.rngState,
    seed: opts.seed,
    generation: 1,
    year,
    character,
    people: {},
    log: [{ age: 0, year, entries: [birth] }],
    pending: [],
    firedEvents: [],
    interactionUse: {},
    ancestors: [],
    phase: 'alive',
  };

  const motherName = rollFirstName(rng, pool, 'female');
  const motherAge = rng.int(20, 42);
  const motherRel = rng.int(70, 100);
  addPerson(state, {
    kind: 'mother',
    name: `${motherName} ${lastName}`,
    gender: 'female',
    age: motherAge,
    alive: true,
    rel: motherRel,
    flags: {},
  });

  const fatherName = rollFirstName(rng, pool, 'male');
  const fatherAge = rng.int(22, 45);
  const fatherRel = rng.int(70, 100);
  addPerson(state, {
    kind: 'father',
    name: `${fatherName} ${lastName}`,
    gender: 'male',
    age: fatherAge,
    alive: true,
    rel: fatherRel,
    flags: {},
  });

  const siblings = rng.int(0, 3);
  for (let i = 0; i < siblings; i += 1) {
    const siblingGender = rng.pick(ROLLED_GENDERS);
    const siblingName = rollFirstName(rng, pool, siblingGender);
    const siblingAge = rng.int(1, 10);
    const siblingRel = rng.int(55, 95);
    addPerson(state, {
      kind: 'sibling',
      name: `${siblingName} ${lastName}`,
      gender: siblingGender,
      age: siblingAge,
      alive: true,
      rel: siblingRel,
      flags: {},
    });
  }

  state.rngState = cursor.rngState;
  return state;
}

/** Subject/object/possessive forms for a gender, used by narrative templating. */
export function pronounsFor(gender: Gender): Pronouns {
  return { ...PRONOUNS[gender] };
}

/** Attempts to move the character to another country, rolling against its visa difficulty. */
export function emigrateTo(
  state: GameState,
  reg: ContentRegistry,
  countryId: string
): { ok: boolean; reason?: string; text?: string } {
  const c = state.character;
  const dest = findCountry(reg, countryId);
  if (!dest) {
    return { ok: false, reason: 'unknown-country' };
  }
  if (dest.id === c.countryId) {
    return { ok: false, reason: 'same-country' };
  }
  if (c.age < 18) {
    return { ok: false, reason: 'too-young' };
  }
  if (c.money < VISA_FEE) {
    return { ok: false, reason: 'no-money' };
  }
  if (c.prison) {
    return { ok: false, reason: 'in-prison' };
  }
  const lastVisaAge = c.flags.lastVisaAge;
  if (typeof lastVisaAge === 'number' && c.age - lastVisaAge < VISA_COOLDOWN_YEARS) {
    return { ok: false, reason: 'cooldown' };
  }

  c.money = Math.max(0, Math.round(c.money - VISA_FEE));
  c.flags.lastVisaAge = c.age;

  const rng = createRng(state);
  const raw = 0.3 + c.stats.smarts / 200 + (c.money > 50000 ? 0.2 : 0) - 0.15 * dest.visaDifficulty;
  const chance = Math.min(0.95, Math.max(0.05, raw));
  const log = currentYearLog(state);

  if (rng.chance(chance)) {
    c.countryId = dest.id;
    c.flags.countryLabel = dest.label;
    c.stats.happiness = clampStat(c.stats.happiness + 10);
    const text = `You moved to ${dest.label}.`;
    log.entries.push({ icon: '✈️', kind: 'good', text });
    return { ok: true, text };
  }

  c.stats.happiness = clampStat(c.stats.happiness - 5);
  const text = `Your visa application to ${dest.label} was denied.`;
  log.entries.push({ icon: '✈️', kind: 'bad', text });
  return { ok: false, reason: 'denied', text };
}
