import "./wam-level-meter.js";

// Set to false to start all channel strips expanded by default.
export const CHANNEL_STRIP_COLLAPSED_DEFAULT = true;

/**
 * WebAudioSlider — shared range-input web component for audio parameter controls.
 *
 * Light DOM, CSS injected once. Dispatches `slider-input` events on user
 * interaction; programmatic `.value` updates the display silently (no event).
 *
 * Usage:
 *   <wam-slider label="Cutoff" param="cutoff"
 *     min="50" max="10000" step="1" value="600"></wam-slider>
 *
 * Logarithmic scale (ideal for frequency controls):
 *   <wam-slider label="LPF" param="lpFreq"
 *     min="80" max="20000" step="1" scale="log" value="20000"></wam-slider>
 *
 * Color theming (in priority order):
 *   1. `color` attribute on the element
 *   2. `--slider-accent` CSS custom property from parent
 *   3. Default #0f0
 *
 * Events:
 *   slider-input  { param: string, value: number }  — bubbles, user-only
 */
export default class WebAudioSlider extends HTMLElement {
  static #cssInjected = false;

  constructor() {
    super();
    this._range = null;
    this._valEl = null;
    this._built = false;
  }

  connectedCallback() {
    WebAudioSlider._injectCSS();
    if (!this._built) this._build();
  }

  // ---- Observed attributes ----

  static get observedAttributes() {
    return ["label", "param", "min", "max", "step", "value", "color", "hint", "scale"];
  }

  attributeChangedCallback(name, _old, val) {
    if (!this._built) return;
    if (name === "value") {
      const num = parseFloat(val);
      this._setDisplayValue(num);
      if (this._range) this._range.value = this._isLog ? this._toSlider(num) : num;
    } else if (name === "label") {
      const lbl = this.querySelector(".wam-label-text");
      if (lbl) lbl.textContent = val + " ";
    } else if (name === "min" || name === "max" || name === "step") {
      if (!this._isLog && this._range) this._range[name] = val;
    } else if (name === "color") {
      this.style.setProperty("--slider-accent", val);
    } else if (name === "hint") {
      let hintEl = this.querySelector(".wam-hint");
      if (val) {
        if (!hintEl) {
          hintEl = document.createElement("span");
          hintEl.className = "wam-hint";
          const top = this.querySelector(".wam-top");
          if (top) top.appendChild(hintEl);
        }
        hintEl.textContent = val;
      } else if (hintEl) {
        hintEl.remove();
      }
    }
  }

  // ---- Value property (programmatic set = no event) ----

  get value() {
    if (!this._range) return parseFloat(this.getAttribute("value") || 0);
    return this._isLog ? this._fromSlider(parseFloat(this._range.value)) : parseFloat(this._range.value);
  }

  set value(v) {
    const num = typeof v === "number" ? v : parseFloat(v);
    if (this._range) this._range.value = this._isLog ? this._toSlider(num) : num;
    this._setDisplayValue(num);
    this.setAttribute("value", num);
  }

  // ---- Build ----

