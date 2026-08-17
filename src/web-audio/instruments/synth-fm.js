import "../ui/slider.js";
import "../ui/step-seq.js";
import { buildChordFromScale, scaleNotesInRange, scaleNoteOptions } from "../global/scales.js";
import WebAudioInstrumentBase from "../global/instrument-base.js";
import { WebAudioControlsBase, createSection, createCtrl } from "../ui/controls-base.js";
import { applyADSR } from "../global/dsp/envelope.js";

/**
 * WebAudioSynthFM — polyphonic 2-operator FM synthesizer.
 *
 * Models the carrier+modulator architecture of classic FM synthesis (à la DX-7):
 *
 *   [modOsc] → modEnv → carrierOsc.frequency   (the FM!)
 *   [carrierOsc] → carrierEnv → filter → output
 *
 * The modulation index (modIndex) sets frequency deviation depth:
 *   peak deviation Hz = carrierFreq × modIndex
 *
 * The modulator amplitude envelope (modAttack + modDecay) causes timbre to evolve
 * over time — bright/complex at onset, simpler/warmer on sustain — producing the
 * characteristic DX-7 electric-piano, bell, and pad sounds.
 *
 * trigger() accepts a single MIDI note or an array for chord playback.
 * All voices are fire-and-forget; nodes self-disconnect on ended.
 *
 * Usage:
 *   const fm = new WebAudioSynthFM(ctx, { modRatio: 3.5, modIndex: 4 });
 *   fm.connect(fxUnit);
 *   fm.trigger([48, 52, 55], stepDurSec, atTime);  // C major triad
 *
 * Presets:
 *   fm.applyPreset("Bell");
 *   // or: new WebAudioSynthFM(ctx, WebAudioSynthFM.PRESETS["Bell"]);
 */
export default class WebAudioSynthFM extends WebAudioInstrumentBase {
  /** Maps unprefixed preset keys to "fm"-prefixed param names used in demo UIs. */
  static PARAM_KEY_MAP = {
    carrierRatio: "fmCarrierRatio",
    modRatio: "fmModRatio",
    modIndex: "fmModIndex",
    modWaveform: "fmModWaveform",
    modAttack: "fmModAttack",
    modDecay: "fmModDecay",
    modSustain: "fmModSustain",
    modRelease: "fmModRelease",
    feedback: "fmFeedback",
    attack: "fmAttack",
    decay: "fmDecay",
    sustain: "fmSustain",
    release: "fmRelease",
    filterFreq: "fmFilterFreq",
    filterQ: "fmFilterQ",
    detune: "fmDetune",
    volume: "fmVolume",
    unison: "fmUnison",
    unisonSpread: "fmUnisonSpread",
  };

  // ---- DX-7-inspired presets ----

  static LFO_INTERVALS = [
    { label: "Off", beats: 0 },
    { label: "4 bar", beats: 16 },
    { label: "2 bar", beats: 8 },
    { label: "1 bar", beats: 4 },
    { label: "1/2", beats: 2 },
    { label: "1/4", beats: 1 },
    { label: "1/8", beats: 0.5 },
    { label: "1/16", beats: 0.25 },
  ];

