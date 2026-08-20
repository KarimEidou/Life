import type { CSSProperties, ReactElement } from 'react';

import { getRegistry } from '@/content';
import { EmptyState, ListRow, SectionHeader } from '@/design-system';
import { fmtMoney } from '@/engine/format';
import { availableInteractions } from '@/engine/interactions';
import { useGameStore } from '@/store/gameStore';
import { useUiStore } from '@/store/uiStore';
import type { InteractionDef } from '@/types';
import { ACTIVITY_SECTIONS } from '@/ui/lib/areas';
import { gateFor } from '@/ui/lib/feed';
import { SheetChrome } from '@/ui/sheets/SheetChrome';

const listGroupStyle: CSSProperties = {
  background: 'var(--bg-elevated)',
  borderRadius: 'var(--r-lg)',
  overflow: 'hidden',
};

const gatedStyle: CSSProperties = {
  opacity: 0.55,
};

/** Everything the character can go do this year, grouped by area. */
export function ActivitiesSheet(): ReactElement | null {
  const game = useGameStore((s) => s.game);
  if (game === null) {
    return null;
  }

  const reg = getRegistry();
  /* Fixed section order, from the list every routed area is declared on so a
     lint can check the whole routing table at once; an empty section vanishes
     rather than rendering a header over nothing, which is how underage looks. */
  const groups = ACTIVITY_SECTIONS.map(([area, label]): [string, InteractionDef[]] => [
    label,
    availableInteractions(game, reg, area),
  ]).filter(([, defs]) => defs.length > 0);

  return (
    <SheetChrome id="activities" title="Activities">
      {groups.length === 0 ? (
        <EmptyState icon="🍼" title="Not much to do at this age." />
      ) : (
        groups.map(([label, defs]) => (
          <div key={label}>
            <SectionHeader>{label}</SectionHeader>
            <div style={listGroupStyle}>
              {defs.map((def) => {
                const gate = gateFor(game, reg, def);
                return (
                  // Gated rows dim but stay tappable; the engine refuses with a headline.
                  <div key={def.id} style={gate.ok ? undefined : gatedStyle}>
                    <ListRow
                      testId={`activity-row-${def.id}`}
                      icon={def.icon}
                      title={def.label}
                      subtitle={gate.ok ? undefined : gate.reason}
                      value={
                        gate.cost !== undefined && gate.cost > 0 ? fmtMoney(gate.cost) : undefined
                      }
                      onClick={() => {
                        const r = useGameStore.getState().interact(def.id);
                        if (r !== null) {
                          useUiStore.getState().addToast({ icon: r.icon, title: r.text });
                        }
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </SheetChrome>
  );
}
