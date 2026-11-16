import WebAudioInstrumentBase from "../global/instrument-base.js";
import "../ui/step-seq.js";
import { WebAudioControlsBase, createSection } from "../ui/controls-base.js";
import { sliderDefs } from "../global/param-schema.js";
import presetData from "../presets/perc-hihat.json" with { type: "json" };
import { presetMap } from "../global/presets.js";

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
  static METAL_RATIOS = [1, 1.4471, 1.617, 1.9265, 2.5028, 2.6637];

  /** Presets live in ../presets/perc-hihat.json (written by the dev preset store). */
  static PRESET_DATA = presetData;
  static PRESETS = presetMap(presetData);

  /** trigger() argument layout, for note events (see global/note-event.js). */
  static TRIGGER_ARGS = { trigger: ["velocity", "time", "open"] };
  /** Pattern generator role + note range (see global/pattern-gen.js). */
  static PATTERN_ROLE = "hat";

  /**
   * Param schema (see global/param-schema.js). Single source of truth for the
   * UI, serialization, randomize/mutate, and hardware mapping. Open/closed is
   * per-step sequencer data, not a sound param.
   */
  static PARAMS = [
    { param: "tone", label: "Tone", min: 150, max: 600, step: 1,
      group: "body", role: "pitch", priority: 1, rand: { min: 250, max: 450 },
      tooltip: "Base frequency for metallic oscillators. Tunes the hat's pitch." },
    { param: "metalMix", label: "Metal", min: 0, max: 1, step: 0.01,
      group: "body", role: "tone", priority: 1, rand: { min: 0.15, max: 0.8 },
      tooltip: "Balance between metallic oscillators (1) and noise (0)." },
    { param: "filterFreq", label: "Freq", min: 2000, max: 16000, step: 1, scale: "log",
      group: "filter", role: "cutoff", priority: 1, rand: { min: 5500, max: 12000 },
      tooltip: "Highpass filter frequency. Higher = brighter, thinner." },
    { param: "filterQ", label: "Q", min: 0.1, max: 5, step: 0.1,
      group: "filter", role: "resonance", priority: 2, rand: { min: 0.4, max: 1.6 },
      tooltip: "Filter resonance. Higher = more ringing, focused." },
    { param: "decay", label: "Closed", min: 0.01, max: 0.2, step: 0.01,
      group: "amp-env", role: "decay", priority: 1, rand: { min: 0.03, max: 0.1 },
      tooltip: "Closed hat decay time." },
    { param: "openDecay", label: "Open", min: 0.05, max: 0.8, step: 0.01,
      group: "amp-env", role: "release", priority: 2, rand: { min: 0.18, max: 0.45 },
      tooltip: "Open hat decay time. Open hats are choked by closed hits." },
  ];

  /** Cross-param rules applied after randomize/mutate (see sound-design.js). */
  static constrain(v) {
    // Open hats must ring clearly longer than closed ones.
    if (v.openDecay < v.decay * 2.5) v.openDecay = Math.min(0.8, Math.round(v.decay * 3 * 100) / 100);
    return v;
  }

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

  /** Trigger the sequence step, handling ratchet subdivisions and open/closed state. */
  triggerSequenceStep(index, s, subTime, subStepDur) {
    const isOpen = s.open ?? false;
    this._triggerRatcheted(s, subTime, subStepDur, (t) => this.trigger(0.7, t, isOpen));
  }
}

// ---- Controls companion component ----

export class WebAudioPercHihatControls extends WebAudioControlsBase {
  static SLIDER_DEFS = sliderDefs(WebAudioPercHihat.PARAMS);

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
  }

  _defaultColor() {
    return "#ff0";
  }
  _defaultTitle() {
    return "Hi-Hat";
  }
  _fxTitle() {
    return "HiHat FX";
  }

  _buildControls(controls, expanded, mkSlider, ctx, options) {
    const color = options.color || this._defaultColor();

    const { el, controls: sec } = createSection("Hi-Hat");

    sec.appendChild(mkSlider("tone"));
    sec.appendChild(mkSlider("metalMix"));
    sec.appendChild(mkSlider("filterFreq"));
    sec.appendChild(mkSlider("filterQ"));
    sec.appendChild(mkSlider("decay"));
    sec.appendChild(mkSlider("openDecay"));
    controls.appendChild(el);

    // ---- Sequencer ----
    this._buildSequencerSection({ onRandomize: () => this.randomize() });
    this._createSequencer(expanded, color);
  }

  // ---- Subclass hooks ----

  _seqInitOptions(color) {
    return {
      steps: WebAudioPercHihatControls.DEFAULT_PATTERN(),
      probability: true,
      ratchet: true,
      conditions: true,
      openClose: true,
      color,
    };
  }

  _triggerJam(time, stepDurationSec) {
    this._instrument.trigger(0.7, time, false);
  }


  _extendJSON(obj) {}

  _restoreExtra(obj) {}
}

customElements.define("wam-perc-hihat-controls", WebAudioPercHihatControls);
