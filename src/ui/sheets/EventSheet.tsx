import type { CSSProperties, ReactElement } from 'react';

import { Button } from '@/design-system';
import { useGameStore } from '@/store/gameStore';
import type { PendingEvent } from '@/types';

const rootStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-4)',
  /* The sheet panel already pads for the home indicator. */
  padding: 'var(--sp-5)',
  overflowY: 'auto',
  minHeight: 0,
};

const contentStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-4)',
};

const iconStyle: CSSProperties = {
  fontSize: 44,
  textAlign: 'center',
};

const textStyle: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-body)',
  textAlign: 'center',
  color: 'var(--label)',
};

/** Presents the pending event and its choices; stays up until one is picked. */
export function EventSheet(): ReactElement | null {
  const game = useGameStore((s) => s.game);
  if (game === null) {
    return null;
  }

  // Briefly undefined while the phase router is dropping this sheet.
  const card: PendingEvent | undefined = game.pending[0];
  if (card === undefined) {
    return null;
  }

  /* Drifted save data can carry a card with no choices; offering Continue
     routes it into the engine's discard recovery instead of trapping the
     life behind a button-less, non-dismissible sheet. */
  const choices = card.choices ?? [];

  return (
    <div data-testid="sheet-event" style={rootStyle}>
      {/* Keyed by the event so a queued follow-up card renders fresh. */}
      <div key={card.eventId} style={contentStyle}>
        <div aria-hidden style={iconStyle}>
          {card.icon}
        </div>
        <p data-testid="event-sheet-text" style={textStyle}>
          {card.text}
        </p>
        {choices.map((choice, index) => (
          <Button
            key={index}
            variant="tinted"
            size="lg"
            fullWidth
            testId={`event-choice-${String(index)}`}
            onClick={() => {
              useGameStore.getState().choose(index);
            }}
          >
            {choice.label}
          </Button>
        ))}
        {choices.length === 0 ? (
          <Button
            variant="tinted"
            size="lg"
            fullWidth
            testId="event-choice-0"
            onClick={() => {
              useGameStore.getState().choose(0);
            }}
          >
            Continue
          </Button>
        ) : null}
      </div>
    </div>
  );
}
