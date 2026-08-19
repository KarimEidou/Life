import { useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';

import { Alert, Button, Card, SectionHeader, SegmentedControl, Switch } from '@/design-system';
import { useGameStore } from '@/store/gameStore';
import { useUiStore } from '@/store/uiStore';
import type { ThemeSetting } from '@/types';
import { SheetChrome } from '@/ui/sheets/SheetChrome';

const THEME_OPTIONS = [
  { id: 'auto', label: 'Auto', testId: 'settings-theme-auto' },
  { id: 'light', label: 'Light', testId: 'settings-theme-light' },
  { id: 'dark', label: 'Dark', testId: 'settings-theme-dark' },
];

const appearanceStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-3)',
};

const saveActionsStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-3)',
};

const footerStyle: CSSProperties = {
  paddingTop: 'var(--sp-3)',
  color: 'var(--label-3)',
  fontSize: 'var(--fs-footnote)',
  textAlign: 'center',
};

/** Appearance preferences plus save controls; renders with no life loaded too. */
export function SettingsSheet(): ReactElement {
  // No null-game bail: this sheet also opens from the slots screen.
  const game = useGameStore((s) => s.game);
  const settings = useUiStore((s) => s.settings);
  const setTheme = useUiStore((s) => s.setTheme);
  const setReduceMotion = useUiStore((s) => s.setReduceMotion);
  const [confirmAbandon, setConfirmAbandon] = useState(false);

  return (
    <SheetChrome id="settings" title="Settings">
      <div>
        <SectionHeader>Appearance</SectionHeader>
        <Card>
          <div style={appearanceStyle}>
            <SegmentedControl
              options={THEME_OPTIONS}
              value={settings.theme}
              onChange={(id) => {
                setTheme(id as ThemeSetting);
              }}
            />
            <Switch
              label="Reduce motion"
              testId="settings-reduce-motion"
              checked={settings.reduceMotion}
              onChange={setReduceMotion}
            />
          </div>
        </Card>
      </div>
      {game !== null ? (
        <div>
          <SectionHeader>Save</SectionHeader>
          <div style={saveActionsStyle}>
            <Button
              fullWidth
              testId="settings-save-now"
              onClick={() => {
                // Only a write that outlives the tab may be reported as a save.
                const saved = useGameStore.getState().saveNow();
                useUiStore.getState().addToast(
                  saved
                    ? { icon: '💾', title: 'Saved.' }
                    : {
                        icon: '⚠️',
                        title: "Couldn't save.",
                        subtitle: 'Storage is unavailable on this device.',
                      }
                );
              }}
            >
              Save now
            </Button>
            <Button
              fullWidth
              variant="destructive"
              testId="settings-abandon"
              onClick={() => {
                setConfirmAbandon(true);
              }}
            >
              Abandon life
            </Button>
          </div>
          <div style={footerStyle}>
            Seed {game.seed} · Generation {game.generation}
          </div>
        </div>
      ) : null}
      <Alert
        open={confirmAbandon}
        title="Abandon this life?"
        message="The save stays in its slot."
        actions={[
          {
            label: 'Abandon',
            style: 'destructive',
            testId: 'alert-action-abandon',
            onPress: () => {
              setConfirmAbandon(false);
              useGameStore.getState().abandonLife();
            },
          },
          {
            label: 'Cancel',
            style: 'cancel',
            onPress: () => {
              setConfirmAbandon(false);
            },
          },
        ]}
      />
    </SheetChrome>
  );
}
