# Commands

## Development

```sh
npm run dev           # Vite dev server at http://localhost:8005
                      # Sets COOP/COEP headers required by AudioWorklet
```

## Build

```sh
npm run build         # Production bundle → dist/
npm run preview       # Serve dist/ locally (same headers as dev)
```

## Dependency Management

```sh
npm install           # Install / sync node_modules from package-lock.json
npm run update-libs   # Upgrade all deps to latest (npm-check-updates + install)
```

## No test runner is configured yet

See [docs/exec-plans/tech-debt-tracker.md](exec-plans/tech-debt-tracker.md) — adding a test suite is a tracked debt item.

## Vite Config Notes

- Port: `8005`
- HTTPS: disabled in dev (plain HTTP)
- Required headers (set in `vite.config.js`):
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Embedder-Policy: require-corp`
  These are required for `AudioWorklet` and `SharedArrayBuffer` to work in the browser.
- Plugin: `@vitejs/plugin-basic-ssl` (available but HTTPS disabled; re-enable if needed for mobile testing over LAN)
