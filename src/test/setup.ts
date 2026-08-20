/**
 * The shared boot for every jsdom test. `vitest.workspace.ts` loads it into the
 * `dom` project automatically, so a `*.test.tsx` file gets it for free; a
 * `*.test.ts` that opts into a DOM with a `// @vitest-environment jsdom`
 * docblock stays in the node project and has to import it itself — directly, or
 * through `@/ui/__tests__/helpers/dom`.
 */

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

import { memoryStorage } from '@/engine/save';
import { resetGameStoreForTests } from '@/store/gameStore';
import { useUiStore } from '@/store/uiStore';

if (typeof window === 'undefined') {
  throw new Error(
    'The jsdom harness needs a DOM: name the file *.test.tsx, or add a `// @vitest-environment jsdom` docblock.',
  );
}

/* React 18 tells React Testing Library it may render outside `act()` through
   this global; without it every render logs an act() warning. */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* jsdom 25 ships neither of these, and both are probed during render:
   `useEffectiveReduceMotion` and `applyTheme` ask for a media query, and
   framer-motion measures with a ResizeObserver. The stubs answer "no
   preference" and "never resizes" — a test that needs a live query installs its
   own fake over the top, so each stub only fills a gap it finds. */
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: (): void => {},
    removeEventListener: (): void => {},
    addListener: (): void => {},
    removeListener: (): void => {},
    dispatchEvent: (): boolean => false,
  })) as unknown as typeof window.matchMedia;
}

if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
}

beforeEach(() => {
  /* jsdom *does* provide localStorage, so without this both stores would carry
     a previous test's save and settings into the next one. */
  localStorage.clear();
  resetGameStoreForTests(memoryStorage());
  /* `reduceMotion: true` is load-bearing, not cosmetic: framer springs ignore
     the CSS kill switch, so it is what makes every Sheet and Toast transition
     `{ duration: 0 }` and lets an exit settle inside one `waitFor`. A test that
     asserts the shipped default must set `settings` itself. */
  useUiStore.setState({
    screen: 'slots',
    sheets: [],
    toasts: [],
    settings: { theme: 'auto', reduceMotion: true },
  });
});

/* RTL only auto-registers this when `test.globals` is on, which this repo does
   not set — so an unmounted tree would otherwise stay in the document. */
afterEach(() => {
  cleanup();
});
