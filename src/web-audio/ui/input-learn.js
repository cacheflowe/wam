import { bindingsEqual, dispatchBindingFeedback } from "../input/input-bindings.js";
import { ensureMidiInputSource } from "../input/midi-source.js";
import { ensureKeyboardInputSource } from "../input/keyboard-source.js";

/**
 * Mixin for "input learn" on a controls panel — bind any controller (MIDI,
 * keyboard, gamepad, …) to a parameter and apply incoming values.
 *
 * Source-agnostic: it consumes the normalized `wam-control-input` event
 * (see input/input-bindings.js), compares bindings via the polymorphic
 * registry, and maps a 0..1 value onto each control's range. No MIDI specifics
 * live here — adapters translate their devices into that one event shape.
 *
 * Host requirements:
 *   get _learnRegistry()    → { [param]: controlElement }   (sliders/knobs)
 *   this._emitChange()
 *   call this._initInputLearnState() in the constructor
 *   call this._attachInputLearn()   when the panel is built (bind/connect)
 *   call this._teardownInputLearn() on disconnect
 * Optional:
 *   override _onInputExtra(detail)  for panel-specific reactions (e.g. jam)
 *
 * Apply with:  Object.assign(MyClass.prototype, InputLearnMixin)
 */

let _cssInjected = false;

