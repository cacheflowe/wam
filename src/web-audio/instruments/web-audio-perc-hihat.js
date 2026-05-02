import WebAudioInstrumentBase from "../web-audio-instrument-base.js";
import "../web-audio-step-seq.js";
import { STEP_WEIGHTS } from "../web-audio-scales.js";
import { WebAudioControlsBase, createSection } from "../web-audio-controls-base.js";

/**
 * WebAudioPercHihat — 909-style hi-hat with metallic oscillators + noise.
 *
 * Combines 6 detuned square oscillators (metallic ring) with filtered noise,
 * controlled by a mix knob. Supports open/closed modes with choke behavior
 * (triggering a closed hat cuts any ringing open hat).
 *
 * Usage:
 *   const hihat = new WebAudioPercHihat(ctx);
 *   hihat.connect(ctx.destination);
 *   hihat.trigger(0.7, time);        // uses current open/closed setting
 *   hihat.trigger(0.7, time, true);   // force open
 *   hihat.trigger(0.7, time, false);  // force closed (chokes open)
 */
export default class WebAudioPercHihat extends WebAudioInstrumentBase {
  // Metallic oscillator frequency ratios (909-inspired, relative to base tone)
  static METAL_RATIOS = [1, 1.4471, 1.6170, 1.9265, 2.5028, 2.6637];

  static PRESETS = {
    Default:  { tone: 320, metalMix: 0.5, filterFreq: 8000, filterQ: 0.8, decay: 0.06, openDecay: 0.3, volume: 1 },
    "909":    { tone: 330, metalMix: 0.7, filterFreq: 9000, filterQ: 1.0, decay: 0.05, openDecay: 0.35, volume: 1 },
    "808":    { tone: 280, metalMix: 0.2, filterFreq: 7000, filterQ: 0.6, decay: 0.06, openDecay: 0.28, volume: 0.9 },
    Bright:   { tone: 400, metalMix: 0.6, filterFreq: 12000, filterQ: 0.5, decay: 0.04, openDecay: 0.25, volume: 1 },
    Dark:     { tone: 250, metalMix: 0.4, filterFreq: 5000, filterQ: 1.2, decay: 0.08, openDecay: 0.35, volume: 0.8 },
    Shaker:   { tone: 280, metalMix: 0.1, filterFreq: 6000, filterQ: 0.5, decay: 0.12, openDecay: 0.2, volume: 0.7 },
    Metallic: { tone: 360, metalMix: 0.9, filterFreq: 10000, filterQ: 1.5, decay: 0.05, openDecay: 0.4, volume: 0.9 },
  };

