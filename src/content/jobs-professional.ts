import type { ContentPack, JobDef } from '@/types';

/**
 * The degree-gated professions: medicine, law, engineering, the military and
 * show business.
 *
 * Where the ordinary pack sells jobs anyone can walk into, everything here is
 * bought with something scarce — a postgraduate degree, a specific undergrad
 * major, a smarts or looks score most characters never reach, or twenty years of
 * service. That is the whole design: these ladders are the payoff for the
 * expensive choices made at 18, and the salaries below are balance, not flavour.
 *
 * Three rules shape every `req` here.
 *
 * `req` gates *applying*, never promoting — `rollPromotion` reads `promotesTo`
 * and nothing else. So an intern who works hard becomes a resident on merit,
 * while someone applying cold to the same seat still has to bring the diploma.
 * That asymmetry is why every rung above the first repeats its ladder's
 * education, major and smarts gate instead of leaning on `prevJobId` alone: the
 * refusal a cold applicant reads should name the real obstacle.
 *
 * Stat gates only ever ratchet up a ladder. Where a rung specifies no minimum of
 * its own it inherits the highest one below it, so no rung is ever easier to
 * apply to than the one it sits on top of.
 *
 * `req.majors` is checked against `Character.education.major`, which is the
 * *undergraduate* major and is set only on university enrolment. Medicine and law
 * therefore ask for the same majors their postgrad programme accepts — a doctor
 * still reads as a biology graduate years after med school.
 *
 * One rule shapes the salaries, and it falls out of the asymmetry above.
 * `rollPromotion` floors a promotion at the salary already earned, but
 * `applyForJob` writes `baseSalary` flat — and because every rung above the
 * first names a `prevJobId`, the only character who can apply for it is the
 * holder of the rung below. So a rung paying less than the one under it charges
 * a pay cut for the climb the career sheet advertises: pay never falls up a
 * ladder. `__tests__/jobs-ladders.test.ts` holds that across both job packs.
 */

