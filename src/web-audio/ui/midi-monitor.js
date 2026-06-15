/**
 * <wam-midi-monitor> — a small live debug view for the playground's MIDI drawer.
 *
 * Shows the currently focused instrument and a rolling log of normalized
 * `wam-control-input` events (source-tagged binding label + kind + value).
 * Complements the standalone Launch Control XL tester; this is the slim,
 * in-app monitor.
 */
import { formatBinding } from "../input/input-bindings.js";

const MAX_LINES = 14;

let _cssInjected = false;
function injectCSS() {
  if (_cssInjected || typeof document === "undefined") return;
  _cssInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    wam-midi-monitor { display: block; font: 12px/1.4 ui-monospace, Menlo, Consolas, monospace; color: #c8c8e0; }
    wam-midi-monitor .wmm-focus { color: #9b8dff; margin-bottom: 0.5rem; }
    wam-midi-monitor .wmm-focus b { color: #cfcff0; }
    wam-midi-monitor .wmm-log { display: flex; flex-direction: column; gap: 2px; }
    wam-midi-monitor .wmm-line { display: flex; justify-content: space-between; gap: 0.75rem; opacity: 0.9; }
    wam-midi-monitor .wmm-line .wmm-src { color: #6cf; }
    wam-midi-monitor .wmm-line .wmm-val { color: #8f8; }
    wam-midi-monitor .wmm-empty { opacity: 0.5; }
  `;
  document.head.appendChild(style);
}

export default class WamMidiMonitor extends HTMLElement {
  connectedCallback() {
    injectCSS();
    this.innerHTML = `
      <div class="wmm-focus">Focused: <b class="wmm-focus-name">—</b></div>
      <div class="wmm-log"><div class="wmm-empty">Move a control to see input…</div></div>
    `;
    this._focusName = this.querySelector(".wmm-focus-name");
    this._log = this.querySelector(".wmm-log");
    this._lines = [];

    this._onInput = (e) => this._append(e.detail);
    this._onFocus = (e) => this._setFocus(e.detail?.controls);
    document.addEventListener("wam-control-input", this._onInput);
    document.addEventListener("wam-instrument-focus-change", this._onFocus);
  }

  disconnectedCallback() {
    document.removeEventListener("wam-control-input", this._onInput);
    document.removeEventListener("wam-instrument-focus-change", this._onFocus);
  }

  _setFocus(controls) {
    const title = controls?.querySelector?.(".wam-channel-title")?.textContent;
    this._focusName.textContent = title || controls?.tagName?.toLowerCase() || "—";
  }

  _append(detail) {
    if (!detail?.binding) return;
    const label = formatBinding(detail.binding) || detail.binding.source || "?";
    const val = detail.kind === "trigger" ? (detail.pressed === false ? "release" : "press") : detail.value?.toFixed(2);
    this._lines.unshift({ src: `${detail.binding.source}:${label}`, val: `${detail.kind} ${val ?? ""}`.trim() });
    this._lines = this._lines.slice(0, MAX_LINES);
    this._render();
  }

  _render() {
    this._log.innerHTML = this._lines
      .map((l) => `<div class="wmm-line"><span class="wmm-src">${l.src}</span><span class="wmm-val">${l.val}</span></div>`)
      .join("");
  }
}

customElements.define("wam-midi-monitor", WamMidiMonitor);
