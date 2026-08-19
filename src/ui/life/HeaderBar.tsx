import type { CSSProperties, ReactElement } from 'react';

import { getRegistry } from '@/content';
import { Avatar, MoneyText } from '@/design-system';
import { useGameStore } from '@/store/gameStore';
import { stageForAge } from '@/types';
import type { SchoolDef } from '@/types';

const barStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-3)',
  padding: 'calc(var(--safe-top) + var(--sp-3)) var(--sp-4) var(--sp-3)',
  background: 'var(--bg-elevated)',
  boxShadow: 'var(--shadow-card)',
};

const nameColumnStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
};

const nameStyle: CSSProperties = {
  fontSize: 'var(--fs-headline)',
  fontWeight: 600,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const subtitleStyle: CSSProperties = {
  color: 'var(--label-2)',
  fontSize: 'var(--fs-footnote)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const trailingStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: 2,
};

const moneyStyle: CSSProperties = {
  fontSize: 'var(--fs-headline)',
  fontWeight: 600,
  color: 'var(--c-green)',
};

const captionStyle: CSSProperties = {
  color: 'var(--label-2)',
  fontSize: 'var(--fs-caption)',
};

/** Top of the life screen: avatar, name, age, year and money. */
export function HeaderBar(): ReactElement | null {
  const game = useGameStore((s) => s.game);
  if (game === null) {
    return null;
  }
  const reg = getRegistry();
  const c = game.character;

  let subtitle: string;
  if (c.job !== null) {
    subtitle = c.job.title;
  } else if (c.education.enrolledIn !== undefined && c.education.enrolledIn !== '') {
    const school: SchoolDef | undefined = reg.schoolsById[c.education.enrolledIn];
    subtitle = school !== undefined ? school.label : 'Student';
  } else {
    const stage = stageForAge(c.age);
    subtitle = stage.charAt(0).toUpperCase() + stage.slice(1);
  }

  return (
    <div style={barStyle}>
      <Avatar gender={c.gender} age={c.age} size={44} />
      <div style={nameColumnStyle}>
        <div style={nameStyle}>
          {c.firstName} {c.lastName}
        </div>
        <div style={subtitleStyle}>{subtitle}</div>
      </div>
      <div style={trailingStyle}>
        <span data-testid="header-money" style={moneyStyle}>
          <MoneyText compact value={c.money} />
        </span>
        <span data-testid="header-age" style={captionStyle}>
          Age {c.age} · {game.year}
        </span>
      </div>
    </div>
  );
}
