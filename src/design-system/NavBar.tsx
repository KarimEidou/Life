import type { CSSProperties, ReactElement, ReactNode } from 'react';

interface NavBarProps {
  title: string;
  left?: ReactNode;
  right?: ReactNode;
  largeTitle?: boolean;
}

const barStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-3)',
  minHeight: 44,
  padding: 'var(--sp-2) var(--sp-4)',
  background: 'var(--bar-bg)',
};

/** The translucent top bar: leading control, title, trailing control. */
export function NavBar({ title, left, right, largeTitle }: NavBarProps): ReactElement {
  return (
    <div style={barStyle}>
      <div style={{ minWidth: 0 }}>{left}</div>
      <div
        style={{
          flex: 1,
          textAlign: largeTitle === true ? 'left' : 'center',
          fontSize: largeTitle === true ? 'var(--fs-title1)' : 'var(--fs-headline)',
          fontWeight: 600,
        }}
      >
        {title}
      </div>
      <div style={{ minWidth: 0 }}>{right}</div>
    </div>
  );
}
