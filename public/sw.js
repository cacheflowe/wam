/**
 * Service Worker — offline-first caching for WAM.
 *
 * Strategy:
 *   - On install: pre-cache the app shell (index, CSS, JS bundle).
 *   - On fetch:   cache-first for same-origin requests, network-first for others.
 *   - On activate: clean up old cache versions.
 */

const CACHE_NAME = "wam-v1";

// App shell to pre-cache on install (Vite hashes JS/CSS, so we cache index
// and let runtime caching pick up the hashed assets on first load)
const PRECACHE = ["/", "/manifest.json", "/images/icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;

  // Only cache same-origin GET requests
  if (request.method !== "GET") return;
  if (new URL(request.url).origin !== self.location.origin) return;

  e.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        // Don't cache non-ok or opaque responses
        if (!response || response.status !== 200) return response;

        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        return response;
      });
    }),
  );
});
