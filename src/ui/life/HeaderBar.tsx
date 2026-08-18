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

/** Top of the life screen: avatar, name, age, year and money. */
export function HeaderBar(): ReactElement {
  return <div style={placeholderStyle}>HeaderBar</div>;
}
