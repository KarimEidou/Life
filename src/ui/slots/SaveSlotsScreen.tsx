import { useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';

import { Alert, Button, Card, ListRow, NavBar } from '@/design-system';
import { fmtMoneyCompact } from '@/engine/format';
import { slotLoadFailure, useGameStore } from '@/store/gameStore';
import { useUiStore } from '@/store/uiStore';
import type { SlotSummary } from '@/types';

const rootStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  /* Content runs under the translucent status bar. */
  paddingTop: 'var(--safe-top)',
};

const bodyStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  padding: 'var(--sp-4)',
};

/** Occupied-slot caption: age, generation, bankroll and whether the life ended. */
function summarySubtitle(s: SlotSummary): string {
  const base = `Age ${String(s.age ?? 0)} · Gen ${String(s.generation ?? 1)} · ${fmtMoneyCompact(s.money ?? 0)}`;
  return s.dead === true ? `${base} · Deceased` : base;
}

/** The six save slots: continue a life, start a new one, or delete one. */
export function SaveSlotsScreen(): ReactElement {
  // Non-reactive read by design; refreshed by hand after any delete.
  const [summaries, setSummaries] = useState(() => useGameStore.getState().slotSummaries());
  const [confirm, setConfirm] = useState<SlotSummary | null>(null);

  const startNew = (slot: number): void => {
    // The store's `slot` is the pending slot the create screen will write into.
    useGameStore.setState({ slot, game: null, casino: null });
    useUiStore.getState().setScreen('create');
  };

  const continueLife = (slot: number): void => {
    setConfirm(null);
    // loadSlot routes to the life screen itself on success.
    if (!useGameStore.getState().loadSlot(slot)) {
      // A save from a newer build is healthy data — steer away from Delete.
      const title =
        slotLoadFailure(slot) === 'future'
          ? 'This save needs a newer version of the game.'
          : 'That save could not be read.';
      useUiStore.getState().addToast({ icon: '⚠️', title });
    }
  };

  const deleteLife = (slot: number): void => {
    useGameStore.getState().deleteSlot(slot);
    setSummaries(useGameStore.getState().slotSummaries());
    setConfirm(null);
  };

  return (
    <div data-testid="screen-slots" style={rootStyle}>
      <NavBar
        largeTitle
        title="One Life"
        right={
          <Button
            variant="plain"
            size="sm"
            icon="⚙️"
            testId="slots-settings"
            onClick={() => {
              useUiStore.getState().pushSheet('settings');
            }}
          >
            {null}
          </Button>
        }
      />
      <div style={bodyStyle}>
        <Card>
          {summaries.map((s) =>
            s.empty ? (
              <ListRow
                key={s.slot}
                icon="➕"
                title="Empty slot"
                subtitle="Start a new life"
                testId={`slot-row-${String(s.slot)}`}
                onClick={() => {
                  startNew(s.slot);
                }}
              />
            ) : (
              <ListRow
                key={s.slot}
                icon="🧬"
                title={s.name ?? 'Saved life'}
                subtitle={summarySubtitle(s)}
                testId={`slot-row-${String(s.slot)}`}
                onClick={() => {
                  setConfirm(s);
                }}
              />
            ),
          )}
        </Card>
      </div>
      {confirm !== null ? (
        <Alert
          open
          title={confirm.name ?? 'Saved life'}
          actions={[
            {
              label: 'Continue',
              onPress: () => {
                continueLife(confirm.slot);
              },
              testId: 'alert-action-continue',
            },
            {
              label: 'Delete',
              style: 'destructive',
              onPress: () => {
                deleteLife(confirm.slot);
              },
              testId: 'alert-action-delete',
            },
            {
              label: 'Cancel',
              style: 'cancel',
              onPress: () => {
                setConfirm(null);
              },
              testId: 'alert-action-cancel',
            },
          ]}
        />
      ) : null}
    </div>
  );
}
