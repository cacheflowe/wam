# Web Audio Instrument Library

A zero-dependency browser synthesizer toolkit built on the Web Audio API and Web Components. Every instrument, effect, and UI control is a vanilla JS class or custom element -- no frameworks, no build-time CSS, no external audio libraries.

---

## Architecture overview

The library has four layers:

```
Demo / App              wam-acid.js (wires everything together)
                              |
Controls (Web Components)     <wam-synth-acid-controls>
                              |
Instruments (plain classes)   WebAudioSynthAcid
                              |
Effects & Utilities           WebAudioFxDelay, WebAudioFxUnit, WebAudioSequencer, etc.
```

**Instruments** are plain JS classes with no DOM. They own audio nodes, accept `trigger()` calls, and expose `connect()` / `input` for routing.

**Controls** are Web Components (`HTMLElement` subclasses) that wrap an instrument with sliders, presets, step sequencer, FX chain, and waveform display. They handle all UI and serialization.

**Effects** are plain JS classes that slot into the audio graph. `WebAudioFxUnit` is the one exception -- it's a Web Component that composes multiple effects with a unified UI.

**Utilities** include the sequencer, scales module, slider component, step sequencer UI, and waveform visualizer.

---

## File inventory

### Instruments

| File | Class | Type | Description |
|------|-------|------|-------------|
| `wam-synth-acid.js` | `WebAudioSynthAcid` | Mono bass | TB-303-style acid synth with resonant filter sweep, portamento, unison |
| `wam-synth-808.js` | `WebAudioSynth808` | Pitched bass | 808 sub-bass with pitch sweep, click transient, sub oscillator, tone filter |
| `wam-synth-fm.js` | `WebAudioSynthFM` | Poly FM | 2-operator FM synth with mod envelope, BPM-synced filter LFO, chord mode |
| `wam-synth-mono.js` | `WebAudioSynthMono` | Mono synth | Sawtooth/square/triangle with ADSR, filter envelope, detune, sub osc |
| `wam-synth-pad.js` | `WebAudioSynthPad` | Poly pad | Chord pad with constant-power voice scaling |
| `wam-synth-blipfx.js` | `WebAudioSynthBlipFX` | SFX | Procedural sound effects with 6 waveforms, FM, bit-crush, randomization |
| `wam-perc-kick.js` | `WebAudioPercKick` | Percussion | 808-style kick via sine sweep |
| `wam-perc-hihat.js` | `WebAudioPercHihat` | Percussion | Bandpass-filtered noise with open/closed character |
| `wam-break-player.js` | `WebAudioBreakPlayer` | Sampler | Drum loop player with time-stretch, random jumps, reverse, BPM sync |

Each instrument file also exports a `*Controls` companion class (e.g., `WebAudioSynthAcidControls`), registered as a custom element.

### Effects

| File | Class | Description |
|------|-------|-------------|
| `wam-fx-reverb.js` | `WebAudioFxReverb` | Convolution reverb with synthesized impulse response, dry/wet |
| `wam-fx-delay.js` | `WebAudioFxDelay` | Dub delay with BPM sync, feedback LP filter, LFO modulation |
| `wam-fx-chorus.js` | `WebAudioFxChorus` | Multi-voice chorus (1-6 voices) with stereo spread, feedback |
| `wam-fx-filter.js` | `WebAudioFxFilter` | Combined HP + LP with shared Q, always inline (no dry/wet) |
| `wam-fx-distortion.js` | `WebAudioFxDistortion` | Soft-clip waveshaper with dry/wet |
| `wam-fx-unit.js` | `WebAudioFxUnit` | **Web Component** composing reverb + delay + chorus + filter with full UI |

### Audio processing

| File | Class | Description |
|------|-------|-------------|
| `wam-pitch-shift.js` | `WebAudioPitchShift` | Real-time pitch-shift effect (granular overlap-add) |
| `wam-pitch-shift.worklet.js` | (AudioWorklet) | Worklet processor for pitch shifting |
| `wam-time-stretch.js` | `WebAudioTimeStretch` | Granular time-stretch with independent speed/pitch |
| `wam-time-stretch.worklet.js` | (AudioWorklet) | Worklet processor for time stretching |

### UI components

