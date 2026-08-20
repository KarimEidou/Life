/**
 * Persistence: save slots, global achievements and user settings.
 *
 * All storage goes through `StorageAdapter` so tests can swap in a Map and the
 * engine never touches `window` directly.
 */

import { clampMoney } from '@/engine/effects';
import { initialRngState } from '@/engine/rng';
import { SAVE_VERSION } from '@/types';
import type {
  EdLevel,
  GameState,
  LifePhase,
  SaveEnvelope,
  Settings,
  SlotSummary,
  ThemeSetting,
} from '@/types';

/** The subset of the Web Storage API the game needs. */
export interface StorageAdapter {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

/* The whole persistence contract, in one place: these four `ol.*` names are
   everything the game writes. `ol.table.<slot>` is the store's blackjack
   sidecar, and its payload stays the store's business — a `BlackjackTable` is a
   content type this module must not learn about — but the key belongs to the
   slot it rides beside, so erasing a slot can erase both halves of it. */
const SLOT_PREFIX = 'ol.save.';
const TABLE_PREFIX = 'ol.table.';
const ACHIEVEMENTS_KEY = 'ol.achievements';
const SETTINGS_KEY = 'ol.settings';

const DEFAULT_SETTINGS: Settings = { theme: 'auto', reduceMotion: false };
const THEMES: readonly ThemeSetting[] = ['auto', 'light', 'dark'];

const ED_LEVELS: readonly EdLevel[] = [
  'none',
  'primary',
  'middle',
  'high',
  'university',
  'postgrad',
];
const PHASES: readonly LifePhase[] = ['alive', 'awaitingChoice', 'dead'];
const STAT_KEYS = ['health', 'happiness', 'smarts', 'looks'] as const;
const INVESTMENT_KEYS = ['savings', 'index', 'crypto'] as const;

/** `createLife`'s default `startYear`, and so the year a save without one resumes in. */
const FALLBACK_YEAR = 2025;
/**
 * What an unreadable stat becomes. Mid-range rather than a newborn roll (70-100
 * health, 10-95 smarts) because there is no seed to re-roll from here, and
 * rather than 0 because 0 health kills the character on the next tick — a
 * repair may cost the player a number, never the life.
 */
const FALLBACK_STAT = 50;

/** Where one slot's save envelope lives. */
export function slotKey(slot: number): string {
  return `${SLOT_PREFIX}${slot}`;
}

/**
 * Where the store parks an unfinished blackjack hand for `slot`.
 *
 * Exported rather than spelled out at the writer because the sidecar is one
 * slot's state too: its stake is charged in the save beside it, so the two keys
 * are created, replaced and erased together, and only one of them can be
 * defined in the module that does the erasing.
 */
export function tableKey(slot: number): string {
  return `${TABLE_PREFIX}${slot}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function stringOr(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

/** What `isGameStateShaped` certifies, so `repairState` needs no casts to walk it. */
type ShapedState = Record<string, unknown> & {
  character: Record<string, unknown> & {
    stats: Record<string, unknown>;
    education: Record<string, unknown>;
    investments: Record<string, unknown>;
  };
};

/**
 * The half of the load-time gate that refuses instead of repairing: the fields
 * that make the payload a life at all, where inventing a value would hand the
 * player a character they never played. A name, an age and the four records
 * `repairState` fills in key by key — a container that is not there cannot be
 * repaired field-wise, only invented whole.
 *
 * Everything else the engine can resume from is filled in by `repairState`
 * instead, so it is the pair of them, not this predicate alone, that guarantees
 * the containers the engine and the UI dereference unguarded (`state.people` in
 * the text formatter, `state.log` in the feed, `character.assets` in the
 * finance sheet) exist by the time a state is adopted.
 *
 * `summarise` asks it the same question a tap ahead of time, which is what lets
 * a slot row warn about a refusal instead of the player meeting it afterwards.
 */
function isGameStateShaped(v: unknown): v is ShapedState {
  if (!isRecord(v)) {
    return false;
  }
  const c = v.character;
  if (!isRecord(c)) {
    return false;
  }
  if (typeof c.firstName !== 'string' || typeof c.lastName !== 'string') {
    return false;
  }
  if (typeof c.age !== 'number' || !Number.isFinite(c.age)) {
    return false;
  }
  return (
    isRecord(c.stats) &&
    isRecord(c.education) &&
    isRecord(c.investments) &&
    isRecord(c.flags) &&
    isRecord(c.pronouns)
  );
}

/** Replaces `host[key]` with `{}` unless it already is a record. */
function fixRecord(
  host: Record<string, unknown>,
  key: string,
  label: string,
  repairs: string[]
): void {
  if (!isRecord(host[key])) {
    host[key] = {};
    repairs.push(label);
  }
}

/** Replaces `host[key]` with `[]` unless it already is an array. */
function fixArray(
  host: Record<string, unknown>,
  key: string,
  label: string,
  repairs: string[]
): void {
  if (!Array.isArray(host[key])) {
    host[key] = [];
    repairs.push(label);
  }
}

/** Replaces `host[key]` with `fallback` unless it already is a finite number. */
function fixFinite(
  host: Record<string, unknown>,
  key: string,
  label: string,
  fallback: number,
  repairs: string[]
): void {
  const v = host[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    host[key] = fallback;
    repairs.push(label);
  }
}

/** `null` is the documented "none" for `job` and `prison`; nothing else may stand in. */
function fixRecordOrNull(
  host: Record<string, unknown>,
  key: string,
  label: string,
  repairs: string[]
): void {
  if (host[key] !== null && !isRecord(host[key])) {
    host[key] = null;
    repairs.push(label);
  }
}

/**
 * The other half of the gate: fills in every field a legal life already takes,
 * and names each one it had to touch.
 *
 * The damage worth planning for is not "this is not a save" — it is a save this
 * build reads a field short: a write truncated by a quota error, a hand-edited
 * entry, a slot written by a build that carried a field this one dropped.
 * Refusing those costs the player the whole life, and the load menu answers a
 * refusal with a Delete button; every default below is a value a legal life
 * already takes — all but `FALLBACK_STAT` are what `createLife`/`startLegacy`
 * themselves start at — so resuming from one costs an empty log or a mid-range
 * stat instead.
 *
 * Repairs are "fix only when the type is wrong". Nothing here normalises a
 * readable value and nothing adds a field a save legally lacks (`death`,
 * `education.major`, `education.enrolledIn`), so a healthy save comes back
 * untouched with no repairs to report. Mutation is in place because the payload
 * is this function's own `JSON.parse` product and nothing else holds it.
 */
function repairState(v: unknown): { state: GameState; repairs: string[] } | null {
  if (!isGameStateShaped(v)) {
    return null;
  }
  const repairs: string[] = [];
  const c = v.character;

  /* Through `clampMoney` rather than a finiteness test: JSON cannot carry NaN
     or Infinity, so a poisoned balance comes back as `null` — which `typeof`
     reads as an object and every affordability gate (`money >= price`) reads as
     `false`, leaving the player with a wallet that can never buy anything. */
  const money = clampMoney(Number(c.money));
  if (money !== c.money) {
    c.money = money;
    repairs.push('character.money');
  }
  for (const key of STAT_KEYS) {
    fixFinite(c.stats, key, `character.stats.${key}`, FALLBACK_STAT, repairs);
  }
  fixFinite(c, 'fame', 'character.fame', 0, repairs);
  fixArray(c, 'assets', 'character.assets', repairs);
  fixArray(c, 'loans', 'character.loans', repairs);
  fixArray(c, 'illnesses', 'character.illnesses', repairs);
  fixRecord(c, 'addictions', 'character.addictions', repairs);
  fixRecordOrNull(c, 'job', 'character.job', repairs);
  fixRecordOrNull(c, 'prison', 'character.prison', repairs);

  fixFinite(c.education, 'year', 'character.education.year', 0, repairs);
  fixFinite(c.education, 'gpa', 'character.education.gpa', 0, repairs);
  if (!ED_LEVELS.some((level) => level === c.education.level)) {
    c.education.level = 'none';
    repairs.push('character.education.level');
  }
  for (const key of INVESTMENT_KEYS) {
    fixFinite(c.investments, key, `character.investments.${key}`, 0, repairs);
  }

  fixRecord(v, 'people', 'people', repairs);
  fixRecord(v, 'interactionUse', 'interactionUse', repairs);
  fixArray(v, 'log', 'log', repairs);
  fixArray(v, 'pending', 'pending', repairs);
  fixArray(v, 'firedEvents', 'firedEvents', repairs);
  fixArray(v, 'ancestors', 'ancestors', repairs);

  /* Only an unrecognised phase is rewritten: `dead` is a real, finished life and
     resurrecting it would deny the player their death screen and their heir. */
  if (!PHASES.some((phase) => phase === v.phase)) {
    v.phase = 'alive';
    repairs.push('phase');
  }
  fixFinite(v, 'seed', 'seed', 0, repairs);
  /* Repaired after `seed` so the replacement cursor is the one that seed starts
     from. `draw` coerces an unreadable cursor to 0 on its own, but silently and
     into a sequence no reload reproduces. */
  if (typeof v.rngState !== 'number' || !Number.isFinite(v.rngState)) {
    v.rngState = initialRngState(numberOr(v.seed, 0));
    repairs.push('rngState');
  }
  if (typeof v.generation !== 'number' || !Number.isFinite(v.generation) || v.generation < 1) {
    v.generation = 1;
    repairs.push('generation');
  }
  fixFinite(v, 'year', 'year', FALLBACK_YEAR, repairs);
  /* Absent is legal — a living character has no obituary — so this drops a
     present-but-unreadable one rather than inventing one. `settleDeath` rebuilds
     it from `phase` and the pending cause when the life is actually over. */
  if ('death' in v && !isRecord(v.death)) {
    delete v.death;
    repairs.push('death');
  }

  return { state: v as unknown as GameState, repairs };
}

/** Adapter over `window.localStorage`, guarded for non-browser environments. */
export function browserStorage(): StorageAdapter {
  if (typeof localStorage === 'undefined') {
    throw new Error('browserStorage: localStorage is unavailable in this environment');
  }
  const store = localStorage;
  return {
    getItem(k: string): string | null {
      return store.getItem(k);
    },
    setItem(k: string, v: string): void {
      store.setItem(k, v);
    },
    removeItem(k: string): void {
      store.removeItem(k);
    },
  };
}

/** In-memory adapter, for tests and for environments without storage. */
export function memoryStorage(): StorageAdapter {
  const map = new Map<string, string>();
  return {
    getItem(k: string): string | null {
      const value = map.get(k);
      return value === undefined ? null : value;
    },
    setItem(k: string, v: string): void {
      map.set(k, v);
    },
    removeItem(k: string): void {
      map.delete(k);
    },
  };
}

/** How many save slots the load menu shows. */
export const SLOT_COUNT = 6;

/**
 * Why a slot did not open: nothing is stored there, the payload is unreadable,
 * or the envelope was stamped by a newer build.
 *
 * Named so the store can hand a refusal to the UI unchanged — the load menu
 * words `future` differently from the rest, and re-reading the slot to ask a
 * second time is how the two answers drift apart.
 */
export type LoadFailure = 'empty' | 'corrupt' | 'future';

/**
 * Outcome of reading a slot; `future` means the save is newer than this build.
 *
 * `repairs` names every field the loader had to fill in, in dotted-path form
 * (`character.money`, `log`), and is absent — not empty — when the save needed
 * none, so a caller can tell "recovered" from "read as written" by presence.
 */
export type LoadResult =
  | { ok: true; state: GameState; repairs?: string[] }
  | { ok: false; reason: LoadFailure };

/**
 * Why this build cannot open a slot: `damaged` is a payload it reads as broken,
 * `future` an envelope stamped by a newer build. Both are `loadGame` refusals
 * (`corrupt` and `future`) that the shallow slot read can already see coming.
 */
export type SlotProblem = 'damaged' | 'future';

/**
 * A load-menu row: a `SlotSummary` plus why the slot will not open.
 *
 * The flag lives here rather than on `SlotSummary` because `src/types/core.ts`
 * is the frozen contract shared with content, and only the load menu reads it.
 * It is absent — never `false` — on a slot this build can open, so presence is
 * the whole test, and every existing consumer still typechecks against a row.
 */
export interface SlotRow extends SlotSummary {
  unreadable?: SlotProblem;
}

/** Writes a `SaveEnvelope` as JSON under `ol.save.<slot>`. */
export function saveGame(storage: StorageAdapter, slot: number, state: GameState): void {
  /* The one place a wall clock is allowed: `savedAt` is slot metadata, never an
     input to a game rule. */
  const envelope: SaveEnvelope = { version: SAVE_VERSION, savedAt: Date.now(), slot, state };
  storage.setItem(slotKey(slot), JSON.stringify(envelope));
}

/** Reads a slot, running `migrations` for older versions; newer versions are rejected. */
export function loadGame(storage: StorageAdapter, slot: number): LoadResult {
  const raw = storage.getItem(slotKey(slot));
  if (raw === null || raw === '') {
    return { ok: false, reason: 'empty' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'corrupt' };
  }

  if (!isRecord(parsed) || typeof parsed.version !== 'number') {
    return { ok: false, reason: 'corrupt' };
  }
  /* Checked before the payload shape: a newer build is exactly the case where
     `GameState` may have been reshaped, so shape-checking first would report the
     newest saves as `corrupt` and invite the player to delete a good save. */
  if (parsed.version > SAVE_VERSION) {
    return { ok: false, reason: 'future' };
  }
  const stored = parsed.state;
  /* Only "is it an object at all" before the chain: a migration exists precisely
     to reshape `GameState`, so shape-gating here would make the one change a
     step most plausibly has to perform — creating, renaming or moving a
     top-level key — unreachable behind a `corrupt` verdict. */
  if (!isRecord(stored)) {
    return { ok: false, reason: 'corrupt' };
  }

  const migrated = migrate(stored, parsed.version);
  if (migrated === null) {
    return { ok: false, reason: 'corrupt' };
  }

  // The single shape gate, judging what the migrations actually produced.
  const repaired = repairState(migrated.state);
  if (repaired === null) {
    return { ok: false, reason: 'corrupt' };
  }
  return repaired.repairs.length === 0
    ? { ok: true, state: repaired.state }
    : { ok: true, state: repaired.state, repairs: repaired.repairs };
}

/**
 * Clears one slot: the save envelope and the blackjack sidecar beside it.
 *
 * Both, because the sidecar holds a hand whose stake was charged in the very
 * save being erased. Left behind, it is dealt back on top of whichever life
 * occupies the slot next, paying out of a balance it was never taken from — and
 * a caller that has to remember a second `removeItem` to avoid that is a caller
 * that can forget it.
 *
 * The sidecar goes first so that even a write that throws half way through
 * cannot leave that orphan behind; the other half-erasure — a save whose hand
 * is gone — is a delete the player can simply repeat.
 */
export function deleteSave(storage: StorageAdapter, slot: number): void {
  storage.removeItem(tableKey(slot));
  storage.removeItem(slotKey(slot));
}

/**
 * Walks a stored payload up the chain, from the version it was written at to
 * `SAVE_VERSION`. `null` is a gap — a save this build has no path for, which is
 * unreadable rather than half-migrated. A payload already at (or past)
 * `SAVE_VERSION` walks no steps and comes back untouched, which is what keeps a
 * healthy save byte-identical through a load.
 *
 * Wrapped like `repairState`'s result rather than returned bare, because `null`
 * is a value a step may legitimately return: `unknown | null` is just `unknown`
 * to the compiler, so a bare answer would both hide the gap from the type and
 * confuse it with a step's own output.
 *
 * Exported so a step can be exercised, and a chain rehearsed, without going
 * through storage — `SAVE_VERSION` is a `const` no test can bump, so the walk
 * has to be drivable directly.
 */
export function migrate(state: unknown, from: number): { state: unknown } | null {
  /* Widened so a missing step reads as `undefined` instead of an always-defined
     function type. */
  const steps: Record<number, ((old: unknown) => unknown) | undefined> = migrations;
  let version = from;
  let migrated = state;
  while (version < SAVE_VERSION) {
    const step = steps[version + 1];
    if (step === undefined) {
      return null;
    }
    migrated = step(migrated);
    version += 1;
  }
  return { state: migrated };
}

/**
 * Whether the chain can carry `version` up to `SAVE_VERSION` — the same walk
 * `migrate` makes, asked without the payload, so a slot row can see a refusal
 * coming without running a single step. A missing step ends it, so this
 * terminates on any input `JSON.parse` can produce, `-Infinity` included.
 */
function migratable(version: number): boolean {
  /* Widened so a missing step reads as `undefined`, as in `loadGame`. */
  const steps: Record<number, ((old: unknown) => unknown) | undefined> = migrations;
  let v = version;
  while (v < SAVE_VERSION) {
    if (steps[v + 1] === undefined) {
      return false;
    }
    v += 1;
  }
  return true;
}

/**
 * The refusal the envelope stamp settles on its own, before anything is read
 * out of the payload: `loadGame` turns away a newer version on sight, and one
 * it has no chain for whatever the state turns out to hold. `null` means the
 * stamp itself is fine — only the payload can still be wrong.
 */
function stampProblem(version: unknown): SlotProblem | null {
  if (typeof version !== 'number') {
    return 'damaged';
  }
  if (version > SAVE_VERSION) {
    return 'future';
  }
  return version < SAVE_VERSION && !migratable(version) ? 'damaged' : null;
}

/* Slot-list rows are read shallowly and never validated: a slot this build
   cannot describe loses its details rather than crashing the load menu.
   `empty`, though, has to keep meaning what `loadGame` means by it — nothing is
   stored here. `loadGame` answers `corrupt` or `future` for every payload it
   cannot read, never `empty`, and the load menu hands an `empty` row straight
   to `startNew`, which overwrites the slot with no confirmation and no undo.
   So anything actually written here stays occupied whether this build can make
   sense of it or not — a newer envelope (which Continue reports as `future`), a
   legacy one only a migration understands, a damaged payload the player may
   still want to recover — and keeps its Continue/Delete alert.

   Occupied is only half the answer, though: a row that reads like any other
   save is the one a player replaces without meaning to, so `unreadable` says
   which refusal `loadGame` is about to make and lets the menu label the row for
   what it is. It is set only where this read settles the question `loadGame`
   would answer — never on a payload a pending migration still gets to
   reshape. */
function summarise(storage: StorageAdapter, slot: number): SlotRow {
  /* Declared outside the try so the catch can tell a read that never returned —
     which says nothing about the slot — from a payload that is there and would
     not parse. Only the second one keeps the slot occupied. */
  let raw: string | null = null;
  try {
    raw = storage.getItem(slotKey(slot));
    if (raw === null || raw === '') {
      return { slot, empty: true };
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return { slot, empty: false, unreadable: 'damaged' };
    }
    const version = parsed.version;
    const willMigrate = typeof version === 'number' && version < SAVE_VERSION;
    /* `loadGame` refuses a state that is not an object before the chain runs,
       and judges what the chain produced with `isGameStateShaped` after it. A
       payload a step still gets to reshape is the one a shallow read may not
       judge — the step exists precisely to move fields this predicate is
       looking for — so that one keeps the benefit of the doubt; for every other
       payload this is the loader's own verdict rather than a second opinion
       that could drift from it. */
    const shapeFails = willMigrate ? !isRecord(parsed.state) : !isGameStateShaped(parsed.state);
    const problem = stampProblem(version) ?? (shapeFails ? 'damaged' : null);
    const savedAt = numberOr(parsed.savedAt, 0);
    // Occupied, with nothing read out of the payload yet beyond the stamp.
    const noDetails: SlotRow =
      problem === null
        ? { slot, empty: false, savedAt }
        : { slot, empty: false, savedAt, unreadable: problem };
    const state = parsed.state;
    if (!isRecord(state)) {
      return noDetails;
    }
    const character = state.character;
    if (!isRecord(character)) {
      return noDetails;
    }
    const first = stringOr(character.firstName, '');
    const last = stringOr(character.lastName, '');
    const label = `${first} ${last}`.trim();
    const summary: SlotRow = {
      slot,
      empty: false,
      /* Absent rather than empty: the load menu titles the row and its
         confirmation alert `name ?? 'Saved life'`, and nullish coalescing keeps
         `''`, leaving the player to Continue-or-Delete an unlabelled slot. */
      name: label === '' ? undefined : label,
      age: numberOr(character.age, 0),
      money: numberOr(character.money, 0),
      generation: numberOr(state.generation, 1),
      savedAt,
      dead: state.phase === 'dead',
    };
    /* The details survive a refusal deliberately: a save from a newer build is
       healthy data this one is merely too old to open, and a row that still
       names the life is what keeps the warning from reading as "it is gone". */
    return problem === null ? summary : { ...summary, unreadable: problem };
  } catch {
    if (raw === null || raw === '') {
      return { slot, empty: true };
    }
    // A payload that is there and would not parse: damage the player can see.
    return { slot, empty: false, unreadable: 'damaged' };
  }
}

/** Summarises every slot for the load menu; always returns `SLOT_COUNT` entries. */
export function listSlots(storage: StorageAdapter): SlotRow[] {
  const out: SlotRow[] = [];
  for (let slot = 1; slot <= SLOT_COUNT; slot += 1) {
    out.push(summarise(storage, slot));
  }
  return out;
}

/**
 * Keyed by the version being upgraded *to*: loading a save at version `v` runs
 * `migrations[v + 1]`, then `[v + 2]`, up to `SAVE_VERSION`. A gap in the chain
 * makes the save unreadable rather than half-migrated — and `loadGame` reports
 * that as `corrupt`, which the load menu puts in front of the player next to a
 * Delete button. That is the whole reason for the recipe below: the step has to
 * ship with the bump, or every existing player's save is the thing that breaks.
 *
 * Reshaping `GameState`:
 *
 * 1. Bump `SAVE_VERSION` in `src/types/core.ts` by one.
 * 2. Register the step under the *new* number — `migrations[<new SAVE_VERSION>]`
 *    — never the number it upgrades from. `save.test.ts` fails on a bump that
 *    ships without a step, and on a step keyed outside `2..SAVE_VERSION` (which
 *    is the same mistake, spelled the other way round: nothing ever looks it up).
 * 3. Write the step against the *stored* shape and return the *next* version's
 *    shape. Its parameter is `unknown` because it is `JSON.parse` output rather
 *    than a `GameState`: last build's fields, this build's fields absent, and
 *    everything already flattened by JSON — no `NaN`, no `Infinity`, no
 *    `undefined`, no class instances.
 * 4. Only "is it an object at all" is checked before the chain, so a step may
 *    create, rename or drop any top-level key, `character` included. The shape
 *    gate and the repair pass in `repairState` both run *after* the whole chain,
 *    so an intermediate step is free to leave the state malformed; only what the
 *    last step returns has to be a life.
 * 5. Add a case to `describe('migrations')` in `save.test.ts`, modelled on
 *    'upgrades an older save through the registered chain': store a legacy
 *    payload under the old version, load it, assert the modern shape comes back.
 */
export const migrations: Record<number, (old: unknown) => unknown> = {};

/** Reads the cross-life unlocked achievement ids from `ol.achievements`. */
export function loadUnlockedAchievements(storage: StorageAdapter): string[] {
  const raw = storage.getItem(ACHIEVEMENTS_KEY);
  if (raw === null || raw === '') {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((id): id is string => typeof id === 'string');
  } catch {
    return [];
  }
}

/** Writes the cross-life unlocked achievement ids to `ol.achievements`. */
export function saveUnlockedAchievements(storage: StorageAdapter, ids: string[]): void {
  storage.setItem(ACHIEVEMENTS_KEY, JSON.stringify([...new Set(ids)]));
}

/** Reads `ol.settings`, defaulting to `{ theme: 'auto', reduceMotion: false }`. */
export function loadSettings(storage: StorageAdapter): Settings {
  const raw = storage.getItem(SETTINGS_KEY);
  if (raw === null || raw === '') {
    return { ...DEFAULT_SETTINGS };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return { ...DEFAULT_SETTINGS };
    }
    const theme = THEMES.find((t) => t === parsed.theme);
    return {
      theme: theme ?? DEFAULT_SETTINGS.theme,
      reduceMotion:
        typeof parsed.reduceMotion === 'boolean'
          ? parsed.reduceMotion
          : DEFAULT_SETTINGS.reduceMotion,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Writes user settings to `ol.settings`. */
export function saveSettings(storage: StorageAdapter, s: Settings): void {
  storage.setItem(SETTINGS_KEY, JSON.stringify({ theme: s.theme, reduceMotion: s.reduceMotion }));
}
