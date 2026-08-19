import '@/design-system/base.css';

import { AnimatePresence } from 'framer-motion';
import { useEffect } from 'react';
import type { ComponentType, CSSProperties, ReactElement } from 'react';

import { Screen, Sheet, Toast, applyReduceMotion, applyTheme } from '@/design-system';
import { useUiStore } from '@/store/uiStore';
import type { ScreenId, SheetId, ToastItem } from '@/store/uiStore';

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

/** What every sheet body receives: the props its `pushSheet` call carried. */
export interface SheetBodyProps {
  sheetProps?: Record<string, unknown>;
}

const SCREENS: Record<ScreenId, ComponentType> = {
  slots: SaveSlotsScreen,
  create: CreateScreen,
  life: LifeScreen,
  death: DeathScreen,
};

const SHEETS: Record<SheetId, ComponentType<SheetBodyProps>> = {
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

const toastHostStyle: CSSProperties = {
  position: 'absolute',
  top: 'calc(var(--safe-top) + var(--sp-3))',
  left: 'var(--sp-4)',
  right: 'var(--sp-4)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 'var(--sp-2)',
  zIndex: 40,
  pointerEvents: 'none',
};

/* Toasts linger this long before dismissing themselves. */
const TOAST_MS = 2500;

/** Renders the ui store's sheet stack, bottom entry first. */
function SheetHost(): ReactElement {
  const sheets = useUiStore((s) => s.sheets);
  const popSheet = useUiStore((s) => s.popSheet);
  const reduceMotion = useUiStore((s) => s.settings.reduceMotion);

  return (
    <AnimatePresence>
      {sheets.map((entry, index) => {
        const Body = SHEETS[entry.id];
        return (
          /* Sheets are a stack: the same id can legitimately appear twice, so
             the position is part of the key. */
          <Sheet
            key={`${entry.id}-${String(index)}`}
            open
            onClose={popSheet}
            dismissible={entry.id !== 'event'}
            reduceMotion={reduceMotion}
          >
            <Body sheetProps={entry.props} />
          </Sheet>
        );
      })}
    </AnimatePresence>
  );
}

/** One toast plus its self-dismissal timer, which unmounting cancels. */
function TimedToast({ item, reduceMotion }: { item: ToastItem; reduceMotion: boolean }): ReactElement {
  const dismissToast = useUiStore((s) => s.dismissToast);

  useEffect(() => {
    const timer = setTimeout(() => {
      dismissToast(item.id);
    }, TOAST_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [item.id, dismissToast]);

  return (
    <Toast
      icon={item.icon}
      title={item.title}
      subtitle={item.subtitle}
      reduceMotion={reduceMotion}
      onPress={() => {
        dismissToast(item.id);
      }}
    />
  );
}

/** Renders the ui store's toast queue; each dismisses itself or on tap. */
function ToastHost(): ReactElement {
  const toasts = useUiStore((s) => s.toasts);
  const reduceMotion = useUiStore((s) => s.settings.reduceMotion);

  return (
    <div style={toastHostStyle}>
      <AnimatePresence>
        {toasts.map((toast) => (
          <TimedToast key={toast.id} item={toast} reduceMotion={reduceMotion} />
        ))}
      </AnimatePresence>
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