export function injectInputLearnCSS() {
  if (_cssInjected || typeof document === "undefined") return;
  _cssInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    wam-slider.wam-input-bound,
    wam-knob.wam-input-bound {
      outline: 1px solid rgba(102, 255, 102, 0.45);
      outline-offset: 2px;
      border-radius: 5px;
    }
    wam-slider.wam-input-learning,
    wam-knob.wam-input-learning {
      outline: 2px solid #6f6;
      outline-offset: 2px;
      border-radius: 5px;
      animation: wam-input-learn-pulse 0.45s ease-in-out infinite alternate;
    }
    @keyframes wam-input-learn-pulse {
      from { filter: brightness(1); }
      to { filter: brightness(1.45); }
    }
  `;
  document.head.appendChild(style);
}

/**
 * Apply the mixin to a class WITHOUT clobbering methods the class already
 * defines. This lets a host override `_handleControlInput` / `_onInputExtra`
 * (e.g. controls-base's jam handling) in its class body and still delegate to
 * InputLearnMixin's default — plain Object.assign would overwrite the override
 * since the mixin is applied after the class is declared.
 */
export function applyInputLearnMixin(targetClass) {
  const proto = targetClass.prototype;
  for (const key of Object.keys(InputLearnMixin)) {
    if (!Object.prototype.hasOwnProperty.call(proto, key)) proto[key] = InputLearnMixin[key];
  }
}

export const InputLearnMixin = {
  /** Initialize learn state. Call from the host constructor. */
  _initInputLearnState() {
    this._paramBindings = {}; // param → binding (source-tagged), manual + persistent
    this._autoBindings = {}; // param → binding, ephemeral (auto-map on focus); manual wins
    this._learnParam = null;
    this._inputHandler = null;
    this._learnKeyHandler = null;
  },

  /**
   * Replace the ephemeral auto-map bindings (device-follows-focus). These defer
   * to manual bindings and are never serialized. Lights the surface via
   * feedback intents (auto = distinct color).
   */
  setAutoBindings(map) {
    this.clearAutoBindings();
    this._autoBindings = { ...map };
    for (const binding of Object.values(this._autoBindings)) {
      dispatchBindingFeedback({ kind: "bound", binding, auto: true });
    }
  },

  clearAutoBindings() {
    for (const binding of Object.values(this._autoBindings ?? {})) {
      dispatchBindingFeedback({ kind: "unbound", binding });
    }
    this._autoBindings = {};
  },

  /** Start listening for normalized control input. Call when the panel is built. */
  _attachInputLearn(target = document) {
    ensureMidiInputSource(); // guarantee the MIDI adapter is translating
    ensureKeyboardInputSource(); // and the keyboard adapter
    if (this._inputHandler) target.removeEventListener("wam-control-input", this._inputHandler);
    this._inputTarget = target;
    this._inputHandler = (e) => this._handleControlInput(e.detail);
    target.addEventListener("wam-control-input", this._inputHandler);
  },

  _teardownInputLearn() {
    const target = this._inputTarget ?? document;
    if (this._inputHandler) target.removeEventListener("wam-control-input", this._inputHandler);
    this._inputHandler = null;
    if (this._learnKeyHandler) document.removeEventListener("keydown", this._learnKeyHandler);
    this._learnKeyHandler = null;
  },

  /**
   * Default control-input handler: learn if armed, otherwise apply + notify.
   * Hosts may override (e.g. to intercept a "jam learn" mode) and delegate back
   * via InputLearnMixin._handleControlInput.call(this, detail).
   */
  _handleControlInput(detail) {
    if (!detail?.binding) return;
    // Escape is reserved for cancelling a learn (handled by the keydown
    // listener in _startInputLearn); never bind or apply it.
    if (detail.binding.source === "keyboard" && detail.binding.key === "escape") return;
    if (this._learnParam) {
      this._setParamBinding(this._learnParam, detail.binding);
      this._stopInputLearn();
      return;
    }
    this._applyInput(detail);
    this._onInputExtra(detail);
  },

  /** Hook for panel-specific reactions after apply (default no-op). */
  _onInputExtra(_detail) {},

  _wireInputLearn(control, param) {
    if (!control || !param) return;
    const startLearn = () => this._startInputLearn(param);
    const stopLearn = () => {
      if (this._learnParam === param) this._stopInputLearn();
    };
    control.title = [control.title, "Hold and move a control to learn."].filter(Boolean).join(" ");
    control.addEventListener("pointerdown", startLearn);
    control.addEventListener("pointerup", stopLearn);
    control.addEventListener("pointercancel", stopLearn);
    control.addEventListener("pointerleave", stopLearn);
    control.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (e.shiftKey) {
        this._clearParamBinding(param);
        return;
      }
      startLearn();
    });
  },

  _startInputLearn(param) {
    this._stopInputLearn();
    this._learnParam = param;
    this._learnRegistry[param]?.classList.add("wam-input-learning");
    this._learnKeyHandler = (e) => {
      if (e.key !== "Escape" || this._learnParam !== param) return;
      e.preventDefault();
      this._clearParamBinding(param);
      this._stopInputLearn();
    };
    document.addEventListener("keydown", this._learnKeyHandler);
  },

  _stopInputLearn() {
    if (this._learnParam) this._learnRegistry[this._learnParam]?.classList.remove("wam-input-learning");
    this._learnParam = null;
    if (this._learnKeyHandler) document.removeEventListener("keydown", this._learnKeyHandler);
    this._learnKeyHandler = null;
  },

  _setParamBinding(param, binding) {
    this._paramBindings[param] = binding;
    this._updateBoundClasses();
    dispatchBindingFeedback({ kind: "bound", binding });
    this._emitChange();
  },

  _clearParamBinding(param) {
    const old = this._paramBindings[param];
    delete this._paramBindings[param];
    this._updateBoundClasses();
    if (old) dispatchBindingFeedback({ kind: "unbound", binding: old });
    this._emitChange();
  },

  _updateBoundClasses() {
    for (const [param, control] of Object.entries(this._learnRegistry)) {
      control?.classList.toggle("wam-input-bound", !!this._paramBindings[param]);
    }
  },

  _applyInput(detail) {
    let matched = false;
    for (const [param, binding] of Object.entries(this._paramBindings)) {
      if (this._applyOne(param, binding, detail)) matched = true;
    }
    for (const [param, binding] of Object.entries(this._autoBindings)) {
      if (this._paramBindings[param]) continue; // a manual binding for this param wins
      if (this._applyOne(param, binding, detail)) matched = true;
    }
    // Mirror the value back to the device (LED) only for mapped controls.
    if (matched && detail.value != null) {
      dispatchBindingFeedback({ kind: "value", binding: detail.binding, value: detail.value });
    }
  },

  _applyOne(param, binding, detail) {
    if (!bindingsEqual(binding, detail.binding)) return false;
    const control = this._learnRegistry[param];
    if (!control) return false;
    const value = this._inputValueToControlValue(detail, control);
    if (value == null) return false;
    this._setControlValueFromInput(control, param, value);
    return true;
  },

  /** Map a normalized 0..1 input value onto a control's min/max (with log + step). */
  _inputValueToControlValue(detail, control) {
    const norm = detail?.value;
    if (norm == null) return null;
    const min = parseFloat(control.getAttribute("min") ?? "0");
    const max = parseFloat(control.getAttribute("max") ?? "1");
    const step = parseFloat(control.getAttribute("step") ?? "0.01");
    const clamped = Math.max(0, Math.min(1, norm));
    let value;
    if (control.getAttribute("scale") === "log" && min > 0 && max > 0) {
      value = min * Math.pow(max / min, clamped);
    } else {
      value = min + clamped * (max - min);
    }
    if (Number.isFinite(step) && step > 0) value = Math.round(value / step) * step;
    return Math.max(min, Math.min(max, value));
  },

  _setControlValueFromInput(control, param, value) {
    control.value = value;
    const eventName = control.tagName.toLowerCase() === "wam-slider" ? "slider-input" : "knob-input";
    control.dispatchEvent(
      new CustomEvent(eventName, {
        bubbles: true,
        detail: { param, label: control.getAttribute("label") || param, value },
      }),
    );
  },
};
