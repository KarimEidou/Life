/**
 * Core domain types for One Life.
 *
 * This module is the frozen contract shared by the engine, the content packs
 * and the UI. It deliberately contains no imports and exactly one piece of
 * runtime logic (`stageForAge`) so that every layer can depend on it freely.
 */

/** The four headline stats shown on the character card. */
export type StatKey = 'health' | 'happiness' | 'smarts' | 'looks';

/** A full stat block. Values are 0..100; the engine clamps on every write. */
export type Stats = Record<StatKey, number>;

/** Character gender, used for name pools, pronouns and relationship logic. */
export type Gender = 'male' | 'female' | 'nonbinary';

/** Coarse life stage derived from age; drives which UI/actions are available. */
export type Stage = 'infant' | 'toddler' | 'child' | 'teen' | 'adult' | 'senior';

/**
 * Maps an age in years to its life stage.
 * Bands: 0-2 infant, 3-5 toddler, 6-12 child, 13-17 teen, 18-64 adult, 65+ senior.
 * Ages below 0 are treated as infant so callers never get an undefined stage.
 */
export function stageForAge(age: number): Stage {
  if (age <= 2) return 'infant';
  if (age <= 5) return 'toddler';
  if (age <= 12) return 'child';
  if (age <= 17) return 'teen';
  if (age <= 64) return 'adult';
  return 'senior';
}

/** Highest education level completed (not the level currently enrolled in). */
export type EdLevel = 'none' | 'primary' | 'middle' | 'high' | 'university' | 'postgrad';

/** Substances/behaviours a character can become addicted to. */
export type AddictionKey = 'alcohol' | 'smoking' | 'gambling' | 'drugs';

/** Visual/semantic category of a log line; the UI colours rows by this. */
export type LogKind =
  | 'info'
  | 'good'
  | 'bad'
  | 'choice'
  | 'money'
  | 'health'
  | 'death'
  | 'achievement'
  | 'legal';

/** A single line in the life feed. */
export interface LogEntry {
  icon: string;
  text: string;
  kind: LogKind;
}

/** All log lines produced during one year of life, grouped for the feed. */
export interface YearLog {
  age: number;
  year: number;
  entries: LogEntry[];
}

/** Relationship a `Person` has to the player character. */
export type RelKind =
  | 'mother'
  | 'father'
  | 'sibling'
  | 'partner'
  | 'spouse'
  | 'ex'
  | 'child'
  | 'friend'
  | 'enemy'
  | 'pet';

/** Anyone (or any pet) in the character's life. `rel` is affinity 0..100. */
export interface Person {
  id: string;
  kind: RelKind;
  name: string;
  gender: Gender;
  age: number;
  alive: boolean;
  rel: number;
  stats?: Partial<Stats>;
  occupation?: string;
  petSpecies?: string;
  /** Per-person markers, e.g. `{ metAtWork: true, giftsGiven: 3 }`. */
  flags: Record<string, boolean | number>;
}

/** Schooling progress. `enrolledIn` is a `SchoolDef` id while studying. */
export interface EducationState {
  level: EdLevel;
  enrolledIn?: string;
  major?: string;
  year: number;
  gpa: number;
  studyHard: boolean;
}

/** Current employment. `jobId` refers to a `JobDef` id. */
export interface JobState {
  jobId: string;
  title: string;
  salary: number;
  years: number;
  /** Standing with the employer, 0..100; drives raises, promotions and firing. */
  performance: number;
  workHard: boolean;
}

/** An owned property or vehicle instance. `defId` refers to an `AssetDef` id. */
export interface OwnedAsset {
  id: string;
  defId: string;
  label: string;
  paid: number;
  value: number;
  yearBought: number;
}

/** Outstanding debt. `apr` is a fraction (0.06 = 6%), not a percentage. */
export interface Loan {
  id: string;
  kind: 'student' | 'mortgage' | 'auto' | 'personal';
  principal: number;
  apr: number;
  /** Set when the loan is secured against an `OwnedAsset`. */
  assetId?: string;
}

