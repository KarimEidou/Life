import type { CSSProperties, ReactElement } from 'react';

interface TextFieldProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  label?: string;
}

const inputStyle: CSSProperties = {
  width: '100%',
  padding: 'var(--sp-3)',
  borderRadius: 'var(--r-sm)',
  background: 'var(--fill-3)',
  border: 0,
};

/** A single-line text input, optionally with a leading label. */
export function TextField({
  value,
  onChange,
  placeholder,
  maxLength,
  label,
}: TextFieldProps): ReactElement {
  return (
    <label style={{ display: 'block' }}>
      {label !== undefined && label !== '' ? (
        <span
          style={{
            display: 'block',
            paddingBottom: 'var(--sp-1)',
            color: 'var(--label-2)',
            fontSize: 'var(--fs-footnote)',
          }}
        >
          {label}
        </span>
      ) : null}
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        style={inputStyle}
      />
    </label>
  );
}
