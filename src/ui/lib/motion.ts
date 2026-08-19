/**
 * Framer-motion springs ignore the CSS reduce-motion kill switch, so motion
 * components take an explicit flag. This hook is its one source of truth:
 * the in-app toggle OR the OS-level prefers-reduced-motion setting.
 */

import { useEffect, useState } from 'react';

import { useUiStore } from '@/store/uiStore';

function osPrefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** True when either the in-app toggle or the OS asks for reduced motion. */
export function useEffectiveReduceMotion(): boolean {
  const setting = useUiStore((s) => s.settings.reduceMotion);
  const [osPrefers, setOsPrefers] = useState(osPrefersReducedMotion);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (): void => {
      setOsPrefers(query.matches);
    };
    // Safari < 14 only has the deprecated listener pair.
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', onChange);
      return () => {
        query.removeEventListener('change', onChange);
      };
    }
    query.addListener(onChange);
    return () => {
      query.removeListener(onChange);
    };
  }, []);

  return setting || osPrefers;
}
