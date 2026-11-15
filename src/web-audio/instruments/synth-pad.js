import WebAudioInstrumentBase from "../global/instrument-base.js";
import "../ui/step-seq.js";
import { scaleNoteOptions, scaleNotesInRange, buildChordFromScale } from "../global/scales.js";
import { WebAudioControlsBase, createSection, createCtrl } from "../ui/controls-base.js";
import { applyADSR } from "../global/dsp/envelope.js";
import { sliderDefs } from "../global/param-schema.js";

export default class WebAudioSynthPad extends WebAudioInstrumentBase {
  static PRESETS = {
    Default: {
      oscType: "sine",
      attack: 0.5,
      decay: 0.4,
      sustain: 0.7,
      release: 2.0,
      detune2: 0,
      filterFreq: 14000,
      filterQ: 0.8,
      filterType: "lowpass",
      filterEnvAmt: 0,
      filterAttack: 0.5,
      filterDecay: 0.4,
      filterSustain: 0,
      lfoRate: 2,
      lfoDepth: 0,
      lfoShape: "sine",
      lfoDest: "filter",
      voiceLimit: 12,
      velToFilter: 0,
      volume: 1,
    },
    Strings: {
      oscType: "sawtooth",
      attack: 0.8,
      decay: 0.5,
      sustain: 0.8,
      release: 2.5,
      detune2: 0,
      filterFreq: 10000,
      filterQ: 1,
      filterType: "lowpass",
      filterEnvAmt: 0,
      filterAttack: 0.8,
      filterDecay: 0.5,
      filterSustain: 0,
      lfoRate: 4,
      lfoDepth: 0.05,
      lfoShape: "sine",
      lfoDest: "pitch",
      voiceLimit: 12,
      velToFilter: 0.3,
      volume: 0.7,
    },
    Warm: {
      oscType: "triangle",
      attack: 0.3,
      decay: 0.3,
      sustain: 0.9,
      release: 1.5,
      detune2: 8,
      filterFreq: 7000,
      filterQ: 1,
      filterType: "lowpass",
      filterEnvAmt: 1,
      filterAttack: 0.3,
      filterDecay: 0.4,
      filterSustain: 0.2,
      lfoRate: 1,
      lfoDepth: 0,
      lfoShape: "sine",
      lfoDest: "filter",
      voiceLimit: 12,
      velToFilter: 0.2,
      volume: 0.9,
    },
    Stab: {
      oscType: "sawtooth",
      attack: 0.01,
      decay: 0.2,
      sustain: 0.0,
      release: 0.4,
      detune2: 0,
      filterFreq: 14000,
      filterQ: 1,
      filterType: "lowpass",
      filterEnvAmt: 2,
      filterAttack: 0.001,
      filterDecay: 0.15,
      filterSustain: 0,
      lfoRate: 2,
      lfoDepth: 0,
      lfoShape: "sine",
      lfoDest: "filter",
      voiceLimit: 8,
      velToFilter: 0.4,
      volume: 0.9,
    },
    Ocean: {
      oscType: "sine",
      attack: 4.0,
      decay: 1.0,
      sustain: 0.9,
      release: 6.0,
      detune2: 0,
      filterFreq: 6000,
      filterQ: 0.8,
      filterType: "lowpass",
      filterEnvAmt: 0.5,
      filterAttack: 4.0,
      filterDecay: 1.0,
      filterSustain: 0.6,
      lfoRate: 0.2,
      lfoDepth: 0.1,
      lfoShape: "sine",
      lfoDest: "filter",
      voiceLimit: 16,
      velToFilter: 0,
      volume: 0.5,
    },
    Haze: {
      oscType: "triangle",
      attack: 2.5,
      decay: 0.8,
      sustain: 0.85,
      release: 5.0,
      detune2: 6,
      filterFreq: 5000,
      filterQ: 1.0,
      filterType: "lowpass",
      filterEnvAmt: 0.3,
      filterAttack: 2.5,
      filterDecay: 0.8,
      filterSustain: 0.4,
      lfoRate: 0.5,
      lfoDepth: 0.08,
      lfoShape: "sine",
      lfoDest: "filter",
      voiceLimit: 16,
      velToFilter: 0.1,
      volume: 0.45,
    },
    Vapor: {
      oscType: "triangle",
      attack: 3.5,
      decay: 1.2,
      sustain: 0.8,
      release: 7.0,
      detune2: 10,
      filterFreq: 4000,
      filterQ: 1.2,
      filterType: "lowpass",
      filterEnvAmt: 0,
      filterAttack: 3.5,
      filterDecay: 1.2,
      filterSustain: 0.5,
      lfoRate: 0.3,
      lfoDepth: 0.12,
      lfoShape: "sine",
      lfoDest: "filter",
      voiceLimit: 16,
      velToFilter: 0,
      volume: 0.4,
    },
    Bloom: {
      oscType: "sawtooth",
      attack: 1.5,
      decay: 0.4,
      sustain: 0.75,
      release: 4.0,
      detune2: 14,
      filterFreq: 3500,
      filterQ: 1.5,
      filterType: "lowpass",
      filterEnvAmt: 1.5,
      filterAttack: 0.8,
      filterDecay: 0.5,
      filterSustain: 0.3,
      lfoRate: 0.8,
      lfoDepth: 0.06,
      lfoShape: "triangle",
      lfoDest: "filter",
      voiceLimit: 12,
      velToFilter: 0.3,
      volume: 0.35,
    },
  };

