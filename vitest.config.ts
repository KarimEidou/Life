import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // Stays `node`: `save.test.ts` asserts `typeof localStorage === 'undefined'`.
    // A component test opts into a DOM per file with a `// @vitest-environment
    // jsdom` docblock, once jsdom is a devDependency.
    environment: 'node',
    // A `.test.tsx` left out of this pattern is skipped in silence — Vitest only
    // reports "no test files found" when nothing matches at all. Widen the
    // extension, never the root: Vitest's default include would also sweep in
    // `e2e/*.spec.ts`, which are Playwright specs.
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
