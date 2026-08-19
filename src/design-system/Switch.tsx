import type { CSSProperties, ReactElement } from 'react';

interface SwitchProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  testId?: string;
}

const trackStyle: CSSProperties = {
  position: 'relative',
  display: 'inline-block',
  width: 48,
  height: 28,
  borderRadius: 'var(--r-full)',
  transition: 'background var(--t-fast) var(--ease-out)',
  flexShrink: 0,
};

const knobStyle: CSSProperties = {
  position: 'absolute',
  top: 2,
  left: 2,
  width: 24,
  height: 24,
  borderRadius: 'var(--r-full)',
  background: '#fff',
  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.25)',
  transition: 'transform var(--t-fast) var(--ease-out)',
};

/** The iOS toggle: a green pill with a sliding knob over a hidden checkbox. */
export function Switch({ checked, onChange, label, testId }: SwitchProps): ReactElement {
  return (
    <label
      data-testid={testId}
      style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }}
      />
      {label !== undefined && label !== '' ? <span style={{ flex: 1 }}>{label}</span> : null}
      <span
        aria-hidden
        style={{ ...trackStyle, background: checked ? 'var(--c-green)' : 'var(--fill-3)' }}
      >
        <span
          style={{ ...knobStyle, transform: checked ? 'translateX(20px)' : 'translateX(0)' }}
        />
      </span>
    </label>
  );
}
