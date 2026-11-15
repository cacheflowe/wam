import WebAudioInstrumentBase from "../global/instrument-base.js";
import "../ui/step-seq.js";
import { scaleNoteOptions, scaleNotesInRange, STEP_WEIGHTS } from "../global/scales.js";
import { WebAudioControlsBase, createSection, createCtrl } from "../ui/controls-base.js";
import { applyADSR, applyFilterEnv } from "../global/dsp/envelope.js";
import { createUnisonOscBank } from "../global/dsp/oscillator.js";
import { sliderDefs } from "../global/param-schema.js";
import presetData from "../presets/synth-mono.json" with { type: "json" };
import { presetMap } from "../global/presets.js";

export default class WebAudioSynthMono extends WebAudioInstrumentBase {
  /** Presets live in ../presets/synth-mono.json (written by the dev preset store). */
  static PRESET_DATA = presetData;
  static PRESETS = presetMap(presetData);

  /** trigger() argument layout, for note events (see global/note-event.js). */
  static TRIGGER_ARGS = { trigger: ["notes", "duration", "velocity", "time"] };

  /**
   * Param schema (see global/param-schema.js). Single source of truth for the
   * UI, serialization, randomize/mutate, and hardware mapping. `rand` ranges
   * are the musically useful sub-ranges a randomize/mutate may land in.
   */
  static PARAMS = [
    // ---- Tone ----
    { param: "oscType", label: "Shape", type: "enum", options: ["sawtooth", "square", "triangle", "sine"],
      group: "osc", role: "wave", priority: 1, rand: { weights: [4, 3, 2, 1] },
      tooltip: "Oscillator waveform." },
    { param: "detune", label: "Detune", min: -50, max: 50, step: 1,
      group: "pitch", role: "pitch", priority: 3, rand: false,
      tooltip: "Global pitch offset in cents." },
    { param: "unisonVoices", label: "Voices", min: 1, max: 8, step: 1,
      group: "osc", role: "unison", priority: 3, rand: { min: 1, max: 4 },
      tooltip: "Unison voice count (1 = off)." },
    { param: "unisonDetune", label: "Spread", min: 0, max: 100, step: 1,
      group: "osc", role: "detune", priority: 2, rand: { min: 0, max: 30 },
      tooltip: "Unison detune spread in cents across all voices." },
    { param: "subGain", label: "Sub", min: 0, max: 1, step: 0.01,
      group: "osc", role: "level", priority: 2, rand: { min: 0, max: 0.5 },
      tooltip: "Sub-octave oscillator level." },
    { param: "portamento", label: "Glide", min: 0, max: 2, step: 0.01,
      group: "pitch", role: "glide", priority: 2, rand: { min: 0, max: 0.15, bias: 2 },
      tooltip: "Portamento glide time in seconds." },
    // ---- Envelope ----
    { param: "attack", label: "Attack", min: 0.001, max: 4, step: 0.001,
      group: "amp-env", role: "attack", priority: 1, rand: { min: 0.001, max: 0.4, bias: 2 },
      tooltip: "Amplitude envelope attack time." },
    { param: "decay", label: "Decay", min: 0.01, max: 4, step: 0.01,
      group: "amp-env", role: "decay", priority: 1, rand: { min: 0.05, max: 1.2, bias: 1.5 },
      tooltip: "Amplitude envelope decay time." },
    { param: "sustain", label: "Sustain", min: 0, max: 1, step: 0.01,
      group: "amp-env", role: "sustain", priority: 1, rand: { min: 0.1, max: 0.9 },
      tooltip: "Amplitude sustain level during held notes." },
    { param: "release", label: "Release", min: 0.01, max: 5, step: 0.01,
      group: "amp-env", role: "release", priority: 2, rand: { min: 0.05, max: 1.5, bias: 1.5 },
      tooltip: "Amplitude release time." },
    { param: "gate", label: "Gate", min: 0.1, max: 16, step: 0.05, scale: "log",
      group: "seq", role: "gate", priority: 2, rand: false,
      tooltip: "Sequenced note length, in steps. Long attacks need a long gate to bloom." },
    // ---- Filter ----
    { param: "filterType", label: "Type", type: "enum", options: ["lowpass", "highpass", "bandpass", "notch"],
      group: "filter", role: "filterType", priority: 2, rand: { weights: [8, 1, 2, 0] },
      tooltip: "Filter mode." },
    { param: "filterFreq", label: "Cutoff", min: 20, max: 12000, step: 1, scale: "log",
      group: "filter", role: "cutoff", priority: 1, rand: { min: 150, max: 5000 },
      tooltip: "Filter base cutoff frequency." },
    { param: "filterQ", label: "Res", min: 0.5, max: 20, step: 0.1,
      group: "filter", role: "resonance", priority: 1, rand: { min: 0.7, max: 12 },
      tooltip: "Filter resonance." },
    { param: "filterEnvAmt", label: "Env Amt", min: -6, max: 6, step: 0.1,
      group: "filter", role: "envAmt", priority: 1, rand: { min: -1, max: 4 },
      tooltip: "Filter envelope depth in octaves. Negative = downward sweep." },
    // ---- Filter envelope ----
    { param: "filterAttack", label: "F.Atk", min: 0.001, max: 4, step: 0.001,
      group: "filter-env", role: "filterAttack", priority: 2, rand: { min: 0.001, max: 0.3, bias: 2 },
      tooltip: "Filter envelope attack time." },
    { param: "filterDecay", label: "F.Dec", min: 0.01, max: 4, step: 0.01,
      group: "filter-env", role: "filterDecay", priority: 1, rand: { min: 0.05, max: 1.2, bias: 1.5 },
      tooltip: "Filter envelope decay time." },
    { param: "filterSustain", label: "F.Sus", min: 0, max: 1, step: 0.01,
      group: "filter-env", role: "filterSustain", priority: 2, rand: { min: 0, max: 0.6 },
      tooltip: "Filter sustain level (0 = full decay, 1 = stay at peak)." },
    { param: "filterRelease", label: "F.Rel", min: 0.01, max: 5, step: 0.01,
      group: "filter-env", role: "filterRelease", priority: 3, rand: { min: 0.05, max: 1.5, bias: 1.5 },
      tooltip: "Filter envelope release time." },
    // ---- LFO ----
    { param: "lfoRate", label: "LFO Rate", min: 0.01, max: 20, step: 0.01,
      group: "mod", role: "lfoRate", priority: 2, rand: { min: 0.1, max: 8, bias: 1.5 },
      tooltip: "LFO speed in Hz." },
    { param: "lfoDepth", label: "LFO Depth", min: 0, max: 1, step: 0.01,
      group: "mod", role: "lfoDepth", priority: 2, rand: { min: 0, max: 0.3, bias: 1.5 },
      tooltip: "LFO modulation depth (0 = off)." },
    { param: "lfoShape", label: "Shape", type: "enum", options: ["sine", "triangle", "square", "sawtooth"],
      group: "mod", role: "lfoShape", priority: 3, rand: { weights: [3, 2, 1, 1] },
      tooltip: "LFO waveform." },
    { param: "lfoDest", label: "Dest", type: "enum", options: ["filter", "pitch", "amp"],
      group: "mod", role: "lfoTarget", priority: 3, rand: { weights: [3, 1, 1] },
      tooltip: "What the LFO modulates." },
    // ---- Pitch / sequencing (part-level: excluded from randomize) ----
    { param: "octaveOffset", label: "Octave", min: -2, max: 2, step: 1,
      group: "pitch", role: "octave", priority: 3, rand: false,
      tooltip: "Shift all notes up or down by octaves." },
    { param: "octaveJumpProb", label: "Oct Jump", min: 0, max: 1, step: 0.01,
      group: "seq", role: "octaveJump", priority: 3, rand: false,
      tooltip: "Probability of randomly jumping an octave on each note." },
  ];

