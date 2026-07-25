// Register the sibling control elements as a side effect so a bare
// `import "./slider.js"` still pulls in the full basic-control family.
import "./level-meter.js";
import "./knob.js";
import "./param-display.js";

/**
 * WebAudioSlider — shared range-input web component for audio parameter controls.
 *
 * Light DOM, CSS injected once. Dispatches `slider-input` events on user
 * interaction; programmatic `.value` updates the display silently (no event).
 *
 * Usage:
 *   <wam-slider label="Cutoff" param="cutoff"
 *     min="50" max="10000" step="1" value="600"></slider>
 *
 * Logarithmic scale (ideal for frequency controls):
 *   <wam-slider label="LPF" param="lpFreq"
 *     min="80" max="20000" step="1" scale="log" value="20000"></slider>
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
    this._range.addEventListener("pointerup", () => {
      this._range.blur();
    });

    // User interaction only — dispatches slider-input event
    this._range.addEventListener("input", () => {
      const raw = parseFloat(this._range.value);
      const v = this._isLog ? this._fromSlider(raw) : raw;
      this._setDisplayValue(v);
      this.setAttribute("value", v);
      this.dispatchEvent(
        new CustomEvent("slider-input", {
          bubbles: true,
          detail: { param, label, value: v },
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
            detail: { param, label, value: def },
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
    s.textContent = /* css */ `
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
