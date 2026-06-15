/**
 * MidiInputSource — the MIDI controller adapter.
 *
 * The `<wam-midi-input-picker>` owns the hardware and broadcasts raw, MIDI-shaped
 * `wam-midi-message` events. This adapter translates those into the normalized,
 * source-agnostic `wam-control-input` events the learn system consumes — and
 * registers how "midi" bindings compare and display.
 *
 * The raw MIDI stream is intentionally left intact: device-specific features
 * (LED feedback, template tracking) still subscribe to `wam-midi-message`
 * directly because they need channel/CC/note specifics. No information is lost
 * here — the normalized binding stays MIDI-tagged (`source: "midi"` plus the
 * original fields), so `findControl()` etc. still resolve it downstream.
 *
 * Note: the picker only parses note-ON (velocity > 0) and CC, so this adapter
 * emits press events for notes; note-offs are not currently surfaced.
 */
import { midiBindingsEqual, formatMidiBinding } from "../ui/midi-input-picker.js";
import { registerBindingType, dispatchControlInput } from "./input-bindings.js";

// Reuse the existing MIDI comparator/formatter so behavior (and tests) are
// unchanged; they ignore the extra `source` field on the binding.
registerBindingType("midi", { equals: midiBindingsEqual, format: formatMidiBinding });

/**
 * Convert a parsed MIDI message (the `wam-midi-message` detail) into a
 * normalized control-input detail, or null if not mappable.
 */
export function midiMessageToControlInput(message) {
  if (!message?.binding) return null;
  const binding = { source: "midi", ...message.binding };
  if (message.type === "cc") {
    return { binding, value: message.value / 127, kind: "absolute", raw: message };
  }
  if (message.type === "note") {
    return { binding, value: message.velocity / 127, kind: "trigger", pressed: true, raw: message };
  }
  return null;
}

export default class MidiInputSource {
  /** @param {EventTarget} [target] where to listen for / dispatch events (default: document) */
  constructor(target = document) {
    this._target = target;
    this._onMidi = (e) => {
      const detail = midiMessageToControlInput(e.detail);
      if (detail) dispatchControlInput(detail, this._target);
    };
  }

  start() {
    this._target.addEventListener("wam-midi-message", this._onMidi);
    return this;
  }

  stop() {
    this._target.removeEventListener("wam-midi-message", this._onMidi);
  }
}

let _singleton = null;

/**
 * Ensure exactly one document-level MIDI adapter is translating raw MIDI into
 * normalized control input. Idempotent — any learn-capable component can call
 * this on mount without worrying about duplicates.
 */
export function ensureMidiInputSource(target = document) {
  if (!_singleton) _singleton = new MidiInputSource(target).start();
  return _singleton;
}