| File | Class | Custom element | Description |
|------|-------|----------------|-------------|
| `wam-slider.js` | `WebAudioSlider` | `<wam-slider>` | Range input with linear/log scale, color theming |
| `wam-step-seq.js` | `WebAudioStepSeq` | `<wam-step-seq>` | 16-step sequencer grid with note select, accent toggles |
| `wam-waveform.js` | `WebAudioWaveform` | `<wam-waveform>` | Visualizer: oscilloscope, spectrogram waterfall, FFT bars (click to cycle) |

`wam-slider.js` also exports two helper functions used by all controls components:

- `injectControlsCSS()` -- shared CSS for the `.wam-*` class system
- `createTitleWithMute(parentEl, title, getOutGain)` -- title bar with mute toggle

### Utilities

| File | Exports | Description |
|------|---------|-------------|
| `wam-sequencer.js` | `WebAudioSequencer` | Lookahead step sequencer (Chris Wilson technique) |
| `wam-scales.js` | `SCALES`, `scaleNotesInRange()`, `buildChordFromScale()`, etc. | Music theory: 8 scales (dark-to-bright), note names, chord builder |

---

## Design patterns

### 1. The `connect()` / `input` protocol

Every instrument and effect exposes the same routing interface:

```js
// Connect to a downstream node (AudioNode or library object)
connect(node) {
  this._out.connect(node.input ?? node);
  return this;
}

// Expose input for upstream connections
get input() { return this._in; }
```

The `node.input ?? node` pattern lets you chain library objects and raw `AudioNode`s interchangeably:

```js
synth.connect(effect);          // effect.input is a GainNode
effect.connect(ctx.destination); // ctx.destination is an AudioNode
synth.connect(analyser);        // AnalyserNode is an AudioNode
```

### 2. Fire-and-forget voices

Instruments don't maintain a voice pool. Each `trigger()` creates fresh oscillator/filter/VCA nodes, schedules them via Web Audio's timeline, and auto-cleans via `osc.onended`:

```js
trigger(midi, durationSec, velocity, atTime) {
  const osc = ctx.createOscillator();
  const vca = ctx.createGain();
  // ... schedule envelope, connect, start, stop
  osc.onended = () => { osc.disconnect(); vca.disconnect(); };
}
```

This is the standard Web Audio pattern -- the browser's garbage collector handles node cleanup after `stop()`. No manual voice allocation, no polyphony limits.

### 3. Static PRESETS + applyPreset()

Every instrument has a static `PRESETS` object and an `applyPreset(name)` method:

```js
static PRESETS = {
  Default: { cutoff: 600, resonance: 10, decay: 0.3, ... },
  Squelch: { cutoff: 300, resonance: 20, decay: 0.2, ... },
};

constructor(ctx, preset = "Default") {
  // ... create audio nodes ...
  this.applyPreset(preset);
}

applyPreset(name) {
  const p = WebAudioSynthAcid.PRESETS[name];
  if (!p) return;
  if (p.cutoff != null) this.cutoff = p.cutoff;
  // ... each param checked individually for null safety
}
```

The `!= null` guard allows presets to be partial -- you only need to specify the params you want to override.

### 4. The Controls companion pattern

Each instrument file exports both the audio class and a Controls web component:

```js
// wam-synth-acid.js
export default class WebAudioSynthAcid { ... }
export class WebAudioSynthAcidControls extends HTMLElement { ... }
customElements.define("wam-synth-acid-controls", WebAudioSynthAcidControls);
```

Every Controls class follows the same lifecycle:

```js
class WebAudioSynthAcidControls extends HTMLElement {
  // Slider parameter definitions -- drives UI generation
  static SLIDER_DEFS = [
    { param: "cutoff", label: "Cutoff", min: 50, max: 10000, step: 1, scale: "log" },
    { param: "resonance", label: "Reso", min: 0.1, max: 30, step: 0.1 },
    // ...
  ];

  bind(instrument, ctx, options = {}) {
    this._instrument = instrument;
    // 1. Inject shared CSS (idempotent)
    injectControlsCSS();
    // 2. Set accent color via CSS custom property
    this.style.setProperty("--slider-accent", options.color || "#0f0");
    // 3. Build UI: title, preset dropdown, sliders from SLIDER_DEFS, ...
    // 4. Create step sequencer (if applicable)
    // 5. Create FX unit: analyser -> fx -> output gain
    // 6. Create waveform visualizer
  }

  // Route audio: instrument -> analyser -> fxUnit -> _out
  connect(node) { this._out.connect(node.input ?? node); }

  // Sequencer integration
  step(index, time, stepDurSec) { ... }
  setActiveStep(i) { ... }

  // State persistence
  toJSON() { return { params: {...}, steps: [...], fx: {...}, muted: bool }; }
  fromJSON(obj) { /* restore params, steps, fx, mute state */ }

  // BPM propagation
  set bpm(v) { this._fxUnit.bpm = v; }
}
```

