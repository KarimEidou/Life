import type { CSSProperties, ReactElement } from 'react';

interface ProgressBarProps {
  /** 0..100; anything unreadable reads as empty. */
  value: number;
  /** Any CSS colour, including a `var(--…)` token. */
  color?: string;
  height?: number;
  animated?: boolean;
}

const trackStyle: CSSProperties = {
  width: '100%',
  borderRadius: 'var(--r-full)',
  background: 'var(--fill-3)',
  overflow: 'hidden',
};

/** The stat meter: a rounded track with a coloured fill. */
export function ProgressBar({ value, color, height, animated }: ProgressBarProps): ReactElement {
  /* The non-finite branch carries the guard: `Math.max(0, NaN)` is NaN, and the
     CSSOM silently drops the unparsable `width:"NaN%"`, leaving the fill at
     `width:auto` — the full track. A stat a save never stored would then read as
     maxed out, the reading furthest from the truth. Unreadable means empty. */
  const pct = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  return (
    <div style={{ ...trackStyle, height: height ?? 6 }}>
      <div
        style={{
          width: `${pct}%`,
          height: '100%',
          background: color ?? 'var(--c-blue)',
          transition: animated !== false ? 'width var(--t-med) var(--ease-out)' : undefined,
        }}
      />
    </div>
  );
}
