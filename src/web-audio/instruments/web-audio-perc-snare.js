import WebAudioInstrumentBase from "../web-audio-instrument-base.js";
import "../web-audio-step-seq.js";
import { STEP_WEIGHTS } from "../web-audio-scales.js";
import { WebAudioControlsBase, createSection } from "../web-audio-controls-base.js";

/**
 * WebAudioPercSnare — layered snare drum: pitched tone body + filtered noise snap.
 *
 * The tone layer uses a sine oscillator with fast pitch sweep (like kick, but higher).
 * The noise layer uses highpass-filtered white noise for the snare rattle/crack.
 * Optional clap mode fires multiple noise bursts with micro-timing offsets.
 *
 * Usage:
 *   const snare = new WebAudioPercSnare(ctx);
 *   snare.connect(ctx.destination);
 *   snare.trigger(0.8, time);
 */
export default class WebAudioPercSnare extends WebAudioInstrumentBase {
  static PRESETS = {
    Default: {
      toneFreq: 200,
      toneSweep: 80,
      toneDecay: 0.08,
      noiseFreq: 1500,
      noiseDecay: 0.15,
      noiseMix: 0.6,
      clapMode: false,
      volume: 1,
    },
    808: {
      toneFreq: 180,
      toneSweep: 60,
      toneDecay: 0.12,
      noiseFreq: 1200,
      noiseDecay: 0.2,
      noiseMix: 0.5,
      clapMode: false,
      volume: 1,
    },
    Tight: {
      toneFreq: 250,
      toneSweep: 100,
      toneDecay: 0.04,
      noiseFreq: 2500,
      noiseDecay: 0.08,
      noiseMix: 0.7,
      clapMode: false,
      volume: 1,
    },
    Clap: {
      toneFreq: 200,
      toneSweep: 50,
      toneDecay: 0.02,
      noiseFreq: 1800,
      noiseDecay: 0.18,
      noiseMix: 0.95,
      clapMode: true,
      volume: 0.9,
    },
    Rim: {
      toneFreq: 400,
      toneSweep: 150,
      toneDecay: 0.03,
      noiseFreq: 4000,
      noiseDecay: 0.04,
      noiseMix: 0.3,
      clapMode: false,
      volume: 1,
    },
    Industrial: {
      toneFreq: 150,
      toneSweep: 40,
      toneDecay: 0.15,
      noiseFreq: 800,
      noiseDecay: 0.25,
      noiseMix: 0.4,
      clapMode: false,
      volume: 0.9,
    },
    Brush: {
      toneFreq: 180,
      toneSweep: 30,
      toneDecay: 0.03,
      noiseFreq: 3000,
      noiseDecay: 0.35,
      noiseMix: 0.85,
      clapMode: false,
      volume: 0.6,
    },
  };

  constructor(ctx, preset = "Default") {
    super(ctx, null);
    this._noiseBuffer = this._buildNoiseBuffer();
    this.applyPreset(preset);
  }

  _buildNoiseBuffer() {
    const ctx = this.ctx;
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

    // ---- Tone body (pitched sine with fast sweep) ----
    const toneGain = 1 - this.noiseMix;
    if (toneGain > 0.01) {
      const osc = ctx.createOscillator();
      const amp = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(this.toneFreq, t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, this.toneFreq - this.toneSweep), t + this.toneDecay * 0.5);
      amp.gain.setValueAtTime(velocity * toneGain, t);
      amp.gain.exponentialRampToValueAtTime(0.001, t + this.toneDecay);
      osc.connect(amp);
      amp.connect(this._out);
      osc.start(t);
      osc.stop(t + this.toneDecay + 0.05);
    }

    // ---- Noise snap (filtered white noise) ----
    if (this.noiseMix > 0.01) {
      if (this.clapMode) {
        // Clap: 3 micro-bursts with random timing offsets
        for (let i = 0; i < 3; i++) {
          const offset = i * (0.008 + Math.random() * 0.012);
          this._fireNoiseBurst(velocity * this.noiseMix * 0.8, t + offset);
        }
      } else {
        this._fireNoiseBurst(velocity * this.noiseMix, t);
      }
    }

    return this;
  }

  _fireNoiseBurst(gain, t) {
    const ctx = this.ctx;
    const noise = ctx.createBufferSource();
    noise.buffer = this._noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = this.noiseFreq;
    filter.Q.value = 0.7;

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + this.noiseDecay);

    noise.connect(filter);
    filter.connect(amp);
    amp.connect(this._out);

    noise.start(t);
    noise.stop(t + this.noiseDecay + 0.05);
  }
}

// ---- Controls companion component ----

