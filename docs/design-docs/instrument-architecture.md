# Instrument Architecture

Status: Active | Owner: Justin Gitlin | Last reviewed: 2026-04-27

## Context

Early versions mixed audio logic and DOM manipulation inside the same class. This made instruments impossible to use headlessly (e.g., in a generative script with no UI). The decision was made to split every instrument into two exported classes per file.

## Options Considered

1. **Single class with optional UI**: One class, `buildUI()` method that's only called when needed.
2. **Separate files**: Audio class in `web-audio-synth-acid.js`, UI component in a separate `web-audio-synth-acid-controls.js`.
3. **Co-located in one file, two exports**: Audio class as `export default`, UI as `export class *Controls`. Both live in the same file but are separate classes.

## Decision

Option 3: Co-located, two exports.

## Rationale

- **Import simplicity**: One `import` gives you both the audio class and the UI component. No need to remember to import two files.
- **Clear ownership**: Audio logic and UI logic are distinct classes with distinct lifecycles. The Controls class holds no audio state; the audio class holds no DOM state.
- **Headless use**: `new WebAudioSynthAcid(ctx)` works without any DOM. Apps that don't need UI don't pay for it.
- **Co-location avoids drift**: Keeping the two classes in the same file makes it easy to keep `SLIDER_DEFS` in sync with the instrument's actual properties.

## Consequences

- Each instrument file is larger than it would be if split.
- The pattern must be maintained consistently — a future instrument that breaks the convention (e.g., mixing audio into Controls) should be refactored.
- The `bind(instrument, ctx, options)` method is the coupling point. It should remain the only place where Controls holds a reference to the instrument instance.

## Related Docs

- [controls-companion-pattern.md](controls-companion-pattern.md) — how `bind()` works in detail
- [docs/FRONTEND.md](../FRONTEND.md) — Controls lifecycle and signal chain
