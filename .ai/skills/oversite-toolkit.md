---
name: oversite-toolkit
description: High-level guide for integrating Oversite into external projects. Use this to choose and combine Oversite skills for AppStore sync, dashboard health reporting, web components, and PicoCSS theming.
---

## Purpose

Use this skill as the entry point when adopting Oversite in a new or existing project. It helps pick the right subsystem and routes to focused skills.

## Choose the Right Path

- Need distributed state or messaging between clients: use `oversite-app-store`.
- Need remote app health, screenshots, and stale/offline monitoring: use `oversite-dashboard-poster`.
- Need component architecture patterns for UI controls/displays: use `oversite-web-components`.
- Need visual theming with Pico CSS variables and runtime color recipes: use `oversite-picocss-customization`.

## Integration Modes

### 1. Use Oversite as a module (recommended)

- Install from npm first.
- Import only the pieces you need.
- Keep updates easy by avoiding copied source when possible.

```bash
npm install oversite
```

If you need a pre-release or unpublished change, install from GitHub source:

```bash
npm install github:Hovercraft-Studio/oversite#main
```

### 2. Copy selected source files

Use this when npm installation is not possible. Keep copied files minimal and documented.

- AppStore local only: `src/app-store/app-store-.mjs`
- AppStore distributed: also copy `src/app-store/app-store-distributed.mjs` and `src/app-store/solid-socket.mjs`
- Dashboard check-in client: `src/dashboard/dashboard-poster.mjs`

## Core Constraints

- Vanilla JS and Web Components only.
- No TypeScript or frontend frameworks.
- No Shadow DOM for new components unless required by an existing component.
- For distributed AppStore updates, follow bounce-back sync: broadcast first, update local state only on server echo.
- Use snake_case keys. Heartbeat keys: `{sender}_heartbeat`. Health keys: `{thing}_health`.

## Typical Setup Checklist

1. Start Oversite server when using distributed features (WebSocket and dashboard APIs).
2. Define stable sender IDs and channels for each client.
3. Choose a key naming scheme early (`snake_case`, heartbeat, health keys).
4. Add dashboard check-ins for each deployed node/app.
5. Build UI controls with `AppStoreElement` patterns and keep rendering light-DOM.
6. Apply Pico theme overrides using the theme utility or documented CSS variable overrides.

## Server Endpoints Used By External Projects

- WebSocket for AppStoreDistributed: `/ws`
- Dashboard check-in API: `POST /api/dashboard`
- State API snapshot: `GET /api/state/all?channel=X`

## Skill Map

- `oversite-app-store`: transport, wire format, local vs distributed behavior
- `oversite-dashboard-poster`: check-in payloads, screenshot cadence, integration examples
- `oversite-web-components`: component lifecycle, authoring patterns, registration rules
- `oversite-picocss-customization`: theme variable strategy and runtime theme generation

Use this skill first for architecture decisions, then load the focused skill for implementation details.
