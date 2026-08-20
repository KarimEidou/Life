/**
 * The slice of Node's type surface the tooling outside `src/` actually uses.
 *
 * This is a stand-in for `@types/node`, which is not a dependency of this repo.
 * The honest version of this file is `npm i -D @types/node` plus
 * `"types": ["node"]` in `tsconfig.tools.json`; when that dependency lands,
 * delete this file and make that swap. Until then, a config file reaching for a
 * Node API not declared below fails with "has no exported member" — add it here.
 *
 * Nothing in `src/` can see any of this: `tsconfig.json` includes `src` only,
 * and this file sits outside it, so browser code still cannot reach for
 * `process` or `Buffer` and typecheck.
 */

declare module 'node:url' {
  export const URL: typeof globalThis.URL;
  export function fileURLToPath(url: string | URL): string;
}

declare module 'node:fs' {
  export function existsSync(path: string | URL): boolean;
}

declare const process: {
  env: Record<string, string | undefined>;
};