  static PRESETS = {
    E_Piano: {
      carrierRatio: 1,
      modRatio: 2,
      modIndex: 2.5,
      modWaveform: "sine",
      modAttack: 0.005,
      modDecay: 0.2,
      modSustain: 0.1,
      modRelease: 0.5,
      feedback: 0,
      attack: 0.005,
      decay: 0.3,
      sustain: 0.15,
      release: 0.5,
      filterFreq: 8000,
      filterQ: 1,
      detune: 0,
      volume: 0.4,
      lfoInterval: 0,
      lfoDepth: 0,
      lfoShape: "sine",
    },
    Bell: {
      carrierRatio: 1,
      modRatio: 3.5,
      modIndex: 5,
      modWaveform: "sine",
      modAttack: 0.001,
      modDecay: 0.06,
      modSustain: 0.0,
      modRelease: 2.5,
      feedback: 0,
      attack: 0.001,
      decay: 1.2,
      sustain: 0.0,
      release: 2.5,
      filterFreq: 10000,
      filterQ: 1,
      detune: 0,
      volume: 0.35,
      lfoInterval: 0,
      lfoDepth: 0,
      lfoShape: "sine",
    },
    Vibes: {
      carrierRatio: 1,
      modRatio: 4,
      modIndex: 1.5,
      modWaveform: "sine",
      modAttack: 0.001,
      modDecay: 0.08,
      modSustain: 0.0,
      modRelease: 0.6,
      feedback: 0,
      attack: 0.001,
      decay: 0.3,
      sustain: 0.0,
      release: 0.6,
      filterFreq: 6000,
      filterQ: 1,
      detune: 0,
      volume: 0.5,
      lfoInterval: 0,
      lfoDepth: 0,
      lfoShape: "sine",
    },
    Organ: {
      carrierRatio: 1,
      modRatio: 1,
      modIndex: 1.5,
      modWaveform: "sine",
      modAttack: 0.01,
      modDecay: 1.0,
      modSustain: 0.9,
      modRelease: 0.5,
      feedback: 0,
      attack: 0.015,
      decay: 0.08,
      sustain: 0.9,
      release: 0.06,
      filterFreq: 5000,
      filterQ: 1,
      detune: 5,
      volume: 0.35,
      lfoInterval: 0,
      lfoDepth: 0,
      lfoShape: "sine",
    },
    Pad: {
      carrierRatio: 1,
      modRatio: 2,
      modIndex: 0.8,
      modWaveform: "sawtooth",
      modAttack: 0.5,
      modDecay: 1.0,
      modSustain: 0.7,
      modRelease: 2.5,
      feedback: 0,
      attack: 0.4,
      decay: 0.6,
      sustain: 0.7,
      release: 2.5,
      filterFreq: 2500,
      filterQ: 2,
      detune: 8,
      volume: 0.3,
      lfoInterval: 4,
      lfoDepth: 800,
      lfoShape: "sine",
    },
    Pluck: {
      carrierRatio: 1,
      modRatio: 7,
      modIndex: 7,
      modWaveform: "sine",
      modAttack: 0.001,
      modDecay: 0.04,
      modSustain: 0.0,
      modRelease: 0.15,
      feedback: 0,
      attack: 0.001,
      decay: 0.12,
      sustain: 0.0,
      release: 0.15,
      filterFreq: 5000,
      filterQ: 1,
      detune: 0,
      volume: 0.55,
      lfoInterval: 0,
      lfoDepth: 0,
      lfoShape: "sine",
    },
    Brass: {
      carrierRatio: 1,
      modRatio: 1,
      modIndex: 3,
      modWaveform: "sawtooth",
      modAttack: 0.1,
      modDecay: 0.2,
      modSustain: 0.6,
      modRelease: 0.3,
      feedback: 0,
      attack: 0.08,
      decay: 0.2,
      sustain: 0.6,
      release: 0.3,
      filterFreq: 4000,
      filterQ: 2,
      detune: 0,
      volume: 0.4,
      lfoInterval: 0,
      lfoDepth: 0,
      lfoShape: "sine",
    },
    Kalimba: {
      carrierRatio: 1,
      modRatio: 5,
      modIndex: 2,
      modWaveform: "sine",
      modAttack: 0.001,
      modDecay: 0.05,
      modSustain: 0.0,
      modRelease: 0.35,
      feedback: 0,
      attack: 0.001,
      decay: 0.2,
      sustain: 0.0,
      release: 0.35,
      filterFreq: 8000,
      filterQ: 1,
      detune: 0,
      volume: 0.5,
      lfoInterval: 0,
      lfoDepth: 0,
      lfoShape: "sine",
    },
    Marimba: {
      carrierRatio: 1,
      modRatio: 4,
      modIndex: 3,
      modWaveform: "sine",
      modAttack: 0.002,
      modDecay: 0.1,
      modSustain: 0.0,
      modRelease: 0.2,
      feedback: 0,
      attack: 0.002,
      decay: 0.4,
      sustain: 0.0,
      release: 0.2,
      filterFreq: 6000,
      filterQ: 1,
      detune: 0,
      volume: 0.9,
      lfoInterval: 0,
      lfoDepth: 0,
      lfoShape: "sine",
    },
    Glass: {
      carrierRatio: 1,
      modRatio: 7,
      modIndex: 2,
      modWaveform: "sine",
      modAttack: 0.01,
      modDecay: 0.8,
      modSustain: 0.2,
      modRelease: 1.0,
      feedback: 0,
      attack: 0.01,
      decay: 1.5,
      sustain: 0.2,
      release: 1.0,
      filterFreq: 10000,
      filterQ: 0.5,
      detune: 3,
      volume: 0.8,
      lfoInterval: 0,
      lfoDepth: 0,
      lfoShape: "sine",
    },
    Sitar: {
      carrierRatio: 1,
      modRatio: 5,
      modIndex: 6,
      modWaveform: "sine",
      modAttack: 0.003,
      modDecay: 0.3,
      modSustain: 0.1,
      modRelease: 0.5,
      feedback: 0,
      attack: 0.003,
      decay: 0.8,
      sustain: 0.1,
      release: 0.5,
      filterFreq: 4000,
      filterQ: 3,
      detune: 0,
      volume: 0.85,
      lfoInterval: 0,
      lfoDepth: 0,
      lfoShape: "sine",
    },
    Wobble: {
      carrierRatio: 1,
      modRatio: 2,
      modIndex: 1.5,
      modWaveform: "square",
      modAttack: 0.01,
      modDecay: 0.5,
      modSustain: 0.5,
      modRelease: 1.0,
      feedback: 50,
      attack: 0.01,
      decay: 0.4,
      sustain: 0.5,
      release: 1.0,
      filterFreq: 3000,
      filterQ: 6,
      detune: 0,
      volume: 0.4,
      lfoInterval: 1,
      lfoDepth: 1500,
      lfoShape: "sine",
    },
    Shimmer: {
      carrierRatio: 1,
      modRatio: 3,
      modIndex: 1.2,
      modWaveform: "sine",
      modAttack: 0.3,
      modDecay: 1.5,
      modSustain: 0.6,
      modRelease: 2.0,
      feedback: 0,
      attack: 0.3,
      decay: 0.8,
      sustain: 0.6,
      release: 2.0,
      filterFreq: 4000,
      filterQ: 3,
      detune: 6,
      volume: 0.35,
      lfoInterval: 8,
      lfoDepth: 1200,
      lfoShape: "triangle",
    },
    Reese: {
      carrierRatio: 1,
      modRatio: 1,
      modIndex: 0.5,
      modWaveform: "sawtooth",
      modAttack: 0.02,
      modDecay: 0.8,
      modSustain: 0.6,
      modRelease: 1.5,
      feedback: 10,
      attack: 0.02,
      decay: 0.5,
      sustain: 0.6,
      release: 1.5,
      filterFreq: 1200,
      filterQ: 4,
      detune: 8,
      volume: 0.4,
      lfoInterval: 4,
      lfoDepth: 600,
      lfoShape: "triangle",
    },
    Ether: {
      carrierRatio: 1,
      modRatio: 1.5,
      modIndex: 0.4,
      modWaveform: "sine",
      modAttack: 1.5,
      modDecay: 4.0,
      modSustain: 0.75,
      modRelease: 4.0,
      feedback: 0,
      attack: 1.5,
      decay: 1.5,
      sustain: 0.75,
      release: 4.0,
      filterFreq: 2500,
      filterQ: 1,
      detune: 4,
      volume: 0.3,
      lfoInterval: 8,
      lfoDepth: 300,
      lfoShape: "sine",
    },
    Crystal: {
      carrierRatio: 1,
      modRatio: 3.14,
      modIndex: 3.5,
      modWaveform: "sine",
      modAttack: 0.001,
      modDecay: 0.08,
      modSustain: 0.0,
      modRelease: 3.5,
      feedback: 0,
      attack: 0.001,
      decay: 2.0,
      sustain: 0.0,
      release: 3.5,
      filterFreq: 9000,
      filterQ: 1.5,
      detune: 2,
      volume: 0.28,
      lfoInterval: 0,
      lfoDepth: 0,
      lfoShape: "sine",
    },
  };

