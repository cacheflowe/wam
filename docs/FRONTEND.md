# Frontend Architecture

## Component Model

All UI is built with vanilla Web Components (`HTMLElement` subclasses). No Shadow DOM unless pre-existing. See [.github/skills/web-components/SKILL.md](../.github/skills/web-components/SKILL.md) for full conventions.

## Component Inventory

| Component | Tag | File | Purpose |
|---|---|---|---|
| `WebAudioSlider` | `<wam-slider>` | `slider.js` | Range input with linear/log scale, accent color |
| `WebAudioStepSeq` | `<wam-step-seq>` | `step-seq.js` | 16-step pattern grid with note select and accent toggles |
| `WebAudioWaveform` | `<wam-waveform>` | `waveform.js` | Click-to-cycle visualizer: oscilloscope → spectrogram waterfall → FFT bars |
| `WebAudioFxUnit` | `<wam-fx-unit>` | `fx-unit.js` | Composed FX Web Component (reverb + delay + chorus + filter) |
| `WamDrawer` | `<wam-drawer>` | `drawer.js` | Shared slide-out tool panel; one panel open at a time, dismissed via close/backdrop/Escape |
| `WamMidiInputPicker` | `<wam-midi-input-picker>` | `midi-input-picker.js` | Web MIDI access manager + device dropdown; normalizes note/CC into `wam-midi-message` events |
| `WamMidiMonitor` | `<wam-midi-monitor>` | `midi-monitor.js` | Live debug view of normalized `wam-control-input` events |
| `InstrumentSourcePicker` | `<wam-instrument-source-picker>` | `instrument-source-picker.js` | Instrument-bus dropdown for FX modulator/carrier/trigger routing; emits `source-change` |
| `*Controls` | various | per-instrument files | UI panel for each instrument; wraps instrument + analyser + FxUnit + waveform |

## Controls Companion Pattern

Each instrument file exports both the audio class and a Controls Web Component. The Controls component is bound to an instrument instance via `controls.bind(instrument, ctx, options)`.

Internal signal chain after `bind()`:

```
instrument → FxUnit.input → FxUnit._out → controls._out → StereoPannerNode → masterGain
                                                 │
                                          AnalyserNode → WaveformDisplay
                                          AnalyserNode → VU Meter
```

`controls.connect(masterGain)` routes the final output to the app's master bus.

Full details: [design-docs/controls-companion-pattern.md](design-docs/controls-companion-pattern.md)

## Channel Strip

Every Controls component includes a permanent channel strip (always visible, not inside the collapsed panel):

- **Volume** — output gain via `controls._out` GainNode (not `instrument.volume`)
- **Pan** — stereo position via `StereoPannerNode` (`_pan`)
- **Mute** — toggles `_out.gain` to 0 / restores pre-mute volume
- **VU meter** — peak level via a dedicated `AnalyserNode`

The strip is created by `createChannelStrip()` (exported from `slider.js`).

### Volume node vs. instrument volume

`controls._out` (the post-FX output gain) is separate from `instrument._out` (the pre-FX instrument output). The channel strip volume slider always controls `controls._out.gain.value`. Do not read or write `this._instrument.volume` for channel strip volume — use `controls._out` directly.

The channel strip's permanent slider reference is `this._channelStripVolSlider`. Note that `this._sliders["volume"]` is overwritten by `mkSlider()` if `"volume"` appears in a subclass's `SLIDER_DEFS` (some instruments expose a second volume slider in their expanded panel). Always use `this._channelStripVolSlider` when you specifically need the channel strip slider.

## CSS Architecture

### Injection Pattern

All component CSS is injected once per page via a static `#cssInjected` flag:

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

`injectControlsCSS()` (exported from `slider.js`) injects shared `.wam-*` class styles used by all controls components.

### Theming

Accent colors are set as CSS custom properties on the parent wrapper or the component itself:

```js
this.style.setProperty("--slider-accent", options.color || "#0f0");
this.style.setProperty("--fx-accent", options.color);
```

All child elements (sliders, step buttons, waveform borders) read `--slider-accent` or `--fx-accent`. Changing the parent property themes the entire instrument panel.

### PicoCSS

