/**
 * Content-authoring contract for One Life.
 *
 * Everything here describes *data* that content packs declare (events, jobs,
 * schools, ...) plus the registry the engine builds from those packs. Content
 * modules import only from `@/types`; they never import the engine.
 */

import type {
  AddictionKey,
  Character,
  EdLevel,
  GameState,
  LogKind,
  Person,
  Rng,
  StatKey,
} from './core';

/**
 * Read-only context handed to content predicates and text builders.
 * `c` is a convenience alias of `state.character`.
 */
export interface Ctx {
  state: GameState;
  c: Character;
  rng: Rng;
  reg: ContentRegistry;
}

/**
 * Context handed to `{kind:'fn'}` effects while they are being applied.
 * `target` is the person the surrounding effect list is aimed at, when there is one.
 */
export interface EffectCtx {
  state: GameState;
  rng: Rng;
  reg: ContentRegistry;
  target?: Person;
}

/**
 * The only way content mutates the world. Discriminated on `kind`; the engine
 * owns clamping, logging side effects and ordering.
 */
export type Effect =
  | { kind: 'stat'; stat: StatKey; delta: number }
  | { kind: 'money'; delta: number }
  /** `who` is a sentinel (`target` | `partner` | `random-family`) or an explicit `Person.id`. */
  | { kind: 'rel'; who: 'target' | 'partner' | 'random-family' | string; delta: number }
  | { kind: 'flag'; flag: string; value: boolean | number | string }
  | { kind: 'addiction'; which: AddictionKey; delta: number }
  /** `add`/`cure` are `IllnessDef` ids. */
  | { kind: 'illness'; add?: string; cure?: string }
  | { kind: 'fame'; delta: number }
  | { kind: 'jail'; years: number; crime: string }
  | { kind: 'death'; cause: string }
  | { kind: 'log'; icon: string; text: string; logKind?: LogKind }
  /** Escape hatch for logic that no declarative effect covers. */
  | { kind: 'fn'; run: (ctx: EffectCtx) => void };

/** One possible result of a choice; picked by weight among the outcome list. */
export interface EventChoiceOutcome {
  weight: number;
  text: string;
  effects: Effect[];
}

/** A button on an event card. Hidden when `condition` returns false. */
export interface EventChoice {
  label: string;
  condition?: (ctx: Ctx) => boolean;
  outcomes: EventChoiceOutcome[];
}

/**
 * A random life event. `minAge`/`maxAge` are inclusive.
 * If `choices` is absent the event is instant and simply applies `effects`.
 */
export interface EventDef {
  id: string;
  /** Grouping tag used for filtering and for the tab an event belongs to. */
  area: string;
  icon: string;
  minAge: number;
  maxAge: number;
  weight: number;
  oncePerLife?: boolean;
  condition?: (ctx: Ctx) => boolean;
  text: string | ((ctx: Ctx) => string);
  choices?: EventChoice[];
  effects?: Effect[];
}

/**
 * A player-initiated action (a row in an Activities-style list).
 * `resolve` is called after cost/cooldown checks pass and returns the outcome.
 */
export interface InteractionDef {
  id: string;
  area: string;
  label: string;
  icon: string;
  /** Money charged up front; a function when the price depends on state. */
  cost?: number | ((ctx: Ctx) => number);
  minAge?: number;
  maxAge?: number;
  cooldownYears?: number;
  condition?: (ctx: Ctx) => boolean;
  resolve: (ctx: Ctx) => { text: string; effects: Effect[]; icon?: string };
}

/** Hiring gate for a `JobDef`. All present fields must be satisfied. */
export interface JobReq {
  minAge?: number;
  education?: EdLevel;
  majors?: string[];
  minSmarts?: number;
  minLooks?: number;
  /** Internal promotion: requires currently holding this job. */
  prevJobId?: string;
}

