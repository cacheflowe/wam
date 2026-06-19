import { midiBindingsEqual, formatMidiBinding } from "../ui/midi-input-picker.js";
import { registerBindingType, dispatchControlInput, dispatchCommand, commandForBinding } from "./input-bindings.js";

// Reuse the existing MIDI comparator/formatter so behavior (and tests) are
// unchanged; they ignore the extra `source` field on the binding.
registerBindingType("midi", { equals: midiBindingsEqual, format: formatMidiBinding });

/**
 * Convert a parsed MIDI message (the `wam-midi-message` detail) into a
 * normalized control-input detail, or null if not mappable.
 * Also checks for registered commands.
 *
 * @param {object} message - The MIDI message.
 * @returns {object|null} A control input detail, a command detail, or null.
 */
export function midiMessageToControlInput(message) {
  if (!message?.binding) return null;
  const binding = { source: "midi", ...message.binding };

  // 1. Check for commands first. Commands fire once, on press only: note
  //    messages are already note-on (the picker drops note-off), but CC
  //    buttons send value 127 on press and 0 on release — ignore the release.
  const command = commandForBinding(binding);
  if (command) {
    if (message.type === "cc" && !message.value) return null;
    return { command, raw: message };
  }

  // 2. Otherwise, return control input
  if (message.type === "cc") {
    return { binding, value: message.value / 127, kind: "absolute", raw: message };
  }
  if (message.type === "note") {
    return { binding, value: message.velocity / 127, kind: "trigger", pressed: true, raw: message };
  }
  return null;
}

export default class MidiInputSource {
  constructor(target = document) {
    this._target = target;
    this._onMidi = (e) => {
      const detail = midiMessageToControlInput(e.detail);
      if (!detail) return;

      if (detail.command) {
        dispatchCommand(detail.command, { raw: detail.raw }, this._target);
      } else {
        dispatchControlInput(detail, this._target);
      }
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

export function ensureMidiInputSource(target = document) {
  if (!_singleton) _singleton = new MidiInputSource(target).start();
  return _singleton;
}
