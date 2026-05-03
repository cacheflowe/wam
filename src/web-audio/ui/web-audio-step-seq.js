/**
 * <web-audio-step-seq> — configurable 16-step sequencer UI component.
 *
 * Features:
 *   • On/off toggle per step
 *   • Note select per step (options set via setNoteOptions)
 *   • Optional accent checkbox per step (enable with accent: true in init)
 *   • Optional probability slider per step (0–1; enable with probability: true in init)
 *   • Optional ratchet selector per step (1/2/3; enable with ratchet: true in init)
 *   • Optional conditions selector per step (off/1:2/1:3/1:4/2:4/3:4/fill; enable with conditions: true in init)
 *   • Pattern-level controls: bar density (playEvery), rotation (rotationOffset, rotationIntervalBars)
 *   • Active-step highlight (call setActiveStep(i) each tick)
 *   • Dispatches "step-change" CustomEvent when any step is edited
 *   • Dispatches "pattern-change" CustomEvent when pattern-level controls change
 *
 * Usage:
 *   const seq = document.createElement("web-audio-step-seq");
 *   container.appendChild(seq);
 *   seq.init({
 *     steps: [...],              // array of {active, note, accent?, probability?, ratchet?, conditions?}
 *     noteOptions: [[name, midi], ...],  // initial options for note selects
 *     accent: false,             // show accent checkboxes?
 *     probability: false,        // show probability sliders?
 *     ratchet: false,            // show ratchet selectors?
 *     conditions: false,         // show conditions selectors?
 *     color: "#0f0",             // CSS accent color (used as --seq-color var)
 *     stepClass: "acid-step",    // base CSS class for each step cell
 *   });
 *   seq.setActiveStep(stepIndex);
 *   seq.setNoteOptions([[name, midi], ...]);
 *   seq.steps;                   // returns current [{active, note, accent?, probability?, ratchet?, conditions?}] array
 *   seq.getPatternParams();      // returns {playEvery, rotationOffset, rotationIntervalBars}
 *   seq.setPatternParams({playEvery: 2, rotationOffset: 1});
 */
export default class WebAudioStepSeq extends HTMLElement {
  static #cssInjected = false;

