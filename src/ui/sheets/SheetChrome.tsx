import type { CSSProperties, ReactElement, ReactNode } from 'react';

import { Button, NavBar } from '@/design-system';
import { useUiStore } from '@/store/uiStore';

interface SheetChromeProps {
  /** The sheet's id, stamped into `data-testid="sheet-<id>"`. */
  id: string;
  title: string;
  children: ReactNode;
}

const rootStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
};

const bodyStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-4)',
  padding: 'var(--sp-4)',
  overflowY: 'auto',
  minHeight: 0,
};

/** Shared chrome for every sheet: a titled bar with Done above a scrolling body. */
export function SheetChrome({ id, title, children }: SheetChromeProps): ReactElement {
  const popSheet = useUiStore((s) => s.popSheet);
  return (
    <div data-testid={`sheet-${id}`} style={rootStyle}>
      <NavBar
        title={title}
        right={
          <Button variant="plain" size="sm" testId="sheet-close" onClick={popSheet}>
            Done
          </Button>
        }
      />
      <div style={bodyStyle}>{children}</div>
    </div>
  );
}
