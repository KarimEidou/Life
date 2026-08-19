import type { CSSProperties, ReactElement } from 'react';

import { Avatar, Card, SectionHeader } from '@/design-system';
import { useGameStore } from '@/store/gameStore';
import { aliveChildren } from '@/ui/lib/feed';

/* ListRow's icon slot is text-only, so the heir rows are hand-built buttons
   with the same look, leaving room for a real Avatar. */
const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-3)',
  width: '100%',
  minHeight: 44,
  padding: 'var(--sp-2) var(--sp-4)',
  color: 'var(--label)',
};

const nameBlockStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  textAlign: 'left',
};

const subtitleStyle: CSSProperties = {
  display: 'block',
  color: 'var(--label-2)',
  fontSize: 'var(--fs-footnote)',
};

const chevronStyle: CSSProperties = {
  color: 'var(--label-3)',
};

/** Offers the surviving children to continue the family line as. */
export function LegacyPrompt(): ReactElement | null {
  const game = useGameStore((s) => s.game);
  if (game === null) {
    return null;
  }
  const heirs = aliveChildren(game);
  if (heirs.length === 0) {
    return null;
  }

  return (
    <div>
      <SectionHeader>Continue the family line</SectionHeader>
      <Card>
        {heirs.map((child) => (
          <button
            key={child.id}
            type="button"
            data-testid={`legacy-child-${child.id}`}
            style={rowStyle}
            onClick={() => {
              useGameStore.getState().startLegacy(child.id);
            }}
          >
            <Avatar gender={child.gender} age={child.age} size={36} />
            <span style={nameBlockStyle}>
              <span style={{ display: 'block' }}>{child.name}</span>
              <span style={subtitleStyle}>{`Age ${String(child.age)}`}</span>
            </span>
            <span aria-hidden style={chevronStyle}>
              ›
            </span>
          </button>
        ))}
      </Card>
    </div>
  );
}