  static #injectCSS() {
    if (WebAudioStepSeq.#cssInjected) return;
    WebAudioStepSeq.#cssInjected = true;
    const style = document.createElement("style");
    style.textContent = `
      web-audio-step-seq {
        display: grid;
        grid-template-columns: repeat(var(--seq-cols, 16), 1fr);
        gap: 4px;
      }
      web-audio-step-seq .wass-step {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 3px;
        min-width: 0;
        padding: 4px 2px;
        border-radius: 4px;
        transition: background 0.05s;
      }
      web-audio-step-seq .wass-step.wass-active {
        background: color-mix(in srgb, var(--seq-color, #0f0) 25%, transparent);
      }
      web-audio-step-seq .wass-num {
        font-size: 0.6rem;
        opacity: 0.5;
        line-height: 1;
      }
      web-audio-step-seq .wass-on {
        background: none;
        border: 1px solid color-mix(in srgb, var(--seq-color, #0f0) 50%, transparent);
        color: color-mix(in srgb, var(--seq-color, #0f0) 50%, transparent);
        border-radius: 50%;
        width: 22px;
        height: 22px;
        font-size: 0.7rem;
        cursor: pointer;
        padding: 0;
        line-height: 1;
        transition: all 0.1s;
      }
      web-audio-step-seq .wass-on.on {
        background: var(--seq-color, #0f0);
        border-color: var(--seq-color, #0f0);
        color: #111;
      }
      web-audio-step-seq .wass-note {
        font-size: 0.6rem;
        width: 100%;
        min-width: 0;
        background: #222;
        color: #ccc;
        border: 1px solid #444;
        border-radius: 2px;
        padding: 1px 2px;
      }
      web-audio-step-seq .wass-accent {
        display: flex;
        align-items: center;
        gap: 2px;
        font-size: 0.55rem;
        opacity: 0.7;
        cursor: pointer;
        user-select: none;
      }
      web-audio-step-seq .wass-accent input[type=checkbox] {
        margin: 0;
        width: 10px;
        height: 10px;
      }
      web-audio-step-seq .wass-probability {
        display: flex;
        align-items: center;
        gap: 2px;
        font-size: 0.55rem;
        opacity: 0.7;
        width: 100%;
        min-width: 0;
      }
      web-audio-step-seq .wass-probability input[type=range] {
        width: 100%;
        height: 6px;
        margin: 0;
        padding: 0;
        cursor: pointer;
        accent-color: var(--seq-color, #0f0);
      }
      web-audio-step-seq .wass-ratchet {
        font-size: 0.55rem;
        width: 100%;
        min-width: 0;
        background: #222;
        color: #ccc;
        border: 1px solid #444;
        border-radius: 2px;
        padding: 1px 2px;
        opacity: 0.7;
      }
      web-audio-step-seq .wass-conditions {
        font-size: 0.55rem;
        width: 100%;
        min-width: 0;
        background: #222;
        color: #ccc;
        border: 1px solid #444;
        border-radius: 2px;
        padding: 1px 2px;
        opacity: 0.7;
      }
      web-audio-step-seq .wass-pattern-controls {
        grid-column: 1 / -1;
        display: flex;
        gap: 12px;
        padding: 8px 4px;
        border-top: 1px solid #333;
        flex-wrap: wrap;
        align-items: center;
        font-size: 0.65rem;
        opacity: 0.8;
      }
      web-audio-step-seq .wass-pattern-control {
        display: flex;
        align-items: center;
        gap: 4px;
        white-space: nowrap;
      }
      web-audio-step-seq .wass-pattern-control label {
        opacity: 0.7;
      }
      web-audio-step-seq .wass-pattern-control input,
      web-audio-step-seq .wass-pattern-control select {
        font-size: 0.65rem;
        padding: 2px 4px;
        background: #222;
        color: #ccc;
        border: 1px solid #444;
        border-radius: 2px;
      }
      web-audio-step-seq .wass-rand-btn {
        font-family: monospace;
        font-size: 0.65rem;
        padding: 2px 8px;
        height: 20px;
        box-sizing: border-box;
        background: #222;
        color: var(--seq-color, #0f0);
        border: 1px solid var(--seq-color, #0f0);
        border-radius: 3px;
        cursor: pointer;
      }
      web-audio-step-seq .wass-rand-btn:hover {
        background: var(--seq-color, #0f0);
        color: #000;
      }
      web-audio-step-seq .wass-rand-row {
        grid-column: 1 / -1;
        display: flex;
        padding: 6px 4px;
        border-top: 1px solid #333;
      }
    `;
    document.head.appendChild(style);
  }

  constructor() {
    super();
    this._steps = [];
    this._stepEls = [];
    this._onBtns = [];
    this._noteSelects = [];
    this._accentChks = [];
    this._probabilityInputs = [];
    this._ratchetSelects = [];
    this._conditionSelects = [];
    this._hasAccent = false;
    this._hasProbability = false;
    this._hasRatchet = false;
    this._hasConditions = false;
    this._stepClass = "wass-step";
    this._initialized = false;

    // Pattern-level parameters
    this._patternParams = {
      playEvery: 1,
      rotationOffset: 0,
      rotationIntervalBars: 1,
    };
  }

