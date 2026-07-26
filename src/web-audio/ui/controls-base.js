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
    // Interaction flow (title click on strip):
    //   pointerdown: excluded (name group is in the ignore list) — no focus dispatch
    //   click: strip-collapse-toggle dispatched by the factory
    //     → if collapsed: dispatch wam-instrument-focus (closes others, sets wam-focused),
    //       then expand all sections. Playground scrolls. _wasFocusedOnPress guard below
    //       prevents the subsequent body-click path from toggling shut.
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
          // Expanding — capture focus state, then dispatch focus so the app
          // collapses all other instruments and scrolls this one into view.
          this._wasFocusedOnPress = this.classList.contains("wam-focused");
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
          // Title-click path: pointerdown is excluded for name group, so
          // _wasFocusedOnPress may be stale. Capture it here — title click is
          // an explicit collapse intent regardless of prior focus state.
          // Body-click path: _wasFocusedOnPress was set by pointerdown.
          // If this gesture just moved focus here (wasn't focused before), an
          // app-level focus handler is already expanding. Force it open rather
          // than toggling shut. Without a focus manager (`wam-focused` never
          // set), this branch never triggers and collapse runs as normal.
          const wasFocusedBeforeThisGesture = e.detail?.fromTitle
            ? this.classList.contains("wam-focused")
            : this._wasFocusedOnPress;
          if (this.classList.contains("wam-focused") && !wasFocusedBeforeThisGesture) {
            return;
          }
          // Collapsing — hide all three sections.
          this.setAttribute("data-collapsed", "");
          this.setAllPanels(false);
        }
      });
    }

    this._muteHandle = {
      isMuted: strip.isMuted,
      setMuted: strip.setMuted,
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

    // Clicking anywhere on the panel focuses this instrument (for hardware
    // control: the 16 sequencer buttons follow the focused instrument).
    if (!this._focusWired) {
      this._focusWired = true;
      this.addEventListener("pointerdown", (e) => {
        // Mixing controls (mute/solo/vol/pan) and jam triggers act on the
        // channel in place — they must not change which instrument is
        // focused/expanded. The Ctrl/Seq/FX nav toggles still focus, since
        // they rely on focus to reveal their section.
        if (e.target.closest(".wam-strip-name-group, .wam-strip-mix-group, .wam-strip-jam-group")) return;
        // Capture focus state before dispatching, so the collapse toggle (which
        // fires later on `click`) can tell whether this gesture is what focused
        // the instrument — and avoid toggling shut what focus just expanded.
        this._wasFocusedOnPress = this.classList.contains("wam-focused");
        this.dispatchEvent(new CustomEvent("wam-instrument-focus", { bubbles: true, detail: { controls: this } }));
      });
    }

    // Combined Ctrl+FX section: a single grid where instrument knobs and FX
    // sections flow in columns side by side. Hidden together by the Ctrl toggle.
    this._topSection = document.createElement("div");
    this._topSection.className = "wam-section-top";
    this._topSection.setAttribute("data-hidden", ""); // default: hidden
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
    // Ctrl toggles the combined Ctrl+FX row. FX always travels with Ctrl.
    // Seq toggles the sequencer independently.
    const wireToggle = (btn, section) => {
      btn.addEventListener("click", () => {
        const nowHidden = section.hasAttribute("data-hidden");
        section.toggleAttribute("data-hidden", !nowHidden);
        btn.toggleAttribute("data-active", nowHidden);
        this._emitChange();
      });
    };
    wireToggle(this._ctrlBtn, this._topSection);
    wireToggle(this._seqBtn, this._seqSection);
    // FX button is kept for the nav group but is decorative — it just mirrors
    // the Ctrl toggle state since FX always travels with controls.
    this._fxBtn.addEventListener("click", () => {
      // Delegate to Ctrl toggle (same section)
      const nowHidden = this._topSection.hasAttribute("data-hidden");
      this._topSection.toggleAttribute("data-hidden", !nowHidden);
      this._ctrlBtn.toggleAttribute("data-active", nowHidden);
      this._fxBtn.toggleAttribute("data-active", nowHidden);
      this._emitChange();
    });

    // Slider factory — creates a wam-slider or wam-knob, registers in _sliders, returns element
    const mkSlider = (def) => {
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
    const initOpts = this._seqInitOptions(color);
    initOpts.onRandomize = onRandomize;
    this._seq.init(initOpts);

    // Initialize multi-pattern system
    const defaultSteps = this._seq.steps.slice();
    this._patterns = {
      A: { steps: defaultSteps },
      B: { steps: defaultSteps.map(s => ({ ...s, active: false })) },
      C: { steps: defaultSteps.map(s => ({ ...s, active: false })) },
      D: { steps: defaultSteps.map(s => ({ ...s, active: false })) },
    };
    this._chain = [0];
    this._chainPosition = 0;
    this._playingPattern = 'A';

    expanded.appendChild(this._seq);

    // Build pattern tabs and chain bar (must be after appendChild so insertBefore works)
    this._buildPatternSelector(expanded, color);

    this._seq.addEventListener("step-change", () => {
      this._syncPatternEdit();
      this._emitChange();
    });
    this._seq.addEventListener("pattern-change", () => this._emitChange());
  }

  /** Build pattern tab bar and chain bar UI. */
  _buildPatternSelector(container, color) {
    // Pattern tabs container
    const patternRow = document.createElement("div");
    patternRow.className = "wam-pattern-row";

    // --- Row 1: Pattern tabs + ops ---
    const tabRow = document.createElement("div");
    tabRow.className = "wam-pattern-tab-row";

    const tabLabel = document.createElement("span");
    tabLabel.className = "wam-pattern-label";
    tabLabel.textContent = "Patterns";
    tabRow.appendChild(tabLabel);

    const tabs = document.createElement("div");
    tabs.className = "wam-pattern-tabs";

    const patternNames = ['A', 'B', 'C', 'D'];
    this._patternTabs = {};

    patternNames.forEach(name => {
      const tab = document.createElement("button");
      tab.className = "wam-pattern-tab";
      tab.textContent = name;
      tab.title = name + ' — click to edit';
      this._stylePatternTab(tab, name === 'A', false, color);
      tab.addEventListener("click", () => this._selectPattern(name));
      tabs.appendChild(tab);
      this._patternTabs[name] = tab;
    });

    tabRow.appendChild(tabs);

    // Pattern ops
    const tabOps = document.createElement("div");
    tabOps.className = "wam-pattern-ops";

    const copyBtn = this._makeSmallBtn(color, "\u25c9", "Copy to others");
    copyBtn.addEventListener("click", () => this._copyActivePattern());
    tabOps.appendChild(copyBtn);

    const clearBtn = this._makeSmallBtn(color, "\u2715", "Clear pattern");
    clearBtn.addEventListener("click", () => this._clearActivePattern());
    tabOps.appendChild(clearBtn);

    tabRow.appendChild(tabOps);
    patternRow.appendChild(tabRow);

    // --- Row 2: Chain bar ---
    const chainRow = document.createElement("div");
    chainRow.className = "wam-pattern-chain-row";

    const chainLabel = document.createElement("span");
    chainLabel.className = "wam-pattern-label";
    chainLabel.textContent = "Chain";
    chainRow.appendChild(chainLabel);

    const chainBar = document.createElement("div");
    chainBar.className = "wam-chain-bar";

    this._chainPills = [];
    this._updateChainBar(color);
    chainRow.appendChild(chainBar);

    // Chain ops
    const chainOps = document.createElement("div");
    chainOps.className = "wam-pattern-ops";

    const dupChainBtn = this._makeSmallBtn(color, "\u21e7", "Duplicate chain");
    dupChainBtn.addEventListener("click", () => this._duplicateChain());
    chainOps.appendChild(dupChainBtn);

    chainRow.appendChild(chainOps);
    patternRow.appendChild(chainRow);

    // Insert before the sequencer grid
    container.insertBefore(patternRow, this._seq);
  }

  /** Create a small pattern op button. */
  _makeSmallBtn(color, text, title) {
    const btn = document.createElement("button");
    btn.textContent = text;
    btn.title = title;
    btn.className = "wam-pattern-op-btn";
    btn.style.borderColor = color + '44';
    btn.style.color = color + '99';
    return btn;
  }

  /** Style a pattern tab. */
  _stylePatternTab(tab, isActive, isPlaying, color) {
    if (isActive) {
      tab.style.background = color + '33';
      tab.style.color = color;
      tab.style.borderColor = color;
      tab.setAttribute("data-active", "");
    } else {
      tab.style.background = 'transparent';
      tab.style.color = color + '99';
      tab.style.borderColor = color + '44';
      tab.removeAttribute("data-active");
    }
    if (isPlaying) {
      tab.setAttribute("data-playing", "");
    } else {
      tab.removeAttribute("data-playing");
    }
  }

  /** Update chain bar UI. */
  _updateChainBar(color) {
    const chainBar = this._chainPills[0]?.parentElement;
    if (!chainBar) return;

    chainBar.innerHTML = '';
    this._chainPills = [];

    const patternNames = ['A', 'B', 'C', 'D'];

    this._chain.forEach((idx, pos) => {
      const pill = document.createElement("button");
      pill.className = "wam-chain-pill";
      pill.textContent = patternNames[idx];
      pill.title = pos + 1 + '. click to cycle, right-click to remove';
      pill.style.borderColor = color + '33';

      if (pos === this._chainPosition) {
        pill.style.background = color + '44';
        pill.style.color = color;
        pill.setAttribute("data-playing", "");
      } else {
        pill.style.background = 'transparent';
        pill.style.color = color + '88';
        pill.removeAttribute("data-playing");
      }

      pill.addEventListener("click", (e) => {
        e.stopPropagation();
        this._cycleChainEntry(pos);
      });

      // Right-click to remove (minimum 1 entry)
      pill.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        if (this._chain.length > 1) {
          this._chain.splice(pos, 1);
          if (this._chainPosition >= this._chain.length) {
            this._chainPosition = this._chain.length - 1;
          }
          this._updateChainBar(color);
          this._emitChange();
        }
      });

      chainBar.appendChild(pill);
      this._chainPills.push(pill);
    });

    // Add button
    const addBtn = document.createElement("button");
    addBtn.textContent = "+";
    addBtn.title = "Add chain entry";
    addBtn.className = "wam-chain-add-btn";
    addBtn.style.borderColor = color + '44';
    addBtn.style.color = color + '88';
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

    // Sync sequencer to selected pattern
    if (this._seq && this._patterns[name]) {
      this._seq.steps = this._patterns[name].steps;
    }
  }

  /** Sync current sequencer steps back to active pattern. Called on step-change. */
  _syncPatternEdit() {
    // Find which tab is currently active
    for (const [name, tab] of Object.entries(this._patternTabs)) {
      if (tab.hasAttribute("data-active")) {
        if (this._seq && this._patterns[name]) {
          this._patterns[name].steps = this._seq.steps;
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
    this._emitChange();
  }

  /** Duplicate the entire chain (append a copy). */
  _duplicateChain() {
    if (this._chain.length + this._chain.length > 16) return;
    this._chain = this._chain.concat([...this._chain]);
    this._updateChainBar(this._defaultColor?.() || '#0f0');
    this._emitChange();
  }

  /** Update playing indicator on pattern tabs. */
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
   * Called by the base step() for each active step. Override to implement
   * instrument-specific triggering.
   * @param {object} s  Step data { active, note, accent, probability, ratchet, conditions }
   * @param {number} subTime  AudioContext timestamp
   * @param {number} subStepDur  Duration of this sub-step in seconds
   */
  _seqTrigger(s, subTime, subStepDur) {
    // Default: no-op. Subclasses override.
  }

  /**
   * Handle a single step's audio. Called by base step() for each active step.
   * Default implementation handles ratchet. Override for custom behavior (chords, etc.).
   */
  _seqTriggerStep(s, subTime, subStepDur) {
    const ratchet = s.ratchet ?? 1;
    if (ratchet > 1) {
      const ratchetDuration = subStepDur / ratchet;
      for (let i = 0; i < ratchet; i++) {
        this._seqTrigger(s, subTime + i * ratchetDuration, ratchetDuration);
      }
    } else {
      this._seqTrigger(s, subTime, subStepDur);
    }
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
   * Calls _seqTrigger() for active steps, _triggerJam() if pending.
   * Subclasses that need custom timing logic can override, but most should not.
   */
  step(index, time, stepDurationSec) {
    if (!this._instrument || !this._seq) return;

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

    // Get active pattern's steps
    const activePatternName = ['A', 'B', 'C', 'D'][this._chain[this._chainPosition] ?? 0];
    const activePattern = this._patterns?.[activePatternName];
    const steps = activePattern?.steps ?? this._seq.steps;

    // Advance sequencer position (2x = 2 steps per tick, offset in time)
    const stepsToAdvance = multiplier === 2 ? 2 : 1;
    const subStepDur = stepDurationSec / stepsToAdvance;
    let stepFired = false;
    for (let si = 0; si < stepsToAdvance; si++) {
      const subTime = time + si * subStepDur;
      const stepIndex = this._seqPosition % 16;
      const s = steps[stepIndex];

      if (s?.active) {
        if (Math.random() < (s.probability ?? 1)) {
          if (!s.conditions || s.conditions === "off" || this._meetsCondition(s.conditions, currentBar)) {
            stepFired = true;
            this._seqTriggerStep(s, subTime, subStepDur);
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

    // Dropdown
    const wrap = createCtrl("Preset", { tooltip: "Load a sound preset." });
    this._presetSelect = document.createElement("select");
    this._presetSelect.className = "wam-select";

    // Built-in presets
    for (const name of Object.keys(PresetsObj)) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name.replace(/_/g, " ");
      this._presetSelect.appendChild(opt);
    }
    // User presets (from localStorage)
    this._refreshUserPresetOptions();

    this._presetSelect.addEventListener("change", () => {
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
    wrap.appendChild(this._presetSelect);
    presetCtrl.appendChild(wrap);

    // Action buttons row
    const actionWrap = createCtrl("Actions");

    // Randomize All
    const randBtn = document.createElement("button");
    randBtn.textContent = "\u2684 Rand";
    randBtn.className = "wam-action-btn";
    randBtn.title = "Randomize all synthesis parameters";
    randBtn.addEventListener("click", () => {
      this._randomizeAllParams();
      this._emitChange();
    });
    actionWrap.appendChild(randBtn);

    // Save
    const saveBtn = document.createElement("button");
    saveBtn.textContent = "\uD83D\uDCBE Save";
    saveBtn.className = "wam-action-btn";
    saveBtn.title = "Save current sound as a user preset";
    saveBtn.addEventListener("click", () => this._saveCurrentAsPreset());
    actionWrap.appendChild(saveBtn);

    // Delete
    const delBtn = document.createElement("button");
    delBtn.textContent = "\uD83D\uDDD1 Del";
    delBtn.className = "wam-action-btn";
    delBtn.title = "Delete the selected user preset";
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

  /** Randomize all synthesis parameters within their slider min/max ranges. */
  _randomizeAllParams() {
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
  _saveCurrentAsPreset() {
    const name = prompt("Preset name:");
    if (!name || !name.trim()) return;
    const key = name.trim();
    const params = this._capturePresetParams();
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
  _deleteSelectedPreset() {
    const name = this._presetSelect?.value;
    if (!name) return;
    const userPresets = this._loadUserPresets();
    if (!userPresets[name]) {
      alert(`"${name}" is a built-in preset. Remove it from the source code if needed.`);
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
      patternParams: this._seq?.getPatternParams(),
      sections: {
        ctrl: !this._topSection?.hasAttribute("data-hidden"),
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
      // Sync active pattern to the grid
      const activeName = ['A', 'B', 'C', 'D'][this._chain[this._chainPosition] ?? 0];
      this._seq.steps = this._patterns[activeName]?.steps ?? this._seq.steps;
    } else if (obj.steps) {
      // Legacy single-pattern: migrate to pattern A
      if (this._patterns) {
        this._patterns.A.steps = obj.steps;
        this._chain = [0];
        this._seq.steps = obj.steps;
      } else {
        this._seq.steps = obj.steps;
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
      // FX always travels with Ctrl. Backward compat: if old save had 'fx' but not
      // 'ctrl', use fx visibility as the combined row state.
      const ctrlVisible = obj.sections.ctrl ?? obj.sections.fx ?? false;
      this._applyPanel(this._topSection, this._ctrlBtn, ctrlVisible);
      this._applyPanel(this._topSection, this._fxBtn, ctrlVisible);
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
   * Show or hide all sections (Ctrl+FX row, Seq) at once. Used to emphasize
   * the focused instrument (expand all) and de-emphasize the rest (collapse
   * all) so the active one stands out.
   */
  setAllPanels(visible) {
    this._applyPanel(this._topSection, this._ctrlBtn, visible);
    this._applyPanel(this._topSection, this._fxBtn, visible);
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
