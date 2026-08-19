import { useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';

import { getRegistry } from '@/content';
import { Alert, Card, ListRow, ProgressBar, SectionHeader } from '@/design-system';
import { fmtMoney } from '@/engine/format';
import { availableInteractions } from '@/engine/interactions';
import { useGameStore } from '@/store/gameStore';
import { useUiStore } from '@/store/uiStore';
import type { CountryDef, InteractionDef } from '@/types';
import { gateFor } from '@/ui/lib/feed';
import { SheetChrome } from '@/ui/sheets/SheetChrome';

const fameBarStyle: CSSProperties = {
  padding: 'var(--sp-2) var(--sp-4)',
};

/** Prose for `emigrate`'s machine-readable refusal vocabulary. */
function refusalProse(result: { reason?: string; text?: string }): string {
  switch (result.reason) {
    case 'too-young':
      return 'You must be an adult to emigrate.';
    case 'no-money':
      return 'You need $2,000 for the visa.';
    case 'cooldown':
      return 'You applied too recently.';
    case 'denied':
      return result.text ?? 'Your visa was denied.';
    case 'in-prison':
      return 'Not from a prison cell.';
    default:
      return "You can't move there right now.";
  }
}

/** How a destination's 0..1 visa difficulty reads, by thirds. */
function visaWord(difficulty: number): string {
  if (difficulty < 1 / 3) {
    return 'easy';
  }
  if (difficulty < 2 / 3) {
    return 'tricky';
  }
  return 'hard';
}

/** Achievements, settings, fame, emigration and the ancestor line. */
export function MoreSheet(): ReactElement | null {
  const game = useGameStore((s) => s.game);
  const [moveTarget, setMoveTarget] = useState<CountryDef | null>(null);
  if (game === null) {
    return null;
  }

  const reg = getRegistry();
  const c = game.character;
  const fameActions = availableInteractions(game, reg, 'fame');
  const destinations = reg.countries.filter((def) => def.id !== c.countryId);

  const runFame = (def: InteractionDef): void => {
    const r = useGameStore.getState().interact(def.id);
    if (r !== null) {
      useUiStore.getState().addToast({ icon: r.icon, title: r.text });
    }
  };

  const move = (def: CountryDef): void => {
    setMoveTarget(null);
    const r = useGameStore.getState().emigrate(def.id);
    if (r.ok) {
      useUiStore.getState().addToast({ icon: def.flag, title: r.text ?? 'Welcome!' });
    } else {
      useUiStore.getState().addToast({ icon: '🛂', title: refusalProse(r) });
    }
  };

  return (
    <SheetChrome id="more" title="More">
      <Card>
        <ListRow
          icon="🎓"
          title="Education"
          chevron
          testId="more-education"
          onClick={() => {
            useUiStore.getState().pushSheet('education');
          }}
        />
        <ListRow
          icon="💰"
          title="Money"
          chevron
          testId="more-finance"
          onClick={() => {
            useUiStore.getState().pushSheet('finance');
          }}
        />
        <ListRow
          icon="🏥"
          title="Health"
          chevron
          testId="more-health"
          onClick={() => {
            useUiStore.getState().pushSheet('health');
          }}
        />
        <ListRow
          icon="🚔"
          title="Crime"
          chevron
          testId="more-crime"
          onClick={() => {
            useUiStore.getState().pushSheet('crime');
          }}
        />
        <ListRow
          icon="🎰"
          title="Casino"
          chevron
          testId="more-casino"
          onClick={() => {
            useUiStore.getState().pushSheet('casino');
          }}
        />
        <ListRow
          icon="🏆"
          title="Achievements"
          chevron
          testId="more-achievements"
          onClick={() => {
            useUiStore.getState().pushSheet('achievements');
          }}
        />
        <ListRow
          icon="⚙️"
          title="Settings"
          chevron
          testId="more-settings"
          onClick={() => {
            useUiStore.getState().pushSheet('settings');
          }}
        />
      </Card>
      {c.fame > 0 || fameActions.length > 0 ? (
        <div>
          <SectionHeader>Fame</SectionHeader>
          <Card>
            <div style={fameBarStyle}>
              <ProgressBar value={c.fame} />
            </div>
            {fameActions.map((def) => {
              const gate = gateFor(game, reg, def);
              return (
                <ListRow
                  key={def.id}
                  testId={`fame-action-${def.id}`}
                  icon={def.icon}
                  title={def.label}
                  subtitle={gate.ok ? undefined : gate.reason}
                  value={gate.cost !== undefined && gate.cost > 0 ? fmtMoney(gate.cost) : undefined}
                  onClick={() => {
                    runFame(def);
                  }}
                />
              );
            })}
          </Card>
        </div>
      ) : null}
      <div>
        <SectionHeader>Emigrate</SectionHeader>
        <Card>
          {destinations.map((def) => (
            <ListRow
              key={def.id}
              testId={`emigrate-${def.id}`}
              icon={def.flag}
              title={def.label}
              subtitle={`Visa: ${visaWord(def.visaDifficulty)}`}
              onClick={() => {
                setMoveTarget(def);
              }}
            />
          ))}
        </Card>
      </div>
      {game.ancestors.length > 0 ? (
        <div>
          <SectionHeader>Ancestors</SectionHeader>
          <Card>
            {game.ancestors.map((ancestor) => (
              <ListRow
                key={`${ancestor.name}-${ancestor.years}`}
                title={ancestor.name}
                subtitle={`${ancestor.years} · ${ancestor.cause}`}
              />
            ))}
          </Card>
        </div>
      ) : null}
      {moveTarget !== null ? (
        <Alert
          open
          title={`Move to ${moveTarget.label}?`}
          message="The visa costs $2,000."
          actions={[
            {
              label: 'Move',
              testId: 'alert-action-move',
              onPress: () => {
                move(moveTarget);
              },
            },
            {
              label: 'Cancel',
              style: 'cancel',
              onPress: () => {
                setMoveTarget(null);
              },
            },
          ]}
        />
      ) : null}
    </SheetChrome>
  );
}