/** A position on a career track. `level` orders rungs within `track`. */
export interface JobDef {
  id: string;
  track: string;
  title: string;
  icon: string;
  level: number;
  baseSalary: number;
  /** Annual raise as a fraction, e.g. 0.03 for 3%. */
  raisePct: number;
  req: JobReq;
  promotesTo?: string;
  isPartTime?: boolean;
  fameGain?: number;
}

/** A purchasable property or vehicle. Percentages are fractions of `value`. */
export interface AssetDef {
  id: string;
  type: 'property' | 'vehicle';
  label: string;
  icon: string;
  price: number;
  /** Annual upkeep as a fraction of current value. */
  upkeepPct: number;
  /** Annual appreciation as a fraction; negative for depreciating assets. */
  apprPct: number;
  minAge?: number;
}

/** A disease definition. `lethality` and `cureChance` are per-year probabilities. */
export interface IllnessDef {
  id: string;
  label: string;
  /** Chronic illnesses persist once contracted instead of resolving on their own. */
  chronic: boolean;
  lethality: number;
  /** Relative onset weight for this character-year; 0 means it cannot occur. */
  onsetWeight: (ctx: Ctx) => number;
  healthHit: number;
  treatCost: number;
  cureChance: number;
}

/** An enrollable institution. `minGpa` gates admission where set. */
export interface SchoolDef {
  id: string;
  label: string;
  level: EdLevel;
  years: number;
  tuitionPerYear: number;
  majors?: string[];
  minGpa?: number;
}

/** A starting country. Multipliers scale prices/taxes relative to 1.0. */
export interface CountryDef {
  id: string;
  label: string;
  flag: string;
  costMult: number;
  taxMult: number;
  /** 0..1; how hard it is to emigrate here. */
  visaDifficulty: number;
}

/** A committable crime. Tuples are inclusive `[min, max]` ranges. */
export interface CrimeDef {
  id: string;
  label: string;
  icon: string;
  minAge: number;
  successChance: (ctx: Ctx) => number;
  payout: [number, number];
  sentenceYears: [number, number];
}

/** An unlockable achievement. `check` is evaluated against whole-game state. */
export interface AchievementDef {
  id: string;
  label: string;
  desc: string;
  icon: string;
  /** Hidden in the list until unlocked. */
  secret?: boolean;
  check: (state: GameState) => boolean;
}

/** Name lists for one country, used to generate characters and family. */
export interface NamePool {
  countryId: string;
  male: string[];
  female: string[];
  last: string[];
}

/** A bundle of content. Packs are merged in registration order. */
export interface ContentPack {
  id: string;
  events?: EventDef[];
  interactions?: InteractionDef[];
  jobs?: JobDef[];
  assets?: AssetDef[];
  illnesses?: IllnessDef[];
  schools?: SchoolDef[];
  countries?: CountryDef[];
  crimes?: CrimeDef[];
  achievements?: AchievementDef[];
  namePools?: NamePool[];
}

/**
 * All content flattened for lookup: one array plus one id map per kind.
 * Built once at startup by `buildRegistry` and treated as read-only thereafter.
 */
export interface ContentRegistry {
  /** Ids of the packs that were merged, in registration order. */
  packs: string[];
  events: EventDef[];
  eventsById: Record<string, EventDef>;
  interactions: InteractionDef[];
  interactionsById: Record<string, InteractionDef>;
  jobs: JobDef[];
  jobsById: Record<string, JobDef>;
  assets: AssetDef[];
  assetsById: Record<string, AssetDef>;
  illnesses: IllnessDef[];
  illnessesById: Record<string, IllnessDef>;
  schools: SchoolDef[];
  schoolsById: Record<string, SchoolDef>;
  countries: CountryDef[];
  countriesById: Record<string, CountryDef>;
  crimes: CrimeDef[];
  crimesById: Record<string, CrimeDef>;
  achievements: AchievementDef[];
  achievementsById: Record<string, AchievementDef>;
  /** Keyed by `NamePool.countryId`. */
  namePools: Record<string, NamePool>;
}