  /**
   * @param {AudioContext} ctx
   * @param {string}  [preset="E_Piano"]
   */
  constructor(ctx, preset = "E_Piano") {
    super(ctx, null); // creates ctx + _out but skips preset (extra nodes not ready)

     this.modAttack = 0.002;
     this.modDecay = 0.2;
     this.modSustain = 0.12;
     this.modRelease = 0.1;
     this.modWaveform = "sine";
     this.feedback = 0;
     this.unison = false;
     this.unisonSpread = 5;

    this._filter = ctx.createBiquadFilter();
    this._filter.type = "lowpass";
    this._filter.connect(this._out);

    // Filter LFO — continuous oscillator modulating filter cutoff
    this._lfo = ctx.createOscillator();
    this._lfo.type = "sine";
    this._lfo.frequency.value = 0;
    this._lfoGain = ctx.createGain();
    this._lfoGain.gain.value = 0; // depth in Hz, 0 = off
    this._lfo.connect(this._lfoGain);
    this._lfoGain.connect(this._filter.frequency);
    this._lfo.start();

    this._lfoInterval = 0; // beats (0 = off)
    this._bpm = 120;
    this.octaveOffset = 0;
    this.octaveJumpProb = 0;
    // Chord context for sequenced steps (mirrored from Controls on change)
    this._scaleName = "Minor";
    this._chordSize = 3;

    this.applyPreset(preset);
  }