  /**
   * Param schema (see global/param-schema.js). Single source of truth for the
   * UI, serialization, randomize/mutate, and hardware mapping. `rand` ranges
   * keep rolls lush: soft attacks, long releases, gentle filtering.
   */
  static PARAMS = [
    // ---- Tone ----
    { param: "oscType", label: "Shape", type: "enum", options: ["sine", "triangle", "sawtooth", "square"],
      group: "osc", role: "wave", priority: 1, rand: { weights: [3, 3, 3, 1] },
      tooltip: "Oscillator waveform." },
    { param: "detune2", label: "Spread", min: 0, max: 60, step: 1,
      group: "osc", role: "detune", priority: 1, rand: { min: 4, max: 25 },
      tooltip: "Dual-oscillator spread in cents for chorus-like thickness." },
    // ---- Envelope ----
    { param: "attack", label: "Attack", min: 0.01, max: 8, step: 0.01,
      group: "amp-env", role: "attack", priority: 1, rand: { min: 0.05, max: 1.2, bias: 1.5 },
      tooltip: "Amplitude envelope attack time." },
    { param: "decay", label: "Decay", min: 0.01, max: 2, step: 0.01,
      group: "amp-env", role: "decay", priority: 2, rand: { min: 0.2, max: 1.5 },
      tooltip: "Amplitude envelope decay time." },
    { param: "sustain", label: "Sustain", min: 0, max: 1, step: 0.01,
      group: "amp-env", role: "sustain", priority: 2, rand: { min: 0.5, max: 0.95 },
      tooltip: "Amplitude sustain level during held notes." },
    { param: "release", label: "Release", min: 0.01, max: 10, step: 0.01,
      group: "amp-env", role: "release", priority: 1, rand: { min: 0.8, max: 5, bias: 1.5 },
      tooltip: "Amplitude release time." },
    { param: "gate", label: "Gate", min: 0.1, max: 16, step: 0.05, scale: "log",
      group: "seq", role: "gate", priority: 2, rand: false,
      tooltip: "Sequenced note length, in steps. Long attacks need a long gate to bloom." },
    // ---- Filter ----
    { param: "filterType", label: "Type", type: "enum", options: ["lowpass", "highpass", "bandpass", "notch"],
      group: "filter", role: "filterType", priority: 3, rand: { weights: [10, 1, 1, 0] },
      tooltip: "Filter mode." },
    { param: "filterFreq", label: "Cutoff", min: 80, max: 16000, step: 10, scale: "log",
      group: "filter", role: "cutoff", priority: 1, rand: { min: 600, max: 9000 },
      tooltip: "Output lowpass cutoff. Shapes brightness of the whole pad." },
    { param: "filterQ", label: "Res", min: 0.1, max: 10, step: 0.1,
      group: "filter", role: "resonance", priority: 2, rand: { min: 0.3, max: 4 },
      tooltip: "Filter resonance." },
    { param: "filterEnvAmt", label: "Env Amt", min: -6, max: 6, step: 0.1,
      group: "filter", role: "envAmt", priority: 2, rand: { min: -1, max: 2 },
      tooltip: "Filter envelope depth in octaves. Negative = downward sweep." },
    { param: "velToFilter", label: "Vel→Flt", min: 0, max: 1, step: 0.01,
      group: "filter", priority: 3, rand: { min: 0, max: 0.4 },
      tooltip: "Velocity modulates filter cutoff (0–2 octaves at max)." },
    // ---- Filter envelope ----
    { param: "filterAttack", label: "F.Atk", min: 0.001, max: 8, step: 0.001,
      group: "filter-env", role: "filterAttack", priority: 2, rand: { min: 0.05, max: 2, bias: 1.5 },
      tooltip: "Filter envelope attack time." },
    { param: "filterDecay", label: "F.Dec", min: 0.01, max: 4, step: 0.01,
      group: "filter-env", role: "filterDecay", priority: 2, rand: { min: 0.2, max: 2 },
      tooltip: "Filter envelope decay time." },
    { param: "filterSustain", label: "F.Sus", min: 0, max: 1, step: 0.01,
      group: "filter-env", role: "filterSustain", priority: 3, rand: { min: 0, max: 0.8 },
      tooltip: "Filter sustain level (0 = full decay back to base)." },
    // ---- LFO ----
    { param: "lfoRate", label: "LFO Rate", min: 0.01, max: 20, step: 0.01,
      group: "mod", role: "lfoRate", priority: 2, rand: { min: 0.05, max: 4, bias: 2 },
      tooltip: "LFO speed in Hz." },
    { param: "lfoDepth", label: "LFO Depth", min: 0, max: 1, step: 0.01,
      group: "mod", role: "lfoDepth", priority: 2, rand: { min: 0, max: 0.25, bias: 1.5 },
      tooltip: "LFO modulation depth (0 = off)." },
    { param: "lfoShape", label: "Shape", type: "enum", options: ["sine", "triangle", "square", "sawtooth"],
      group: "mod", role: "lfoShape", priority: 3, rand: { weights: [4, 3, 1, 1] },
      tooltip: "LFO waveform." },
    { param: "lfoDest", label: "Dest", type: "enum", options: ["filter", "pitch", "amp"],
      group: "mod", role: "lfoTarget", priority: 3, rand: { weights: [3, 1, 2] },
      tooltip: "What the LFO modulates." },
    // ---- Pitch / voicing / sequencing (part-level: excluded from randomize) ----
    { param: "octaveOffset", label: "Octave", min: -2, max: 2, step: 1,
      group: "pitch", role: "octave", priority: 3, rand: false,
      tooltip: "Shift all notes up or down by octaves." },
    { param: "octaveJumpProb", label: "Oct Jump", min: 0, max: 1, step: 0.01,
      group: "seq", role: "octaveJump", priority: 3, rand: false,
      tooltip: "Probability of randomly jumping an octave on each note." },
    { param: "voiceLimit", label: "V.Limit", min: 0, max: 16, step: 1,
      group: "seq", role: "voices", priority: 3, rand: false,
      tooltip: "Max simultaneous voices. Oldest voice stolen when exceeded. 0 = unlimited." },
  ];

