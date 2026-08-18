import type { CSSProperties, ReactElement, ReactNode } from 'react';

interface ScreenProps {
  children: ReactNode;
  className?: string;
}

const screenStyle: CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  width: '100%',
  maxWidth: 520,
  margin: '0 auto',
  overflow: 'hidden',
  background: 'var(--bg)',
};

/**
 * The phone-shaped shell every screen renders inside: full height, centred,
 * and clipped so sheets and transitions cannot scroll the page behind it.
 */
export function Screen({ children, className }: ScreenProps): ReactElement {
  return (
    <div className={className} style={screenStyle}>
      {children}
    </div>
  );
}
