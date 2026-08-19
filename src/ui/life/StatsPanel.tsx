import type { CSSProperties, ReactElement } from 'react';

import { ProgressBar } from '@/design-system';
import { useGameStore } from '@/store/gameStore';
import type { StatKey } from '@/types';
import { statColor } from '@/ui/lib/feed';

const STAT_ROWS: { key: StatKey; icon: string; label: string }[] = [
  { key: 'health', icon: '❤️', label: 'Health' },
  { key: 'happiness', icon: '😊', label: 'Happiness' },
  { key: 'smarts', icon: '🧠', label: 'Smarts' },
  { key: 'looks', icon: '✨', label: 'Looks' },
];

const panelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-2)',
  padding: 'var(--sp-3) var(--sp-4)',
  background: 'var(--bg-elevated)',
  borderTop: 'var(--hairline) solid var(--separator)',
};

const rowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '96px 1fr 30px',
  alignItems: 'center',
  gap: 'var(--sp-3)',
};

const labelStyle: CSSProperties = {
  color: 'var(--label-2)',
  fontSize: 'var(--fs-caption)',
  whiteSpace: 'nowrap',
};

const numberStyle: CSSProperties = {
  color: 'var(--label-2)',
  fontSize: 'var(--fs-caption)',
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
};

/** The four headline stat meters under the feed. */
export function StatsPanel(): ReactElement | null {
  const game = useGameStore((s) => s.game);
  if (game === null) {
    return null;
  }
  const stats = game.character.stats;

  return (
    <div data-testid="stats-panel" style={panelStyle}>
      {STAT_ROWS.map(({ key, icon, label }) => {
        const value = stats[key];
        return (
          <div key={key} data-testid={`stat-${key}`} style={rowStyle}>
            <span style={labelStyle}>
              <span aria-hidden>{icon}</span> {label}
            </span>
            <ProgressBar value={value} color={statColor(value)} animated />
            <span style={numberStyle}>{Math.round(value)}</span>
          </div>
        );
      })}
    </div>
  );
}
