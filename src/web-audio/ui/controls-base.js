import "./slider.js";
import { bindingsEqual, formatBinding, migrateLegacyBinding } from "../input/input-bindings.js";
import {
  injectControlsCSS,
  createChannelStrip,
  createSection,
  createCtrl,
  CHANNEL_STRIP_COLLAPSED_DEFAULT,
} from "./controls-factory.js";
import { injectInputLearnCSS, InputLearnMixin, applyInputLearnMixin } from "./input-learn.js";
import { meetsBarCondition } from "../global/sequencer-conditions.js";
import {
  MUTATE_AMOUNTS,
  SoundHistory,
  captureValues,
  mutateValues,
  randomizeValues,
} from "../global/sound-design.js";
import { quantize } from "../global/param-schema.js";
import {
  canWritePresets,
  deletePresetFromRepo,
  presetParamDefs,
  presetTags,
  removePreset,
  savePresetToRepo,
  upsertPreset,
} from "../global/presets.js";

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
    this._seqPosition = 0;
    this._globalStep = 0;
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
    const strip = createChannelStrip(this, {
      title: options.title || this._defaultTitle(),
      getOutGain: () => this._out,
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
        if (this._muteHandle?.isMuted()) {
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
          newSteps[index] = { ...step };
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

  /** The instrument's step sequencer element, or null. */
  get sequencer() {
    return this._seq ?? null;
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
   */
  _notifyTrigger(velocity = 1) {
    this.dispatchEvent(new CustomEvent("wam-trigger", { bubbles: true, detail: { velocity: Math.min(1, velocity) } }));
  }

  /**
   * Wrap the instrument's trigger/triggerDrum methods so _notifyTrigger fires
   * automatically on every note, keeping instrument code DRY.
   */
  _wrapTrigger(instrument) {
    const self = this;
    for (const method of ["trigger", "triggerDrum"]) {
      const orig = instrument[method];
      if (typeof orig === "function") {
        instrument[method] = function (...args) {
          if (!self._muteHandle?.isMuted()) self._notifyTrigger();
          return orig.apply(this, args);
        };
      }
    }
  }

  // ---- Sequencer (base class wiring) ----

  /**
   * Create and wire the step sequencer UI. Called from _buildControls() by
   * subclasses that have a sequencer. Appends the step grid to `expanded`.
   * Override _seqInitOptions() to customize.
   * @param {HTMLElement} expanded  The .wam-controls div for the sequencer section
   * @param {string} color  Instrument accent color
   * @param {function|null} [onRandomize]  Callback for the randomize button
   */
  _createSequencer(expanded, color, onRandomize = null) {
    this._seq = document.createElement("wam-step-seq");
    this._seq._instrument = this._instrument;
    const baseOpts = this._seqInitOptions(color) || {};
    // Seed the instrument's canonical steps from the default pattern on first bind.
    if (!this._instrument.steps.length) {
      this._instrument.steps = baseOpts.steps ?? [];
    }
    const instrumentSteps = this._instrument.steps.map(s => ({ ...s }));
    const initOpts = {
      ...baseOpts,
      steps: instrumentSteps,
      onRandomize,
    };
    this._seq.init(initOpts);
    // Default to compact mode — most people want more steps visible at once
    // over seeing every per-step control. This is a real-time display
    // preference, not song data — it's intentionally not serialized, so it
    // always starts compact regardless of what a loaded song last had open.
    this._seq.compact = true;
    this._compactBtn?.toggleAttribute("data-active", true);

    // Initialize multi-pattern system
    this._patterns = {
      A: { steps: instrumentSteps },
      B: { steps: instrumentSteps.map(s => ({ ...s, active: false })) },
      C: { steps: instrumentSteps.map(s => ({ ...s, active: false })) },
      D: { steps: instrumentSteps.map(s => ({ ...s, active: false })) },
    };
    this._chain = [0];
    this._chainPosition = 0;
    this._playingPattern = 'A';

    expanded.appendChild(this._seq);

    // Build pattern tabs and chain bar
    this._buildPatternSelector(expanded, color);
    this._refreshAllMiniStrips();

    this._seq.addEventListener("step-change", () => {
      this._syncPatternEdit();
      this._emitChange();
    });
    this._seq.addEventListener("pattern-change", () => {
      const activeName = Object.entries(this._patternTabs)
        .find(([, tab]) => tab.hasAttribute("data-active"))?.[0];
      if (activeName) {
        this._playingPattern = activeName;
        this._emitChange();
      }
    });
  }

  /** Build pattern tab bar and chain bar UI. */
  _buildPatternSelector(container, color) {
    // Patterns | Chain | Actions as bordered cards in the same auto-fill grid
    // used by the Ctrl/FX sections — cards reflow onto their own rows on
    // narrow screens instead of the old single flex row bunching up.
    const patternRow = document.createElement("div");
    patternRow.className = "wam-pattern-row";

    // --- Pattern tabs ---
    const { el: tabsEl, controls: tabsGroup } = createSection("Patterns");
    tabsEl.querySelector(".wam-title").setAttribute("data-tooltip", "A/B/C/D — click to switch editing context");

    const tabs = document.createElement("div");
    tabs.className = "wam-pattern-tabs";

    const patternNames = ['A', 'B', 'C', 'D'];
    this._patternTabs = {};
    this._miniStripDots = {};

    patternNames.forEach(name => {
      const col = document.createElement("div");
      col.className = "wam-pattern-col";

      const tab = this._makeActionBtn();
      tab.className += " wam-pattern-tab";
      tab.textContent = name;
      tab.title = name + ' — click to edit';
      this._stylePatternTab(tab, name === 'A', false, color);
      tab.addEventListener("click", () => this._selectPattern(name));
      col.appendChild(tab);
      this._patternTabs[name] = tab;

      // Mini step-strip — a compact, always-visible, read-only preview of this
      // pattern's 16 steps. Lets you see every pattern at a glance instead of
      // only the one you happen to have selected for editing, and the playhead
      // dot shows which pattern is actually sounding during chained playback
      // even when it's not the one on screen in the big editable grid.
      const miniStrip = document.createElement("div");
      miniStrip.className = "wam-mini-strip";
      const dots = [];
      for (let i = 0; i < 16; i++) {
        const dot = document.createElement("span");
        dot.className = "wam-mini-dot";
        miniStrip.appendChild(dot);
        dots.push(dot);
      }
      col.appendChild(miniStrip);
      this._miniStripDots[name] = dots;

      tabs.appendChild(col);
    });

    tabsGroup.appendChild(tabs);
    patternRow.appendChild(tabsEl);

    // --- Chain bar ---
    const { el: chainEl, controls: chainGroup } = createSection("Chain");
    chainEl.querySelector(".wam-title").setAttribute(
      "data-tooltip",
      "Playback order — click pill to cycle, right-click to remove",
    );

    const chainBar = document.createElement("div");
    chainBar.className = "wam-chain-bar";
    this._chainBarEl = chainBar;

    this._chainPills = [];
    this._updateChainBar(color);
    chainGroup.appendChild(chainBar);
    patternRow.appendChild(chainEl);

    // --- Ops ---
    const { el: opsEl, controls: opsGroup } = createSection("Actions");
    opsEl.querySelector(".wam-title").setAttribute("data-tooltip", "⧉ copy to others  ✕ clear  ⇧ dup chain  ↺ reset");

    const opsCol = document.createElement("div");
    opsCol.className = "wam-pattern-ops";

    const copyBtn = this._makeActionBtn();
    copyBtn.textContent = "\u25c9";
    copyBtn.title = "Copy to others";
    copyBtn.addEventListener("click", () => this._copyActivePattern());
    opsCol.appendChild(copyBtn);

    const clearBtn = this._makeActionBtn();
    clearBtn.textContent = "\u2715";
    clearBtn.title = "Clear pattern";
    clearBtn.addEventListener("click", () => this._clearActivePattern());
    opsCol.appendChild(clearBtn);

    const dupChainBtn = this._makeActionBtn();
    dupChainBtn.textContent = "\u21e7";
    dupChainBtn.title = "Duplicate chain";
    dupChainBtn.addEventListener("click", () => this._duplicateChain());
    opsCol.appendChild(dupChainBtn);

    const resetBtn = this._makeActionBtn();
    resetBtn.textContent = "↺";
    resetBtn.title = "Reset to single pattern";
    resetBtn.addEventListener("click", () => this._resetChain());
    opsCol.appendChild(resetBtn);

    opsGroup.appendChild(opsCol);
    patternRow.appendChild(opsEl);

    // Insert before the sequencer grid
    container.insertBefore(patternRow, this._seq);
  }

  /** Create an action button matching wam-action-btn styles. */
  _makeActionBtn() {
    const btn = document.createElement("button");
    btn.className = "wam-action-btn";
    return btn;
  }

  /** Style a pattern tab. */
  _stylePatternTab(tab, isActive, isPlaying, color) {
    if (isActive) {
      tab.setAttribute("data-active", "");
    } else {
      tab.removeAttribute("data-active");
    }
    if (isPlaying) {
      tab.setAttribute("data-playing", "");
    } else {
      tab.removeAttribute("data-playing");
    }
  }

  /** Redraw one pattern's mini step-strip from its current step data. */
  _refreshMiniStrip(name) {
    const dots = this._miniStripDots?.[name];
    const steps = this._patterns?.[name]?.steps;
    if (!dots || !steps) return;
    dots.forEach((dot, i) => dot.toggleAttribute("data-on", !!steps[i]?.active));
  }

  /** Redraw every pattern's mini step-strip. */
  _refreshAllMiniStrips() {
    Object.keys(this._patternTabs || {}).forEach((name) => this._refreshMiniStrip(name));
  }

  /** Move the mini step-strip playhead dot to `index` on pattern `name`, clearing any other pattern's. */
  _setMiniStripPlayhead(name, index) {
    if (this._miniPlayheadPattern && this._miniPlayheadPattern !== name) {
      this._miniStripDots?.[this._miniPlayheadPattern]?.forEach((d) => d.removeAttribute("data-current"));
    }
    const dots = this._miniStripDots?.[name];
    if (!dots) return;
    dots.forEach((d, i) => d.toggleAttribute("data-current", i === index));
    this._miniPlayheadPattern = name;
  }

  /** Clear the mini step-strip playhead on stop/reset. */
  _clearMiniStripPlayhead() {
    if (!this._miniPlayheadPattern) return;
    this._miniStripDots?.[this._miniPlayheadPattern]?.forEach((d) => d.removeAttribute("data-current"));
    this._miniPlayheadPattern = null;
  }

  /** Update chain bar UI. */
  _updateChainBar(color) {
    const chainBar = this._chainBarEl;
    if (!chainBar) return;

    chainBar.innerHTML = '';
    this._chainPills = [];

    const patternNames = ['A', 'B', 'C', 'D'];

    this._chain.forEach((idx, pos) => {
      const pill = this._makeActionBtn();
      pill.className += " wam-chain-pill";

      const pillNum = document.createElement("span");
      pillNum.className = "wam-chain-num";
      pillNum.textContent = pos + 1;
      pill.appendChild(pillNum);
      pill.appendChild(document.createTextNode(patternNames[idx]));
      pill.title = 'Bar ' + (pos + 1) + ': ' + patternNames[idx] + ' (click to cycle, right-click to remove)';

      if (pos === this._chainPosition) {
        pill.setAttribute("data-playing", "");
      } else {
        pill.removeAttribute("data-playing");
      }

      pill.addEventListener("click", (e) => {
        e.stopPropagation();
        this._cycleChainEntry(pos);
      });

      const removeEntry = () => {
        if (this._chain.length <= 1) return;
        this._chain.splice(pos, 1);
        if (this._chainPosition >= this._chain.length) {
          this._chainPosition = this._chain.length - 1;
        }
        this._updateChainBar(color);
        this._emitChange();
      };

      // Right-click to remove (desktop shortcut)
      pill.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        removeEntry();
      });

      // Always-visible remove tap target (right-click has no touch equivalent)
      if (this._chain.length > 1) {
        const removeBtn = document.createElement("span");
        removeBtn.className = "wam-chain-remove";
        removeBtn.textContent = "×";
        removeBtn.title = "Remove from chain";
        removeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          removeEntry();
        });
        pill.appendChild(removeBtn);
      }

      chainBar.appendChild(pill);
      this._chainPills.push(pill);
    });

    // Add button
    const addBtn = this._makeActionBtn();
    addBtn.className += " wam-chain-add-btn";
    addBtn.textContent = "+";
    addBtn.title = "Add chain entry";
    addBtn.addEventListener("click", () => {
      if (this._chain.length < 16) {
        this._chain.push(0);
        this._updateChainBar(color);
        this._emitChange();
      }
    });
    chainBar.appendChild(addBtn);
  }

  /** Select which pattern to edit. */
  _selectPattern(name) {
    const color = this._defaultColor?.() || '#0f0';

    // Update tab styles with playing indicator
    Object.entries(this._patternTabs).forEach(([n, tab]) => {
      const tabIsPlaying = this._playingPattern === n;
      this._stylePatternTab(tab, n === name, tabIsPlaying, color);
    });

    // Sync sequencer to selected pattern. instrument.steps must track the
    // pattern being edited too — the UI->Instrument step-change listener reads
    // and rewrites *that* array, so leaving it stale here would mean editing
    // a step after switching patterns resets to whatever instrument.steps was
    // last (e.g. the pattern active when the instrument was first created).
    if (this._seq && this._patterns[name]) {
      this._seq.steps = this._patterns[name].steps;
      this._instrument.steps = this._patterns[name].steps.map(s => ({ ...s }));
    }
  }

  /** Sync current sequencer steps back to active pattern. Called on step-change. */
  _syncPatternEdit() {
    // Find which tab is currently active
    for (const [name, tab] of Object.entries(this._patternTabs)) {
      if (tab.hasAttribute("data-active")) {
        if (this._seq && this._patterns[name]) {
          // Deep copy so each pattern owns its own array.
          // Without this, randomize (which assigns a new array to
          // this._seq.steps) would leave old patterns pointing at stale data.
          this._patterns[name].steps = this._seq.steps.map(s => ({ ...s }));
          this._refreshMiniStrip(name);
        }
        break;
      }
    }
  }

  /** Cycle chain entry to next pattern. */
  _cycleChainEntry(pos) {
    this._chain[pos] = (this._chain[pos] + 1) % 4;
    this._updateChainBar(this._defaultColor?.() || '#0f0');
    this._emitChange();
  }

  /** Copy active pattern's steps to all other patterns. */
  _copyActivePattern() {
    const activeName = Object.entries(this._patternTabs)
      .find(([, tab]) => tab.hasAttribute("data-active"))?.[0];
    if (!activeName || !this._patterns) return;

    const sourceSteps = this._patterns[activeName].steps.slice();
    ['A', 'B', 'C', 'D'].forEach(name => {
      if (name !== activeName) {
        this._patterns[name].steps = sourceSteps.map(s => ({ ...s }));
      }
    });
    if (this._seq) this._seq.steps = sourceSteps;
    this._refreshAllMiniStrips();
    this._emitChange();
  }

  /** Clear active pattern (set all steps inactive). */
  _clearActivePattern() {
    const activeName = Object.entries(this._patternTabs)
      .find(([, tab]) => tab.hasAttribute("data-active"))?.[0];
    if (!activeName || !this._patterns) return;

    this._patterns[activeName].steps = this._patterns[activeName].steps.map(s => ({
      ...s, active: false
    }));
    if (this._seq) this._seq.steps = this._patterns[activeName].steps;
    this._instrument.steps = this._patterns[activeName].steps.map(s => ({ ...s }));
    this._refreshMiniStrip(activeName);
    this._emitChange();
  }

  /** Duplicate the entire chain (append a copy). */
  _duplicateChain() {
    if (this._chain.length + this._chain.length > 16) return;
    this._chain = this._chain.concat([...this._chain]);
    this._updateChainBar(this._defaultColor?.() || '#0f0');
    this._emitChange();
  }

  /** Reset chain to single pattern A. */
  _resetChain() {
    this._chain = [0];
    this._chainPosition = 0;
    this._playingPattern = 'A';
    this._updateChainBar(this._defaultColor?.() || '#0f0');
    this._updateTabPlayingIndicators(this._defaultColor?.() || '#0f0');
    // Select A tab
    this._selectPattern('A');
    this._emitChange();
  }

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
    return this._queuedPattern != null ? ["A", "B", "C", "D"][this._queuedPattern] : null;
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
    const idx = ["A", "B", "C", "D"].indexOf(name);
    if (idx < 0 || !this._patterns?.[name]) return;
    this._queuedPattern = idx;
    if (this._seqPosition % 16 === 0) this._applyQueuedPattern();
    else this.dispatchEvent(new CustomEvent("pattern-queued", { bubbles: true, detail: { name } }));
  }

  _applyQueuedPattern() {
    const idx = this._queuedPattern;
    this._queuedPattern = null;
    const name = ["A", "B", "C", "D"][idx];
    this._chain = [idx];
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

  /** Randomize the step pattern (instrument-specific generators). */
  randomizePattern() {
    if (typeof this.randomize === "function" && this._seq) this.randomize();
  }

  /** Channel-strip volume (pre-mute), 0..1. */
  get volume() {
    return this._muteHandle?.getVolume() ?? 1;
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

  _updateTabPlayingIndicators(color) {
    Object.entries(this._patternTabs).forEach(([n, tab]) => {
      const tabIsPlaying = this._playingPattern === n;
      const isActive = tab.hasAttribute("data-active");
      this._stylePatternTab(tab, isActive, tabIsPlaying, color);
    });
  }

  /**
   * Override to return step-seq init options. Called by _createSequencer().
   * Return null to skip sequencer creation (e.g. loop player, vocoder).
   * @param {string} color
   * @returns {object|null}
   */
  _seqInitOptions(color) {
    return null;
  }

  /**
   * Called by the base step() when the pattern completes a full cycle and
   * rotation is active.
   * @param {number} offset  Rotation offset from pattern params
   */
  _seqRotate(offset) {
    this._seq?.rotate(offset);
  }

  /**
   * Base sequencer step handler. Called on each global tick.
   * Handles: speed multiplier, bar density, rotation, probability, ratchet, conditions.
   * Calls instrument.triggerSequenceStep() for active steps, _triggerJam() if pending.
   * Subclasses that need custom timing logic can override, but most should not.
   *
   * @param {boolean} [isManual]  Bypass playback counters and fire this exact step
   *   immediately (e.g. a UI preview click) instead of advancing the sequence.
   */
  step(index, time, stepDurationSec, isManual = false) {
    if (!this._instrument || !this._seq) return;

    // Manual trigger: bypass playback counters, fire immediately.
    if (isManual) {
      this._seq.setActiveStep(index);
      const s = this._instrument.steps[index];
      if (s) this._instrument.triggerSequenceStep(index, s, time, stepDurationSec);
      return;
    }

    // Hook for instrument-specific per-tick processing (e.g. acid LFO position)
    this._onStepTick?.(index, time, stepDurationSec);

    // Speed multiplier: 0.5x skips odd ticks
    const multiplier = this.speedMultiplier ?? 1;
    if (multiplier === 0.5 && index % 2 !== 0) return;

    // Pattern parameters
    const patternParams = this._seq?.getPatternParams() ?? {};
    const playEvery = patternParams.playEvery ?? 1;
    const rotationOffset = patternParams.rotationOffset ?? 0;
    const rotationIntervalBars = patternParams.rotationIntervalBars ?? 1;

    // Apply rotation physically when local sequencer completes a full cycle
    if (this._seqPosition > 0 && this._seqPosition % 16 === 0 && rotationOffset > 0) {
      const localBar = this._seqPosition / 16;
      if (localBar % rotationIntervalBars === 0) {
        this._seqRotate(rotationOffset);
      }
    }

    // Bar density
    const currentBar = Math.floor(this._globalStep / 16);
    if (currentBar % playEvery !== 0) {
      this._globalStep++;
      return;
    }

    // Chain: advance pattern position at bar boundaries
    if (this._seqPosition > 0 && this._seqPosition % 16 === 0) {
      const localBar = this._seqPosition / 16;
      const chainEntryEvery = playEvery; // chain advances every playEvery bars
      if (localBar % chainEntryEvery === 0 && this._chain.length > 0) {
        const prevPos = this._chainPosition;
        this._chainPosition = (this._chainPosition + 1) % this._chain.length;
        if (this._chainPosition !== prevPos) {
          const patternName = ['A', 'B', 'C', 'D'][this._chain[this._chainPosition]];
          this._playingPattern = patternName;
          const color = this._defaultColor?.() || '#0f0';
          // Update chain bar and tab indicators
          this._updateChainBar(color);
          this._updateTabPlayingIndicators(color);
        }
      }
    }

    // A pattern launched from hardware takes over at the bar boundary.
    if (this._queuedPattern != null && this._seqPosition % 16 === 0) this._applyQueuedPattern();

    // Get active pattern's steps (falls back to the live-edited instrument steps)
    const activePatternName = ['A', 'B', 'C', 'D'][this._chain[this._chainPosition] ?? 0];
    const activePattern = this._patterns?.[activePatternName];
    const steps = activePattern?.steps ?? this._instrument.steps;

    // Advance sequencer position (2x = 2 steps per tick, offset in time)
    const stepsToAdvance = multiplier === 2 ? 2 : 1;
    const subStepDur = stepDurationSec / stepsToAdvance;
    let stepFired = false;
    for (let si = 0; si < stepsToAdvance; si++) {
      const subTime = time + si * subStepDur;
      const stepIndex = this._seqPosition % 16;
      const s = steps[stepIndex];

      this._setMiniStripPlayhead(activePatternName, stepIndex);

      if (s?.active) {
        if (Math.random() < (s.probability ?? 1)) {
          if (!s.conditions || s.conditions === "off" || this._meetsCondition(s.conditions, currentBar)) {
            stepFired = true;
            this._instrument.triggerSequenceStep(stepIndex, s, subTime, subStepDur);
          }
        }
      }

      this._seqPosition++;
    }

    if (this._jamPending && !stepFired) this._triggerJam(time, stepDurationSec);
    this._jamPending = false;
    this._globalStep++;
  }

  /** Highlight the currently playing step in the UI. */
  setActiveStep() {
    this._seq?.setActiveStep((this._seqPosition - 1 + 16) % 16);
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
    // _preFader: post-FX, pre-volume/mute — safe tap point for bus sends
    this._preFader = ctx.createGain();

    this._out = ctx.createGain();
    this._out.gain.value = instrument.volume;
    if (this._fxUnit) {
      instrument.connect(this._fxUnit.input);
      this._fxUnit.connect(this._preFader);
    } else {
      instrument.connect(this._preFader);
    }
    this._preFader.connect(this._out);

    this._pan = ctx.createStereoPanner();
    this._out.connect(this._pan);
    const analyser = ctx.createAnalyser();
    this._out.connect(analyser);
    this._analyser = analyser;
    const meterAnalyser = ctx.createAnalyser();
    meterAnalyser.fftSize = 256;
    this._out.connect(meterAnalyser);
    this._meterAnalyser = meterAnalyser;
    strip.meter.setAnalyser(meterAnalyser);
    waveform.init(analyser, color, { fixed: true });
  }

  /** Post-FX, pre-volume tap point. Connect bus sends here so muting doesn't kill the tap. */
  get preFaderOutput() {
    return this._preFader;
  }

  // ---- Shared UI builders ----

  /** localStorage key for user presets scoped to this instrument class. */
  _userPresetsKey() {
    return `wam-user-presets-${this._instrument?.constructor.name ?? "unknown"}`;
  }

  /** Load user-saved presets from localStorage. */
  _loadUserPresets() {
    try {
      return JSON.parse(localStorage.getItem(this._userPresetsKey()) || "{}");
    } catch {
      return {};
    }
  }

  /** Save user presets object to localStorage. */
  _saveUserPresets(presets) {
    localStorage.setItem(this._userPresetsKey(), JSON.stringify(presets));
  }

  /** Capture current instrument params as a preset object (sound-shaping only). */
  _capturePresetParams() {
    const params = {};
    for (const def of this.constructor.SLIDER_DEFS || []) {
      if (def.param === "volume" || def.param === "chance") continue;
      const val = this._instrument[def.param];
      if (val !== undefined) params[def.param] = val;
    }
    // Capture registered selects (e.g. oscType, shape)
    for (const [param] of Object.entries(this._selects)) {
      const val = this._instrument[param];
      if (val !== undefined) params[param] = val;
    }
    // Capture registered toggles
    for (const [param] of Object.entries(this._toggles)) {
      const val = this._instrument[param];
      if (val !== undefined) params[param] = val;
    }
    return params;
  }

  /**
   * Build the Presets section (dropdown + randomize + save + delete).
   * Automatically skipped if instrument has no PRESETS.
   */
  _buildPresetSection(controls, instrument) {
    const PresetsObj = instrument.constructor.PRESETS;
    if (!PresetsObj || Object.keys(PresetsObj).length === 0) return;

    const { el: presetEl, controls: presetCtrl } = createSection("Presets");

    // Dropdown with ◀ ▶ stepping
    const wrap = createCtrl("Preset", { tooltip: "Load a sound preset. ◀ ▶ step through them." });
    this._presetSelect = document.createElement("select");
    this._presetSelect.className = "wam-select";
    this._refreshPresetOptions();

    const presetRow = document.createElement("div");
    presetRow.className = "wam-preset-row";
    presetRow.style.cssText = "display:flex;gap:.25rem;align-items:stretch;";
    const mkStep = (label, dir, title) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.className = "wam-action-btn wam-preset-step";
      b.title = title;
      b.style.cssText = "flex:0 0 auto;padding:0 .4rem;";
      b.addEventListener("click", () => this.stepPreset(dir));
      return b;
    };
    this._presetSelect.style.cssText = "flex:1 1 auto;min-width:0;";
    presetRow.append(mkStep("◀", -1, "Previous preset"), this._presetSelect, mkStep("▶", 1, "Next preset"));

    this._presetSelect.addEventListener("change", () => {
      this._recordSound(); // preset loads are undoable
      const name = this._presetSelect.value;
      const userPresets = this._loadUserPresets();
      if (userPresets[name]) {
        // User preset — apply directly
        for (const [key, val] of Object.entries(userPresets[name])) {
          if (key === "volume") continue;
          const prop = `_${key}`;
          if (prop in this._instrument) this._instrument[prop] = val;
          else if (key in this._instrument) this._instrument[key] = val;
        }
        if (this._instrument._rebake) this._instrument._rebake();
        this._syncSliders();
        this._syncExtraControls();
      } else {
        this.applyPreset(name);
      }
      this._emitChange();
    });
    wrap.appendChild(presetRow);
    presetCtrl.appendChild(wrap);

    // Action buttons row
    const actionWrap = createCtrl("Actions");

    // Randomize All
    const randBtn = document.createElement("button");
    randBtn.textContent = "\u2684 Rand";
    randBtn.className = "wam-action-btn";
    randBtn.title = "Randomize the sound within musically useful ranges";
    randBtn.addEventListener("click", () => {
      this._randomizeAllParams();
      this._emitChange();
    });
    actionWrap.appendChild(randBtn);

    // Mutate + Undo/Redo — need the engine-level param schema.
    if (this._paramSchema) {
      const mutateRow = document.createElement("div");
      mutateRow.className = "wam-mutate-row";
      mutateRow.style.cssText = "display:flex;gap:.25rem;align-items:stretch;";
      const mutateBtn = document.createElement("button");
      mutateBtn.textContent = "≈ Mutate";
      mutateBtn.className = "wam-action-btn";
      mutateBtn.title = "Nudge the current sound. Amount set by the selector.";
      this._mutateAmountSelect = document.createElement("select");
      this._mutateAmountSelect.className = "wam-select";
      this._mutateAmountSelect.title = "Mutation amount";
      for (const [name, amt] of Object.entries(MUTATE_AMOUNTS)) {
        const opt = document.createElement("option");
        opt.value = amt;
        opt.textContent = name[0].toUpperCase() + name.slice(1);
        if (name === "medium") opt.selected = true;
        this._mutateAmountSelect.appendChild(opt);
      }
      mutateBtn.addEventListener("click", () => this.mutate(parseFloat(this._mutateAmountSelect.value)));
      mutateRow.append(mutateBtn, this._mutateAmountSelect);
      actionWrap.appendChild(mutateRow);

      const histRow = document.createElement("div");
      histRow.style.cssText = "display:flex;gap:.25rem;";
      this._undoBtn = document.createElement("button");
      this._undoBtn.textContent = "↶ Undo";
      this._undoBtn.className = "wam-action-btn";
      this._undoBtn.title = "Undo the last randomize / mutate / preset load";
      this._undoBtn.addEventListener("click", () => this.undoSound());
      this._redoBtn = document.createElement("button");
      this._redoBtn.textContent = "↷ Redo";
      this._redoBtn.className = "wam-action-btn";
      this._redoBtn.title = "Redo";
      this._redoBtn.addEventListener("click", () => this.redoSound());
      histRow.append(this._undoBtn, this._redoBtn);
      actionWrap.appendChild(histRow);
      this._updateHistoryButtons();
    }

    // Save
    const saveBtn = document.createElement("button");
    saveBtn.textContent = "\uD83D\uDCBE Save";
    saveBtn.className = "wam-action-btn";
    saveBtn.title = "Save the current sound as a preset. Under the dev server it is written to src/web-audio/presets/ in the repo.";
    saveBtn.addEventListener("click", () => this._saveCurrentAsPreset());
    actionWrap.appendChild(saveBtn);

    // Delete
    const delBtn = document.createElement("button");
    delBtn.textContent = "\uD83D\uDDD1 Del";
    delBtn.className = "wam-action-btn";
    delBtn.title = "Delete the selected preset (built-ins only under the dev server).";
    delBtn.addEventListener("click", () => this._deleteSelectedPreset());
    actionWrap.appendChild(delBtn);

    // Export All
    const exportBtn = document.createElement("button");
    exportBtn.textContent = "\uD83D\uDCCB Export";
    exportBtn.className = "wam-action-btn";
    exportBtn.title = "Copy all user presets to clipboard as JSON";
    exportBtn.addEventListener("click", () => this._exportAllUserPresets());
    actionWrap.appendChild(exportBtn);

    presetCtrl.appendChild(actionWrap);
    controls.appendChild(presetEl);
  }

  /** Refresh the user-preset options in the dropdown (appended after built-ins). */
  _refreshUserPresetOptions() {
    if (!this._presetSelect) return;
    // Remove existing user options
    this._presetSelect.querySelectorAll("option[data-user]").forEach((o) => o.remove());
    const userPresets = this._loadUserPresets();
    const names = Object.keys(userPresets);
    if (names.length === 0) return;
    // Separator
    const sep = document.createElement("option");
    sep.disabled = true;
    sep.textContent = "── User ──";
    sep.setAttribute("data-user", "");
    this._presetSelect.appendChild(sep);
    for (const name of names) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      opt.setAttribute("data-user", "");
      this._presetSelect.appendChild(opt);
    }
  }

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

  /** Prompt for a name and save the current sound as a user preset. */
  /**
   * Rebuild the preset dropdown: built-ins (grouped by first tag when any
   * preset is tagged), then user presets. Keeps the current selection.
   */
  _refreshPresetOptions() {
    const select = this._presetSelect;
    if (!select) return;
    const prev = select.value;
    const Cls = this._instrument.constructor;
    const entries = Cls.PRESET_DATA?.presets ?? Object.keys(Cls.PRESETS ?? {}).map((name) => ({ name, tags: [] }));
    select.replaceChildren();
    const mkOpt = (name) => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name.replace(/_/g, " ");
      return opt;
    };
    if (entries.some((e) => e.tags?.length)) {
      const groups = new Map();
      for (const e of entries) {
        const tag = e.tags?.[0] ?? "other";
        if (!groups.has(tag)) groups.set(tag, []);
        groups.get(tag).push(e.name);
      }
      for (const [tag, names] of groups) {
        const og = document.createElement("optgroup");
        og.label = tag;
        for (const n of names) og.appendChild(mkOpt(n));
        select.appendChild(og);
      }
    } else {
      for (const e of entries) select.appendChild(mkOpt(e.name));
    }
    this._refreshUserPresetOptions();
    if (prev && [...select.options].some((o) => o.value === prev)) select.value = prev;
  }

  /** Step to the previous (-1) / next (+1) preset, wrapping. Applies it like a dropdown change. */
  stepPreset(dir = 1) {
    const select = this._presetSelect;
    if (!select) return;
    const opts = [...select.options].filter((o) => !o.disabled);
    if (!opts.length) return;
    const i = opts.findIndex((o) => o.value === select.value);
    const next = opts[(i + dir + opts.length) % opts.length];
    select.value = next.value;
    select.dispatchEvent(new Event("change"));
  }

  /**
   * Capture the current sound as preset params: every sound (non-part) schema
   * param — so presets are complete and never leak values — plus the
   * instrument's output volume. Legacy instruments fall back to SLIDER_DEFS.
   */
  _captureSoundPreset() {
    const schema = this._paramSchema;
    let params;
    if (schema) {
      params = {};
      for (const def of presetParamDefs(schema)) {
        const v = this._instrument[def.param];
        if (v === undefined) continue;
        params[def.param] = (def.type ?? "number") === "number" && typeof v === "number" ? quantize(def, v) : v;
      }
    } else {
      params = this._capturePresetParams();
    }
    params.volume = Math.round((this._instrument.volume ?? 1) * 100) / 100;
    return params;
  }

  /**
   * Save the current sound. Under the dev server it's written straight into
   * the instrument's preset JSON in the repo; otherwise it's stored as a
   * localStorage user preset (and copied to the clipboard).
   */
  async _saveCurrentAsPreset() {
    const Cls = this._instrument.constructor;
    const current = this._presetSelect?.value ?? "";
    const name = prompt("Preset name:", current)?.trim();
    if (!name) return;
    const params = this._captureSoundPreset();

    if (canWritePresets() && Cls.PRESET_DATA) {
      const exists = !!Cls.PRESETS[name];
      if (exists && !confirm(`Overwrite preset "${name}" in the repo?`)) return;
      const tagInput = prompt("Tags (comma-separated, optional — e.g. bass, acid):", presetTags(Cls.PRESET_DATA, name).join(", "));
      if (tagInput === null) return;
      const tags = tagInput.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
      try {
        await savePresetToRepo(Cls.PRESET_DATA.instrument, { name, tags, params });
        upsertPreset(Cls, { name, tags, params });
        this._refreshPresetOptions();
        this._presetSelect.value = name;
        console.log(`[WAM] Preset "${name}" written to src/web-audio/presets/${Cls.PRESET_DATA.instrument}.json`);
        return;
      } catch (err) {
        console.error(err);
        alert(`Couldn't write to the repo (${err.message}). Saving as a local user preset instead.`);
      }
    }
    this._saveUserPreset(name, params);
  }

  /** localStorage user preset (production builds, or when the repo write fails). */
  _saveUserPreset(name, params) {
    const key = name;
    const userPresets = this._loadUserPresets();
    userPresets[key] = params;
    this._saveUserPresets(userPresets);
    this._refreshUserPresetOptions();
    this._presetSelect.value = key;
    // Copy to clipboard for pasting into source
    const json = JSON.stringify(params, null, 2);
    navigator.clipboard.writeText(`"${key}": ${json},`).then(() => {
      console.log(`[WAM] Preset "${key}" saved & copied to clipboard`);
    });
  }

  /** Delete the currently selected user preset (with confirmation). */
  async _deleteSelectedPreset() {
    const name = this._presetSelect?.value;
    if (!name) return;
    const userPresets = this._loadUserPresets();
    if (!userPresets[name]) {
      const Cls = this._instrument.constructor;
      if (!canWritePresets() || !Cls.PRESET_DATA) {
        alert(`"${name}" is a built-in preset. Delete it under the dev server, or edit src/web-audio/presets/.`);
        return;
      }
      if (Object.keys(Cls.PRESETS).length <= 1) {
        alert("Can't delete the last preset.");
        return;
      }
      if (!confirm(`Delete built-in preset "${name}" from the repo?`)) return;
      try {
        await deletePresetFromRepo(Cls.PRESET_DATA.instrument, name);
        removePreset(Cls, name);
        this._refreshPresetOptions();
        console.log(`[WAM] Preset "${name}" removed from src/web-audio/presets/${Cls.PRESET_DATA.instrument}.json`);
      } catch (err) {
        console.error(err);
        alert(`Couldn't delete from the repo: ${err.message}`);
      }
      return;
    }
    if (!confirm(`Delete user preset "${name}"?`)) return;
    delete userPresets[name];
    this._saveUserPresets(userPresets);
    this._refreshUserPresetOptions();
    // Select first built-in preset
    if (this._presetSelect.options.length > 0) {
      this._presetSelect.value = this._presetSelect.options[0].value;
    }
  }

  /** Copy all user presets for this instrument to clipboard as a JSON object. */
  _exportAllUserPresets() {
    const userPresets = this._loadUserPresets();
    const names = Object.keys(userPresets);
    if (names.length === 0) {
      alert("No user presets saved for this instrument.");
      return;
    }
    const json = JSON.stringify(userPresets, null, 2);
    navigator.clipboard.writeText(json).then(() => {
      alert(`${names.length} preset(s) copied to clipboard.`);
      console.log(`[WAM] Exported ${names.length} user presets for ${this._instrument?.constructor.name}:\n${json}`);
    });
  }

  /**
   * Build a preset <select> from a PRESETS object and append to container.
   * Stores the element as this._presetSelect.
   * @param {object} PresetsObj  e.g. WebAudioSynthMono.PRESETS
   * @param {HTMLElement} appendTo
   * @deprecated Use _buildPresetSection() instead — kept for backward compat.
   */
  _makePresetDropdown(PresetsObj, appendTo) {
    const wrap = createCtrl("Preset", { tooltip: "Load a sound preset." });
    this._presetSelect = document.createElement("select");
    this._presetSelect.className = "wam-select";
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
    wrap.appendChild(this._presetSelect);
    appendTo.appendChild(wrap);
    return this._presetSelect;
  }

  /**
   * Build an oscillator-type dropdown (SAW/SQR/TRI/SIN etc.) wrapped in createCtrl.
   * Stores references as this._waveSelect and this._waveSelectProp.
   * @param {string[]} types  e.g. ["sawtooth","square","triangle","sine"]
   * @param {HTMLElement} appendTo
   * @param {object} [opts]
   * @param {string} [opts.prop="oscType"]  Property name on instrument
   * @param {string} [opts.label="Shape"]   Control label
   * @param {string} [opts.tooltip]         Tooltip text
   */
  _makeWaveSelect(types, appendTo, { prop = "oscType", label = "Shape", tooltip = null } = {}) {
    this._waveSelectProp = prop;
    const wrap = createCtrl(label, tooltip ? { tooltip } : {});
    this._waveSelect = document.createElement("select");
    this._waveSelect.className = "wam-select";
    for (const type of types) {
      const opt = document.createElement("option");
      opt.value = type;
      opt.textContent = type.slice(0, 3).toUpperCase();
      if (this._instrument[prop] === type) opt.selected = true;
      this._waveSelect.appendChild(opt);
    }
    this._registerSelect(prop, this._waveSelect);
    wrap.appendChild(this._waveSelect);
    appendTo.appendChild(wrap);
    return wrap;
  }

  /**
   * Build the Sequencer section with Speed, Density, Rotate, and optional Rand controls,
   * each wrapped in createCtrl for consistent title/control/tooltip layout.
   * Stores _speedSelect, _densityInput, _rotateInput, _rotateIntervalInput on this.
   * @param {HTMLElement} controls  The .wam-controls container to append to
   * @param {object} [opts]
   * @param {function|null} [opts.onRandomize]  Callback for Rand button; omit to hide it
   * @returns {{ el: HTMLElement, controls: HTMLElement }}  The section element and its controls row
   */
  /**
   * Build sequencer controls (Speed, Density, Rotate, Rot.Bars, optional Rand) and
   * append them to the seq controls container so they are co-located with the step-seq grid.
   * Each subclass can extend the returned seqCtrl row (e.g. chord-size select).
   * @param {object} [opts]
   * @param {function|null} [opts.onRandomize]  Instrument-specific randomize callback
   * @returns {{ el: HTMLElement, controls: HTMLElement }}
   */
  _buildSequencerSection({ onRandomize = null } = {}) {
    const { el, controls: seqCtrl } = createSection("Sequencer");

    const speedWrap = createCtrl("Speed", { tooltip: "Playback rate multiplier for this instrument." });
    this._speedSelect = document.createElement("select");
    this._speedSelect.className = "wam-select";
    [0.5, 1, 2].forEach((val) => {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = val === 0.5 ? "0.5x" : val === 1 ? "1x (Normal)" : "2x";
      if (val === 1) opt.selected = true;
      this._speedSelect.appendChild(opt);
    });
    this._speedSelect.addEventListener("change", () => {
      this.speedMultiplier = parseFloat(this._speedSelect.value);
      this._emitChange();
    });
    speedWrap.appendChild(this._speedSelect);
    seqCtrl.appendChild(speedWrap);

    const densityWrap = createCtrl("Density", { tooltip: "Play this pattern every N bars. 1 = every bar." });
    this._densityInput = document.createElement("input");
    this._densityInput.type = "number";
    this._densityInput.min = "1";
    this._densityInput.max = "16";
    this._densityInput.value = "1";
    this._densityInput.className = "wam-num-input";
    this._densityInput.addEventListener("change", () => {
      this._seq?.setPatternParams({ playEvery: parseInt(this._densityInput.value) });
      this._emitChange();
    });
    densityWrap.appendChild(this._densityInput);
    seqCtrl.appendChild(densityWrap);

    const rotateWrap = createCtrl("Rotate", { tooltip: "Shift pattern left by N steps each rotation interval." });
    this._rotateInput = document.createElement("input");
    this._rotateInput.type = "number";
    this._rotateInput.min = "0";
    this._rotateInput.max = "15";
    this._rotateInput.value = "0";
    this._rotateInput.className = "wam-num-input";
    this._rotateInput.addEventListener("change", () => {
      this._seq?.setPatternParams({ rotationOffset: parseInt(this._rotateInput.value) });
      this._emitChange();
    });
    rotateWrap.appendChild(this._rotateInput);
    seqCtrl.appendChild(rotateWrap);

    const rotateIntervalWrap = createCtrl("Rot.Bars", { tooltip: "Apply rotation every N bars." });
    this._rotateIntervalInput = document.createElement("input");
    this._rotateIntervalInput.type = "number";
    this._rotateIntervalInput.min = "1";
    this._rotateIntervalInput.max = "16";
    this._rotateIntervalInput.value = "1";
    this._rotateIntervalInput.className = "wam-num-input";
    this._rotateIntervalInput.addEventListener("change", () => {
      this._seq?.setPatternParams({ rotationIntervalBars: parseInt(this._rotateIntervalInput.value) });
      this._emitChange();
    });
    rotateIntervalWrap.appendChild(this._rotateIntervalInput);
    seqCtrl.appendChild(rotateIntervalWrap);

    if (onRandomize) {
      const randWrap = createCtrl("Rand", { tooltip: "Randomize the step pattern." });
      const randBtn = document.createElement("button");
      randBtn.textContent = "⚄";
      randBtn.className = "wam-action-btn";
      randBtn.addEventListener("click", onRandomize);
      randWrap.appendChild(randBtn);
      seqCtrl.appendChild(randWrap);
    }

    const compactWrap = createCtrl("Compact", { tooltip: "Hide per-step note/probability/ratchet controls — fits more steps per row on small screens." });
    const compactBtn = document.createElement("button");
    compactBtn.textContent = "Compact";
    compactBtn.className = "wam-toggle-btn";
    compactBtn.addEventListener("click", () => {
      if (!this._seq) return;
      this._seq.compact = !this._seq.compact;
      compactBtn.toggleAttribute("data-active", this._seq.compact);
      this._emitChange();
    });
    compactWrap.appendChild(compactBtn);
    seqCtrl.appendChild(compactWrap);
    this._compactBtn = compactBtn;

    // Append to the seq controls wrapper so these controls share standard panel padding
    this._seqControls?.appendChild(el);
    return { el, controls: seqCtrl };
  }

  // ---- Preset management ----

  applyPreset(name) {
    if (!this._instrument) return;
    this._instrument.applyPreset(name);
    // Sync all knob-based params through the event path (skip volume — channel strip is independent)
    for (const def of this.constructor.SLIDER_DEFS || []) {
      if (def.param === "volume") continue;
      const knob = this._sliders[def.param];
      if (knob && this._instrument) {
        const val = this._instrument[def.param];
        knob.value = val;
        knob.dispatchEvent(
          new CustomEvent("knob-input", {
            bubbles: true,
            detail: { param: def.param, value: val },
          }),
        );
      }
    }
    // Sync registered selects
    for (const [param, { el }] of Object.entries(this._selects)) {
      if (this._instrument) el.value = this._instrument[param];
    }
    // Sync registered toggles
    for (const [param, { el, activeClass }] of Object.entries(this._toggles)) {
      if (this._instrument) el.classList.toggle(activeClass, !!this._instrument[param]);
    }
    if (this._presetSelect) this._presetSelect.value = name;
    this._syncExtraControls();
  }

  /** Update all registered sliders from instrument state. */
  _syncSliders() {
    for (const def of this.constructor.SLIDER_DEFS || []) {
      if (def.param === "volume") continue; // channel strip volume is independent
      const slider = this._sliders[def.param];
      if (slider && this._instrument) slider.value = this._instrument[def.param];
    }
  }

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
    params.volume = this._muteHandle?.getVolume() ?? 1;
    this._extraToJSON(params);
    const obj = {
      params,
      fx: this._fxUnit?.toJSON(),
      muted: this._muteHandle?.isMuted() ?? false,
      soloed: this._soloHandle?.isSoloed() ?? false,
      pan: this._pan?.pan.value ?? 0,
      jamBinding: this._jamBinding ?? null,
      midiParamBindings: { ...this._paramBindings },
      speedMultiplier: this._speedMultiplier,
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
    if (obj.params) {
      for (const [key, val] of Object.entries(obj.params)) {
        this._restoreParam(key, val);
      }
    }
    this._restoreExtra(obj);
    this._restoreSequencer(obj);
    this._soundLocks = new Set(obj.soundLocks ?? []);
    this._paintSectionLocks();
    if (obj.fx) this._fxUnit?.fromJSON(obj.fx);
    if (obj.muted != null) this._muteHandle?.setMuted(obj.muted);
    if (obj.soloed != null) {
      this._soloHandle?.setSoloed(obj.soloed);
      WebAudioControlsBase._applySolo();
    }
    if (obj.pan != null && this._pan) {
      this._pan.pan.value = obj.pan;
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

  /** Restore a single param. Override for special handling (e.g. oscType → wave buttons). */
  _restoreParam(key, val) {
    if (key === "volume") {
      if (this._out) this._out.gain.value = val;
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
    this._globalStep = 0;
    this._seqPosition = 0;
    this._clearMiniStripPlayhead();
  }

  /** Hide or show the step sequencer UI. */
  set showSequencer(v) {
    this.toggleAttribute("data-no-sequencer", !v);
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

applyInputLearnMixin(WebAudioControlsBase);

// Re-export UI helpers for subclass use
export { createSection, createCtrl };