export class WebAudioPercSnareControls extends WebAudioControlsBase {
  static SLIDER_DEFS = [
    {
      param: "toneFreq",
      label: "Tone",
      min: 80,
      max: 500,
      step: 1,
      tooltip: "Tone body pitch in Hz. Higher = snappier, lower = thumpier.",
    },
    {
      param: "toneSweep",
      label: "Sweep",
      min: 0,
      max: 300,
      step: 1,
      tooltip: "Pitch drop amount. More = punchier attack transient.",
    },
    { param: "toneDecay", label: "T.Decay", min: 0.01, max: 0.3, step: 0.01, tooltip: "Tone body decay time." },
    {
      param: "noiseFreq",
      label: "N.Freq",
      min: 500,
      max: 8000,
      step: 1,
      scale: "log",
      tooltip: "Noise highpass filter frequency. Lower = fatter, higher = crackly.",
    },
    {
      param: "noiseDecay",
      label: "N.Decay",
      min: 0.02,
      max: 0.5,
      step: 0.01,
      tooltip: "Noise snap/rattle decay time.",
    },
    {
      param: "noiseMix",
      label: "Mix",
      min: 0,
      max: 1,
      step: 0.01,
      tooltip: "Balance between tone body (0) and noise snap (1).",
    },
    { param: "volume", label: "Vol", min: 0, max: 1, step: 0.01 },
  ];

  static DEFAULT_PATTERN() {
    return Array.from({ length: 16 }, (_, i) => ({
      active: i === 4 || i === 12,
      probability: 1,
      ratchet: 1,
      conditions: "off",
    }));
  }

  constructor() {
    super();
    this._seq = null;
    this._globalStep = 0;
    this._seqPosition = 0;
  }

  _defaultColor() {
    return "#f80";
  }
  _defaultTitle() {
    return "Snare";
  }
  _fxTitle() {
    return "Snare FX";
  }

  _buildControls(controls, expanded, mkSlider, ctx, options) {
    const color = options.color || this._defaultColor();

    const { el, controls: sec } = createSection("Snare");
    this._makePresetDropdown(WebAudioPercSnare.PRESETS, sec);

    // Clap mode toggle
    const clapBtn = document.createElement("button");
    clapBtn.className = "wac-wave-btn";
    clapBtn.textContent = "CLAP";
    clapBtn.classList.toggle("wac-wave-active", !!this._instrument.clapMode);
    clapBtn.addEventListener("click", () => {
      this._instrument.clapMode = !this._instrument.clapMode;
      clapBtn.classList.toggle("wac-wave-active", this._instrument.clapMode);
      this._emitChange();
    });
    this._clapBtn = clapBtn;
    sec.appendChild(clapBtn);

    sec.appendChild(mkSlider({ param: "toneFreq", label: "Tone", min: 80, max: 500, step: 1 }));
    sec.appendChild(mkSlider({ param: "toneSweep", label: "Sweep", min: 0, max: 300, step: 1 }));
    sec.appendChild(mkSlider({ param: "toneDecay", label: "T.Decay", min: 0.01, max: 0.3, step: 0.01 }));
    sec.appendChild(mkSlider({ param: "noiseFreq", label: "N.Freq", min: 500, max: 8000, step: 1, scale: "log" }));
    sec.appendChild(mkSlider({ param: "noiseDecay", label: "N.Decay", min: 0.02, max: 0.5, step: 0.01 }));
    sec.appendChild(mkSlider({ param: "noiseMix", label: "Mix", min: 0, max: 1, step: 0.01 }));
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
      steps: WebAudioPercSnareControls.DEFAULT_PATTERN(),
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

  // ---- Extra controls sync ----

  _syncExtraControls() {
    if (this._clapBtn && this._instrument) {
      this._clapBtn.classList.toggle("wac-wave-active", !!this._instrument.clapMode);
    }
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
                this._instrument.trigger(0.8, subTime + i * ratchetDuration);
              }
            } else {
              this._instrument.trigger(0.8, subTime);
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
      case "off":
        return true;
      case "1:2":
        return barIndex % 2 === 0;
      case "3:4":
        return barIndex % 4 === 2;
      case "fill":
        return barIndex % 4 === 3;
      default:
        return true;
    }
  }

  setActiveStep() {
    this._seq?.setActiveStep((this._seqPosition - 1 + 16) % 16);
  }

  randomize() {
    const newSteps = Array.from({ length: 16 }, (_, i) => ({
      active: Math.random() < STEP_WEIGHTS[i] * 0.6,
      probability: 1,
      ratchet: 1,
      conditions: "off",
    }));
    if (this._seq) this._seq.steps = newSteps;
    this._emitChange();
  }

  // ---- Serialization ----

  _extraToJSON(params) {
    params.clapMode = this._instrument?.clapMode ?? false;
  }

  _extendJSON(obj) {
    obj.steps = this._seq?.steps ?? [];
  }

  _restoreParam(key, val) {
    if (key === "clapMode") {
      this._instrument.clapMode = val;
      this._syncExtraControls();
    } else {
      super._restoreParam(key, val);
    }
  }

  _restoreExtra(obj) {
    if (obj.steps && this._seq) this._seq.steps = obj.steps;
  }
}

customElements.define("web-audio-perc-snare-controls", WebAudioPercSnareControls);
