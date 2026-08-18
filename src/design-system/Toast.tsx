import type { CSSProperties, ReactElement } from 'react';

interface ToastProps {
  icon: string;
  title: string;
  subtitle?: string;
}

const toastStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-3)',
  padding: 'var(--sp-3) var(--sp-4)',
  borderRadius: 'var(--r-full)',
  background: 'var(--bg-elevated-2)',
  boxShadow: 'var(--shadow-card)',
};

/** The floating capsule that announces an achievement or a one-off result. */
export function Toast({ icon, title, subtitle }: ToastProps): ReactElement {
  return (
    <div style={toastStyle}>
      <span aria-hidden>{icon}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontWeight: 600 }}>{title}</span>
        {subtitle !== undefined && subtitle !== '' ? (
          <span
            style={{
              display: 'block',
              color: 'var(--label-2)',
              fontSize: 'var(--fs-footnote)',
            }}
          >
            {subtitle}
          </span>
        ) : null}
      </span>
    </div>
  );
}
