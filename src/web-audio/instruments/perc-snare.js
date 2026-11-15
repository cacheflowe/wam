import WebAudioInstrumentBase from "../global/instrument-base.js";
import "../ui/step-seq.js";
import { STEP_WEIGHTS } from "../global/scales.js";
import { WebAudioControlsBase, createSection } from "../ui/controls-base.js";
import { sliderDefs } from "../global/param-schema.js";

/**
 * WebAudioPercSnare — layered snare drum with tone body, noise snap, and snare buzz.
 *
 * Layers:
 *   1. Tone body — oscillator (sine/triangle/square) with fast pitch sweep
 *   2. Noise snap — highpass-filtered white noise for crack/attack
 *   3. Snare buzz — narrow bandpass noise simulating snare wire rattle (longer tail)
 *
 * Features:
 *   - Selectable body wave shape (sine = round 808, triangle = 909 bite, square = harsh)
 *   - Noise filter sweep (filter opens then closes during decay for movement)
 *   - Clap mode (3 micro-timed noise bursts)
 *   - Buzz layer for realistic snare wire rattle
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
      toneWave: "sine",
      noiseFreq: 1500,
      noiseDecay: 0.15,
      noiseSweep: 0,
      noiseMix: 0.6,
      buzz: 0.2,
      clapMode: false,
      volume: 1,
    },
    808: {
      toneFreq: 180,
      toneSweep: 60,
      toneDecay: 0.12,
      toneWave: "sine",
      noiseFreq: 1200,
      noiseDecay: 0.2,
      noiseSweep: 0,
      noiseMix: 0.5,
      buzz: 0.15,
      clapMode: false,
      volume: 1,
    },
    909: {
      toneFreq: 220,
      toneSweep: 100,
      toneDecay: 0.06,
      toneWave: "triangle",
      noiseFreq: 2000,
      noiseDecay: 0.12,
      noiseSweep: 0.4,
      noiseMix: 0.65,
      buzz: 0.3,
      clapMode: false,
      volume: 1,
    },
    Tight: {
      toneFreq: 250,
      toneSweep: 100,
      toneDecay: 0.04,
      toneWave: "triangle",
      noiseFreq: 2500,
      noiseDecay: 0.08,
      noiseSweep: 0.2,
      noiseMix: 0.7,
      buzz: 0.1,
      clapMode: false,
      volume: 1,
    },
    Clap: {
      toneFreq: 200,
      toneSweep: 50,
      toneDecay: 0.02,
      toneWave: "sine",
      noiseFreq: 1800,
      noiseDecay: 0.18,
      noiseSweep: 0,
      noiseMix: 0.95,
      buzz: 0,
      clapMode: true,
      volume: 0.9,
    },
    Rim: {
      toneFreq: 400,
      toneSweep: 150,
      toneDecay: 0.03,
      toneWave: "square",
      noiseFreq: 4000,
      noiseDecay: 0.04,
      noiseSweep: 0,
      noiseMix: 0.3,
      buzz: 0,
      clapMode: false,
      volume: 1,
    },
    Industrial: {
      toneFreq: 150,
      toneSweep: 40,
      toneDecay: 0.15,
      toneWave: "square",
      noiseFreq: 800,
      noiseDecay: 0.25,
      noiseSweep: 0.6,
      noiseMix: 0.4,
      buzz: 0.4,
      clapMode: false,
      volume: 0.9,
    },
    Brush: {
      toneFreq: 180,
      toneSweep: 30,
      toneDecay: 0.03,
      toneWave: "sine",
      noiseFreq: 3000,
      noiseDecay: 0.35,
      noiseSweep: 0.3,
      noiseMix: 0.85,
      buzz: 0.5,
      clapMode: false,
      volume: 0.6,
    },
    Snappy: {
      toneFreq: 302,
      toneSweep: 74,
      toneDecay: 0.13,
      noiseFreq: 1022,
      noiseDecay: 0.15,
      noiseSweep: 0.13,
      noiseMix: 0.53,
      buzz: 0.02,
      toneWave: "triangle",
      clapMode: false,
    },
  };

  /**
   * Param schema (see global/param-schema.js). Single source of truth for the
   * UI, serialization, randomize/mutate, and hardware mapping.
   */
  static PARAMS = [
    { param: "toneWave", label: "Shape", type: "enum", options: ["sine", "triangle", "square"],
      group: "body", role: "wave", priority: 2, rand: { weights: [3, 2, 1] },
      tooltip: "Tone body waveform." },
    { param: "clapMode", label: "Clap", type: "bool",
      group: "body", role: "body", priority: 3, rand: false,
      tooltip: "Clap mode: multiple staggered noise bursts instead of a single snap." },
    { param: "toneFreq", label: "Tone", min: 80, max: 500, step: 1,
      group: "body", role: "pitch", priority: 1, rand: { min: 150, max: 320 },
      tooltip: "Tone body pitch in Hz. Higher = snappier, lower = thumpier." },
    { param: "toneSweep", label: "Sweep", min: 0, max: 300, step: 1,
      group: "body", role: "pitchAmt", priority: 2, rand: { min: 30, max: 150 },
      tooltip: "Pitch drop amount. More = punchier attack transient." },
    { param: "toneDecay", label: "T.Decay", min: 0.01, max: 0.3, step: 0.01,
      group: "body", role: "decay", priority: 2, rand: { min: 0.03, max: 0.15 },
      tooltip: "Tone body decay time." },
    { param: "noiseFreq", label: "N.Freq", min: 500, max: 8000, step: 1, scale: "log",
      group: "filter", role: "cutoff", priority: 1, rand: { min: 900, max: 4000 },
      tooltip: "Noise highpass filter frequency. Lower = fatter, higher = crackly." },
    { param: "noiseDecay", label: "N.Decay", min: 0.02, max: 0.5, step: 0.01,
      group: "amp-env", role: "release", priority: 1, rand: { min: 0.06, max: 0.3 },
      tooltip: "Noise snap/rattle decay time." },
    { param: "noiseSweep", label: "N.Swp", min: 0, max: 1, step: 0.01,
      group: "filter", role: "envAmt", priority: 3, rand: { min: 0, max: 0.6 },
      tooltip: "Noise filter sweep. Opens then closes for movement." },
    { param: "noiseMix", label: "Mix", min: 0, max: 1, step: 0.01,
      group: "body", role: "noise", priority: 1, rand: { min: 0.35, max: 0.85 },
      tooltip: "Balance between tone body (0) and noise snap (1)." },
    { param: "buzz", label: "Buzz", min: 0, max: 1, step: 0.01,
      group: "character", role: "snap", priority: 2, rand: { min: 0, max: 0.45 },
      tooltip: "Snare wire buzz/rattle amount. Longer sustaining tail." },
  ];

  /** Cross-param rules applied after randomize/mutate (see sound-design.js). */
  static constrain(v) {
    // A long, dark noise tail with heavy buzz turns to wash — keep the crack.
    if (v.noiseDecay > 0.22 && v.buzz > 0.3) v.buzz = 0.3;
    return v;
  }

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

    // ---- Tone body (oscillator with fast pitch sweep) ----
    const toneGain = 1 - this.noiseMix;
    if (toneGain > 0.01) {
      const osc = ctx.createOscillator();
      const amp = ctx.createGain();
      osc.type = this.toneWave || "sine";
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
        for (let i = 0; i < 3; i++) {
          const offset = i * (0.008 + Math.random() * 0.012);
          this._fireNoiseBurst(velocity * this.noiseMix * 0.8, t + offset);
        }
      } else {
        this._fireNoiseBurst(velocity * this.noiseMix, t);
      }
    }

    // ---- Snare buzz (narrow bandpass noise, longer tail) ----
    if (this.buzz > 0.01) {
      const buzzNoise = ctx.createBufferSource();
      buzzNoise.buffer = this._noiseBuffer;

      const buzzFilter = ctx.createBiquadFilter();
      buzzFilter.type = "bandpass";
      buzzFilter.frequency.value = 1800;
      buzzFilter.Q.value = 3;

      const buzzAmp = ctx.createGain();
      const buzzDecay = this.noiseDecay * 2.5; // buzz sustains longer than snap
      buzzAmp.gain.setValueAtTime(velocity * this.buzz * 0.5, t + 0.005); // slight delay
      buzzAmp.gain.exponentialRampToValueAtTime(0.001, t + buzzDecay);

      buzzNoise.connect(buzzFilter);
      buzzFilter.connect(buzzAmp);
      buzzAmp.connect(this._out);
      buzzNoise.start(t);
      buzzNoise.stop(t + buzzDecay + 0.05);
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

    // Noise filter sweep: filter opens then closes during decay
    const sweep = this.noiseSweep ?? 0;
    if (sweep > 0) {
      const peakFreq = this.noiseFreq * (1 + sweep * 3);
      filter.frequency.setValueAtTime(peakFreq, t);
      filter.frequency.exponentialRampToValueAtTime(Math.max(20, this.noiseFreq * 0.5), t + this.noiseDecay);
    }

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + this.noiseDecay);

    noise.connect(filter);
    filter.connect(amp);
    amp.connect(this._out);

    noise.start(t);
    noise.stop(t + this.noiseDecay + 0.05);
  }

  /** Trigger the sequence step, handling ratchet subdivisions. */
  triggerSequenceStep(index, s, subTime, subStepDur) {
    this._triggerRatcheted(s, subTime, subStepDur, (t) => this.trigger(0.8, t));
  }
}

