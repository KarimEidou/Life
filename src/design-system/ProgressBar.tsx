import type { CSSProperties, ReactElement } from 'react';

interface ProgressBarProps {
  /** 0..100. */
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
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div style={{ ...trackStyle, height: height ?? 6 }}>
      <div
        style={{
          width: `${pct}%`,
          height: '100%',
          background: color ?? 'var(--c-blue)',
        }}
      />
    </div>
  );
}
