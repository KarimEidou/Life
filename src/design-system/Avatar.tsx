import type { CSSProperties, ReactElement } from 'react';

import { stageForAge } from '@/types';
import type { Stage } from '@/types';

interface AvatarProps {
  gender: string;
  age: number;
  size?: number;
}

const avatarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 'var(--r-full)',
  background: 'var(--fill-3)',
};

/* One face per age band and gender; unknown genders take the neutral column. */
const FACES: Record<Stage, { male: string; female: string; other: string }> = {
  infant: { male: '👶', female: '👶', other: '👶' },
  toddler: { male: '👦', female: '👧', other: '🧒' },
  child: { male: '👦', female: '👧', other: '🧒' },
  teen: { male: '👦', female: '👧', other: '🧑' },
  adult: { male: '👨', female: '👩', other: '🧑' },
  senior: { male: '👴', female: '👵', other: '🧓' },
};

function faceFor(gender: string, age: number): string {
  const row = FACES[stageForAge(age)];
  if (gender === 'male') {
    return row.male;
  }
  if (gender === 'female') {
    return row.female;
  }
  return row.other;
}

/** The character's face: an emoji picked by age band and gender. */
export function Avatar({ gender, age, size }: AvatarProps): ReactElement {
  const px = size ?? 44;
  return (
    <div style={{ ...avatarStyle, width: px, height: px, fontSize: px * 0.55 }}>
      <span aria-hidden>{faceFor(gender, age)}</span>
    </div>
  );
}
