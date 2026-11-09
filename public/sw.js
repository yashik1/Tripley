/* Tripley service worker: after the first visit the app opens without a
 * connection, and recently seen map tiles still show. API calls (Supabase) are
 * never cached here; the app keeps its own offline copy of trip data and sends
 * bills saved offline when the connection is back. */
// Replaced at build time (scripts/precache-manifest.cjs) with a hash of the build.
const VERSION = 'dev';
const SHELL = `tripley-shell-${VERSION}`;
const STATIC = `tripley-static-${VERSION}`;
const TILES = 'tripley-tiles-v1'; // kept across versions
const LIMITS = { [TILES]: 600 };

// Save every file of this version (listed at build time), so any screen opens
// offline, not only the ones already visited.
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const res = await fetch('/precache.json', { cache: 'no-store' });
        const { files } = await res.json();
        const shell = await caches.open(SHELL);
        const statics = await caches.open(STATIC);
        await Promise.all(
          files.map(async (file) => {
            try {
              const r = await fetch(file, { cache: 'no-cache' });
              if (r.ok) await (file === '/' ? shell : statics).put(file, r);
            } catch {
              // One missing file shouldn't stop the rest.
            }
          }),
        );
      } catch {
        // No manifest (dev build): cache as we go instead.
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL, STATIC, TILES]);
      for (const name of await caches.keys()) if (!keep.has(name)) await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});

async function trim(cacheName) {
  const limit = LIMITS[cacheName];
  if (!limit) return;
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - limit; i++) await cache.delete(keys[i]);
}

async function put(cacheName, request, response) {
  if (!response || !(response.ok || response.type === 'opaque')) return;
  const cache = await caches.open(cacheName);
  await cache.put(request, response);
  trim(cacheName);
}

// Same-site files are saved without their ?query (e.g. the map worker's ?v=).
const lookup = (request) => caches.match(request, { ignoreSearch: new URL(request.url).origin === self.location.origin });

async function cacheFirst(request, cacheName) {
  const hit = await lookup(request);
  if (hit) return hit;
  const res = await fetch(request);
  put(cacheName, request, res.clone());
  return res;
}

async function networkFirst(request, cacheName) {
  try {
    const res = await fetch(request);
    put(cacheName, request, res.clone());
    return res;
  } catch (e) {
    const hit = await lookup(request);
    if (hit) return hit;
    throw e;
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const hit = await caches.match(request);
  const update = fetch(request)
    .then((res) => {
      put(cacheName, request, res.clone());
      return res;
    })
    .catch(() => undefined);
  return hit || (await update) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Pages: always try the network (so new versions arrive), else the saved app.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (res.ok) put(SHELL, '/', res.clone());
          return res;
        } catch {
          return (await caches.match('/')) || Response.error();
        }
      })(),
    );
    return;
  }

  if (url.origin === self.location.origin) {
    if (url.pathname === '/sw.js') return;
    // Bundles and assets have the content hash in their name: they never change.
    if (url.pathname.startsWith('/_expo/static/') || url.pathname.startsWith('/assets/')) {
      event.respondWith(cacheFirst(req, STATIC));
    } else {
      event.respondWith(networkFirst(req, STATIC));
    }
    return;
  }

  // Map style, tiles, fonts and icons: show saved ones at once, refresh behind.
  if (/(^|\.)openfreemap\.org$/.test(url.hostname)) {
    event.respondWith(staleWhileRevalidate(req, TILES));
  }
});
