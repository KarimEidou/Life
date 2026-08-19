import type { CSSProperties, ReactElement, ReactNode } from 'react';

interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'filled' | 'tinted' | 'plain' | 'destructive';
  size?: 'lg' | 'md' | 'sm';
  disabled?: boolean;
  fullWidth?: boolean;
  icon?: string;
  testId?: string;
}

const baseStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--sp-2)',
  borderRadius: 'var(--r-md)',
  fontWeight: 600,
};

const variantStyles: Record<NonNullable<ButtonProps['variant']>, CSSProperties> = {
  filled: { background: 'var(--c-blue)', color: '#fff' },
  tinted: { background: 'var(--fill-3)', color: 'var(--c-blue)' },
  plain: { background: 'transparent', color: 'var(--c-blue)' },
  destructive: {
    background: 'color-mix(in srgb, var(--c-red) 12%, transparent)',
    color: 'var(--c-red)',
  },
};

const sizeStyles: Record<NonNullable<ButtonProps['size']>, CSSProperties> = {
  lg: { padding: 'var(--sp-4) var(--sp-5)', fontSize: 'var(--fs-headline)', minHeight: 50 },
  md: { padding: 'var(--sp-3) var(--sp-4)', minHeight: 44 },
  sm: { padding: 'var(--sp-1) var(--sp-3)', fontSize: 'var(--fs-subhead)', minHeight: 32 },
};

/** The app's tap target for actions. */
export function Button({
  children,
  onClick,
  variant,
  size,
  disabled,
  fullWidth,
  icon,
  testId,
}: ButtonProps): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      style={{
        ...baseStyle,
        ...variantStyles[variant ?? 'tinted'],
        ...sizeStyles[size ?? 'md'],
        width: fullWidth === true ? '100%' : undefined,
        opacity: disabled === true ? 0.4 : 1,
      }}
    >
      {icon !== undefined && icon !== '' ? <span aria-hidden>{icon}</span> : null}
      {children}
    </button>
  );
}
