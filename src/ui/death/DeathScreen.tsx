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

/** The obituary: cause of death, age, epitaph stats and what happens next. */
export function DeathScreen(): ReactElement {
  return <div style={placeholderStyle}>DeathScreen</div>;
}
