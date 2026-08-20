import { configDefaults, defineWorkspace } from 'vitest/config';

/**
 * Two projects, one suite. The engine, content and store tests run on `node` —
 * `save.test.ts` asserts `typeof localStorage === 'undefined'`, and both stores
 * pick their storage adapter from whether that global exists — so a DOM may
 * never leak into them. Component tests need one, so they get their own project
 * with jsdom and a shared setup file.
 *
 * Routing is by extension, never by hand: a `*.test.tsx` is a jsdom test, a
 * `*.test.ts` is a node test. Do not name a component test `.test.ts`; a DOM
 * test with no JSX in it can still opt in per file with a
 * `// @vitest-environment jsdom` docblock, and then has to import
 * `@/test/setup` itself, which this project does for its own files.
 *
 * Both projects inherit `include` and the `@` alias from `vitest.config.ts`.
 * They split it with `exclude` rather than by restating `include`, because
 * `extends` *merges* config: an `include` here would be concatenated with the
 * inherited one, not replace it, and each project would collect the other's
 * files.
 */
export default defineWorkspace([
  {
    extends: './vitest.config.ts',
    test: {
      name: 'engine',
      environment: 'node',
      // Replacing `exclude` drops Vitest's defaults, so re-state them.
      exclude: [...configDefaults.exclude, 'src/**/*.test.tsx'],
    },
  },
  {
    extends: './vitest.config.ts',
    test: {
      name: 'dom',
      environment: 'jsdom',
      exclude: [...configDefaults.exclude, 'src/**/*.test.ts'],
      setupFiles: ['./src/test/setup.ts'],
    },
  },
]);