// ---- Controls companion component ----

export class WebAudioPercSnareControls extends WebAudioControlsBase {
  static SLIDER_DEFS = sliderDefs(WebAudioPercSnare.PARAMS);

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

    this._makeWaveSelect(["sine", "triangle", "square"], sec, { prop: "toneWave" });

    // Clap mode toggle
    const clapBtn = document.createElement("button");
    clapBtn.className = "wam-wave-btn";
    clapBtn.textContent = "CLAP";
    clapBtn.classList.toggle("wam-wave-active", !!this._instrument.clapMode);
    this._registerToggle("clapMode", clapBtn);
    this._clapBtn = clapBtn;
    sec.appendChild(clapBtn);

    sec.appendChild(mkSlider("toneFreq"));
    sec.appendChild(mkSlider("toneSweep"));
    sec.appendChild(mkSlider("toneDecay"));
    sec.appendChild(mkSlider("noiseFreq"));
    sec.appendChild(mkSlider("noiseDecay"));
    sec.appendChild(mkSlider("noiseSweep"));
    sec.appendChild(mkSlider("noiseMix"));
    sec.appendChild(mkSlider("buzz"));
    controls.appendChild(el);

    // ---- Sequencer ----
    this._buildSequencerSection({ onRandomize: () => this.randomize() });
    this._createSequencer(expanded, color);
  }

  // ---- Subclass hooks ----

  _seqInitOptions(color) {
    return {
      steps: WebAudioPercSnareControls.DEFAULT_PATTERN(),
      probability: true,
      ratchet: true,
      conditions: true,
      color,
    };
  }

  _triggerJam(time, stepDurationSec) {
    this._instrument.trigger(0.8, time);
  }

  randomize() {
    const newSteps = Array.from({ length: 16 }, (_, i) => ({
      active: Math.random() < STEP_WEIGHTS[i] * 0.6,
      probability: 1,
      ratchet: 1,
      conditions: "off",
    }));
    this._instrument.steps = newSteps;
    this._emitChange();
  }

  // ---- Serialization ----

  _extraToJSON(params) {
    params.clapMode = this._instrument?.clapMode ?? false;
    params.toneWave = this._instrument?.toneWave ?? "sine";
  }

  _extendJSON(obj) {}

  _restoreExtra(obj) {}
}

customElements.define("wam-perc-snare-controls", WebAudioPercSnareControls);
