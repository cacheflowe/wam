# Security

Owner: TODO
Last reviewed: 2026-04-27

## Threat Model

`wam` is a client-side-only audio library. There is no server, no user accounts, no network API, and no persistent storage beyond `localStorage`. The attack surface is limited to the browser security model.

## COOP / COEP Headers (Required)

`AudioWorklet` and `SharedArrayBuffer` require a cross-origin isolated context. The dev server and any production deployment must set:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

These are already configured in `vite.config.js`. When deploying, ensure your CDN or web server forwards these headers.

**Risk if missing**: `AudioWorklet.addModule()` fails silently or with a DOMException; pitch-shift and time-stretch features are disabled.

## CORS for Audio Samples

`WebAudioLoopPlayer` fetches `.wav` files via `fetch()` and decodes them with `AudioContext.decodeAudioData()`. Files served from `public/audio/` are same-origin and safe. If samples are ever served from an external CDN:

- The CDN must send `Access-Control-Allow-Origin: *` (or the specific origin)
- The `fetch()` call must use `{ mode: "cors" }`

Never load audio from untrusted third-party URLs.

## localStorage

State is serialized to `localStorage` as plain JSON. No credentials, tokens, or PII are stored. The only risk is a malicious preset string injected via URL hash or `fromJSON()` with a crafted value.

**Mitigation**: `fromJSON()` reads only known keys and writes them to typed instrument properties (numbers, booleans, strings). There is no `eval()` or `innerHTML` assignment from serialized data. No additional sanitization is needed unless HTML is ever rendered from preset data.

## No innerHTML from User Data

Controls components render their own HTML, not user-supplied data. `fromJSON()` writes numeric and boolean values to AudioParam / instrument properties only. Ensure any future UI additions that render user-supplied text (e.g., preset names entered by the user) use `textContent`, not `innerHTML`.

## AudioContext Autoplay Policy

The browser's autoplay policy prevents AudioContext from producing sound without a user gesture. This is a browser-enforced security boundary, not a bug. The library respects it: the app layer is responsible for calling `ctx.resume()` in a user interaction handler.

## Dependency Security

Runtime dependencies: **none**. The only npm packages are dev-time Vite tooling. Run `npm audit` after `npm run update-libs` to check for known vulnerabilities in the dev toolchain.

## Out of Scope

- Authentication / authorization (no user accounts)
- Content moderation (no user-generated audio content)
- XSS via external data (no server-rendered content)
- Supply-chain risks in audio samples (samples are bundled in `public/` under version control)