  /**
   * Cross-param rules applied after randomize/mutate (see sound-design.js).
   * Keeps rolled pads soft and in tune.
   */
  static constrain(v) {
    // Pitch LFO depth is ×1200 cents — a pad wants a gentle drift, not a siren.
    if (v.lfoDest === "pitch" && v.lfoDepth > 0.04) v.lfoDepth = 0.04;
    // A highpass with a high cutoff thins a pad to nothing.
    if (v.filterType === "highpass" && v.filterFreq > 1200) v.filterFreq = 1200;
    // Bandpass at high Q gets whistly.
    if (v.filterType === "bandpass" && v.filterQ > 3) v.filterQ = 3;
    return v;
  }

  constructor(ctx, preset = "Default") {
    super(ctx, null);
    this._activeVoices = [];

    this._filter = ctx.createBiquadFilter();
    this._filter.type = "lowpass";
    this._filter.frequency.value = 14000;
    this._filter.Q.value = 0.8;
    this._filter.connect(this._out);

    // Defaults
    this.detune2 = 0;
    this.filterEnvAmt = 0;
    this.filterAttack = 0.5;
    this.filterDecay = 0.4;
    this.filterSustain = 0;
    this.lfoRate = 2;
    this.lfoDepth = 0;
    this.lfoShape = "sine";
    this.lfoDest = "filter";
    this.voiceLimit = 12;
    this.velToFilter = 0;
    this.octaveOffset = 0;
    this.octaveJumpProb = 0;
    this.gate = 4; // note length in steps (sequencer)
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
    this._filter.frequency.cancelScheduledValues(0);
    this._filter.frequency.value = v;
  }

  get filterQ() {
    return this._filter.Q.value;
  }
  set filterQ(v) {
    this._filter.Q.value = v;
  }

