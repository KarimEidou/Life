import type { CSSProperties, ReactElement, ReactNode } from 'react';

import { Button, Card, EmptyState, ListRow, MoneyText, SectionHeader } from '@/design-system';
import { useGameStore } from '@/store/gameStore';
import { LegacyPrompt } from '@/ui/death/LegacyPrompt';
import { aliveChildren } from '@/ui/lib/feed';

const rootStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  overflowY: 'auto',
  alignItems: 'center',
  padding: 'var(--sp-6) var(--sp-4)',
};

/* Auto vertical margins centre a short obituary and give way to scrolling
   when ancestors and heirs make the column tall. */
const columnStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-4)',
  width: '100%',
  maxWidth: 440,
  marginTop: 'auto',
  marginBottom: 'auto',
};

const obituaryStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 'var(--sp-2)',
  textAlign: 'center',
};

const tombstoneStyle: CSSProperties = {
  fontSize: 56,
  lineHeight: 1,
};

const nameStyle: CSSProperties = {
  fontSize: 'var(--fs-title2)',
  fontWeight: 700,
  lineHeight: 'var(--lh-title2)',
};

const obituaryTextStyle: CSSProperties = {
  color: 'var(--label-2)',
};

const statsBlockStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-1)',
  width: '100%',
  marginTop: 'var(--sp-2)',
  textAlign: 'left',
};

const statRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 'var(--sp-3)',
};

const statLabelStyle: CSSProperties = {
  color: 'var(--label-2)',
};

/** The obituary: cause of death, age, epitaph stats and what happens next. */
export function DeathScreen(): ReactElement {
  const game = useGameStore((s) => s.game);

  const backToMenu = (): void => {
    useGameStore.getState().abandonLife();
  };

  if (game === null || game.death === undefined) {
    return (
      <div data-testid="screen-death" style={rootStyle}>
        <div style={columnStyle}>
          <EmptyState icon="🪦" title="No life here" message="This life has already been laid to rest." />
          <Button variant="filled" fullWidth testId="death-back-to-slots" onClick={backToMenu}>
            Back to menu
          </Button>
        </div>
      </div>
    );
  }

  const death = game.death;
  const statRows: { label: string; value: ReactNode }[] = [
    { label: 'Net worth', value: <MoneyText value={death.epitaphStats.netWorth} /> },
    { label: 'Jobs held', value: String(death.epitaphStats.jobsHeld) },
    { label: 'Children', value: String(death.epitaphStats.kids) },
    { label: 'Generation', value: String(game.generation) },
  ];
  const hasHeirs = aliveChildren(game).length > 0;

  return (
    <div data-testid="screen-death" style={rootStyle}>
      <div style={columnStyle}>
        <div data-testid="death-obituary">
          <Card>
            <div style={obituaryStyle}>
              <div aria-hidden style={tombstoneStyle}>
                🪦
              </div>
              <div style={nameStyle}>
                {game.character.firstName} {game.character.lastName}
              </div>
              <div data-testid="death-cause">{`${death.cause} at age ${String(death.age)}`}</div>
              <p style={obituaryTextStyle}>{death.obituary}</p>
              <div data-testid="death-stats" style={statsBlockStyle}>
                {statRows.map((row) => (
                  <div key={row.label} style={statRowStyle}>
                    <span style={statLabelStyle}>{row.label}</span>
                    <span>{row.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>
        {game.ancestors.length > 0 ? (
          <div>
            <SectionHeader>Ancestors</SectionHeader>
            <Card>
              {game.ancestors.map((a, index) => (
                <ListRow
                  key={`${a.name}-${String(index)}`}
                  title={a.name}
                  subtitle={`${a.years} · ${a.cause}`}
                />
              ))}
            </Card>
          </div>
        ) : null}
        <LegacyPrompt />
        <Button
          variant={hasHeirs ? 'plain' : 'filled'}
          size="lg"
          fullWidth
          testId="death-back-to-slots"
          onClick={backToMenu}
        >
          Back to menu
        </Button>
      </div>
    </div>
  );
}
