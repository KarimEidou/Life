import { addiction, free, holds, trueFlag } from '@/content/lib';
import type {
  AddictionKey,
  Character,
  ContentPack,
  ContentRegistry,
  Ctx,
  Effect,
  EffectCtx,
  EventDef,
  Illness,
  IllnessDef,
  InteractionDef,
} from '@/types';

/**
 * Illness definitions, treatments and the doctor/clinic interactions.
 *
 * `onsetWeight` returns an **annual probability**, not a share of some pool:
 * `healthPhase` rolls every definition the character is not already carrying
 * once a year and clamps whatever comes back into 0..1. So the numbers below are
 * read directly as "this many lives in a hundred catch it this year", which is
 * what keeps the cohort in the band `simulation.test.ts` measures. Colds are
 * common and cheap; the conditions that end lives are rare, late and expensive.
 *
 * Even the cheap ones are rarer here than they are in life, because nothing in
 * the engine gives health back on its own: a bout costs `healthHit` at onset and
 * `healthHit / 2` for every year it is carried untreated, and recovery does not
 * refund a point of it. Frequency is therefore budgeted against a whole life's
 * health rather than against a year — a flu every other year reads plausible and
 * bankrupts the character's health by fifty. Treatment is the counterweight the
 * player controls: `act-doctor` stops the drain, cuts the hazard the death check
 * reads to a quarter and doubles the odds of shaking a bout off. A quarter
 * because `deathProbability` adds a held row to the year's hazard at
 * `lethality * 2` untreated and `lethality * 0.5` treated — so every number
 * below carries twice its face value for as long as it goes untreated.
 *
 * Every risk factor is read defensively. A condition function runs against any
 * `GameState` the engine happens to be holding — a fresh newborn, a save written
 * by an older build, a character whose addictions map came back from JSON with a
 * string in it — so nothing here trusts a flag, a stat or a severity without
 * checking what it actually is.
 *
 * `chronic` decides whether `cureChance` is read at all: `healthPhase` gates the
 * yearly recovery roll on `!def.chronic`, and no pack ships a
 * `{kind:'illness', cure}` effect, so a chronic row is carried until death
 * whatever its `cureChance` claims. The two fields have to agree — everything
 * permanent here declares `cureChance: 0`, and anything meant to pass, however
 * slowly, is not chronic.
 *
 * `IllnessDef.label` carries its own article ('the flu', 'a bad back'), because
 * the engine reads it both as `You came down with ${label}.` and as
 * `You died of ${label}.`
 *
 * The rows that need the world outside ask `free`, under the prison policy
 * documented above `free` in `@/content/lib`: a church-hall clinic, a pharmacy
 * queue, a private scan, a dentist's chair and thirty days of residential
 * rehab. `eventsPhase` keeps drawing and the Health sheet stays reachable while
 * the character is inside, so an ungated row is one the prison pack's years hand
 * out from a cell. The bouts (`flu-season`, `insomnia`, `allergies`,
 * `back-tweak`) and the care rows (`act-doctor`, `act-therapy`, `act-checkup`,
 * `act-meditation`) are the policy's first class and deliberately do not ask: a
 * cell is as good a place as any to catch flu, fail to sleep or be seen by the
 * infirmary, and the infirmary is what a prison provides.
 */

/* ------------------------------------------------------------------ */
/* Readers                                                             */
/* ------------------------------------------------------------------ */

/** Rows the character is carrying that nobody is treating yet. */
function untreated(c: Character): Illness[] {
  return c.illnesses.filter((illness) => !illness.treated);
}

/**
 * Keeps an authored onset inside a believable annual probability.
 *
 * `healthPhase` clamps too, but it clamps with `Math.max(0, p)` — and that
 * answers NaN with NaN. A risk factor built out of a damaged save must not be
 * able to produce one, so the arithmetic is checked here where it happens.
 */
function odds(p: number): number {
  if (!Number.isFinite(p) || p <= 0) return 0;
  return p > 0.4 ? 0.4 : p;
}

/* Registry maps are typed as total records, so widen before lookup: a save can
   outlive the content that defined one of its illnesses. */
function findIllness(reg: ContentRegistry, defId: string): IllnessDef | undefined {
  const byId: Record<string, IllnessDef | undefined> = reg.illnessesById;
  return byId[defId];
}

