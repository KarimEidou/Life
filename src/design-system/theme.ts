/**
 * Theme + reduced-motion application.
 *
 * Declared locally rather than imported from @/types so this module stays
 * dependency-free; the literal union is structurally identical.
 */
export type ThemeSetting = 'auto' | 'light' | 'dark';

type ResolvedTheme = 'light' | 'dark';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** Browser chrome colour per theme — matches --bg in tokens.css. */
const THEME_COLOR: Record<ResolvedTheme, string> = {
  light: '#F2F2F7',
  dark: '#000000',
};

/* The live 'auto' subscription. Held at module scope so each applyTheme() call
   can detach the previous listener instead of stacking a new one. */
let watchedQuery: MediaQueryList | null = null;
let watchHandler: ((event: MediaQueryListEvent) => void) | null = null;

function getDarkQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return null;
  }
  return window.matchMedia(DARK_QUERY);
}

function stopWatching(): void {
  const query = watchedQuery;
  const handler = watchHandler;
  watchedQuery = null;
  watchHandler = null;

  if (!query || !handler) {
    return;
  }
  if (typeof query.removeEventListener === 'function') {
    query.removeEventListener('change', handler);
  } else if (typeof query.removeListener === 'function') {
    // Safari < 14 only ships the deprecated MediaQueryList listener API.
    query.removeListener(handler);
  }
}

function startWatching(query: MediaQueryList, handler: (event: MediaQueryListEvent) => void): void {
  watchedQuery = query;
  watchHandler = handler;

  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', handler);
  } else if (typeof query.addListener === 'function') {
    query.addListener(handler);
  }
}

function resolveTheme(setting: ThemeSetting): ResolvedTheme {
  if (setting === 'light' || setting === 'dark') {
    return setting;
  }
  const query = getDarkQuery();
  return query !== null && query.matches ? 'dark' : 'light';
}

function updateThemeColorMeta(theme: ResolvedTheme): void {
  const color = THEME_COLOR[theme];
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');

  if (metas.length === 0) {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    meta.setAttribute('content', color);
    document.head.appendChild(meta);
    return;
  }

  /* index.html ships one meta per prefers-color-scheme. Both are overwritten so
     that whichever the OS matches reports the theme the app actually applied. */
  metas.forEach((meta) => {
    meta.setAttribute('content', color);
  });
}

function applyResolvedTheme(theme: ResolvedTheme): void {
  if (typeof document === 'undefined') {
    return;
  }
  document.documentElement.dataset.theme = theme;
  updateThemeColorMeta(theme);
}

export function applyTheme(setting: ThemeSetting): void {
  stopWatching();
  applyResolvedTheme(resolveTheme(setting));

  if (setting !== 'auto') {
    return;
  }
  const query = getDarkQuery();
  if (query === null) {
    return;
  }
  startWatching(query, (event: MediaQueryListEvent): void => {
    applyResolvedTheme(event.matches ? 'dark' : 'light');
  });
}

export function applyReduceMotion(on: boolean): void {
  if (typeof document === 'undefined') {
    return;
  }
  document.documentElement.dataset.reduceMotion = String(on);
}
