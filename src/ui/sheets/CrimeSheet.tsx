import type { CSSProperties, ReactElement } from 'react';

import { getRegistry } from '@/content';
import { Card, ListRow, ProgressBar } from '@/design-system';
import { fmtMoney, fmtMoneyCompact } from '@/engine/format';
import { availableInteractions } from '@/engine/interactions';
import { useGameStore } from '@/store/gameStore';
import { useUiStore } from '@/store/uiStore';
import { gateFor } from '@/ui/lib/feed';
import { SheetChrome } from '@/ui/sheets/SheetChrome';

const cardColStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-3)',
};

const strongStyle: CSSProperties = {
  fontWeight: 600,
};

const metaStyle: CSSProperties = {
  color: 'var(--label-2)',
  fontSize: 'var(--fs-footnote)',
};

const listGroupStyle: CSSProperties = {
  background: 'var(--bg-elevated)',
  borderRadius: 'var(--r-lg)',
  overflow: 'hidden',
};

const dimStyle: CSSProperties = {
  opacity: 0.55,
};

/** The crimes that can be committed, with their odds and sentences. */
export function CrimeSheet(): ReactElement | null {
  const game = useGameStore((s) => s.game);
  if (game === null) {
    return null;
  }

  const c = game.character;
  const reg = getRegistry();
  const prison = c.prison;

  if (prison !== null) {
    const actions = availableInteractions(game, reg, 'prison');
    return (
      <SheetChrome id="crime" title="Crime">
        <Card>
          <div style={cardColStyle}>
            <div style={strongStyle}>In prison for {prison.crime}</div>
            <ProgressBar
              value={((prison.totalYears - prison.yearsLeft) / prison.totalYears) * 100}
              animated
            />
            <div style={metaStyle}>
              {prison.yearsLeft} of {prison.totalYears} years left
            </div>
          </div>
        </Card>

        {actions.length > 0 ? (
          <div style={listGroupStyle}>
            {actions.map((def) => {
              const gate = gateFor(game, reg, def);
              return (
                // Gated rows stay tappable; the engine refuses with a headline.
                <ListRow
                  key={def.id}
                  testId={`prison-action-${def.id}`}
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
        ) : null}
      </SheetChrome>
    );
  }

  return (
    <SheetChrome id="crime" title="Crime">
      <div style={listGroupStyle}>
        {reg.crimes.map((crime) => {
          const tooYoung = c.age < crime.minAge;
          return (
            // Underage rows dim but stay tappable; the engine refuses safely.
            <div key={crime.id} style={tooYoung ? dimStyle : undefined}>
              <ListRow
                testId={`crime-row-${crime.id}`}
                icon={crime.icon}
                title={crime.label}
                subtitle={
                  tooYoung
                    ? "You're too young."
                    : `${fmtMoneyCompact(crime.payout[0])}–${fmtMoneyCompact(crime.payout[1])} · up to ${crime.sentenceYears[1]} yr`
                }
                onClick={() => {
                  const r = useGameStore.getState().crime(crime.id);
                  if (r !== null) {
                    useUiStore.getState().addToast({ icon: r.icon, title: r.text });
                  }
                }}
              />
            </div>
          );
        })}
      </div>
    </SheetChrome>
  );
}