  // ---- Properties ----

  get filterFreq() {
    return this._filter.frequency.value;
  }
  set filterFreq(v) {
    this._filter.frequency.value = v;
  }

  get filterQ() {
    return this._filter.Q.value;
  }
  set filterQ(v) {
    this._filter.Q.value = v;
  }

  get lfoInterval() {
    return this._lfoInterval;
  }
  set lfoInterval(v) {
    this._lfoInterval = v;
    this._updateLfoFreq();
  }

  get bpm() {
    return this._bpm;
  }
  set bpm(v) {
    this._bpm = v;
    this._updateLfoFreq();
  }

  get lfoDepth() {
    return this._lfoGain.gain.value;
  }
  set lfoDepth(v) {
    this._lfoGain.gain.value = v;
  }

  get lfoShape() {
    return this._lfo.type;
  }
  set lfoShape(v) {
    this._lfo.type = v;
  }

  _updateLfoFreq() {
    this._lfo.frequency.value = this._lfoInterval > 0 ? this._bpm / 60 / this._lfoInterval : 0;
  }

  // ---- Playback ----

  /**
   * @param {number|number[]} midiNotes  Single note or chord array
   * @param {number} stepDurSec
   * @param {number} atTime
   */
  trigger(midiNotes, stepDurSec, atTime) {
    const raw = Array.isArray(midiNotes) ? midiNotes : [midiNotes];
    const shift = this.octaveOffset * 12 + (Math.random() < this.octaveJumpProb ? 12 : 0);
    const notes = raw.map((n) => n + shift);
    const dur = this.attack + this.decay + this.release + 0.1;
    const gainScale = 1 / notes.length;

    if (this.unison) {
      const voices = 3; 
      const spread = this.unisonSpread;
      for (const midi of notes) {
        for (let i = 0; i < voices; i++) {
          const detune = (i - (voices - 1) / 2) * spread;
          this._voice(midi, dur, atTime, gainScale / voices, detune);
        }
      }
    } else {
      for (const midi of notes) this._voice(midi, dur, atTime, gainScale);
    }
  }

  _voice(midi, dur, atTime, gainScale = 1, detune = 0) {
    const ctx = this.ctx;
    const baseFreq = WebAudioInstrumentBase._midiToFreq(midi);
    const carrierFreq = baseFreq * this.carrierRatio;
    const modFreq = baseFreq * this.modRatio;
    const modDepth = carrierFreq * this.modIndex; // Hz deviation at peak

    // ---- Modulator — output drives carrier frequency (the FM connection) ----
    const modOsc = ctx.createOscillator();
    modOsc.type = this.modWaveform;
    modOsc.frequency.value = modFreq;

    const modEnv = ctx.createGain();
     applyADSR(modEnv.gain, {
       start: atTime,
       peak: modDepth,
       attack: this.modAttack,
       decay: this.modDecay,
       sustain: this.modSustain,
       release: this.modRelease,
       releaseAt: atTime + dur,
     });

    if (this.feedback > 0) {
      const feedbackGain = ctx.createGain();
      feedbackGain.gain.value = this.feedback;
      modOsc.connect(feedbackGain);
      feedbackGain.connect(modOsc.frequency);
    }

    // ---- Carrier ----
    const carrierOsc = ctx.createOscillator();
    carrierOsc.type = "sine";
    carrierOsc.frequency.value = carrierFreq;
    carrierOsc.detune.value = this.detune + detune;

    const sus = Math.max(0.0001, this.sustain) * gainScale;
    const carrierEnv = ctx.createGain();
    carrierEnv.gain.setValueAtTime(0, atTime);
    carrierEnv.gain.linearRampToValueAtTime(gainScale, atTime + this.attack);
    carrierEnv.gain.exponentialRampToValueAtTime(sus, atTime + this.attack + this.decay);
    carrierEnv.gain.setValueAtTime(sus, atTime + this.attack + this.decay);
    carrierEnv.gain.exponentialRampToValueAtTime(0.0001, atTime + this.attack + this.decay + this.release);

    // ---- Connect ----
    modOsc.connect(modEnv);
    modEnv.connect(carrierOsc.frequency); // FM!
    carrierOsc.connect(carrierEnv);
    carrierEnv.connect(this._filter);

     modOsc.start(atTime);
      modOsc.stop(atTime + dur + this.modRelease);
     carrierOsc.start(atTime);
     carrierOsc.stop(atTime + dur);

    carrierOsc.onended = () => {
      modOsc.disconnect();
      modEnv.disconnect();
      carrierOsc.disconnect();
      carrierEnv.disconnect();
    };
  }

