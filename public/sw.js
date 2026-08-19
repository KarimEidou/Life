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

// Cache Storage is keyed by origin, not by worker scope: on GitHub Pages every
// project site shares https://<user>.github.io, so the activate purge must only
// touch this app's own caches or it wipes unrelated apps' offline storage.
const CACHE_PREFIX = 'ol-';
const CACHE = `${CACHE_PREFIX}v2`;
const SHELL = ['.', 'index.html', 'manifest.webmanifest', 'icons/icon-180.png'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isShellRequest(request) {
  if (request.mode === 'navigate') return true;
  const path = new URL(request.url).pathname;
  return path.endsWith('/') || path.endsWith('/index.html');
}

// A bare cache.put() is not tracked by the fetch event, so the browser may
// terminate the worker mid-write and leave the entry missing; it also rejects on
// quota exhaustion and on 206 responses (which response.ok admits), with nothing
// to handle the rejection. waitUntil keeps the worker alive for the write.
function cacheResponse(event, cache, request, response) {
  event.waitUntil(cache.put(request, response.clone()).catch(() => {}));
}

async function networkFirst(event, request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cacheResponse(event, cache, request, response);
    return response;
  } catch (err) {
    const cached = (await cache.match(request)) ?? (await cache.match('index.html'));
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(event, request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cacheResponse(event, cache, request, response);
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    isShellRequest(request) ? networkFirst(event, request) : cacheFirst(event, request),
  );
});
