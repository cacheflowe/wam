# Controls Companion Pattern

Status: Active | Owner: Justin Gitlin | Last reviewed: 2026-04-27

## Context

Every instrument needs UI: parameter sliders, a preset dropdown, a step sequencer, an FX chain, and a waveform display. Without a standard pattern, each instrument would implement this differently.

## Decision

Every instrument file exports a `*Controls` Web Component that follows a strict lifecycle:

```js
class WebAudioSynthAcidControls extends HTMLElement {
  static SLIDER_DEFS = [...]      // drives UI generation
  bind(instrument, ctx, options)  // wires audio graph + builds UI
  connect(node)                   // routes final output
  step(index, time, stepDur)      // called by sequencer
  setActiveStep(i)                // updates step indicator
  set bpm(v)                      // propagates tempo to FxUnit
  toJSON()                        // serializes full state
  fromJSON(obj)                   // restores full state
}
```

### Signal Chain After bind()

```
instrument → AnalyserNode → FxUnit.input → FxUnit → controls._out (GainNode)
                   │
             WaveformDisplay
```

`controls.connect(masterGain)` wires `controls._out` to the destination.

### SLIDER_DEFS

```js
static SLIDER_DEFS = [
  { param: "cutoff",    label: "Cutoff",  min: 50,  max: 10000, step: 1,   scale: "log" },
  { param: "resonance", label: "Reso",   min: 0.1, max: 30,    step: 0.1 },
];
```

`bind()` iterates this array to create `<web-audio-slider>` elements. A delegated `slider-input` event listener maps `e.detail.param` → `instrument[param] = e.detail.value`. Adding a new parameter means: (1) add getter/setter on the instrument, (2) add entry to `SLIDER_DEFS`, (3) add key to preset objects.

### Serialization Contract

`toJSON()` must return:
```js
{ params: {...}, steps: [...], fx: {...}, muted: bool }
```

`fromJSON()` must use `?? defaultValue` for every key to survive missing/future keys.

## Rationale

- Consistent UI across all instruments with a single pattern
- Data-driven: `SLIDER_DEFS` is the single source of truth for parameter metadata
- Serialization is first-class: every Controls component can save/restore its full state

## Consequences

- Every new instrument requires implementing the full Controls contract
- `SLIDER_DEFS` must be kept in sync with the instrument's property names exactly (a mismatch silently fails — the slider fires but the property doesn't exist)
- Controls hold a reference to the instrument; the instrument must not hold a reference back

## Related Docs

- [instrument-architecture.md](instrument-architecture.md)
- [docs/FRONTEND.md](../FRONTEND.md)
