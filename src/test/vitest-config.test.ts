/**
 * The suite's own settings, asserted from inside the suite. Three of them are
 * invisible in a green run and expensive to get wrong: the timeout every test
 * inherits (no test declares its own), the `@` alias the tests resolve through,
 * and the reporter list — which Vitest 2 only tops up with `github-actions`
 * while it is empty, so naming any reporter drops the inline PR annotations.
 *
 * The configs load through `import.meta.glob` rather than a static `import` on
 * purpose: a static one would pull these root-level, Node-flavoured files into
 * `tsconfig.json`'s `src`-only program, which is browser-typed deliberately
 * (see `tsconfig-programs.test.ts`). The glob resolves against the real tree at
 * transform time and hands back loaders, so tsc never sees them.
 */

import { describe, expect, it } from 'vitest';

interface TestOptions {
  testTimeout?: number;
  hookTimeout?: number;
  restoreMocks?: boolean;
  clearMocks?: boolean;
  mockReset?: boolean;
  reporters?: unknown;
}

interface ViteLikeConfig {
  resolve?: { alias?: Record<string, string> };
  test?: TestOptions;
}

interface WorkspaceProject {
  extends?: string;
}

const rootModules = import.meta.glob('../../*.ts', { import: 'default' });

async function loadRoot<T>(file: string): Promise<T> {
  const load = rootModules[`../../${file}`];
  if (!load) throw new Error(`no root-level ${file} to load`);
  return (await load()) as T;
}

const vitestConfig = await loadRoot<ViteLikeConfig>('vitest.config.ts');
const testOptions = vitestConfig.test ?? {};

/** Every shape Vitest accepts for one reporter, reduced to its name. */
function reporterNames(reporters: unknown): string[] {
  const entries = Array.isArray(reporters) ? reporters : [reporters];
  return entries
    .map((entry: unknown) => (Array.isArray(entry) ? (entry[0] as unknown) : entry))
    .filter((name): name is string => typeof name === 'string');
}

describe('the unit suite config', () => {
  it('sets one explicit timeout, generous enough for the balance harness', () => {
    /* Nothing in `src/**` declares a per-test timeout, so this one number is
       the budget for all of them — including `simulation.test.ts`, whose
       `honours cureChance` test plays 600 full seeded lives in a single `it()`.
       Vitest's 5 s default leaves that no headroom on a shared CI runner. */
    expect(testOptions.testTimeout).toBeGreaterThanOrEqual(20_000);
    expect(testOptions.hookTimeout).toBeGreaterThanOrEqual(20_000);
  });

  it('names no reporter without naming github-actions too', () => {
    /* Vitest 2 pushes `github-actions` only when the resolved list is empty
       (`if (!resolved.reporters.length)`), so a `reporters: ['default']` here
       would silently cost every PR its inline annotations. */
    const names = reporterNames(testOptions.reporters ?? []);
    if (names.length > 0) expect(names).toContain('github-actions');
    else expect(names).toEqual([]);
  });

  it('restores spies between tests, and configures that exactly once', () => {
    expect(testOptions.restoreMocks).toBe(true);
    /* The runner takes the first of `restoreMocks`/`mockReset`/`clearMocks` and
       ignores the rest, so either of these alongside it would read as active
       while doing nothing. */
    expect(testOptions.mockReset).toBeUndefined();
    expect(testOptions.clearMocks).toBeUndefined();
  });
});

describe('the `@` alias', () => {
  it('points at the same place in every config that declares one', async () => {
    const configs = await Promise.all(
      ['vite.config.ts', 'vite.singlefile.config.ts', 'vitest.config.ts'].map(
        async (file) => [file, await loadRoot<ViteLikeConfig>(file)] as const,
      ),
    );

    /* Guards the guard: a config that declares no `@` at all would otherwise
       agree with every other one by being `undefined` alongside them. */
    const silent = configs
      .filter(([, config]) => typeof config.resolve?.alias?.['@'] !== 'string')
      .map(([file]) => file);
    expect(silent).toEqual([]);

    /* The tests must resolve `@/x` to the file the app ships as `@/x`, and the
       two builds must agree with each other for the same reason.
       `tsconfig.json`'s `paths` mirrors this for tsc, and
       `tsconfig-programs.test.ts` covers that program split. */
    const targets = [...new Set(configs.map(([, config]) => config.resolve?.alias?.['@']))];
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatch(/[/\\]src$/);
  });
});

describe('the workspace', () => {
  it('extends this config from every project, so all of them inherit its timeouts', async () => {
    const projects = await loadRoot<WorkspaceProject[]>('vitest.workspace.ts');

    /* Guards the guard: an empty list would leave the loop below asserting
       nothing. The suite runs split in two — node for the engine, jsdom for
       the components — and a third would be as welcome. */
    expect(projects.length).toBeGreaterThanOrEqual(2);
    /* A project that stops extending the root config keeps running — it just
       silently loses the timeouts, the alias and the include pattern. */
    for (const project of projects) expect(project.extends).toBe('./vitest.config.ts');
  });
});
