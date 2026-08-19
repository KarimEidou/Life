import type { CSSProperties, ReactElement } from 'react';

import { getRegistry } from '@/content';
import { Avatar, Card, EmptyState, ListRow, ProgressBar } from '@/design-system';
import { personById } from '@/engine/effects';
import { fmtMoney } from '@/engine/format';
import { availableInteractions } from '@/engine/interactions';
import { useGameStore } from '@/store/gameStore';
import { useUiStore } from '@/store/uiStore';
import { gateFor } from '@/ui/lib/feed';
import { SheetChrome } from '@/ui/sheets/SheetChrome';

/** What this sheet reads from its `pushSheet` entry; declared locally on purpose. */
interface PersonSheetProps {
  sheetProps?: Record<string, unknown>;
}

const cardColStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 'var(--sp-3)',
  textAlign: 'center',
};

const nameStyle: CSSProperties = {
  fontSize: 'var(--fs-title3)',
  fontWeight: 600,
};

const metaStyle: CSSProperties = {
  color: 'var(--label-2)',
  fontSize: 'var(--fs-footnote)',
};

const relBlockStyle: CSSProperties = {
  width: '100%',
};

const relCaptionStyle: CSSProperties = {
  color: 'var(--label-2)',
  fontSize: 'var(--fs-footnote)',
  marginBottom: 'var(--sp-1)',
  textAlign: 'left',
};

const memorialStyle: CSSProperties = {
  color: 'var(--label-2)',
  fontSize: 'var(--fs-footnote)',
  fontStyle: 'italic',
};

const listGroupStyle: CSSProperties = {
  background: 'var(--bg-elevated)',
  borderRadius: 'var(--r-lg)',
  overflow: 'hidden',
};

const gatedStyle: CSSProperties = {
  opacity: 0.55,
};

/** One person up close: their card plus every relationship action aimed at them. */
export function PersonSheet({ sheetProps }: PersonSheetProps): ReactElement | null {
  const game = useGameStore((s) => s.game);
  if (game === null) {
    return null;
  }

  const personId = typeof sheetProps?.personId === 'string' ? sheetProps.personId : undefined;
  /* `personById`, never `game.people[personId]`: the id rode in on a sheet entry
     and read back out of JSON, so an inherited member like `toString` would
     otherwise resolve to a truthy non-person and render as one. */
  const person = personId !== undefined ? personById(game.people, personId) : undefined;

  if (person === undefined) {
    return (
      <SheetChrome id="person" title="Person">
        <EmptyState icon="👋" title="They're not in your life anymore." />
      </SheetChrome>
    );
  }

  const reg = getRegistry();
  const meta =
    person.occupation !== undefined && person.occupation !== ''
      ? `${person.kind} · Age ${person.age} · ${person.occupation}`
      : `${person.kind} · Age ${person.age}`;

  return (
    <SheetChrome id="person" title="Person">
      <Card>
        <div style={cardColStyle}>
          <Avatar gender={person.gender} age={person.age} size={64} />
          <div>
            <div style={nameStyle}>{person.name}</div>
            <div style={metaStyle}>{meta}</div>
          </div>
          <div style={relBlockStyle}>
            <div style={relCaptionStyle}>Relationship</div>
            <ProgressBar value={person.rel} />
          </div>
          {!person.alive ? (
            <div style={memorialStyle}>Rest in peace, {person.name}. Gone but not forgotten.</div>
          ) : null}
        </div>
      </Card>

      {person.alive ? (
        <div style={listGroupStyle}>
          {availableInteractions(game, reg, 'relationship').map((def) => {
            const gate = gateFor(game, reg, def, person);
            return (
              // Gated rows dim but stay tappable; the engine refuses with a headline.
              <div key={def.id} style={gate.ok ? undefined : gatedStyle}>
                <ListRow
                  testId={`person-action-${def.id}`}
                  icon={def.icon}
                  title={def.label}
                  subtitle={gate.ok ? undefined : gate.reason}
                  value={gate.cost !== undefined && gate.cost > 0 ? fmtMoney(gate.cost) : undefined}
                  onClick={() => {
                    const r = useGameStore.getState().interact(def.id, person.id);
                    if (r !== null) {
                      useUiStore.getState().addToast({ icon: r.icon, title: r.text });
                    }
                  }}
                />
              </div>
            );
          })}
        </div>
      ) : null}
    </SheetChrome>
  );
}
