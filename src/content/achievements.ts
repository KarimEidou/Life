/**
 * Cross-life achievements and the state checks that unlock them.
 *
 * `AchievementDef.check` is handed the whole `GameState` and nothing else — no
 * registry, no context — so every test here reads state directly and defends
 * itself: a check runs against saves written by older builds, flags other packs
 * own, and lives that ended halfway through a year. The engine treats a throwing
 * check as a miss, but a check that quietly reads a string as a number is worse
 * than one that fails loudly, so the flag readers below are strict about types.
 */

import { netWorth } from '@/engine/wealth';
import type { AchievementDef, Character, ContentPack, GameState, Person, RelKind } from '@/types';

/** Flags are free-form JSON; only a genuine finite number counts as one. */
function numFlag(c: Character, key: string): number {
  const raw = c.flags[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

/** Strict `=== true`: a truthy string or a 1 is not the marker a pack set. */
function trueFlag(c: Character, key: string): boolean {
  return c.flags[key] === true;
}

function strFlag(c: Character, key: string): string {
  const raw = c.flags[key];
  return typeof raw === 'string' ? raw : '';
}

function countPeople(state: GameState, match: (p: Person) => boolean): number {
  return Object.values(state.people).filter(match).length;
}

function countKind(state: GameState, kind: RelKind, aliveOnly: boolean): number {
  return countPeople(state, (p) => p.kind === kind && (!aliveOnly || p.alive));
}

/** How many owned assets came from a def in one family, e.g. `prop-` or `veh-`. */
function countAssets(state: GameState, prefix: string): number {
  return state.character.assets.filter(
    (asset) => typeof asset.defId === 'string' && asset.defId.startsWith(prefix)
  ).length;
}

/**
 * True once the life is being lived somewhere other than where it began.
 *
 * `emigration:done` is the marker the emigration pack sets, and it is the
 * primary test. The fallback exists because the engine's own `emigrateTo` moves
 * a character without running any content code: it stamps `lastVisaAge` (paid
 * whether or not the visa lands) and overwrites `countryLabel`, and the only
 * record of where the life started is the birth line the log opens with. So a
 * visa applicant whose birth line no longer names the country they live in has
 * moved. A legacy heir's log opens with a different sentence, which is why the
 * line is required to be a birth line — the check goes quiet rather than
 * guessing.
 *
 * The country slot is matched whole, as `emigration.ts::abroad` matches it:
 * `includes` would read a character surnamed `France` who moved to France as
 * still living where she was born, and lock her out of the achievement for good.
 */
function movedCountry(state: GameState): boolean {
  const c = state.character;
  if (c.flags['emigration:done'] === true) return true;
  if (typeof c.flags.lastVisaAge !== 'number') return false;
  const label = strFlag(c, 'countryLabel');
  if (label === '') return false;
  const opening = state.log[0]?.entries[0]?.text ?? '';
  if (!opening.startsWith('You were born')) return false;
  return !opening.endsWith(` in ${label}.`);
}

/**
 * Career tracks live on `JobDef`, which a check cannot reach, so the job is
 * identified by the two strings `JobState` does carry: its def id and its title.
 */
function jobLooksLike(state: GameState, pattern: RegExp): boolean {
  const job = state.character.job;
  if (!job) return false;
  return pattern.test(job.jobId) || pattern.test(job.title);
}

const achievements: AchievementDef[] = [
  {
    id: 'ach-centenarian',
    label: 'Centenarian',
    desc: 'Reach 100. The cake is mostly candles.',
    icon: '🎂',
    check: (state) => state.character.age >= 100,
  },
  {
    id: 'ach-millionaire',
    label: 'Millionaire',
    desc: 'Be worth a million on paper.',
    icon: '💰',
    check: (state) => netWorth(state) >= 1_000_000,
  },
  {
    id: 'ach-deca-millionaire',
    label: 'Deca-Millionaire',
    desc: 'Ten million. The first one was the hard one.',
    icon: '🏦',
    check: (state) => netWorth(state) >= 10_000_000,
  },
  {
    id: 'ach-doctor',
    label: 'Doctor',
    desc: 'Finish medical school, or get the white coat some other way.',
    icon: '🩺',
    check: (state) =>
      strFlag(state.character, 'postgradId') === 'med-school' ||
      jobLooksLike(state, /doctor|surgeon|physician/i),
  },
  {
    id: 'ach-lawyer',
    label: 'Lawyer',
    desc: 'Survive law school. Billable hours are their own reward.',
    icon: '⚖️',
    check: (state) => strFlag(state.character, 'postgradId') === 'law-school',
  },
  {
    id: 'ach-general',
    label: 'General',
    desc: 'Reach the top of the military ladder.',
    icon: '🎖️',
    check: (state) => {
      const job = state.character.job;
      return job !== null && (job.jobId === 'job-general' || job.title === 'General');
    },
  },
  {
    id: 'ach-superstar',
    label: 'Superstar',
    desc: 'Hit 90 fame. Strangers know your coffee order.',
    icon: '🌟',
    check: (state) => state.character.fame >= 90,
  },
  {
    id: 'ach-jailbird',
    label: 'Jailbird',
    desc: 'Collect your first conviction.',
    icon: '🚔',
    check: (state) => numFlag(state.character, 'convictions') >= 1,
  },
  {
    id: 'ach-escape-artist',
    label: 'Escape Artist',
    desc: 'Leave prison the unofficial way.',
    icon: '🪜',
    secret: true,
    check: (state) => trueFlag(state.character, 'crime:escaped'),
  },
  {
    id: 'ach-jackpot',
    label: 'Jackpot',
    desc: 'Hit the big one at the casino.',
    icon: '🎰',
    secret: true,
    check: (state) => trueFlag(state.character, 'casino:jackpot'),
  },
  {
    id: 'ach-golden-couple',
    label: 'Golden Couple',
    desc: 'Fifty years married and still on speaking terms.',
    icon: '💞',
    check: (state) => {
      const c = state.character;
      const spouse = Object.values(state.people).find(
        (p) => p.alive && p.kind === 'spouse' && p.rel >= 80
      );
      if (!spouse) return false;
      const weddingAge = c.flags['rel:weddingAge'];
      if (typeof weddingAge !== 'number' || !Number.isFinite(weddingAge)) return false;
      return c.age - weddingAge >= 50;
    },
  },
  {
    id: 'ach-full-house',
    label: 'Full House',
    desc: 'Four living children. Dinner is a logistics problem.',
    icon: '👨‍👩‍👧‍👦',
    check: (state) => countKind(state, 'child', true) >= 4,
  },
  {
    id: 'ach-generation-3',
    label: 'Third Generation',
    desc: 'Carry the family line to a third life.',
    icon: '🌳',
    check: (state) => state.generation >= 3,
  },
  {
    id: 'ach-world-citizen',
    label: 'World Citizen',
    desc: 'Emigrate and start over somewhere else.',
    icon: '🌍',
    check: (state) => movedCountry(state),
  },
  {
    id: 'ach-homeowner',
    label: 'Homeowner',
    desc: 'Buy a place of your own. The bank owns most of it.',
    icon: '🏠',
    check: (state) => countAssets(state, 'prop-') >= 1,
  },
  {
    id: 'ach-car-collector',
    label: 'Car Collector',
    desc: 'Own five vehicles at once. Nowhere left to park.',
    icon: '🚗',
    check: (state) => countAssets(state, 'veh-') >= 5,
  },
  {
    id: 'ach-straight-a',
    label: 'Straight A Student',
    desc: 'Hold a 3.9 GPA while enrolled.',
    icon: '📗',
    check: (state) => {
      const ed = state.character.education;
      return ed.enrolledIn !== undefined && ed.gpa >= 3.9;
    },
  },
  {
    id: 'ach-sober',
    label: 'Sober',
    desc: 'Beat an addiction for good.',
    icon: '🍵',
    check: (state) => trueFlag(state.character, 'health:beatAddiction'),
  },
  {
    id: 'ach-gym-rat',
    label: 'Gym Rat',
    desc: 'Still a gym regular at 40.',
    icon: '🏋️',
    check: (state) => trueFlag(state.character, 'gymRegular') && state.character.age >= 40,
  },
  {
    id: 'ach-bookworm',
    label: 'Bookworm',
    desc: 'Read twenty books in one lifetime.',
    icon: '📚',
    check: (state) => numFlag(state.character, 'act:booksRead') >= 20,
  },
  {
    id: 'ach-heartbreaker',
    label: 'Heartbreaker',
    desc: 'Leave five exes in your wake.',
    icon: '💔',
    check: (state) => countKind(state, 'ex', false) >= 5,
  },
  {
    id: 'ach-lottery-winner',
    label: 'Lottery Winner',
    desc: 'Beat odds nobody sensible plays.',
    icon: '🎟️',
    check: (state) => trueFlag(state.character, 'casino:lotteryWin'),
  },
  {
    id: 'ach-rock-bottom',
    label: 'Rock Bottom',
    desc: 'Go bankrupt. Everything from here is up.',
    icon: '📉',
    secret: true,
    check: (state) => trueFlag(state.character, 'bankrupt'),
  },
  {
    id: 'ach-peaceful-end',
    label: 'Peaceful End',
    desc: 'Die past 90 still in decent health.',
    icon: '🕊️',
    check: (state) => {
      const death = state.death;
      return death !== undefined && death.age >= 90 && state.character.stats.health >= 50;
    },
  },
];

/** Cross-life achievements and the state checks that unlock them. */
export const achievementsPack: ContentPack = {
  id: 'achievements',
  achievements,
};
