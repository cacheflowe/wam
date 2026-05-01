import WebAudioInstrumentBase from "../web-audio-instrument-base.js";
import "../web-audio-step-seq.js";
import { STEP_WEIGHTS } from "../web-audio-scales.js";
import { WebAudioControlsBase, createSection } from "../web-audio-controls-base.js";

/**
 * WebAudioPercKick — 808-style kick via sine oscillator with pitch sweep.
 *
 * A sine starts at a high frequency and rapidly drops to a low thump,
 * while the amplitude decays. Adjust startFreq/endFreq/sweepTime/decay
 * for different flavors (punchy, boomy, snappy).
 *
 * Usage:
 *   const kick = new WebAudioPercKick(ctx);
 *   kick.connect(ctx.destination);
 *   kick.trigger(0.9, time);
 */
export default class WebAudioPercKick extends WebAudioInstrumentBase {
  static PRESETS = {
    Default: { startFreq: 150, endFreq: 40, sweepTime: 0.08, decay: 0.35, volume: 1 },
    Punchy: { startFreq: 200, endFreq: 50, sweepTime: 0.05, decay: 0.25, volume: 1 },
    Boomy: { startFreq: 100, endFreq: 30, sweepTime: 0.15, decay: 0.6, volume: 0.9 },
    Snap: { startFreq: 300, endFreq: 60, sweepTime: 0.03, decay: 0.18, volume: 1 },
  };

  constructor(ctx, preset = "Default") {
    super(ctx, preset);
  }

  /**
   * @param {number} [velocity]  0–1
   * @param {number} [atTime]    AudioContext time
   */
  trigger(velocity = 1, atTime = 0) {
    const ctx = this.ctx;
    const t = atTime > 0 ? atTime : ctx.currentTime;

    const osc = ctx.createOscillator();
    const amp = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(this.startFreq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, this.endFreq), t + this.sweepTime);

    amp.gain.setValueAtTime(velocity, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + this.decay);

    osc.connect(amp);
    amp.connect(this._out);

    osc.start(t);
    osc.stop(t + this.decay + 0.05);

    return this;
  }
}

// ---- Controls companion component ----

export class WebAudioPercKickControls extends WebAudioControlsBase {
  static SLIDER_DEFS = [
    { param: "startFreq", label: "Start Freq", min: 50, max: 500, step: 1,    tooltip: "Starting pitch of the kick's pitch sweep in Hz." },
    { param: "endFreq",   label: "End Freq",   min: 20, max: 200, step: 1,    tooltip: "Final pitch of the kick at the end of the sweep." },
    { param: "sweepTime", label: "Sweep",      min: 0.01, max: 0.5, step: 0.01, tooltip: "Duration of the pitch sweep from start to end frequency." },
    { param: "decay",     label: "Decay",      min: 0.05, max: 1.5, step: 0.01, tooltip: "Amplitude decay time. Longer = punchier, sustaining kick." },
    { param: "volume",    label: "Vol",        min: 0,    max: 1,   step: 0.01 },
  ];

  static DEFAULT_PATTERN() {
    return Array.from({ length: 16 }, (_, i) => ({
      active: i === 0 || i === 8,
      probability: 1,
      ratchet: 1,
      conditions: "off",
    }));
  }

  constructor() {
    super();
    this._seq = null;

    // Sequencer position tracking
    this._globalStep = 0;
    this._seqPosition = 0;
  }

  _defaultColor() { return "#f44"; }
  _defaultTitle() { return "Kick"; }
  _fxTitle() { return "Kick FX"; }

