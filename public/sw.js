/*
 * One Life service worker — tiny cache-first app-shell cache.
 *
 * Updates ship by bumping CACHE: the renamed cache makes the new worker
 * precache fresh copies on install, and activate deletes every old cache.
 */
const CACHE = 'ol-v1';
const PRECACHE = ['.', 'index.html', 'manifest.webmanifest', 'icons/icon-180.png'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') {
    return;
  }
  if (new URL(req.url).origin !== self.location.origin) {
    return;
  }
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached !== undefined) {
        return cached;
      }
      return fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch((err) => {
          // Offline: serve the cached shell for navigations, fail otherwise.
          if (req.mode === 'navigate') {
            return caches.match('index.html').then((shell) => {
              if (shell !== undefined) {
                return shell;
              }
              throw err;
            });
          }
          throw err;
        });
    })
  );
});
