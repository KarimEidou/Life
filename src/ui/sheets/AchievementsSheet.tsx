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

/** Every achievement and which of them this account has unlocked. */
export function AchievementsSheet(): ReactElement {
  return <div style={placeholderStyle}>AchievementsSheet</div>;
}