  /**
   * Cross-param rules applied after randomize/mutate (see sound-design.js).
   * Keeps rolled sounds from landing in harsh, silent, or seasick corners.
   */
  static constrain(v) {
    // Pitch LFO depth is ×1200 cents — keep it to a vibrato, not a siren.
    if (v.lfoDest === "pitch" && v.lfoDepth > 0.05) v.lfoDepth = 0.05;
    // A highpass with a high cutoff on a mono bass/lead is near-silent.
    if (v.filterType === "highpass" && v.filterFreq > 1500) v.filterFreq = 1500;
    // Bandpass at high Q gets whistly and loud.
    if (v.filterType === "bandpass" && v.filterQ > 6) v.filterQ = 6;
    // A closed lowpass with little envelope sweep is mud.
    if (v.filterType === "lowpass" && v.filterFreq < 300 && v.filterEnvAmt < 1) v.filterEnvAmt = 1;
    // Spread does nothing on a single voice; keep it at 0 so the knob reads honestly.
    if (v.unisonVoices <= 1) v.unisonDetune = 0;
    return v;
  }

  constructor(ctx, preset = "Default") {
    super(ctx, null);
    this._lastFreq = 0;
    // Defaults — overridden by applyPreset
    this.oscType = "sawtooth";
    this.attack = 0.02;
    this.decay = 0.2;
    this.sustain = 0.5;
    this.release = 0.4;
    this.filterType = "lowpass";
    this.filterFreq = 600;
    this.filterQ = 4;
    this.filterEnvAmt = 2;
    this.filterAttack = 0.02;
    this.filterDecay = 0.2;
    this.filterSustain = 0;
    this.filterRelease = 0.4;
    this.detune = 0;
    this.unisonVoices = 1;
    this.unisonDetune = 0;
    this.subGain = 0;
    this.portamento = 0;
    this.lfoRate = 2;
    this.lfoDepth = 0;
    this.lfoShape = "sine";
    this.lfoDest = "filter";
    this.octaveOffset = 0;
    this.octaveJumpProb = 0;
    this.gate = 1; // note length in steps (sequencer)
    this.applyPreset(preset);
  }

