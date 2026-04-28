# Product Sense

## Who This Is For

**Primary users**: Creative coders, audiovisual artists, and music-focused web developers who want production-quality sound synthesis in a browser app — without pulling in a framework or an audio library with its own abstraction layer.

**Secondary users**: Educators and students learning Web Audio API patterns. The codebase is intentionally readable: each instrument is a self-contained JS class with no magic.

**Non-users**: Teams that need server-side audio processing, non-browser runtimes (Node.js), or mobile native apps. This library is browser-only by design.

## Core Value Proposition

| Problem | This Library's Answer |
|---|---|
| Web Audio API is low-level and verbose | Ready-made instrument classes with clean, musical APIs (`trigger(midi, dur, vel, time)`) |
| Audio UI requires glue code | Controls Web Components ship with sliders, step sequencer, FX unit, and waveform display already wired |
| Third-party audio libraries bring large bundles | Zero runtime dependencies; tree-shake what you don't use |
| Sound parameters are hard to persist/share | Built-in `toJSON()` / `fromJSON()` on every Controls component |
| Web Audio timing is imprecise when driven by `setTimeout` | Lookahead sequencer (Chris Wilson technique) pre-schedules audio events sample-accurately |

## Product Principles

1. **Instruments first, UI second.** Audio classes work headlessly. UI is an optional layer.
2. **Each instrument ships complete.** Import one file: get the synth, the presets, and the UI panel. No assembly required for common use.
3. **Extend, don't configure.** Adding a new instrument means copying a pattern and filling in the sound design — not reading docs about a plugin system.
4. **Musical defaults.** Every instrument ships with at least one preset that sounds good immediately. Parameters are tuned for musical results, not technically correct midpoints.

## Product Tradeoffs

| Tradeoff | Choice | Rationale |
|---|---|---|
| Fire-and-forget vs voice pool | Fire-and-forget | Simpler, no allocation bugs, effectively unlimited polyphony |
| Single file per instrument vs split | Single file (class + controls) | Easy to import, easy to understand, clear ownership |
| localStorage state vs no persistence | localStorage with debounce | Users expect state to survive page refresh; no backend needed |
| No TypeScript | Vanilla JS | Keeps the codebase approachable; primary users are creative coders, not enterprise devs |
| PicoCSS for app shell | PicoCSS | Fast, semantic, zero config; doesn't conflict with component-scoped `.wac-*` CSS |

## Out of Scope (Current)

- MIDI device input (Web MIDI API)
- DAW-style timeline / clip editor
- Server-side rendering or audio processing
- Mobile native apps
- Peer-to-peer audio (WebRTC)
- Plugin/VST format export

## Related Docs

- [docs/DESIGN.md](DESIGN.md) — design principles behind the product decisions above
- [docs/exec-plans/roadmap.md](exec-plans/roadmap.md) — where the product is heading
