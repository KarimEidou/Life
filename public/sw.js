/*
 * One Life service worker.
 *
 * Strategy: the shell (navigations / index.html) is network-first so a
 * redeploy is picked up on the next online visit — a cache-first shell would
 * keep referencing hashed bundles the server no longer has and white-screen
 * the app. Hashed assets are content-addressed, so they are cache-first, and
 * they are kept until a redeploy's shell stops naming them. Every other
 * same-origin GET is stale-while-revalidate, so no strategy here can pin a
 * resource to one build. The CACHE name only namespaces storage; correctness
 * never depends on bumping it.
 */

// Cache Storage is keyed by origin, not by worker scope: on GitHub Pages every
// project site shares https://<user>.github.io, so the activate purge must only
// touch this app's own caches or it wipes unrelated apps' offline storage.
const CACHE_PREFIX = 'ol-';
const CACHE = `${CACHE_PREFIX}v2`;

/* The shell document lives under exactly one key, the one real navigations use
   (`start_url: "."` resolves here). Keying it by the navigated URL instead both
   splits it across an entry per query string — `?fbclid=…`, `?utm_source=…`,
   none of which the next navigation matches — and leaves whichever key the user
   never navigates to refreshed only by install, which runs once per
   registration: a fallback frozen at the build that first installed the app. */
const SHELL_URL = new URL('./', self.location.href).href;
const SHELL = [SHELL_URL, 'manifest.webmanifest', 'icons/icon-180.png'];

/* The bundles index.html points at carry a per-build content hash, so SHELL
   cannot name them — and the page never asks this worker for them on the visit
   that installs it, because registration happens on `load`, by which time the
   browser has already fetched them uncontrolled. Precaching SHELL alone
   therefore stores a shell whose script and stylesheet are missing, and the
   first offline launch of the installed app paints nothing. Reading them back
   out of the shell HTML keeps the list correct without knowing the hashes. */
const SUBRESOURCE_TAG = /<(?:script|link)\b[^>]*>/gi;
const SUBRESOURCE_URL = /\s(?:src|href)\s*=\s*["']([^"']*)["']/i;

function subresourcesOf(html, docUrl) {
  const urls = new Set();
  for (const tag of html.match(SUBRESOURCE_TAG) ?? []) {
    const attr = SUBRESOURCE_URL.exec(tag);
    if (!attr) continue;
    let url;
    try {
      url = new URL(attr[1], docUrl);
    } catch {
      continue;
    }
    url.hash = '';
    // Cross-origin and data: subresources are not this cache's business, and
    // the document itself is stored by the caller, not as one of its own deps.
    if (url.origin === self.location.origin && url.href !== docUrl) urls.add(url.href);
  }
  return [...urls];
}

// addAll always goes to the network, so re-adding entries that are already
// stored would re-download the whole app on every navigation. A hit is current
// by construction: the bundle URLs are content-addressed and the rest is SHELL.
async function addMissing(cache, urls) {
  const missing = await Promise.all(
    urls.map(async (url) => ((await cache.match(url)) ? null : url)),
  );
  await cache.addAll(missing.filter((url) => url !== null));
}

