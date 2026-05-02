import "./web-audio-level-meter.js";

// Set to false to start all channel strips expanded by default.
export const CHANNEL_STRIP_COLLAPSED_DEFAULT = true;

/**
 * WebAudioSlider — shared range-input web component for audio parameter controls.
 *
 * Light DOM, CSS injected once. Dispatches `slider-input` events on user
 * interaction; programmatic `.value` updates the display silently (no event).
 *
 * Usage:
 *   <web-audio-slider label="Cutoff" param="cutoff"
 *     min="50" max="10000" step="1" value="600"></web-audio-slider>
 *
 * Logarithmic scale (ideal for frequency controls):
 *   <web-audio-slider label="LPF" param="lpFreq"
 *     min="80" max="20000" step="1" scale="log" value="20000"></web-audio-slider>
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
      const lbl = this.querySelector(".was-label-text");
      if (lbl) lbl.textContent = val + " ";
    } else if (name === "min" || name === "max" || name === "step") {
      if (!this._isLog && this._range) this._range[name] = val;
    } else if (name === "color") {
      this.style.setProperty("--slider-accent", val);
    } else if (name === "hint") {
      let hintEl = this.querySelector(".was-hint");
      if (val) {
        if (!hintEl) {
          hintEl = document.createElement("span");
          hintEl.className = "was-hint";
          const top = this.querySelector(".was-top");
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
    top.className = "was-top";

    const lbl = document.createElement("label");
    lbl.className = "was-label";
    const labelText = document.createElement("span");
    labelText.className = "was-label-text";
    labelText.textContent = label + " ";
    const tooltip = this.getAttribute("data-tooltip");
    if (tooltip) {
      labelText.setAttribute("data-tooltip", tooltip);
      this.removeAttribute("data-tooltip");
    }
    this._valEl = document.createElement("span");
    this._valEl.className = "was-val";
    lbl.appendChild(labelText);
    lbl.appendChild(this._valEl);
    top.appendChild(lbl);

    if (hint) {
      const hintEl = document.createElement("span");
      hintEl.className = "was-hint";
      hintEl.textContent = hint;
      top.appendChild(hintEl);
    }

    this.appendChild(top);

    // Range input — log sliders use 0–1 normalized, linear sliders use real min/max
    this._range = document.createElement("input");
    this._range.type = "range";
    this._range.className = "was-range";
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
      web-audio-slider {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 80px;
        font-family: monospace;
      }
      .was-top {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 6px;
      }
      .was-label {
        font-size: 0.7em;
        color: #555;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .was-val {
        color: var(--slider-accent, #0f0);
        font-family: monospace;
      }
      .was-hint {
        font-size: 0.6em;
        color: #444;
        white-space: nowrap;
      }
      .was-range {
        width: 100%;
        height: 22px;
        box-sizing: border-box;
        accent-color: var(--slider-accent, #0f0);
      }
    `;
    document.head.appendChild(s);
  }
}

customElements.define("web-audio-slider", WebAudioSlider);

// ---- Shared CSS for instrument controls components ----

let _controlsCSSInjected = false;

/**
 * Inject shared CSS for `<web-audio-*-controls>` components.
 * Call from any controls component's bind() — only injects once.
 */