The `bind()` call wires the audio graph internally:

```
instrument -> AnalyserNode -> FxUnit.input -> FxUnit -> _out GainNode
                                |
                          WaveformDisplay
```

### 5. Slider-driven parameter binding

UI generation is data-driven via `static SLIDER_DEFS`:

```js
static SLIDER_DEFS = [
  { param: "filterFreq", label: "Filter", min: 20, max: 12000, step: 1, scale: "log" },
  { param: "decay",      label: "Decay",  min: 0.01, max: 2, step: 0.01 },
];
```

Controls iterate this array to create `<wam-slider>` elements and bind them via a delegated `slider-input` event listener:

```js
this.addEventListener("slider-input", (e) => {
  this._instrument[e.detail.param] = e.detail.value;
});
```

The `param` attribute on the slider matches the property name on the instrument class. This means adding a new parameter to an instrument requires only: (1) add a getter/setter on the class, (2) add an entry to `SLIDER_DEFS`, (3) add it to the preset objects.

### 6. Logarithmic slider scale

Frequency controls use `scale="log"` for perceptually uniform slider travel:

```html
<wam-slider param="lpFreq" min="80" max="20000" step="1" scale="log">
```

Internally, the slider maps a 0-1 normalized position to/from the real value range using exponential curves:

```js
// 0..1 position -> real value
_fromSlider(position) {
  return min * Math.pow(max / min, position);
}

// real value -> 0..1 position
_toSlider(realValue) {
  return Math.log(realValue / min) / Math.log(max / min);
}
```

This gives most slider travel to the perceptually useful range (e.g., 80-2000 Hz) rather than wasting it on inaudible high frequencies.

### 7. Composed FX unit

`WebAudioFxUnit` is a web component that composes standalone effect instances:

```
in -> WebAudioFxReverb (dry=1, wet adjustable)  -> preOut
in -> WebAudioFxDelay  (internal dry/wet)        -> preOut
in -> WebAudioFxChorus (internal dry/wet)        -> preOut
preOut -> WebAudioFxFilter (HP -> LP, always inline) -> out
```

Each effect is a standalone class with its own `input`/`connect()` routing. The FX unit just wires them in parallel (reverb, delay, chorus all receive the input) through a shared filter on the output. This makes it trivial to add new effects.

The FX unit provides slider UIs for all effect parameters and handles `toJSON()`/`fromJSON()` serialization.

### 8. BPM-synced timing

The delay and FM synth LFO use beat-interval parameters instead of raw Hz:

```js
// Delay: interval in beats, converted to seconds
_computeDelayTime() {
  return (60 / this._bpm) * (this._interval ?? 0.75);
}

// FM LFO: interval in beats, converted to Hz
_updateLfoFreq() {
  this._lfo.frequency.value = (this._bpm / 60) / this._lfoInterval;
}
```

Both use dropdown selects with musical intervals:

```js
static INTERVALS = [
  { label: "1/16", beats: 0.25 },
  { label: "1/8",  beats: 0.5 },
  { label: "1/8.", beats: 0.75 },
  { label: "1/4",  beats: 1 },
  { label: "1/4.", beats: 1.5 },
  { label: "1/2",  beats: 2 },
];
```

BPM changes propagate from the transport through `controls.bpm = v`, which forwards to the FX unit and instrument.

### 9. State serialization

Every Controls component implements `toJSON()` / `fromJSON()` for full state persistence:

```js
toJSON() {
  return {
    params: { cutoff: 600, resonance: 10, ... },  // instrument params
    steps: [{ active: true, note: 29, accent: false }, ...],  // sequencer
    fx: { reverbWet: 0.15, delayMix: 0.3, ... },  // fx unit state
    muted: false,
  };
}
```

