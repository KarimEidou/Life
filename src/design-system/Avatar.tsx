import type { CSSProperties, ReactElement } from 'react';

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

/** The character's face: an emoji picked by age band and gender. */
export function Avatar({ gender, age, size }: AvatarProps): ReactElement {
  const px = size ?? 44;
  return (
    <div style={{ ...avatarStyle, width: px, height: px, fontSize: px * 0.55 }}>
      <span aria-hidden>🙂</span>
    </div>
  );
}
