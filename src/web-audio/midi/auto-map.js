/**
 * AutoMap — "device follows focus": when an instrument is focused, auto-bind
 * the Launch Control XL's knobs/faders to that instrument's parameters so it's
 * immediately tweakable. Ephemeral and non-persistent — it never overwrites
 * manual MIDI-learn bindings (those win) and clears when focus moves.
 *
 * Knobs/faders only — the 16 channel buttons belong to the sequencer mapping.
 */
import { CONTROLS, bindingFor } from "./launch-control-xl.js";
import { findControl } from "./launch-control-xl.js";
import { ledFeedback } from "./led-feedback.js";

// Knobs (rows 1–3) then faders, in physical left-to-right / top-to-bottom order.
const MAP_CONTROL_IDS = CONTROLS.filter((c) => c.kind === "knob" || c.kind === "fader").map((c) => c.id);

export class AutoMap {
  constructor(target = document) {
    this._target = target;
    this._enabled = true;
    this._current = null; // controls instance currently auto-mapped
    this._started = false;
    this._onFocus = (e) => this.focus(e.detail?.controls ?? null);
  }

  start() {
    if (this._started) return;
    this._started = true;
    this._target.addEventListener("wam-instrument-focus-change", this._onFocus);
  }

  stop() {
    this._target.removeEventListener("wam-instrument-focus-change", this._onFocus);
    this._clearCurrent();
    this._started = false;
  }

  setEnabled(on) {
    this._enabled = !!on;
    if (!this._enabled) this._clearCurrent();
  }

  get enabled() {
    return this._enabled;
  }

  focus(controls) {
    this._clearCurrent();
    if (!this._enabled || typeof controls?.setAutoBindings !== "function") return;
    controls.setAutoBindings(this.computeMap(controls));
    this._current = controls;
  }

  _clearCurrent() {
    this._current?.clearAutoBindings?.();
    this._current = null;
  }

  /**
   * Map the instrument's learnable params (in registry order) to the available
   * knobs/faders, skipping params already manually bound and controls already
   * used by a manual binding. Uses the live template so channels match.
   * @returns {Object<string, object>} param → LCXL binding
   */
  computeMap(controls) {
    const registry = controls._learnRegistry ?? {};
    const manual = controls._paramBindings ?? {};
    const template = ledFeedback.output?.template;

    const usedControlIds = new Set();
    for (const binding of Object.values(manual)) {
      const control = findControl(binding);
      if (control) usedControlIds.add(control.id);
    }
    const available = MAP_CONTROL_IDS.filter((id) => !usedControlIds.has(id));
    const params = Object.keys(registry).filter((param) => !manual[param]);

    const map = {};
    const count = Math.min(params.length, available.length);
    for (let i = 0; i < count; i++) {
      map[params[i]] = bindingFor(available[i], template);
    }
    return map;
  }
}

/** Shared singleton. Call start() (e.g. from the playground) to activate. */
export const autoMap = new AutoMap();