function labelOf(reg: ContentRegistry, defId: string): string {
  return findIllness(reg, defId)?.label ?? 'something the chart will not say out loud';
}

/** `a`, `a and b`, `a, b and c` — the doctor reading a list back to you. */
function listOf(labels: readonly string[]): string {
  if (labels.length === 0) return 'nothing';
  if (labels.length === 1) return labels[0] ?? 'nothing';
  const head = labels.slice(0, -1).join(', ');
  return `${head} and ${labels[labels.length - 1] ?? ''}`;
}

/* ------------------------------------------------------------------ */
/* Illnesses                                                           */
/* ------------------------------------------------------------------ */

const illnesses: IllnessDef[] = [
  {
    id: 'ill-flu',
    label: 'the flu',
    chronic: false,
    lethality: 0.001,
    healthHit: 5,
    treatCost: 100,
    cureChance: 0.9,
    onsetWeight: (ctx: Ctx) => {
      const c = ctx.c;
      // Schools and care homes are where it actually spreads.
      return odds(c.age < 13 || c.age >= 65 ? 0.03 : 0.02);
    },
  },
  {
    id: 'ill-food-poisoning',
    label: 'food poisoning',
    chronic: false,
    lethality: 0.002,
    healthHit: 8,
    treatCost: 150,
    cureChance: 0.95,
    onsetWeight: (ctx: Ctx) => {
      const c = ctx.c;
      // The years of gas-station sushi and optimistic leftovers.
      return odds(c.age >= 16 && c.age <= 35 ? 0.018 : 0.012);
    },
  },
  {
    id: 'ill-broken-bone',
    label: 'a broken bone',
    chronic: false,
    lethality: 0.0005,
    healthHit: 10,
    treatCost: 800,
    cureChance: 0.85,
    onsetWeight: (ctx: Ctx) => {
      const c = ctx.c;
      let p = 0.003;
      if (c.age < 18) p = 0.008;
      else if (c.age >= 70) p = 0.006 + (c.age - 70) * 0.0004;
      if (trueFlag(c, 'gymRegular')) p += 0.002;
      return odds(p);
    },
  },
  {
    id: 'ill-asthma',
    label: 'asthma',
    chronic: true,
    lethality: 0.002,
    healthHit: 4,
    treatCost: 300,
    cureChance: 0,
    onsetWeight: (ctx: Ctx) => {
      const c = ctx.c;
      const base = c.age <= 12 ? 0.0008 : c.age <= 30 ? 0.0003 : 0.0002;
      return odds(base + (addiction(c, 'smoking') / 100) * 0.004);
    },
  },
  {
    id: 'ill-depression',
    label: 'depression',
    chronic: false,
    lethality: 0.003,
    healthHit: 6,
    treatCost: 400,
    cureChance: 0.3,
    onsetWeight: (ctx: Ctx) => {
      const c = ctx.c;
      if (c.age < 12) return 0;
      const mood = c.stats.happiness;
      let p = mood < 20 ? 0.008 : mood < 30 ? 0.005 : mood < 50 ? 0.002 : 0.0008;
      if (addiction(c, 'alcohol') > 0 || addiction(c, 'drugs') > 0) p += 0.003;
      return odds(p);
    },
  },
  {
    id: 'ill-diabetes',
    label: 'diabetes',
    chronic: true,
    lethality: 0.006,
    healthHit: 6,
    treatCost: 1200,
    cureChance: 0,
    onsetWeight: (ctx: Ctx) => {
      const c = ctx.c;
      if (c.age < 20) return odds(0.0002);
      let p = 0.0006 + (c.age - 20) * 0.0001;
      if (!trueFlag(c, 'goodDiet')) p *= 1.6;
      if (trueFlag(c, 'gymRegular')) p *= 0.6;
      return odds(p);
    },
  },
  {
    id: 'ill-hypertension',
    label: 'high blood pressure',
    chronic: true,
    lethality: 0.005,
    healthHit: 5,
    treatCost: 600,
    cureChance: 0,
    onsetWeight: (ctx: Ctx) => {
      const c = ctx.c;
      if (c.age < 25) return odds(0.0002);
      let p = 0.001 + (c.age - 25) * 0.00016;
      if (addiction(c, 'smoking') > 0) p *= 1.5;
      if (trueFlag(c, 'gymRegular')) p *= 0.65;
      if (trueFlag(c, 'goodDiet')) p *= 0.8;
      return odds(p);
    },
  },
  {
    id: 'ill-ulcer',
    label: 'an ulcer',
    chronic: false,
    lethality: 0.003,
    healthHit: 7,
    treatCost: 900,
    cureChance: 0.7,
    onsetWeight: (ctx: Ctx) => {
      const c = ctx.c;
      if (c.age < 16) return 0;
      let p = 0.001 + (addiction(c, 'alcohol') / 100) * 0.02;
      if (c.stats.happiness < 25) p += 0.002;
      return odds(p);
    },
  },
  {
    id: 'ill-pneumonia',
    label: 'pneumonia',
    chronic: false,
    lethality: 0.015,
    healthHit: 15,
    treatCost: 2000,
    cureChance: 0.8,
    onsetWeight: (ctx: Ctx) => {
      const c = ctx.c;
      let p = c.age < 5 ? 0.0012 : 0.0006;
      if (c.age >= 60) p = 0.003 + (c.age - 60) * 0.0005;
      if (c.stats.health < 35) p *= 1.5;
      if (addiction(c, 'smoking') > 0) p *= 1.3;
      return odds(p);
    },
  },
  {
    id: 'ill-migraine',
    label: 'chronic migraines',
    chronic: true,
    lethality: 0.0005,
    healthHit: 3,
    treatCost: 200,
    cureChance: 0,
    onsetWeight: (ctx: Ctx) => {
      const c = ctx.c;
      if (c.age < 12) return 0;
      return odds(c.stats.happiness < 35 ? 0.0025 : 0.0012);
    },
  },
  {
    id: 'ill-back-pain',
    label: 'a bad back',
    chronic: false,
    lethality: 0.0005,
    healthHit: 4,
    treatCost: 500,
    cureChance: 0.4,
    onsetWeight: (ctx: Ctx) => {
      const c = ctx.c;
      if (c.age < 30) return 0;
      let p = 0.0012 + (c.age - 30) * 0.00008;
      if (trueFlag(c, 'gymRegular')) p *= 0.7;
      return odds(p);
    },
  },
  {
    id: 'ill-heart-disease',
    label: 'heart disease',
    chronic: true,
    lethality: 0.03,
    healthHit: 12,
    treatCost: 15000,
    cureChance: 0,
    onsetWeight: (ctx: Ctx) => {
      const c = ctx.c;
      if (c.age < 45) return 0;
      let p = 0.0012 + (c.age - 45) * 0.0002;
      if (addiction(c, 'smoking') > 0) p *= 1.8;
      if (trueFlag(c, 'gymRegular')) p *= 0.55;
      if (holds(c, 'ill-hypertension')) p *= 1.6;
      if (holds(c, 'ill-diabetes')) p *= 1.4;
      return odds(p);
    },
  },
  {
    id: 'ill-stroke',
    label: 'a stroke',
    chronic: false,
    lethality: 0.05,
    healthHit: 25,
    treatCost: 20000,
    cureChance: 0.5,
    onsetWeight: (ctx: Ctx) => {
      const c = ctx.c;
      if (c.age < 60) return 0;
      let p = 0.0018 + (c.age - 60) * 0.00018;
      // The pressure is the warning nobody takes seriously until this happens.
      if (holds(c, 'ill-hypertension')) p *= 3;
      if (addiction(c, 'smoking') > 0) p *= 1.5;
      return odds(p);
    },
  },
  {
    id: 'ill-cancer',
    label: 'cancer',
    chronic: false,
    lethality: 0.06,
    healthHit: 20,
    treatCost: 50000,
    cureChance: 0.35,
    onsetWeight: (ctx: Ctx) => {
      const c = ctx.c;
      let p = c.age < 30 ? 0.0002 : 0.0005 + (c.age - 30) * 0.00015;
      const smoking = addiction(c, 'smoking');
      if (smoking > 0) p *= 1.6 + smoking / 100;
      if (trueFlag(c, 'goodDiet')) p *= 0.85;
      return odds(p);
    },
  },
  {
    id: 'ill-dementia',
    label: 'dementia',
    chronic: true,
    lethality: 0.02,
    healthHit: 8,
    treatCost: 5000,
    cureChance: 0,
    onsetWeight: (ctx: Ctx) => {
      const c = ctx.c;
      if (c.age < 75) return 0;
      return odds(0.005 + (c.age - 75) * 0.0015);
    },
  },
];

