/**
 * Serialization: toJSON / fromJSON (song format per instrument) and the subclass hooks around them.
 *
 * Part of WebAudioControlsBase (ui/controls-base.js): these methods are
 * installed onto its prototype (see ./install.js), so they share the panel's
 * state (`this._seq`, `this._patterns`, …) and subclasses can override them
 * as usual. Moved verbatim from controls-base.js (architecture-refactor Phase 3).
 */
import { migrateLegacyBinding } from "../../input/input-bindings.js";

export class SerializationControls {
  // ---- Serialization ----

  _emitChange() {
    this.dispatchEvent(new CustomEvent("controls-change", { bubbles: true }));
  }
  toJSON() {
    if (!this._instrument) return null;
    const params = {};
    for (const def of this.constructor.SLIDER_DEFS || []) {
      params[def.param] = this._instrument[def.param];
    }
    // Volume lives on controls._out, not on the instrument. Serialize it separately,
    // using getVolume() so a muted instrument doesn't save 0.
    params.volume = this._channel?.volume ?? 1;
    this._extraToJSON(params);
    const obj = {
      params,
      fx: this._fxUnit?.toJSON(),
      muted: this._muteHandle?.isMuted() ?? false,
      soloed: this._soloHandle?.isSoloed() ?? false,
      pan: this._channel?.pan ?? 0,
      jamBinding: this._jamBinding ?? null,
      midiParamBindings: { ...this._paramBindings },
      speedMultiplier: this._speedMultiplier,
      ...(this.__evolver && !this.__evolver.enabled ? { evolveEnabled: false } : {}),
      ...(this._soundLocks?.size ? { soundLocks: [...this._soundLocks] } : {}),
      patternParams: this._seq?.getPatternParams(),
      sections: {
        ctrl: !this._topSection?.hasAttribute("data-hide-ctrl"),
        fx: !this._topSection?.hasAttribute("data-hide-fx"),
        seq: !this._seqSection?.hasAttribute("data-hidden"),
      },
    };
    this._serializeSequencer(obj);
    this._extendJSON(obj);
    return obj;
  }
  /** Add extra params to the params dict (e.g. oscType, lfoShape). */
  _extraToJSON(params) {}
  /** Add extra top-level fields to the JSON (e.g. chordSize). Override in subclass. */
  _extendJSON(obj) {}
  /**
   * Serialize sequencer state (patterns + chain). Override _seqExtendJSON to add
   * extra fields (e.g. chordSize). Base implementation handles patterns/chain.
   */
  _serializeSequencer(obj) {
    if (!this._seq) return;
    // If multi-pattern system is active, serialize patterns + chain
    if (this._patterns) {
      obj.patterns = this._patterns;
      // A temporary Evolve variation is never saved — save its home instead.
      const v = this.__evolver?.variation;
      if (v && this._patterns[v.name]) obj.patterns = { ...this._patterns, [v.name]: { ...this._patterns[v.name], steps: this.__evolver.savedSteps(v.name) } };
      obj.chain = this._chain;
    } else {
      // Single pattern (legacy / instruments without multi-pattern)
      obj.steps = this._seq?.steps ?? [];
    }
    this._seqExtendJSON?.(obj);
  }
  /** Restore sequencer state. Override _seqRestoreExtra for extra fields. */
  _restoreSequencer(obj) {
    if (!this._seq) return;
    if (obj.patterns) {
      // Multi-pattern system
      this._patterns = obj.patterns;
      this._chain = obj.chain ?? [0];
      const activeName = ['A', 'B', 'C', 'D'][this._chain[this._chainPosition] ?? 0];
      // Mark the correct tab active BEFORE touching instrument.steps below —
      // setting instrument.steps fires steps-changed, whose listener calls
      // _syncPatternEdit(), which trusts the tab's data-active state to know
      // which pattern to write into. Doing this out of order would corrupt
      // whichever pattern was still marked active from the initial build.
      const color = this._defaultColor?.() || '#0f0';
      this._updateChainBar(color);
      Object.entries(this._patternTabs ?? {}).forEach(([n, tab]) => {
        this._stylePatternTab(tab, n === activeName, this._playingPattern === n, color);
      });
      // Sync active pattern to the grid AND to instrument.steps — the
      // UI->Instrument step-change listener reads/rewrites instrument.steps,
      // so leaving it stale (e.g. the pattern the instrument was created
      // with) means touching any step after loading a song resets it and
      // wipes the restored pattern out from under you.
      const activeSteps = this._patterns[activeName]?.steps ?? this._seq.steps;
      this._seq.steps = activeSteps;
      this._instrument.steps = activeSteps.map(s => ({ ...s }));
      this._refreshAllMiniStrips();
    } else if (obj.steps) {
      // Legacy single-pattern: migrate to pattern A
      if (this._patterns) {
        this._patterns.A.steps = obj.steps;
        this._chain = [0];
        this._seq.steps = obj.steps;
        this._instrument.steps = obj.steps.map(s => ({ ...s }));
        this._refreshAllMiniStrips();
      } else {
        this._seq.steps = obj.steps;
        this._instrument.steps = obj.steps.map(s => ({ ...s }));
      }
    }
    this._seqRestoreExtra?.(obj);
  }
  fromJSON(obj) {
    if (!obj || !this._instrument) return;
    this.__evolver?.reset(); // a loaded state is a new original
    if (obj.params) {
      for (const [key, val] of Object.entries(obj.params)) {
        this._restoreParam(key, val);
      }
    }
    this._restoreExtra(obj);
    this._restoreSequencer(obj);
    this._soundLocks = new Set(obj.soundLocks ?? []);
    if (obj.evolveEnabled === false && this.evolver) this.evolver.enabled = false;
    this._paintSectionLocks();
    if (obj.fx) this._fxUnit?.fromJSON(obj.fx);
    if (obj.muted != null) this._muteHandle?.setMuted(obj.muted);
    if (obj.soloed != null) {
      this._soloHandle?.setSoloed(obj.soloed);
      this.constructor._applySolo(); // static, inherited by every subclass
    }
    if (obj.pan != null && this._channel) {
      this._channel.pan = obj.pan;
      if (this._panSlider) this._panSlider.value = obj.pan;
    }
    // Jam: prefer the unified binding; fall back to legacy jamMidi / jamKey.
    if (obj.jamBinding) this._setJamBinding(obj.jamBinding);
    else if (obj.jamMidi) this._setJamBinding(migrateLegacyBinding(obj.jamMidi));
    else if (obj.jamKey) this._setJamBinding({ source: "keyboard", key: String(obj.jamKey).toLowerCase() });
    this._paramBindings = {};
    for (const [param, binding] of Object.entries(obj.midiParamBindings ?? {})) {
      this._paramBindings[param] = migrateLegacyBinding(binding);
    }
    this._updateBoundClasses();
    if (obj.speedMultiplier != null) {
      this._speedMultiplier = obj.speedMultiplier;
      if (this._speedSelect) this._speedSelect.value = obj.speedMultiplier;
    }
    if (obj.patternParams) {
      this._seq?.setPatternParams(obj.patternParams);
      if (this._densityInput && obj.patternParams.playEvery != null)
        this._densityInput.value = obj.patternParams.playEvery;
      if (this._rotateInput && obj.patternParams.rotationOffset != null)
        this._rotateInput.value = obj.patternParams.rotationOffset;
      if (this._rotateIntervalInput && obj.patternParams.rotationIntervalBars != null)
        this._rotateIntervalInput.value = obj.patternParams.rotationIntervalBars;
    }
    if (obj.sections) {
      // Backward compat: old saves only had a combined 'ctrl' flag (Ctrl+FX
      // travelled together) — fall back to it for whichever of ctrl/fx is missing.
      const ctrlVisible = obj.sections.ctrl ?? obj.sections.fx ?? false;
      const fxVisible = obj.sections.fx ?? obj.sections.ctrl ?? false;
      this._applyTopSectionPart("ctrl", ctrlVisible);
      this._applyTopSectionPart("fx", fxVisible);
      this._applyPanel(this._seqSection, this._seqBtn, obj.sections.seq ?? true);
    }
  }
  /** Restore a single param. Override for special handling (e.g. oscType → wave buttons). */
  _restoreParam(key, val) {
    if (key === "volume") {
      if (this._channel) this._channel.volume = val;
      if (this._channelStripVolSlider) this._channelStripVolSlider.value = val;
      return;
    }
    // Registered select — set value + dispatch event
    const sel = this._selects[key];
    if (sel) {
      sel.el.value = val;
      sel.el.dispatchEvent(
        new CustomEvent("knob-input", {
          bubbles: true,
          detail: { param: key, value: sel.parse ? sel.parse(val) : val },
        }),
      );
      return;
    }
    // Registered toggle — dispatch event
    const tog = this._toggles[key];
    if (tog) {
      tog.el.dispatchEvent(
        new CustomEvent("knob-input", {
          bubbles: true,
          detail: { param: key, value: val },
        }),
      );
      return;
    }
    // Knob/slider — set value + dispatch event
    const knob = this._sliders[key];
    if (knob) {
      knob.value = val;
      knob.dispatchEvent(
        new CustomEvent("knob-input", {
          bubbles: true,
          detail: { param: key, value: val },
        }),
      );
    } else {
      // No UI control — direct write as fallback
      this._instrument[key] = val;
    }
  }
  /** Restore extra top-level fields (e.g. steps, chordSize). */
  _restoreExtra(obj) {}
}
