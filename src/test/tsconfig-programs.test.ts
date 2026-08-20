/**
 * `tsconfig.json` includes `src` only, so every `.ts` file outside it — the four
 * root config files, `vitest.workspace.ts`, `tools.d.ts` and all of `e2e/` — is
 * typechecked by exactly one thing: the second program in `tsconfig.tools.json`.
 * Nothing else compiles them. Vite and Playwright both hand them to esbuild,
 * which strips types without checking them, so a file that drops out of that
 * program is not "checked a bit less" — it is not checked at all, silently.
 *
 * These run in the node project (`*.test.ts`) and read the config files as text
 * through Vite's `?raw`, because `src/` has no Node types to read them with.
 */

import { describe, expect, it } from 'vitest';

import packageJsonRaw from '../../package.json?raw';
import rootTsconfigRaw from '../../tsconfig.json?raw';
import toolsTsconfigRaw from '../../tsconfig.tools.json?raw';

interface Tsconfig {
  extends?: string;
  compilerOptions?: { types?: string[]; noEmit?: boolean };
  include?: string[];
}

/**
 * `JSON.parse` for a tsconfig, which is JSONC: both files carry `//` comments
 * explaining why they are split, and those comments are the whole point of
 * keeping them readable. Only line comments are stripped, and only outside
 * strings — a `//` inside a path or URL survives.
 */
function parseJsonc(text: string): unknown {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += text[i + 1] ?? '';
        i += 1;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }
    out += ch;
  }
  return JSON.parse(out);
}

/**
 * The two `include` shapes this repo uses, and only those: a bare directory
 * name takes everything under it, and a pattern with `*` matches within one
 * path segment. `**` is deliberately unsupported — if an include ever needs it,
 * this helper should grow a case rather than quietly return `false`.
 */
function includeCovers(pattern: string, file: string): boolean {
  if (pattern.includes('**')) throw new Error(`unsupported include pattern: ${pattern}`);
  if (pattern.includes('*')) {
    const source = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
    return new RegExp(`^${source}$`).test(file);
  }
  return file === pattern || file.startsWith(`${pattern}/`);
}

const packageJson = JSON.parse(packageJsonRaw) as { scripts: Record<string, string> };
const rootTsconfig = parseJsonc(rootTsconfigRaw) as Tsconfig;
const toolsTsconfig = parseJsonc(toolsTsconfigRaw) as Tsconfig;

/* Resolved by Vite at transform time against the real tree, so a config file
   added at the root shows up here without anyone editing this list. */
const outsideSrc = [
  ...Object.keys(import.meta.glob('../../*.ts')),
  ...Object.keys(import.meta.glob('../../e2e/**/*.ts')),
].map((path) => path.replace('../../', ''));

describe('the tools typecheck program', () => {
  it('covers every TypeScript file outside src/', () => {
    /* Guards the guard: an empty glob would make the assertion below vacuous. */
    expect(outsideSrc).toContain('playwright.config.ts');
    expect(outsideSrc).toContain('e2e/helpers.ts');

    const include = toolsTsconfig.include ?? [];
    const uncovered = outsideSrc.filter((file) => !include.some((p) => includeCovers(p, file)));
    expect(uncovered).toEqual([]);
  });

  it('is a second program, not a replacement for the src one', () => {
    expect(toolsTsconfig.extends).toBe('./tsconfig.json');
    expect(toolsTsconfig.compilerOptions?.noEmit).toBe(true);
    /* Both source trees are unchecked unless `typecheck` runs both programs,
       and `tsc --noEmit` on its own reads `tsconfig.json` only. */
    const { typecheck } = packageJson.scripts;
    expect(typecheck).toContain('tsconfig.tools.json');
    expect(typecheck.match(/\btsc\b/g)).toHaveLength(2);
    expect(packageJson.scripts.build).toContain('typecheck');
  });

  it('keeps the src program browser-only', () => {
    /* `types` is what stops `src/` from reaching for `process` or `Buffer` and
       typechecking fine while failing in the browser. The tooling files need
       Node, so they get their own program instead of widening this one. */
    expect(rootTsconfig.compilerOptions?.types).toEqual(['vite/client']);
    expect(rootTsconfig.include).toEqual(['src']);
    expect(toolsTsconfig.compilerOptions?.types).toEqual([]);
  });
});
