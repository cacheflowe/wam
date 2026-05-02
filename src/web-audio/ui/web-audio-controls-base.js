import "./web-audio-slider.js";
import { injectControlsCSS, createChannelStrip, createSection, createCtrl } from "./web-audio-slider.js";

/**
 * WebAudioControlsBase — shared foundation for all instrument control panels.
 *
 * Handles the universal boilerplate: CSS injection, channel strip (title/vol/pan/mute/meter),
 * waveform visualizer, expanded panel, FX unit, audio routing, slider event delegation,
 * preset management, and serialization.
 *
 * Subclasses implement `_buildControls()` to add their unique parameter sections,
 * and override hooks as needed for special behavior.
 *
 * Lifecycle:
 *   bind(instrument, ctx, options)
 *     → channel strip + waveform
 *     → _buildControls(controls, expanded, mkSlider, ctx, options)   [subclass]
 *     → slider listener
 *     → _createFxUnit()
 *     → _setupRouting()
 */
export class WebAudioControlsBase extends HTMLElement {
  constructor() {
    super();
    this._instrument = null;
    this._ctx = null;
    this._sliders = {};
    this._presetSelect = null;
    this._fxUnit = null;
    this._out = null;
    this._pan = null;
    this._panSlider = null;
    this._muteHandle = null;
    this._speedMultiplier = 1;
  }

  // ---- Override points for subclass identity ----

  /** Default accent color when none provided in options. */
  _defaultColor() { return "#0f0"; }

  /** Default channel strip title when none provided in options. */
  _defaultTitle() { return "Instrument"; }

  /** Title for the FX unit panel. */
  _fxTitle() { return "FX"; }

  // ---- Core bind ----

  bind(instrument, ctx, options = {}) {
    this._instrument = instrument;
    this._ctx = ctx;
    const color = options.color || this._defaultColor();
    this.innerHTML = "";
    this._sliders = {};
    this.classList.add("wac-panel");
    injectControlsCSS();
    this.style.setProperty("--slider-accent", color);
    this.style.setProperty("--fx-accent", color);

    // Channel strip — always visible
    const strip = createChannelStrip(this, {
      title: options.title || this._defaultTitle(),
      getOutGain: () => this._out,
      initialVol: instrument.volume,
      initialPan: 0,
    });
    this._muteHandle = { isMuted: strip.isMuted, setMuted: strip.setMuted, setPreMuteVolume: strip.setPreMuteVolume };
    this._sliders["volume"] = strip.volSlider;
    this._panSlider = strip.panSlider;

    // Waveform — always visible
    const waveform = document.createElement("web-audio-waveform");
    this.appendChild(waveform);

    // Expanded panel — hidden when collapsed
    const expanded = document.createElement("div");
    expanded.className = "wac-expanded";
    this.appendChild(expanded);

    // Controls wrapper inside expanded
    const controls = document.createElement("div");
    controls.className = "wac-controls";
    expanded.appendChild(controls);

    // Slider factory — creates a web-audio-slider, registers in _sliders, returns element
    const mkSlider = (def) => {
      const s = document.createElement("web-audio-slider");
      s.setAttribute("param", def.param);
      s.setAttribute("label", def.label);
      s.setAttribute("min", def.min);
      s.setAttribute("max", def.max);
      s.setAttribute("step", def.step);
      if (def.scale) s.setAttribute("scale", def.scale);
      const tooltip = def.tooltip
        ?? (this.constructor.SLIDER_DEFS || []).find(d => d.param === def.param)?.tooltip;
      if (tooltip) s.setAttribute("data-tooltip", tooltip);
      s.value = instrument[def.param];
      this._sliders[def.param] = s;
      return s;
    };

    // Subclass hook — add sections, sequencer, action buttons, etc.
    this._buildControls(controls, expanded, mkSlider, ctx, options);

    // Delegated slider-input listener
    this.addEventListener("slider-input", (e) => {
      if (!this._instrument) return;
      const { param, value } = e.detail;
      if (param === "volume") {
        if (this._muteHandle?.isMuted()) {
          // While muted, update the stored volume so unmute restores it
          this._muteHandle.setPreMuteVolume(value);
        } else {
          if (this._out) this._out.gain.value = value;
        }
        e.stopPropagation();
      } else if (param === "pan") {
        if (this._pan) this._pan.pan.value = value;
        e.stopPropagation();
      } else {
        this._onSliderInput(param, value);
      }
    });

    // FX unit (inside expanded, overridable — 808 returns null)
    this._fxUnit = this._createFxUnit(expanded, ctx, options);

    // Audio routing
    this._setupRouting(instrument, ctx, strip, waveform, color);
  }

