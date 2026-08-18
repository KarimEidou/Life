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

/** Offers the surviving children to continue the family line as. */
export function LegacyPrompt(): ReactElement {
  return <div style={placeholderStyle}>LegacyPrompt</div>;
}
