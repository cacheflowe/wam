/**
 * <wam-param-display> — floating parameter readout overlay.
 *
 * Auto-mounts as a singleton. Listens for `knob-input` and `slider-input`
 * events at the document level and shows the control label + formatted value
 * in a high-z-index overlay. Hides after ~800ms of inactivity.
 *
 * Only displays when the user has an active pointer on a control (knob or
 * slider). Automated/LFO-driven value changes are ignored so the overlay
 * doesn't flicker during programmatic updates.
 *
 * Great for touchscreen use where the user's thumb obscures the small
 * knob display, and useful on desktop too for quick visual feedback.
 *
 * No manual setup needed — importing this module is enough.
 */

const HIDE_DELAY = 800; // ms after last input before hiding

class WebAudioParamDisplay extends HTMLElement {
  static #instance = null;

  constructor() {
    super();
    this._labelEl = null;
    this._valueEl = null;
    this._hideTimer = null;
    this._built = false;
    this._pointerActive = false;
  }

  connectedCallback() {
    if (!this._built) this._build();
  }

  _build() {
    this._built = true;

    const s = document.createElement("style");
    s.textContent = `
      wam-param-display {
        position: fixed;
        top: 12px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 9999;
        display: flex;
        align-items: baseline;
        gap: 8px;
        padding: 6px 14px;
        background: rgba(0, 0, 0, 0.85);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 6px;
        font-family: monospace;
        font-size: 0.8rem;
        color: #ccc;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.15s ease-out;
        white-space: nowrap;
        backdrop-filter: blur(4px);
      }
      wam-param-display[data-visible] {
        opacity: 1;
      }
      wam-param-display .wam-pd-label {
        text-transform: uppercase;
        letter-spacing: 0.05em;
        font-size: 0.7rem;
        color: #888;
      }
      wam-param-display .wam-pd-value {
        font-size: 1rem;
        color: #fff;
        font-weight: bold;
      }
    `;
    this.appendChild(s);

    this._labelEl = document.createElement("span");
    this._labelEl.className = "wam-pd-label";
    this.appendChild(this._labelEl);

    this._valueEl = document.createElement("span");
    this._valueEl.className = "wam-pd-value";
    this.appendChild(this._valueEl);
  }

  show(label, value) {
    if (!this._built) return;
    this._labelEl.textContent = label;
    this._valueEl.textContent = this._formatValue(value);
    this.setAttribute("data-visible", "");

    clearTimeout(this._hideTimer);
    this._hideTimer = setTimeout(() => {
      this.removeAttribute("data-visible");
    }, HIDE_DELAY);
  }

  _formatValue(v) {
    if (typeof v !== "number" || isNaN(v)) return String(v);
    if (Number.isInteger(v)) return String(v);
    // Show up to 3 decimal places, trimming trailing zeros
    return parseFloat(v.toFixed(3)).toString();
  }

  /** Create and mount the singleton instance. */
  static ensure() {
    if (WebAudioParamDisplay.#instance) return WebAudioParamDisplay.#instance;

    const el = document.createElement("wam-param-display");
    document.body.appendChild(el);
    WebAudioParamDisplay.#instance = el;

    // Track whether the user has an active pointer on a control.
    // This prevents automated value changes (LFOs, etc.) from showing the overlay.
    const isOnControl = (e) => !!e.target.closest?.("wam-knob, wam-slider");

    document.addEventListener(
      "pointerdown",
      (e) => {
        if (isOnControl(e)) el._pointerActive = true;
      },
      true,
    );
    document.addEventListener(
      "pointerup",
      () => {
        el._pointerActive = false;
      },
      true,
    );
    document.addEventListener(
      "pointercancel",
      () => {
        el._pointerActive = false;
      },
      true,
    );

    // Wheel and dblclick on controls are also user gestures.
    // Set the flag briefly — the knob-input fires synchronously in the same
    // handler, then we clear the flag on the next microtask so LFO-driven
    // events on the following animation frame are still filtered out.
    const briefActivate = (e) => {
      if (!isOnControl(e)) return;
      el._pointerActive = true;
      queueMicrotask(() => {
        el._pointerActive = false;
      });
    };
    document.addEventListener("wheel", briefActivate, true);
    document.addEventListener("dblclick", briefActivate, true);

    // Listen at document level (capture phase) for all knob/slider events.
    // Only show when a user pointer is actively interacting with a control.
    const handler = (e) => {
      if (!el._pointerActive) return;
      const { label, value } = e.detail;
      if (label != null) el.show(label, value);
    };
    document.addEventListener("knob-input", handler, true);
    document.addEventListener("slider-input", handler, true);

    return el;
  }
}

customElements.define("wam-param-display", WebAudioParamDisplay);

// Auto-mount on import (deferred until DOM is ready)
if (document.body) {
  WebAudioParamDisplay.ensure();
} else {
  document.addEventListener("DOMContentLoaded", () => WebAudioParamDisplay.ensure());
}

export default WebAudioParamDisplay;
