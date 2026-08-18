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

/** The six save slots: continue a life, start a new one, or delete one. */
export function SaveSlotsScreen(): ReactElement {
  return <div style={placeholderStyle}>SaveSlotsScreen</div>;
}
