import { useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';

import { Alert, Button, Card, ListRow, NavBar } from '@/design-system';
import { fmtMoneyCompact } from '@/engine/format';
import type { SlotRow } from '@/engine/save';
import { useGameStore } from '@/store/gameStore';
import { useUiStore } from '@/store/uiStore';

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
function summarySubtitle(s: SlotRow): string {
  if (s.age === undefined) {
    /* The summariser fills the details together or not at all. What reaches
       this branch, now that every refusal it can foresee flags the row instead,
       is a payload only a migration understands: occupied, undescribable, and
       nothing to warn about. `Age 0 · Gen 1 · $0` would describe a life that is
       not in there; Continue runs the chain and reports what it found. */
    return 'This save could not be read';
  }
  const base = `Age ${String(s.age)} · Gen ${String(s.generation ?? 1)} · ${fmtMoneyCompact(s.money ?? 0)}`;
  return s.dead === true ? `${base} · Deceased` : base;
}

/**
 * How an occupied row presents itself. A slot the loader has already refused
 * says so on the row rather than posing as an ordinary save: the one
 * irreversible action in the game is overwriting a life, and a row that reads
 * like any other invites exactly that. The details, when the summariser got
 * them, stay in the title — a warning over a named life reads as "not now",
 * where an anonymous one reads as "already lost".
 */
function rowCopy(s: SlotRow): { icon: string; title: string; subtitle: string } {
  if (s.unreadable === 'future') {
    return {
      icon: '⚠️',
      title: s.name ?? 'Needs a newer version',
      subtitle: 'Saved by a newer version of the game',
    };
  }
  if (s.unreadable === 'damaged') {
    return {
      icon: '⚠️',
      title: s.name ?? 'Damaged save',
      subtitle: 'This save could not be read',
    };
  }
  return { icon: '🧬', title: s.name ?? 'Saved life', subtitle: summarySubtitle(s) };
}

/** What the confirmation adds under the title; nothing for a healthy save. */
function confirmMessage(s: SlotRow): string | undefined {
  if (s.unreadable === 'future') {
    return 'This save was written by a newer version of the game. Update the game to open it, or delete it to free the slot.';
  }
  if (s.unreadable === 'damaged') {
    return 'This save could not be read. Continue tries to recover it; Delete frees the slot for a new life.';
  }
  return undefined;
}

/** The six save slots: continue a life, start a new one, or delete one. */
export function SaveSlotsScreen(): ReactElement {
  // Non-reactive read by design; refreshed by hand after any delete.
  const [summaries, setSummaries] = useState(() => useGameStore.getState().slotSummaries());
  const [confirm, setConfirm] = useState<SlotRow | null>(null);

  const startNew = (slot: number): void => {
    // The store holds the pending slot; the create screen reads it back.
    useGameStore.getState().beginNewLife(slot);
    useUiStore.getState().setScreen('create');
  };

  const continueLife = (slot: number): void => {
    setConfirm(null);
    // loadSlot routes to the life screen itself on success, and says why on a refusal.
    const result = useGameStore.getState().loadSlot(slot);
    if (result.ok) {
      /* A life the loader had to patch up resumes either way, but the player is
         the one who can tell whether what came back is the life they left. */
      if (result.repairs !== undefined) {
        useUiStore.getState().addToast({
          icon: '🩹',
          title: 'Recovered a damaged save.',
          subtitle: 'Some details could not be read and were reset.',
        });
      }
      return;
    }
    // A save from a newer build is healthy data — steer away from Delete.
    const title =
      result.reason === 'future'
        ? 'This save needs a newer version of the game.'
        : 'That save could not be read.';
    useUiStore.getState().addToast({ icon: '⚠️', title });
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
          {summaries.map((s) => {
            /* Only a slot nothing is stored in offers the create screen, which
               overwrites without a confirmation: everything else — including a
               save this build cannot read — goes through the alert below. */
            if (s.empty) {
              return (
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
              );
            }
            const copy = rowCopy(s);
            return (
              <ListRow
                key={s.slot}
                icon={copy.icon}
                title={copy.title}
                subtitle={copy.subtitle}
                testId={`slot-row-${String(s.slot)}`}
                onClick={() => {
                  setConfirm(s);
                }}
              />
            );
          })}
        </Card>
      </div>
      {confirm !== null ? (
        <Alert
          open
          title={rowCopy(confirm).title}
          message={confirmMessage(confirm)}
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