export function injectControlsCSS() {
  if (_controlsCSSInjected) return;
  _controlsCSSInjected = true;
  const s = document.createElement("style");
  s.textContent = /* css */ `
    .wac-panel {
      display: block;
      background: #141414;
      border: 1px solid #222;
      border-radius: 6px;
      font-family: monospace;
    }
    .wac-play-btn {
      font-family: monospace;
      font-size: 0.85em;
      height: 22px;
      padding: 0 14px;
      box-sizing: border-box;
      background: color-mix(in srgb, var(--slider-accent, #0f0) 10%, #111);
      color: var(--slider-accent, #0f0);
      border: 1px solid var(--slider-accent, #0f0);
      border-radius: 4px;
      cursor: pointer;
      white-space: nowrap;
      letter-spacing: 0.04em;
    }
    .wac-play-btn:hover {
      background: var(--slider-accent, #0f0);
      color: #000;
    }
    .wac-play-btn.wac-playing {
      background: color-mix(in srgb, var(--slider-accent, #0f0) 20%, #111);
      border-style: solid;
    }
    .wac-transport-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      flex-wrap: wrap;
      background: #0a0a14;
    }
    .wac-transport-row web-audio-slider {
      flex: 1;
      min-width: 80px;
      max-width: 160px;
    }
    .wac-transport-row .wac-select {
      max-width: 90px;
    }
    .wac-transport-share-slot {
      margin-left: auto;
    }
    /* Clip channel strip and waveform to the top rounded corners */
    .wac-channel-strip {
      border-radius: 5px 5px 0 0;
      overflow: hidden;
    }
    .wac-title {
      font-size: 0.7em;
      color: var(--slider-accent, #555);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      padding: 10px 14px 0;
      opacity: 0.6;
    }
    .wac-controls {
      display: flex;
      flex-direction: column;
      gap: 0;
      padding: 6px 14px 10px;
    }
    .wac-section {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 6px 0;
    }
    .wac-section + .wac-section {
      border-top: 1px solid #1d1d1d;
    }
    .wac-section .wac-title { padding: 0; }
    .wac-section-controls {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      gap: 8px 14px;
    }
    .wac-wave-row {
      display: flex;
      gap: 6px;
      width: 100%;
    }
    .wac-wave-btn {
      font-family: monospace;
      font-size: 0.78em;
      height: 22px;
      padding: 0 10px;
      box-sizing: border-box;
      background: #1a1a1a;
      color: #666;
      border: 1px solid #333;
      border-radius: 4px;
      cursor: pointer;
    }
    .wac-wave-btn.wac-wave-active {
      color: var(--slider-accent, #0f0);
      border-color: var(--slider-accent, #0f0);
    }
    .wac-select {
      font-family: monospace;
      font-size: 0.82em;
      height: 22px;
      padding: 0 5px;
      box-sizing: border-box;
      background: #1a1a1a;
      color: #aaa;
      border: 1px solid #333;
      border-radius: 3px;
      cursor: pointer;
      max-width: 160px;
    }
    .wac-action-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 14px;
      border-top: 1px solid #1e1e1e;
    }
    .wac-action-btn {
      font-family: monospace;
      font-size: 0.85em;
      height: 22px;
      padding: 0 12px;
      box-sizing: border-box;
      background: color-mix(in srgb, var(--slider-accent, #0f0) 10%, #111);
      color: var(--slider-accent, #0f0);
      border: 1px solid var(--slider-accent, #0f0);
      border-radius: 4px;
      cursor: pointer;
      white-space: nowrap;
    }
    .wac-action-btn:hover {
      background: var(--slider-accent, #0f0);
      color: #000;
    }
    .wac-ctrl {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 110px;
    }
    .wac-ctrl-wide { min-width: 220px; }
    .wac-ctrl label {
      font-size: 0.7em;
      color: #555;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .wac-mute-btn {
      font-family: monospace;
      font-size: 0.7em;
      height: 22px;
      padding: 0 10px;
      box-sizing: border-box;
      background: transparent;
      color: #555;
      border: 1px solid #333;
      border-radius: 3px;
      cursor: pointer;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .wac-mute-btn.wac-muted {
      background: #a00;
      color: #fff;
      border-color: #a00;
    }
    /* ---- Channel strip ---- */
    .wac-channel-strip {
      display: flex;
      align-items: center;
      gap: 8px 12px;
      flex-wrap: wrap;
      padding: 8px 14px;
      border-bottom: 1px solid #1d1d1d;
    }
    .wac-strip-header {
      display: flex;
      align-items: center;
      gap: 5px;
      cursor: pointer;
      user-select: none;
      flex-shrink: 0;
      min-width: 72px;
    }
    .wac-strip-name {
      font-size: 0.7em;
      color: var(--slider-accent, #0f0);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      opacity: 0.75;
    }
    .wac-strip-chevron {
      font-size: 1.3rem;
      color: #555;
      transition: transform 0.15s ease;
      line-height: 1;
    }
    [data-collapsed] > .wac-channel-strip .wac-strip-chevron { transform: rotate(-90deg); }
    .wac-channel-strip web-audio-slider {
      flex: 1 1 80px;
      max-width: 160px;
    }
    .wac-channel-strip web-audio-slider[param="pan"] {
      max-width: 110px;
    }
    /* ---- Expanded / collapsed ---- */
    [data-collapsed] > .wac-expanded { display: none; }
    [data-no-sequencer] web-audio-step-seq,
    [data-no-sequencer] .wac-action-row { display: none; }
    /* ---- PicoCSS tooltip overrides for slider label ---- */
    .was-label-text[data-tooltip],
    .wac-ctrl label[data-tooltip] {
      cursor: help;
      border-bottom: 0;
    }
    .was-label-text[data-tooltip]::before,
    .wac-ctrl label[data-tooltip]::before {
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
 * Create a labeled control wrapper for use inside `.wac-section-controls`.
 * Append the returned element to a section controls row; add your input as a child.
 *
 * @param {string}  labelText
 * @param {object}  [opts]
 * @param {boolean} [opts.wide=false]  Use min-width: 220px instead of 110px
 * @returns {HTMLElement}
 */
export function createCtrl(labelText, { wide = false, tooltip = null } = {}) {
  const el = document.createElement("div");
  el.className = wide ? "wac-ctrl wac-ctrl-wide" : "wac-ctrl";
  const lbl = document.createElement("label");
  lbl.textContent = labelText;
  if (tooltip) lbl.setAttribute("data-tooltip", tooltip);
  el.appendChild(lbl);
  return el;
}

/**
 * Create a labeled section group for use inside `.wac-controls`.
 * Append the returned `el` to the controls container; add children to `controls`.
 *
 * @param {string} label  Section heading text
 * @returns {{ el: HTMLElement, controls: HTMLElement }}
 */
export function createSection(label) {
  const el = document.createElement("div");
  el.className = "wac-section";
  const lbl = document.createElement("div");
  lbl.className = "wac-title";
  lbl.textContent = label;
  el.appendChild(lbl);
  const controls = document.createElement("div");
  controls.className = "wac-section-controls";
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
export function createChannelStrip(parentEl, { title, getOutGain, initialVol = 1, initialPan = 0, pan = true }) {
  if (CHANNEL_STRIP_COLLAPSED_DEFAULT) parentEl.setAttribute("data-collapsed", "");

  const strip = document.createElement("div");
  strip.className = "wac-channel-strip";

  // Name + expand/collapse toggle
  const header = document.createElement("div");
  header.className = "wac-strip-header";
  const nameEl = document.createElement("span");
  nameEl.className = "wac-strip-name";
  nameEl.textContent = title;
  const chevron = document.createElement("span");
  chevron.className = "wac-strip-chevron";
  chevron.textContent = "▾";
  header.appendChild(nameEl);
  header.appendChild(chevron);
  header.addEventListener("click", () => parentEl.toggleAttribute("data-collapsed"));
  strip.appendChild(header);

  // Level meter
  const meter = document.createElement("web-audio-level-meter");
  strip.appendChild(meter);

  // Volume slider
  const volSlider = document.createElement("web-audio-slider");
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
    panSlider = document.createElement("web-audio-slider");
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
  muteBtn.className = "wac-mute-btn";
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
    muteBtn.classList.toggle("wac-muted", muted);
    muteBtn.textContent = muted ? "Muted" : "Mute";
    parentEl.dispatchEvent(new CustomEvent("controls-change", { bubbles: true }));
  });

  return {
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
      muteBtn.classList.toggle("wac-muted", muted);
      muteBtn.textContent = muted ? "Muted" : "Mute";
    },
  };
}
