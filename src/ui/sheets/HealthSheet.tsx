import type { CSSProperties, ReactElement } from 'react';

const placeholderStyle: CSSProperties = {
  display: 'flex',
  flex: 1,
  minHeight: 0,
  alignItems: 'center',
  justifyContent: 'center',
  padding: 'var(--sp-5)',
  color: 'var(--label-2)',
  fontSize: 'var(--fs-subhead)',
};

/** Illnesses, addictions and the treatments available for them. */
export function HealthSheet(): ReactElement {
  return <div style={placeholderStyle}>HealthSheet</div>;
}
