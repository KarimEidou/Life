import { motion } from 'framer-motion';
import type { CSSProperties, ReactElement } from 'react';

import { useGameStore } from '@/store/gameStore';
import { useEffectiveReduceMotion } from '@/ui/lib/motion';

const buttonStyle: CSSProperties = {
  width: '100%',
  padding: 'var(--sp-3)',
  borderRadius: 'var(--r-full)',
  background: 'var(--c-green)',
  color: '#ffffff',
  fontSize: 'var(--fs-headline)',
  fontWeight: 700,
  textAlign: 'center',
};

/** The big green button that advances the year (or re-opens a pending choice). */
export function AgeButton(): ReactElement | null {
  const phase = useGameStore((s) => s.game?.phase);
  const reduceMotion = useEffectiveReduceMotion();
  if (phase === undefined || phase === 'dead') {
    return null;
  }
  return (
    <motion.button
      type="button"
      data-testid="age-button"
      style={buttonStyle}
      whileTap={{ scale: 0.96 }}
      transition={
        reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 30 }
      }
      onClick={() => {
        useGameStore.getState().ageUp();
      }}
    >
      {phase === 'alive' ? '+ Age up' : 'Decide…'}
    </motion.button>
  );
}
