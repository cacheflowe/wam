# wam — Web Audio Instrument Library

Browser-based synthesizer toolkit: instruments, effects, and UI controls built on the Web Audio API and Web Components. Zero external dependencies.

## Quick Start

```sh
npm install        # install Vite dev tooling
npm run dev        # start dev server at http://localhost:8005
npm run build      # production bundle → dist/
npm run preview    # serve the production build locally
npm run update-libs # update all dependencies to latest
```

## Key Directories

```
src/web-audio/     # instruments, effects, UI controls, utilities (the library)
src/css/           # PicoCSS base + global styles
src/site/          # app entry point and site-level components
public/            # static assets (audio samples, images)
docs/              # all project documentation
.github/skills/    # coding agent skill files
```

## Environment Constraints

- **HTTPS / COOP+COEP**: AudioWorklet and SharedArrayBuffer need a secure context. The dev server sets `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` (see `vite.config.js`). Keep these headers in any deployment.
- **User gesture**: Browsers suspend AudioContext on creation. Always call `ctx.resume()` inside a user interaction handler before producing audio.
- **ES modules only**: All files use `import`/`export`. No CommonJS.
- **No TypeScript**: Vanilla JS only.
- **No frameworks**: Vanilla Web Components (`HTMLElement`), no React/Vue/Svelte.
- **AudioWorklet paths**: Worklet scripts must be loaded via `addModule(url)` with a resolvable URL. In Vite, use `new URL('./file.worklet.js', import.meta.url).href`.

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for system context, audio graph, and domain boundaries.

## Docs Index

| Topic | File |
|---|---|
| Build & dev commands | [docs/COMMANDS.md](docs/COMMANDS.md) |
| Design principles | [docs/DESIGN.md](docs/DESIGN.md) |
| UI / component architecture | [docs/FRONTEND.md](docs/FRONTEND.md) |
| Audio engine layer | [docs/BACKEND.md](docs/BACKEND.md) |
| Product & users | [docs/PRODUCT_SENSE.md](docs/PRODUCT_SENSE.md) |
| Quality rubric | [docs/QUALITY_SCORE.md](docs/QUALITY_SCORE.md) |
| Reliability & failure modes | [docs/RELIABILITY.md](docs/RELIABILITY.md) |
| Security & browser context | [docs/SECURITY.md](docs/SECURITY.md) |
| Design decisions | [docs/design-docs/index.md](docs/design-docs/index.md) |
| Feature specs | [docs/product-specs/index.md](docs/product-specs/index.md) |
| Roadmap | [docs/exec-plans/roadmap.md](docs/exec-plans/roadmap.md) |
| Active work | [docs/exec-plans/active/](docs/exec-plans/active/) |
| Tech debt | [docs/exec-plans/tech-debt-tracker.md](docs/exec-plans/tech-debt-tracker.md) |
| Web Audio API reference | [docs/references/web-audio-api.md](docs/references/web-audio-api.md) |
| Audio routing patterns | [docs/references/audio-routing.md](docs/references/audio-routing.md) |

## Web Components Skill

See [.github/skills/web-components/SKILL.md](.github/skills/web-components/SKILL.md) for project conventions on building and styling Web Components.
