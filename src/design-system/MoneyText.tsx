import type { ReactElement } from 'react';

interface MoneyTextProps {
  value: number;
  compact?: boolean;
  className?: string;
}

/** A money amount; the design pass adds `fmtMoney` formatting and count-up animation. */
export function MoneyText({ value, compact, className }: MoneyTextProps): ReactElement {
  return <span className={className}>{String(value)}</span>;
}
