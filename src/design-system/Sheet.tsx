import type { CSSProperties, ReactElement, ReactNode } from 'react';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  dismissible?: boolean;
  height?: 'auto' | 'full';
}

const overlayStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-end',
  zIndex: 20,
};

const backdropStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.4)',
};

const panelStyle: CSSProperties = {
  position: 'relative',
  background: 'var(--bg-elevated)',
  borderTopLeftRadius: 'var(--r-lg)',
  borderTopRightRadius: 'var(--r-lg)',
  padding: 'var(--sp-4)',
  overflowY: 'auto',
};

/** The modal card that slides up from the bottom; the design pass adds the animation. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  dismissible,
  height,
}: SheetProps): ReactElement | null {
  if (!open) {
    return null;
  }
  const canDismiss = dismissible !== false;
  return (
    <div style={overlayStyle}>
      <div style={backdropStyle} onClick={canDismiss ? onClose : undefined} />
      <div style={{ ...panelStyle, height: height === 'full' ? '100%' : 'auto' }}>
        {title !== undefined && title !== '' ? (
          <div style={{ fontWeight: 600, paddingBottom: 'var(--sp-3)' }}>{title}</div>
        ) : null}
        {children}
      </div>
    </div>
  );
}
