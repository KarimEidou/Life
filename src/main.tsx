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
  window.addEventListener('load', () => {
    try {
      void navigator.serviceWorker.register('sw.js');
    } catch {
      // Service worker is a progressive enhancement; failure is non-fatal.
    }
  });
}
