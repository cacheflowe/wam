/**
 * KeyboardInputSource — the computer-keyboard adapter.
 *
 * Emits normalized `wam-control-input` trigger events for key presses and
 * releases, so the keyboard is just another controller. This is what lets the
 * jam shortcut and sequencer steps be driven from the keyboard through the same
 * code path as a MIDI button — no special-casing in the components.
 *
 * Keys are identified by `event.key` (lowercased) to match the legacy jam-key
 * storage, so existing saved shortcuts migrate cleanly. Typing into a text
 * field is ignored, matching prior behavior.
 */
import { registerBindingType, dispatchControlInput, dispatchCommand, commandForBinding } from "./input-bindings.js";

registerBindingType("keyboard", {
  equals: (a, b) => a.key === b.key,
  format: (b) => (b.key === " " ? "Space" : (b.key || "").toUpperCase()),
});

const TEXT_INPUT_TAGS = ["INPUT", "SELECT", "TEXTAREA"];

export default class KeyboardInputSource {
  /** @param {EventTarget} [target] where to listen/dispatch (default: document) */
  constructor(target = document) {
    this._target = target;
    this._down = new Set(); // held keys: dedupe auto-repeat, pair press↔release

    this._onKeyDown = (e) => {
      if (TEXT_INPUT_TAGS.includes(document.activeElement?.tagName)) return;
      if (e.repeat) return;
      const key = (e.key || "").toLowerCase();
      if (!key) return;

      // Commands fire once, on press only. Don't track them in _down so the
      // keyup pairing below skips them (no release event for a command).
      const command = commandForBinding({ source: "keyboard", key });
      if (command) {
        e.preventDefault(); // arrows/space would otherwise scroll the page
        dispatchCommand(command, { raw: e }, this._target);
        return;
      }

      this._down.add(key);
      dispatchControlInput(
        { binding: { source: "keyboard", key }, value: 1, kind: "trigger", pressed: true, raw: e },
        this._target,
      );
    };

    this._onKeyUp = (e) => {
      const key = (e.key || "").toLowerCase();
      if (!this._down.delete(key)) return;
      dispatchControlInput(
        { binding: { source: "keyboard", key }, value: 0, kind: "trigger", pressed: false, raw: e },
        this._target,
      );
    };
  }

  start() {
    this._target.addEventListener("keydown", this._onKeyDown);
    this._target.addEventListener("keyup", this._onKeyUp);
    return this;
  }

  stop() {
    this._target.removeEventListener("keydown", this._onKeyDown);
    this._target.removeEventListener("keyup", this._onKeyUp);
    this._down.clear();
  }
}

let _singleton = null;

/**
 * Ensure exactly one document-level keyboard adapter is emitting control input.
 * Idempotent — learn-capable components call this on mount.
 */
export function ensureKeyboardInputSource(target = document) {
  if (!_singleton) _singleton = new KeyboardInputSource(target).start();
  return _singleton;
}