  // ---- Subclass hooks ----

  /**
   * Build the instrument-specific controls (sections, sequencer, action buttons).
   * Called during bind() after the expanded panel is created.
   * @param {HTMLElement} controls  The .wac-controls div inside the expanded panel
   * @param {HTMLElement} expanded  The .wac-expanded div (for appending sequencer etc.)
   * @param {function} mkSlider     Factory: mkSlider({ param, label, min, max, step, scale? }) → HTMLElement
   * @param {AudioContext} ctx
   * @param {object} options        The full options passed to bind()
   */
  _buildControls(controls, expanded, mkSlider, ctx, options) {
    // Override in subclass
  }

  /** Handle a non-pan slider value change. Default: set on instrument. */
  _onSliderInput(param, value) {
    this._instrument[param] = value;
  }

  /** Sync non-slider controls after preset change (wave buttons, selects, etc.). */
  _syncExtraControls() {}

  // ---- FX unit ----

  /** Create and return the FX unit element. Override to return null (808). */
  _createFxUnit(expanded, ctx, options) {
    const fxUnit = document.createElement("web-audio-fx-unit");
    expanded.appendChild(fxUnit);
    fxUnit.init(ctx, {
      title: this._fxTitle(),
      bpm: options.fx?.bpm ?? 120,
      ...options.fx,
    });
    return fxUnit;
  }

  // ---- Audio routing ----

  /** Wire instrument → FX → _out → _pan, plus waveform + meter analysers. */
  _setupRouting(instrument, ctx, strip, waveform, color) {
    this._out = ctx.createGain();
    this._out.gain.value = instrument.volume;
    if (this._fxUnit) {
      instrument.connect(this._fxUnit.input);
      this._fxUnit.connect(this._out);
    } else {
      instrument.connect(this._out);
    }
    this._pan = ctx.createStereoPanner();
    this._out.connect(this._pan);
    const analyser = ctx.createAnalyser();
    this._out.connect(analyser);
    const meterAnalyser = ctx.createAnalyser();
    meterAnalyser.fftSize = 256;
    this._out.connect(meterAnalyser);
    strip.meter.setAnalyser(meterAnalyser);
    waveform.init(analyser, color);
  }

  // ---- Shared UI builders ----

