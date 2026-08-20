import { beforeEach, describe, expect, it } from 'vitest';

import { getRegistry, resetRegistryForTests } from '@/content';
import type { ContentRegistry } from '@/types';
import {
  ACTIVITY_SECTIONS,
  FAME_AREA,
  HEALTH_AREA,
  PRISON_AREA,
  RELATIONSHIP_AREA,
  RENDERED_INTERACTION_AREAS,
} from '@/ui/lib/areas';

/**
 * The content→UI routing contract.
 *
 * `InteractionDef.area` is the only load-bearing `area` in the codebase:
 * `availableInteractions` filters on it by string equality, and `EventDef.area`
 * is read by nothing. So a row authored with `area: 'relationships'` instead of
 * `'relationship'` — or an area whose sheet was renamed out from under it —
 * compiles, validates, passes every engine test, and is invisible in the
 * running game forever. Nothing else in the suite notices: `validateRegistry`
 * only checks that `area` is a non-empty string.
 *
 * Both directions are failures here. An unrendered area is dead content; a
 * rendered area with nothing in it is a section that can never appear, which is
 * how a deleted pack would look.
 */

/** Every surface source, read through Vite so no node typings are needed. */
const SOURCES: Record<string, string> = import.meta.glob('../../ui/**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** The one-area constants, by the identifier a sheet would import them under. */
const SINGLE_AREA_CONSTANTS = new Map<string, string>([
  ['HEALTH_AREA', HEALTH_AREA],
  ['PRISON_AREA', PRISON_AREA],
  ['FAME_AREA', FAME_AREA],
  ['RELATIONSHIP_AREA', RELATIONSHIP_AREA],
]);

const ACTIVITY_AREAS = ACTIVITY_SECTIONS.map(([area]) => area);

/**
 * Areas named by a literal inside an `availableInteractions(...)` call.
 *
 * `area` is the last parameter and the only string one, so the literal is the
 * first quote in the argument list — which is why nothing before it may be a
 * quote either. A greedy run up to the closing paren would happily take the
 * *closing* quote as its opener and capture the rest of the file.
 */
function literalAreas(source: string): string[] {
  return [...source.matchAll(/availableInteractions\([^')]*'([^']*)'\s*\)/g)].map(
    (match) => match[1]
  );
}

/** Areas a surface asks for by importing the constant rather than retyping it. */
function importedAreas(source: string): string[] {
  const imported = /import\s*\{([^}]+)\}\s*from\s*'@\/ui\/lib\/areas'/.exec(source);
  if (imported === null) return [];

  const names = imported[1].split(',').map((name) => name.trim());
  return names.flatMap((name) => {
    if (name === 'ACTIVITY_SECTIONS') return ACTIVITY_AREAS;
    const area = SINGLE_AREA_CONSTANTS.get(name);
    return area === undefined ? [] : [area];
  });
}

/** Product surfaces only: a test helper under `src/ui/` renders nothing. */
const SURFACES = Object.entries(SOURCES).filter(([path]) => !path.includes('__tests__'));

describe('interaction areas', () => {
  let reg: ContentRegistry;

  beforeEach(() => {
    resetRegistryForTests();
    reg = getRegistry();
  });

  it('routes every shipped interaction to a surface that asks for its area', () => {
    for (const def of reg.interactions) {
      expect(
        RENDERED_INTERACTION_AREAS,
        `interaction "${def.id}" has area "${def.area}", which no sheet renders`
      ).toContain(def.area);
    }
  });

  it('ships at least one interaction for every area a surface renders', () => {
    const shipped = new Set(reg.interactions.map((def) => def.area));

    for (const area of RENDERED_INTERACTION_AREAS) {
      expect([...shipped], `a sheet renders area "${area}" but no pack ships one`).toContain(area);
    }
  });

  it('lists each rendered area once', () => {
    /* A list that emptied out would make the reverse direction vacuous, and a
       new single-area constant the map below has not learned about would make
       `importedAreas` quietly blind to the sheet that imports it. */
    expect(RENDERED_INTERACTION_AREAS.length, 'one entry per section plus one per constant').toBe(
      ACTIVITY_SECTIONS.length + SINGLE_AREA_CONSTANTS.size
    );
    expect(RENDERED_INTERACTION_AREAS.length).toBe(new Set(RENDERED_INTERACTION_AREAS).size);
    for (const [area, label] of ACTIVITY_SECTIONS) {
      expect(area.trim(), 'activity section area').not.toBe('');
      expect(label.trim(), `activity section "${area}" label`).not.toBe('');
    }
  });
});

/**
 * The sheets are the other half of the contract, and most of them still name
 * their area with a literal at the call site. A literal is exactly what this
 * whole check exists to distrust, so the list above is only worth anything if
 * it is verified against the calls themselves rather than against a memory of
 * them: these two assertions are what stop `areas.ts` from drifting into a
 * stale copy of a routing table that lives somewhere else.
 */
describe('interaction areas — the surfaces that ask for them', () => {
  it('finds the sheets', () => {
    expect(SURFACES.length).toBeGreaterThan(10);
    expect(SURFACES.some(([, source]) => source.includes('availableInteractions('))).toBe(true);
  });

  it('asks for no area outside the rendered list', () => {
    for (const [path, source] of SURFACES) {
      for (const area of literalAreas(source)) {
        expect(
          RENDERED_INTERACTION_AREAS,
          `${path} lists interaction area "${area}", which is not in RENDERED_INTERACTION_AREAS`
        ).toContain(area);
      }
    }
  });

  it('has a surface asking for every area on the rendered list', () => {
    const asked = new Set(
      SURFACES.flatMap(([, source]) => [...literalAreas(source), ...importedAreas(source)])
    );

    for (const area of RENDERED_INTERACTION_AREAS) {
      expect([...asked], `no surface under src/ui/ asks for area "${area}"`).toContain(area);
    }
  });
});
