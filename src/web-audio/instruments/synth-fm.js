import "../ui/slider.js";
import "../ui/step-seq.js";
import { buildChordFromScale, scaleNotesInRange, scaleNoteOptions } from "../global/scales.js";
import WebAudioInstrumentBase from "../global/instrument-base.js";
import { WebAudioControlsBase, createSection, createCtrl } from "../ui/controls-base.js";
import { applyADSR } from "../global/dsp/envelope.js";
import { sliderDefs } from "../global/param-schema.js";
import presetData from "../presets/synth-fm.json" with { type: "json" };
import { presetMap } from "../global/presets.js";

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

  /** Musical carrier/modulator ratios randomize/mutate snap to (incl. classic inharmonic 1.41 / 3.14). */
  static CARRIER_RATIOS = [0.5, 1, 2, 3];
  static MOD_RATIOS = [0.5, 1, 1.41, 1.5, 2, 2.5, 3, 3.14, 3.5, 4, 5, 6, 7];

  /**
   * Param schema (see global/param-schema.js). Single source of truth for the
   * UI, serialization, randomize/mutate, and hardware mapping. The modulator
   * envelope uses the filter-env roles: in FM it is the brightness envelope.
   */
  static PARAMS = [
    // ---- FM operators ----
    { param: "carrierRatio", label: "Carrier", min: 0.5, max: 4, step: 0.01,
      group: "osc", role: "ratio", priority: 2, rand: { min: 0.5, max: 2 },
      tooltip: "Carrier frequency as a ratio to the note pitch. Affects tuning character." },
    { param: "modRatio", label: "Mod Ratio", min: 0.5, max: 8, step: 0.01,
      group: "osc", role: "ratio", priority: 1, rand: { min: 0.5, max: 7 },
      tooltip: "Modulator frequency ratio. Shapes the harmonic timbre." },
    { param: "modIndex", label: "Mod Index", min: 0, max: 10, step: 0.1,
      group: "osc", role: "index", priority: 1, rand: { min: 0.4, max: 5 },
      tooltip: "FM modulation depth. Higher = more harmonics and brightness." },
    { param: "modWaveform", label: "Wave", type: "enum", options: ["sine", "square", "sawtooth", "triangle"],
      group: "osc", role: "wave", priority: 2, rand: { weights: [6, 1, 1, 2] },
      tooltip: "Modulator waveform. Sine = classic FM; others add buzz." },
    { param: "feedback", label: "Feedback", min: 0, max: 1000, step: 1,
      group: "osc", role: "feedback", priority: 2, rand: { min: 0, max: 60, bias: 2 },
      tooltip: "Modulator feedback amount." },
    // ---- Modulator (brightness) envelope ----
    { param: "modAttack", label: "Mod Attack", min: 0.001, max: 2, step: 0.001,
      group: "filter-env", role: "filterAttack", priority: 3, rand: { min: 0.001, max: 0.1, bias: 2 },
      tooltip: "How quickly the FM modulation reaches peak intensity." },
    { param: "modDecay", label: "Mod Decay", min: 0.01, max: 4, step: 0.01,
      group: "filter-env", role: "filterDecay", priority: 1, rand: { min: 0.04, max: 1.2 },
      tooltip: "How quickly the FM modulation fades. Short = percussive attack." },
    { param: "modSustain", label: "Mod Sustain", min: 0, max: 1, step: 0.01,
      group: "filter-env", role: "filterSustain", priority: 3, rand: { min: 0, max: 0.6 },
      tooltip: "Modulation depth held after the mod decay (0–1 of peak)." },
    { param: "modRelease", label: "Mod Release", min: 0.01, max: 4, step: 0.01,
      group: "filter-env", role: "filterRelease", priority: 3, rand: { min: 0.1, max: 1.5 },
      tooltip: "How quickly the modulation fades after note off." },
    // ---- Unison ----
    { param: "unison", label: "Unison", type: "bool",
      group: "osc", role: "unison", priority: 3,
      tooltip: "Stack three detuned voices per note." },
    { param: "unisonSpread", label: "Unison Spread", min: 0, max: 50, step: 1,
      group: "osc", role: "detune", priority: 3, rand: { min: 3, max: 20 },
      tooltip: "Detune spread for unison voices." },
    // ---- Amp envelope ----
    { param: "attack", label: "Attack", min: 0.001, max: 2, step: 0.001,
      group: "amp-env", role: "attack", priority: 1, rand: { min: 0.001, max: 0.3, bias: 2.5 },
      tooltip: "Amplitude envelope attack time." },
    { param: "decay", label: "Decay", min: 0.01, max: 2, step: 0.01,
      group: "amp-env", role: "decay", priority: 1, rand: { min: 0.1, max: 1.5 },
      tooltip: "Amplitude envelope decay time." },
    { param: "sustain", label: "Sustain", min: 0, max: 1, step: 0.01,
      group: "amp-env", role: "sustain", priority: 2, rand: { min: 0, max: 0.7 },
      tooltip: "Amplitude sustain level (0–1) during held notes." },
    { param: "release", label: "Release", min: 0.01, max: 4, step: 0.01,
      group: "amp-env", role: "release", priority: 2, rand: { min: 0.1, max: 1.5 },
      tooltip: "Amplitude envelope release time after note off." },
    // ---- Filter ----
    { param: "filterFreq", label: "Filter", min: 100, max: 12000, step: 1, scale: "log",
      group: "filter", role: "cutoff", priority: 1, rand: { min: 1500, max: 12000 },
      tooltip: "Lowpass filter cutoff frequency." },
    { param: "filterQ", label: "Filter Q", min: 0.5, max: 20, step: 0.1,
      group: "filter", role: "resonance", priority: 2, rand: { min: 0.5, max: 6 },
      tooltip: "Filter resonance. Emphasizes the cutoff frequency." },
    { param: "detune", label: "Detune", min: -50, max: 50, step: 1,
      group: "pitch", role: "pitch", priority: 3, rand: { min: 0, max: 6 },
      tooltip: "Global pitch detune in cents." },
    // ---- Filter LFO ----
    { param: "lfoInterval", label: "Rate", type: "enum", options: [0, 16, 8, 4, 2, 1, 0.5, 0.25],
      group: "mod", role: "lfoRate", priority: 3, rand: { weights: [6, 1, 1, 2, 1, 1, 0, 0] },
      tooltip: "Filter LFO cycle length, synced to BPM. Off = no LFO." },
    { param: "lfoShape", label: "Shape", type: "enum", options: ["sine", "triangle", "sawtooth", "square"],
      group: "mod", role: "lfoShape", priority: 3, rand: { weights: [3, 2, 1, 1] },
      tooltip: "Filter LFO waveform." },
    { param: "lfoDepth", label: "LFO Depth", min: 0, max: 3000, step: 10,
      group: "mod", role: "lfoDepth", priority: 3, rand: { min: 0, max: 1200, bias: 1.5 },
      tooltip: "Filter LFO depth in Hz. 0 = no movement." },
    // ---- Pitch / sequencing (part-level: excluded from randomize) ----
    { param: "octaveOffset", label: "Octave", min: -2, max: 2, step: 1,
      group: "pitch", role: "octave", priority: 3, rand: false,
      tooltip: "Shift all notes up or down by octaves." },
    { param: "octaveJumpProb", label: "Oct Jump", min: 0, max: 1, step: 0.01,
      group: "seq", role: "octaveJump", priority: 3, rand: false,
      tooltip: "Probability of randomly jumping an octave each step." },
  ];

  /** Cross-param rules applied after randomize/mutate (see sound-design.js). */
  static constrain(v) {
    const snap = (x, set) => set.reduce((best, r) => (Math.abs(r - x) < Math.abs(best - x) ? r : best), set[0]);
    // Continuous ratios mostly sound inharmonic/out of tune — snap to musical ones.
    if (typeof v.carrierRatio === "number") v.carrierRatio = snap(v.carrierRatio, WebAudioSynthFM.CARRIER_RATIOS);
    if (typeof v.modRatio === "number") v.modRatio = snap(v.modRatio, WebAudioSynthFM.MOD_RATIOS);
    // Feedback with a deep index turns into screech/noise.
    if (v.modIndex > 3.5 && v.feedback > 20) v.feedback = 20;
    // Non-sine modulators are already harmonically dense; keep the index moderate.
    if (v.modWaveform !== "sine" && v.modIndex > 3) v.modIndex = 3;
    return v;
  }

  /** Presets live in ../presets/synth-fm.json (written by the dev preset store). */
  static PRESET_DATA = presetData;
  static PRESETS = presetMap(presetData);

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
  static SLIDER_DEFS = sliderDefs(WebAudioSynthFM.PARAMS);

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
    fmCtrl.appendChild(mkSlider("carrierRatio"));
    fmCtrl.appendChild(mkSlider("modRatio"));
    fmCtrl.appendChild(mkSlider("modIndex"));
    
    const modWaveSelect = mkSelect("Wave", fmCtrl);
    for (const shape of ["sine", "square", "sawtooth", "triangle"]) {
      const opt = document.createElement("option");
      opt.value = shape;
      opt.textContent = shape;
      if (shape === this._instrument.modWaveform) opt.selected = true;
      modWaveSelect.appendChild(opt);
    }
    this._registerSelect("modWaveform", modWaveSelect);
    
    fmCtrl.appendChild(mkSlider("feedback"));
    fmCtrl.appendChild(mkSlider("modDecay"));
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

    uniCtrl.appendChild(mkSlider("unisonSpread", { label: "Spread" }));
    controls.appendChild(uniEl);

    // ---- Envelope ----
    const { el: envEl, controls: envCtrl } = createSection("Envelope");
    envCtrl.appendChild(mkSlider("attack"));
    envCtrl.appendChild(mkSlider("decay"));
    envCtrl.appendChild(mkSlider("sustain"));
    envCtrl.appendChild(mkSlider("release"));
    controls.appendChild(envEl);

    // ---- Filter ----
    const { el: filtEl, controls: filtCtrl } = createSection("Filter");
    filtCtrl.appendChild(
      mkSlider("filterFreq", { label: "Cutoff" }),
    );
    filtCtrl.appendChild(mkSlider("filterQ", { label: "Resonance" }));
    filtCtrl.appendChild(mkSlider("detune"));
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
    lfoCtrl.appendChild(mkSlider("lfoDepth", { label: "Depth" }));
    controls.appendChild(lfoEl);

    // ---- Octave ----
    const { el: octEl, controls: octCtrl } = createSection("Octave");
    octCtrl.appendChild(mkSlider("octaveOffset", { label: "Offset" }));
    octCtrl.appendChild(mkSlider("octaveJumpProb", { label: "Jump Prob" }));
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




