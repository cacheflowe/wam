/**
 * Jam: the one-shot hit on the next step — its binding (keyboard / MIDI / any source), keys, trigger notification, and control-input interception for jam learn.
 *
 * Part of WebAudioControlsBase (ui/controls-base.js): these methods are
 * installed onto its prototype (see ./install.js), so they share the panel's
 * state (`this._seq`, `this._patterns`, …) and subclasses can override them
 * as usual. Moved verbatim from controls-base.js (architecture-refactor Phase 3).
 */
import { InputLearnMixin } from "../input-learn.js";
import { bindingsEqual, formatBinding } from "../../input/input-bindings.js";
import { describeTrigger } from "../../global/note-event.js";

export class JamControls {
  /** Set the jam trigger binding (any source). */
  _setJamBinding(binding) {
    this._jamBinding = binding;
    this._updateJamLabel();
    this._emitChange();
  }
  /** Clear the jam binding (Escape while learning). */
  _clearJamBinding() {
    this._jamBinding = null;
    this._updateJamLabel();
    this._emitChange();
  }
  /** Update jam button text and tooltip to reflect the current binding. */
  _updateJamLabel() {
    if (!this._jamBtn) return;
    const label = formatBinding(this._jamBinding);
    if (label) {
      this._jamBtn.textContent = `Jam ${label}`;
      this._jamBtn.title = `Trigger on next beat [${label}] - Hold + press a key or move a control to rebind`;
      return;
    }
    this._jamBtn.textContent = "Jam";
    this._jamBtn.title = "Trigger on next beat - Hold + press a key or move a control to bind";
  }
  /** Default keyboard shortcut for the jam button. Override per instrument. */
  _defaultJamKey() {
    return null;
  }
  /**
   * Guarantee a jam trigger exists when this instrument is activated for
   * hardware control. Uses the instrument's default key, else a caller-supplied
   * fallback (e.g. a digit based on slot). No-op if already bound.
   */
  ensureJamBinding(fallbackKey = null) {
    if (this._jamBinding) return;
    const key = this._defaultJamKey() || fallbackKey;
    if (key) this._setJamBinding({ source: "keyboard", key: String(key).toLowerCase() });
  }
  /** Queue a jam trigger for the next sequencer step. */
  _queueJam() {
    if (this._ctx?.state === "suspended") this._ctx.resume();
    this._jamPending = true;
  }
  /**
   * Fire the instrument's jam sound. Called from step() when _jamPending is true
   * and no sequencer step was active. Override in subclass.
   */
  _triggerJam(time, stepDurationSec) {}
  /**
   * Notify the UI that this instrument fired a note.
   * Dispatches a bubbling "wam-trigger" CustomEvent for visualization.
   * detail: { velocity, note } — `note` is the uniform note event from
   * global/note-event.js (notes, velocity, duration, accent, time) or null for
   * instruments that don't describe their triggers (e.g. the loop player).
   * NOTE: fires at *schedule* time (the lookahead runs ~100ms ahead of audio);
   * `note.time` is the AudioContext time the sound actually plays.
   */
  _notifyTrigger(velocity = 1, note = null) {
    this.dispatchEvent(
      new CustomEvent("wam-trigger", { bubbles: true, detail: { velocity: Math.min(1, velocity), note } }),
    );
  }
  /**
   * Wrap the instrument's trigger/triggerDrum methods so _notifyTrigger fires
   * automatically on every note, keeping instrument code DRY. Nested calls
   * (e.g. sample-player's triggerDrum → trigger) notify only once.
   */
  _wrapTrigger(instrument) {
    const self = this;
    let depth = 0;
    for (const method of ["trigger", "triggerDrum"]) {
      const orig = instrument[method];
      if (typeof orig === "function") {
        instrument[method] = function (...args) {
          if (depth === 0 && !self._muteHandle?.isMuted()) {
            const note = describeTrigger(instrument.constructor, method, args);
            self._notifyTrigger(note?.velocity ?? 1, note);
          }
          depth++;
          try {
            return orig.apply(this, args);
          } finally {
            depth--;
          }
        };
      }
    }
  }
  /** Performance API: play this instrument's jam hit on the next step. */
  jam() {
    this._queueJam();
  }
  /**
   * Register a global keyboard shortcut that fires `fn` when `key` is pressed.
   * Automatically resumes a suspended AudioContext. Handlers are removed on disconnect
   * and re-registered on each bind() call.
   * @param {string}   key  e.g. "b", "v", " "
   * @param {function} fn
   */
  _bindJamKey(key, fn) {
    const k = key.toLowerCase();
    const handler = (e) => {
      if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
      if (e.key.toLowerCase() !== k) return;
      if (this._ctx?.state === "suspended") this._ctx.resume();
      fn(e);
    };
    document.addEventListener("keydown", handler);
    this._jamKeyHandlers.push(handler);
  }
  /**
   * Intercept "jam learn" mode first, then fall back to the standard
   * learn/apply path. Jam matching happens in _onInputExtra (post-apply).
   */
  _handleControlInput(detail) {
    if (!detail?.binding) return;
    if (this._jamLearning) {
      if (detail.pressed === false) return; // ignore releases while learning
      // Escape cancels rather than binding itself.
      if (detail.binding.source === "keyboard" && detail.binding.key === "escape") {
        this._clearJamBinding();
      } else {
        this._setJamBinding(detail.binding);
      }
      this._stopJamLearn?.();
      return;
    }
    InputLearnMixin._handleControlInput.call(this, detail);
  }
  _onInputExtra(detail) {
    if (detail.pressed === false) return;
    if (bindingsEqual(this._jamBinding, detail.binding)) this._queueJam();
  }
}
