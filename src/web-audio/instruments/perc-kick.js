import WebAudioInstrumentBase from "../global/instrument-base.js";
import "../ui/step-seq.js";
import { STEP_WEIGHTS } from "../global/scales.js";
import { WebAudioControlsBase, createSection } from "../ui/controls-base.js";

/**
 * WebAudioPercKick — Enhanced kick drum with pitch sweep, click transient, and drive.
 *
 * Layers:
 *   1. Body — sine oscillator with exponential pitch sweep (classic 808/909)
 *   2. Click — short noise/triangle burst for attack definition (909-style)
 *   3. Drive — WaveShaperNode saturation for grit and presence
 *
 * Usage:
 *   const kick = new WebAudioPercKick(ctx);
 *   kick.connect(ctx.destination);
 *   kick.trigger(0.9, time);
 */
export default class WebAudioPercKick extends WebAudioInstrumentBase {
  static PRESETS = {
    Default:  { startFreq: 150, endFreq: 40, sweepTime: 0.08, decay: 0.35, click: 0.3, drive: 0, volume: 1 },
    "808":    { startFreq: 140, endFreq: 35, sweepTime: 0.1,  decay: 0.45, click: 0.1, drive: 0, volume: 1 },
    "909":    { startFreq: 200, endFreq: 50, sweepTime: 0.05, decay: 0.28, click: 0.7, drive: 0.2, volume: 1 },
    Punchy:   { startFreq: 200, endFreq: 50, sweepTime: 0.05, decay: 0.25, click: 0.5, drive: 0.1, volume: 1 },
    Boomy:    { startFreq: 100, endFreq: 30, sweepTime: 0.15, decay: 0.6,  click: 0.1, drive: 0, volume: 0.9 },
    Hard:     { startFreq: 250, endFreq: 45, sweepTime: 0.04, decay: 0.3,  click: 0.8, drive: 0.5, volume: 1 },
    Distorted:{ startFreq: 180, endFreq: 40, sweepTime: 0.06, decay: 0.35, click: 0.4, drive: 0.8, volume: 0.9 },
    Sub:      { startFreq: 80,  endFreq: 30, sweepTime: 0.2,  decay: 0.7,  click: 0,   drive: 0, volume: 1 },
  };

  constructor(ctx, preset = "Default") {
    super(ctx, null);
    // Build drive waveshaper (shared across triggers)
    this._driveNode = ctx.createWaveShaper();
    this._driveNode.connect(this._out);
    this._updateDriveCurve(0);
    this.applyPreset(preset);
  }

  _updateDriveCurve(amount) {
    // Soft-clip curve: tanh-based saturation
    const samples = 256;
    const curve = new Float32Array(samples);
    const k = 1 + amount * 20; // 1 = clean, 21 = heavy distortion
    for (let i = 0; i < samples; i++) {
      const x = (i / (samples - 1)) * 2 - 1;
      curve[i] = Math.tanh(k * x) / Math.tanh(k);
    }
    this._driveNode.curve = curve;
    this._driveNode.oversample = amount > 0.3 ? "4x" : "none";
  }

  set drive(v) {
    this._drive = v;
    this._updateDriveCurve(v);
  }
  get drive() { return this._drive ?? 0; }

  /**
   * @param {number} [velocity]  0–1
   * @param {number} [atTime]    AudioContext time
   */
  trigger(velocity = 1, atTime = 0) {
    const ctx = this.ctx;
    const t = atTime > 0 ? atTime : ctx.currentTime;
    const dest = this._drive > 0 ? this._driveNode : this._out;

    // ---- Body (sine with pitch sweep) ----
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(this.startFreq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, this.endFreq), t + this.sweepTime);

    amp.gain.setValueAtTime(velocity, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + this.decay);

    osc.connect(amp);
    amp.connect(dest);

    osc.start(t);
    osc.stop(t + this.decay + 0.05);

