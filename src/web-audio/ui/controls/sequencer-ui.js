/**
 * Sequencer UI: step grid, pattern tabs A–D, mini strips, chain bar, copy/clear, and the sequencer section (speed / density / rotate).
 *
 * Part of WebAudioControlsBase (ui/controls-base.js): these methods are
 * installed onto its prototype (see ./install.js), so they share the panel's
 * state (`this._seq`, `this._patterns`, …) and subclasses can override them
 * as usual. Moved verbatim from controls-base.js (architecture-refactor Phase 3).
 */
import { createCtrl, createSection } from "../controls-factory.js";

export class SequencerUI {
  /** The instrument's step sequencer element, or null. */
  get sequencer() {
    return this._seq ?? null;
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
      this.__evolver?.userEdited(this._editedPatternName());
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
          // Merge the grid's values OVER the full step data: the grid only knows
          // some fields (active/note/accent/probability/ratchet/conditions), so a
          // plain copy dropped others (e.g. hi-hat `open`).
          const full = this._instrument?.steps ?? [];
          this._patterns[name].steps = this._seq.steps.map((s, i) => ({ ...(full[i] ?? {}), ...s }));
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
      this._seqRandBtn = randBtn;
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
  /** Hide or show the step sequencer UI. */
  set showSequencer(v) {
    this.toggleAttribute("data-no-sequencer", !v);
  }
}