  constructor(ctx, preset = "Default") {
    super(ctx, null);
    this._noiseBuffer = this._buildNoiseBuffer();
    this._activeGain = null; // for choke behavior
    this.isOpen = false;
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
   * @param {boolean} [open]     Force open (true) or closed (false). Uses this.isOpen if undefined.
   */
  trigger(velocity = 1, atTime = 0, open) {
    const ctx = this.ctx;
    const t = atTime > 0 ? atTime : ctx.currentTime;
    const isOpen = open !== undefined ? open : this.isOpen;
    const decay = isOpen ? this.openDecay : this.decay;

    // Choke: kill any previous ringing hat
    if (this._activeGain) {
      this._activeGain.gain.cancelScheduledValues(t);
      this._activeGain.gain.setValueAtTime(this._activeGain.gain.value, t);
      this._activeGain.gain.exponentialRampToValueAtTime(0.001, t + 0.005);
      this._activeGain = null;
    }

    // Master amp for this hit (shared by metal + noise layers)
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(velocity, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + decay);
    amp.connect(this._out);
    this._activeGain = isOpen ? amp : null; // only track open hats for choke

    // Highpass on the output for brightness
    const hpf = ctx.createBiquadFilter();
    hpf.type = "highpass";
    hpf.frequency.value = this.filterFreq;
    hpf.Q.value = this.filterQ;
    hpf.connect(amp);

    // ---- Metallic oscillator layer ----
    if (this.metalMix > 0.01) {
      const metalGain = ctx.createGain();
      metalGain.gain.value = this.metalMix;
      metalGain.connect(hpf);

      for (const ratio of WebAudioPercHihat.METAL_RATIOS) {
        const osc = ctx.createOscillator();
        osc.type = "square";
        osc.frequency.value = this.tone * ratio;
        osc.connect(metalGain);
        osc.start(t);
        osc.stop(t + decay + 0.05);
      }
    }

    // ---- Noise layer ----
    const noiseMix = 1 - this.metalMix;
    if (noiseMix > 0.01) {
      const noiseGain = ctx.createGain();
      noiseGain.gain.value = noiseMix;
      noiseGain.connect(hpf);

      const noise = ctx.createBufferSource();
      noise.buffer = this._noiseBuffer;
      const bpf = ctx.createBiquadFilter();
      bpf.type = "bandpass";
      bpf.frequency.value = this.filterFreq;
      bpf.Q.value = this.filterQ * 0.5;
      noise.connect(bpf);
      bpf.connect(noiseGain);
      noise.start(t);
      noise.stop(t + decay + 0.05);
    }

    return this;
  }
}

// ---- Controls companion component ----

export class WebAudioPercHihatControls extends WebAudioControlsBase {
  static SLIDER_DEFS = [
    { param: "tone",       label: "Tone",    min: 150, max: 600,   step: 1,    tooltip: "Base frequency for metallic oscillators. Tunes the hat's pitch." },
    { param: "metalMix",   label: "Metal",   min: 0,   max: 1,     step: 0.01, tooltip: "Balance between metallic oscillators (1) and noise (0)." },
    { param: "filterFreq", label: "Freq",    min: 2000, max: 16000, step: 1, scale: "log", tooltip: "Highpass filter frequency. Higher = brighter, thinner." },
    { param: "filterQ",    label: "Q",       min: 0.1,  max: 5,     step: 0.1, tooltip: "Filter resonance. Higher = more ringing, focused." },
    { param: "decay",      label: "Closed",  min: 0.01, max: 0.2,   step: 0.01, tooltip: "Closed hat decay time." },
    { param: "openDecay",  label: "Open",    min: 0.05, max: 0.8,   step: 0.01, tooltip: "Open hat decay time. Open hats are choked by closed hits." },
    { param: "volume",     label: "Vol",     min: 0,    max: 1,     step: 0.01 },
  ];

  static DEFAULT_PATTERN() {
    return Array.from({ length: 16 }, (_, i) => ({
      active: i % 2 === 0,
      probability: 1,
      ratchet: 1,
      conditions: "off",
      open: false,
    }));
  }

  constructor() {
    super();
    this._seq = null;
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
    sec.appendChild(mkSlider({ param: "tone",       label: "Tone",   min: 150, max: 600,   step: 1 }));
    sec.appendChild(mkSlider({ param: "metalMix",   label: "Metal",  min: 0,   max: 1,     step: 0.01 }));
    sec.appendChild(mkSlider({ param: "filterFreq", label: "Freq",   min: 2000, max: 16000, step: 1, scale: "log" }));
    sec.appendChild(mkSlider({ param: "filterQ",    label: "Q",      min: 0.1,  max: 5,     step: 0.1 }));
    sec.appendChild(mkSlider({ param: "decay",      label: "Closed", min: 0.01, max: 0.2,   step: 0.01 }));
    sec.appendChild(mkSlider({ param: "openDecay",  label: "Open",   min: 0.05, max: 0.8,   step: 0.01 }));
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

    // Step sequencer with open/closed hat support
    this._seq = document.createElement("web-audio-step-seq");
    this._seq.init({
      steps: WebAudioPercHihatControls.DEFAULT_PATTERN(),
      probability: true,
      ratchet: true,
      conditions: true,
      patternControls: true,
      openClose: true,
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
            const isOpen = s.open ?? false;
            if (ratchet > 1) {
              const ratchetDuration = subStepDur / ratchet;
              for (let i = 0; i < ratchet; i++) {
                this._instrument.trigger(0.7, subTime + i * ratchetDuration, isOpen);
              }
            } else {
              this._instrument.trigger(0.7, subTime, isOpen);
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
      open: Math.random() < 0.15, // occasional open hats
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
