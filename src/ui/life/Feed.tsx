import { useEffect, useRef } from 'react';
import type { CSSProperties, ReactElement } from 'react';

import { useGameStore } from '@/store/gameStore';
import { LOG_KIND_COLOR } from '@/ui/lib/feed';

const feedStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  padding: 'var(--sp-4)',
};

const yearHeaderStyle: CSSProperties = {
  padding: 'var(--sp-4) 0 var(--sp-2)',
  color: 'var(--label-2)',
  fontSize: 'var(--fs-footnote)',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 'var(--ls-wide)',
};

const entryStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 'var(--sp-2)',
  padding: 'var(--sp-1) 0',
  fontSize: 'var(--fs-subhead)',
};

/** The life story: every year's log lines, pinned to the newest entry. */
export function Feed(): ReactElement | null {
  const game = useGameStore((s) => s.game);
  const scrollRef = useRef<HTMLDivElement>(null);

  /* `game` gets a fresh identity on every commit while `game.log` is mutated
     in place, so the game object itself is the dependable signal that the log
     may have grown. */
  useEffect(() => {
    const el = scrollRef.current;
    if (el !== null) {
      el.scrollTop = el.scrollHeight;
    }
  }, [game]);

  if (game === null) {
    return null;
  }

  return (
    <div data-testid="feed" ref={scrollRef} style={feedStyle} className="no-scrollbar">
      {game.log.map((yearLog) => (
        <div key={yearLog.age}>
          <div data-testid={`feed-year-${yearLog.age}`} style={yearHeaderStyle}>
            Age {yearLog.age} — {yearLog.year}
          </div>
          {yearLog.entries.map((entry, index) => (
            <div
              /* Entries are append-only within a year, so the index is stable. */
              key={index}
              data-testid="feed-entry"
              style={entryStyle}
            >
              <span aria-hidden>{entry.icon}</span>
              <span
                style={{
                  color: LOG_KIND_COLOR[entry.kind],
                  fontWeight:
                    entry.kind === 'death' || entry.kind === 'achievement' ? 600 : undefined,
                }}
              >
                {entry.text}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