  /**
   * @param {number} midiNote
   * @param {number} durationSec
   * @param {number} [velocity]  0–1
   * @param {number} [atTime]    AudioContext time
   */
  trigger(midiNote, durationSec, velocity = 1, atTime = 0) {
    const ctx = this.ctx;
    const t = atTime > 0 ? atTime : ctx.currentTime;
    const shifted = midiNote + this.octaveOffset * 12 + (Math.random() < this.octaveJumpProb ? 12 : 0);
    const freq = 440 * Math.pow(2, (shifted - 69) / 12);
    const voices = Math.max(1, Math.round(this.unisonVoices));
    const stopTime = t + durationSec + Math.max(this.release, this.filterRelease) + 0.1;

    // Mixer — compensates gain for unison voice count
    const mixer = ctx.createGain();
    mixer.gain.value = 1 / Math.sqrt(voices);
    const filter = ctx.createBiquadFilter();
    const amp = ctx.createGain();

    // Unison oscillators spread evenly across [-unisonDetune/2, +unisonDetune/2]
    const allOscs = createUnisonOscBank(ctx, {
      voices,
      type: this.oscType,
      detune: this.detune,
      spread: this.unisonDetune,
      freq,
      glideFrom: this._lastFreq,
      glideTime: this.portamento,
      glideCurve: "linear",
      start: t,
      stop: stopTime,
      dest: mixer,
    });
    this._lastFreq = freq;

    // Sub oscillator — sine one octave below, bypasses the filter
    if (this.subGain > 0) {
      const subOsc = ctx.createOscillator();
      const subGainNode = ctx.createGain();
      subOsc.type = "sine";
      subOsc.frequency.value = freq / 2;
      subGainNode.gain.value = this.subGain;
      subOsc.connect(subGainNode);
      subGainNode.connect(amp);
      subOsc.start(t);
      subOsc.stop(stopTime);
    }

    // Filter
    filter.type = this.filterType;
    filter.Q.value = this.filterQ;

    // Amplitude ADSR (linearRamp — preserves original envelope character)
    applyADSR(amp.gain, {
      start: t,
      peak: velocity,
      attack: this.attack,
      decay: this.decay,
      sustain: this.sustain,
      release: this.release,
      releaseAt: t + durationSec,
    });

    mixer.connect(filter);
    filter.connect(amp);
    amp.connect(this._out);

    // LFO — per-note modulation.
    // Key insight: scheduled automation (linearRamp/exponentialRamp) on an AudioParam
    // conflicts with audio-rate node connections to the same param, causing clicks.
    // Solution: when LFO targets filter, drive the filter envelope via a
    // ConstantSource (audio-rate) so both envelope and LFO sum cleanly.
    // Amp tremolo uses a separate gain node in the signal path.
    const lfoTargetsFilter = this.lfoDepth > 0 && this.lfoDest === "filter";

    // Filter envelope — always uses scheduled automation on filter.frequency
    applyFilterEnv(filter.frequency, {
      base: this.filterFreq,
      envAmtOctaves: this.filterEnvAmt,
      sustain: this.filterSustain,
      attack: this.filterAttack,
      decay: this.filterDecay,
      release: this.filterRelease,
      start: t,
      releaseAt: t + durationSec,
    });

    if (lfoTargetsFilter) {
      // Modulate filter.detune (cents) via a smoothed LFO signal.
      // BiquadFilterNode updates coefficients once per render quantum (128 samples).
      // Rapid changes — especially from square/sawtooth waves — cause coefficient
      // discontinuities that produce audible clicks. A one-pole smoothing filter
      // on the LFO signal limits the rate of change per quantum.
      const lfoOsc = ctx.createOscillator();
      const lfoGainNode = ctx.createGain();
      lfoOsc.type = this.lfoShape;
      lfoOsc.frequency.value = this.lfoRate;
      lfoGainNode.gain.value = this.lfoDepth * 2400;
      lfoOsc.connect(lfoGainNode);
      // Smoothing: lowpass at the render quantum rate (~344 Hz) to round off
      // only the sharpest transients that cause per-quantum coefficient clicks.
      const smoother = ctx.createBiquadFilter();
      smoother.type = "lowpass";
      smoother.frequency.value = 300;
      smoother.Q.value = 0.5;
      lfoGainNode.connect(smoother);
      smoother.connect(filter.detune);
      lfoOsc.start(t);
      lfoOsc.stop(stopTime);
    }

    if (this.lfoDepth > 0 && !lfoTargetsFilter) {
      const lfoOsc = ctx.createOscillator();
      const lfoGainNode = ctx.createGain();
      lfoOsc.type = this.lfoShape;
      lfoOsc.frequency.value = this.lfoRate;
      lfoOsc.connect(lfoGainNode);

      if (this.lfoDest === "pitch") {
        lfoGainNode.gain.value = this.lfoDepth * 1200; // cents
        for (const osc of allOscs) lfoGainNode.connect(osc.detune);
      } else {
        // Amp/tremolo: insert a gain node in the signal path whose gain is
        // modulated by the LFO. Range: [1 - depth, 1]. This multiplies the
        // signal rather than fighting the amp's ADSR automation.
        const tremoloNode = ctx.createGain();
        tremoloNode.gain.value = 1.0 - this.lfoDepth * 0.5;
        filter.disconnect(amp);
        filter.connect(tremoloNode);
        tremoloNode.connect(amp);
        lfoGainNode.gain.value = Math.min(this.lfoDepth * 0.5, 1.0 - this.lfoDepth * 0.5);
        lfoGainNode.connect(tremoloNode.gain);
      }
      lfoOsc.start(t);
      lfoOsc.stop(stopTime);
    }

    return this;
  }

