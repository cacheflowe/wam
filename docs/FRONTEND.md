# Frontend Architecture

## Component Model

All UI is built with vanilla Web Components (`HTMLElement` subclasses). No Shadow DOM unless pre-existing. See [.github/skills/web-components/SKILL.md](../.github/skills/web-components/SKILL.md) for full conventions.

## Component Inventory

| Component | Tag | File | Purpose |
|---|---|---|---|
| `WebAudioSlider` | `<wam-slider>` | `wam-slider.js` | Range input with linear/log scale, accent color |
| `WebAudioStepSeq` | `<wam-step-seq>` | `wam-step-seq.js` | 16-step pattern grid with note select and accent toggles |
| `WebAudioWaveform` | `<wam-waveform>` | `wam-waveform.js` | Click-to-cycle visualizer: oscilloscope → spectrogram waterfall → FFT bars |
| `WebAudioFxUnit` | `<wam-fx-unit>` | `wam-fx-unit.js` | Composed FX Web Component (reverb + delay + chorus + filter) |
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

- **Volume** — output gain via `_out` GainNode
- **Pan** — stereo position via `StereoPannerNode` (`_pan`)
- **Mute** — toggles `_out.gain` to 0 / restores pre-mute volume
- **VU meter** — peak level via a dedicated `AnalyserNode`

The strip is created by `createChannelStrip()` (exported from `wam-slider.js`).

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

`injectControlsCSS()` (exported from `wam-slider.js`) injects shared `.wam-*` class styles used by all controls components.

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

Any non-slider control (a `<select>`, a `<button>`, a number input) must be wrapped with `createCtrl()` from `wam-slider.js`. This creates a `div.wam-ctrl` containing a `<label>` (with optional PicoCSS tooltip) and appends the control as a child:

```js
import { createCtrl } from "../ui/wam-slider.js";

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

All instrument-specific parameter groups use `createSection(label)` from `wam-slider.js`:

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

The component fires `step-change` events. Controls serialize/restore step state via `toJSON()`/`fromJSON()`.

## Waveform Visualizer

`<wam-waveform>` connects to an `AnalyserNode` and renders via `<canvas>`. Click to cycle modes:
1. **Oscilloscope** — time-domain waveform
2. **Spectrogram waterfall** — scrolling frequency content over time
3. **FFT bars** — frequency magnitude bars

## State Persistence

Every Controls component implements:

```js
toJSON()    // → { params, steps, fx, muted }
fromJSON()  // ← restores params, steps, fx, mute state
```

The app collects all controls' JSON into one state object, persisted to `localStorage` (debounced 500ms) and optionally encoded as a base64 URL hash for sharing.

Missing keys in `fromJSON()` fall back to defaults (`?? defaultValue`), so older saved states load cleanly when new parameters are added.

## Related Docs

- [docs/BACKEND.md](BACKEND.md) — audio engine (the layer Controls wraps)
- [docs/design-docs/controls-companion-pattern.md](design-docs/controls-companion-pattern.md)
- [.github/skills/web-components/SKILL.md](../.github/skills/web-components/SKILL.md)
