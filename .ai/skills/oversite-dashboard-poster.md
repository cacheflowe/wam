---
name: oversite-dashboard-poster
description: Guide for implementing Oversite DashboardPoster across projects to monitor app health on remote PCs. Use when adding dashboard check-ins to any new or existing project.
---

# Dashboard Poster — Implementation Guide

The Dashboard system tracks the health of deployed apps running on PCs across venues/installations. Apps post periodic check-ins (JSON with optional screenshots) to a central Oversite server. The Dashboard web UI shows all known apps, their status, last-seen time, screenshots, and custom data.

This guide applies to:
- **The Oversite repo itself** (internal examples and apps)
- **External projects** that install Oversite as an npm module
- **Standalone projects** that copy the `DashboardPoster` source file

## Architecture Overview

```
Deployed App (any language/platform)
       │
  DashboardPoster / custom HTTP POST (JSON on interval)
       │
  Oversite Server — POST /api/dashboard
       │
  _tmp_data/dashboard/projects.json + images/
       │
  Dashboard Web UI ← GET /api/dashboard/json
       │
  OfflineAlerts → Slack webhook when app goes stale or recovers
```

## Dashboard API Endpoint

| Env | URL |
|---|---|
| Local dev | `http://localhost:3003/api/dashboard` |
| Vite dev proxy | `http://localhost:3002/api/dashboard` |
| Production | Your deployed Oversite instance, e.g. `https://oversite.example.com/api/dashboard` |

For **JavaScript projects**, use an environment variable to switch between local and production:

```bash
# .env
DASHBOARD_API_URL=http://localhost:3003/api/dashboard
```

In code, read `import.meta.env.VITE_DASHBOARD_API_URL` (Vite frontend) or `process.env.DASHBOARD_API_URL` (Node backend) and fall back to `http://localhost:3003/api/dashboard`.

For **non-JS projects** (Java, TouchDesigner, Arduino, etc.), hardcode the production URL or use a local config file, since those apps typically only run in deployed (production) contexts.

---

## Getting DashboardPoster Into Your Project

### Option A: Install Oversite as an npm module (recommended for JS projects)

```bash
npm install oversite
```

If you need unreleased changes from this repo:

```bash
npm install github:Hovercraft-Studio/oversite#main
```

Then import directly from the module:

```js
import DashboardPoster from "oversite/src/dashboard/dashboard-poster.mjs";
```

This gives you access to the full Oversite toolkit (AppStore, web components, utilities) in addition to the dashboard poster.

**Working example:** `examples/oversite-module/backend/dashboard-poster.mjs`

### Option B: Copy the source file (for non-npm or isolated projects)

Copy `src/dashboard/dashboard-poster.mjs` into your project. It has no internal dependencies for browser usage. For Node.js usage, it dynamically imports `fs`, `path`, `os`, and `screenshot-desktop` — install `screenshot-desktop` if you want automatic native screenshots.

```bash
# In your project
npm install screenshot-desktop
```

### Option C: Raw HTTP POST (any language — no dependency needed)

Skip the class entirely and POST JSON to the endpoint from any language. See the "Any Language" section below.

---

## Implementation Options

### 1. Node.js Backend (universal JS — recommended for headless apps)

Use `DashboardPoster` directly. It auto-detects that it's running in Node and enables native screenshots via `screenshot-desktop`.

```js
// If using the npm module:
import DashboardPoster from "oversite/src/dashboard/dashboard-poster.mjs";

// If working inside the Oversite repo:
// import DashboardPoster from "../../../src/dashboard/dashboard-poster.mjs";

// If you copied the file into your project:
// import DashboardPoster from "./lib/dashboard-poster.mjs";

const DASHBOARD_URL = process.env.DASHBOARD_API_URL || "http://localhost:3003/api/dashboard";

const poster = new DashboardPoster(
  DASHBOARD_URL,
  "my-node-app",          // appId — unique across all installations
  "My Node App — Venue",  // appTitle — human-readable label
  10 * 60 * 1000,         // interval in ms (default: 10 min)
  15 * 60 * 1000,         // screenshotInterval in ms (default: 15 min)
  0                       // screenIndex — which display to capture (null = default)
);

// Add custom status props (merged into the next check-in, then cleared)
poster.setCustomProp("scene", "intro");
poster.setCustomProp("visitors", 42);

// In Node, a desktop screenshot is captured every screenshotInterval (default 15 min).
// The first check-in waits for the initial screenshot to be ready before posting.
// The captured screenshot is included in the next check-in post that has an image slot available.
```

**Full working example:** `examples/dashboard/js-backend/index.mjs` and `examples/oversite-module/backend/dashboard-poster.mjs`