  get filterType() {
    return this._filter.type;
  }
  set filterType(v) {
    this._filter.type = v;
  }

  /**
   * @param {number|number[]} midiNotes  Single MIDI note or chord array
   * @param {number} durationSec
   * @param {number} [velocity]  0–1
   * @param {number} [atTime]    AudioContext time
   */
  trigger(midiNotes, durationSec, velocity = 1, atTime = 0) {
    const ctx = this.ctx;
    const t = atTime > 0 ? atTime : ctx.currentTime;
    const shift = this.octaveOffset * 12 + (Math.random() < this.octaveJumpProb ? 12 : 0);
    const notes = (Array.isArray(midiNotes) ? midiNotes : [midiNotes]).map((n) => n + shift);
    const perVoice = velocity / Math.sqrt(notes.length);
    const mixerGain = this.detune2 > 0 ? 0.7 : 1;
    const noteStopTime = t + durationSec + this.release + 0.1;

    // Voice stealing — remove ended voices, then steal oldest if over limit
    if (this.voiceLimit > 0) {
      const now = ctx.currentTime;
      this._activeVoices = this._activeVoices.filter((v) => v.stopTime > now);
      const newVoiceCount = notes.length * (this.detune2 > 0 ? 2 : 1);
      while (this._activeVoices.length + newVoiceCount > this.voiceLimit) {
        const stolen = this._activeVoices.shift();
        if (stolen) {
          stolen.amp.gain.cancelScheduledValues(now);
          stolen.amp.gain.setValueAtTime(stolen.amp.gain.value, now);
          stolen.amp.gain.linearRampToValueAtTime(0, now + Math.min(this.release, 0.15));
        }
      }
    }

    // Filter envelope — last trigger wins on shared filter
    const velShift = velocity * this.velToFilter * 2; // 0–2 octaves velocity boost
    const baseFreq = this.filterFreq * Math.pow(2, velShift);
    if (this.filterEnvAmt !== 0 || velShift !== 0) {
      const peakFreq = Math.max(20, Math.min(20000, baseFreq * Math.pow(2, this.filterEnvAmt)));
      const susFreq = baseFreq + (peakFreq - baseFreq) * this.filterSustain;
      const fAtk = Math.max(0.001, this.filterAttack);
      this._filter.frequency.cancelScheduledValues(t);
      this._filter.frequency.setValueAtTime(baseFreq, t);
      this._filter.frequency.linearRampToValueAtTime(peakFreq, t + fAtk);
      this._filter.frequency.linearRampToValueAtTime(susFreq, t + fAtk + this.filterDecay);
    }

    // Per-note filter LFO — connects to shared filter
    if (this.lfoDepth > 0 && this.lfoDest === "filter") {
      const lfoOsc = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfoOsc.type = this.lfoShape;
      lfoOsc.frequency.value = this.lfoRate;
      lfoGain.gain.value = this.lfoDepth * 2000;
      lfoOsc.connect(lfoGain);
      lfoGain.connect(this._filter.frequency);
      lfoOsc.start(t);
      lfoOsc.stop(noteStopTime);
    }

    notes.forEach((midi) => {
      const freq = 440 * Math.pow(2, (midi - 69) / 12);

      const makeVoice = (detuneOffset) => {
        const osc = ctx.createOscillator();
        const amp = ctx.createGain();

        osc.type = this.oscType;
        osc.frequency.value = freq;
        osc.detune.value = detuneOffset;

        const vol = detuneOffset === 0 ? perVoice * mixerGain : perVoice * 0.6;
        applyADSR(amp.gain, {
          start: t,
          peak: vol,
          attack: this.attack,
          decay: this.decay,
          sustain: this.sustain,
          release: this.release,
          releaseAt: t + durationSec,
        });

        osc.connect(amp);
        amp.connect(this._filter);
        osc.start(t);
        osc.stop(noteStopTime);

        // Per-voice pitch/amp LFO
        if (this.lfoDepth > 0 && this.lfoDest !== "filter") {
          const lfoOsc = ctx.createOscillator();
          const lfoGain = ctx.createGain();
          lfoOsc.type = this.lfoShape;
          lfoOsc.frequency.value = this.lfoRate;
          lfoOsc.connect(lfoGain);
          if (this.lfoDest === "pitch") {
            lfoGain.gain.value = this.lfoDepth * 1200;
            lfoGain.connect(osc.detune);
          } else {
            lfoGain.gain.value = this.lfoDepth * 0.4;
            lfoGain.connect(amp.gain);
          }
          lfoOsc.start(t);
          lfoOsc.stop(noteStopTime);
        }

        if (this.voiceLimit > 0) {
          this._activeVoices.push({ amp, stopTime: noteStopTime });
        }
      };

      makeVoice(this.detune2 > 0 ? this.detune2 / 2 : 0);
      if (this.detune2 > 0) makeVoice(-this.detune2 / 2);
    });

    return this;
  }