  /** Trigger the sequence step, handling ratchet subdivisions. */
  triggerSequenceStep(index, s, subTime, subStepDur) {
    this._triggerRatcheted(s, subTime, subStepDur, (t, dur) => this.trigger(s.note, dur, 0.8, t));
  }
}

// ---- Controls companion component ----

export class WebAudioSynthMonoControls extends WebAudioControlsBase {
  static SLIDER_DEFS = sliderDefs(WebAudioSynthMono.PARAMS);

  static DEFAULT_PATTERN() {
    return Array.from({ length: 16 }, (_, i) => ({
      active: i % 4 === 0,
      note: 41,
      probability: 1,
      ratchet: 1,
      conditions: "off",
    }));
  }

  constructor() {
    super();
    this._rootMidi = 41;
    this._scaleName = "Minor";
  }

  _defaultColor() {
    return "#0f0";
  }
  _defaultTitle() {
    return "Mono Synth";
  }
  _fxTitle() {
    return "Mono FX";
  }

  _triggerJam(time, stepDurationSec) {
    const notes = scaleNotesInRange(this._rootMidi, this._scaleName, 24, 72);
    if (notes.length) {
      this._instrument.trigger(notes[Math.floor(Math.random() * notes.length)], stepDurationSec, 0.8, time);
    }
  }

