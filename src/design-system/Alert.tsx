import { createContext, useContext, useState } from 'react';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface AlertProps {
  open: boolean;
  title: string;
  message?: string;
  actions: {
    label: string;
    style?: 'default' | 'cancel' | 'destructive';
    onPress: () => void;
    testId?: string;
  }[];
}

/** The shell-wide layer alerts render into; `null` when no host is mounted. */
const OverlayContext = createContext<HTMLElement | null>(null);

const hostStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 30,
  /* The layer spans the shell even while empty, so it must never hit-test
     itself; the scrim opts back in. */
  pointerEvents: 'none',
};

const overlayStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 'var(--sp-5)',
  background: 'rgba(0, 0, 0, 0.3)',
  zIndex: 30,
  pointerEvents: 'auto',
};

const panelStyle: CSSProperties = {
  width: '100%',
  maxWidth: 280,
  padding: 'var(--sp-4)',
  borderRadius: 'var(--r-md)',
  background: 'var(--bg-elevated-2)',
  textAlign: 'center',
};

/**
 * Wraps the app shell and owns the layer every `Alert` below it renders into.
 * Without it an alert's scrim resolves against its nearest positioned
 * ancestor, which inside a `Sheet` is the sheet panel: it would dim the panel
 * alone, sit inside the sheet's scroller so the list moved behind the dialog,
 * and leave the sheet's own dismiss backdrop live in the strip above it.
 */
export function AlertHost({ children }: { children: ReactNode }): ReactElement {
  const [layer, setLayer] = useState<HTMLDivElement | null>(null);
  return (
    <OverlayContext.Provider value={layer}>
      {children}
      <div ref={setLayer} style={hostStyle} />
    </OverlayContext.Provider>
  );
}

/** The centred iOS confirmation dialog. Renders nothing while closed. */
export function Alert({ open, title, message, actions }: AlertProps): ReactElement | null {
  const layer = useContext(OverlayContext);
  if (!open) {
    return null;
  }
  const dialog = (
    <div style={overlayStyle}>
      <div style={panelStyle}>
        <div style={{ fontWeight: 600 }}>{title}</div>
        {message !== undefined && message !== '' ? (
          <div style={{ color: 'var(--label-2)', fontSize: 'var(--fs-footnote)' }}>{message}</div>
        ) : null}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)', paddingTop: 'var(--sp-3)' }}>
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              data-testid={action.testId}
              onClick={action.onPress}
              style={{
                padding: 'var(--sp-2)',
                color: action.style === 'destructive' ? 'var(--c-red)' : 'var(--c-blue)',
                fontWeight: action.style === 'cancel' ? 600 : 400,
                textAlign: 'center',
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
  /* Outside a host — or on the first commit, before its ref lands — the alert
     still renders in place, as it always did. Either way React events keep
     bubbling to the call site, not to the layer. */
  return layer === null ? dialog : createPortal(dialog, layer);
}
