import "../ui/web-audio-slider.js";
import "../ui/web-audio-step-seq.js";
import { buildChordFromScale, scaleNotesInRange, scaleNoteOptions } from "../global/web-audio-scales.js";
import WebAudioInstrumentBase from "../global/web-audio-instrument-base.js";
import { WebAudioControlsBase, createSection, createCtrl } from "../ui/web-audio-controls-base.js";

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
    modDecay: "fmModDecay",
    attack: "fmAttack",
    decay: "fmDecay",
    sustain: "fmSustain",
    release: "fmRelease",
    filterFreq: "fmFilterFreq",
    filterQ: "fmFilterQ",
    detune: "fmDetune",
    volume: "fmVolume",
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
      modDecay: 0.2,
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
      modDecay: 0.06,
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
      modDecay: 0.08,
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
      modDecay: 1.0,
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
      modDecay: 2.0,
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
      modDecay: 0.04,
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
      modDecay: 0.15,
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
      modDecay: 0.05,
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
      modDecay: 0.1,
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
      modDecay: 0.8,
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
      modDecay: 0.3,
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
      modDecay: 0.5,
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
      modDecay: 1.5,
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
      modDecay: 0.8,
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
      modDecay: 4.0,
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
      modDecay: 0.08,
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

    this.modAttack = 0.002; // default — not in presets, but used by _voice

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
    for (const midi of notes) this._voice(midi, dur, atTime, gainScale);
  }

  _voice(midi, dur, atTime, gainScale = 1) {
    const ctx = this.ctx;
    const baseFreq = WebAudioInstrumentBase._midiToFreq(midi);
    const carrierFreq = baseFreq * this.carrierRatio;
    const modFreq = baseFreq * this.modRatio;
    const modDepth = carrierFreq * this.modIndex; // Hz deviation at peak

    // ---- Modulator — output drives carrier frequency (the FM connection) ----
    const modOsc = ctx.createOscillator();
    modOsc.type = "sine";
    modOsc.frequency.value = modFreq;

    const modEnv = ctx.createGain();
    modEnv.gain.setValueAtTime(0, atTime);
    modEnv.gain.linearRampToValueAtTime(modDepth, atTime + this.modAttack);
    modEnv.gain.exponentialRampToValueAtTime(
      Math.max(0.001, modDepth * 0.12), // hold at 12% — timbre darkens over time
      atTime + this.modAttack + this.modDecay,
    );

    // ---- Carrier ----
    const carrierOsc = ctx.createOscillator();
    carrierOsc.type = "sine";
    carrierOsc.frequency.value = carrierFreq;
    carrierOsc.detune.value = this.detune;

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
    modOsc.stop(atTime + dur);
    carrierOsc.start(atTime);
    carrierOsc.stop(atTime + dur);

    carrierOsc.onended = () => {
      modOsc.disconnect();
      modEnv.disconnect();
      carrierOsc.disconnect();
      carrierEnv.disconnect();
    };
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
      param: "modDecay",
      label: "Mod Decay",
      min: 0.01,
      max: 2,
      step: 0.01,
      tooltip: "How quickly the FM modulation fades. Short = percussive attack.",
    },
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
    this._seq = null;
    this._rootMidi = 29;
    this._scaleName = "Minor";
    this._chordSize = 3;

    // Sequencer position tracking
    this._globalStep = 0;
    this._seqPosition = 0;
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

  _buildStripActions(strip) {
    const btn = document.createElement("button");
    btn.textContent = "♫";
    btn.className = "wac-jam-btn";
    btn.title = "Trigger chord [N]";
    btn.addEventListener("click", () => this.triggerJamChord());
    strip.appendChild(btn);
  }

  // ---- Bind override to set BPM on instrument ----

  bind(instrument, ctx, options = {}) {
    this._chordSize = options.chordSize ?? 3;
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
      sel.className = "wac-select";
      wrap.appendChild(sel);
      appendTo.appendChild(wrap);
      return sel;
    };

    // ---- Tone ----
    const { el: toneEl, controls: toneCtrl } = createSection("Tone");
    this._makePresetDropdown(WebAudioSynthFM.PRESETS, toneCtrl);
    const randPresetWrap = createCtrl("Rand Preset", { tooltip: "Load a random preset." });
    const randPresetBtn = document.createElement("button");
    randPresetBtn.textContent = "⚄";
    randPresetBtn.className = "wac-action-btn";
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
    fmCtrl.appendChild(mkSlider({ param: "modDecay", label: "Mod Decay", min: 0.01, max: 2, step: 0.01 }));
    controls.appendChild(fmEl);

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
    this._lfoIntervalSelect.addEventListener("change", () => {
      this._instrument.lfoInterval = parseFloat(this._lfoIntervalSelect.value);
      this._emitChange();
    });
    this._lfoShapeSelect = mkSelect("Shape", lfoCtrl);
    for (const shape of ["sine", "triangle", "sawtooth", "square"]) {
      const opt = document.createElement("option");
      opt.value = shape;
      opt.textContent = shape;
      if (shape === this._instrument.lfoShape) opt.selected = true;
      this._lfoShapeSelect.appendChild(opt);
    }
    this._lfoShapeSelect.addEventListener("change", () => {
      this._instrument.lfoShape = this._lfoShapeSelect.value;
      this._emitChange();
    });
    lfoCtrl.appendChild(mkSlider({ param: "lfoDepth", label: "Depth", min: 0, max: 3000, step: 10 }));
    controls.appendChild(lfoEl);

    // ---- Octave ----
    const { el: octEl, controls: octCtrl } = createSection("Octave");
    octCtrl.appendChild(mkSlider({ param: "octaveOffset", label: "Offset", min: -2, max: 2, step: 1 }));
    octCtrl.appendChild(mkSlider({ param: "octaveJumpProb", label: "Jump Prob", min: 0, max: 1, step: 0.01 }));
    controls.appendChild(octEl);

    // ---- Sequencer ----
    const { controls: seqCtrl } = this._buildSequencerSection(controls, { onRandomize: () => this.randomize() });

    const chordWrap = createCtrl("Chord", { tooltip: "Number of notes per step trigger." });
    this._chordSizeSelect = document.createElement("select");
    this._chordSizeSelect.className = "wac-select";
    [1, 2, 3, 4].forEach((n) => {
      const opt = document.createElement("option");
      opt.value = n;
      opt.textContent = n === 1 ? "1 note" : `${n} notes`;
      if (n === this._chordSize) opt.selected = true;
      this._chordSizeSelect.appendChild(opt);
    });
    this._chordSizeSelect.addEventListener("change", () => {
      this._chordSize = parseInt(this._chordSizeSelect.value);
      this._emitChange();
    });
    chordWrap.appendChild(this._chordSizeSelect);
    seqCtrl.appendChild(chordWrap);

    // Step sequencer
    this._seq = document.createElement("web-audio-step-seq");
    const noteOpts = scaleNoteOptions(this._rootMidi, this._scaleName, 24, 48);
    this._seq.init({
      steps: WebAudioSynthFMControls.DEFAULT_PATTERN(),
      noteOptions: noteOpts,
      probability: true,
      ratchet: true,
      conditions: true,
      color,
    });
    expanded.appendChild(this._seq);
    this._seq.addEventListener("step-change", () => this._emitChange());
    this._seq.addEventListener("pattern-change", () => this._emitChange());
  }

  // ---- Slider input override (emit change after set) ----

  _onSliderInput(param, value) {
    this._instrument[param] = value;
    this._emitChange();
  }

  // ---- BPM override (also sets instrument BPM for LFO) ----

  set bpm(v) {
    if (this._fxUnit) this._fxUnit.bpm = v;
    if (this._instrument) this._instrument.bpm = v;
  }

  // ---- Sync extra controls after preset ----

  _syncExtraControls() {
    if (this._lfoShapeSelect) this._lfoShapeSelect.value = this._instrument.lfoShape;
    if (this._lfoIntervalSelect) this._lfoIntervalSelect.value = this._instrument.lfoInterval;
  }

  // ---- Serialization hooks ----

  _extraToJSON(params) {
    params.lfoInterval = this._instrument.lfoInterval;
    params.lfoShape = this._instrument.lfoShape;
  }

  _extendJSON(obj) {
    obj.steps = this._seq?.steps ?? [];
    obj.chordSize = this._chordSize;
  }

  _restoreParam(key, val) {
    if (key === "lfoShape") {
      this._instrument.lfoShape = val;
      if (this._lfoShapeSelect) this._lfoShapeSelect.value = val;
    } else if (key === "lfoInterval") {
      this._instrument.lfoInterval = val;
      if (this._lfoIntervalSelect) this._lfoIntervalSelect.value = val;
    } else if (key === "lfoRate") {
      // back-compat: old saves used Hz-based lfoRate — ignore, default interval is fine
    } else {
      super._restoreParam(key, val);
    }
  }

  _restoreExtra(obj) {
    if (obj.chordSize != null) {
      this._chordSize = obj.chordSize;
      if (this._chordSizeSelect) this._chordSizeSelect.value = obj.chordSize;
    }
    if (obj.steps && this._seq) this._seq.steps = obj.steps;
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
            const chord = this._chordSize === 1 ? s.note + 24 : buildChordFromScale(s.note + 24, this._scaleName, this._chordSize);
            const ratchet = s.ratchet ?? 1;
            if (ratchet > 1) {
              const ratchetDuration = subStepDur / ratchet;
              for (let i = 0; i < ratchet; i++) {
                this._instrument.trigger(chord, ratchetDuration * 0.9, subTime + i * ratchetDuration);
              }
            } else {
              this._instrument.trigger(chord, subStepDur, subTime);
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
      case "1:3":
        return barIndex % 3 === 0;
      case "1:4":
        return barIndex % 4 === 0;
      case "2:4":
        return barIndex % 4 === 1;
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

  setScale(rootMidi, scaleName) {
    this._rootMidi = rootMidi;
    this._scaleName = scaleName;
    this._seq?.setNoteOptions(scaleNoteOptions(rootMidi, scaleName, 24, 48));
  }

  triggerJamChord() {
    if (!this._instrument || !this._ctx) return;
    const chord = this._chordSize === 1 ? this._rootMidi + 24 : buildChordFromScale(this._rootMidi + 24, this._scaleName, this._chordSize);
    this._instrument.trigger(chord, 0.25, this._ctx.currentTime);
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
    if (this._seq) this._seq.steps = newSteps;
    this._emitChange();
  }
}

customElements.define("web-audio-synth-fm-controls", WebAudioSynthFMControls);
