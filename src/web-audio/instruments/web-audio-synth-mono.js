import WebAudioInstrumentBase from "../web-audio-instrument-base.js";
import { WebAudioControlsBase, createSection } from "../web-audio-controls-base.js";

/**
 * WebAudioSynthMono — monophonic synth with lowpass filter and ADSR envelopes.
 *
 * Each trigger is fire-and-forget: a fresh set of nodes is created per note and
 * automatically garbage-collected when the oscillator stops. This is the standard
 * Web Audio pattern for polyphonic-style scheduling.
 *
 * Connect pattern (works with plain AudioNodes and other library classes):
 *   const synth = new WebAudioSynthMono(ctx, { oscType: 'sawtooth' });
 *   synth.connect(someEffect);   // effect exposes .input
 *   synth.connect(ctx.destination); // or plain AudioNode
 */
export default class WebAudioSynthMono extends WebAudioInstrumentBase {
  static PRESETS = {
    Default: {
      oscType: "sawtooth",
      attack: 0.02,
      decay: 0.2,
      sustain: 0.5,
      release: 0.4,
      filterFreq: 600,
      filterQ: 4,
      filterEnvOctaves: 2,
      detune: 0,
      detune2: 0,
      subGain: 0,
      volume: 1,
    },
    Bass: {
      oscType: "sawtooth",
      attack: 0.01,
      decay: 0.3,
      sustain: 0.6,
      release: 0.3,
      filterFreq: 400,
      filterQ: 6,
      filterEnvOctaves: 3,
      detune: 0,
      detune2: 0,
      subGain: 0.4,
      volume: 1,
    },
    Soft_Bass: {
      oscType: "sawtooth",
      attack: 0.02,
      decay: 0.2,
      sustain: 0.5,
      release: 0.4,
      filterFreq: 500,
      filterQ: 5,
      filterEnvOctaves: 2,
      detune: 0,
      detune2: 0,
      subGain: 0,
      volume: 0.6,
    },
    Lead: {
      oscType: "sawtooth",
      attack: 0.01,
      decay: 0.15,
      sustain: 0.7,
      release: 0.5,
      filterFreq: 1200,
      filterQ: 5,
      filterEnvOctaves: 2,
      detune: 5,
      detune2: 8,
      subGain: 0,
      volume: 0.9,
    },
    Pad: {
      oscType: "triangle",
      attack: 0.4,
      decay: 0.5,
      sustain: 0.8,
      release: 1.5,
      filterFreq: 800,
      filterQ: 2,
      filterEnvOctaves: 1,
      detune: 0,
      detune2: 12,
      subGain: 0,
      volume: 0.8,
    },
    Pluck: {
      oscType: "square",
      attack: 0.001,
      decay: 0.1,
      sustain: 0.0,
      release: 0.2,
      filterFreq: 2000,
      filterQ: 8,
      filterEnvOctaves: 3,
      detune: 0,
      detune2: 0,
      subGain: 0,
      volume: 0.9,
    },
    Airy_Lead: {
      oscType: "sawtooth",
      attack: 0.02,
      decay: 0.15,
      sustain: 0.3,
      release: 0.8,
      filterFreq: 4000,
      filterQ: 1,
      filterEnvOctaves: 0,
      detune: 0,
      detune2: 0,
      subGain: 0,
      volume: 0.35,
    },
  };

  constructor(ctx, preset = "Default") {
    super(ctx, preset);
  }

  /**
   * Schedule a note.
   * @param {number} midiNote  MIDI note number (21–108)
   * @param {number} durationSec  Note-on duration in seconds
   * @param {number} [velocity]   0–1 amplitude scalar
   * @param {number} [atTime]     AudioContext time (defaults to currentTime)
   */
  trigger(midiNote, durationSec, velocity = 1, atTime = 0) {
    const ctx = this.ctx;
    const t = atTime > 0 ? atTime : ctx.currentTime;
    const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
    const stopTime = t + durationSec + this.release + 0.05;

    // Mixer collects oscillator voices before the filter
    const mixer = ctx.createGain();
    // Compensate gain when doubled to avoid clipping
    mixer.gain.value = this.detune2 > 0 ? 0.65 : 1;

    const filter = ctx.createBiquadFilter();
    const amp = ctx.createGain();

    // Primary oscillator
    const osc = ctx.createOscillator();
    osc.type = this.oscType;
    osc.frequency.value = freq;
    osc.detune.value = this.detune + (this.detune2 > 0 ? this.detune2 / 2 : 0);
    osc.connect(mixer);
    osc.start(t);
    osc.stop(stopTime);

    // Second detuned oscillator — spreads toward thickness/chorus
    if (this.detune2 > 0) {
      const osc2 = ctx.createOscillator();
      osc2.type = this.oscType;
      osc2.frequency.value = freq;
      osc2.detune.value = this.detune - this.detune2 / 2;
      osc2.connect(mixer);
      osc2.start(t);
      osc2.stop(stopTime);
    }

    // Sub oscillator — sine one octave below, bypasses the main filter for clean body
    if (this.subGain > 0) {
      const subOsc = ctx.createOscillator();
      const subAmp = ctx.createGain();
      subOsc.type = "sine";
      subOsc.frequency.value = freq / 2;
      subAmp.gain.value = this.subGain;
      subOsc.connect(subAmp);
      subAmp.connect(amp); // skip filter so sub stays full-range
      subOsc.start(t);
      subOsc.stop(stopTime);
    }

    filter.type = "lowpass";
    filter.Q.value = this.filterQ;

    // Filter envelope: sweep up to peak then decay back to base
    const peakFreq = this.filterFreq * Math.pow(2, this.filterEnvOctaves);
    filter.frequency.setValueAtTime(this.filterFreq, t);
    filter.frequency.linearRampToValueAtTime(peakFreq, t + this.attack);
    filter.frequency.exponentialRampToValueAtTime(Math.max(1, this.filterFreq), t + this.attack + this.decay);

    // Amplitude ADSR
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(velocity, t + this.attack);
    amp.gain.linearRampToValueAtTime(velocity * this.sustain, t + this.attack + this.decay);
    amp.gain.setValueAtTime(velocity * this.sustain, t + durationSec);
    amp.gain.linearRampToValueAtTime(0, t + durationSec + this.release);

    mixer.connect(filter);
    filter.connect(amp);
    amp.connect(this._out);

    return this;
  }
}

