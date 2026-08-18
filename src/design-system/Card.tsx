import type { CSSProperties, ReactElement, ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}

const cardStyle: CSSProperties = {
  background: 'var(--bg-elevated)',
  borderRadius: 'var(--r-lg)',
  padding: 'var(--sp-4)',
};

/** Grouped-list style container: an elevated, rounded block of content. */
export function Card({ children, className, onClick }: CardProps): ReactElement {
  return (
    <div className={className} style={cardStyle} onClick={onClick}>
      {children}
    </div>
  );
}
