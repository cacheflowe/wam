import WebAudioInstrumentBase from "../web-audio-instrument-base.js";
import "../web-audio-step-seq.js";
import { STEP_WEIGHTS } from "../web-audio-scales.js";
import { WebAudioControlsBase, createSection } from "../web-audio-controls-base.js";

/**
 * WebAudioPercHihat — bandpass-filtered white noise with fast amplitude decay.
 *
 * A pre-generated noise buffer is reused across all triggers for efficiency.
 * Adjust filterFreq/filterQ for open vs closed character, decay for length.
 *
 * Usage:
 *   const hihat = new WebAudioPercHihat(ctx, { decay: 0.04 }); // tight closed hat
 *   hihat.connect(ctx.destination);
 *   hihat.trigger(0.6, time);
 */
export default class WebAudioPercHihat extends WebAudioInstrumentBase {
  static PRESETS = {
    Default: { filterFreq: 8000, filterQ: 0.8, decay: 0.06, volume: 1 },
    Open: { filterFreq: 7000, filterQ: 0.6, decay: 0.3, volume: 0.8 },
    Tight: { filterFreq: 9000, filterQ: 1.2, decay: 0.03, volume: 1 },
    Shaker: { filterFreq: 6000, filterQ: 0.5, decay: 0.12, volume: 0.7 },
  };

  constructor(ctx, preset = "Default") {
    super(ctx, null);
    this._noiseBuffer = this._buildNoiseBuffer();
    this.applyPreset(preset);
  }

  _buildNoiseBuffer() {
    const ctx = this.ctx;
    // Half-second of mono white noise, reused across all triggers
    const length = Math.floor(ctx.sampleRate * 0.5);
    const buf = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /**
   * @param {number} [velocity]  0–1
   * @param {number} [atTime]    AudioContext time
   */
  trigger(velocity = 1, atTime = 0) {
    const ctx = this.ctx;
    const t = atTime > 0 ? atTime : ctx.currentTime;

    const noise = ctx.createBufferSource();
    noise.buffer = this._noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = this.filterFreq;
    filter.Q.value = this.filterQ;

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(velocity, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + this.decay);

    noise.connect(filter);
    filter.connect(amp);
    amp.connect(this._out);

    noise.start(t);
    noise.stop(t + this.decay + 0.05);

    return this;
  }
}

// ---- Controls companion component ----

export class WebAudioPercHihatControls extends WebAudioControlsBase {
  static SLIDER_DEFS = [
    { param: "filterFreq", label: "Freq",  min: 2000, max: 16000, step: 1,   scale: "log", tooltip: "Bandpass filter center frequency. Lower = closed, higher = bright." },
    { param: "filterQ",    label: "Q",     min: 0.1,  max: 5,     step: 0.1,               tooltip: "Filter sharpness. Higher = more metallic, focused tone." },
    { param: "decay",      label: "Decay", min: 0.01, max: 0.5,   step: 0.01,              tooltip: "Amplitude decay time. Shorter = tighter, ticking hat." },
    { param: "volume",     label: "Vol",   min: 0,    max: 1,     step: 0.01 },
  ];

  static DEFAULT_PATTERN() {
    return Array.from({ length: 16 }, (_, i) => ({
      active: i % 2 === 0,
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

  _defaultColor() { return "#ff0"; }
  _defaultTitle() { return "Hi-Hat"; }
  _fxTitle() { return "HiHat FX"; }

  _buildControls(controls, expanded, mkSlider, ctx, options) {
    const color = options.color || this._defaultColor();

    const { el, controls: sec } = createSection("Hi-Hat");
    this._makePresetDropdown(WebAudioPercHihat.PRESETS, sec);
    sec.appendChild(mkSlider({ param: "filterFreq", label: "Freq",  min: 2000, max: 16000, step: 1,   scale: "log" }));
    sec.appendChild(mkSlider({ param: "filterQ",    label: "Q",     min: 0.1,  max: 5,     step: 0.1 }));
    sec.appendChild(mkSlider({ param: "decay",      label: "Decay", min: 0.01, max: 0.5,   step: 0.01 }));
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
      steps: WebAudioPercHihatControls.DEFAULT_PATTERN(),
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
                this._instrument.trigger(0.7, subTime + i * ratchetDuration);
              }
            } else {
              this._instrument.trigger(0.7, subTime);
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
      active: Math.random() < STEP_WEIGHTS[i] * 0.8,
      probability: 1,
      ratchet: 1,
      conditions: "off",
    }));
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

customElements.define("web-audio-perc-hihat-controls", WebAudioPercHihatControls);