// ---- Controls companion component ----

export class WebAudioSynthMonoControls extends WebAudioControlsBase {
  static SLIDER_DEFS = [
    { param: "attack",           label: "Attack",   min: 0.001, max: 1,     step: 0.001, tooltip: "Amplitude envelope attack time." },
    { param: "decay",            label: "Decay",    min: 0.01,  max: 2,     step: 0.01,  tooltip: "Amplitude envelope decay time." },
    { param: "sustain",          label: "Sustain",  min: 0,     max: 1,     step: 0.01,  tooltip: "Amplitude sustain level (0–1) during held notes." },
    { param: "release",          label: "Release",  min: 0.01,  max: 3,     step: 0.01,  tooltip: "Amplitude envelope release time." },
    { param: "filterFreq",       label: "Filter",   min: 20,    max: 12000, step: 1, scale: "log", tooltip: "Lowpass filter base cutoff frequency." },
    { param: "filterQ",          label: "Filter Q", min: 0.5,   max: 20,    step: 0.1,   tooltip: "Filter resonance. Higher = more pronounced peak at cutoff." },
    { param: "filterEnvOctaves", label: "Filt Env", min: 0,     max: 6,     step: 0.1,   tooltip: "How many octaves the filter opens on note attack." },
    { param: "detune",           label: "Detune",   min: -50,   max: 50,    step: 1,     tooltip: "First oscillator pitch offset in cents." },
    { param: "detune2",          label: "Spread",   min: 0,     max: 50,    step: 1,     tooltip: "Second oscillator spread for chorus-like thickening." },
    { param: "subGain",          label: "Sub",      min: 0,     max: 1,     step: 0.01,  tooltip: "Level of the sub-octave oscillator." },
    { param: "volume",           label: "Vol",      min: 0,     max: 1,     step: 0.01 },
  ];

  _defaultColor() { return "#0f0"; }
  _defaultTitle() { return "Mono Synth"; }
  _fxTitle() { return "Mono FX"; }

  _buildControls(controls, expanded, mkSlider) {
    // ---- Tone ----
    const { el: toneEl, controls: toneCtrl } = createSection("Tone");
    this._makePresetDropdown(WebAudioSynthMono.PRESETS, toneCtrl);
    this._makeWaveRow(["sawtooth", "square", "triangle", "sine"], toneCtrl);
    toneCtrl.appendChild(mkSlider({ param: "detune",  label: "Detune", min: -50, max: 50, step: 1 }));
    toneCtrl.appendChild(mkSlider({ param: "detune2", label: "Spread", min: 0,   max: 50, step: 1 }));
    toneCtrl.appendChild(mkSlider({ param: "subGain", label: "Sub",    min: 0,   max: 1,  step: 0.01 }));
    controls.appendChild(toneEl);

    // ---- Envelope ----
    const { el: envEl, controls: envCtrl } = createSection("Envelope");
    envCtrl.appendChild(mkSlider({ param: "attack",  label: "Attack",  min: 0.001, max: 1, step: 0.001 }));
    envCtrl.appendChild(mkSlider({ param: "decay",   label: "Decay",   min: 0.01,  max: 2, step: 0.01 }));
    envCtrl.appendChild(mkSlider({ param: "sustain", label: "Sustain", min: 0,     max: 1, step: 0.01 }));
    envCtrl.appendChild(mkSlider({ param: "release", label: "Release", min: 0.01,  max: 3, step: 0.01 }));
    controls.appendChild(envEl);

    // ---- Filter ----
    const { el: filterEl, controls: filterCtrl } = createSection("Filter");
    filterCtrl.appendChild(mkSlider({ param: "filterFreq",       label: "Filter",   min: 20,  max: 12000, step: 1,   scale: "log" }));
    filterCtrl.appendChild(mkSlider({ param: "filterQ",          label: "Filter Q", min: 0.5, max: 20,    step: 0.1 }));
    filterCtrl.appendChild(mkSlider({ param: "filterEnvOctaves", label: "Filt Env", min: 0,   max: 6,     step: 0.1 }));
    controls.appendChild(filterEl);
  }

  _syncExtraControls() {
    this._syncWaveRow();
  }
}

customElements.define("web-audio-synth-mono-controls", WebAudioSynthMonoControls);