  static DEFAULT_EXTRA_PARAMS = {
    lfoInterval: 0,
    lfoShape: "sine",
    modAttack: 0.002,
    modDecay: 0.2,
    modSustain: 0.12,
    modRelease: 0.1,
    modWaveform: "sine",
    feedback: 0,
    unison: false,
    unisonSpread: 5,
  };

  applyPreset(name) {
    Object.assign(this, WebAudioSynthFM.DEFAULT_EXTRA_PARAMS);
    super.applyPreset(name);
  }

  /** Trigger the sequence step, building a chord from the current scale and handling ratchet. */
  triggerSequenceStep(index, s, subTime, subStepDur) {
    const chordSize = this._chordSize ?? 1;
    const chord = chordSize === 1 ? s.note + 24 : buildChordFromScale(s.note + 24, this._scaleName, chordSize);
    this._triggerRatcheted(s, subTime, subStepDur, (t, dur) => this.trigger(chord, dur, t));
  }
}

// ---- Controls companion component ----

export class WebAudioSynthFMControls extends WebAudioControlsBase {
  static SLIDER_DEFS = [
    { param: "volume", label: "Vol", min: 0, max: 1, step: 0.01 },
    {
      param: "octaveOffset",
      label: "Octave",
      min: -2,
      max: 2,
      step: 1,
      tooltip: "Shift all notes up or down by octaves.",
    },
    {
      param: "octaveJumpProb",
      label: "Oct Jump",
      min: 0,
      max: 1,
      step: 0.01,
      tooltip: "Probability of randomly jumping an octave each step.",
    },
    {
      param: "carrierRatio",
      label: "Carrier",
      min: 0.5,
      max: 4,
      step: 0.01,
      tooltip: "Carrier frequency as a ratio to the note pitch. Affects tuning character.",
    },
    {
      param: "modRatio",
      label: "Mod Ratio",
      min: 0.5,
      max: 8,
      step: 0.01,
      tooltip: "Modulator frequency ratio. Shapes the harmonic timbre.",
    },
    {
      param: "modIndex",
      label: "Mod Index",
      min: 0,
      max: 10,
      step: 0.1,
      tooltip: "FM modulation depth. Higher = more harmonics and brightness.",
    },
    {
      param: "modAttack",
      label: "Mod Attack",
      min: 0.001,
      max: 1,
      step: 0.001,
      tooltip: "How quickly the FM modulation reaches peak intensity.",
    },
    {
      param: "modDecay",
      label: "Mod Decay",
      min: 0.01,
      max: 2,
      step: 0.01,
      tooltip: "How quickly the FM modulation fades. Short = percussive attack.",
    },


    { param: "feedback", label: "Feedback", min: 0, max: 1000, step: 1, tooltip: "Modulator feedback amount." },
    { param: "unisonSpread", label: "Unison Spread", min: 0, max: 50, step: 1, tooltip: "Detune spread for unison voices." },
    { param: "attack", label: "Attack", min: 0.001, max: 1, step: 0.001, tooltip: "Amplitude envelope attack time." },
    { param: "decay", label: "Decay", min: 0.01, max: 2, step: 0.01, tooltip: "Amplitude envelope decay time." },
    {
      param: "sustain",
      label: "Sustain",
      min: 0,
      max: 1,
      step: 0.01,
      tooltip: "Amplitude sustain level (0–1) during held notes.",
    },
    {
      param: "release",
      label: "Release",
      min: 0.01,
      max: 3,
      step: 0.01,
      tooltip: "Amplitude envelope release time after note off.",
    },
    {
      param: "filterFreq",
      label: "Filter",
      min: 100,
      max: 12000,
      step: 1,
      scale: "log",
      tooltip: "Lowpass filter cutoff frequency.",
    },
    {
      param: "filterQ",
      label: "Filter Q",
      min: 0.5,
      max: 20,
      step: 0.1,
      tooltip: "Filter resonance. Emphasizes the cutoff frequency.",
    },
    { param: "detune", label: "Detune", min: -50, max: 50, step: 1, tooltip: "Global pitch detune in cents." },
    {
      param: "lfoDepth",
      label: "LFO Depth",
      min: 0,
      max: 3000,
      step: 10,
      tooltip: "LFO vibrato depth in cents. 0 = no vibrato.",
    },
  ];

