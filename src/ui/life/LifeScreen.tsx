import type { CSSProperties, ReactElement } from 'react';

import { Button, EmptyState, TabBar } from '@/design-system';
import { useGameStore } from '@/store/gameStore';
import { useUiStore } from '@/store/uiStore';
import type { SheetId } from '@/store/uiStore';
import { AgeButton } from '@/ui/life/AgeButton';
import { Feed } from '@/ui/life/Feed';
import { HeaderBar } from '@/ui/life/HeaderBar';
import { StatsPanel } from '@/ui/life/StatsPanel';

const TAB_ITEMS: { id: SheetId; icon: string; label: string }[] = [
  { id: 'occupation', icon: '💼', label: 'Job' },
  { id: 'assets', icon: '🏠', label: 'Assets' },
  { id: 'relationships', icon: '❤️', label: 'People' },
  { id: 'activities', icon: '🎯', label: 'Activities' },
  { id: 'more', icon: '⋯', label: 'More' },
];

const rootStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  /* At very short (landscape) viewports the fixed panels exceed the screen;
     letting the column scroll keeps the tab bar reachable. */
  overflowY: 'auto',
};

const emptyRootStyle: CSSProperties = {
  ...rootStyle,
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--sp-4)',
  padding: 'var(--sp-5)',
};

const ageStripStyle: CSSProperties = {
  padding: 'var(--sp-2) var(--sp-4)',
};

const tabStripStyle: CSSProperties = {
  paddingBottom: 'var(--safe-bottom)',
  background: 'var(--bar-bg)',
};

/** The main game screen: header, life feed, stats and the tab bar. */
export function LifeScreen(): ReactElement {
  const game = useGameStore((s) => s.game);
  const pushSheet = useUiStore((s) => s.pushSheet);
  const setScreen = useUiStore((s) => s.setScreen);

  if (game === null) {
    return (
      <div data-testid="screen-life" style={emptyRootStyle}>
        <EmptyState icon="🌱" title="No life in progress" />
        <Button
          variant="filled"
          testId="back-to-menu"
          onClick={() => {
            setScreen('slots');
          }}
        >
          Back to menu
        </Button>
      </div>
    );
  }

  return (
    <div data-testid="screen-life" style={rootStyle}>
      <HeaderBar />
      <Feed />
      <StatsPanel />
      <div style={ageStripStyle}>
        <AgeButton />
      </div>
      <div style={tabStripStyle}>
        <TabBar
          items={TAB_ITEMS}
          onSelect={(id) => {
            pushSheet(id as SheetId);
          }}
        />
      </div>
    </div>
  );
}
