import type { CSSProperties, ReactElement, ReactNode } from 'react';

interface ListRowProps {
  icon?: string;
  title: string;
  subtitle?: string;
  value?: ReactNode;
  chevron?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  destructive?: boolean;
  testId?: string;
}

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-3)',
  width: '100%',
  minHeight: 44,
  padding: 'var(--sp-2) var(--sp-4)',
};

/** One row of an iOS grouped list: icon, title/subtitle, trailing value and chevron. */
export function ListRow({
  icon,
  title,
  subtitle,
  value,
  chevron,
  onClick,
  disabled,
  destructive,
  testId,
}: ListRowProps): ReactElement {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      style={{
        ...rowStyle,
        color: destructive === true ? 'var(--c-red)' : 'var(--label)',
        opacity: disabled === true ? 0.4 : 1,
      }}
    >
      {icon !== undefined && icon !== '' ? <span aria-hidden>{icon}</span> : null}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block' }}>{title}</span>
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
      {value !== undefined ? <span style={{ color: 'var(--label-2)' }}>{value}</span> : null}
      {chevron === true ? <span aria-hidden style={{ color: 'var(--label-3)' }}>›</span> : null}
    </button>
  );
}