  /** Trigger the sequence step, building a chord from the current scale and handling ratchet. */
  triggerSequenceStep(index, s, subTime, subStepDur) {
    const chordSize = this._chordSize ?? 1;
    const chord = chordSize === 1 ? s.note : buildChordFromScale(s.note, this._scaleName, chordSize);
    this._triggerRatcheted(s, subTime, subStepDur, (t, dur) => this.trigger(chord, dur, 0.8, t));
  }
}

// ---- Controls companion component ----

export class WebAudioSynthPadControls extends WebAudioControlsBase {
  static SLIDER_DEFS = sliderDefs(WebAudioSynthPad.PARAMS);

  static DEFAULT_PATTERN() {
    const active = new Set([0, 4, 8, 12]);
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
    this._rootMidi = 29;
    this._scaleName = "Minor";
    this._chordSize = 3;
  }

  _defaultColor() {
    return "#88f";
  }
  _defaultTitle() {
    return "Pad Synth";
  }
  _fxTitle() {
    return "Pad FX";
  }

  _triggerJam(time, stepDurationSec) {
    const notes = scaleNotesInRange(this._rootMidi, this._scaleName, 36, 72);
    if (notes.length) {
      const note = notes[Math.floor(Math.random() * notes.length)];
      const chord = this._chordSize === 1 ? note : buildChordFromScale(note, this._scaleName, this._chordSize);
      this._instrument.trigger(chord, stepDurationSec, 0.8, time);
    }
  }

  _buildControls(controls, expanded, mkSlider, ctx, options) {
    const color = options.color || this._defaultColor();
    // ---- Tone ----
    const { el: toneEl, controls: toneCtrl } = createSection("Tone");

    this._makeWaveSelect(["sine", "triangle", "sawtooth", "square"], toneCtrl);
    toneCtrl.appendChild(mkSlider("detune2"));
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

    // ---- Voice ----
    const { el: voiceEl, controls: voiceCtrl } = createSection("Voice");
    voiceCtrl.appendChild(mkSlider("voiceLimit"));
    voiceCtrl.appendChild(mkSlider("velToFilter"));
    controls.appendChild(voiceEl);

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
    this._instrument._chordSize = this._chordSize;
    this._instrument._scaleName = this._scaleName;

    // Step sequencer
    this._createSequencer(expanded, color);
  }

  // ---- Subclass hooks ----

  _seqInitOptions(color) {
    return {
      steps: WebAudioSynthPadControls.DEFAULT_PATTERN(),
      noteOptions: scaleNoteOptions(this._rootMidi, this._scaleName, 36, 72),
      probability: true,
      ratchet: true,
      conditions: true,
      color,
    };
  }

  setScale(rootMidi, scaleName) {
    this._rootMidi = rootMidi;
    if (this._instrument) this._instrument._scaleName = scaleName;
    this._scaleName = scaleName;
    this._seq?.setNoteOptions(scaleNoteOptions(rootMidi, scaleName, 36, 72));
  }

  randomize() {
    const noteOpts = scaleNoteOptions(this._rootMidi, this._scaleName, 36, 72);
    const notes = noteOpts.map(([, midi]) => midi);
    if (!notes.length) return;
    const numActive = 2 + Math.floor(Math.random() * 3);
    const activeSet = new Set([0]);
    while (activeSet.size < numActive) activeSet.add(Math.floor(Math.random() * 16));
    const newSteps = Array.from({ length: 16 }, (_, i) => ({
      active: activeSet.has(i),
      note: notes[Math.floor(Math.random() * notes.length)],
      probability: 1,
      ratchet: 1,
      conditions: "off",
    }));
    this._instrument.steps = newSteps;
    this._emitChange();
  }

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
    obj.chordSize = this._chordSize;
  }

  _restoreExtra(obj) {
    if (obj.chordSize != null) {
      this._chordSize = obj.chordSize;
      this._instrument._chordSize = obj.chordSize;
      if (this._chordSizeSelect) this._chordSizeSelect.value = obj.chordSize;
    }
  }
}

customElements.define("wam-synth-pad-controls", WebAudioSynthPadControls);
