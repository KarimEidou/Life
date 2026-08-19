import { motion, useIsPresent } from 'framer-motion';
import type { CSSProperties, ReactElement, ReactNode } from 'react';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  dismissible?: boolean;
  height?: 'auto' | 'full';
  /** Framer springs ignore the CSS reduce-motion kill switch, so it is a prop. */
  reduceMotion?: boolean;
}

const overlayStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-end',
  zIndex: 20,
};

const backdropStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.4)',
};

const panelStyle: CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--bg-elevated)',
  borderTopLeftRadius: 'var(--r-lg)',
  borderTopRightRadius: 'var(--r-lg)',
  paddingBottom: 'var(--safe-bottom)',
  overflow: 'hidden',
};

const grabberStyle: CSSProperties = {
  alignSelf: 'center',
  flexShrink: 0,
  width: 36,
  height: 5,
  marginTop: 'var(--sp-2)',
  borderRadius: 'var(--r-full)',
  background: 'var(--fill)',
};

/** The modal card that springs up from the bottom edge. Mount it inside an
    `AnimatePresence` (with a key) so removal plays the exit slide. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  dismissible,
  height,
  reduceMotion,
}: SheetProps): ReactElement | null {
  /* `AnimatePresence` keeps a removed sheet mounted — and spliced back above the
     sheet below it — for the whole exit spring, so an opacity-0 backdrop still
     hit-tests. Going inert stops the exit from eating taps meant for what is now
     underneath, and from firing `onClose` for a sheet that is already gone.
     `true` outside `AnimatePresence`, where there is nothing to exit from. */
  const present = useIsPresent();
  if (!open) {
    return null;
  }
  const canDismiss = dismissible !== false;
  const still = reduceMotion === true;
  const full = height === 'full';
  return (
    <div style={{ ...overlayStyle, pointerEvents: present ? 'auto' : 'none' }}>
      <motion.div
        style={backdropStyle}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={still ? { duration: 0 } : { duration: 0.2 }}
        onClick={canDismiss ? onClose : undefined}
      />
      {/* `max-height` clamps `height`, so both have to come from the prop —
          a fixed cap here would silently keep a `full` sheet off the top edge. */}
      <motion.div
        style={{ ...panelStyle, height: full ? '100%' : 'auto', maxHeight: full ? '100%' : '90%' }}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={still ? { duration: 0 } : { type: 'spring', damping: 30, stiffness: 320 }}
      >
        <div aria-hidden style={grabberStyle} />
        {title !== undefined && title !== '' ? (
          <div style={{ fontWeight: 600, padding: 'var(--sp-3) var(--sp-4) 0' }}>{title}</div>
        ) : null}
        {children}
      </motion.div>
    </div>
  );
}
