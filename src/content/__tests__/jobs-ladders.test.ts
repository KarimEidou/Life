import { beforeEach, describe, expect, it } from 'vitest';

import { getRegistry, resetRegistryForTests } from '@/content';
import { buildRegistry, validateRegistry } from '@/engine/registry';
import type { ContentPack, ContentRegistry, JobDef } from '@/types';

/**
 * The career ladders, held to one rule: the climb is never a pay cut.
 *
 * Both job packs assert as much in prose, and one rung shipped in breach of it
 * — the bench at 190k on top of a 240k partnership. The prose was half right.
 * `rollPromotion` floors the new salary at the old one, so being *promoted*
 * onto a cheaper rung is safe; `applyForJob` writes `Math.round(baseSalary)`
 * flat, with no floor at all. And every rung above the first names a
 * `prevJobId`, which makes the holder of the rung below the only character who
 * can apply — so the unfloored path is the one the ladder funnels people down,
 * and a regressive `baseSalary` charges them for the promotion the career sheet
 * is offering.
 *
 * That is a rule about numbers the packs author rather than a shape the engine
 * has to survive, so it is linted here beside the packs rather than in
 * `validateRegistry`. It reads the built registry instead of either pack's
 * array, so a ladder whose rungs are split across packs is checked the same way.
 */

/** Widened the way the engine's own lookups widen it: an id can outlive its def. */
function jobById(reg: ContentRegistry, id: string): JobDef | undefined {
  const byId: Record<string, JobDef | undefined> = reg.jobsById;
  return byId[id];
}

function shippedJob(reg: ContentRegistry, id: string): JobDef {
  const def = jobById(reg, id);
  if (!def) throw new Error(`the job packs no longer ship "${id}"`);
  return def;
}

/**
 * Every `promotesTo` edge whose upper rung's `baseSalary` sits under its lower
 * rung's.
 *
 * A `promotesTo` naming no job at all is `validateRegistry`'s dangling-ref
 * problem and is skipped here, so one defect is never reported twice; a
 * `baseSalary` that is not a readable number is `checkNumber`'s, and compares
 * false in both directions, so it falls through the same way.
 */
function payCuts(reg: ContentRegistry): string[] {
  const problems: string[] = [];

  for (const job of reg.jobs) {
    if (job.promotesTo === undefined) continue;
    const next = jobById(reg, job.promotesTo);
    if (!next) continue;
    if (next.baseSalary < job.baseSalary) {
      problems.push(
        `job "${job.id}" pays ${job.baseSalary} and promotes to "${next.id}", which pays ${next.baseSalary}`
      );
    }
  }

  return problems;
}

function rung(id: string, baseSalary: number, promotesTo?: string): JobDef {
  const job: JobDef = {
    id,
    track: 'ladder-under-test',
    title: id,
    icon: '💼',
    level: 1,
    baseSalary,
    raisePct: 0.03,
    req: {},
  };
  return promotesTo === undefined ? job : { ...job, promotesTo };
}

function ladder(...jobs: JobDef[]): ContentRegistry {
  const pack: ContentPack = { id: 'jobs-under-test', jobs };
  return buildRegistry([pack]);
}

describe('career ladders', () => {
  let reg: ContentRegistry;

  beforeEach(() => {
    resetRegistryForTests();
    reg = getRegistry();
  });

  it('never promotes a rung onto a smaller salary', () => {
    expect(payCuts(reg)).toEqual([]);
  });

  it('has ladders to walk in the first place', () => {
    // A lint that iterates nothing passes; the shipped rungs are what keeps
    // this file from going quiet when a jobs pack falls out of `allPacks`.
    const climbing = reg.jobs.filter((job) => job.promotesTo !== undefined);
    expect(climbing.length).toBeGreaterThanOrEqual(15);
    expect(new Set(climbing.map((job) => job.track)).size).toBeGreaterThanOrEqual(6);
    expect(payCuts(buildRegistry([]))).toEqual([]);
  });

  it('pays the bench at least what the partnership below it paid', () => {
    // The one rung that ever broke the rule, and the two fields that made it a
    // trap: everyone who can apply for this seat holds that one already.
    const partner = shippedJob(reg, 'job-law-partner');
    const judge = shippedJob(reg, 'job-judge');

    expect(partner.promotesTo).toBe('job-judge');
    expect(judge.req.prevJobId).toBe('job-law-partner');
    expect(judge.baseSalary).toBeGreaterThanOrEqual(partner.baseSalary);
  });

  it('names the rung that pays less than the one below it', () => {
    const regressive = ladder(rung('job-low', 50000, 'job-high'), rung('job-high', 40000));

    expect(payCuts(regressive)).toEqual([
      'job "job-low" pays 50000 and promotes to "job-high", which pays 40000',
    ]);
  });

  it('reads equal pay and a raise as a climb', () => {
    const flat = ladder(rung('job-low', 50000, 'job-high'), rung('job-high', 50000));
    const rising = ladder(rung('job-low', 50000, 'job-high'), rung('job-high', 50001));

    expect(payCuts(flat)).toEqual([]);
    expect(payCuts(rising)).toEqual([]);
  });

  it('leaves a dangling promotesTo to the registry lint', () => {
    const dangling = ladder(rung('job-low', 50000, 'job-nowhere'));

    expect(payCuts(dangling)).toEqual([]);
    expect(validateRegistry(dangling)).toContain(
      'job "job-low" promotesTo unknown job "job-nowhere"'
    );
  });
});