  _build() {
    this._built = true;
    this.innerHTML = "";

    const label = this.getAttribute("label") || "";
    const param = this.getAttribute("param") || "";
    const min = this.getAttribute("min") || "0";
    const max = this.getAttribute("max") || "1";
    const step = this.getAttribute("step") || "0.01";
    const value = this.getAttribute("value") || min;
    const color = this.getAttribute("color");
    const hint = this.getAttribute("hint");
    this._isLog = this.getAttribute("scale") === "log";
    this._logMin = parseFloat(min);
    this._logMax = parseFloat(max);

    if (color) this.style.setProperty("--slider-accent", color);

    // Top row: label + value + optional hint
    const top = document.createElement("div");
    top.className = "wam-top";

    const lbl = document.createElement("label");
    lbl.className = "wam-label";
    const labelText = document.createElement("span");
    labelText.className = "wam-label-text";
    labelText.textContent = label + " ";
    const tooltip = this.getAttribute("data-tooltip");
    if (tooltip) {
      labelText.setAttribute("data-tooltip", tooltip);
      this.removeAttribute("data-tooltip");
    }
    this._valEl = document.createElement("span");
    this._valEl.className = "wam-val";
    lbl.appendChild(labelText);
    lbl.appendChild(this._valEl);
    top.appendChild(lbl);

    if (hint) {
      const hintEl = document.createElement("span");
      hintEl.className = "wam-hint";
      hintEl.textContent = hint;
      top.appendChild(hintEl);
    }

    this.appendChild(top);

    // Range input — log sliders use 0–1 normalized, linear sliders use real min/max
    this._range = document.createElement("input");
    this._range.type = "range";
    this._range.className = "wam-range";
    if (this._isLog) {
      this._range.min = 0;
      this._range.max = 1;
      this._range.step = 0.001;
      this._range.value = this._toSlider(parseFloat(value));
    } else {
      this._range.min = min;
      this._range.max = max;
      this._range.step = step;
      this._range.value = value;
    }
    this.appendChild(this._range);

    this._setDisplayValue(parseFloat(value));

    // Return focus to document after dragging so spacebar/key commands aren't swallowed
    this._range.addEventListener("pointerup", () => { this._range.blur(); });

    // User interaction only — dispatches slider-input event
    this._range.addEventListener("input", () => {
      const raw = parseFloat(this._range.value);
      const v = this._isLog ? this._fromSlider(raw) : raw;
      this._setDisplayValue(v);
      this.setAttribute("value", v);
      this.dispatchEvent(
        new CustomEvent("slider-input", {
          bubbles: true,
          detail: { param, value: v },
        }),
      );
    });

    const defaultAttr = this.getAttribute("default");
    if (defaultAttr !== null) {
      this._range.addEventListener("dblclick", () => {
        const def = parseFloat(defaultAttr);
        this.value = def;
        this.dispatchEvent(
          new CustomEvent("slider-input", {
            bubbles: true,
            detail: { param, value: def },
          }),
        );
      });
    }
  }

  // ---- Log scale helpers ----
  // Map between real value (min..max) and normalized slider position (0..1)
  // using exponential curve: value = min * (max/min)^position

  _toSlider(realValue) {
    const lo = Math.max(this._logMin, 1e-6); // avoid log(0)
    const hi = this._logMax;
    return Math.log(realValue / lo) / Math.log(hi / lo);
  }

  _fromSlider(position) {
    const lo = Math.max(this._logMin, 1e-6);
    const hi = this._logMax;
    const step = parseFloat(this.getAttribute("step") || "1");
    const raw = lo * Math.pow(hi / lo, position);
    // Snap to step
    return Math.round(raw / step) * step;
  }

  // ---- Display formatting ----

  _setDisplayValue(v) {
    if (!this._valEl) return;
    const step = parseFloat(this.getAttribute("step") || "0.01");
    if (step < 0.01) this._valEl.textContent = v.toFixed(3);
    else if (step < 1) this._valEl.textContent = v.toFixed(2);
    else this._valEl.textContent = Math.round(v);
  }

  // ---- CSS (injected once) ----

