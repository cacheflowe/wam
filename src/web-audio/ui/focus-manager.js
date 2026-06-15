/**
 * Tracks which instrument panel is "focused" for hardware control.
 *
 * Instrument panels dispatch `wam-instrument-focus` (on pointerdown). This
 * manager keeps a single focused panel, marks it with a `.wam-focused` outline,
 * and re-broadcasts `wam-instrument-focus-change` so features like the
 * sequencer-button mapping know which instrument the hardware should drive.
 *
 * Generic UI concern — no MIDI knowledge here.
 */
let _cssInjected = false;

function injectFocusCSS() {
  if (_cssInjected || typeof document === "undefined") return;
  _cssInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    .wam-panel.wam-focused {
      outline: 2px solid var(--slider-accent, #6f6);
      outline-offset: 3px;
      border-radius: 8px;
    }
  `;
  document.head.appendChild(style);
}

export class FocusManager {
  constructor(target = document) {
    this._target = target;
    this._focused = null;
    this._started = false;
    this._onFocus = (e) => this.focus(e.detail?.controls ?? null);
  }

  start() {
    if (this._started) return;
    this._started = true;
    injectFocusCSS();
    this._target.addEventListener("wam-instrument-focus", this._onFocus);
  }

  stop() {
    this._target.removeEventListener("wam-instrument-focus", this._onFocus);
    this._started = false;
  }

  get focused() {
    return this._focused;
  }

  focus(controls) {
    if (controls === this._focused) return;
    this._focused?.classList.remove("wam-focused");
    this._focused = controls || null;
    this._focused?.classList.add("wam-focused");
    this._target.dispatchEvent(
      new CustomEvent("wam-instrument-focus-change", { detail: { controls: this._focused } }),
    );
  }
}

/** Shared singleton; call start() once (e.g. from the playground). */
export const focusManager = new FocusManager();