async function precache() {
  const cache = await caches.open(CACHE);
  await cache.addAll(SHELL);
  // Earlier workers precached the shell a second time under `index.html`.
  // Nothing writes or reads that key now, and the prune below only ever drops
  // hashed bundles, so an upgrade has to delete it here or it keeps a dead
  // first-visit build forever.
  await cache.delete(new URL('index.html', self.location.href).href);
  // Any rejection from here on fails the install, which discards the
  // registration so that the next page load retries the whole precache. That is
  // the wanted outcome: install runs at most once per registration, so a worker
  // that went live holding a shell it cannot render would serve that blank page
  // for good, while a retry costs nothing.
  const shell = await cache.match(SHELL_URL);
  const subresources = subresourcesOf(await shell.text(), SHELL_URL);
  // Before the bundles rather than after, unlike cacheShell: addAll has already
  // replaced the stored shell, so whatever this drops is dead either way, and an
  // upgrade reaching a cache that earlier builds filled to the quota can only
  // store this build's bundles once it has reclaimed theirs.
  await pruneSuperseded(cache, subresources);
  await addMissing(cache, subresources);
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(precache());
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

/* Only the bundles under assets/ carry a per-build content hash, and that hash
   is the whole licence for never revalidating them: new bytes get a new URL.
   The manifest and the icons keep one URL across every deploy, so answering
   those from the cache unchecked would pin them to the copy the first-ever
   visit fetched — a redeploy changes neither this file's bytes, so install
   never re-runs, nor the CACHE name, so activate's purge finds nothing to drop,
   leaving no writer able to replace the entry. Matching too narrowly here costs
   one revalidation; matching too widely freezes a URL for the installation. */
const HASHED_ASSET = /\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/;

function isHashedAsset(url) {
  return HASHED_ASSET.test(new URL(url).pathname);
}

// A bare cache.put() is not tracked by the fetch event, so the browser may
// terminate the worker mid-write and leave the entry missing; it also rejects on
// quota exhaustion and on 206 responses (which response.ok admits), with nothing
// to handle the rejection. waitUntil keeps the worker alive for the write.
function cacheResponse(event, cache, request, response) {
  event.waitUntil(cache.put(request, response.clone()).catch(() => {}));
}

/* Nothing else reclaims what deploys accumulate: activate's purge only drops
   caches under some other name, and CACHE is a literal no deploy changes. Every
   build's bundles arrive under a fresh content-hashed URL, so without this each
   redeploy would leave its predecessor's ~555 KB stored for good, until the
   origin's quota is spent and cache.put starts rejecting for the build that is
   actually live. Only the bundles are build-scoped — the shell, the manifest and
   the icons keep one URL across deploys, and dropping those would buy nothing
   and cost a re-download. */
async function pruneSuperseded(cache, urls) {
  const live = new Set(urls.filter((url) => isHashedAsset(url)));
  // A 2xx document naming no bundle at all is not a shell this app built — a
  // captive portal or an ISP error page arrives as one. Reading its empty list
  // as "every stored bundle is dead" would throw away a working offline cache.
  if (live.size === 0) return;
  const stored = await cache.keys();
  await Promise.all(
    stored
      .filter((request) => isHashedAsset(request.url) && !live.has(request.url))
      .map((request) => cache.delete(request)),
  );
}

// A fresh shell is only worth storing together with the bundles it names: on a
// flaky link the ~1 KB HTML of a new build arrives while its 550 KB bundle does
// not, and writing the HTML on its own would swap a cache that works offline for
// one that white-screens. Assets first, shell last, so a failed asset leaves the
// previous complete snapshot in place. The caller's waitUntil covers the writes.
async function cacheShell(cache, response) {
  const html = await response.clone().text();
  // Relative subresources resolve against the document's URL, and every URL the
  // shell is served for shares SHELL_URL's directory, so that is the base the
  // page will use however it was reached.
  const subresources = subresourcesOf(html, SHELL_URL);
  await addMissing(cache, subresources);
  await cache.put(SHELL_URL, response);
  // Only once the new shell is the stored one: before that, the entries this
  // drops are still the ones an offline launch would be served.
  await pruneSuperseded(cache, subresources);
}

async function networkFirst(event, request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) event.waitUntil(cacheShell(cache, response.clone()).catch(() => {}));
    return response;
  } catch (err) {
    // Deliberately not matching the navigated URL first: cache.match is exact
    // down to the query string, so a shared link with `?fbclid=…` would miss,
    // and any per-URL entry an older worker left behind is a build staler than
    // the one key every navigation now keeps current.
    const cached = await cache.match(SHELL_URL);
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

async function staleWhileRevalidate(event, request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const fresh = fetch(request).then((response) => {
    // A 404 or 500 from a half-broken deploy must not replace a working entry,
    // and offline the rejection leaves the stored copy to answer for it.
    if (response.ok) cacheResponse(event, cache, request, response);
    return response;
  });
  if (!cached) return fresh;
  // Answering from the cache settles the fetch event, so the revalidation has
  // to be registered on it or the worker can be terminated before the refresh
  // lands and the next visit would find the same stale copy again.
  event.waitUntil(fresh.catch(() => {}));
  return cached;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    isShellRequest(request)
      ? networkFirst(event, request)
      : isHashedAsset(request.url)
        ? cacheFirst(event, request)
        : staleWhileRevalidate(event, request),
  );
});