/* ------------------------------------------------------------------ */
/* Treatment effects                                                   */
/* ------------------------------------------------------------------ */

/** How far one course of rehab moves a severity. */
const REHAB_STRENGTH = 45;

/** Puts every condition on the books under treatment. */
const treatEverything: Effect = {
  kind: 'fn',
  run: (ctx: EffectCtx) => {
    for (const illness of ctx.state.character.illnesses) illness.treated = true;
  },
};

/** Puts one named condition under treatment, if it is being carried at all. */
function treatOne(defId: string): Effect {
  return {
    kind: 'fn',
    run: (ctx: EffectCtx) => {
      const row = ctx.state.character.illnesses.find((illness) => illness.defId === defId);
      if (row) row.treated = true;
    },
  };
}

/** What a free clinic can manage: the first thing on the pile, at no charge. */
const treatFirstUntreated: Effect = {
  kind: 'fn',
  run: (ctx: EffectCtx) => {
    const row = ctx.state.character.illnesses.find((illness) => !illness.treated);
    if (row) row.treated = true;
  },
};

/**
 * Records a beaten addiction once the severity is actually gone.
 *
 * Ordered after the `{kind:'addiction'}` effect that does the work, because
 * `applyEffects` runs a list in order and deletes the key the moment the
 * severity clamps to zero — so this reads the result, never the intention.
 */