The app shell uses [PicoCSS](https://picocss.com/) v2 for base typography, forms, and layout. Limit component CSS to `.wam-*` scoped selectors to avoid collisions.

#### Overriding PicoCSS on `<input>` elements

PicoCSS v2 uses CSS Level 4 `:not(A,B,C,...)` to target form elements with rules like:

```css
/* specificity: (0,1,1) — one element + one attribute from :not() */
input:not([type=checkbox],[type=radio],[type=range]) {
  height: calc(1rem * var(--pico-line-height) + var(--pico-form-element-spacing-vertical) * 2 + ...);
}
input:not([type=checkbox],[type=radio],[type=range],[type=file]) {
  padding: var(--pico-form-element-spacing-vertical) var(--pico-form-element-spacing-horizontal);
}
```

A bare class selector like `.wam-num-input` has specificity `(0,1,0)` and **loses** to these rules, even with our style tag injected after PicoCSS.

**The fix**: include the element type in the selector — `input.wam-num-input` — which reaches `(0,1,1)`, tying PicoCSS's specificity. Since `injectControlsCSS()` appends a `<style>` tag via `document.head.appendChild()`, it always lands after the PicoCSS `<link>` in source order. Equal-specificity rules resolve by source order, so ours win. No `!important` needed.

**Rule**: whenever a `.wam-*` class is applied to an `<input>` element, use `input.wam-class` (not just `.wam-class`) in `injectControlsCSS()` to ensure it overrides PicoCSS form element rules. `<button>` and `<select>` are not affected — PicoCSS targets them with lower-specificity selectors that our class rules already beat.

## Slider Component

`<wam-slider>` attributes:

| Attribute | Type | Description |
|---|---|---|
| `param` | string | Property name on the bound instrument |
| `min` | number | Minimum value |
| `max` | number | Maximum value |
| `step` | number | Increment |
| `scale` | `"log"` or omit | Logarithmic mapping for frequency controls |
| `value` | number | Initial value |
| `data-tooltip` | string | PicoCSS tooltip shown on hover of the label text only |

The slider fires a `slider-input` CustomEvent with `detail: { param, value }`. Controls components catch this via a delegated listener:

```js
this.addEventListener("slider-input", (e) => {
  this._instrument[e.detail.param] = e.detail.value;
});
```

### Tooltips

Set `tooltip` on a `SLIDER_DEFS` entry. `mkSlider()` in `WebAudioControlsBase` reads it and sets `data-tooltip` on the outer `<wam-slider>` element. `WebAudioSlider._build()` then moves the attribute from the outer element to the inner `.wam-label-text` span, so the PicoCSS tooltip triggers only on the label text — not the range input.

```js
static SLIDER_DEFS = [
  { param: "cutoff", label: "Cutoff", ..., tooltip: "Base filter cutoff frequency." },
];
```

## UI Controls Rule: every control needs a label and tooltip

**Every interactive control — slider, select, button — must be wrapped so it has a visible label and a hover tooltip.** This is the single most important layout rule in the codebase. Bare `<select>` or `<button>` elements appended directly to a section are not acceptable.

### Sliders

`<wam-slider>` handles this natively. Set `label` (visible) and `data-tooltip` (hover) on the element:

```js
const s = document.createElement("wam-slider");
s.setAttribute("label", "Cutoff");
s.setAttribute("data-tooltip", "Low-pass filter cutoff frequency.");
```

Or via `mkSlider()` in `WebAudioControlsBase._buildControls()`:

```js
sec.appendChild(mkSlider({ param: "cutoff", label: "Cutoff", tooltip: "Low-pass filter cutoff frequency." }));
```

### Selects and Buttons: `createCtrl()`

Any non-slider control (a `<select>`, a `<button>`, a number input) must be wrapped with `createCtrl()` from `slider.js`. This creates a `div.wam-ctrl` containing a `<label>` (with optional PicoCSS tooltip) and appends the control as a child:

```js
import { createCtrl } from "../ui/slider.js";

// Select
const mySelect = document.createElement("select");
mySelect.className = "wam-select";
// ... populate options ...
const ctrl = createCtrl("Shape", { tooltip: "Oscillator waveform shape." });
ctrl.appendChild(mySelect);
sec.appendChild(ctrl);

// Button
const btn = document.createElement("button");
btn.textContent = "Randomize";
const btnCtrl = createCtrl("Rand", { tooltip: "Randomize the sequencer pattern." });
btnCtrl.appendChild(btn);
sec.appendChild(btnCtrl);
```

**Signature:**
```js
createCtrl(labelText, { wide = false, tooltip = null } = {}) → HTMLElement
```
- `wide: true` sets `min-width: 220px` instead of the default `110px` — use for longer selects.
- `tooltip` is set as `data-tooltip` on the `<label>`, so PicoCSS shows it on label hover only (not on the input itself).

### What this produces

```html
<div class="wam-ctrl">
  <label data-tooltip="Oscillator waveform shape.">Shape</label>
  <select class="wam-select">...</select>
</div>
```

### `SLIDER_DEFS` (declarative alternative)

`WebAudioControlsBase` subclasses can declare sliders statically. The `mkSlider()` factory inside `_buildControls()` reads `SLIDER_DEFS` and applies labels and tooltips automatically. Always provide a `tooltip` string for every entry:

```js
static SLIDER_DEFS = [
  { param: "cutoff", label: "Cutoff", min: 80, max: 18000, step: 1, scale: "log",
    tooltip: "Low-pass filter cutoff frequency." },
];
```

---

## Controls Layout: `createSection()`

All instrument-specific parameter groups use `createSection(label)` from `slider.js`:

```js
const { el, controls } = createSection("Envelope");
controls.appendChild(mkSlider({ param: "attack", ... }));
controls.appendChild(mkSlider({ param: "decay", ... }));
expanded.appendChild(el);
```

This produces:

```html
<div class="wam-section">
  <div class="wam-title">Envelope</div>
  <div class="wam-section-controls">...</div>
</div>
```

Key CSS classes:
- `.wam-section` — groups a title and controls row
- `.wam-title` — section label (also used for channel strip title)
- `.wam-section-controls` — flex row for sliders, selects, and buttons
- `.wam-ctrl` — labeled wrapper for any non-slider control (see above)
- `.wam-select` — styled `<select>` (max-width: 160px for instrument controls; 120px inside FX unit)

Do not use `.wam-controls` as a section container — use `createSection()` instead.

## Step Sequencer UI

`<wam-step-seq>` renders a 16-step grid. Each step has:
- **Active toggle** (click): enables/disables the step
- **Note select** (dropdown): MIDI note from the current scale
- **Accent toggle** (shift-click or secondary button): boosts velocity

Opt-in per-step controls (enabled via the `init` options `accent` / `probability` / `ratchet` / `conditions`):
- **Probability** (slider, 0–1): chance the step fires
- **Ratchet** (selector, 1/2/3): subdivides the step into repeats
- **Trig condition** (dropdown): Elektron-style `X:Y` bar-cycle gate — the step fires only on pass X of every Y bars. Options are built from `CONDITION_GROUPS` in [src/web-audio/global/sequencer-conditions.js](../src/web-audio/global/sequencer-conditions.js) into grouped `<optgroup>`s; that module is the single source of truth shared with the playback evaluator (see [docs/BACKEND.md](BACKEND.md#step-trig-conditions-gate-by-bar-cycle)).

The component fires `step-change` events. Controls serialize/restore step state via `toJSON()`/`fromJSON()`.

## Waveform Visualizer

`<wam-waveform>` connects to an `AnalyserNode` and renders via `<canvas>`. Click to cycle modes:
1. **Oscilloscope** — time-domain waveform
2. **Spectrogram waterfall** — scrolling frequency content over time
3. **FFT bars** — frequency magnitude bars

## Input Abstraction & Learn

Control input from the computer keyboard and MIDI hardware is normalized into a single source-agnostic stream so the "learn" system never has to special-case a device. The layer lives in [src/web-audio/input/](../src/web-audio/input/):

- **`input-bindings.js`** — the contract. Adapters call `registerBindingType(source, { equals, format })`; the rest of the app compares bindings with `bindingsEqual()` and labels them with `formatBinding()` without knowing the source. Adapters dispatch normalized `wam-control-input` events (a `wam-control-input` event carries `{ binding, value: 0..1, trigger }`) and the learn UI dispatches `wam-binding-feedback` (bound / unbound / value) so hardware can mirror state. `migrateLegacyBinding()` upgrades pre-abstraction saved bindings (e.g. a bare keyboard `key` string) to the tagged shape.
- **`keyboard-source.js`** — `KeyboardInputSource` (singleton via `ensureKeyboardInputSource()`) maps key press/release to `wam-control-input`.
- **`midi-source.js`** — `MidiInputSource` (singleton via `ensureMidiInputSource()`) converts raw `wam-midi-message` events from the picker into `wam-control-input`. Raw MIDI still broadcasts so device-specific handlers (LED feedback, template tracking) can listen too.

### Input Learn Mixin

`input-learn.js` exports `InputLearnMixin` + `applyInputLearnMixin(targetClass)`. Applying the mixin gives any control panel source-agnostic learn: **hold a UI control and move a controller** (or right-click) to bind it; the bound parameter then tracks the normalized 0..1 value. It is applied to `WebAudioControlsBase` (all instrument panels) and `WebAudioTransportControls`. The jam button uses the same path — its binding is the source-tagged `_jamBinding` object (formerly a bare `_jamKey` string).

### Focus Manager

`focus-manager.js` exports the `focusManager` singleton. It tracks the focused instrument panel, outlines it with `.wam-focused`, and broadcasts `wam-instrument-focus-change`. Controls dispatch focus on pointerdown so hardware (notably the sequencer buttons) follows the active instrument. Call `focusManager.start()` once at app init.

### MIDI hardware

Device drivers live in [src/web-audio/midi/](../src/web-audio/midi/) — see [docs/BACKEND.md](BACKEND.md#midi-hardware-control) and the [Launch Control XL map](references/launch-control-xl.md). The on-screen `<wam-midi-input-picker>` owns the single `MIDIAccess` for the page; everything else reuses its `.midiAccess` (see [docs/RELIABILITY.md](RELIABILITY.md) for why one access object is mandatory). Manual hardware test checklist: [docs/testing/midi-input-and-led-testing.md](testing/midi-input-and-led-testing.md).

## State Persistence

Every Controls component implements:

```js
toJSON()    // → { params, steps, fx, muted }
fromJSON()  // ← restores params, steps, fx, mute state
```

The app collects all controls' JSON into one state object, persisted to `localStorage` (debounced 500ms) and optionally encoded as a base64 URL hash for sharing.

Missing keys in `fromJSON()` fall back to defaults (`?? defaultValue`), so older saved states load cleanly when new parameters are added.

### How a slider change reaches localStorage

```
user drags slider
  → wam-slider fires slider-input (bubbles)
  → controls-base slider-input handler applies audio change
  → handler calls this._emitChange()
  → controls-change event bubbles to app
  → app's controls-change listener calls _debouncedSave()
  → 500ms later: localStorage.setItem(...)
```

Any user interaction that should be persisted **must** result in `_emitChange()` being called. The base class `slider-input` handler calls it automatically for all slider params (volume, pan, and SLIDER_DEFS params). Other interactions — selects, buttons, step changes — must call `_emitChange()` explicitly. Do not call `_emitChange()` from `_onSliderInput()` overrides; the base handler already calls it after `_onSliderInput` returns.

### Serializing volume correctly

`toJSON()` serializes volume via `this._muteHandle.getVolume()`, not `this._out.gain.value`. When an instrument is muted, `_out.gain.value` is 0 — serializing it directly would save 0 and cause a silent instrument on restore. `getVolume()` returns `preMuteVolume` when muted (the real intended volume) and `_out.gain.value` otherwise.

### Overriding `_restoreParam`

The base `_restoreParam` handles `"volume"` specially: it updates `_out.gain.value` and `_channelStripVolSlider`. When a subclass overrides `_restoreParam`, call `super._restoreParam(key, val)` for all keys not explicitly handled:

```js
// Correct
_restoreParam(key, val) {
  if (key === "oscType") {
    this._instrument.oscType = val;
    this._syncWaveSelect();
  } else {
    super._restoreParam(key, val);  // handles volume, gain, sliders
  }
}

// Wrong — bypasses _out.gain and channel strip slider for "volume"
_restoreParam(key, val) {
  this._instrument[key] = val;
  if (this._sliders[key]) this._sliders[key].value = val;
}
```

The second pattern silently fails to restore the channel strip volume slider and routes volume to the wrong gain node.

## Related Docs

- [docs/BACKEND.md](BACKEND.md) — audio engine (the layer Controls wraps)
- [docs/design-docs/controls-companion-pattern.md](design-docs/controls-companion-pattern.md)
- [.github/skills/web-components/SKILL.md](../.github/skills/web-components/SKILL.md)
