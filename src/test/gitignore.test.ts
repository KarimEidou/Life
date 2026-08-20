/**
 * The ignore list, checked against the tools that write into the tree. Every
 * entry exists because something here drops files next to the source, and the
 * only thing standing between `git add -A` and half a megabyte of inlined
 * bundle in history is that the directory was listed before anyone ran it.
 * Deleting a line is silent — nothing fails, the spillage just becomes
 * committable — so each one is pinned here next to what produces it.
 *
 * The file is read as text through Vite's `?raw`, like the other
 * config-contract tests in this folder: `src/` is browser-typed and has no Node
 * API to read a file with.
 */

import { describe, expect, it } from 'vitest';

import gitignoreRaw from '../../.gitignore?raw';

interface CoverageConfig {
  test?: { coverage?: { reportsDirectory?: string } };
}

const rootModules = import.meta.glob('../../*.ts', { import: 'default' });

async function loadRoot<T>(file: string): Promise<T> {
  const load = rootModules[`../../${file}`];
  if (!load) throw new Error(`no root-level ${file} to load`);
  return (await load()) as T;
}

/** What the toolchain writes into the working tree, and what writes it. */
const generated: readonly (readonly [path: string, producer: string])[] = [
  ['node_modules/', 'npm ci'],
  ['dist/', 'npm run build'],
  ['dist-single/', 'npm run build:single'],
  /* No script produces this one: it is where a hand-run bundle benchmark left
     an inlined `app.js`/`app.css` pair (~560 KB) sitting untracked. Listed so
     the next such run cannot be swept into a commit. */
  ['bench/', 'ad-hoc bundle benchmarking'],
  ['playwright-report/', "Playwright's html reporter"],
  ['test-results/', 'npm run e2e — traces, failure screenshots, videos'],
  ['blob-report/', "Playwright's blob reporter, --reporter=blob"],
  /* Playwright 1.56 keeps its transform cache in the OS tmpdir, so nothing
     writes this today; it is the entry `npm init playwright` scaffolds, and
     costs one line to stay covered if that ever moves back in-tree. */
  ['playwright/.cache/', "Playwright's transform cache, on versions that keep it in-tree"],
  ['coverage/', 'npm run test:coverage'],
  ['e2e/__screenshots__/', 'npm run screenshots'],
];

/* Git drops blank lines and `#` comments and strips trailing whitespace from a
   pattern (unless backslash-escaped, which nothing here does). Leading
   whitespace it keeps, which is why an indented entry is a bug and not a
   formatting choice — hence the trailing-only trim. */
const patterns = gitignoreRaw
  .split('\n')
  .map((line) => line.replace(/\s+$/, ''))
  .filter((line) => line !== '' && !line.startsWith('#'));

/** A pattern reduced to the path it names: git's leading `/` (anchor to the
    repo root) and trailing `/` (directories only) change what a pattern
    matches, not which path it is about. */
function pathOf(pattern: string): string {
  return pattern.replace(/^\/+/, '').replace(/\/+$/, '');
}

const ignored = new Set(patterns.map(pathOf));

/** Ignoring a parent ignores everything under it, so `a/b` is covered by an
    entry for `a` just as well as by one for `a/b`. */
function isIgnored(target: string): boolean {
  const segments = pathOf(target).split('/');
  return segments.some((_, i) => ignored.has(segments.slice(0, i + 1).join('/')));
}

describe('the ignore list', () => {
  it('covers everything the toolchain writes into the tree', () => {
    const exposed = generated.filter(([path]) => !isIgnored(path));
    expect(
      exposed.map(([path, producer]) => `${path} — written by ${producer}`),
      'generated output with nothing stopping a `git add -A` from committing it',
    ).toEqual([]);
  });

  it('is written the way git reads it', () => {
    /* Guards the guard: a `?raw` import that came back empty, or a file that
       arrived as one long line, would leave the check above vacuous. */
    expect(patterns.length).toBeGreaterThanOrEqual(generated.length);
    /* Git keeps leading whitespace, so ` coverage/` ignores a directory whose
       name begins with a space — a typo that reads as fixed. */
    expect(patterns.filter((pattern) => /^\s/.test(pattern))).toEqual([]);
    /* Two copies of an entry is a merge that half-landed. Harmless to git, but
       it hides which of the two a later edit was meant to change. */
    expect(patterns.filter((pattern, i) => patterns.indexOf(pattern) !== i)).toEqual([]);
  });

  it('covers wherever vitest writes coverage, not just the default name', async () => {
    const config = await loadRoot<CoverageConfig>('vitest.config.ts');
    /* Vitest's own default while the config stays quiet about it. Naming it
       here is what makes the assertion mean something today, and what makes
       relocating the report a change this test notices. */
    const reportsDirectory = config.test?.coverage?.reportsDirectory ?? './coverage';
    expect(
      isIgnored(reportsDirectory.replace(/^\.\//, '')),
      `${reportsDirectory} is where \`npm run test:coverage\` writes`,
    ).toBe(true);
  });
});