const jobs: JobDef[] = [
  /* --- Medicine: the longest, most expensive and best-paid climb in the game.
     Med school only accepts biology and nursing, so the major gate below is the
     same one `med-school` applies at enrolment. --- */
  {
    id: 'job-med-intern',
    track: 'medicine',
    title: 'Medical Intern',
    icon: '🩺',
    level: 1,
    baseSalary: 58000,
    raisePct: 0.05,
    req: { education: 'postgrad', majors: ['biology', 'nursing'], minSmarts: 70 },
    promotesTo: 'job-resident',
  },
  {
    id: 'job-resident',
    track: 'medicine',
    title: 'Resident',
    icon: '🏥',
    level: 2,
    baseSalary: 75000,
    raisePct: 0.05,
    req: {
      education: 'postgrad',
      majors: ['biology', 'nursing'],
      minSmarts: 70,
      prevJobId: 'job-med-intern',
    },
    promotesTo: 'job-doctor',
  },
  {
    id: 'job-doctor',
    track: 'medicine',
    title: 'Doctor',
    icon: '🧑‍⚕️',
    level: 3,
    baseSalary: 150000,
    raisePct: 0.04,
    req: {
      education: 'postgrad',
      majors: ['biology', 'nursing'],
      minSmarts: 70,
      prevJobId: 'job-resident',
    },
    promotesTo: 'job-surgeon',
  },
  {
    id: 'job-surgeon',
    track: 'medicine',
    title: 'Surgeon',
    icon: '🫀',
    level: 4,
    baseSalary: 290000,
    raisePct: 0.04,
    req: {
      education: 'postgrad',
      majors: ['biology', 'nursing'],
      minSmarts: 80,
      prevJobId: 'job-doctor',
    },
    promotesTo: 'job-chief-medicine',
  },
  {
    id: 'job-chief-medicine',
    track: 'medicine',
    title: 'Chief of Medicine',
    icon: '⚕️',
    level: 5,
    baseSalary: 420000,
    raisePct: 0.03,
    req: {
      education: 'postgrad',
      majors: ['biology', 'nursing'],
      minSmarts: 80,
      prevJobId: 'job-surgeon',
    },
  },

  /* --- Law: the one ladder whose bottom rung takes a bachelor's. The jump from
     paralegal to associate is where law school gets paid for. --- */
  {
    id: 'job-paralegal',
    track: 'law',
    title: 'Paralegal',
    icon: '📁',
    level: 1,
    baseSalary: 42000,
    raisePct: 0.03,
    req: { education: 'university', majors: ['polisci', 'business', 'psychology'] },
    promotesTo: 'job-associate',
  },
  {
    id: 'job-associate',
    track: 'law',
    title: 'Law Associate',
    icon: '📜',
    level: 2,
    baseSalary: 95000,
    raisePct: 0.05,
    req: {
      education: 'postgrad',
      majors: ['polisci', 'business', 'psychology'],
      minSmarts: 65,
      prevJobId: 'job-paralegal',
    },
    promotesTo: 'job-law-partner',
  },
  {
    id: 'job-law-partner',
    track: 'law',
    title: 'Law Partner',
    icon: '🖋️',
    level: 3,
    baseSalary: 240000,
    raisePct: 0.04,
    req: {
      education: 'postgrad',
      majors: ['polisci', 'business', 'psychology'],
      minSmarts: 65,
      prevJobId: 'job-associate',
    },
    promotesTo: 'job-judge',
  },
  {
    /* The top of the ladder, and the rung the salary rule above bites hardest
       for: `prevJobId` means every cold applicant is a partner already earning
       240k, and `applyForJob` writes this number straight over that. The minAge
       gates that cold application; a lifer promoted onto the bench early is the
       rare career the engine allows and the story is better for it. */
    id: 'job-judge',
    track: 'law',
    title: 'Judge',
    icon: '⚖️',
    level: 4,
    baseSalary: 260000,
    raisePct: 0.03,
    req: {
      minAge: 45,
      education: 'postgrad',
      majors: ['polisci', 'business', 'psychology'],
      minSmarts: 65,
      prevJobId: 'job-law-partner',
    },
  },

  /* --- Engineering: no postgrad anywhere, so it is the fastest route to real
     money for a smart 22-year-old. The CTO seat is the smarts wall. --- */
  {
    id: 'job-junior-eng',
    track: 'engineering',
    title: 'Junior Engineer',
    icon: '🧑‍💻',
    level: 1,
    baseSalary: 70000,
    raisePct: 0.05,
    req: { education: 'university', majors: ['cs', 'engineering'], minSmarts: 60 },
    promotesTo: 'job-senior-eng',
  },
  {
    id: 'job-senior-eng',
    track: 'engineering',
    title: 'Senior Engineer',
    icon: '💻',
    level: 2,
    baseSalary: 105000,
    raisePct: 0.04,
    req: {
      education: 'university',
      majors: ['cs', 'engineering'],
      minSmarts: 60,
      prevJobId: 'job-junior-eng',
    },
    promotesTo: 'job-principal-eng',
  },
  {
    id: 'job-principal-eng',
    track: 'engineering',
    title: 'Principal Engineer',
    icon: '🖥️',
    level: 3,
    baseSalary: 150000,
    raisePct: 0.04,
    req: {
      education: 'university',
      majors: ['cs', 'engineering'],
      minSmarts: 60,
      prevJobId: 'job-senior-eng',
    },
    promotesTo: 'job-cto',
  },
  {
    id: 'job-cto',
    track: 'engineering',
    title: 'CTO',
    icon: '🚀',
    level: 4,
    baseSalary: 300000,
    raisePct: 0.04,
    req: {
      education: 'university',
      majors: ['cs', 'engineering'],
      minSmarts: 78,
      prevJobId: 'job-principal-eng',
    },
  },

  /* --- Military: enlists a high school graduate at 18 and asks for a degree
     only at the commission. Stars come with fame; the pay never catches
     medicine. --- */
  {
    id: 'job-recruit',
    track: 'military',
    title: 'Recruit',
    icon: '🪖',
    level: 1,
    baseSalary: 28000,
    raisePct: 0.03,
    req: { minAge: 18, education: 'high' },
    promotesTo: 'job-sergeant',
  },
  {
    id: 'job-sergeant',
    track: 'military',
    title: 'Sergeant',
    icon: '🎖️',
    level: 2,
    baseSalary: 42000,
    raisePct: 0.03,
    req: { minAge: 18, education: 'high', prevJobId: 'job-recruit' },
    promotesTo: 'job-officer',
  },
  {
    id: 'job-officer',
    track: 'military',
    title: 'Officer',
    icon: '🫡',
    level: 3,
    baseSalary: 68000,
    raisePct: 0.04,
    req: { minAge: 18, education: 'university', prevJobId: 'job-sergeant' },
    promotesTo: 'job-general',
  },
  {
    id: 'job-general',
    track: 'military',
    title: 'General',
    icon: '⭐',
    level: 4,
    baseSalary: 160000,
    raisePct: 0.03,
    req: {
      minAge: 45,
      education: 'university',
      minSmarts: 65,
      prevJobId: 'job-officer',
    },
    fameGain: 5,
  },

  /* --- Entertainment: two ladders in one track, both open at 16 with no
     schooling at all, both paying nothing until the top rung pays everything.
     Looks are the gate the other tracks never ask for, and `fameGain` fires on
     promotion, so the fame is earned on the way up rather than bought at the
     door. --- */
  {
    id: 'job-extra',
    track: 'entertainment',
    title: 'Movie Extra',
    icon: '🎬',
    level: 1,
    baseSalary: 15000,
    raisePct: 0.03,
    req: { minAge: 16 },
    promotesTo: 'job-actor',
  },
  {
    id: 'job-actor',
    track: 'entertainment',
    title: 'Actor',
    icon: '🎭',
    level: 2,
    baseSalary: 55000,
    raisePct: 0.05,
    req: { minAge: 16, minLooks: 60, prevJobId: 'job-extra' },
    promotesTo: 'job-movie-star',
    fameGain: 5,
  },
  {
    id: 'job-movie-star',
    track: 'entertainment',
    title: 'Movie Star',
    icon: '🌟',
    level: 3,
    baseSalary: 400000,
    raisePct: 0.05,
    req: { minAge: 18, minLooks: 75, prevJobId: 'job-actor' },
    fameGain: 20,
  },
  {
    id: 'job-busker',
    track: 'entertainment',
    title: 'Busker',
    icon: '🎸',
    level: 1,
    baseSalary: 8000,
    raisePct: 0.03,
    req: { minAge: 16 },
    promotesTo: 'job-musician',
  },
  {
    id: 'job-musician',
    track: 'entertainment',
    title: 'Musician',
    icon: '🎵',
    level: 2,
    baseSalary: 30000,
    raisePct: 0.04,
    req: { minAge: 16, prevJobId: 'job-busker' },
    promotesTo: 'job-pop-star',
    fameGain: 5,
  },
  {
    id: 'job-pop-star',
    track: 'entertainment',
    title: 'Pop Star',
    icon: '🎤',
    level: 3,
    baseSalary: 350000,
    raisePct: 0.05,
    req: { minAge: 18, minLooks: 60, prevJobId: 'job-musician' },
    fameGain: 20,
  },
];

/** Degree-gated career tracks: medicine, law, engineering, the military and fame. */
export const jobsProfessionalPack: ContentPack = {
  id: 'jobs-professional',
  jobs,
};