  static DEFAULT_PATTERN() {
    const active = new Set([0, 8]);
    return Array.from({ length: 16 }, (_, i) => ({
      active: active.has(i),
      note: 29,
      probability: 1,
      ratchet: 1,
      conditions: "off",
    }));
  }

  constructor() {
    super();
    this._chordSizeSelect = null;
    this._lfoShapeSelect = null;
    this._lfoIntervalSelect = null;
    this._rootMidi = 29;
    this._scaleName = "Minor";
    this._chordSize = 3;
  }

  // ---- Identity overrides ----

  _defaultColor() {
    return "#4af";
  }
  _defaultTitle() {
    return "FM Synth";
  }
  _fxTitle() {
    return "FM FX";
  }

  _defaultJamKey() {
    return "n";
  }

  _triggerJam(time, stepDurationSec) {
    const notes = scaleNotesInRange(this._rootMidi, this._scaleName, 24, 48);
    if (notes.length) {
      const note = notes[Math.floor(Math.random() * notes.length)];
      const chord =
        this._chordSize === 1 ? note + 24 : buildChordFromScale(note + 24, this._scaleName, this._chordSize);
      this._instrument.trigger(chord, stepDurationSec, time);
    }
  }

  // ---- Bind override to set BPM on instrument ----

  bind(instrument, ctx, options = {}) {
    this._chordSize = options.chordSize ?? 3;
    instrument._chordSize = this._chordSize;
    instrument._scaleName = this._scaleName;
    // Set BPM on instrument so LFO interval computes correctly
    if (options.fx?.bpm) instrument.bpm = options.fx.bpm;
    super.bind(instrument, ctx, options);
  }

  // ---- Build controls (subclass hook) ----

