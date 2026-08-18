import type { CSSProperties, ReactElement, ReactNode } from 'react';

interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'filled' | 'tinted' | 'plain' | 'destructive';
  size?: 'lg' | 'md' | 'sm';
  disabled?: boolean;
  fullWidth?: boolean;
  icon?: string;
}

const baseStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--sp-2)',
  padding: 'var(--sp-3) var(--sp-4)',
  borderRadius: 'var(--r-md)',
  background: 'var(--fill-3)',
  color: 'var(--c-blue)',
  fontWeight: 600,
};

/** The app's tap target for actions; variant/size styling lands with the design pass. */
export function Button({
  children,
  onClick,
  disabled,
  fullWidth,
  icon,
}: ButtonProps): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        ...baseStyle,
        width: fullWidth === true ? '100%' : undefined,
        opacity: disabled === true ? 0.4 : 1,
      }}
    >
      {icon !== undefined && icon !== '' ? <span aria-hidden>{icon}</span> : null}
      {children}
    </button>
  );
}
