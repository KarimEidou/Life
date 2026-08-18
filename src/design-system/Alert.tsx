import type { CSSProperties, ReactElement } from 'react';

interface AlertProps {
  open: boolean;
  title: string;
  message?: string;
  actions: { label: string; style?: 'default' | 'cancel' | 'destructive'; onPress: () => void }[];
}

const overlayStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 'var(--sp-5)',
  background: 'rgba(0, 0, 0, 0.3)',
  zIndex: 30,
};

const panelStyle: CSSProperties = {
  width: '100%',
  maxWidth: 280,
  padding: 'var(--sp-4)',
  borderRadius: 'var(--r-md)',
  background: 'var(--bg-elevated-2)',
  textAlign: 'center',
};

/** The centred iOS confirmation dialog. Renders nothing while closed. */
export function Alert({ open, title, message, actions }: AlertProps): ReactElement | null {
  if (!open) {
    return null;
  }
  return (
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
}