  _buildControls(controls, expanded, mkSlider, ctx, options) {
    const color = options.color || this._defaultColor();

    const mkSelect = (labelText, appendTo) => {
      const wrap = createCtrl(labelText);
      const sel = document.createElement("select");
      sel.className = "wam-select";
      wrap.appendChild(sel);
      appendTo.appendChild(wrap);
      return sel;
    };

    // ---- Tone ----
    const { el: toneEl, controls: toneCtrl } = createSection("Tone");

    const randPresetWrap = createCtrl("Rand Preset", { tooltip: "Load a random preset." });
    const randPresetBtn = document.createElement("button");
    randPresetBtn.textContent = "⚄";
    randPresetBtn.className = "wam-action-btn";
    randPresetBtn.addEventListener("click", () => {
      const names = Object.keys(WebAudioSynthFM.PRESETS);
      this.applyPreset(names[Math.floor(Math.random() * names.length)]);
      this._emitChange();
    });
    randPresetWrap.appendChild(randPresetBtn);
    toneCtrl.appendChild(randPresetWrap);
    controls.appendChild(toneEl);

    // ---- FM ----
    const { el: fmEl, controls: fmCtrl } = createSection("FM");
    fmCtrl.appendChild(mkSlider({ param: "carrierRatio", label: "Carrier", min: 0.5, max: 4, step: 0.01 }));
    fmCtrl.appendChild(mkSlider({ param: "modRatio", label: "Mod Ratio", min: 0.5, max: 8, step: 0.01 }));
    fmCtrl.appendChild(mkSlider({ param: "modIndex", label: "Mod Index", min: 0, max: 10, step: 0.1 }));
    
    const modWaveSelect = mkSelect("Wave", fmCtrl);
    for (const shape of ["sine", "square", "sawtooth", "triangle"]) {
      const opt = document.createElement("option");
      opt.value = shape;
      opt.textContent = shape;
      if (shape === this._instrument.modWaveform) opt.selected = true;
      modWaveSelect.appendChild(opt);
    }
    this._registerSelect("modWaveform", modWaveSelect);
    
    fmCtrl.appendChild(mkSlider({ param: "feedback", label: "Feedback", min: 0, max: 1000, step: 1 }));
    fmCtrl.appendChild(mkSlider({ param: "modDecay", label: "Mod Decay", min: 0.01, max: 2, step: 0.01 }));
    controls.appendChild(fmEl);

    // ---- Unison ----
    const { el: uniEl, controls: uniCtrl } = createSection("Unison");
    const uniToggle = document.createElement("button");
    uniToggle.className = "wam-toggle-btn";
    uniToggle.textContent = "Unison";
    if (this._instrument.unison) uniToggle.setAttribute("data-active", "");
    uniCtrl.appendChild(uniToggle);
    this._registerToggle("unison", uniToggle);
    this._unisonToggle = uniToggle;

    uniCtrl.appendChild(mkSlider({ param: "unisonSpread", label: "Spread", min: 0, max: 50, step: 1 }));
    controls.appendChild(uniEl);

    // ---- Envelope ----
    const { el: envEl, controls: envCtrl } = createSection("Envelope");
    envCtrl.appendChild(mkSlider({ param: "attack", label: "Attack", min: 0.001, max: 1, step: 0.001 }));
    envCtrl.appendChild(mkSlider({ param: "decay", label: "Decay", min: 0.01, max: 2, step: 0.01 }));
    envCtrl.appendChild(mkSlider({ param: "sustain", label: "Sustain", min: 0, max: 1, step: 0.01 }));
    envCtrl.appendChild(mkSlider({ param: "release", label: "Release", min: 0.01, max: 3, step: 0.01 }));
    controls.appendChild(envEl);

    // ---- Filter ----
    const { el: filtEl, controls: filtCtrl } = createSection("Filter");
    filtCtrl.appendChild(
      mkSlider({ param: "filterFreq", label: "Cutoff", min: 100, max: 12000, step: 1, scale: "log" }),
    );
    filtCtrl.appendChild(mkSlider({ param: "filterQ", label: "Resonance", min: 0.5, max: 20, step: 0.1 }));
    filtCtrl.appendChild(mkSlider({ param: "detune", label: "Detune", min: -50, max: 50, step: 1 }));
    controls.appendChild(filtEl);

    // ---- LFO ----
    const { el: lfoEl, controls: lfoCtrl } = createSection("LFO");
    this._lfoIntervalSelect = mkSelect("Rate", lfoCtrl);
    for (const { label, beats } of WebAudioSynthFM.LFO_INTERVALS) {
      const opt = document.createElement("option");
      opt.value = beats;
      opt.textContent = label;
      if (beats === this._instrument.lfoInterval) opt.selected = true;
      this._lfoIntervalSelect.appendChild(opt);
    }
    this._registerSelect("lfoInterval", this._lfoIntervalSelect, { parse: parseFloat });
    this._lfoShapeSelect = mkSelect("Shape", lfoCtrl);
    for (const shape of ["sine", "triangle", "sawtooth", "square"]) {
      const opt = document.createElement("option");
      opt.value = shape;
      opt.textContent = shape;
      if (shape === this._instrument.lfoShape) opt.selected = true;
      this._lfoShapeSelect.appendChild(opt);
    }
    this._registerSelect("lfoShape", this._lfoShapeSelect);
    lfoCtrl.appendChild(mkSlider({ param: "lfoDepth", label: "Depth", min: 0, max: 3000, step: 10 }));
    controls.appendChild(lfoEl);

    // ---- Octave ----
    const { el: octEl, controls: octCtrl } = createSection("Octave");
    octCtrl.appendChild(mkSlider({ param: "octaveOffset", label: "Offset", min: -2, max: 2, step: 1 }));
    octCtrl.appendChild(mkSlider({ param: "octaveJumpProb", label: "Jump Prob", min: 0, max: 1, step: 0.01 }));
    controls.appendChild(octEl);

    // ---- Sequencer ----
    const { controls: seqCtrl } = this._buildSequencerSection({ onRandomize: () => this.randomize() });

    const chordWrap = createCtrl("Chord", { tooltip: "Number of notes per step trigger." });
    this._chordSizeSelect = document.createElement("select");
    this._chordSizeSelect.className = "wam-select";
    [1, 2, 3, 4].forEach((n) => {
      const opt = document.createElement("option");
      opt.value = n;
      opt.textContent = n === 1 ? "1 note" : `${n} notes`;
      if (n === this._chordSize) opt.selected = true;
      this._chordSizeSelect.appendChild(opt);
    });
    this._chordSizeSelect.addEventListener("change", () => {
      this._chordSize = parseInt(this._chordSizeSelect.value);
      this._instrument._chordSize = this._chordSize;
      this._emitChange();
    });
    chordWrap.appendChild(this._chordSizeSelect);
    seqCtrl.appendChild(chordWrap);

    // Step sequencer
    this._createSequencer(expanded, color);
  }