function markBeaten(which: AddictionKey): Effect {
  return {
    kind: 'fn',
    run: (ctx: EffectCtx) => {
      const severity = ctx.state.character.addictions[which];
      if (severity === undefined || !(severity > 0)) {
        ctx.state.character.flags['health:beatAddiction'] = true;
      }
    },
  };
}

/* ------------------------------------------------------------------ */
/* Interactions                                                        */
/* ------------------------------------------------------------------ */

/** The consultation fee, charged on top of whatever the chart says. */
const DOCTOR_FEE = 150;

const ADDICTION_NOUN: Record<AddictionKey, string> = {
  alcohol: 'drinking',
  smoking: 'smoking',
  gambling: 'gambling',
  drugs: 'the pills',
};

/**
 * One stay in rehab: expensive, slow, and the only thing that moves a severity
 * downward on purpose. Hidden entirely from anyone with nothing to quit.
 */
function rehab(id: string, which: AddictionKey, label: string, icon: string): InteractionDef {
  return {
    id,
    area: 'health',
    label,
    icon,
    cost: 6000,
    minAge: 14,
    cooldownYears: 2,
    condition: (ctx: Ctx) => free(ctx) && addiction(ctx.c, which) > 0,
    resolve: (ctx: Ctx) => {
      const before = addiction(ctx.c, which);
      const beat = before <= REHAB_STRENGTH;
      const noun = ADDICTION_NOUN[which];
      const text = beat
        ? `Thirty days, one duffel bag and a great deal of bad coffee. You walked out done with ${noun}.`
        : `Thirty days in. You still think about ${noun}, but not every hour of every day.`;
      return {
        text,
        effects: [
          { kind: 'addiction', which, delta: -REHAB_STRENGTH },
          markBeaten(which),
          { kind: 'stat', stat: 'happiness', delta: beat ? 6 : 2 },
          { kind: 'stat', stat: 'health', delta: 3 },
        ],
      };
    },
  };
}

