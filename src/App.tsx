import '@/design-system/base.css';

import { useEffect } from 'react';
import type { ComponentType, CSSProperties, ReactElement } from 'react';

import { Screen, applyReduceMotion, applyTheme } from '@/design-system';
import { useUiStore } from '@/store/uiStore';
import type { ScreenId, SheetId } from '@/store/uiStore';

import { CreateScreen } from '@/ui/create/CreateScreen';
import { DeathScreen } from '@/ui/death/DeathScreen';
import { LifeScreen } from '@/ui/life/LifeScreen';
import { SaveSlotsScreen } from '@/ui/slots/SaveSlotsScreen';

import { AchievementsSheet } from '@/ui/sheets/AchievementsSheet';
import { ActivitiesSheet } from '@/ui/sheets/ActivitiesSheet';
import { AssetsSheet } from '@/ui/sheets/AssetsSheet';
import { CasinoSheet } from '@/ui/sheets/CasinoSheet';
import { CrimeSheet } from '@/ui/sheets/CrimeSheet';
import { EducationSheet } from '@/ui/sheets/EducationSheet';
import { EventSheet } from '@/ui/sheets/EventSheet';
import { FinanceSheet } from '@/ui/sheets/FinanceSheet';
import { HealthSheet } from '@/ui/sheets/HealthSheet';
import { MoreSheet } from '@/ui/sheets/MoreSheet';
import { OccupationSheet } from '@/ui/sheets/OccupationSheet';
import { PersonSheet } from '@/ui/sheets/PersonSheet';
import { RelationshipsSheet } from '@/ui/sheets/RelationshipsSheet';
import { SettingsSheet } from '@/ui/sheets/SettingsSheet';

const SCREENS: Record<ScreenId, ComponentType> = {
  slots: SaveSlotsScreen,
  create: CreateScreen,
  life: LifeScreen,
  death: DeathScreen,
};

const SHEETS: Record<SheetId, ComponentType> = {
  event: EventSheet,
  occupation: OccupationSheet,
  education: EducationSheet,
  relationships: RelationshipsSheet,
  person: PersonSheet,
  activities: ActivitiesSheet,
  health: HealthSheet,
  crime: CrimeSheet,
  casino: CasinoSheet,
  assets: AssetsSheet,
  finance: FinanceSheet,
  more: MoreSheet,
  achievements: AchievementsSheet,
  settings: SettingsSheet,
};

const overlayStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-end',
};

const backdropStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.4)',
};

const sheetStyle: CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  maxHeight: '90%',
  background: 'var(--bg-elevated)',
  borderTopLeftRadius: 'var(--r-lg)',
  borderTopRightRadius: 'var(--r-lg)',
  overflowY: 'auto',
};

const toastHostStyle: CSSProperties = {
  position: 'absolute',
  top: 'calc(var(--safe-top) + var(--sp-3))',
  left: 'var(--sp-4)',
  right: 'var(--sp-4)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-2)',
  zIndex: 40,
};

const toastStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-3)',
  padding: 'var(--sp-3) var(--sp-4)',
  borderRadius: 'var(--r-full)',
  background: 'var(--bg-elevated-2)',
  boxShadow: 'var(--shadow-card)',
};

/** Renders the ui store's sheet stack, bottom entry first. */
function SheetHost(): ReactElement | null {
  const sheets = useUiStore((s) => s.sheets);
  const popSheet = useUiStore((s) => s.popSheet);

  if (sheets.length === 0) {
    return null;
  }

  return (
    <>
      {sheets.map((entry, index) => {
        const Body = SHEETS[entry.id];
        return (
          /* Sheets are a stack: the same id can legitimately appear twice, so
             the position is part of the key. */
          <div key={`${entry.id}-${String(index)}`} style={{ ...overlayStyle, zIndex: 20 + index }}>
            <div style={backdropStyle} onClick={popSheet} />
            <div style={sheetStyle}>
              <Body />
            </div>
          </div>
        );
      })}
    </>
  );
}

/** Renders the ui store's toast queue; tapping one dismisses it. */
function ToastHost(): ReactElement | null {
  const toasts = useUiStore((s) => s.toasts);
  const dismissToast = useUiStore((s) => s.dismissToast);

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div style={toastHostStyle}>
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          style={toastStyle}
          onClick={() => dismissToast(toast.id)}
        >
          <span aria-hidden>{toast.icon}</span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontWeight: 600 }}>{toast.title}</span>
            {toast.subtitle !== undefined && toast.subtitle !== '' ? (
              <span
                style={{
                  display: 'block',
                  color: 'var(--label-2)',
                  fontSize: 'var(--fs-footnote)',
                }}
              >
                {toast.subtitle}
              </span>
            ) : null}
          </span>
        </button>
      ))}
    </div>
  );
}

/** The app shell: one screen at a time, with the sheet stack and toasts above it. */
export default function App(): ReactElement {
  const screen = useUiStore((s) => s.screen);
  const theme = useUiStore((s) => s.settings.theme);
  const reduceMotion = useUiStore((s) => s.settings.reduceMotion);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    applyReduceMotion(reduceMotion);
  }, [reduceMotion]);

  const Active = SCREENS[screen];

  return (
    <Screen>
      <Active />
      <SheetHost />
      <ToastHost />
    </Screen>
  );
}
