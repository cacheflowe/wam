# Design Principles

## Core Beliefs

### 1. Build on browser primitives
Zero runtime dependencies. The library uses the Web Audio API, Web Components, and standard DOM APIs. If a browser supports it natively, we use it natively. This keeps the bundle small, eliminates version churn, and makes the code portable to any project.

### 2. Instruments are plain classes; UI is optional
Audio classes have no DOM dependency. `new WebAudioSynthAcid(ctx)` works in a headless audio pipeline. The `*Controls` Web Component is additive — it wires UI on top. This separation makes instruments embeddable in any app, not just the demo.

### 3. Fire-and-forget voices
No voice pools, no allocation logic. Each `trigger()` creates a fresh set of audio nodes, schedules them, and lets the browser clean them up after `stop()`. This is simpler, leak-resistant, and removes polyphony limits at the cost of slightly higher instantaneous node creation. See [design-docs/fire-and-forget-voices.md](design-docs/fire-and-forget-voices.md).

### 4. Data-driven UI
Instrument parameters are defined once in `static SLIDER_DEFS`. UI generation, event binding, and serialization all derive from this array. Adding a parameter means adding one getter/setter, one entry in `SLIDER_DEFS`, and one key in each preset. No boilerplate duplication.

### 5. Single routing protocol
Every instrument and effect exposes `connect(node)` and a `get input()` property. The `node.input ?? node` pattern lets library objects and raw `AudioNode`s chain interchangeably. No wrapper types, no casting.

### 6. BPM as the master timing reference
Delay feedback intervals, LFO rates, and sequencer timing are all derived from a single BPM value. Tempo changes propagate from the transport through `controls.bpm = v`. Time is expressed in beats, not seconds, wherever it's musically meaningful.

### 7. Themeable without Shadow DOM
Accent colors are CSS custom properties (`--slider-accent`, `--fx-accent`) set on the parent wrapper. All child components (sliders, buttons, step sequencer, waveform) inherit via cascade. Shadow DOM would break this; we use light DOM + a once-per-page CSS injection pattern instead.

### 8. Presets are partial and forward-compatible
`applyPreset()` uses `!= null` guards for every parameter. Old presets load cleanly when new parameters are added to an instrument. Presets ship as static objects inside the class file — no external preset format to parse.

## What We Avoid

- **Frameworks**: No React, Vue, Svelte. Web Components are sufficient.
- **CSS preprocessors**: Vanilla CSS with custom properties and native nesting.
- **External audio libraries**: Tone.js, Howler.js, etc. are explicitly excluded.
- **Global state**: No shared singleton beyond the `AudioContext` passed at construction time.
- **Shadow DOM** (unless added to an existing component that already uses it): theming relies on CSS cascade.

## Related Docs

- [design-docs/instrument-architecture.md](design-docs/instrument-architecture.md) — detailed rationale for the instrument/controls split
- [design-docs/audio-routing-protocol.md](design-docs/audio-routing-protocol.md) — `connect()` / `input` design decision
- [ARCHITECTURE.md](../ARCHITECTURE.md) — system-level structure
