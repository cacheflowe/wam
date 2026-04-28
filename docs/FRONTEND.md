# Frontend Architecture

## Component Model

All UI is built with vanilla Web Components (`HTMLElement` subclasses). No Shadow DOM unless pre-existing. See [.github/skills/web-components/SKILL.md](../.github/skills/web-components/SKILL.md) for full conventions.

## Component Inventory

| Component | Tag | File | Purpose |
|---|---|---|---|
| `WebAudioSlider` | `<web-audio-slider>` | `web-audio-slider.js` | Range input with linear/log scale, accent color |
| `WebAudioStepSeq` | `<web-audio-step-seq>` | `web-audio-step-seq.js` | 16-step pattern grid with note select and accent toggles |
| `WebAudioWaveform` | `<web-audio-waveform>` | `web-audio-waveform.js` | Click-to-cycle visualizer: oscilloscope → spectrogram waterfall → FFT bars |
| `WebAudioFxUnit` | `<web-audio-fx-unit>` | `web-audio-fx-unit.js` | Composed FX Web Component (reverb + delay + chorus + filter) |
| `*Controls` | various | per-instrument files | UI panel for each instrument; wraps instrument + analyser + FxUnit + waveform |

## Controls Companion Pattern

Each instrument file exports both the audio class and a Controls Web Component. The Controls component is bound to an instrument instance via `controls.bind(instrument, ctx, options)`.

Internal signal chain after `bind()`:

```
instrument → AnalyserNode → FxUnit.input → FxUnit._out → controls._out
                   │
             WaveformDisplay
```

`controls.connect(masterGain)` routes the final output to the app's master bus.

Full details: [design-docs/controls-companion-pattern.md](design-docs/controls-companion-pattern.md)

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

`injectControlsCSS()` (exported from `web-audio-slider.js`) injects shared `.wac-*` class styles used by all controls components.

### Theming

Accent colors are set as CSS custom properties on the parent wrapper or the component itself:

```js
this.style.setProperty("--slider-accent", options.color || "#0f0");
this.style.setProperty("--fx-accent", options.color);
```

All child elements (sliders, step buttons, waveform borders) read `--slider-accent` or `--fx-accent`. Changing the parent property themes the entire instrument panel.

### PicoCSS

The app shell uses [PicoCSS](https://picocss.com/) for base typography, forms, and layout. Don't override PicoCSS defaults inside library components — limit component CSS to `.wac-*` scoped selectors.

## Slider Component

`<web-audio-slider>` attributes:

| Attribute | Type | Description |
|---|---|---|
| `param` | string | Property name on the bound instrument |
| `min` | number | Minimum value |
| `max` | number | Maximum value |
| `step` | number | Increment |
| `scale` | `"log"` or omit | Logarithmic mapping for frequency controls |
| `value` | number | Initial value |

The slider fires a `slider-input` CustomEvent with `detail: { param, value }`. Controls components catch this via a delegated listener:

```js
this.addEventListener("slider-input", (e) => {
  this._instrument[e.detail.param] = e.detail.value;
});
```

## Step Sequencer UI

`<web-audio-step-seq>` renders a 16-step grid. Each step has:
- **Active toggle** (click): enables/disables the step
- **Note select** (dropdown): MIDI note from the current scale
- **Accent toggle** (shift-click or secondary button): boosts velocity

The component fires `step-change` events. Controls serialize/restore step state via `toJSON()`/`fromJSON()`.

## Waveform Visualizer

`<web-audio-waveform>` connects to an `AnalyserNode` and renders via `<canvas>`. Click to cycle modes:
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