  // ---- Subclass hooks ----

  _seqInitOptions(color) {
    return {
      steps: WebAudioSynthFMControls.DEFAULT_PATTERN(),
      noteOptions: scaleNoteOptions(this._rootMidi, this._scaleName, 24, 48),
      probability: true,
      ratchet: true,
      conditions: true,
      color,
    };
  }

  // ---- Slider input override (unison toggle visual) ----

  _onSliderInput(param, value) {
    super._onSliderInput(param, value);
    if (param === "unison" && this._unisonToggle) {
      if (value) this._unisonToggle.setAttribute("data-active", "");
      else this._unisonToggle.removeAttribute("data-active");
    }
  }

  // ---- BPM override (also sets instrument BPM for LFO) ----

  set bpm(v) {
    if (this._fxUnit) this._fxUnit.bpm = v;
    if (this._instrument) this._instrument.bpm = v;
  }

  // ---- Serialization hooks ----

  _extraToJSON(params) {
    params.lfoInterval = this._instrument.lfoInterval;
    params.lfoShape = this._instrument.lfoShape;
    params.modAttack = this._instrument.modAttack;
    params.modDecay = this._instrument.modDecay;
    params.modSustain = this._instrument.modSustain;
    params.modRelease = this._instrument.modRelease;
    params.modWaveform = this._instrument.modWaveform;
    params.feedback = this._instrument.feedback;
    params.unison = this._instrument.unison;
    params.unisonSpread = this._instrument.unisonSpread;
  }

  _extendJSON(obj) {
    obj.chordSize = this._chordSize;
  }

  _restoreExtra(obj) {
    if (obj.chordSize != null) {
      this._chordSize = obj.chordSize;
      if (this._instrument) this._instrument._chordSize = obj.chordSize;
      if (this._chordSizeSelect) this._chordSizeSelect.value = obj.chordSize;
    }
    const inst = this._instrument;
    if (!inst) return;
    if (obj.lfoInterval != null) inst.lfoInterval = obj.lfoInterval;
    if (obj.lfoShape != null) inst.lfoShape = obj.lfoShape;
    if (obj.modAttack != null) inst.modAttack = obj.modAttack;
    if (obj.modDecay != null) inst.modDecay = obj.modDecay;
    if (obj.modSustain != null) inst.modSustain = obj.modSustain;
    if (obj.modRelease != null) inst.modRelease = obj.modRelease;
    if (obj.modWaveform != null) inst.modWaveform = obj.modWaveform;
    if (obj.feedback != null) inst.feedback = obj.feedback;
    if (obj.unison != null) inst.unison = obj.unison;
    if (obj.unisonSpread != null) inst.unisonSpread = obj.unisonSpread;
  }

  _syncExtraControls() {
    if (this._unisonToggle && this._instrument) {
      if (this._instrument.unison) this._unisonToggle.setAttribute("data-active", "");
      else this._unisonToggle.removeAttribute("data-active");
    }
  }

  setScale(rootMidi, scaleName) {
    this._rootMidi = rootMidi;
    this._scaleName = scaleName;
    if (this._instrument) this._instrument._scaleName = scaleName;
    this._seq?.setNoteOptions(scaleNoteOptions(rootMidi, scaleName, 24, 48));
  }

  randomize() {
    const scaleNotes = scaleNotesInRange(this._rootMidi, this._scaleName, 24, 48);
    if (!scaleNotes.length) return;
    const numActive = 1 + Math.floor(Math.random() * 3);
    const activeSet = new Set([0]);
    while (activeSet.size < numActive) activeSet.add(Math.floor(Math.random() * 16));
    const newSteps = Array.from({ length: 16 }, (_, i) => ({
      active: activeSet.has(i),
      note: scaleNotes[Math.floor(Math.random() * scaleNotes.length)],
    }));
    this._instrument.steps = newSteps;
    this._emitChange();
  }
}

customElements.define("wam-synth-fm-controls", WebAudioSynthFMControls);