  /**
   * Build a preset <select> from a PRESETS object and append to container.
   * Stores the element as this._presetSelect.
   * @param {object} PresetsObj  e.g. WebAudioSynthMono.PRESETS
   * @param {HTMLElement} appendTo
   */
  _makePresetDropdown(PresetsObj, appendTo) {
    this._presetSelect = document.createElement("select");
    this._presetSelect.className = "wac-select";
    for (const name of Object.keys(PresetsObj)) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name.replace(/_/g, " ");
      this._presetSelect.appendChild(opt);
    }
    this._presetSelect.addEventListener("change", () => {
      this.applyPreset(this._presetSelect.value);
      this._emitChange();
    });
    appendTo.appendChild(this._presetSelect);
    return this._presetSelect;
  }

  /**
   * Build oscillator-type toggle buttons (SAW/SQR/TRI/SIN).
   * Stores the row element as this._waveRow for _syncExtraControls().
   * @param {string[]} types  e.g. ["sawtooth","square","triangle","sine"]
   * @param {HTMLElement} appendTo
   */
  _makeWaveRow(types, appendTo) {
    this._waveRow = document.createElement("div");
    this._waveRow.className = "wac-wave-row";
    for (const type of types) {
      const btn = document.createElement("button");
      btn.className = "wac-wave-btn";
      btn.textContent = type.slice(0, 3).toUpperCase();
      btn.dataset.type = type;
      if (this._instrument.oscType === type) btn.classList.add("wac-wave-active");
      btn.addEventListener("click", () => {
        this._instrument.oscType = type;
        this._waveRow
          .querySelectorAll(".wac-wave-btn")
          .forEach((b) => b.classList.toggle("wac-wave-active", b.dataset.type === type));
      });
      this._waveRow.appendChild(btn);
    }
    appendTo.appendChild(this._waveRow);
    return this._waveRow;
  }

  /** Sync wave-row button active state to instrument.oscType. */
  _syncWaveRow() {
    if (!this._waveRow || !this._instrument) return;
    this._waveRow
      .querySelectorAll(".wac-wave-btn")
      .forEach((b) => b.classList.toggle("wac-wave-active", b.dataset.type === this._instrument.oscType));
  }

  // ---- Preset management ----

  applyPreset(name) {
    if (!this._instrument) return;
    this._instrument.applyPreset(name);
    this._syncSliders();
    if (this._presetSelect) this._presetSelect.value = name;
    this._syncExtraControls();
  }

  /** Update all registered sliders from instrument state. */
  _syncSliders() {
    for (const def of this.constructor.SLIDER_DEFS || []) {
      const slider = this._sliders[def.param];
      if (slider && this._instrument) slider.value = this._instrument[def.param];
    }
    // Keep controls output gain in sync with instrument volume
    if (this._out && this._instrument) this._out.gain.value = this._instrument.volume;
  }

  // ---- Serialization ----

  _emitChange() {
    this.dispatchEvent(new CustomEvent("controls-change", { bubbles: true }));
  }

  toJSON() {
    if (!this._instrument) return null;
    const params = {};
    for (const def of this.constructor.SLIDER_DEFS || []) {
      // Volume lives on controls._out, not on the instrument
      params[def.param] = def.param === "volume"
        ? (this._out?.gain.value ?? 1)
        : this._instrument[def.param];
    }
    this._extraToJSON(params);
    const obj = {
      params,
      fx: this._fxUnit?.toJSON(),
      muted: this._muteHandle?.isMuted() ?? false,
      pan: this._pan?.pan.value ?? 0,
      speedMultiplier: this._speedMultiplier,
    };
    this._extendJSON(obj);
    return obj;
  }

  /** Add extra params to the params dict (e.g. oscType, lfoShape). */
  _extraToJSON(params) {}

  /** Add extra top-level fields to the JSON (e.g. steps, chordSize). */
  _extendJSON(obj) {}

  fromJSON(obj) {
    if (!obj || !this._instrument) return;
    if (obj.params) {
      for (const [key, val] of Object.entries(obj.params)) {
        this._restoreParam(key, val);
      }
    }
    this._restoreExtra(obj);
    if (obj.fx) this._fxUnit?.fromJSON(obj.fx);
    if (obj.muted != null) this._muteHandle?.setMuted(obj.muted);
    if (obj.pan != null && this._pan) {
      this._pan.pan.value = obj.pan;
      if (this._panSlider) this._panSlider.value = obj.pan;
    }
    if (obj.speedMultiplier != null) this._speedMultiplier = obj.speedMultiplier;
  }

  /** Restore a single param. Override for special handling (e.g. oscType → wave buttons). */
  _restoreParam(key, val) {
    if (key === "volume") {
      if (this._out) this._out.gain.value = val;
    } else {
      this._instrument[key] = val;
    }
    if (this._sliders[key]) this._sliders[key].value = val;
  }

  /** Restore extra top-level fields (e.g. steps, chordSize). */
  _restoreExtra(obj) {}

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
    this._globalStep = 0;
    this._seqPosition = 0;
  }

  /** Hide or show the step sequencer UI. */
  set showSequencer(v) {
    this.toggleAttribute("data-no-sequencer", !v);
  }

  connect(node) {
    (this._pan ?? this._out)?.connect(node.input ?? node);
    return this;
  }

  disconnect() {
    (this._pan ?? this._out)?.disconnect();
  }
}

// Re-export UI helpers for subclass use
export { createSection, createCtrl };
