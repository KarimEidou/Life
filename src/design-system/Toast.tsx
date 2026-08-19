import { motion } from 'framer-motion';
import type { CSSProperties, ReactElement } from 'react';

interface ToastProps {
  icon: string;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  /** Framer springs ignore the CSS reduce-motion kill switch, so it is a prop. */
  reduceMotion?: boolean;
}

const toastStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-3)',
  padding: 'var(--sp-3) var(--sp-4)',
  borderRadius: 'var(--r-full)',
  background: 'var(--bg-elevated-2)',
  boxShadow: 'var(--shadow-card)',
  pointerEvents: 'auto',
  textAlign: 'left',
};

/** The floating capsule that announces an achievement or a one-off result.
    Mount it inside an `AnimatePresence` (with a key) so removal fades it out. */
export function Toast({ icon, title, subtitle, onPress, reduceMotion }: ToastProps): ReactElement {
  const still = reduceMotion === true;
  return (
    <motion.button
      type="button"
      style={toastStyle}
      onClick={onPress}
      initial={{ y: -24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={still ? { duration: 0 } : { type: 'spring', damping: 26, stiffness: 400 }}
    >
      <span aria-hidden>{icon}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontWeight: 600 }}>{title}</span>
        {subtitle !== undefined && subtitle !== '' ? (
          <span
            style={{
              display: 'block',
              color: 'var(--label-2)',
              fontSize: 'var(--fs-footnote)',
            }}
          >
            {subtitle}
          </span>
        ) : null}
      </span>
    </motion.button>
  );
}
