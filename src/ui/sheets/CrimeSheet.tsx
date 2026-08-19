import type { CSSProperties, ReactElement } from 'react';

import { getRegistry } from '@/content';
import { Card, ListRow, ProgressBar } from '@/design-system';
import { fmtMoney, fmtMoneyCompact } from '@/engine/format';
import { availableInteractions } from '@/engine/interactions';
import { useGameStore } from '@/store/gameStore';
import { useUiStore } from '@/store/uiStore';
import { gateFor } from '@/ui/lib/feed';
import { SheetChrome } from '@/ui/sheets/SheetChrome';

const cardColStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-3)',
};

const strongStyle: CSSProperties = {
  fontWeight: 600,
};

const metaStyle: CSSProperties = {
  color: 'var(--label-2)',
  fontSize: 'var(--fs-footnote)',
};

const listGroupStyle: CSSProperties = {
  background: 'var(--bg-elevated)',
  borderRadius: 'var(--r-lg)',
  overflow: 'hidden',
};

const dimStyle: CSSProperties = {
  opacity: 0.55,
};

/**
 * Half again the rolled sentence, from the second conviction on.
 *
 * `commitCrime` keeps its `REPEAT_OFFENDER_MULT` private, so the ceiling a row
 * promises and the one the engine hands down can only be held in step by hand.
 * They have to be: on a crime whose term is rolled at the top of its range, a
 * repeat offender serves half again the number an unscaled row advertises.
 */
const REPEAT_OFFENDER_MULT = 1.5;

/**
 * One count off a stored sentence, read defensively.
 *
 * `PrisonState` comes back from `JSON.parse` on every load and `loadGame` checks
 * only that it is an object, so both counts are whatever the file held — a
 * fractional or negative year, a NaN that renders as `width: "NaN%"`, or the
 * `{ yearsLeft: 0, totalYears: 0 }` cell that builds before "no time, no cell"
 * wrote and saved. An unreadable count is no time at all.
 */
function years(raw: number): number {
  return Number.isFinite(raw) ? Math.max(0, Math.round(raw)) : 0;
}

/** The crimes that can be committed, with their odds and sentences. */
export function CrimeSheet(): ReactElement | null {
  const game = useGameStore((s) => s.game);
  if (game === null) {
    return null;
  }

  const c = game.character;
  const reg = getRegistry();
  const prison = c.prison;

  if (prison !== null) {
    const actions = availableInteractions(game, reg, 'prison');
    const left = years(prison.yearsLeft);
    /* `extendSentence` keeps `totalYears >= yearsLeft`; a save that drifted out
       of that would fill the bar backwards, so repair it the way the engine
       does rather than showing less time than is actually left to serve. */
    const total = Math.max(years(prison.totalYears), left);
    return (
      <SheetChrome id="crime" title="Crime">
        <Card>
          <div style={cardColStyle}>
            <div style={strongStyle}>In prison for {prison.crime}</div>
            {/* A term with nothing left to serve reads as none of it served, the
                way every sentence does on the year it is handed down — a full
                bar would call it over while the sheet is still the prison view
                and every `free()` row refuses. `careerPhase` opens the door on
                the next age-up, which is what the line below promises. */}
            <ProgressBar value={total > 0 ? ((total - left) / total) * 100 : 0} animated />
            <div style={metaStyle}>
              {left > 0
                ? `${left} of ${total} ${total === 1 ? 'year' : 'years'} left`
                : 'Out by the end of the year'}
            </div>
          </div>
        </Card>

        {actions.length > 0 ? (
          <div style={listGroupStyle}>
            {actions.map((def) => {
              const gate = gateFor(game, reg, def);
              return (
                // Gated rows stay tappable; the engine refuses with a headline.
                <ListRow
                  key={def.id}
                  testId={`prison-action-${def.id}`}
                  icon={def.icon}
                  title={def.label}
                  subtitle={gate.ok ? undefined : gate.reason}
                  value={gate.cost !== undefined && gate.cost > 0 ? fmtMoney(gate.cost) : undefined}
                  onClick={() => {
                    const r = useGameStore.getState().interact(def.id);
                    if (r !== null) {
                      useUiStore.getState().addToast({ icon: r.icon, title: r.text });
                    }
                  }}
                />
              );
            })}
          </div>
        ) : null}
      </SheetChrome>
    );
  }

  /* Read the record the way `commitCrime` reads it — flags are free-form JSON
     and a coercible one counts there — so the ceiling below is the term the
     next conviction can actually carry, not the roll it starts from. */
  const convictions = Number(c.flags.convictions ?? 0);
  const repeatOffender = Number.isFinite(convictions) && convictions > 0;

  return (
    <SheetChrome id="crime" title="Crime">
      <div style={listGroupStyle}>
        {reg.crimes.map((crime) => {
          const tooYoung = c.age < crime.minAge;
          const maxYears = repeatOffender
            ? Math.round(crime.sentenceYears[1] * REPEAT_OFFENDER_MULT)
            : crime.sentenceYears[1];
          return (
            // Underage rows dim but stay tappable; the engine refuses safely.
            <div key={crime.id} style={tooYoung ? dimStyle : undefined}>
              <ListRow
                testId={`crime-row-${crime.id}`}
                icon={crime.icon}
                title={crime.label}
                subtitle={
                  tooYoung
                    ? "You're too young."
                    : `${fmtMoneyCompact(crime.payout[0])}–${fmtMoneyCompact(crime.payout[1])} · up to ${maxYears} yr`
                }
                onClick={() => {
                  const r = useGameStore.getState().crime(crime.id);
                  if (r !== null) {
                    useUiStore.getState().addToast({ icon: r.icon, title: r.text });
                  }
                }}
              />
            </div>
          );
        })}
      </div>
    </SheetChrome>
  );
}
