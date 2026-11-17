/**
 * Sound design UI over global/sound-design.js: randomize / mutate / undo / redo, and per-section locks.
 *
 * Part of WebAudioControlsBase (ui/controls-base.js): these methods are
 * installed onto its prototype (see ./install.js), so they share the panel's
 * state (`this._seq`, `this._patterns`, …) and subclasses can override them
 * as usual. Moved verbatim from controls-base.js (architecture-refactor Phase 3).
 */
import { MUTATE_AMOUNTS, SoundHistory, captureValues, mutateValues, randomizeValues } from "../../global/sound-design.js";

export class SoundDesignControls {
  // ---- Sound design: randomize / mutate / undo (see global/sound-design.js) ----

  /** The instrument's engine-level param schema, or null for unmigrated instruments. */
  get _paramSchema() {
    return this._instrument?.constructor.PARAMS ?? null;
  }
  get _soundHistory() {
    return (this.__soundHistory ??= new SoundHistory());
  }
  /** Snapshot the current sound onto the undo stack. */
  _recordSound() {
    if (!this._paramSchema) return;
    this._soundHistory.record(captureValues(this._instrument));
    this._updateHistoryButtons();
  }
  _updateHistoryButtons() {
    if (this._undoBtn) this._undoBtn.disabled = !this._soundHistory.canUndo;
    if (this._redoBtn) this._redoBtn.disabled = !this._soundHistory.canRedo;
  }
  /**
   * Apply a values object through the standard control event path
   * (`knob-input`), so UI, MIDI/LED feedback and the instrument stay in sync.
   * Params without a control are written to the instrument directly.
   */
  _applyParamValues(values) {
    for (const [param, value] of Object.entries(values)) {
      const knob = this._sliders[param];
      const select = this._selects[param]?.el;
      const toggle = this._toggles[param];
      if (knob) knob.value = value;
      if (select) select.value = value;
      if (toggle) toggle.el.classList.toggle(toggle.activeClass, !!value);
      const target = knob ?? select ?? toggle?.el;
      if (target) {
        target.dispatchEvent(new CustomEvent("knob-input", { bubbles: true, detail: { param, value } }));
      } else {
        this._instrument[param] = value;
      }
    }
    this._instrument._rebake?.();
    this._instrument._markDirty?.();
    this._syncExtraControls();
  }
  /**
   * Give each control section that holds randomizable params a lock button.
   * A locked section's params are passed to randomize/mutate as `locks`, so
   * you can keep (say) the envelope while rolling the filter.
   */
  _attachSectionLocks(root) {
    const schema = this._paramSchema;
    if (!schema) return;
    const randomizable = new Set(schema.filter((d) => d.rand !== false).map((d) => d.param));
    this._soundLocks ??= new Set();
    this._lockButtons = [];
    for (const section of root.querySelectorAll(".wam-section:not([data-fx-section])")) {
      const params = [
        ...Object.entries(this._sliders).filter(([, el]) => section.contains(el)).map(([p]) => p),
        ...Object.entries(this._selects).filter(([, { el }]) => section.contains(el)).map(([p]) => p),
        ...Object.entries(this._toggles).filter(([, { el }]) => section.contains(el)).map(([p]) => p),
      ].filter((p) => randomizable.has(p));
      if (!params.length) continue;
      const title = section.querySelector(".wam-title");
      if (!title) continue;
      const btn = document.createElement("button");
      btn.className = "wam-lock-btn";
      btn.type = "button";
      const paint = () => {
        const locked = params.every((p) => this._soundLocks.has(p));
        btn.textContent = locked ? "🔒" : "🔓";
        btn.title = locked ? "Locked: Rand/Mutate leave this section alone" : "Lock this section from Rand/Mutate";
        btn.toggleAttribute("data-locked", locked);
        section.toggleAttribute("data-locked", locked);
      };
      btn.addEventListener("click", () => {
        const lock = !params.every((p) => this._soundLocks.has(p));
        for (const p of params) lock ? this._soundLocks.add(p) : this._soundLocks.delete(p);
        paint();
        this._emitChange();
      });
      title.classList.add("wam-title-lockable");
      title.appendChild(btn);
      this._lockButtons.push(paint);
      paint();
    }
  }
  /** Repaint lock buttons after locks change programmatically (e.g. fromJSON). */
  _paintSectionLocks() {
    for (const paint of this._lockButtons ?? []) paint();
  }
  /** Run a sound change: record undo, compute new values, apply, notify. */
  _changeSound(compute) {
    const Cls = this._instrument.constructor;
    const current = captureValues(this._instrument);
    this._soundHistory.record(current);
    const opts = { locks: this._soundLocks ?? null, constrain: Cls.constrain?.bind(Cls) };
    this._applyParamValues(compute(Cls.PARAMS, current, opts));
    this._updateHistoryButtons();
    this._emitChange();
  }
  /** Nudge the current sound by `amount` (0..1; see MUTATE_AMOUNTS). */
  mutate(amount = MUTATE_AMOUNTS.medium) {
    if (!this._paramSchema) return;
    this._changeSound((params, current, opts) => mutateValues(params, current, amount, opts));
  }
  undoSound() {
    if (!this._paramSchema) return;
    const prev = this._soundHistory.undo(captureValues(this._instrument));
    if (prev) this._applyParamValues(prev);
    this._updateHistoryButtons();
    if (prev) this._emitChange();
  }
  redoSound() {
    if (!this._paramSchema) return;
    const next = this._soundHistory.redo(captureValues(this._instrument));
    if (next) this._applyParamValues(next);
    this._updateHistoryButtons();
    if (next) this._emitChange();
  }
  /**
   * Randomize the sound. Instruments with a param schema use curated ranges
   * (and are undoable); legacy instruments fall back to full slider ranges.
   */
  _randomizeAllParams() {
    if (this._paramSchema) {
      this._changeSound((params, current, opts) => randomizeValues(params, current, opts));
      return;
    }
    for (const def of this.constructor.SLIDER_DEFS || []) {
      if (def.param === "volume" || def.param === "chance") continue;
      const min = parseFloat(def.min);
      const max = parseFloat(def.max);
      const step = parseFloat(def.step) || 0.01;
      let val;
      if (def.scale === "log") {
        // Log-scale: randomize in log space
        val = Math.exp(Math.random() * (Math.log(max) - Math.log(min)) + Math.log(min));
      } else {
        val = min + Math.random() * (max - min);
      }
      // Quantize to step
      val = Math.round(val / step) * step;
      val = Math.min(max, Math.max(min, val));
      this._instrument[def.param] = val;
    }
    // Randomize registered selects (e.g. oscType)
    for (const [param, { el }] of Object.entries(this._selects)) {
      const opts = [...el.options].filter((o) => !o.disabled);
      if (opts.length > 0) {
        const pick = opts[Math.floor(Math.random() * opts.length)];
        el.value = pick.value;
        const parsed = this._selects[param].parse ? this._selects[param].parse(pick.value) : pick.value;
        this._instrument[param] = parsed;
      }
    }
    if (this._instrument._rebake) this._instrument._rebake();
    if (this._instrument._markDirty) this._instrument._markDirty();
    this._syncSliders();
    this._syncExtraControls();
  }
}
