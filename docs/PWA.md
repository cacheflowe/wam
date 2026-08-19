# PWA — Offline Support

**Status: disabled.** `public/sw.js` was replaced with a kill-switch worker — see below. The description of the old caching strategy is kept here for when it's reinstated.

## Why it's off

The cache-first strategy served every same-origin GET (including `/` itself, the HTML shell) straight from Cache Storage once a browser had visited once — so a plain refresh never checked the network for updates, and only a version bump to `CACHE_NAME` (plus the browser's own ~24h SW update check) would surface a new deploy. This meant returning visitors, and especially visitors on other machines, could get stuck on a stale build indefinitely.

## Current behavior (kill switch)

`public/sw.js` now has no caching logic. On activate, it:
- Deletes every Cache Storage entry under this origin.
- Unregisters itself.
- Reloads any page it's still controlling.

`src/site/app.js` still calls `navigator.serviceWorker.register("/sw.js")` on load — that's intentional. Registering the same scope is what makes the browser check `sw.js`'s bytes against whatever's installed, so already-affected clients pick up the kill switch quickly instead of waiting for the periodic background check.

Once every returning client has cycled through the kill switch (their old SW should self-remove within one or two visits), the registration call could be dropped too — but leaving it in is harmless (registering an unchanged script is a no-op) and keeps the door open for reinstating offline support later.

## Reinstating offline support later

The previous caching implementation is in git history (this file and `public/sw.js`, prior to the kill-switch commit). If offline support is wanted again:

- **Fix the root cause first** — the old cache-first approach caches the HTML shell forever, only fixed by manually bumping `CACHE_NAME` on every deploy. A more robust version would use network-first (or stale-while-revalidate) for the shell (`/`, `/index.html`) specifically, while keeping cache-first for the hashed JS/CSS bundles (safe to cache-first forever, since Vite gives them content-hashed filenames).
- Restore `public/manifest.json` linkage and the `PRECACHE` app-shell list.
- Bump `CACHE_NAME` on that reintroduction so it's treated as a fresh install everywhere.

## Add to Home Screen

`public/manifest.json` is unaffected by the kill switch — installability and home-screen metadata (name, icons, theme, display mode) still work independent of the service worker's caching behavior.
