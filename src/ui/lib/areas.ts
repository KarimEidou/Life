/**
 * The interaction areas the UI actually renders.
 *
 * `InteractionDef.area` is the only routing key content has, and it is matched
 * by string equality inside `availableInteractions` — so an interaction
 * authored with `area: 'relationships'` instead of `'relationship'` ships,
 * builds, passes `validateRegistry` and is unreachable for the life of the
 * game, with no error anywhere. The row simply never appears.
 *
 * Holding the list here gives that contract one place to be checked from:
 * `src/content/__tests__/interaction-areas.test.ts` fails when a pack ships an
 * area no surface asks for, when a surface asks for an area no pack ships, and
 * when a sheet's own literal drifts away from the constant beside it.
 *
 * (`EventDef.area` is a different, decorative field — nothing in the app reads
 * it — so it is deliberately not routed through here.)
 */

/** The activity areas the Activities sheet renders, in display order. */
export const ACTIVITY_SECTIONS: readonly (readonly [area: string, label: string])[] = [
  ['mind-body', 'Mind & Body'],
  ['fun', 'Fun'],
  ['shopping', 'Shopping'],
  ['nightlife', 'Nightlife'],
  ['pets', 'Pets'],
  ['travel', 'Travel'],
] as const;

/** Care rows, on the Health sheet. */
export const HEALTH_AREA = 'health';
/** Ways to pass a sentence, on the Crime sheet. */
export const PRISON_AREA = 'prison';
/** What a public figure can do with the attention, on the More sheet. */
export const FAME_AREA = 'fame';
/** Person-targeted rows, on the Person sheet and the Relationships hub. */
export const RELATIONSHIP_AREA = 'relationship';

/**
 * Every interaction area some surface renders. An area outside this list is
 * dead content: authored, validated, shipped, and impossible to reach.
 */
export const RENDERED_INTERACTION_AREAS: readonly string[] = [
  ...ACTIVITY_SECTIONS.map(([area]) => area),
  HEALTH_AREA,
  PRISON_AREA,
  FAME_AREA,
  RELATIONSHIP_AREA,
];
