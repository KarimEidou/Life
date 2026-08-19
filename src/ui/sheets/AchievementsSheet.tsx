import type { CSSProperties, ReactElement } from 'react';

import { getRegistry } from '@/content';
import { Card, ListRow } from '@/design-system';
import { useGameStore } from '@/store/gameStore';
import { SheetChrome } from '@/ui/sheets/SheetChrome';

const countStyle: CSSProperties = {
  padding: '0 var(--sp-4)',
  color: 'var(--label-2)',
  fontSize: 'var(--fs-subhead)',
};

/** Every achievement across all lives: unlocked, locked and secret. */
export function AchievementsSheet(): ReactElement | null {
  const game = useGameStore((s) => s.game);
  const unlocked = useGameStore((s) => s.unlocked);
  if (game === null) {
    return null;
  }

  const reg = getRegistry();
  const count = reg.achievements.filter((a) => unlocked.includes(a.id)).length;

  return (
    <SheetChrome id="achievements" title="Achievements">
      <div style={countStyle}>
        {count} of {reg.achievements.length} unlocked
      </div>
      <Card>
        {reg.achievements.map((a) => {
          const isUnlocked = unlocked.includes(a.id);
          if (!isUnlocked && a.secret === true) {
            return (
              <ListRow
                key={a.id}
                testId={`achievement-${a.id}`}
                icon="🔒"
                title="???"
                subtitle="Secret achievement"
                disabled
              />
            );
          }
          return (
            <ListRow
              key={a.id}
              testId={`achievement-${a.id}`}
              icon={a.icon}
              title={a.label}
              subtitle={a.desc}
              disabled={!isUnlocked}
            />
          );
        })}
      </Card>
    </SheetChrome>
  );
}
