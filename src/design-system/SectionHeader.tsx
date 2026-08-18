import type { CSSProperties, ReactElement, ReactNode } from 'react';

interface SectionHeaderProps {
  children: ReactNode;
}

const headerStyle: CSSProperties = {
  padding: 'var(--sp-4) var(--sp-4) var(--sp-2)',
  color: 'var(--label-2)',
  fontSize: 'var(--fs-footnote)',
  textTransform: 'uppercase',
  letterSpacing: 'var(--ls-wide)',
};

/** The small all-caps label that introduces a grouped list section. */
export function SectionHeader({ children }: SectionHeaderProps): ReactElement {
  return <div style={headerStyle}>{children}</div>;
}
