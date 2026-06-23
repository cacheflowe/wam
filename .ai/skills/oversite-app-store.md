---
name: oversite-app-store
description: Guide for using Oversite AppStore and AppStoreDistributed in any project. AppStore is a local key/value store with pub/sub. AppStoreDistributed adds WebSocket sync via the Oversite server.
---

## Overview

Two classes, two deployment modes:

| Class | Transport | Requires Oversite server? |
|---|---|---|
| `AppStore` | In-process only | No |
| `AppStoreDistributed` | WebSocket (multi-client sync) | Yes |

Use `AppStore` for single-page local state. Use `AppStoreDistributed` when multiple apps/machines need to share state in real time.

## Install in External Projects (Recommended)

```bash
npm install oversite
```

Then import directly from the package:

```js
import AppStore from "oversite/src/app-store/app-store-.mjs";
import AppStoreDistributed from "oversite/src/app-store/app-store-distributed.mjs";
```

If you need an unreleased change, use GitHub source instead:

```bash
npm install github:Hovercraft-Studio/oversite#main
```

## Files to Copy

| File | Always needed? |
|---|---|
| `src/app-store/app-store-.mjs` | Yes — base class |
| `src/app-store/app-store-distributed.mjs` | Only if using WS sync |
| `src/app-store/solid-socket.mjs` | Only if using WS sync (dependency of Distributed) |

`AppStoreDistributed` imports both of the above, so copy all three if you need distributed sync.

## AppStore (Local Only)

```js
import AppStore from './app-store-.mjs';

const store = new AppStore();
// In browser: also sets window._store and fires "appstore-ready" event

store.set('volume', 0.8);
store.get('volume'); // 0.8
```

### Listening for changes

```js
// Option 1: general listener — called for every key change
store.addListener(myObj);
// myObj must implement: storeUpdated(key, value)

// Option 2: named-method listener — calls myObj[key](value)
store.addListener(myObj, 'volume');
// myObj must implement: volume(value)

// Cleanup
store.removeListener(myObj);
store.removeListener(myObj, 'volume');
```

### Optional: localStorage persistence (browser only)

```js
store.initLocalStorage(['high_freq_key']); // keys to exclude from triggering saves
```

## AppStoreDistributed (WebSocket Sync)

Requires the Oversite server running (`npm run dev` or `npm start` in the oversite repo). The WS endpoint is `/ws` on the server port (default `:3003`).

```js
import AppStoreDistributed from './app-store-distributed.mjs';

const store = new AppStoreDistributed(
  'ws://localhost:3003/ws', // WebSocket URL
  'my_app',                 // senderId — identifies this client in the monitor
  'default',                // channelId — namespace for state isolation
  'my_auth_key'             // authKey — optional, must match server config
);
// Connection starts immediately in the constructor — no separate connect() call
```

### The bounce-back sync pattern

**Never update local state before the server echo.** Use `broadcast: true` and let the echo update local state:

```js
store.set('scene', 'intro');          // local only — no WS send
store.set('scene', 'intro', true);    // sends to server; local state updates on echo back
store.set('scene', 'intro', true, 'display_1'); // unicast to specific receiver only
store.set('sensor', 42, true, null, true);      // sendonly — server relays but won't echo back to sender
```

### Listening for connection events

```js
store.addListener(myObj, 'appstore_connected');    // myObj.appstore_connected(wsUrl)
store.addListener(myObj, 'appstore_disconnected'); // myObj.appstore_disconnected(wsUrl)
store.addListener(myObj, 'custom_json');           // non-AppStore JSON messages
```

### Additional methods

```js
store.isConnected();          // boolean
store.getData('scene');       // full last message object for a key (includes sender, time, etc.)
store.broadcastCustomJson({}); // send arbitrary JSON outside the AppStore format
```

## Wire Format

Every message sent over WebSocket is JSON:

```json
{
  "key": "scene",
  "value": "intro",
  "store": true,
  "type": "string",
  "sender": "my_app",
  "receiver": "display_1",
  "sendonly": false
}
```

`type` must be `"string"`, `"number"`, `"boolean"`, `"array"`, or `"object"`. Required for strongly-typed receivers (Java, Arduino).

## Key Conventions

- **One value per key** — send atomic keys, not bundled objects. Any client can subscribe to exactly what it needs.
- **Heartbeat keys**: `{sender}_heartbeat` — value is ms since app start, sent on an interval.
- **Health keys**: `{thing}_health` — boolean; drives status indicators in the monitor.

## Oversite Server Setup

To enable `AppStoreDistributed`, run the Oversite server in the oversite repo:

```bash
npm install
npm run dev   # dev: Vite :3002 + Express/WS :3003
npm start     # prod: serve dist/ from :3003
```

Environment variables:

```bash
ALLOWED_WS_CHANNELS=default,dashboard   # comma-separated channel names
AUTH_USERS=admin:password               # optional auth
```

The server persists state to `_tmp_data/state/state-{channelId}.json` and sends it to new clients on connect.

## REST API (when server is running)

```
GET /api/state/all?channel=X       — full state snapshot
GET /api/state/get/:key?channel=X  — single key
GET /api/state/wipe/:key?channel=X — delete one key
GET /api/state/channels            — list active channels
GET /api/state/clients             — list connected clients
```