  _buildControls(controls, expanded, mkSlider, ctx, options) {
    const color = options.color || this._defaultColor();

    const { el, controls: sec } = createSection("Kick");
    this._makePresetDropdown(WebAudioPercKick.PRESETS, sec);
    sec.appendChild(mkSlider({ param: "startFreq", label: "Start Freq", min: 50, max: 500, step: 1 }));
    sec.appendChild(mkSlider({ param: "endFreq", label: "End Freq", min: 20, max: 200, step: 1 }));
    sec.appendChild(mkSlider({ param: "sweepTime", label: "Sweep", min: 0.01, max: 0.5, step: 0.01 }));
    sec.appendChild(mkSlider({ param: "decay", label: "Decay", min: 0.05, max: 1.5, step: 0.01 }));
    controls.appendChild(el);

    // ---- Sequencer Speed ----
    const { el: speedEl, controls: speedCtrl } = createSection("Sequencer");
    const speedSelect = document.createElement("select");
    speedSelect.className = "wac-select";
    [0.5, 1, 2].forEach((val) => {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = val === 0.5 ? "0.5x" : val === 1 ? "1x (Normal)" : "2x";
      if (val === 1) opt.selected = true;
      speedSelect.appendChild(opt);
    });
    speedSelect.addEventListener("change", () => {
      this.speedMultiplier = parseFloat(speedSelect.value);
      this._emitChange();
    });
    const speedLabel = document.createElement("label");
    speedLabel.style.display = "flex";
    speedLabel.style.gap = "6px";
    speedLabel.style.alignItems = "center";
    speedLabel.appendChild(document.createTextNode("Speed:"));
    speedLabel.appendChild(speedSelect);
    speedCtrl.appendChild(speedLabel);
    controls.appendChild(speedEl);

    // Randomize button
    const actionRow = document.createElement("div");
    actionRow.className = "wac-action-row";
    const randBtn = document.createElement("button");
    randBtn.textContent = "\u2684 Randomize";
    randBtn.className = "wac-action-btn";
    randBtn.addEventListener("click", () => this.randomize());
    actionRow.appendChild(randBtn);
    expanded.appendChild(actionRow);

    // Step sequencer (no note selection for percussion)
    this._seq = document.createElement("web-audio-step-seq");
    this._seq.init({
      steps: WebAudioPercKickControls.DEFAULT_PATTERN(),
      probability: true,
      ratchet: true,
      conditions: true,
      patternControls: true,
      color,
    });
    expanded.appendChild(this._seq);
    this._seq.addEventListener("step-change", () => this._emitChange());
    this._seq.addEventListener("pattern-change", () => this._emitChange());
  }

  // ---- Sequencer integration ----

  step(index, time, stepDurationSec) {
    if (!this._instrument || !this._seq) return;

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
        this._seq.rotate(rotationOffset);
      }
    }

    // Bar density
    const currentBar = Math.floor(this._globalStep / 16);
    if (currentBar % playEvery !== 0) {
      this._globalStep++;
      return;
    }

    // Advance sequencer position (2x = 2 steps per tick, offset in time)
    const stepsToAdvance = multiplier === 2 ? 2 : 1;
    const subStepDur = stepDurationSec / stepsToAdvance;
    for (let si = 0; si < stepsToAdvance; si++) {
      const subTime = time + si * subStepDur;
      const stepIndex = this._seqPosition % 16;
      const s = this._seq.steps[stepIndex];

      if (s?.active) {
        if (Math.random() < (s.probability ?? 1)) {
          if (!s.conditions || s.conditions === "off" || this._meetsCondition(s.conditions, currentBar)) {
            const ratchet = s.ratchet ?? 1;
            if (ratchet > 1) {
              const ratchetDuration = subStepDur / ratchet;
              for (let i = 0; i < ratchet; i++) {
                this._instrument.trigger(0.9, subTime + i * ratchetDuration);
              }
            } else {
              this._instrument.trigger(0.9, subTime);
            }
          }
        }
      }

      this._seqPosition++;
    }

    this._globalStep++;
  }

  _meetsCondition(condition, barIndex) {
    switch (condition) {
      case "off": return true;
      case "1:2": return barIndex % 2 === 0;
      case "3:4": return barIndex % 4 === 2;
      case "fill": return barIndex % 4 === 3;
      default: return true;
    }
  }

  setActiveStep() {
    this._seq?.setActiveStep((this._seqPosition - 1 + 16) % 16);
  }

  randomize() {
    const newSteps = Array.from({ length: 16 }, (_, i) => ({
      active: Math.random() < STEP_WEIGHTS[i] * 0.5,
      probability: 1,
      ratchet: 1,
      conditions: "off",
    }));
    newSteps[0] = { active: true, probability: 1, ratchet: 1, conditions: "off" };
    if (this._seq) this._seq.steps = newSteps;
    this._emitChange();
  }

  // ---- Serialization ----

  _extendJSON(obj) {
    obj.steps = this._seq?.steps ?? [];
  }

  _restoreExtra(obj) {
    if (obj.steps && this._seq) this._seq.steps = obj.steps;
  }
}

customElements.define("web-audio-perc-kick-controls", WebAudioPercKickControls);