    // ---- Click transient (short noise + triangle burst) ----
    if (this.click > 0.01) {
      const clickDur = 0.008; // 8ms click

      // Noise click
      const noiseLen = Math.floor(ctx.sampleRate * 0.02);
      const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
      const noiseData = noiseBuf.getChannelData(0);
      for (let i = 0; i < noiseLen; i++) noiseData[i] = Math.random() * 2 - 1;
      const noiseSrc = ctx.createBufferSource();
      noiseSrc.buffer = noiseBuf;

      const clickHpf = ctx.createBiquadFilter();
      clickHpf.type = "highpass";
      clickHpf.frequency.value = 2000;

      const clickAmp = ctx.createGain();
      clickAmp.gain.setValueAtTime(velocity * this.click * 0.6, t);
      clickAmp.gain.exponentialRampToValueAtTime(0.001, t + clickDur);

      noiseSrc.connect(clickHpf);
      clickHpf.connect(clickAmp);
      clickAmp.connect(dest);
      noiseSrc.start(t);
      noiseSrc.stop(t + clickDur + 0.01);

      // Triangle burst (adds pitch definition to click)
      const clickOsc = ctx.createOscillator();
      clickOsc.type = "triangle";
      clickOsc.frequency.value = this.startFreq * 3;
      const clickOscAmp = ctx.createGain();
      clickOscAmp.gain.setValueAtTime(velocity * this.click * 0.4, t);
      clickOscAmp.gain.exponentialRampToValueAtTime(0.001, t + clickDur * 0.7);
      clickOsc.connect(clickOscAmp);
      clickOscAmp.connect(dest);
      clickOsc.start(t);
      clickOsc.stop(t + clickDur + 0.01);
    }

    return this;
  }
}

// ---- Controls companion component ----

export class WebAudioPercKickControls extends WebAudioControlsBase {
  static SLIDER_DEFS = [
    { param: "startFreq", label: "Start",  min: 50,  max: 500, step: 1,    tooltip: "Starting pitch of the pitch sweep." },
    { param: "endFreq",   label: "End",    min: 20,  max: 200, step: 1,    tooltip: "Final pitch at end of sweep. Lower = deeper sub." },
    { param: "sweepTime", label: "Sweep",  min: 0.01, max: 0.5, step: 0.01, tooltip: "Duration of the pitch drop." },
    { param: "decay",     label: "Decay",  min: 0.05, max: 1.5, step: 0.01, tooltip: "Body decay time. Longer = sustaining thump." },
    { param: "click",     label: "Click",  min: 0,    max: 1,   step: 0.01, tooltip: "Transient click amount. Adds 909-style attack definition." },
    { param: "drive",     label: "Drive",  min: 0,    max: 1,   step: 0.01, tooltip: "Saturation/distortion amount. Adds grit and presence." },
    { param: "volume",    label: "Vol",    min: 0,    max: 1,   step: 0.01 },
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
    sec.appendChild(mkSlider({ param: "startFreq", label: "Start",  min: 50,  max: 500, step: 1 }));
    sec.appendChild(mkSlider({ param: "endFreq",   label: "End",    min: 20,  max: 200, step: 1 }));
    sec.appendChild(mkSlider({ param: "sweepTime", label: "Sweep",  min: 0.01, max: 0.5, step: 0.01 }));
    sec.appendChild(mkSlider({ param: "decay",     label: "Decay",  min: 0.05, max: 1.5, step: 0.01 }));
    sec.appendChild(mkSlider({ param: "click",     label: "Click",  min: 0,    max: 1,   step: 0.01 }));
    sec.appendChild(mkSlider({ param: "drive",     label: "Drive",  min: 0,    max: 1,   step: 0.01 }));
    controls.appendChild(el);

    // ---- Sequencer ----
    this._buildSequencerSection({ onRandomize: () => this.randomize() });

    // Step sequencer
    this._seq = document.createElement("wam-step-seq");
    this._seq.init({
      steps: WebAudioPercKickControls.DEFAULT_PATTERN(),
      probability: true,
      ratchet: true,
      conditions: true,
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

    const patternParams = this._seq?.getPatternParams() ?? {};
    const playEvery = patternParams.playEvery ?? 1;
    const rotationOffset = patternParams.rotationOffset ?? 0;
    const rotationIntervalBars = patternParams.rotationIntervalBars ?? 1;

    if (this._seqPosition > 0 && this._seqPosition % 16 === 0 && rotationOffset > 0) {
      const localBar = this._seqPosition / 16;
      if (localBar % rotationIntervalBars === 0) {
        this._seq.rotate(rotationOffset);
      }
    }

    const currentBar = Math.floor(this._globalStep / 16);
    if (currentBar % playEvery !== 0) {
      this._globalStep++;
      return;
    }

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
      case "1:3": return barIndex % 3 === 0;
      case "1:4": return barIndex % 4 === 0;
      case "2:4": return barIndex % 4 === 1;
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

customElements.define("wam-perc-kick-controls", WebAudioPercKickControls);
