import type { CSSProperties, ReactElement } from 'react';

interface EmptyStateProps {
  icon: string;
  title: string;
  message?: string;
}

const emptyStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--sp-2)',
  padding: 'var(--sp-6)',
  textAlign: 'center',
  color: 'var(--label-2)',
};

/** Placeholder shown where a list has nothing in it yet. */
export function EmptyState({ icon, title, message }: EmptyStateProps): ReactElement {
  return (
    <div style={emptyStyle}>
      <span aria-hidden style={{ fontSize: 34 }}>
        {icon}
      </span>
      <div style={{ color: 'var(--label)', fontWeight: 600 }}>{title}</div>
      {message !== undefined && message !== '' ? <div>{message}</div> : null}
    </div>
  );
}