  static _injectCSS() {
    if (WebAudioSlider.#cssInjected) return;
    WebAudioSlider.#cssInjected = true;
    const s = document.createElement("style");
    s.textContent = `
      wam-slider {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 80px;
        font-family: monospace;
      }
      .wam-top {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 6px;
      }
      .wam-label {
        font-size: 0.7em;
        color: #555;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .wam-val {
        color: var(--slider-accent, #0f0);
        font-family: monospace;
      }
      .wam-hint {
        font-size: 0.6em;
        color: #444;
        white-space: nowrap;
      }
      .wam-range {
        width: 100%;
        height: 22px;
        box-sizing: border-box;
        accent-color: var(--slider-accent, #0f0);
      }
    `;
    document.head.appendChild(s);
  }
}

customElements.define("wam-slider", WebAudioSlider);

// ---- Shared CSS for instrument controls components ----

let _controlsCSSInjected = false;

/**
 * Inject shared CSS for `<wam-*-controls>` components.
 * Call from any controls component's bind() — only injects once.
 */
export function injectControlsCSS() {
  if (_controlsCSSInjected) return;
  _controlsCSSInjected = true;
  const s = document.createElement("style");
  s.textContent = /* css */ `
    .wam-panel {
      display: block;
      background: #141414;
      border: 1px solid #222;
      border-radius: 6px;
      font-family: monospace;
    }
    /* .wam-play-btn appearance defined in the shared control foundation below */
    .wam-transport-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      flex-wrap: wrap;
      background: #0a0a14;
    }
    .wam-transport-row wam-slider {
      flex: 1;
      min-width: 80px;
      max-width: 160px;
    }
    .wam-transport-row .wam-select {
      max-width: 90px;
    }
    .wam-transport-share-slot {
      margin-left: auto;
    }
    /* Clip channel strip and waveform to the top rounded corners */
    .wam-channel-strip {
      border-radius: 5px 5px 0 0;
      overflow: hidden;
    }
    .wam-title {
      font-size: 0.7em;
      color: var(--slider-accent, #555);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      padding: 10px 14px 0;
      opacity: 0.6;
    }
    .wam-controls {
      display: flex;
      flex-direction: column;
      gap: 0;
      padding: 6px 14px 10px;
    }
    .wam-section {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 6px 0;
    }
    .wam-section + .wam-section {
      border-top: 1px solid #1d1d1d;
    }
    .wam-section .wam-title { padding: 0; }
    .wam-section-controls {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      gap: 8px 14px;
    }
    .wam-wave-row {
      display: flex;
      gap: 6px;
      width: 100%;
    }
    /* ---- Shared control foundation ---- */
    /* All interactive controls share the same height, font, and box model.
       <input> elements need the element+class selector (input.wam-num-input) to reach
       specificity (0,1,1) — matching PicoCSS's input:not(...) rules — and win by
       source order since this style tag is injected after PicoCSS loads. */
    .wam-select,
    input.wam-num-input,
    .wam-wave-btn,
    .wam-toggle-btn,
    .wam-mute-btn,
    .wam-action-btn,
    .wam-jam-btn,
    .wam-play-btn {
      font-family: monospace;
      font-size: 0.8em;
      height: 22px;
      min-height: 22px;
      line-height: 1;
      box-sizing: border-box;
      border-radius: 3px;
      cursor: pointer;
    }
    /* ---- Passive inputs (select, number, wave) ---- */
    .wam-select,
    input.wam-num-input,
    .wam-wave-btn {
      background: #1a1a1a;
      color: #888;
      border: 1px solid #333;
    }
    .wam-select { padding: 0 5px; max-width: 160px; }
    input.wam-num-input {
      padding: 0 5px;
      width: 52px;
      -moz-appearance: textfield;
    }
    input.wam-num-input::-webkit-inner-spin-button,
    input.wam-num-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
    .wam-wave-btn { padding: 0 10px; }
    .wam-wave-btn.wam-wave-active {
      color: var(--slider-accent, #0f0);
      border-color: var(--slider-accent, #0f0);
    }
    /* ---- Neutral toggle buttons (Ctrl / Seq / FX / Mute) ---- */
    .wam-toggle-btn,
    .wam-mute-btn {
      padding: 0 10px;
      background: transparent;
      color: #555;
      border: 1px solid #333;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .wam-toggle-btn[data-active] {
      background: color-mix(in srgb, var(--slider-accent, #0f0) 15%, transparent);
      color: var(--slider-accent, #0f0);
      border-color: var(--slider-accent, #0f0);
    }
    .wam-toggle-btn:hover { color: #888; border-color: #555; }
    .wam-toggle-btn[data-active]:hover {
      background: color-mix(in srgb, var(--slider-accent, #0f0) 25%, transparent);
    }
    .wam-mute-btn.wam-muted { background: #a00; color: #fff; border-color: #a00; }
    /* ---- Accent buttons (action, jam, play) ---- */
    .wam-action-btn,
    .wam-jam-btn,
    .wam-play-btn {
      background: color-mix(in srgb, var(--slider-accent, #0f0) 10%, #111);
      color: var(--slider-accent, #0f0);
      border: 1px solid var(--slider-accent, #0f0);
      white-space: nowrap;
    }
    .wam-action-btn { padding: 0 12px; }
    .wam-jam-btn    { padding: 0 10px; text-transform: uppercase; letter-spacing: 0.05em; }
    .wam-play-btn   { padding: 0 14px; letter-spacing: 0.04em; }
    .wam-action-btn:hover,
    .wam-jam-btn:hover,
    .wam-play-btn:hover { background: var(--slider-accent, #0f0); color: #000; }
    .wam-play-btn.wam-playing {
      background: color-mix(in srgb, var(--slider-accent, #0f0) 20%, #111);
    }
    /* ---- Labeled control wrapper ---- */
    .wam-ctrl {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 110px;
    }
    .wam-ctrl-wide { min-width: 220px; }
    .wam-ctrl label {
      font-size: 0.7em;
      color: #555;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    /* ---- Action row ---- */
    .wam-action-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 14px;
      border-top: 1px solid #1e1e1e;
    }
    /* ---- Section visibility ---- */
    [data-hidden] { display: none !important; }
    .wam-section-seq { border-top: 1px solid #1d1d1d; }
    .wam-section-fx  { border-top: 1px solid #1d1d1d; }
    .wam-section-ctrl[data-hidden] + .wam-section-seq { border-top: none; }
    /* ---- Channel strip ---- */
    .wam-channel-strip {
      display: flex;
      align-items: center;
      gap: 8px 12px;
      flex-wrap: wrap;
      padding: 8px 14px;
      border-bottom: 1px solid #1d1d1d;
    }
    .wam-strip-header {
      display: flex;
      align-items: center;
      gap: 5px;
      cursor: pointer;
      user-select: none;
      flex-shrink: 0;
      min-width: 72px;
    }
    .wam-strip-name {
      font-size: 0.7em;
      color: var(--slider-accent, #0f0);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      opacity: 0.75;
    }
    .wam-strip-chevron {
      font-size: 1.3rem;
      color: #555;
      transition: transform 0.15s ease;
      line-height: 1;
    }
    [data-collapsed] > .wam-channel-strip .wam-strip-chevron { transform: rotate(-90deg); }
    .wam-channel-strip wam-waveform {
      flex: 1 1 60px;
      max-width: 100px;
      height: 36px;
      min-width: 50px;
      background: #080808;
      border-radius: 2px;
      border: none;
    }
    .wam-channel-strip wam-slider {
      flex: 1 1 80px;
      max-width: 160px;
    }
    .wam-channel-strip wam-slider[param="pan"] {
      max-width: 110px;
    }
    /* ---- Expanded / collapsed ---- */
    [data-collapsed] > .wam-expanded { display: none; }
    [data-no-sequencer] wam-step-seq,
    [data-no-sequencer] .wam-action-row { display: none; }
    /* ---- PicoCSS tooltip overrides for slider label ---- */
    .wam-label-text[data-tooltip],
    .wam-ctrl label[data-tooltip] {
      cursor: help;
      border-bottom: 0;
    }
    .wam-label-text[data-tooltip]::before,
    .wam-ctrl label[data-tooltip]::before {
      white-space: normal;
      overflow: visible;
      width: 130px;
      text-align: left;
      line-height: 1;
      font-family: monospace;
      font-size: 0.5rem;
    }
  `;
  document.head.appendChild(s);
}

/**
 * Create a labeled control wrapper for use inside `.wam-section-controls`.
 * Append the returned element to a section controls row; add your input as a child.
 *
 * @param {string}  labelText
 * @param {object}  [opts]
 * @param {boolean} [opts.wide=false]  Use min-width: 220px instead of 110px
 * @returns {HTMLElement}
 */
export function createCtrl(labelText, { wide = false, tooltip = null } = {}) {
  const el = document.createElement("div");
  el.className = wide ? "wam-ctrl wam-ctrl-wide" : "wam-ctrl";
  const lbl = document.createElement("label");
  lbl.textContent = labelText;
  if (tooltip) lbl.setAttribute("data-tooltip", tooltip);
  el.appendChild(lbl);
  return el;
}

/**
 * Create a labeled section group for use inside `.wam-controls`.
 * Append the returned `el` to the controls container; add children to `controls`.
 *
 * @param {string} label  Section heading text
 * @returns {{ el: HTMLElement, controls: HTMLElement }}
 */
export function createSection(label) {
  const el = document.createElement("div");
  el.className = "wam-section";
  const lbl = document.createElement("div");
  lbl.className = "wam-title";
  lbl.textContent = label;
  el.appendChild(lbl);
  const controls = document.createElement("div");
  controls.className = "wam-section-controls";
  el.appendChild(controls);
  return { el, controls };
}

/**
 * Create a channel strip row for an instrument controls panel.
 * Includes instrument name (collapse toggle), level meter, vol slider, pan slider, mute button.
 * Applies CHANNEL_STRIP_COLLAPSED_DEFAULT to parentEl immediately.
 *
 * @param {HTMLElement} parentEl
 * @param {object} opts
 * @param {string}   opts.title
 * @param {function} opts.getOutGain   Getter returning the controls output GainNode
 * @param {number}   [opts.initialVol=1]
 * @param {number}   [opts.initialPan=0]
 * @param {boolean}  [opts.pan=true]   Set false to omit the pan slider (e.g. master bus)
 * @returns {{ volSlider, panSlider, meter, isMuted, setMuted }}
 */
export function createChannelStrip(parentEl, { title, getOutGain, initialVol = 1, initialPan = 0, pan = true, noCollapse = false }) {
  if (!noCollapse && CHANNEL_STRIP_COLLAPSED_DEFAULT) parentEl.setAttribute("data-collapsed", "");

  const strip = document.createElement("div");
  strip.className = "wam-channel-strip";

  // Name + optional expand/collapse toggle
  const header = document.createElement("div");
  header.className = "wam-strip-header";
  const nameEl = document.createElement("span");
  nameEl.className = "wam-strip-name";
  nameEl.textContent = title;
  header.appendChild(nameEl);
  if (!noCollapse) {
    const chevron = document.createElement("span");
    chevron.className = "wam-strip-chevron";
    chevron.textContent = "▾";
    header.appendChild(chevron);
    header.addEventListener("click", () => parentEl.toggleAttribute("data-collapsed"));
  }
  strip.appendChild(header);

  // Level meter
  const meter = document.createElement("wam-level-meter");
  strip.appendChild(meter);

  // Volume slider
  const volSlider = document.createElement("wam-slider");
  volSlider.setAttribute("param", "volume");
  volSlider.setAttribute("label", "Vol");
  volSlider.setAttribute("min", "0");
  volSlider.setAttribute("max", "1");
  volSlider.setAttribute("step", "0.01");
  volSlider.value = initialVol;
  strip.appendChild(volSlider);

  // Pan slider (double-click resets to center)
  let panSlider = null;
  if (pan) {
    panSlider = document.createElement("wam-slider");
    panSlider.setAttribute("param", "pan");
    panSlider.setAttribute("label", "Pan");
    panSlider.setAttribute("min", "-1");
    panSlider.setAttribute("max", "1");
    panSlider.setAttribute("step", "0.01");
    panSlider.setAttribute("default", "0");
    panSlider.value = initialPan;
    strip.appendChild(panSlider);
  }

  // Mute button
  const muteBtn = document.createElement("button");
  muteBtn.className = "wam-mute-btn";
  muteBtn.textContent = "Mute";
  strip.appendChild(muteBtn);

  parentEl.appendChild(strip);

  let muted = false;
  let preMuteVolume = 1;

  muteBtn.addEventListener("click", () => {
    muted = !muted;
    const out = getOutGain();
    if (muted) {
      preMuteVolume = out?.gain.value ?? 1;
      if (out) out.gain.value = 0;
    } else {
      if (out) out.gain.value = preMuteVolume;
    }
    muteBtn.classList.toggle("wam-muted", muted);
    muteBtn.textContent = muted ? "Muted" : "Mute";
    parentEl.dispatchEvent(new CustomEvent("controls-change", { bubbles: true }));
  });

  return {
    strip,
    volSlider,
    panSlider,
    meter,
    isMuted: () => muted,
    setPreMuteVolume: (v) => {
      preMuteVolume = v;
    },
    setMuted: (v) => {
      muted = !!v;
      const out = getOutGain();
      if (muted) {
        preMuteVolume = out?.gain.value ?? 1;
        if (out) out.gain.value = 0;
      }
      muteBtn.classList.toggle("wam-muted", muted);
      muteBtn.textContent = muted ? "Muted" : "Mute";
    },
  };
}
