import type { CSSProperties, ReactElement } from 'react';

interface SegmentedControlProps {
  options: { id: string; label: string; testId?: string }[];
  value: string;
  onChange: (id: string) => void;
}

const trackStyle: CSSProperties = {
  display: 'flex',
  gap: 2,
  padding: 2,
  borderRadius: 'var(--r-sm)',
  background: 'var(--fill-3)',
};

/** The iOS pill switcher: one selected segment out of several. */
export function SegmentedControl({ options, value, onChange }: SegmentedControlProps): ReactElement {
  return (
    <div style={trackStyle}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          data-testid={option.testId}
          onClick={() => onChange(option.id)}
          style={{
            flex: 1,
            padding: 'var(--sp-1) var(--sp-2)',
            borderRadius: 'calc(var(--r-sm) - 2px)',
            background: option.id === value ? 'var(--bg-elevated)' : 'transparent',
            fontSize: 'var(--fs-subhead)',
            textAlign: 'center',
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