const interactions: InteractionDef[] = [
  {
    id: 'act-doctor',
    area: 'health',
    label: 'See the Doctor',
    icon: '🩺',
    /* The visit plus the treatment cost of everything currently untreated.
       Pure arithmetic on state: `canUse` prices a row every time a sheet
       repaints, so this must never draw and never depend on the weather. */
    cost: (ctx: Ctx) => {
      let total = DOCTOR_FEE;
      for (const row of ctx.c.illnesses) {
        if (row.treated) continue;
        const def = findIllness(ctx.reg, row.defId);
        if (!def) continue;
        if (Number.isFinite(def.treatCost) && def.treatCost > 0) total += def.treatCost;
      }
      return total;
    },
    resolve: (ctx: Ctx) => {
      const sick = untreated(ctx.c);
      if (sick.length === 0) {
        // Two different empty charts: nothing wrong at all, or nothing left to start.
        const onTreatment = ctx.c.illnesses.length > 0;
        return {
          text: onTreatment
            ? 'Everything on your chart is already being treated. Keep taking the pills, said the doctor.'
            : 'The doctor found nothing wrong, told you to drink more water, and billed you for it.',
          effects: [{ kind: 'stat', stat: 'happiness', delta: onTreatment ? 1 : 2 }],
        };
      }
      const named = listOf(sick.map((row) => labelOf(ctx.reg, row.defId)));
      return {
        text: `The doctor went down the chart: ${named}. Treatment starts today.`,
        effects: [
          treatEverything,
          { kind: 'stat', stat: 'health', delta: 3 },
          { kind: 'stat', stat: 'happiness', delta: 3 },
        ],
      };
    },
  },
  {
    id: 'act-therapy',
    area: 'health',
    label: 'Therapy',
    icon: '🛋️',
    cost: 400,
    minAge: 10,
    cooldownYears: 1,
    resolve: (ctx: Ctx) => {
      const low = holds(ctx.c, 'ill-depression');
      const effects: Effect[] = [{ kind: 'stat', stat: 'happiness', delta: 7 }];
      if (low) effects.push(treatOne('ill-depression'), { kind: 'stat', stat: 'health', delta: 2 });
      return {
        text: low
          ? 'An hour a week, out loud, to someone paid to notice. The weight shifted a little.'
          : 'An hour of talking about yourself with no interruptions. Worth every cent.',
        effects,
      };
    },
  },
  {
    id: 'act-checkup',
    area: 'health',
    label: 'Annual Checkup',
    icon: '🧪',
    cost: 150,
    cooldownYears: 1,
    resolve: (ctx: Ctx) => {
      const c = ctx.c;
      /* The tip is whatever the chart actually says, so the list is built from
         state first and drawn from second. It is never empty: the last line is
         the one for a character with nothing at all to be told about. */
      const tips: string[] = [];
      if (c.stats.health < 40) {
        tips.push('The nurse read your numbers twice and asked whether you were sitting down.');
      }
      if (addiction(c, 'smoking') > 0) {
        tips.push('You were handed a pamphlet about your lungs. You folded it very small.');
      }
      if (addiction(c, 'alcohol') > 0) {
        tips.push('You were asked how many drinks a week. You gave the number everybody gives.');
      }
      if (!trueFlag(c, 'gymRegular')) {
        tips.push('"Walk somewhere. Anywhere," said the doctor, writing nothing down.');
      }
      if (!trueFlag(c, 'goodDiet')) {
        tips.push('You were advised to eat something green this decade.');
      }
      if (c.age >= 60) {
        tips.push('Everything still works. Some of it works slower than it used to.');
      }
      if (tips.length === 0) {
        tips.push('Blood pressure of a racehorse, said the doctor, and meant it kindly.');
      }
      return {
        text: ctx.rng.pick(tips),
        effects: [{ kind: 'stat', stat: 'happiness', delta: 2 }],
      };
    },
  },
  rehab('act-rehab-alcohol', 'alcohol', 'Rehab: Drinking', '🍺'),
  rehab('act-rehab-smoking', 'smoking', 'Rehab: Smoking', '🚬'),
  rehab('act-rehab-gambling', 'gambling', 'Rehab: Gambling', '🎰'),
  rehab('act-rehab-drugs', 'drugs', 'Rehab: Pills', '💊'),
  {
    id: 'act-meditation',
    area: 'health',
    label: 'Meditate',
    icon: '🧘',
    /* Old enough to sit still on purpose, the age `activities.ts` gates its own
       `act-meditate` at. `canUse` falls back to `minAge ?? 0`, so ungated this
       row — free, and on no cooldown — was offered from birth: a dozen taps
       took a newborn to 100 happiness before the first Age Up. */
    minAge: 8,
    cooldownYears: 0,
    resolve: (ctx: Ctx) => ({
      text: ctx.rng.pick([
        'Twenty minutes of sitting still. Your brain fought you for eighteen of them.',
        'You breathed in for four and out for six until the day stopped shouting.',
        'You meditated. Mostly you planned dinner, but calmly.',
      ]),
      effects: [{ kind: 'stat', stat: 'happiness', delta: 3 }],
    }),
  },
];

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

