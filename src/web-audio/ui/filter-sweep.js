/**
 * <wam-filter-sweep> — bipolar DJ-style filter sweep control.
 *
 * Center = bypass. Left half = LP sweep (20kHz→80Hz log).
 * Right half = HP sweep (20Hz→8kHz log).
 *
 * Value display shows "LP 2.4k" / "open" / "HP 380" with mode-colored text.
 * Visually matches <wam-slider> exactly; only the value display differs.
 *
 * Dispatches: slider-input { param, value: -1..1 }
 *
 * Usage:
 *   <wam-filter-sweep param="filterSweep" label="Filter"></filter-sweep>
 */

import WebAudioSlider from "./slider.js";
import { sweepToLpFreq, sweepToHpFreq } from "../fx/fx-filter.js";

function fmtFreq(hz) {
  if (hz >= 9950) return "20k";
  if (hz >= 1000) return `${(hz / 1000).toFixed(1)}k`;
  return `${Math.round(hz)}`;
}

export default class WebAudioFilterSweep extends HTMLElement {
  static #cssInjected = false;

  constructor() {
    super();
    this._range = null;
    this._valEl = null;
    this._built = false;
  }

  connectedCallback() {
    WebAudioSlider._injectCSS();
    WebAudioFilterSweep.#injectCSS();
    if (!this._built) this._build();
  }

  get value() {
    return this._range ? parseFloat(this._range.value) : 0;
  }

  set value(v) {
    const num = Math.max(-1, Math.min(1, parseFloat(v) || 0));
    if (this._range) this._range.value = num;
    this._updateDisplay(num);
  }

  _build() {
    this._built = true;
    const color = this.getAttribute("color");
    if (color) this.style.setProperty("--slider-accent", color);

    // Top row — identical structure to WebAudioSlider
    const top = document.createElement("div");
    top.className = "wam-top";

    const lbl = document.createElement("label");
    lbl.className = "wam-label";

    const labelText = document.createElement("span");
    labelText.className = "wam-label-text";
    labelText.textContent = (this.getAttribute("label") || "Filter") + " ";
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
    this.appendChild(top);

    // Range input — identical to WebAudioSlider's range
    this._range = document.createElement("input");
    this._range.type = "range";
    this._range.className = "wam-range";
    this._range.min = -1;
    this._range.max = 1;
    this._range.step = 0.001;
    this._range.value = parseFloat(this.getAttribute("value") || "0");
    this.appendChild(this._range);

    this._updateDisplay(parseFloat(this._range.value));

    this._range.addEventListener("input", () => {
      const v = parseFloat(this._range.value);
      this._updateDisplay(v);
      this.dispatchEvent(
        new CustomEvent("slider-input", {
          bubbles: true,
          detail: { param: this.getAttribute("param") || "filterSweep", value: v },
        }),
      );
    });

    this._range.addEventListener("dblclick", () => {
      this._range.value = 0;
      this._updateDisplay(0);
      this.dispatchEvent(
        new CustomEvent("slider-input", {
          bubbles: true,
          detail: { param: this.getAttribute("param") || "filterSweep", value: 0 },
        }),
      );
    });
  }

  _updateDisplay(v) {
    if (!this._valEl) return;
    if (Math.abs(v) < 0.005) {
      this._valEl.textContent = "open";
      this._valEl.dataset.mode = "open";
    } else if (v < 0) {
      this._valEl.textContent = `LP ${fmtFreq(sweepToLpFreq(v))}`;
      this._valEl.dataset.mode = "lp";
    } else {
      this._valEl.textContent = `HP ${fmtFreq(sweepToHpFreq(v))}`;
      this._valEl.dataset.mode = "hp";
    }
  }

  static #injectCSS() {
    if (WebAudioFilterSweep.#cssInjected) return;
    WebAudioFilterSweep.#cssInjected = true;
    const s = document.createElement("style");
    s.textContent = `
      wam-filter-sweep {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 80px;
        font-family: monospace;
      }
      wam-filter-sweep .wam-val[data-mode="open"] { color: #555; }
      wam-filter-sweep .wam-val[data-mode="lp"]   { color: #48f; transition: color 0.1s; }
      wam-filter-sweep .wam-val[data-mode="hp"]   { color: #fa6; transition: color 0.1s; }
    `;
    document.head.appendChild(s);
  }
}

customElements.define("wam-filter-sweep", WebAudioFilterSweep);