  _buildControls(controls, expanded, mkSlider, ctx, options) {
    const color = options.color || this._defaultColor();
    // ---- Tone ----
    const { el: toneEl, controls: toneCtrl } = createSection("Tone");

    this._makeWaveSelect(["sawtooth", "square", "triangle", "sine"], toneCtrl);
    toneCtrl.appendChild(mkSlider("detune"));
    toneCtrl.appendChild(mkSlider("unisonVoices"));
    toneCtrl.appendChild(mkSlider("unisonDetune"));
    toneCtrl.appendChild(mkSlider("subGain"));
    toneCtrl.appendChild(mkSlider("portamento"));
    controls.appendChild(toneEl);

    // ---- Envelope ----
    const { el: envEl, controls: envCtrl } = createSection("Envelope");
    envCtrl.appendChild(mkSlider("attack"));
    envCtrl.appendChild(mkSlider("decay"));
    envCtrl.appendChild(mkSlider("sustain"));
    envCtrl.appendChild(mkSlider("release"));
    envCtrl.appendChild(mkSlider("gate"));
    controls.appendChild(envEl);

    // ---- Filter ----
    const { el: filterEl, controls: filterCtrl } = createSection("Filter");
    filterCtrl.appendChild(this._makeFilterTypeSelect());
    filterCtrl.appendChild(
      mkSlider("filterFreq"),
    );
    filterCtrl.appendChild(mkSlider("filterQ"));
    filterCtrl.appendChild(mkSlider("filterEnvAmt"));
    controls.appendChild(filterEl);

    // ---- Filter Envelope ----
    const { el: fenvEl, controls: fenvCtrl } = createSection("Filter Env");
    fenvCtrl.appendChild(mkSlider("filterAttack"));
    fenvCtrl.appendChild(mkSlider("filterDecay"));
    fenvCtrl.appendChild(mkSlider("filterSustain"));
    fenvCtrl.appendChild(mkSlider("filterRelease"));
    controls.appendChild(fenvEl);

    // ---- LFO ----
    const { el: lfoEl, controls: lfoCtrl } = createSection("LFO");
    lfoCtrl.appendChild(mkSlider("lfoRate", { label: "Rate" }));
    lfoCtrl.appendChild(mkSlider("lfoDepth", { label: "Depth" }));
    lfoCtrl.appendChild(this._makeLfoShapeSelect());
    lfoCtrl.appendChild(this._makeLfoDestSelect());
    controls.appendChild(lfoEl);

    // ---- Octave ----
    const { el: octEl, controls: octCtrl } = createSection("Octave");
    octCtrl.appendChild(mkSlider("octaveOffset", { label: "Offset" }));
    octCtrl.appendChild(mkSlider("octaveJumpProb", { label: "Jump Prob" }));
    controls.appendChild(octEl);

    // ---- Sequencer ----
    this._buildSequencerSection({ onRandomize: () => this.randomize() });
    this._createSequencer(expanded, color);
  }