/** What the church hall counts as being able to pay for a doctor yourself. */
const CLINIC_MEANS_TEST = 5000;

const events: EventDef[] = [
  {
    id: 'ev-health-flu-season',
    area: 'health',
    icon: '🤧',
    minAge: 0,
    maxAge: 120,
    weight: 3,
    condition: (ctx: Ctx) => !holds(ctx.c, 'ill-flu'),
    text: 'Flu season went through {country} like a truck. It found you.',
    effects: [
      { kind: 'illness', add: 'ill-flu' },
      { kind: 'stat', stat: 'happiness', delta: -3 },
    ],
  },
  {
    id: 'ev-health-gym-injury',
    area: 'health',
    icon: '🏋️',
    minAge: 14,
    maxAge: 120,
    weight: 4,
    condition: (ctx: Ctx) => trueFlag(ctx.c, 'gymRegular') && free(ctx),
    text: 'Something in your shoulder popped on the last rep.',
    choices: [
      {
        label: 'Finish the set',
        outcomes: [
          {
            weight: 3,
            text: 'You finished the set and paid for it for a month.',
            effects: [
              { kind: 'stat', stat: 'health', delta: -6 },
              { kind: 'stat', stat: 'happiness', delta: -2 },
            ],
          },
          {
            weight: 2,
            text: 'You finished the set and felt briefly immortal.',
            effects: [
              { kind: 'stat', stat: 'health', delta: 2 },
              { kind: 'stat', stat: 'happiness', delta: 4 },
            ],
          },
          {
            weight: 1,
            text: 'Something gave way. The x-ray showed a crack you could see from the doorway.',
            effects: [
              { kind: 'illness', add: 'ill-broken-bone' },
              { kind: 'stat', stat: 'health', delta: -6 },
            ],
          },
        ],
      },
      {
        label: 'Rack it and go home',
        outcomes: [
          {
            weight: 4,
            text: 'You racked it, iced it, and were fine inside a week.',
            effects: [{ kind: 'stat', stat: 'health', delta: -1 }],
          },
          {
            weight: 2,
            text: 'Two weeks off. You came back stronger and smugger.',
            effects: [
              { kind: 'stat', stat: 'health', delta: 3 },
              { kind: 'stat', stat: 'happiness', delta: 2 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-health-scare',
    area: 'health',
    icon: '🩻',
    minAge: 40,
    maxAge: 120,
    weight: 4,
    condition: free,
    text: 'A scan found a shadow. Two weeks of not sleeping later, a second scan found nothing at all.',
    effects: [
      { kind: 'stat', stat: 'happiness', delta: -3 },
      { kind: 'stat', stat: 'health', delta: -1 },
      { kind: 'money', delta: -250 },
    ],
  },
  {
    id: 'ev-health-free-clinic',
    area: 'health',
    icon: '🏥',
    minAge: 0,
    maxAge: 120,
    weight: 4,
    /* A free clinic is for people who need one, and needs a door to walk
       through, so it asks all three of `free`, something to treat and a means
       test. Ungated at 0-120 it was the pack's largest leak: nothing in the
       engine ever clears `Illness.treated`, and `deathProbability` charges a
       treated row `lethality * 0.5` against an untreated `lethality * 2`, so a
       single draw quartered the hazard of a chronic condition — permanently,
       for nothing, to a character who could have paid `act-doctor` for it.
       The `health +3` went with it: what this card is worth is the
       prescription, and a well millionaire now queues for neither. */
    condition: (ctx: Ctx) =>
      free(ctx) && (untreated(ctx.c).length > 0 || ctx.c.money < CLINIC_MEANS_TEST),
    text: (ctx: Ctx) =>
      untreated(ctx.c).length > 0
        ? 'A free clinic set up in the church hall. You queued three hours and left with a prescription.'
        : 'A free clinic set up in the church hall. You got a shot, a lollipop and a clean bill of health.',
    effects: [treatFirstUntreated, { kind: 'stat', stat: 'happiness', delta: 2 }],
  },
  {
    id: 'ev-health-insomnia',
    area: 'health',
    icon: '🌙',
    minAge: 12,
    maxAge: 120,
    weight: 5,
    /* The adult pack shipped the same bad week at 18-64 on slightly harsher
       numbers, which billed one bout twice for half a life. A body loses sleep
       at any age and in any bed, so this is the copy that survived — ungated,
       for the whole life — and the other telling folded in here. */
    text: (ctx: Ctx) =>
      `You did not sleep properly for a week. ${ctx.rng.pick([
        'The ceiling has 412 tiles.',
        'Everything got harder.',
      ])}`,
    effects: [
      { kind: 'stat', stat: 'health', delta: -2 },
      { kind: 'stat', stat: 'happiness', delta: -3 },
      { kind: 'stat', stat: 'smarts', delta: -1 },
    ],
  },
  {
    id: 'ev-health-allergies',
    area: 'health',
    icon: '🌼',
    minAge: 0,
    maxAge: 120,
    weight: 5,
    text: 'Everything bloomed at once. Your face disagreed with all of it.',
    effects: [
      { kind: 'stat', stat: 'health', delta: -1 },
      { kind: 'stat', stat: 'happiness', delta: -2 },
      { kind: 'stat', stat: 'looks', delta: -1 },
    ],
  },
  {
    id: 'ev-health-dentist',
    area: 'health',
    icon: '🦷',
    minAge: 8,
    maxAge: 120,
    weight: 4,
    condition: free,
    text: 'A back tooth has started sending signals.',
    choices: [
      {
        label: 'Get it fixed',
        outcomes: [
          {
            weight: 1,
            text: 'One filling, one bill, no more signals.',
            effects: [
              { kind: 'money', delta: -400 },
              { kind: 'stat', stat: 'health', delta: 2 },
              { kind: 'stat', stat: 'looks', delta: 1 },
            ],
          },
        ],
      },
      {
        label: 'Ignore it',
        outcomes: [
          {
            weight: 3,
            text: 'It settled down on its own. Probably fine.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: 1 }],
          },
          {
            weight: 3,
            text: 'It got worse. The fix cost triple and took two visits.',
            effects: [
              { kind: 'money', delta: -1200 },
              { kind: 'stat', stat: 'health', delta: -3 },
              { kind: 'stat', stat: 'looks', delta: -2 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-health-flu-shot',
    area: 'health',
    icon: '💉',
    minAge: 5,
    maxAge: 120,
    weight: 4,
    condition: free,
    text: 'The pharmacy is doing flu shots for thirty dollars, no appointment.',
    choices: [
      {
        label: 'Get the shot',
        outcomes: [
          {
            weight: 4,
            text: 'One sore arm, one uneventful winter.',
            effects: [
              { kind: 'money', delta: -30 },
              { kind: 'stat', stat: 'health', delta: 2 },
            ],
          },
          {
            weight: 1,
            text: 'You went pale in the queue and were sat down with a juice box.',
            effects: [
              { kind: 'money', delta: -30 },
              { kind: 'stat', stat: 'happiness', delta: -2 },
              { kind: 'stat', stat: 'health', delta: 1 },
            ],
          },
        ],
      },
      {
        label: 'Skip it',
        outcomes: [
          {
            weight: 3,
            text: 'You skipped it and got away with it.',
            effects: [{ kind: 'stat', stat: 'happiness', delta: 1 }],
          },
          {
            weight: 2,
            text: 'You skipped it. Winter had other plans.',
            effects: [
              { kind: 'illness', add: 'ill-flu' },
              { kind: 'stat', stat: 'happiness', delta: -2 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'ev-health-back-tweak',
    area: 'health',
    icon: '🧊',
    minAge: 30,
    maxAge: 120,
    weight: 4,
    text: 'You bent down for a dropped fork and your back had opinions about it.',
    effects: [
      { kind: 'stat', stat: 'health', delta: -3 },
      { kind: 'stat', stat: 'happiness', delta: -2 },
    ],
  },
];

/** Illness definitions, treatments and the doctor/clinic interactions. */
export const healthPack: ContentPack = {
  id: 'health',
  illnesses,
  interactions,
  events,
};
