/**
 * Pattern playback (step() delegates to the headless PatternTrack) and the performance API used by hardware / commands: launch patterns, volume, mute, randomize pattern.
 *
 * Part of WebAudioControlsBase (ui/controls-base.js): these methods are
 * installed onto its prototype (see ./install.js), so they share the panel's
 * state (`this._seq`, `this._patterns`, …) and subclasses can override them
 * as usual. Moved verbatim from controls-base.js (architecture-refactor Phase 3).
 */
import { describePattern, generatePattern } from "../../global/pattern-gen.js";
import { meetsBarCondition } from "../../global/sequencer-conditions.js";

export class Playback {
  /** Update playing indicator on pattern tabs. */
  // ---- Performance API (hardware / commands). Public, stable surface so the
  // MIDI layer never reaches into private state. ----

  /** Pattern names this instrument supports (empty if it has no multi-pattern sequencer). */
  get patternNames() {
    return this._patterns ? ["A", "B", "C", "D"].filter((n) => this._patterns[n]) : [];
  }
  /** Name of the pattern currently playing. */
  get playingPattern() {
    return this._playingPattern ?? null;
  }
  /** Name of a pattern waiting for the next bar, or null. */
  get queuedPattern() {
    return this._track.queued;
  }
  /** Does a pattern have any active steps? */
  patternHasSteps(name) {
    return !!this._patterns?.[name]?.steps?.some((s) => s.active);
  }
  /**
   * Launch a pattern: it loops alone (chain = [it]) starting at the next bar
   * boundary — immediately if we're already on one (or stopped). The editor
   * follows, so step buttons edit what you hear.
   */
  launchPattern(name) {
    if (!this._patterns?.[name]) return;
    this._syncTrack();
    this._track.launch(name);
    if (this._track.queued == null) this._onPatternLaunched(name);
    else this.dispatchEvent(new CustomEvent("pattern-queued", { bubbles: true, detail: { name } }));
  }
  /** UI follow-up once the track has switched to a launched pattern (chain already = [it]). */
  _onPatternLaunched(name) {
    this._chainPosition = 0;
    this._playingPattern = name;
    const color = this._defaultColor?.() || "#0f0";
    this._updateChainBar(color);
    // Mark the launched tab as the edited one before syncing the grid (see _restoreSequencer).
    Object.entries(this._patternTabs ?? {}).forEach(([n, tab]) => tab.toggleAttribute("data-active", n === name));
    this._selectPattern(name);
    this.dispatchEvent(new CustomEvent("pattern-launched", { bubbles: true, detail: { name } }));
    this._emitChange();
  }
  /** Randomize the step pattern (performance API). */
  randomizePattern() {
    if (this._seq) this.randomize();
  }
  /**
   * New step pattern from the instrument's PATTERN_ROLE recipe
   * (global/pattern-gen.js) in the current key. Subclasses with their own
   * idea of "randomize" (BlipFX sound, sampler) override this.
   * @param {object} [opts]  forwarded to generatePattern (e.g. { rhythm: "euclid" })
   */
  randomize(opts = {}) {
    const Cls = this._instrument?.constructor;
    const role = Cls?.PATTERN_ROLE;
    if (!role || !this._seq) return null;
    const { steps, meta } = generatePattern(role, {
      root: this._rootMidi ?? 36,
      scale: this._scaleName ?? "Minor",
      range: Cls.NOTE_RANGE ?? [24, 60],
      accent: !!Cls.PATTERN_ACCENTS,
      ...opts,
    });
    this._lastPatternMeta = meta;
    const evolver = this.__evolver;
    if (this._seqRandBtn) this._seqRandBtn.title = `New pattern. Last: ${describePattern(meta)}`;
    this._instrument.steps = steps;
    evolver?.userEdited(this._editedPatternName());
    this.dispatchEvent(new CustomEvent("pattern-generated", { bubbles: true, detail: { meta } }));
    this._emitChange();
    return meta;
  }
  /** Channel-strip volume (pre-mute), 0..1. */
  get volume() {
    return this._channel?.volume ?? 1;
  }
  /** Set channel-strip volume through the control event path (respects mute). */
  setVolume(v) {
    const slider = this._sliders.volume;
    if (!slider) return;
    slider.value = v;
    slider.dispatchEvent(new CustomEvent("knob-input", { bubbles: true, detail: { param: "volume", value: v } }));
  }
  get muted() {
    return !!this._muteHandle?.isMuted();
  }
  toggleMute() {
    this._muteHandle?.toggleMuted?.();
  }
  /** Point the headless track at this panel's live pattern data (shared references). */
  _syncTrack() {
    const t = this._track;
    t.patterns = this._patterns ?? { A: { steps: this._instrument?.steps ?? [] } };
    t.chain = this._chain ?? [0];
    t.params = this._seq?.getPatternParams() ?? {};
    t.speed = this.speedMultiplier ?? 1;
  }
  /**
   * Base sequencer step handler. Called on each global tick.
   * Playback rules (speed, density, chain, rotation, probability, conditions)
   * live in the headless PatternTrack (global/pattern-track.js), which derives
   * everything from this panel's tick count since Play. This method applies the
   * result: trigger the instrument, follow the chain in the UI, play queued jams.
   * Ratchets and gate are applied by the instrument (_triggerRatcheted).
   *
   * @param {boolean} [isManual]  Bypass playback and fire this exact step
   *   immediately (e.g. a UI preview click).
   */
  step(index, time, stepDurationSec, isManual = false) {
    if (!this._instrument || !this._seq) return;

    // Manual trigger: bypass playback, fire immediately.
    if (isManual) {
      this._seq.setActiveStep(index);
      const s = this._instrument.steps[index];
      if (s) this._instrument.triggerSequenceStep(index, s, time, stepDurationSec);
      return;
    }

    // Hook for instrument-specific per-tick processing (e.g. acid LFO position)
    this._onStepTick?.(index, time, stepDurationSec);

    this._syncTrack();
    const tick = this.clock?.current ? this.clock.current.tick : this._tick;
    this._tick++;
    const result = this._track.tick(tick, time, stepDurationSec);
    if (result.launched) this._onPatternLaunched(result.launched);

    // Follow the chain in the UI when the sounding pattern changes.
    if (result.position.played && result.position.chainIndex !== this._chainPosition) {
      this._chainPosition = result.position.chainIndex;
      this._playingPattern = result.patternName;
      const color = this._defaultColor?.() || "#0f0";
      this._updateChainBar(color);
      this._updateTabPlayingIndicators(color);
    }

    let stepFired = false;
    for (const slot of result.slots) {
      this._setMiniStripPlayhead(result.patternName, slot.index);
      this._lastPlayedIndex = slot.index;
      if (slot.fires) {
        stepFired = true;
        this._instrument.triggerSequenceStep(slot.index, slot.step, slot.time, slot.dur);
      }
    }

    if (this._jamPending && !stepFired) this._triggerJam(time, stepDurationSec);
    this._jamPending = false;
  }
  /**
   * Highlight the step that's playing (accounts for rotation). Pass -1 to clear.
   * @param {number} [index]  ignored except -1 (the playground passes the global step)
   */
  setActiveStep(index) {
    if (index === -1) return this._seq?.setActiveStep(-1);
    this._seq?.setActiveStep(this._lastPlayedIndex ?? -1);
  }
  /**
   * Whether a step's bar-cycle condition ("X:Y" trig condition) fires on the
   * given global bar index. Shared by every instrument's step() loop.
   */
  _meetsCondition(condition, barIndex) {
    return meetsBarCondition(condition, barIndex);
  }
  // ---- Routing ----

  set bpm(v) {
    if (this._fxUnit) this._fxUnit.bpm = v;
  }
  get speedMultiplier() {
    return this._speedMultiplier;
  }
  set speedMultiplier(v) {
    this._speedMultiplier = v;
  }
  /** Reset sequencer playhead to the beginning. Call on transport stop/play. */
  resetSequencer() {
    this._tick = 0;
    this._lastPlayedIndex = -1;
    this._syncTrack();
    const pending = this._track.queued;
    this._track.reset(); // back to the top of the chain; a pending launch applies now
    if (pending) this._onPatternLaunched(pending);
    this._chainPosition = 0;
    this._playingPattern = ["A", "B", "C", "D"][this._chain?.[0] ?? 0];
    this._clearMiniStripPlayhead();
  }
}
