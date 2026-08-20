import type { CSSProperties, ReactElement } from 'react';

import { getRegistry } from '@/content';
import { Card, ListRow, ProgressBar, SectionHeader } from '@/design-system';
import { fmtMoney } from '@/engine/format';
import { availableInteractions } from '@/engine/interactions';
import { useGameStore } from '@/store/gameStore';
import { useUiStore } from '@/store/uiStore';
import type { IllnessDef } from '@/types';
import { HEALTH_AREA } from '@/ui/lib/areas';
import { gateFor, statColor } from '@/ui/lib/feed';
import { SheetChrome } from '@/ui/sheets/SheetChrome';

const cardColStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-3)',
};

const rowBetweenStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
};

const strongStyle: CSSProperties = {
  fontWeight: 600,
};

const listGroupStyle: CSSProperties = {
  background: 'var(--bg-elevated)',
  borderRadius: 'var(--r-lg)',
  overflow: 'hidden',
};

const quietStyle: CSSProperties = {
  padding: 'var(--sp-2) var(--sp-4)',
  color: 'var(--label-2)',
  fontSize: 'var(--fs-subhead)',
};

/** Illnesses, addictions and the treatments available for them. */
export function HealthSheet(): ReactElement | null {
  const game = useGameStore((s) => s.game);
  if (game === null) {
    return null;
  }

  const c = game.character;
  const reg = getRegistry();
  const actions = availableInteractions(game, reg, HEALTH_AREA);
  const addictions = Object.entries(c.addictions).filter(
    (entry): entry is [string, number] => typeof entry[1] === 'number'
  );

  return (
    <SheetChrome id="health" title="Health">
      <Card>
        <div style={cardColStyle}>
          <div style={rowBetweenStyle}>
            <span style={strongStyle}>Health</span>
            <span>{Math.round(c.stats.health)}</span>
          </div>
          <ProgressBar value={c.stats.health} color={statColor(c.stats.health)} animated />
        </div>
      </Card>

      <div>
        <SectionHeader>Conditions</SectionHeader>
        {c.illnesses.length > 0 ? (
          <div style={listGroupStyle}>
            {c.illnesses.map((illness) => {
              // Widened: a save can hold an id no loaded pack declares.
              const def: IllnessDef | undefined = reg.illnessesById[illness.defId];
              return (
                <ListRow
                  key={illness.defId}
                  title={def !== undefined ? def.label : illness.defId}
                  subtitle={`${illness.years} yr${illness.treated ? ' · Treated' : ''}`}
                />
              );
            })}
          </div>
        ) : (
          <div style={quietStyle}>No conditions.</div>
        )}
      </div>

      {addictions.length > 0 ? (
        <div>
          <SectionHeader>Addictions</SectionHeader>
          <Card>
            <div style={cardColStyle}>
              {addictions.map(([key, severity]) => (
                <div key={key}>
                  <div style={{ ...rowBetweenStyle, marginBottom: 'var(--sp-1)' }}>
                    <span>{key.charAt(0).toUpperCase() + key.slice(1)}</span>
                    <span style={{ color: 'var(--label-2)' }}>{Math.round(severity)}</span>
                  </div>
                  <ProgressBar value={severity} color="var(--c-orange)" animated />
                </div>
              ))}
            </div>
          </Card>
        </div>
      ) : null}

      <div>
        <SectionHeader>Care</SectionHeader>
        <div style={listGroupStyle}>
          {actions.map((def) => {
            const gate = gateFor(game, reg, def);
            return (
              // Gated rows stay tappable; the engine refuses with a headline.
              <ListRow
                key={def.id}
                testId={`health-action-${def.id}`}
                icon={def.icon}
                title={def.label}
                subtitle={gate.ok ? undefined : gate.reason}
                value={gate.cost !== undefined && gate.cost > 0 ? fmtMoney(gate.cost) : undefined}
                onClick={() => {
                  const r = useGameStore.getState().interact(def.id);
                  if (r !== null) {
                    useUiStore.getState().addToast({ icon: r.icon, title: r.text });
                  }
                }}
              />
            );
          })}
        </div>
      </div>
    </SheetChrome>
  );
}
