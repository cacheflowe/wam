/**
 * <web-audio-filter-sweep> — bipolar DJ-style filter sweep control.
 *
 * Center = bypass. Left half = LP sweep (20kHz→80Hz log).
 * Right half = HP sweep (20Hz→8kHz log).
 *
 * Track is visually split: blue zone left / divider / orange zone right.
 * Value display shows "LP 2.4k" / "open" / "HP 380".
 *
 * Dispatches: slider-input { param, value: -1..1 }
 *
 * Usage:
 *   <web-audio-filter-sweep param="filterSweep" label="Filter"></web-audio-filter-sweep>
 */

import { sweepToLpFreq, sweepToHpFreq } from "./fx/web-audio-fx-filter.js";

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
    if (color) this.style.setProperty("--sweep-accent", color);

    const top = document.createElement("div");
    top.className = "wfs-top";
    const lbl = document.createElement("span");
    lbl.className = "wfs-lbl";
    lbl.textContent = (this.getAttribute("label") || "Filter") + " ";
    this._valEl = document.createElement("span");
    this._valEl.className = "wfs-val";
    top.appendChild(lbl);
    top.appendChild(this._valEl);
    this.appendChild(top);

    // Track wrap: custom-painted background behind the native range
    const wrap = document.createElement("div");
    wrap.className = "wfs-wrap";

    const bg = document.createElement("div");
    bg.className = "wfs-bg";
    wrap.appendChild(bg);

    this._range = document.createElement("input");
    this._range.type = "range";
    this._range.className = "wfs-range";
    this._range.min = -1;
    this._range.max = 1;
    this._range.step = 0.001;
    this._range.value = parseFloat(this.getAttribute("value") || "0");
    wrap.appendChild(this._range);
    this.appendChild(wrap);

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
      web-audio-filter-sweep {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 80px;
        font-family: monospace;
      }
      .wfs-top {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
      }
      .wfs-lbl {
        font-size: 0.7em;
        color: #555;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .wfs-val {
        font-size: 0.7em;
        font-family: monospace;
        color: #555;
        transition: color 0.1s;
      }
      .wfs-val[data-mode="lp"] { color: #48f; }
      .wfs-val[data-mode="hp"] { color: #fa6; }
      .wfs-wrap {
        position: relative;
        display: flex;
        align-items: center;
        height: 20px;
      }
      .wfs-bg {
        position: absolute;
        left: 7px;
        right: 7px;
        height: 4px;
        border-radius: 2px;
        background: linear-gradient(to right,
          #0d2540 0%, #0d2540 49%,
          #1a1a1a 49%, #1a1a1a 51%,
          #2b1400 51%, #2b1400 100%
        );
        pointer-events: none;
      }
      .wfs-range {
        position: relative;
        width: 100%;
        background: transparent;
        -webkit-appearance: none;
        appearance: none;
        height: 20px;
        cursor: pointer;
      }
      .wfs-range::-webkit-slider-runnable-track {
        background: transparent;
        height: 4px;
      }
      .wfs-range::-moz-range-track {
        background: transparent;
        height: 4px;
        border: none;
      }
      .wfs-range::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: var(--sweep-accent, var(--slider-accent, #0f0));
        cursor: pointer;
        margin-top: -5px;
        box-shadow: 0 0 0 1px #000;
      }
      .wfs-range::-moz-range-thumb {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: var(--sweep-accent, var(--slider-accent, #0f0));
        cursor: pointer;
        border: none;
        box-shadow: 0 0 0 1px #000;
      }
      .wfs-range:focus {
        outline: none;
      }
      .wfs-range:focus-visible::-webkit-slider-thumb {
        box-shadow: 0 0 0 2px var(--sweep-accent, var(--slider-accent, #0f0));
      }
    `;
    document.head.appendChild(s);
  }
}

customElements.define("web-audio-filter-sweep", WebAudioFilterSweep);
