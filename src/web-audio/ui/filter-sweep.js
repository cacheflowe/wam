/**
 * <wam-filter-sweep> — bipolar DJ-style filter sweep control.
 *
 * Center = bypass. Left half = LP sweep (20kHz→80Hz log).
 * Right half = HP sweep (20Hz→8kHz log).
 *
 * Wraps a <wam-knob> internally for the rotary knob UI, with a custom
 * value display showing "LP 2.4k" / "open" / "HP 380" with mode-colored text.
 *
 * Dispatches: knob-input { param, value: -1..1 }
 *
 * Usage:
 *   <wam-filter-sweep param="filterSweep" label="Filter"></wam-filter-sweep>
 */

import "./knob.js";
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
    this._knob = null;
    this._valEl = null;
    this._built = false;
  }

  connectedCallback() {
    WebAudioFilterSweep.#injectCSS();
    if (!this._built) this._build();
  }

  get value() {
    return this._knob ? this._knob.value : 0;
  }

  set value(v) {
    const num = Math.max(-1, Math.min(1, parseFloat(v) || 0));
    if (this._knob) this._knob.value = num;
    this.setAttribute("value", num);
    this._updateDisplay(num);
  }

  _build() {
    this._built = true;

    const param = this.getAttribute("param") || "filterSweep";
    const label = this.getAttribute("label") || "Filter";
    const tooltip = this.getAttribute("data-tooltip");
    const initVal = parseFloat(this.getAttribute("value") || "0");

    // Embedded knob — bipolar range -1..1
    this._knob = document.createElement("wam-knob");
    this._knob.setAttribute("param", param);
    this._knob.setAttribute("label", label);
    this._knob.setAttribute("min", "-1");
    this._knob.setAttribute("max", "1");
    this._knob.setAttribute("step", "0.001");
    this._knob.setAttribute("default", "0");
    if (tooltip) {
      this._knob.setAttribute("data-tooltip", tooltip);
      this.removeAttribute("data-tooltip");
    }
    this._knob.value = initVal;
    this.appendChild(this._knob);

    // Custom value display (replaces the knob's built-in numeric display)
    this._valEl = this._knob.querySelector(".wam-knob-value");
    this._updateDisplay(initVal);

    // Listen for knob-input and update display
    this._knob.addEventListener("knob-input", (e) => {
      this._updateDisplay(e.detail.value);
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
        display: contents;
      }
      wam-filter-sweep .wam-knob-value[data-mode="open"] { color: #555; }
      wam-filter-sweep .wam-knob-value[data-mode="lp"]   { color: #48f; transition: color 0.1s; }
      wam-filter-sweep .wam-knob-value[data-mode="hp"]   { color: #fa6; transition: color 0.1s; }
    `;
    document.head.appendChild(s);
  }
}

customElements.define("wam-filter-sweep", WebAudioFilterSweep);
