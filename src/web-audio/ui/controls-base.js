import "./slider.js";
import { CHANNEL_STRIP_COLLAPSED_DEFAULT, createChannelStrip, createCtrl, createSection, injectControlsCSS } from "./controls-factory.js";
import { Channel } from "../global/channel.js";
import { PatternTrack } from "../global/pattern-track.js";
import { applyInputLearnMixin, injectInputLearnCSS } from "./input-learn.js";
import { installMethods } from "./controls/install.js";
import { SequencerUI } from "./controls/sequencer-ui.js";
import { Playback } from "./controls/playback.js";
import { EvolveControls } from "./controls/evolve.js";
import { JamControls } from "./controls/jam.js";
import { PresetControls } from "./controls/presets.js";
import { SoundDesignControls } from "./controls/sound-design-ui.js";
import { SerializationControls } from "./controls/serialization.js";

/**
 * WebAudioControlsBase — shared foundation for all instrument control panels.
 *
 * Handles the universal boilerplate: CSS injection, channel strip (title/vol/pan/mute/solo/meter),
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
  /** Shared registry of all live controls instances for solo coordination. */
  static _soloInstances = new Set();

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
    this._soloHandle = null;
    this._channelStripVolSlider = null;
    this._jamPending = false;
    this._speedMultiplier = 1;
    this._speedSelect = null;
    this._densityInput = null;
    this._rotateInput = null;
    this._rotateIntervalInput = null;
    this._waveSelect = null;
    this._waveSelectProp = "oscType";
    this._selects = {}; // param → { el, parse? } for registered <select> controls
    this._toggles = {}; // param → { el, activeClass } for registered toggle buttons
    // Section toggle buttons and their target sections
    this._ctrlBtn = null;
    this._seqBtn = null;
    this._fxBtn = null;
    this._ctrlSection = null;
    this._seqSection = null;
    this._seqControls = null;
    this._fxSection = null;
    // Jam button and bound key
    this._jamBtn = null;
    this._jamBinding = null; // single trigger binding from any source (keyboard, MIDI, …)
    this._jamLearning = false;
    this._stopJamLearn = null;
    this._initInputLearnState();
    // Keyboard jam handlers - cleared and re-registered on each bind()
    this._jamKeyHandlers = [];
    // Sequencer (shared across all sequenced instruments)
    this._seq = null;
    this._tick = 0; // fallback tick counter when no clock is attached (tests, standalone)
    /** Global Clock (global/clock.js). When set, pattern position comes from clock.current.tick. */
    this.clock = null;
    this._track = new PatternTrack();
    this._lastPlayedIndex = -1;
    // Multi-pattern system
    this._patterns = null;   // { A: {steps}, B: {steps}, C: {steps}, D: {steps} }
    this._chain = [0];       // indices into pattern names [A,B,C,D]
    this._chainPosition = 0; // current position within the chain
    this._playingPattern = 'A'; // currently playing pattern (for UI indicator)
  }

  disconnectedCallback() {
    for (const h of this._jamKeyHandlers) document.removeEventListener("keydown", h);
    this._jamKeyHandlers = [];
    this._teardownInputLearn();
    WebAudioControlsBase._soloInstances.delete(this);
    WebAudioControlsBase._applySolo();
  }

  // ---- Override points for subclass identity ----

  /** Default accent color when none provided in options. */
  _defaultColor() {
    return "#0f0";
  }

  /** Default channel strip title when none provided in options. */
  _defaultTitle() {
    return "Instrument";
  }

  /** Title for the FX unit panel. */
  _fxTitle() {
    return "FX";
  }

  /**
   * Re-evaluate solo state across all live controls instances.
   * If any instance is soloed, suppress all non-soloed (and non-muted) channels.
   * When no instance is soloed, restore everyone.
   */
  static _applySolo() {
    const instances = [...WebAudioControlsBase._soloInstances];
    const anySoloed = instances.some((c) => c._soloHandle?.isSoloed());
    for (const c of instances) {
      const soloed = c._soloHandle?.isSoloed();
      c._soloHandle?.applySoloSuppress(anySoloed && !soloed);
    }
  }

  // ---- Core bind ----

  bind(instrument, ctx, options = {}) {
    this._instrument = instrument;
    this._ctx = ctx;

    // Wrap trigger methods to emit a visual notification event
    this._wrapTrigger(instrument);

    const color = options.color || this._defaultColor();
    this.innerHTML = "";
    this._sliders = {};
    this._selects = {};
    this._toggles = {};
    this.classList.add("wam-panel");
    injectControlsCSS();
    injectInputLearnCSS();
    this.style.setProperty("--slider-accent", color);
    this.style.setProperty("--fx-accent", color);

    // Channel strip — always visible, no global collapse (sections toggle independently)
    // The audio channel (instrument → FX → fader → pan); the strip is its UI.
    this._channel = new Channel(ctx, { volume: instrument.volume });
    const strip = createChannelStrip(this, {
      title: options.title || this._defaultTitle(),
      channel: this._channel,
      initialVol: instrument.volume,
      initialPan: 0,
      noCollapse: false,
    });
    this._stripEl = strip.strip;

    // Collapse is the panel's concern, not the strip's. Apply the default state
    // and toggle it when the strip requests it (click on title → strip-collapse-toggle).
    // The listener lives on `this` (persistent across re-binds), so guard it.
    // Interaction flow (title click is the only way to expand/collapse/focus):
    //   click: strip-collapse-toggle dispatched by the factory
    //     → if collapsed: dispatch wam-instrument-focus (closes others, sets wam-focused),
    //       then expand all sections. Playground scrolls.
    //     → if expanded: collapse all sections. No focus change.
    if (CHANNEL_STRIP_COLLAPSED_DEFAULT) {
      this.setAttribute("data-collapsed", "");
    }
    if (!this._collapseWired) {
      this._collapseWired = true;
      this.addEventListener("strip-collapse-toggle", (e) => {
        // While expanded, a click on the live waveform cycles its display mode
        // rather than collapsing. When collapsed, any click expands.
        if (!this.hasAttribute("data-collapsed") && e.detail?.onWaveform) return;

        if (this.hasAttribute("data-collapsed")) {
          // Expanding — dispatch focus so the app collapses all other
          // instruments and scrolls this one into view.
          this.dispatchEvent(
            new CustomEvent("wam-instrument-focus", { bubbles: true, detail: { controls: this } }),
          );
          // Expand our sections. (Playground's synchronous focus handler already
          // called setAllPanels(true), but calling again is idempotent.)
          this.removeAttribute("data-collapsed");
          this.setAllPanels(true);
          // Scroll only if no focus manager is present (standalone use without wam-focused).
          if (!this.classList.contains("wam-focused")) {
            this.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        } else {
          // Collapsing — hide all three sections.
          this.setAttribute("data-collapsed", "");
          this.setAllPanels(false);
        }
      });
    }

    this._muteHandle = {
      isMuted: strip.isMuted,
      setMuted: strip.setMuted,
      toggleMuted: strip.toggleMuted,
      setPreMuteVolume: strip.setPreMuteVolume,
      setVolume: strip.setVolume,
      getVolume: strip.getVolume,
    };
    this._soloHandle = {
      isSoloed: strip.isSoloed,
      setSoloed: strip.setSoloed,
      applySoloSuppress: strip.applySoloSuppress,
    };
    WebAudioControlsBase._soloInstances.add(this);
    this.addEventListener("solo-change", () => WebAudioControlsBase._applySolo());
    this._channelStripVolSlider = strip.volSlider;
    this._sliders["volume"] = strip.volSlider;
    this._panSlider = strip.panSlider;
    this._wireInputLearn(strip.volSlider, "volume");
    if (strip.panSlider) {
      this._sliders["pan"] = strip.panSlider;
      this._wireInputLearn(strip.panSlider, "pan");
    }

    // Clear any jam key handlers registered by a previous bind() call
    for (const h of this._jamKeyHandlers) document.removeEventListener("keydown", h);
    this._jamKeyHandlers = [];

    // Ctrl / Seq / FX section toggle buttons
    const mkToggle = (label, tooltip) => {
      const btn = document.createElement("button");
      btn.className = "wam-toggle-btn";
      btn.textContent = label;
      btn.title = tooltip;
      return btn;
    };
    this._ctrlBtn = mkToggle("Ctrl", "Show/hide instrument parameters");
    this._seqBtn = mkToggle("Seq", "Show/hide step sequencer");
    this._fxBtn = mkToggle("FX", "Show/hide effects chain");
    const navWrap = createCtrl("Panels", { tooltip: "Toggle instrument UI sections." });
    const navBtns = document.createElement("div");
    navBtns.style.cssText = "display:flex;gap:4px;";
    navBtns.appendChild(this._ctrlBtn);
    navBtns.appendChild(this._seqBtn);
    navBtns.appendChild(this._fxBtn);
    navWrap.appendChild(navBtns);
    strip.navGroup.appendChild(navWrap);

    // Waveform lives in the viz group alongside the level meter
    const waveform = document.createElement("wam-waveform");
    strip.vizGroup.appendChild(waveform);

    this._buildStripActions(strip.jamGroup, options);
    this._attachInputLearn();

    // Combined Ctrl+FX section: a single grid where instrument knobs and FX
    // sections flow in columns side by side. Ctrl and FX sections toggle
    // independently via data-hide-ctrl/data-hide-fx (see CSS in
    // controls-factory.js, keyed off FX sections' own data-fx-section marker).
    // data-hidden is derived from those two — the row only fully collapses
    // (border/padding gone) once both are hidden.
    this._topSection = document.createElement("div");
    this._topSection.className = "wam-section-top";
    this._topSection.setAttribute("data-hide-ctrl", "");
    this._topSection.setAttribute("data-hide-fx", "");
    this._topSection.setAttribute("data-hidden", ""); // default: both hidden
    this.appendChild(this._topSection);

    // Single grid container — Ctrl sections and FX sections flow in columns.
    this._topControls = document.createElement("div");
    this._topControls.className = "wam-controls";
    this._topSection.appendChild(this._topControls);

    // Sequencer — independent toggle, sits below the Ctrl+FX row.
    this._seqSection = document.createElement("div");
    this._seqSection.className = "wam-section-seq";
    this._seqSection.setAttribute("data-hidden", ""); // default: hidden
    this.appendChild(this._seqSection);

    // Sequencer wrapper matches Ctrl padding/layout
    this._seqControls = document.createElement("div");
    this._seqControls.className = "wam-controls";
    this._seqSection.appendChild(this._seqControls);

    // Wire toggle buttons.
    // Ctrl and FX each toggle their own subset of the shared Ctrl+FX row.
    // Seq toggles the sequencer independently.
    const wireToggle = (btn, section) => {
      btn.addEventListener("click", () => {
        const nowHidden = section.hasAttribute("data-hidden");
        section.toggleAttribute("data-hidden", !nowHidden);
        btn.toggleAttribute("data-active", nowHidden);
        this._emitChange();
      });
    };
    wireToggle(this._seqBtn, this._seqSection);
    this._ctrlBtn.addEventListener("click", () => {
      this._applyTopSectionPart("ctrl", this._topSection.hasAttribute("data-hide-ctrl"));
      this._emitChange();
    });
    this._fxBtn.addEventListener("click", () => {
      this._applyTopSectionPart("fx", this._topSection.hasAttribute("data-hide-fx"));
      this._emitChange();
    });

    // Slider factory — creates a wam-slider or wam-knob, registers in _sliders, returns element.
    // Accepts a full def, or a param name (+ optional overrides like a section-specific
    // label) looked up in SLIDER_DEFS so each param is declared once, in the schema.
    const mkSlider = (defOrParam, overrides = null) => {
      let def = defOrParam;
      if (typeof defOrParam === "string") {
        const found = (this.constructor.SLIDER_DEFS || []).find((d) => d.param === defOrParam);
        if (!found) throw new Error(`[WAM] mkSlider: no SLIDER_DEFS entry for "${defOrParam}"`);
        def = overrides ? { ...found, ...overrides } : found;
      }
      const tag = def.knob === false ? "wam-slider" : "wam-knob";
      const s = document.createElement(tag);
      s.setAttribute("param", def.param);
      s.setAttribute("label", def.label);
      s.setAttribute("min", def.min);
      s.setAttribute("max", def.max);
      s.setAttribute("step", def.step);
      if (def.scale) s.setAttribute("scale", def.scale);
      if (def.color) s.setAttribute("color", def.color);
      const tooltip = def.tooltip ?? (this.constructor.SLIDER_DEFS || []).find((d) => d.param === def.param)?.tooltip;
      if (tooltip) s.setAttribute("data-tooltip", tooltip);
      s.value = instrument[def.param];
      this._sliders[def.param] = s;
      this._wireInputLearn(s, def.param);
      return s;
    };

    // Subclass hook — _topControls is the shared grid for Ctrl + FX sections,
    // seqControls is passed as `expanded` for the step sequencer.
    this._buildPresetSection(this._topControls, instrument);
    this._buildControls(this._topControls, this._seqControls, mkSlider, ctx, options);
    this._attachSectionLocks(this._topControls);

    // Delegated slider-input / knob-input listener
    const handleInput = (e) => {
      if (!this._instrument) return;
      const { param, value } = e.detail;
      if (param === "volume") {
        this._channel.volume = value; // independent of mute/solo (derived gain)
        e.stopPropagation();
      } else if (param === "pan") {
        this._channel.pan = value;
        e.stopPropagation();
      } else {
        this._onSliderInput(param, value);
      }
      this._emitChange();
    };
    this.addEventListener("knob-input", handleInput);
    this.addEventListener("slider-input", handleInput);

    // FX unit — appended to the same grid as Ctrl sections. display:contents
    // lets its child .wam-section elements flow in columns alongside controls.
    this._fxUnit = this._createFxUnit(this._topControls, ctx, options);

    // Audio routing
    this._setupRouting(instrument, ctx, strip, waveform, color);

    // Synchronize pattern data between UI and Instrument.
    if (this._seq) {
      // UI -> Instrument: when user edits a step in the UI
      this._seq.addEventListener("step-change", (e) => {
        if (e.detail.rotated) return;
        const { index, step } = e.detail;
        if (index !== undefined && step) {
          const newSteps = [...this._instrument.steps];
          newSteps[index] = { ...(newSteps[index] ?? {}), ...step }; // keep fields the grid doesn't show
          this._instrument.steps = newSteps;
        }
      });

      // Instrument -> UI: when the instrument's steps change (e.g. randomize)
      this._instrument.addEventListener("steps-changed", (e) => {
        this._seq.steps = e.detail.steps;
        this._syncPatternEdit();
      });
    }
  }

  // ---- Subclass hooks ----

  /**
   * Build the instrument-specific controls (sections, sequencer, action buttons).
   * Called during bind() after the expanded panel is created.
   * @param {HTMLElement} controls  The .wam-controls div inside the expanded panel
   * @param {HTMLElement} expanded  The .wam-expanded div (for appending sequencer etc.)
   * @param {function} mkSlider     Factory: mkSlider({ param, label, min, max, step, scale? }) → HTMLElement
   * @param {AudioContext} ctx
   * @param {object} options        The full options passed to bind()
   */
  _buildControls(controls, expanded, mkSlider, ctx, options) {
    // Override in subclass
  }

  /**
   * Inject buttons into the always-visible channel strip.
   * Default: single quantized jam trigger. Override in subclass (e.g. loop player).
   *
   * Key-learn: hold the jam button and press any key to bind it as the jam shortcut.
   */
  _buildStripActions(strip, options = {}) {
    const btn = document.createElement("button");
    btn.className = "wam-jam-btn";
    btn.addEventListener("click", () => this._queueJam());
    strip.appendChild(btn);
    this._jamBtn = btn;

    // Single jam binding from any source. Default: the instrument's jam key,
    // expressed as a keyboard binding so it flows through the same input path.
    const key = options.jamKey ?? this._defaultJamKey();
    this._jamBinding = options.jamMidi ?? (key ? { source: "keyboard", key: String(key).toLowerCase() } : null);
    this._updateJamLabel();

    // Learn: hold the button, then press any key / move any control. The actual
    // binding is captured in _handleControlInput (which sees every source);
    // here we just toggle the learning flag + visual.
    const stopLearn = () => {
      if (!this._jamLearning) return;
      this._jamLearning = false;
      btn.classList.remove("wam-jam-learning");
    };
    this._stopJamLearn = stopLearn;

    btn.addEventListener("pointerdown", () => {
      this._jamLearning = true;
      btn.classList.add("wam-jam-learning");
    });
    btn.addEventListener("pointerup", stopLearn);
    btn.addEventListener("pointercancel", stopLearn);
    btn.addEventListener("pointerleave", stopLearn);
  }

  get _learnRegistry() {
    return this._sliders;
  }

  /** Handle a non-pan slider value change. Default: set on instrument. */
  _onSliderInput(param, value) {
    this._instrument[param] = value;
    // Sync registered select value
    const sel = this._selects[param];
    if (sel) sel.el.value = value;
    // Sync registered toggle active class
    const tog = this._toggles[param];
    if (tog) tog.el.classList.toggle(tog.activeClass, !!value);
  }

  /** Sync non-slider controls after preset change (wave buttons, selects, etc.). */
  _syncExtraControls() {}

  /**
   * Register a <select> element for a given param.
   * Wires up change → knob-input dispatch automatically.
   * @param {string} param  The instrument property name
   * @param {HTMLSelectElement} el  The <select> element
   * @param {{ parse?: function }} [opts]  Optional value parser (e.g. parseFloat)
   */
  _registerSelect(param, el, { parse } = {}) {
    this._selects[param] = { el, parse };
    el.addEventListener("change", () => {
      const raw = el.value;
      const value = parse ? parse(raw) : raw;
      el.dispatchEvent(
        new CustomEvent("knob-input", {
          bubbles: true,
          detail: { param, value },
        }),
      );
    });
  }

  /**
   * Register a toggle button for a given param.
   * Wires up click → knob-input dispatch automatically.
   * @param {string} param  The instrument property name
   * @param {HTMLElement} el  The toggle button element
   * @param {string} [activeClass]  CSS class toggled on active state (default: "wam-wave-active")
   */
  _registerToggle(param, el, activeClass = "wam-wave-active") {
    this._toggles[param] = { el, activeClass };
    el.addEventListener("click", () => {
      const newVal = !this._instrument[param];
      el.dispatchEvent(
        new CustomEvent("knob-input", {
          bubbles: true,
          detail: { param, value: newVal },
        }),
      );
    });
  }

  // ---- FX unit ----

  /** Create and return the FX unit element. Override to return null (808). */
  _createFxUnit(fxSection, ctx, options) {
    const fxUnit = document.createElement("wam-fx-unit");
    fxSection.appendChild(fxUnit);
    fxUnit.init(ctx, {
      title: this._fxTitle(),
      bpm: options.fx?.bpm ?? 120,
      ...options.fx,
    });
    return fxUnit;
  }

  // ---- Audio routing ----

  /** Wire instrument → FX → _preFader → _out → _pan, plus waveform + meter analysers. */
  _setupRouting(instrument, ctx, strip, waveform, color) {
    const ch = this._channel;
    ch.setFx(this._fxUnit?.chain ?? null);
    ch.attach(instrument);
    // Aliases kept for existing readers (bus taps, analysis bus, connect()).
    this._preFader = ch.preFader; // post-FX, pre-volume/mute — bus sends tap here
    this._out = ch.post; // post-fader (meters / waveform)
    this._pan = ch.panner;

    const analyser = ctx.createAnalyser();
    ch.post.connect(analyser);
    this._analyser = analyser;
    const meterAnalyser = ctx.createAnalyser();
    meterAnalyser.fftSize = 256;
    ch.post.connect(meterAnalyser);
    this._meterAnalyser = meterAnalyser;
    strip.meter.setAnalyser(meterAnalyser);
    waveform.init(analyser, color, { fixed: true });
  }

  /** Post-FX, pre-volume tap point. Connect bus sends here so muting doesn't kill the tap. */
  get preFaderOutput() {
    return this._preFader;
  }

  /** Show/hide one section and sync its toggle button's active state. */
  _applyPanel(section, btn, visible) {
    if (!section || !btn) return;
    section.toggleAttribute("data-hidden", !visible);
    btn.toggleAttribute("data-active", visible);
  }

  /**
   * Show/hide the Ctrl or FX subset of the shared top section and sync its
   * toggle button. data-hidden on the row itself is derived from both flags —
   * the row (border/padding) only fully collapses once both are hidden.
   * @param {"ctrl"|"fx"} kind
   * @param {boolean} visible
   */
  _applyTopSectionPart(kind, visible) {
    if (!this._topSection) return;
    const attr = kind === "ctrl" ? "data-hide-ctrl" : "data-hide-fx";
    const btn = kind === "ctrl" ? this._ctrlBtn : this._fxBtn;
    this._topSection.toggleAttribute(attr, !visible);
    btn?.toggleAttribute("data-active", visible);
    const bothHidden = this._topSection.hasAttribute("data-hide-ctrl") && this._topSection.hasAttribute("data-hide-fx");
    this._topSection.toggleAttribute("data-hidden", bothHidden);
  }

  /**
   * Show or hide all sections (Ctrl+FX row, Seq) at once. Used to emphasize
   * the focused instrument (expand all) and de-emphasize the rest (collapse
   * all) so the active one stands out.
   */
  setAllPanels(visible) {
    this._applyTopSectionPart("ctrl", visible);
    this._applyTopSectionPart("fx", visible);
    this._applyPanel(this._seqSection, this._seqBtn, visible);
  }

  /**
   * Channel-strip collapse state. Setting it keeps the collapse layer
   * (`data-collapsed`) in sync with focus-driven expansion, so the strip click
   * and the app's focus handler never disagree about whether a panel is open.
   */
  get collapsed() {
    return this.hasAttribute("data-collapsed");
  }

  set collapsed(v) {
    this.toggleAttribute("data-collapsed", !!v);
  }

  connect(node) {
    (this._pan ?? this._out)?.connect(node.input ?? node);
    return this;
  }

  /** Forward the host track's bus id to the FX sidechain picker so it can't sidechain off itself. */
  setSidechainHostId(id) {
    this._fxUnit?.setSidechainHostId?.(id);
  }

  disconnect() {
    this._fxUnit?.destroy?.();
    (this._pan ?? this._out)?.disconnect();
  }
}

// Feature methods live in ./controls/*.js (Phase 3 split); install them onto
// the base prototype. Subclasses still override any of them normally.
// Before the input-learn mixin: it only fills in methods the class lacks, and
// JamControls overrides _handleControlInput / _onInputExtra.
installMethods(WebAudioControlsBase, [SequencerUI, Playback, EvolveControls, JamControls, PresetControls, SoundDesignControls, SerializationControls]);
applyInputLearnMixin(WebAudioControlsBase);

// Re-export UI helpers for subclass use
export { createSection, createCtrl };
