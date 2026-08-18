import type { ReactElement } from 'react';

interface SwitchProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}

/** A boolean toggle; the design pass replaces the checkbox with the iOS switch. */
export function Switch({ checked, onChange, label }: SwitchProps): ReactElement {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label !== undefined && label !== '' ? <span>{label}</span> : null}
    </label>
  );
}