The demo app collects all controls' JSON into a single state object, saved to `localStorage` on every change (debounced 500ms) and optionally encoded as a base64 URL hash for sharing.

Backward compatibility is maintained by using `?? defaults` for missing keys -- old saved states without newer params (e.g., chorus) load cleanly with defaults.

### 10. CSS injection pattern

All components inject their CSS once per page using a static flag:

```js
static #cssInjected = false;

static _injectCSS() {
  if (WebAudioSlider.#cssInjected) return;
  WebAudioSlider.#cssInjected = true;
  const style = document.createElement("style");
  style.textContent = `...`;
  document.head.appendChild(style);
}
```

This avoids shadow DOM, keeps the DOM inspectable, and allows parent CSS custom properties (`--slider-accent`, `--fx-accent`) to theme child components.

### 11. Color theming via CSS custom properties

Each instrument gets a unique accent color, set on a parent wrapper:

```css
.acid-group    { --fx-accent: #0f0; }
.bass808-group { --fx-accent: #fa0; }
.chord-fm-group { --fx-accent: #4af; }
```

Controls components propagate this via `--slider-accent`:

```js
this.style.setProperty("--slider-accent", options.color || "#0f0");
this.style.setProperty("--fx-accent", options.color);
```

All UI elements (sliders, buttons, waveforms, step sequencer) read from these properties, so changing one color themes the entire instrument panel.

### 12. Sequencer architecture

`WebAudioSequencer` uses the Chris Wilson lookahead technique:

- A `setInterval` fires every 25ms
- Each tick pre-schedules any steps within the next 100ms
- Steps are scheduled as Web Audio events (sample-accurate), not driven by JS timers

```js
seq.onStep((step, time) => {
  // `time` is AudioContext.currentTime -- schedule audio here
  acid.trigger(note, dur, accent, time);
  // UI updates use setTimeout to approximate the visual timing
  setTimeout(() => controls.setActiveStep(step), (time - ctx.currentTime) * 1000);
});
```

Multiple callbacks can be registered via `onStep()`. The demo registers one callback that delegates to each instrument's controls.

---

## Wiring it all together (demo pattern)

```js
// 1. Create AudioContext + master gain
const ctx = new AudioContext();
const master = ctx.createGain();
master.connect(ctx.destination);

// 2. Create instrument + controls
const acid = new WebAudioSynthAcid(ctx);
const acidControls = document.createElement("wam-synth-acid-controls");
container.appendChild(acidControls);
acidControls.bind(acid, ctx, {
  color: "#0f0",
  fx: { bpm: 128, reverbWet: 0.15, delayMix: 0.3 },
});
acidControls.connect(master);

// 3. Create sequencer
const seq = new WebAudioSequencer(ctx, { bpm: 128, steps: 16 });
seq.onStep((step, time) => {
  acidControls.step(step, time, seq.stepDurationSec());
});
seq.start();

// 4. BPM changes
seq.bpm = 140;
acidControls.bpm = 140;

// 5. Save / restore state
const state = acidControls.toJSON();
acidControls.fromJSON(state);
```

---

## Music theory module

`wam-scales.js` provides:

- **8 scales** ordered dark-to-bright: Phrygian, Blues, Minor, Dorian, Pentatonic Minor, Pentatonic Major, Major, Lydian
- **`scaleNotesInRange(root, scale, min, max)`** -- all MIDI notes in a scale within a range
- **`scaleNoteOptions(root, scale, min, max)`** -- `[["C2", 36], ...]` pairs for `<select>` options
- **`buildChordFromScale(root, scale, size)`** -- stacked-thirds chord builder
- **`STEP_WEIGHTS`** -- 16-step trigger probability weights (higher on downbeats)
- **`LEAD_OSC_TYPES`** -- oscillator types mapped dark-to-bright for generative music

---

## Dependencies

None. The entire library uses:
- Web Audio API (AudioContext, OscillatorNode, BiquadFilterNode, ConvolverNode, etc.)
- Web Components (HTMLElement, customElements.define)
- Standard DOM APIs

No npm packages, no build plugins, no CSS preprocessors. The only build tool dependency is a bundler that supports ES module imports (e.g., Vite).
