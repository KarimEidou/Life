/*
 * One Life service worker.
 *
 * Strategy: the shell (navigations / index.html) is network-first so a
 * redeploy is picked up on the next online visit — a cache-first shell would
 * keep referencing hashed bundles the server no longer has and white-screen
 * the app. Hashed assets are content-addressed, so they are cache-first and
 * cached forever. The CACHE name only namespaces storage; correctness never
 * depends on bumping it.
 */

const CACHE = 'ol-v2';
const SHELL = ['.', 'index.html', 'manifest.webmanifest', 'icons/icon-180.png'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function isShellRequest(request) {
  if (request.mode === 'navigate') return true;
  const path = new URL(request.url).pathname;
  return path.endsWith('/') || path.endsWith('/index.html');
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = (await cache.match(request)) ?? (await cache.match('index.html'));
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(isShellRequest(request) ? networkFirst(request) : cacheFirst(request));
});
