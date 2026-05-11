# PWA — Offline Support

WAM is a Progressive Web App. After the first visit, the entire application is cached locally and works offline.

## How It Works

| File | Role |
|------|------|
| `public/manifest.json` | App metadata — name, icons, theme color, display mode |
| `public/sw.js` | Service Worker — caching logic |
| `index.html` | Registers the SW and links the manifest |

### Caching Strategy

- **Install**: Pre-caches the app shell (`/`, `/manifest.json`, `/images/icon.png`).
- **Fetch**: Cache-first for same-origin GET requests. On cache miss, fetches from network and caches the response for next time.
- **Activate**: Deletes any old cache versions so stale assets don't linger.

Hashed JS/CSS bundles (produced by Vite) are runtime-cached on first load. Audio samples under `/audio/` are also cached on first access.

## Deploying Updates

The service worker uses a versioned cache name:

```js
const CACHE_NAME = "wam-v1";
```

**When you deploy a breaking change, bump this version** (e.g. `"wam-v2"`). On the next visit, the new SW will activate and purge the old cache, forcing fresh downloads.

If you forget to bump, users may see stale cached assets until the browser's 24-hour SW update check triggers a byte-diff detection on `sw.js`.

## Add to Home Screen

On mobile browsers (Chrome, Safari, Firefox), users will be prompted to install WAM to their home screen after meeting engagement heuristics. The manifest controls the installed app's:

- Name: "WAM — Web Audio Instruments"
- Display: standalone (no browser chrome)
- Orientation: any
- Theme: dark (`#111`)

## Development Notes

- The SW is in `public/` so Vite copies it as-is to `dist/` (no bundling/hashing).
- During `npm run dev`, the SW may interfere with hot-reload. If you see stale content, unregister the SW in DevTools → Application → Service Workers, or use an incognito window.
- The SW only caches same-origin GET requests — external CDN resources or API calls are never cached.