**Dependencies (Node only):** `screenshot-desktop` (included in Oversite's package.json; install separately if copying the file)

---

### 2. Browser Frontend (web app with a canvas)

Same `DashboardPoster` class works in the browser. It detects `window` and tracks FPS via `requestAnimationFrame`.

```js
// npm module:
import DashboardPoster from "oversite/src/dashboard/dashboard-poster.mjs";
// Or local copy:
// import DashboardPoster from "./lib/dashboard-poster.mjs";

const DASHBOARD_URL = import.meta.env.VITE_DASHBOARD_API_URL || "http://localhost:3003/api/dashboard";

const poster = new DashboardPoster(DASHBOARD_URL, "web-app-id", "Web App Title", 5 * 60 * 1000);

// Provide a canvas for screenshots (captured as base64 PNG)
poster.setImageScreenshot(document.querySelector("canvas#main"));

// Provide a second canvas for a custom image (e.g. webcam feed)
poster.setImageCustom(document.querySelector("canvas#webcam"));
```

**Image posting cadence:** To keep payloads small, images are not sent on every post. `imageExtra` is included every 3rd post and `imageScreenshot` every 3rd post (offset by 1). This applies to both browser and Node — in Node, screenshots are *captured* on a separate 15-min timer, but only *sent* when the next eligible post slot arrives. Call `poster.postJson(true)` to force both images immediately.

**Full working example:** `examples/dashboard/js-frontend/index.html`

---

### 3. Electron Desktop App (native screenshots + webcam)

The Electron example wraps `DashboardPoster` in a web component (`<dashboard-poster>`) and reads configuration from a `.env` file or `electron-store` settings.

**Key files:**
- `examples/dashboard/desktop-electron/src/frontend/js/dashboard-poster-view.js`
- `examples/dashboard/desktop-electron/.env.example`

**.env config:**
```
app_id=venue-name-pc1
app_title=Venue Name — PC 1
api_url=https://oversite.example.com/api/dashboard
post_interval=10
webcam_interval=10
```

The Electron app captures the desktop via Electron's `desktopCapturer` and a webcam feed, providing both to `DashboardPoster` as canvas elements.

---

### 4. Java (Processing / Haxademic)

Use `DashboardCheckinPoller` — a Java class that posts check-in JSON on a timer with native screenshots.

```java
DashboardCheckinPoller dashboard = new DashboardCheckinPoller(
  "my-java-app",                                    // appId
  "My Java App — Venue",                            // appTitle
  "https://oversite.example.com/api/dashboard",     // checkinURL
  600,                                              // checkinIntervalSeconds
  900,                                              // screenshotIntervalSeconds
  0.5f                                              // screenshotScale (0-1)
);

// Add custom props
dashboard.setCustomValue("scene", "attract");
dashboard.setCustomValue("fps", 60);
```

**File:** `examples/dashboard/java/DashboardCheckinPoller.java`

---

### 5. Any Language (raw HTTP POST)

Any app in any language can check in by POSTing JSON to the dashboard endpoint:

```
POST /api/dashboard
Content-Type: application/json

{
  "appId": "unique-app-id",
  "appTitle": "Human Readable Name",
  "uptime": 3600,
  "resolution": "1920x1080",
  "imageScreenshot": "<base64 PNG string, optional>",
  "imageExtra": "<base64 PNG string, optional>",
  "customKey": "customValue"
}
```

**Required field:** `appId` — must be unique. Everything else is optional but recommended.

---

## Check-in Payload Reference

| Field | Type | Description |
|---|---|---|
| `appId` | string | **Required.** Unique identifier for this installation. |
| `appTitle` | string | Human-readable name shown in dashboard UI. |
| `uptime` | number | Seconds since app started. |
| `resolution` | string | Display resolution, e.g. `"1920x1080"` or `"headless"`. |
| `frameRate` | number | Current FPS (browser: auto-tracked). |
| `frameCount` | number | Total frames rendered. |
| `imageScreenshot` | string | Base64-encoded PNG of the screen. |
| `imageExtra` | string | Base64-encoded PNG of a secondary image. |
| *(any other key)* | any | Merged as custom props and displayed in the dashboard card. |

---

## Best Practices

1. **Use descriptive `appId` values** — include venue and machine, e.g. `nyc-lobby-pc1`, `chicago-projector-main`.
2. **Keep intervals reasonable** — 5–10 minutes for most apps. Don't go below 1 minute.
3. **Use environment variables for the API URL** in JS projects so local dev doesn't accidentally post to production.
4. **Screenshots are optional but valuable** — they let you visually confirm the app is displaying correctly without physical access.
5. **Custom props reset after each post** — set them every interval if they should persist in the dashboard view.
6. **The server handles image rotation** — old history entries and their images are pruned automatically (max 100 per project).

---

## Key Source Files

| File | Role |
|---|---|
| `src/dashboard/dashboard-poster.mjs` | Isomorphic JS client (browser + Node) |
| `src/server/dashboard-api.mjs` | Server-side REST API and storage |
| `src/server/offline-alerts.mjs` | Slack notifications for stale apps |
| `src/components/dashboard/dashboard-view.js` | Web component for viewing the dashboard |
| `examples/dashboard/` | All example implementations (internal repo paths) |
| `examples/oversite-module/` | Example external project using the npm module |
| `docs/product-specs/dashboard.md` | Full product spec |

---

## Quick Setup for a New External Project

```bash
mkdir my-installation && cd my-installation
npm init -y
npm install oversite
npm install screenshot-desktop  # only needed for Node native screenshots
```

Create `index.mjs`:

```js
import DashboardPoster from "oversite/src/dashboard/dashboard-poster.mjs";

const DASHBOARD_URL = process.env.DASHBOARD_API_URL || "http://localhost:3003/api/dashboard";

const poster = new DashboardPoster(
  DASHBOARD_URL,
  "venue-name-pc1",
  "Venue Name — PC 1",
  10 * 60 * 1000,         // check-in interval
  15 * 60 * 1000,         // screenshot interval
  null                    // screenIndex (null = default display)
);
```

Create `.env` (not committed):

```
DASHBOARD_API_URL=https://oversite.example.com/api/dashboard
```

Run:

```bash
node --env-file=.env index.mjs
```

That's it — the app will check in immediately and every 10 minutes, with automatic desktop screenshots in Node.
