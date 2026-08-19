import type { ReactElement } from 'react';

import { fmtMoney, fmtMoneyCompact } from '@/engine/format';

interface MoneyTextProps {
  value: number;
  compact?: boolean;
  className?: string;
}

/** A money amount in whole dollars; `compact` abbreviates thousands and millions. */
export function MoneyText({ value, compact, className }: MoneyTextProps): ReactElement {
  return (
    <span className={className} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {compact === true ? fmtMoneyCompact(value) : fmtMoney(value)}
    </span>
  );
}
