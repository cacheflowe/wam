import WebAudioInstrumentBase from "../global/instrument-base.js";
import "../ui/step-seq.js";
import { STEP_WEIGHTS } from "../global/scales.js";
import { WebAudioControlsBase, createSection } from "../ui/controls-base.js";
import { sliderDefs } from "../global/param-schema.js";
import presetData from "../presets/perc-kick.json" with { type: "json" };
import { presetMap } from "../global/presets.js";

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
  /** Presets live in ../presets/perc-kick.json (written by the dev preset store). */
  static PRESET_DATA = presetData;
  static PRESETS = presetMap(presetData);

  /**
   * Param schema (see global/param-schema.js). Single source of truth for the
   * UI, serialization, randomize/mutate, and hardware mapping.
   */
  static PARAMS = [
    { param: "startFreq", label: "Start", min: 50, max: 500, step: 1,
      group: "pitch", role: "pitchAmt", priority: 1, rand: { min: 100, max: 300 },
      tooltip: "Starting pitch of the pitch sweep." },
    { param: "endFreq", label: "End", min: 20, max: 200, step: 1,
      group: "pitch", role: "pitch", priority: 1, rand: { min: 35, max: 70 },
      tooltip: "Final pitch at end of sweep. Lower = deeper sub." },
    { param: "sweepTime", label: "Sweep", min: 0.01, max: 0.5, step: 0.01,
      group: "pitch", role: "pitchDecay", priority: 1, rand: { min: 0.02, max: 0.15 },
      tooltip: "Duration of the pitch drop." },
    { param: "decay", label: "Decay", min: 0.05, max: 1.5, step: 0.01,
      group: "amp-env", role: "decay", priority: 1, rand: { min: 0.2, max: 0.8 },
      tooltip: "Body decay time. Longer = sustaining thump." },
    { param: "click", label: "Click", min: 0, max: 1, step: 0.01,
      group: "body", role: "click", priority: 2, rand: { min: 0, max: 0.6 },
      tooltip: "Transient click amount. Adds 909-style attack definition." },
    { param: "drive", label: "Drive", min: 0, max: 1, step: 0.01,
      group: "character", role: "drive", priority: 2, rand: { min: 0, max: 0.5 },
      tooltip: "Saturation/distortion amount. Adds grit and presence." },
  ];

  /** Cross-param rules applied after randomize/mutate (see sound-design.js). */
  static constrain(v) {
    // A kick needs a downward sweep: keep the start well above the end pitch.
    if (v.startFreq < v.endFreq * 1.5) v.startFreq = Math.min(500, Math.round(v.endFreq * 2));
    return v;
  }

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
  get drive() {
    return this._drive ?? 0;
  }

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

  /** Trigger the sequence step, handling ratchet subdivisions. */
  triggerSequenceStep(index, s, subTime, subStepDur) {
    this._triggerRatcheted(s, subTime, subStepDur, (t) => this.trigger(0.9, t));
  }
}

// ---- Controls companion component ----

export class WebAudioPercKickControls extends WebAudioControlsBase {
  static SLIDER_DEFS = sliderDefs(WebAudioPercKick.PARAMS);

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
  }

  _defaultColor() {
    return "#f44";
  }
  _defaultTitle() {
    return "Kick";
  }
  _fxTitle() {
    return "Kick FX";
  }

  _buildControls(controls, expanded, mkSlider, ctx, options) {
    const color = options.color || this._defaultColor();

    const { el, controls: sec } = createSection("Kick");

    sec.appendChild(mkSlider("startFreq"));
    sec.appendChild(mkSlider("endFreq"));
    sec.appendChild(mkSlider("sweepTime"));
    sec.appendChild(mkSlider("decay"));
    sec.appendChild(mkSlider("click"));
    sec.appendChild(mkSlider("drive"));
    controls.appendChild(el);

    // ---- Sequencer ----
    this._buildSequencerSection({ onRandomize: () => this.randomize() });
    this._createSequencer(expanded, color);
  }

  // ---- Subclass hooks ----

  _seqInitOptions(color) {
    return {
      steps: WebAudioPercKickControls.DEFAULT_PATTERN(),
      probability: true,
      ratchet: true,
      conditions: true,
      color,
    };
  }

  _triggerJam(time, stepDurationSec) {
    this._instrument.trigger(0.9, time);
  }

  randomize() {
    const newSteps = Array.from({ length: 16 }, (_, i) => ({
      active: Math.random() < STEP_WEIGHTS[i] * 0.5,
      probability: 1,
      ratchet: 1,
      conditions: "off",
    }));
    newSteps[0] = { active: true, probability: 1, ratchet: 1, conditions: "off" };
    this._instrument.steps = newSteps;
    this._emitChange();
  }

  // ---- Serialization ----

  _extendJSON(obj) {}

  _restoreExtra(obj) {}
}

customElements.define("wam-perc-kick-controls", WebAudioPercKickControls);
