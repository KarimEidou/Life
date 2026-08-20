/**
 * One Node version, written down once. `.nvmrc` is that place: a contributor's
 * `nvm use` and `actions/setup-node`'s `node-version-file` read the same file,
 * so the runner and the laptop cannot drift onto different majors — the drift
 * that surfaces as an esbuild or rollup difference nobody can reproduce
 * locally. `engines.node` is a separate, lower number: the oldest Node this app
 * claims to run on, which the pinned one has to clear.
 *
 * The files are read as text through Vite's `?raw`, like the other
 * config-contract tests in this folder: `src/` is browser-typed and has no
 * Node API to read a file with.
 */

import { describe, expect, it } from 'vitest';

import nvmrcRaw from '../../.nvmrc?raw';
import packageJsonRaw from '../../package.json?raw';

/* Resolved by Vite at transform time against the real tree, so a workflow
   added later is covered here without anyone editing a list. Both extensions:
   GitHub reads `.yaml` too, and a workflow this misses is one it cannot check. */
const workflows = Object.entries(
  import.meta.glob<string>(['../../.github/workflows/*.yml', '../../.github/workflows/*.yaml'], {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
).map(([path, text]) => [path.replace('../../', ''), text] as const);

const packageJson = JSON.parse(packageJsonRaw) as { engines?: { node?: string } };
const pinned = nvmrcRaw.trim();

describe('the pinned Node version', () => {
  it('is one bare major in .nvmrc', () => {
    /* `setup-node` and `nvm` both accept far more than this — `lts/*`, a full
       `v22.11.0`, a range — but a bare major is the only form that stays true
       as patches ship, so it is the one this repo writes. */
    expect(pinned).toMatch(/^\d+$/);
  });

  it('clears the floor `engines.node` advertises', () => {
    const range = packageJson.engines?.node ?? '';
    /* A `>=x.y.z` floor, deliberately, and not the pinned version repeated: the
       floor documents what the dependency set actually needs (Vite 5 wants
       `^18 || >=20`), while `.nvmrc` says which of those everyone develops on.
       Any other shape here means this comparison has stopped being meaningful,
       so it fails loudly rather than passing on a range it cannot read. */
    const floor = /^>=(\d+)\.\d+\.\d+$/.exec(range);
    if (!floor) {
      throw new Error(`engines.node must be a ">=x.y.z" floor, got ${JSON.stringify(range)}`);
    }
    expect(Number(pinned)).toBeGreaterThanOrEqual(Number(floor[1]));
  });
});

describe('every workflow that installs Node', () => {
  it('reads the version from .nvmrc instead of naming one', () => {
    const installers = workflows.filter(([, text]) => text.includes('actions/setup-node'));

    /* Guards the guard: an empty glob, or a rename of the deploy workflow,
       would otherwise leave both assertions below vacuously true. */
    expect(
      installers.map(([path]) => path),
      'no workflow sets up Node any more — is this test still reading the right files?',
    ).toContain('.github/workflows/deploy.yml');

    /* Quotes optional on both sides, since YAML takes the key and the value
       either way; `node-version-file` cannot match the first pattern. */
    const named = installers.filter(([, text]) => /^\s*['"]?node-version['"]?\s*:/m.test(text));
    expect(
      named.map(([path]) => path),
      'these workflows name a Node version inline; use `node-version-file: .nvmrc`',
    ).toEqual([]);

    const unpinned = installers.filter(
      ([, text]) => !/^\s*['"]?node-version-file['"]?\s*:\s*['"]?\.nvmrc['"]?\s*$/m.test(text),
    );
    expect(
      unpinned.map(([path]) => path),
      'these workflows set up Node without `node-version-file: .nvmrc`',
    ).toEqual([]);
  });
});