/** Money held outside the cash balance, by vehicle. */
export interface Investments {
  savings: number;
  index: number;
  crypto: number;
}

/** An active condition. `defId` refers to an `IllnessDef` id. */
export interface Illness {
  defId: string;
  years: number;
  treated: boolean;
}

/** Active incarceration. */
export interface PrisonState {
  crime: string;
  yearsLeft: number;
  totalYears: number;
}

/** Subject/object/possessive forms used when composing narrative text. */
export interface Pronouns {
  sub: string;
  obj: string;
  pos: string;
}

/** The player character: everything that dies when the life ends. */
export interface Character {
  id: string;
  firstName: string;
  lastName: string;
  gender: Gender;
  pronouns: Pronouns;
  countryId: string;
  age: number;
  stats: Stats;
  /** Liquid cash. Investments and assets are tracked separately. */
  money: number;
  education: EducationState;
  job: JobState | null;
  prison: PrisonState | null;
  assets: OwnedAsset[];
  loans: Loan[];
  investments: Investments;
  illnesses: Illness[];
  /** Severity 0..100 per substance; absent key means no addiction. */
  addictions: Partial<Record<AddictionKey, number>>;
  fame: number;
  /** Arbitrary story markers set by events and interactions. */
  flags: Record<string, boolean | number | string>;
}

/** An event awaiting a player choice; `choices` mirrors the resolved labels. */
export interface PendingEvent {
  eventId: string;
  text: string;
  icon: string;
  choices: { label: string }[];
}

/** Summary of how a life ended, shown on the death screen. */
export interface DeathInfo {
  cause: string;
  age: number;
  obituary: string;
  epitaphStats: { netWorth: number; jobsHeld: number; kids: number };
}

/** One line of the family tree carried across generations. */
export interface AncestorRecord {
  name: string;
  /** Display range, e.g. `"1994-2071"`. */
  years: string;
  cause: string;
}

/** Whether the game is running, blocked on a choice, or over. */
export type LifePhase = 'alive' | 'awaitingChoice' | 'dead';

/** The complete serialisable game state; the single source of truth. */
export interface GameState {
  /** Mutable PRNG cursor; advancing it is what makes runs reproducible. */
  rngState: number;
  seed: number;
  generation: number;
  year: number;
  character: Character;
  people: Record<string, Person>;
  log: YearLog[];
  pending: PendingEvent[];
  /** Ids of `oncePerLife` events already fired this life. */
  firedEvents: string[];
  /** Interaction id -> age at last use, for cooldown checks. */
  interactionUse: Record<string, number>;
  ancestors: AncestorRecord[];
  phase: LifePhase;
  death?: DeathInfo;
}

/** Seeded random source. All engine randomness must go through this. */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max], inclusive on both ends. */
  int(min: number, max: number): number;
  pick<T>(arr: readonly T[]): T;
  /** True with probability `p` (0..1). */
  chance(p: number): boolean;
  /** Picks an item with probability proportional to `weight(item)`. */
  weighted<T>(items: readonly T[], weight: (t: T) => number): T;
  /** Gaussian sample with the given mean and standard deviation. */
  normal(mean: number, sd: number): number;
}

/** Bumped whenever `GameState` changes shape; older saves are migrated or dropped. */
export const SAVE_VERSION = 1;

/** What actually gets written to storage for a save slot. */
export interface SaveEnvelope {
  version: number;
  savedAt: number;
  slot: number;
  state: GameState;
}

/** Lightweight slot description for the load menu, readable without a full parse. */
export interface SlotSummary {
  slot: number;
  empty: boolean;
  name?: string;
  age?: number;
  money?: number;
  generation?: number;
  savedAt?: number;
  dead?: boolean;
}

/** Appearance preference; `auto` follows the OS colour scheme. */
export type ThemeSetting = 'auto' | 'light' | 'dark';

/** Persisted user preferences, stored separately from save slots. */
export interface Settings {
  theme: ThemeSetting;
  reduceMotion: boolean;
}
