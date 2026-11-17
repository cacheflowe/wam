/**
 * Evolve (global/evolver.js) wiring: the panel's TrackEvolver adapter and the Evolve / Keep / Return performance actions.
 *
 * Part of WebAudioControlsBase (ui/controls-base.js): these methods are
 * installed onto its prototype (see ./install.js), so they share the panel's
 * state (`this._seq`, `this._patterns`, …) and subclasses can override them
 * as usual. Moved verbatim from controls-base.js (architecture-refactor Phase 3).
 */
import { TrackEvolver } from "../../global/evolver.js";
import { generatePattern, notePool } from "../../global/pattern-gen.js";

export class EvolveControls {
  // ---- Evolve (global/evolver.js) ----

  /** Name of the pattern tab being edited. */
  _editedPatternName() {
    return Object.entries(this._patternTabs ?? {}).find(([, t]) => t.hasAttribute("data-active"))?.[0] ?? "A";
  }
  /** This panel's evolver (null for instruments without patterns or a pattern role). */
  get evolver() {
    if (!this._patterns || !this._instrument?.constructor.PATTERN_ROLE) return null;
    return (this.__evolver ??= new TrackEvolver(this._evolveAdapter()));
  }
  _evolveAdapter() {
    const Cls = this._instrument.constructor;
    const role = Cls.PATTERN_ROLE;
    return {
      role,
      get: (name) => (this._patterns?.[name]?.steps ?? []).map((s) => ({ ...s })),
      set: (name, steps) => this._writePatternSteps(name, steps),
      playing: (tick) => {
        this._syncTrack();
        return tick != null ? this._track.patternAt(tick) : (this._playingPattern ?? "A");
      },
      notes: () => notePool(this._rootMidi ?? 36, this._scaleName ?? "Minor", Cls.NOTE_RANGE ?? [24, 60]),
      regenerate: () =>
        generatePattern(role, { root: this._rootMidi ?? 36, scale: this._scaleName ?? "Minor", range: Cls.NOTE_RANGE ?? [24, 60], accent: !!Cls.PATTERN_ACCENTS }).steps,
      onChange: (kind, info) => {
        if (kind === "home") this._emitChange(); // permanent changes autosave; temporary ones don't need to
        this.dispatchEvent(new CustomEvent("evolve-change", { bubbles: true, detail: { kind, ...info } }));
      },
    };
  }
  /** Write a pattern's steps from code (Evolve): playback, grid and mini strip stay in sync. */
  _writePatternSteps(name, steps) {
    if (!this._patterns?.[name]) return;
    const copy = steps.map((s) => ({ ...s }));
    if (this._editedPatternName() === name) {
      this._instrument.steps = copy; // → grid + lossless _syncPatternEdit
    }
    this._patterns[name].steps = copy.map((s) => ({ ...s }));
    this._refreshMiniStrip(name);
  }
  /** Performance API: one permanent evolution step of the playing pattern. */
  evolveNow(energy = 0.5) {
    return this.evolver?.evolve({ energy });
  }
  /** Performance API: adopt the playing variation as the new home. */
  keepVariation() {
    this.evolver?.keep();
  }
  /** Performance API: snap the pattern home back to the original. */
  returnHome() {
    this.evolver?.returnHome();
  }
}
