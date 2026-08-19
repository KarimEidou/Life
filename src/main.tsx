import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root not found');
}

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// The single-file build inlines everything and ships no sibling sw.js, so the
// service worker is registered only for the regular production build.
const isSingleFile = Boolean(import.meta.env.VITE_SINGLEFILE);

if (import.meta.env.PROD && !isSingleFile && 'serviceWorker' in navigator) {
  /* `register` reports failure — private browsing, a 404 or wrong MIME type on
     sw.js, a bad scope — by rejecting, never by throwing, so only a rejection
     handler can keep a failed registration from surfacing as an unhandled
     rejection. */
  window.addEventListener(
    'load',
    () => {
      navigator.serviceWorker.register('sw.js').catch(() => {
        // Service worker is a progressive enhancement; failure is non-fatal.
      });
    },
    { once: true }
  );
}
