/**
 * Service Worker — DISABLED (kill switch).
 *
 * The offline-caching SW was causing stale content on returning visitors —
 * once installed, it served every same-origin GET (including the HTML shell
 * itself) cache-first, so a plain refresh never fetched fresh content.
 *
 * This replacement has no caching logic at all. Its only job is to remove
 * itself from any browser that already has the old caching SW installed:
 * clear every cache, unregister, and reload any page it's still controlling.
 * Because navigator.serviceWorker.register("/sw.js") is still called on
 * page load (see src/site/app.js), the browser checks this file's bytes
 * against whatever's installed and picks up this update quickly rather than
 * waiting for its ~24h background check.
 *
 * To bring offline support back later, restore the caching version from git
 * history (this file, pre-kill-switch) and update docs/PWA.md accordingly.
 */

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll())
      .then((clients) => clients.forEach((client) => client.navigate(client.url))),
  );
});