  connectedCallback() {
    WebAudioStepSeq.#injectCSS();
    this._ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      const cols = w < 350 ? 4 : w < 650 ? 8 : 16;
      this.style.setProperty("--seq-cols", cols);
    });
    this._ro.observe(this);
  }

  disconnectedCallback() {
    this._ro?.disconnect();
  }

  /**
   * @param {object} options
   * @param {Array<{active: boolean, note: number, accent?: boolean, probability?: number, ratchet?: number, conditions?: string}>} options.steps
   * @param {Array<[string, number]>} [options.noteOptions]  [[name, midi], ...]
   * @param {boolean} [options.accent]   Show accent checkbox column
   * @param {boolean} [options.probability] Show probability slider column
   * @param {boolean} [options.ratchet] Show ratchet selector column
   * @param {boolean} [options.conditions] Show conditions selector column
   * @param {boolean} [options.patternControls] Show pattern-level controls (playEvery, rotation)
   * @param {string}  [options.color]    CSS color for the active/highlight state
   * @param {string}  [options.stepClass] Extra class applied to each step cell
   */
  init({
    steps,
    noteOptions = [],
    accent = false,
    probability = false,
    ratchet = false,
    conditions = false,
    patternControls = false,
    onRandomize = null,
    color,
    stepClass,
  } = {}) {
    WebAudioStepSeq.#injectCSS();
    this._steps = steps.map((s) => ({
      active: s.active,
      note: s.note,
      ...(accent ? { accent: s.accent ?? false } : {}),
      ...(probability ? { probability: s.probability ?? 1 } : {}),
      ...(ratchet ? { ratchet: s.ratchet ?? 1 } : {}),
      ...(conditions ? { conditions: s.conditions ?? "off" } : {}),
    }));
    this._hasAccent = accent;
    this._hasProbability = probability;
    this._hasRatchet = ratchet;
    this._hasConditions = conditions;
    this._patternControls = patternControls;
    this._onRandomize = onRandomize;
    if (color) this.style.setProperty("--seq-color", color);
    if (stepClass) this._stepClass = stepClass;
    this._initialized = true;
    this._render(noteOptions);
  }

  _render(noteOptions) {
    this.innerHTML = "";
    this._stepEls = [];
    this._onBtns = [];
    this._noteSelects = [];
    this._accentChks = [];
    this._probabilityInputs = [];
    this._ratchetSelects = [];
    this._conditionSelects = [];

    this._steps.forEach((step, i) => {
      const el = document.createElement("div");
      el.className = `wass-step ${this._stepClass}`;

      // Step number
      const num = document.createElement("div");
      num.className = "wass-num";
      num.textContent = i + 1;
      el.appendChild(num);

      // On/off button
      const onBtn = document.createElement("button");
      onBtn.className = `wass-on${step.active ? " on" : ""}`;
      onBtn.textContent = step.active ? "●" : "○";
      onBtn.addEventListener("click", () => {
        this._steps[i].active = !this._steps[i].active;
        onBtn.className = `wass-on${this._steps[i].active ? " on" : ""}`;
        onBtn.textContent = this._steps[i].active ? "●" : "○";
        this._dispatch(i);
      });
      el.appendChild(onBtn);
      this._onBtns.push(onBtn);

      // Note select
      const noteSelect = document.createElement("select");
      noteSelect.className = "wass-note";
      noteOptions.forEach(([name, midi]) => {
        const opt = document.createElement("option");
        opt.value = midi;
        opt.textContent = name;
        if (midi === step.note) opt.selected = true;
        noteSelect.appendChild(opt);
      });
      noteSelect.addEventListener("change", () => {
        this._steps[i].note = parseInt(noteSelect.value);
        this._dispatch(i);
      });
      el.appendChild(noteSelect);
      this._noteSelects.push(noteSelect);

      // Accent checkbox (optional)
      if (this._hasAccent) {
        const accentLabel = document.createElement("label");
        accentLabel.className = "wass-accent";
        accentLabel.title = "Accent — louder with stronger filter sweep";
        const accentChk = document.createElement("input");
        accentChk.type = "checkbox";
        accentChk.checked = step.accent ?? false;
        accentChk.addEventListener("change", () => {
          this._steps[i].accent = accentChk.checked;
          this._dispatch(i);
        });
        accentLabel.appendChild(accentChk);
        accentLabel.appendChild(document.createTextNode("Acc"));
        el.appendChild(accentLabel);
        this._accentChks.push(accentChk);
      }

      // Probability slider (optional)
      if (this._hasProbability) {
        const probLabel = document.createElement("label");
        probLabel.className = "wass-probability";
        probLabel.title = "Fire probability (0–100%)";
        const probInput = document.createElement("input");
        probInput.type = "range";
        probInput.min = "0";
        probInput.max = "100";
        probInput.step = "1";
        probInput.value = Math.round((step.probability ?? 1) * 100);
        probInput.addEventListener("input", () => {
          this._steps[i].probability = parseInt(probInput.value) / 100;
        });
        probInput.addEventListener("change", () => {
          this._steps[i].probability = parseInt(probInput.value) / 100;
          this._dispatch(i);
        });
        probLabel.appendChild(probInput);
        el.appendChild(probLabel);
        this._probabilityInputs.push(probInput);
      }

      // Ratchet selector (optional)
      if (this._hasRatchet) {
        const ratchetSelect = document.createElement("select");
        ratchetSelect.className = "wass-ratchet";
        ratchetSelect.title = "Ratchet — subdivide trigger into repeats";
        [1, 2, 3].forEach((val) => {
          const opt = document.createElement("option");
          opt.value = val;
          opt.textContent = `${val}x`;
          if (val === (step.ratchet ?? 1)) opt.selected = true;
          ratchetSelect.appendChild(opt);
        });
        ratchetSelect.addEventListener("change", () => {
          this._steps[i].ratchet = parseInt(ratchetSelect.value);
          this._dispatch(i);
        });
        el.appendChild(ratchetSelect);
        this._ratchetSelects.push(ratchetSelect);
      }

      // Conditions selector (optional)
      if (this._hasConditions) {
        const condSelect = document.createElement("select");
        condSelect.className = "wass-conditions";
        condSelect.title = "Conditions — gate by bar cycle";
        ["off", "1:2", "1:3", "1:4", "2:4", "3:4", "fill"].forEach((val) => {
          const opt = document.createElement("option");
          opt.value = val;
          opt.textContent = val === "off" ? "—" : val;
          if (val === (step.conditions ?? "off")) opt.selected = true;
          condSelect.appendChild(opt);
        });
        condSelect.addEventListener("change", () => {
          this._steps[i].conditions = condSelect.value;
          this._dispatch(i);
        });
        el.appendChild(condSelect);
        this._conditionSelects.push(condSelect);
      }

      this.appendChild(el);
      this._stepEls.push(el);
    });

    // Pattern-level controls (optional)
    if (this._patternControls) {
      const controlsDiv = document.createElement("div");
      controlsDiv.className = "wass-pattern-controls";

      // Play every N bars
      const playEveryDiv = document.createElement("div");
      playEveryDiv.className = "wass-pattern-control";
      const playEveryLabel = document.createElement("label");
      playEveryLabel.textContent = "Play";
      const playEveryInput = document.createElement("input");
      playEveryInput.type = "number";
      playEveryInput.min = "1";
      playEveryInput.max = "16";
      playEveryInput.value = this._patternParams.playEvery;
      playEveryInput.addEventListener("change", () => {
        this._patternParams.playEvery = parseInt(playEveryInput.value);
        this._dispatchPatternChange();
      });
      const playEveryOf = document.createElement("span");
      playEveryOf.textContent = "of N bars";
      playEveryDiv.appendChild(playEveryLabel);
      playEveryDiv.appendChild(playEveryInput);
      playEveryDiv.appendChild(playEveryOf);
      controlsDiv.appendChild(playEveryDiv);

      // Rotation offset
      const rotationDiv = document.createElement("div");
      rotationDiv.className = "wass-pattern-control";
      const rotationLabel = document.createElement("label");
      rotationLabel.textContent = "Rotate";
      const rotationInput = document.createElement("input");
      rotationInput.type = "number";
      rotationInput.min = "0";
      rotationInput.max = "15";
      rotationInput.value = this._patternParams.rotationOffset;
      rotationInput.addEventListener("change", () => {
        this._patternParams.rotationOffset = parseInt(rotationInput.value);
        this._dispatchPatternChange();
      });
      const rotationSteps = document.createElement("span");
      rotationSteps.textContent = "steps every";
      const rotationIntervalInput = document.createElement("input");
      rotationIntervalInput.type = "number";
      rotationIntervalInput.min = "1";
      rotationIntervalInput.max = "16";
      rotationIntervalInput.value = this._patternParams.rotationIntervalBars;
      rotationIntervalInput.addEventListener("change", () => {
        this._patternParams.rotationIntervalBars = parseInt(rotationIntervalInput.value);
        this._dispatchPatternChange();
      });
      const rotationBars = document.createElement("span");
      rotationBars.textContent = "bars";
      rotationDiv.appendChild(rotationLabel);
      rotationDiv.appendChild(rotationInput);
      rotationDiv.appendChild(rotationSteps);
      rotationDiv.appendChild(rotationIntervalInput);
      rotationDiv.appendChild(rotationBars);
      controlsDiv.appendChild(rotationDiv);

      if (this._onRandomize) {
        const randBtn = document.createElement("button");
        randBtn.textContent = "⚄ Rand";
        randBtn.className = "wass-rand-btn";
        randBtn.addEventListener("click", () => this._onRandomize());
        controlsDiv.appendChild(randBtn);
      }

      this.appendChild(controlsDiv);
    } else if (this._onRandomize) {
      const randRow = document.createElement("div");
      randRow.className = "wass-rand-row";
      const randBtn = document.createElement("button");
      randBtn.textContent = "⚄ Rand";
      randBtn.className = "wass-rand-btn";
      randBtn.addEventListener("click", () => this._onRandomize());
      randRow.appendChild(randBtn);
      this.appendChild(randRow);
    }
  }

  _dispatch(stepIndex) {
    this.dispatchEvent(
      new CustomEvent("step-change", {
        bubbles: true,
        detail: { index: stepIndex, step: { ...this._steps[stepIndex] } },
      }),
    );
  }

  _dispatchPatternChange() {
    this.dispatchEvent(
      new CustomEvent("pattern-change", {
        bubbles: true,
        detail: { params: { ...this._patternParams } },
      }),
    );
  }

  // ---- Public API ----

  /** Returns a snapshot copy of all step data. */
  get steps() {
    return this._steps.map((s) => ({ ...s }));
  }

  /** Replace all step data and re-render the UI. */
  set steps(newSteps) {
    if (!this._initialized) return;
    this._steps = newSteps.map((s) => ({
      active: s.active,
      note: s.note,
      ...(this._hasAccent ? { accent: s.accent ?? false } : {}),
      ...(this._hasProbability ? { probability: s.probability ?? 1 } : {}),
      ...(this._hasRatchet ? { ratchet: s.ratchet ?? 1 } : {}),
      ...(this._hasConditions ? { conditions: s.conditions ?? "off" } : {}),
    }));
    // Update UI in place without full re-render
    this._steps.forEach((step, i) => {
      const btn = this._onBtns[i];
      if (btn) {
        btn.className = `wass-on${step.active ? " on" : ""}`;
        btn.textContent = step.active ? "●" : "○";
      }
      const sel = this._noteSelects[i];
      if (sel) sel.value = step.note;
      const chk = this._accentChks[i];
      if (chk) chk.checked = step.accent ?? false;
      const probInput = this._probabilityInputs[i];
      if (probInput) probInput.value = Math.round((step.probability ?? 1) * 100);
      const ratchetSel = this._ratchetSelects[i];
      if (ratchetSel) ratchetSel.value = step.ratchet ?? 1;
      const condSel = this._conditionSelects[i];
      if (condSel) condSel.value = step.conditions ?? "off";
    });
  }

  /**
   * Update note select options (e.g. when root/scale changes).
   * Snaps each step's note to the nearest available MIDI value.
   * @param {Array<[string, number]>} opts  [[name, midi], ...]
   */
  setNoteOptions(opts) {
    if (!opts || !opts.length) {
      // Hide note selects when no options (e.g. drum mode)
      this._noteSelects.forEach((sel) => { sel.style.display = "none"; });
      return;
    }
    const vals = opts.map(([, m]) => m);
    this._noteSelects.forEach((sel, i) => {
      sel.style.display = "";
      const prev = parseInt(sel.value);
      sel.innerHTML = "";
      opts.forEach(([name, midi]) => {
        const opt = document.createElement("option");
        opt.value = midi;
        opt.textContent = name;
        sel.appendChild(opt);
      });
      const nearest = vals.reduce((a, b) => (Math.abs(b - prev) < Math.abs(a - prev) ? b : a), vals[0]);
      sel.value = nearest;
      this._steps[i].note = nearest;
    });
  }

  /**
   * Highlight the currently playing step; pass -1 to clear all.
   * @param {number} i
   */
  setActiveStep(i) {
    this._stepEls.forEach((el, idx) => el.classList.toggle("wass-active", idx === i));
  }

  /**
   * Get pattern-level parameters (playEvery, rotation, etc.)
   * @returns {object} {playEvery, rotationOffset, rotationIntervalBars}
   */
  getPatternParams() {
    return { ...this._patternParams };
  }

  /**
   * Set pattern-level parameters and update UI.
   * @param {object} params
   * @param {number} [params.playEvery] Play every N bars
   * @param {number} [params.rotationOffset] Rotate by N steps
   * @param {number} [params.rotationIntervalBars] Update rotation every M bars
   */
  setPatternParams(params) {
    if (params.playEvery != null) this._patternParams.playEvery = params.playEvery;
    if (params.rotationOffset != null) this._patternParams.rotationOffset = params.rotationOffset;
    if (params.rotationIntervalBars != null) this._patternParams.rotationIntervalBars = params.rotationIntervalBars;
    // Note: UI update would require re-render; assuming external code handles that
  }

  /**
   * Physically rotate the step array left by N positions and update the UI.
   * Step 0 becomes step (length - n), etc. This makes the visual pattern
   * always reflect what's actually playing.
   * @param {number} n  Number of positions to rotate left
   */
  rotate(n) {
    if (!this._steps.length || n === 0) return;
    const len = this._steps.length;
    const offset = ((n % len) + len) % len; // normalize to positive
    this._steps = [...this._steps.slice(offset), ...this._steps.slice(0, offset)];
    // Update UI in place
    this._steps.forEach((step, i) => {
      const btn = this._onBtns[i];
      if (btn) {
        btn.className = `wass-on${step.active ? " on" : ""}`;
        btn.textContent = step.active ? "●" : "○";
      }
      const sel = this._noteSelects[i];
      if (sel) sel.value = step.note;
      const chk = this._accentChks[i];
      if (chk) chk.checked = step.accent ?? false;
      const probInput = this._probabilityInputs[i];
      if (probInput) probInput.value = Math.round((step.probability ?? 1) * 100);
      const ratchetSel = this._ratchetSelects[i];
      if (ratchetSel) ratchetSel.value = step.ratchet ?? 1;
      const condSel = this._conditionSelects[i];
      if (condSel) condSel.value = step.conditions ?? "off";
    });
    this.dispatchEvent(new CustomEvent("step-change", { bubbles: true, detail: { rotated: n } }));
  }
}

customElements.define("web-audio-step-seq", WebAudioStepSeq);
