/**
 * Game state construction and whole-life mutations that no phase owns.
 */

import { currentYearLog } from '@/engine/ageUp';
import { clampMoney, clampStat } from '@/engine/effects';
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

/** Youngest either parent may have been when a sibling was born. */
const MIN_PARENT_AGE = 16;

/** Widest age a sibling is rolled into, before the parents narrow it. */
const MAX_SIBLING_AGE = 10;

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

/**
 * Refusal handed to a player action once the life has ended.
 *
 * Mirrors the wording `interactions.canUse` already refuses with, so the whole
 * engine says the same thing about a finished life.
 */
export const LIFE_OVER = 'Your life is over.';

/**
 * True once the life has ended.
 *
 * A finished life is read-only: no player action may touch it or its epitaph
 * stats, so every exported player action gates on this before it mutates state,
 * spends a draw or writes to the log. `state.death.epitaphStats` is settled at
 * the moment of death and would otherwise disagree with a character sheet a
 * later action had kept editing.
 *
 * Phases are deliberately not gated: `ageUp` already refuses any phase but
 * `alive`, and the phase chain must still finish the year it is inside when a
 * death lands mid-year.
 */
export function lifeIsOver(state: GameState): boolean {
  return state.phase === 'dead';
}

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

/** Shape every minted `Person.id` has, and the only shape the rebuild counts. */
const PERSON_ID_PATTERN = /^p(\d+)$/;

/**
 * The counter as a usable id number, or `undefined` when it cannot be trusted.
 *
 * `nextPersonId` is an ordinary entry in `Character.flags`: content writes flags
 * through `{ kind: 'flag' }` with no reserved-name protection, and a save is
 * just JSON, so this may hold a string, a boolean, zero, a fraction, NaN or
 * Infinity. Anything but a whole number the ids can actually be built from is
 * refused here and rebuilt from the table instead. Non-finite and unsafe
 * magnitudes are refused too: they either stringify into an id no scheme could
 * mint (`p1e+300`) or stop advancing when incremented, which would hand the same
 * id out forever.
 */
function counterValue(raw: boolean | number | string | undefined): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 1) {
    return undefined;
  }
  const floored = Math.floor(raw);
  return Number.isSafeInteger(floored) ? floored : undefined;
}

/** Highest `p<n>` the table already holds, or 0 when it holds none. */
function highestPersonNumber(people: GameState['people']): number {
  let highest = 0;
  for (const id of Object.keys(people)) {
    const match = PERSON_ID_PATTERN.exec(id);
    if (!match) {
      continue;
    }
    const n = Number(match[1]);
    if (Number.isSafeInteger(n) && n > highest) {
      highest = n;
    }
  }
  return highest;
}

/**
 * Registers a person and hands back the stored object.
 * The only supported way to mint a `Person.id`, so ids stay unique per life.
 *
 * A missing or damaged counter is rebuilt from `state.people` rather than
 * restarted at 1. The loan and asset minters may restart theirs, because the ids
 * a pre-counter save holds were minted in a shape those schemes never produce;
 * that argument does not transfer here, since `p<n>` is exactly the shape this
 * table is keyed by, so restarting would re-mint an id that is still live. The
 * store below then replaces that person in place — silently, with every log line
 * and `{ who: 'p1' }` reference now pointing at the newcomer — so the id is
 * additionally walked past anything the table already holds before it is used.
 * That probe terminates: each step it takes consumes a distinct existing key.
 */
export function addPerson(state: GameState, p: Omit<Person, 'id'>): Person {
  const flags = state.character.flags;
  let next = counterValue(flags.nextPersonId) ?? highestPersonNumber(state.people) + 1;
  while (Object.prototype.hasOwnProperty.call(state.people, `p${next}`)) {
    next += 1;
  }
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

  /* Every sibling is older than the newborn, so a sibling's age is also how many
     years to take off each parent's: rolled flat against 1-10 it mints mothers
     who gave birth at 10. Derived once from whichever parent is younger, and
     floored so a parent range ever widened downwards cannot invert the span.
     `rng.int` spends its one draw at any width, so the cursor is unaffected. */
  const oldestSiblingAge = Math.max(
    1,
    Math.min(MAX_SIBLING_AGE, Math.min(motherAge, fatherAge) - MIN_PARENT_AGE)
  );

  const siblings = rng.int(0, 3);
  for (let i = 0; i < siblings; i += 1) {
    const siblingGender = rng.pick(ROLLED_GENDERS);
    const siblingName = rollFirstName(rng, pool, siblingGender);
    const siblingAge = rng.int(1, oldestSiblingAge);
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
  /* Refused before the fee, the cooldown stamp and the visa roll: emigrating
     from a corpse would charge $2,000 against a settled estate and advance the
     shared cursor past the end of the life. Reported with this function's own
     machine-readable vocabulary rather than the prose the other actions use. */
  if (lifeIsOver(state)) {
    return { ok: false, reason: 'life-over' };
  }
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

  /* `clampMoney`, never `Math.max(0, ...)`: the affordability gate above cannot
     refuse an unreadable balance, because every comparison against one is false,
     so this write is what settles it. See the guard's own comment. */
  c.money = clampMoney(c.money - VISA_FEE, c.money);
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
