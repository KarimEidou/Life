import { coverageConfigDefaults, defineConfig } from 'vitest/config';

import viteConfig from './vite.config';

export default defineConfig({
  // The app's own alias object, not a third copy of it. `@` is declared in
  // `vite.config.ts` and mirrored by `paths` in `tsconfig.json`; taking it from
  // there means a test can never resolve a module to a different file than the
  // app does. Only `resolve` is borrowed, deliberately: `.test.tsx` compiles
  // through esbuild's `jsx: "react-jsx"` (read from `tsconfig.json`), so
  // merging the whole config would push `@vitejs/plugin-react` and its
  // Fast-Refresh transform onto every node test for nothing.
  resolve: viteConfig.resolve,
  // The base both projects in `vitest.workspace.ts` extend — which is what a
  // plain `vitest run` uses; this config alone only runs when it is named
  // (`vitest --config vitest.config.ts`).
  test: {
    // Stays `node`: `save.test.ts` asserts `typeof localStorage === 'undefined'`.
    // The workspace's `dom` project is the one that overrides it to jsdom.
    environment: 'node',
    // A `.test.tsx` left out of this pattern is skipped in silence — Vitest only
    // reports "no test files found" when nothing matches at all. Widen the
    // extension, never the root: Vitest's default include would also sweep in
    // `e2e/*.spec.ts`, which are Playwright specs.
    include: ['src/**/*.test.{ts,tsx}'],
    // No test in the suite sets its own timeout, so every one of them runs on
    // this number, and the 5 s default is the whole budget for the balance
    // harness: `simulation.test.ts` plays 200 full seeded lives per `playAll()`,
    // and its `honours cureChance` test calls `playAll()` three times — 600
    // lives inside one budget. That measures well under a second here; the case
    // this covers is a cold, shared CI runner, where the default is a false
    // failure waiting to happen. Headroom, not permission to be slow.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Restores every spy before each test, so a `vi.spyOn` that escapes its own
    // test cannot silently rewrite the next one. `clearMocks` is deliberately
    // absent rather than set alongside: Vitest's runner picks exactly one of
    // `restoreMocks`/`mockReset`/`clearMocks` in that order, so a `clearMocks`
    // here would read as active while doing nothing. This runs before the
    // `beforeEach` hooks, so a spy installed in one still stands.
    restoreMocks: true,
    // `reporters` stays unset on purpose. Vitest 2 appends the `github-actions`
    // reporter only when the resolved list is empty, so naming even
    // `['default']` here would silently drop the inline annotations on every PR.
    // Anything added here must list `'github-actions'` too.

    // Read only under `--coverage`, and read only from here: in a workspace the
    // coverage settings come from the root config, never from a project.
    // `@vitest/coverage-v8` peer-depends on the exact `vitest` version, so the
    // two are pinned together in package.json and bump together.
    coverage: {
      provider: 'v8',
      // `lcovonly`, not `lcov`: the composite one re-emits the `html` report.
      reporter: ['text-summary', 'html', 'lcovonly', 'json-summary'],
      include: ['src/**/*.{ts,tsx}'],
      // On top of the defaults — which already drop `__tests__/` and `*.d.ts` —
      // so a `*.test.ts` written outside a `__tests__/` folder still cannot
      // count as source. `src/types/**` is types only and compiles to nothing,
      // `src/test/**` is the jsdom harness and the config-contract tests,
      // `main.tsx` is the browser bootstrap.
      exclude: [
        ...coverageConfigDefaults.exclude,
        'src/types/**',
        'src/test/**',
        'src/main.tsx',
      ],
      // No `thresholds` yet, deliberately: the first floor has to be a measured
      // number minus a couple of points, not a guess.
    },
  },
});
