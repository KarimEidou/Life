import type { ContentPack, JobDef } from '@/types';

/**
 * Entry-level, part-time and trade career tracks that need no degree.
 *
 * Three shapes live here.
 *
 * Part-time work (`isPartTime`) is deliberately a dead end: no `promotesTo`, so
 * `rollPromotion` can never lift a teenager out of a paper route into a career.
 * It exists to put the first few thousand in a kid's pocket, and it is the only
 * paid thing anyone under 16 can do.
 *
 * The four ladders — service, trades, office, business — are entered at level 1
 * and climbed by performance. Every rung above the first names its predecessor
 * in `req.prevJobId`, which gates *applying* to it; promotion is decided by
 * `careerPhase` and ignores `req` entirely, so a fast food crew member who works
 * hard becomes a shift lead without ever meeting the diploma requirement, while
 * someone applying cold off the street still has to bring one.
 *
 * `req.education` never asks for more than a high school diploma at the bottom
 * of a ladder: the degree-gated professions are the professional pack's job.
 * The office and business ladders ask for a degree at their upper rungs only,
 * which is what makes a graduate's cold application to those seats plausible and
 * a dropout's climb into them slow but possible.
 */

const jobs: JobDef[] = [
  /* --- Part-time: no track to climb, no education gate, small money. --- */
  {
    id: 'job-paper-route',
    track: 'part-time',
    title: 'Paper Carrier',
    icon: '📰',
    level: 1,
    baseSalary: 1200,
    raisePct: 0.02,
    req: { minAge: 12 },
    isPartTime: true,
  },
  {
    id: 'job-babysitter',
    track: 'part-time',
    title: 'Babysitter',
    icon: '🍼',
    level: 2,
    baseSalary: 2200,
    raisePct: 0.02,
    req: { minAge: 14 },
    isPartTime: true,
  },
  {
    id: 'job-barista-pt',
    track: 'part-time',
    title: 'Barista (Part-Time)',
    icon: '☕',
    level: 3,
    baseSalary: 6500,
    raisePct: 0.03,
    req: { minAge: 16 },
    isPartTime: true,
  },

  /* --- Service: the ladder anyone can start at 16 with nothing at all. --- */
  {
    id: 'job-fastfood',
    track: 'service',
    title: 'Fast Food Crew',
    icon: '🍔',
    level: 1,
    baseSalary: 19000,
    raisePct: 0.02,
    req: { minAge: 16 },
    promotesTo: 'job-shift-lead',
  },
  {
    id: 'job-shift-lead',
    track: 'service',
    title: 'Shift Lead',
    icon: '📋',
    level: 2,
    baseSalary: 26000,
    raisePct: 0.03,
    req: { minAge: 18, education: 'high', prevJobId: 'job-fastfood' },
    promotesTo: 'job-store-manager',
  },
  {
    id: 'job-store-manager',
    track: 'service',
    title: 'Store Manager',
    icon: '🏪',
    level: 3,
    baseSalary: 40000,
    raisePct: 0.03,
    req: { minAge: 21, education: 'high', minSmarts: 45, prevJobId: 'job-shift-lead' },
  },

  /* --- Trades: the longest no-degree climb, and the best paid one. --- */
  {
    id: 'job-apprentice',
    track: 'trades',
    title: 'Trade Apprentice',
    icon: '🔧',
    level: 1,
    baseSalary: 24000,
    raisePct: 0.03,
    req: { minAge: 18, education: 'high' },
    promotesTo: 'job-electrician',
  },
  {
    id: 'job-electrician',
    track: 'trades',
    title: 'Electrician',
    icon: '⚡',
    level: 2,
    baseSalary: 48000,
    raisePct: 0.03,
    req: { minAge: 20, education: 'high', minSmarts: 40, prevJobId: 'job-apprentice' },
    promotesTo: 'job-master-electrician',
  },
  {
    id: 'job-master-electrician',
    track: 'trades',
    title: 'Master Electrician',
    icon: '💡',
    level: 3,
    baseSalary: 62000,
    raisePct: 0.03,
    req: { minAge: 24, education: 'high', prevJobId: 'job-electrician' },
    promotesTo: 'job-contractor',
  },
  {
    id: 'job-contractor',
    track: 'trades',
    title: 'General Contractor',
    icon: '🏗️',
    level: 4,
    baseSalary: 85000,
    raisePct: 0.03,
    req: { minAge: 28, education: 'high', minSmarts: 55, prevJobId: 'job-master-electrician' },
  },

  /* --- Office: cheap to enter, and the rungs get fussier about paper. --- */
  {
    id: 'job-clerk',
    track: 'office',
    title: 'Office Clerk',
    icon: '🗄️',
    level: 1,
    baseSalary: 30000,
    raisePct: 0.02,
    req: { minAge: 18, education: 'high' },
    promotesTo: 'job-analyst',
  },
  {
    id: 'job-analyst',
    track: 'office',
    title: 'Analyst',
    icon: '📊',
    level: 2,
    baseSalary: 52000,
    raisePct: 0.03,
    // Any degree will do; the professional pack owns the major-gated seats.
    req: { minAge: 21, education: 'university', minSmarts: 55, prevJobId: 'job-clerk' },
    promotesTo: 'job-office-manager',
  },
  {
    id: 'job-office-manager',
    track: 'office',
    title: 'Office Manager',
    icon: '🗂️',
    level: 3,
    baseSalary: 72000,
    raisePct: 0.03,
    req: { minAge: 25, education: 'university', minSmarts: 60, prevJobId: 'job-analyst' },
    promotesTo: 'job-director',
  },
  {
    id: 'job-director',
    track: 'office',
    title: 'Director of Operations',
    icon: '🏢',
    level: 4,
    baseSalary: 120000,
    raisePct: 0.04,
    req: { minAge: 30, education: 'university', minSmarts: 70, prevJobId: 'job-office-manager' },
  },

  /* --- Business: commission work. Charm is part of the hiring gate. --- */
  {
    id: 'job-sales-rep',
    track: 'business',
    title: 'Sales Rep',
    icon: '🤝',
    level: 1,
    baseSalary: 34000,
    raisePct: 0.03,
    req: { minAge: 18, education: 'high', minLooks: 40 },
    promotesTo: 'job-account-exec',
  },
  {
    id: 'job-account-exec',
    track: 'business',
    title: 'Account Executive',
    icon: '📞',
    level: 2,
    baseSalary: 60000,
    raisePct: 0.03,
    req: { minAge: 22, education: 'university', prevJobId: 'job-sales-rep' },
    promotesTo: 'job-sales-vp',
  },
  {
    id: 'job-sales-vp',
    track: 'business',
    title: 'VP of Sales',
    icon: '💼',
    level: 3,
    baseSalary: 150000,
    raisePct: 0.04,
    req: { minAge: 30, education: 'university', minSmarts: 65, prevJobId: 'job-account-exec' },
  },
];

/** Entry-level, part-time and trade career tracks that need no degree. */
export const jobsOrdinaryPack: ContentPack = {
  id: 'jobs-ordinary',
  jobs,
};
