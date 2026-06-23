/**
 * LedFeedback — lights Launch Control XL LEDs to mirror mapped controls.
 *
 * Subscribes to the learn layer's `wam-binding-feedback` intents (bound /
 * unbound / value) and, for any binding that resolves to an LCXL control with
 * an LED, drives that LED through a batched MidiOutput. Non-LCXL bindings and
 * the absence of an output port are silently ignored, so this never interferes
 * with other controllers or a keyboard-only setup.
 *
 * The learn layer stays device-agnostic: it only announces intents. This sink
 * is the only place that knows about LCXL LED indices and colors.
 */
import MidiOutput from "./midi-output.js";
import { findControl, ledColorByPercent, templateFromChannel, LED } from "./launch-control-xl.js";

const BOUND_COLOR = LED.RED_LOW; // dim "this control is manually mapped" indicator
const AUTO_COLOR = LED.AMBER_LOW; // dim "this control is auto-mapped to the focused instrument"

export class LedFeedback {
  constructor(target = document) {
    this._target = target;
    this._out = new MidiOutput();
    this._access = null;
    this._started = false;
    this._onFeedback = (e) => this._handleFeedback(e.detail);
    this._onMidi = (e) => {
      const t = templateFromChannel(e.detail?.channel);
      if (t != null) this._out.setTemplate(t);
    };
    this._onStateChange = () => this._selectOutput();
  }

  get output() {
    return this._out;
  }

  start() {
    if (this._started) return;
    this._started = true;
    this._target.addEventListener("wam-binding-feedback", this._onFeedback);
    this._target.addEventListener("wam-midi-message", this._onMidi);
  }

  stop() {
    this._target.removeEventListener("wam-binding-feedback", this._onFeedback);
    this._target.removeEventListener("wam-midi-message", this._onMidi);
    if (this._access) this._access.removeEventListener("statechange", this._onStateChange);
    this._started = false;
  }

  /** Adopt a (sysex-enabled) MIDIAccess and auto-select the LCXL output. */
  adoptAccess(access) {
    if (!access || this._access === access) return;
    this._access = access;
    access.addEventListener("statechange", this._onStateChange);
    this._selectOutput();
    this.start();
  }

  /** Manually set the output port (e.g. from a UI selector). */
  setOutput(port) {
    this._out.setOutput(port);
    return this;
  }

  _selectOutput() {
    const outs = [...(this._access?.outputs?.values?.() ?? [])];
    const lc = outs.filter((o) => /launch control/i.test(o.name || ""));
    // On Windows the LED port is usually the secondary "MIDIOUT2 (...)" port.
    const port = lc.find((o) => /\b(2|4|MIDIOUT)\b/i.test(o.name || "")) || lc[0] || null;
    this._out.setOutput(port);
  }

  _handleFeedback(detail) {
    const control = this._controlFor(detail?.binding);
    if (!control) return;
    if (detail.kind === "bound") this._out.queueControlLed(control.id, detail.auto ? AUTO_COLOR : BOUND_COLOR);
    else if (detail.kind === "unbound") this._out.queueControlLed(control.id, LED.OFF);
    else if (detail.kind === "value") this._out.queueControlLed(control.id, ledColorByPercent(detail.value ?? 0));
  }

  _controlFor(binding) {
    if (!binding || binding.source !== "midi") return null;
    const control = findControl(binding);
    return control?.ledIndex != null ? control : null;
  }
}

/** Shared singleton used by the app; tests can construct their own instances. */
export const ledFeedback = new LedFeedback();
