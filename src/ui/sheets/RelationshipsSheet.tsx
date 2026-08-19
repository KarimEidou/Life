import type { CSSProperties, ReactElement } from 'react';

import { Avatar, EmptyState, ProgressBar, SectionHeader } from '@/design-system';
import { useGameStore } from '@/store/gameStore';
import { useUiStore } from '@/store/uiStore';
import type { Person, RelKind } from '@/types';
import { SheetChrome } from '@/ui/sheets/SheetChrome';

/* Fixed section order; a person appears under the first section listing their kind. */
const SECTIONS: [string, RelKind[]][] = [
  ['Partner', ['spouse', 'partner']],
  ['Family', ['mother', 'father', 'sibling']],
  ['Children', ['child']],
  ['Friends', ['friend']],
  ['Exes', ['ex']],
  ['Enemies', ['enemy']],
  ['Pets', ['pet']],
];

const listGroupStyle: CSSProperties = {
  background: 'var(--bg-elevated)',
  borderRadius: 'var(--r-lg)',
  overflow: 'hidden',
};

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-3)',
  width: '100%',
  minHeight: 44,
  padding: 'var(--sp-2) var(--sp-4)',
  color: 'var(--label)',
  textAlign: 'left',
};

const nameColStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
};

const nameStyle: CSSProperties = {
  display: 'block',
};

const subtitleStyle: CSSProperties = {
  display: 'block',
  color: 'var(--label-2)',
  fontSize: 'var(--fs-footnote)',
};

const relBarStyle: CSSProperties = {
  width: 64,
  flexShrink: 0,
};

const chevronStyle: CSSProperties = {
  color: 'var(--label-3)',
};

/** One tappable person row: face, name, kind and the relationship meter. */
function PersonRow({ person }: { person: Person }): ReactElement {
  const subtitle = `Age ${person.age} · ${person.kind}${person.alive ? '' : ' · Deceased'}`;
  return (
    <button
      type="button"
      data-testid={`person-row-${person.id}`}
      style={{ ...rowStyle, opacity: person.alive ? 1 : 0.5 }}
      onClick={() => {
        useUiStore.getState().pushSheet('person', { personId: person.id });
      }}
    >
      <Avatar gender={person.gender} age={person.age} size={36} />
      <span style={nameColStyle}>
        <span style={nameStyle}>{person.name}</span>
        <span style={subtitleStyle}>{subtitle}</span>
      </span>
      <span style={relBarStyle}>
        <ProgressBar value={person.rel} />
      </span>
      <span aria-hidden style={chevronStyle}>
        ›
      </span>
    </button>
  );
}

/** Everyone in the character's life, grouped by relationship. */
export function RelationshipsSheet(): ReactElement | null {
  const game = useGameStore((s) => s.game);
  if (game === null) {
    return null;
  }

  const people = Object.values(game.people);
  const groups = SECTIONS.map(([label, kinds]): [string, Person[]] => [
    label,
    kinds.flatMap((kind) => people.filter((p) => p.kind === kind)),
  ]).filter(([, members]) => members.length > 0);

  return (
    <SheetChrome id="relationships" title="Relationships">
      {groups.length === 0 ? (
        <EmptyState icon="🌱" title="It's just you for now." />
      ) : (
        groups.map(([label, members]) => (
          <div key={label}>
            <SectionHeader>{label}</SectionHeader>
            <div style={listGroupStyle}>
              {members.map((person) => (
                <PersonRow key={person.id} person={person} />
              ))}
            </div>
          </div>
        ))
      )}
    </SheetChrome>
  );
}