  // ---- Subclass hooks ----

  _seqInitOptions(color) {
    return {
      steps: WebAudioSynthMonoControls.DEFAULT_PATTERN(),
      noteOptions: scaleNoteOptions(this._rootMidi, this._scaleName, 24, 72),
      probability: true,
      ratchet: true,
      conditions: true,
      color,
    };
  }

  setScale(rootMidi, scaleName) {
    this._rootMidi = rootMidi;
    this._scaleName = scaleName;
    this._seq?.setNoteOptions(scaleNoteOptions(rootMidi, scaleName, 24, 72));
  }

  randomize() {
    const noteOpts = scaleNoteOptions(this._rootMidi, this._scaleName, 24, 72);
    const notes = noteOpts.map(([, midi]) => midi);
    if (!notes.length) return;
    const newSteps = Array.from({ length: 16 }, (_, i) => {
      const active = Math.random() < STEP_WEIGHTS[i] * 0.6;
      const note = notes[Math.floor(Math.random() * notes.length)];
      return { active, note, probability: 1, ratchet: 1, conditions: "off" };
    });
    newSteps[0] = { active: true, note: this._rootMidi, probability: 1, ratchet: 1, conditions: "off" };
    this._instrument.steps = newSteps;
    this._emitChange();
  }

  // Serialization
  _makeFilterTypeSelect() {
    const wrap = createCtrl("Type");
    this._filterTypeSelect = document.createElement("select");
    this._filterTypeSelect.className = "wam-select";
    for (const [val, label] of [
      ["lowpass", "LP"],
      ["highpass", "HP"],
      ["bandpass", "BP"],
      ["notch", "Notch"],
    ]) {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = label;
      this._filterTypeSelect.appendChild(opt);
    }
    this._filterTypeSelect.value = this._instrument.filterType;
    this._registerSelect("filterType", this._filterTypeSelect);
    wrap.appendChild(this._filterTypeSelect);
    return wrap;
  }

  _makeLfoShapeSelect() {
    const wrap = createCtrl("Shape");
    this._lfoShapeSelect = document.createElement("select");
    this._lfoShapeSelect.className = "wam-select";
    for (const [val, label] of [
      ["sine", "Sin"],
      ["triangle", "Tri"],
      ["square", "Sqr"],
      ["sawtooth", "Saw"],
    ]) {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = label;
      this._lfoShapeSelect.appendChild(opt);
    }
    this._lfoShapeSelect.value = this._instrument.lfoShape;
    this._registerSelect("lfoShape", this._lfoShapeSelect);
    wrap.appendChild(this._lfoShapeSelect);
    return wrap;
  }

  _makeLfoDestSelect() {
    const wrap = createCtrl("Dest");
    this._lfoDestSelect = document.createElement("select");
    this._lfoDestSelect.className = "wam-select";
    for (const [val, label] of [
      ["filter", "Filter"],
      ["pitch", "Pitch"],
      ["amp", "Amp"],
    ]) {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = label;
      this._lfoDestSelect.appendChild(opt);
    }
    this._lfoDestSelect.value = this._instrument.lfoDest;
    this._registerSelect("lfoDest", this._lfoDestSelect);
    wrap.appendChild(this._lfoDestSelect);
    return wrap;
  }

  _extraToJSON(params) {
    params.oscType = this._instrument.oscType;
    params.filterType = this._instrument.filterType;
    params.lfoShape = this._instrument.lfoShape;
    params.lfoDest = this._instrument.lfoDest;
  }

  _extendJSON(obj) {
    obj.steps = this._seq?.steps ?? [];
  }

  _restoreExtra(obj) {
    if (obj.steps && this._seq) this._seq.steps = obj.steps;
  }
}

customElements.define("wam-synth-mono-controls", WebAudioSynthMonoControls);
