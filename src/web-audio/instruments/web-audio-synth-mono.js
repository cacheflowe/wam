import WebAudioInstrumentBase from "../global/web-audio-instrument-base.js";
import "../ui/web-audio-step-seq.js";
import { scaleNoteOptions, STEP_WEIGHTS } from "../global/web-audio-scales.js";
import { WebAudioControlsBase, createSection, createCtrl } from "../ui/web-audio-controls-base.js";

export default class WebAudioSynthMono extends WebAudioInstrumentBase {
  static PRESETS = {
    Default: {
      oscType: "sawtooth",
      attack: 0.02, decay: 0.2, sustain: 0.5, release: 0.4,
      filterType: "lowpass", filterFreq: 600, filterQ: 4, filterEnvAmt: 2,
      filterAttack: 0.02, filterDecay: 0.2, filterSustain: 0, filterRelease: 0.4,
      detune: 0, unisonVoices: 1, unisonDetune: 0, subGain: 0,
      portamento: 0, lfoRate: 2, lfoDepth: 0, lfoShape: "sine", lfoDest: "filter",
      volume: 1,
    },
    Bass: {
      oscType: "sawtooth",
      attack: 0.01, decay: 0.3, sustain: 0.6, release: 0.3,
      filterType: "lowpass", filterFreq: 400, filterQ: 6, filterEnvAmt: 3,
      filterAttack: 0.01, filterDecay: 0.3, filterSustain: 0, filterRelease: 0.3,
      detune: 0, unisonVoices: 1, unisonDetune: 0, subGain: 0.4,
      portamento: 0, lfoRate: 2, lfoDepth: 0, lfoShape: "sine", lfoDest: "filter",
      volume: 1,
    },
    Soft_Bass: {
      oscType: "sawtooth",
      attack: 0.02, decay: 0.2, sustain: 0.5, release: 0.4,
      filterType: "lowpass", filterFreq: 500, filterQ: 5, filterEnvAmt: 2,
      filterAttack: 0.02, filterDecay: 0.2, filterSustain: 0, filterRelease: 0.4,
      detune: 0, unisonVoices: 1, unisonDetune: 0, subGain: 0,
      portamento: 0, lfoRate: 2, lfoDepth: 0, lfoShape: "sine", lfoDest: "filter",
      volume: 0.6,
    },
    Lead: {
      oscType: "sawtooth",
      attack: 0.01, decay: 0.15, sustain: 0.7, release: 0.5,
      filterType: "lowpass", filterFreq: 1200, filterQ: 5, filterEnvAmt: 2,
      filterAttack: 0.01, filterDecay: 0.15, filterSustain: 0, filterRelease: 0.5,
      detune: 5, unisonVoices: 2, unisonDetune: 8, subGain: 0,
      portamento: 0, lfoRate: 5, lfoDepth: 0.05, lfoShape: "sine", lfoDest: "pitch",
      volume: 0.9,
    },
    Pad: {
      oscType: "triangle",
      attack: 0.4, decay: 0.5, sustain: 0.8, release: 1.5,
      filterType: "lowpass", filterFreq: 800, filterQ: 2, filterEnvAmt: 1,
      filterAttack: 0.4, filterDecay: 0.5, filterSustain: 0.3, filterRelease: 1.5,
      detune: 0, unisonVoices: 3, unisonDetune: 12, subGain: 0,
      portamento: 0, lfoRate: 0.5, lfoDepth: 0.1, lfoShape: "sine", lfoDest: "filter",
      volume: 0.8,
    },
    Pluck: {
      oscType: "square",
      attack: 0.001, decay: 0.1, sustain: 0.0, release: 0.2,
      filterType: "lowpass", filterFreq: 2000, filterQ: 8, filterEnvAmt: 3,
      filterAttack: 0.001, filterDecay: 0.08, filterSustain: 0, filterRelease: 0.2,
      detune: 0, unisonVoices: 1, unisonDetune: 0, subGain: 0,
      portamento: 0, lfoRate: 2, lfoDepth: 0, lfoShape: "sine", lfoDest: "filter",
      volume: 0.9,
    },
    Airy_Lead: {
      oscType: "sawtooth",
      attack: 0.02, decay: 0.15, sustain: 0.3, release: 0.8,
      filterType: "highpass", filterFreq: 4000, filterQ: 1, filterEnvAmt: 0,
      filterAttack: 0.02, filterDecay: 0.15, filterSustain: 0, filterRelease: 0.8,
      detune: 0, unisonVoices: 1, unisonDetune: 0, subGain: 0,
      portamento: 0, lfoRate: 2, lfoDepth: 0, lfoShape: "sine", lfoDest: "filter",
      volume: 0.35,
    },
    Cello: {
      oscType: "sawtooth",
      attack: 0.12, decay: 0.3, sustain: 0.7, release: 0.8,
      filterType: "lowpass", filterFreq: 700, filterQ: 3, filterEnvAmt: 1.5,
      filterAttack: 0.12, filterDecay: 0.3, filterSustain: 0.1, filterRelease: 0.8,
      detune: 0, unisonVoices: 2, unisonDetune: 8, subGain: 0.15,
      portamento: 0.06, lfoRate: 5, lfoDepth: 0.04, lfoShape: "sine", lfoDest: "pitch",
      volume: 0.5,
    },
    Whisper: {
      oscType: "sine",
      attack: 0.3, decay: 0.6, sustain: 0.4, release: 1.5,
      filterType: "lowpass", filterFreq: 2500, filterQ: 1, filterEnvAmt: 0,
      filterAttack: 0.3, filterDecay: 0.6, filterSustain: 0, filterRelease: 1.5,
      detune: 0, unisonVoices: 2, unisonDetune: 5, subGain: 0,
      portamento: 0.1, lfoRate: 3, lfoDepth: 0.03, lfoShape: "sine", lfoDest: "pitch",
      volume: 0.25,
    },
    Drone_Pad: {
      oscType: "triangle",
      attack: 0.8, decay: 0.5, sustain: 0.9, release: 2.0,
      filterType: "lowpass", filterFreq: 500, filterQ: 1.5, filterEnvAmt: 0.5,
      filterAttack: 0.8, filterDecay: 0.5, filterSustain: 0.5, filterRelease: 2.0,
      detune: 0, unisonVoices: 2, unisonDetune: 3, subGain: 0.2,
      portamento: 0.2, lfoRate: 0.3, lfoDepth: 0.15, lfoShape: "sine", lfoDest: "filter",
      volume: 0.55,
    },
  };

  constructor(ctx, preset = "Default") {
    super(ctx, null);
    this._lastFreq = 0;
    // Defaults — overridden by applyPreset
    this.oscType = "sawtooth";
    this.attack = 0.02; this.decay = 0.2; this.sustain = 0.5; this.release = 0.4;
    this.filterType = "lowpass";
    this.filterFreq = 600; this.filterQ = 4; this.filterEnvAmt = 2;
    this.filterAttack = 0.02; this.filterDecay = 0.2; this.filterSustain = 0; this.filterRelease = 0.4;
    this.detune = 0; this.unisonVoices = 1; this.unisonDetune = 0; this.subGain = 0;
    this.portamento = 0;
    this.lfoRate = 2; this.lfoDepth = 0; this.lfoShape = "sine"; this.lfoDest = "filter";
    this.octaveOffset = 0;
    this.octaveJumpProb = 0;
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
    const allOscs = [];
    for (let i = 0; i < voices; i++) {
      const spread = voices > 1 ? (i / (voices - 1) - 0.5) * this.unisonDetune : 0;
      const osc = ctx.createOscillator();
      osc.type = this.oscType;
      osc.detune.value = this.detune + spread;
      if (this.portamento > 0 && this._lastFreq > 0) {
        osc.frequency.setValueAtTime(this._lastFreq, t);
        osc.frequency.linearRampToValueAtTime(freq, t + this.portamento);
      } else {
        osc.frequency.value = freq;
      }
      osc.connect(mixer);
      osc.start(t);
      osc.stop(stopTime);
      allOscs.push(osc);
    }
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

    // Filter ADSR envelope
    const baseFreq = this.filterFreq;
    const peakFreq = Math.max(20, Math.min(20000, baseFreq * Math.pow(2, this.filterEnvAmt)));
    const susFreq = baseFreq + (peakFreq - baseFreq) * this.filterSustain;
    const fAtk = Math.max(0.001, this.filterAttack);
    filter.frequency.setValueAtTime(baseFreq, t);
    filter.frequency.linearRampToValueAtTime(peakFreq, t + fAtk);
    filter.frequency.linearRampToValueAtTime(susFreq, t + fAtk + this.filterDecay);
    filter.frequency.setValueAtTime(susFreq, t + durationSec);
    filter.frequency.linearRampToValueAtTime(baseFreq, t + durationSec + this.filterRelease);

    // Amplitude ADSR
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(velocity, t + this.attack);
    amp.gain.linearRampToValueAtTime(velocity * this.sustain, t + this.attack + this.decay);
    amp.gain.setValueAtTime(velocity * this.sustain, t + durationSec);
    amp.gain.linearRampToValueAtTime(0, t + durationSec + this.release);

    mixer.connect(filter);
    filter.connect(amp);
    amp.connect(this._out);

    // LFO — per-note oscillator added on top of scheduled automations
    if (this.lfoDepth > 0) {
      const lfoOsc = ctx.createOscillator();
      const lfoGainNode = ctx.createGain();
      lfoOsc.type = this.lfoShape;
      lfoOsc.frequency.value = this.lfoRate;
      lfoOsc.connect(lfoGainNode);
      if (this.lfoDest === "filter") {
        lfoGainNode.gain.value = this.lfoDepth * 3000;
        lfoGainNode.connect(filter.frequency);
      } else if (this.lfoDest === "pitch") {
        lfoGainNode.gain.value = this.lfoDepth * 1200; // cents
        for (const osc of allOscs) lfoGainNode.connect(osc.detune);
      } else { // amp / tremolo
        lfoGainNode.gain.value = this.lfoDepth * 0.5;
        lfoGainNode.connect(amp.gain);
      }
      lfoOsc.start(t);
      lfoOsc.stop(stopTime);
    }

    return this;
  }
}

// ---- Controls companion component ----

export class WebAudioSynthMonoControls extends WebAudioControlsBase {
  static SLIDER_DEFS = [
    { param: "attack",        label: "Attack",    min: 0.001, max: 4,     step: 0.001, tooltip: "Amplitude envelope attack time." },
    { param: "decay",         label: "Decay",     min: 0.01,  max: 4,     step: 0.01,  tooltip: "Amplitude envelope decay time." },
    { param: "sustain",       label: "Sustain",   min: 0,     max: 1,     step: 0.01,  tooltip: "Amplitude sustain level during held notes." },
    { param: "release",       label: "Release",   min: 0.01,  max: 5,     step: 0.01,  tooltip: "Amplitude release time." },
    { param: "filterFreq",    label: "Cutoff",    min: 20,    max: 12000, step: 1, scale: "log", tooltip: "Filter base cutoff frequency." },
    { param: "filterQ",       label: "Res",       min: 0.5,   max: 20,    step: 0.1,   tooltip: "Filter resonance." },
    { param: "filterEnvAmt",  label: "Env Amt",   min: -6,    max: 6,     step: 0.1,   tooltip: "Filter envelope depth in octaves. Negative = downward sweep." },
    { param: "filterAttack",  label: "F.Atk",     min: 0.001, max: 4,     step: 0.001, tooltip: "Filter envelope attack time." },
    { param: "filterDecay",   label: "F.Dec",     min: 0.01,  max: 4,     step: 0.01,  tooltip: "Filter envelope decay time." },
    { param: "filterSustain", label: "F.Sus",     min: 0,     max: 1,     step: 0.01,  tooltip: "Filter sustain level (0 = full decay, 1 = stay at peak)." },
    { param: "filterRelease", label: "F.Rel",     min: 0.01,  max: 5,     step: 0.01,  tooltip: "Filter envelope release time." },
    { param: "detune",        label: "Detune",    min: -50,   max: 50,    step: 1,     tooltip: "Global pitch offset in cents." },
    { param: "unisonVoices",  label: "Voices",    min: 1,     max: 8,     step: 1,     tooltip: "Unison voice count (1 = off)." },
    { param: "unisonDetune",  label: "Spread",    min: 0,     max: 100,   step: 1,     tooltip: "Unison detune spread in cents across all voices." },
    { param: "subGain",       label: "Sub",       min: 0,     max: 1,     step: 0.01,  tooltip: "Sub-octave oscillator level." },
    { param: "portamento",    label: "Glide",     min: 0,     max: 2,     step: 0.01,  tooltip: "Portamento glide time in seconds." },
    { param: "lfoRate",       label: "LFO Rate",  min: 0.01,  max: 20,    step: 0.01,  tooltip: "LFO speed in Hz." },
    { param: "lfoDepth",      label: "LFO Depth", min: 0,     max: 1,     step: 0.01,  tooltip: "LFO modulation depth (0 = off)." },
    { param: "octaveOffset",  label: "Octave",    min: -2,    max: 2,     step: 1,     tooltip: "Shift all notes up or down by octaves." },
    { param: "octaveJumpProb",label: "Oct Jump",  min: 0,     max: 1,     step: 0.01,  tooltip: "Probability of randomly jumping an octave on each note." },
    { param: "volume",        label: "Vol",       min: 0,     max: 1,     step: 0.01 },
  ];

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
    this._seq = null;
    this._rootMidi = 41;
    this._scaleName = "Minor";

    // Sequencer position tracking
    this._globalStep = 0;
    this._seqPosition = 0;
  }

  _defaultColor() { return "#0f0"; }
  _defaultTitle() { return "Mono Synth"; }
  _fxTitle() { return "Mono FX"; }

  _buildControls(controls, expanded, mkSlider, ctx, options) {
    const color = options.color || this._defaultColor();
    // ---- Tone ----
    const { el: toneEl, controls: toneCtrl } = createSection("Tone");
    this._makePresetDropdown(WebAudioSynthMono.PRESETS, toneCtrl);
    this._makeWaveSelect(["sawtooth", "square", "triangle", "sine"], toneCtrl);
    toneCtrl.appendChild(mkSlider({ param: "detune",       label: "Detune",  min: -50, max: 50,  step: 1 }));
    toneCtrl.appendChild(mkSlider({ param: "unisonVoices", label: "Voices",  min: 1,   max: 8,   step: 1 }));
    toneCtrl.appendChild(mkSlider({ param: "unisonDetune", label: "Spread",  min: 0,   max: 100, step: 1 }));
    toneCtrl.appendChild(mkSlider({ param: "subGain",      label: "Sub",     min: 0,   max: 1,   step: 0.01 }));
    toneCtrl.appendChild(mkSlider({ param: "portamento",   label: "Glide",   min: 0,   max: 2,   step: 0.01 }));
    controls.appendChild(toneEl);

    // ---- Envelope ----
    const { el: envEl, controls: envCtrl } = createSection("Envelope");
    envCtrl.appendChild(mkSlider({ param: "attack",  label: "Attack",  min: 0.001, max: 4, step: 0.001 }));
    envCtrl.appendChild(mkSlider({ param: "decay",   label: "Decay",   min: 0.01,  max: 4, step: 0.01 }));
    envCtrl.appendChild(mkSlider({ param: "sustain", label: "Sustain", min: 0,     max: 1, step: 0.01 }));
    envCtrl.appendChild(mkSlider({ param: "release", label: "Release", min: 0.01,  max: 5, step: 0.01 }));
    controls.appendChild(envEl);

    // ---- Filter ----
    const { el: filterEl, controls: filterCtrl } = createSection("Filter");
    filterCtrl.appendChild(this._makeFilterTypeSelect());
    filterCtrl.appendChild(mkSlider({ param: "filterFreq",   label: "Cutoff",  min: 20,  max: 12000, step: 1, scale: "log" }));
    filterCtrl.appendChild(mkSlider({ param: "filterQ",      label: "Res",     min: 0.5, max: 20,    step: 0.1 }));
    filterCtrl.appendChild(mkSlider({ param: "filterEnvAmt", label: "Env Amt", min: -6,  max: 6,     step: 0.1 }));
    controls.appendChild(filterEl);

    // ---- Filter Envelope ----
    const { el: fenvEl, controls: fenvCtrl } = createSection("Filter Env");
    fenvCtrl.appendChild(mkSlider({ param: "filterAttack",  label: "F.Atk", min: 0.001, max: 4, step: 0.001 }));
    fenvCtrl.appendChild(mkSlider({ param: "filterDecay",   label: "F.Dec", min: 0.01,  max: 4, step: 0.01 }));
    fenvCtrl.appendChild(mkSlider({ param: "filterSustain", label: "F.Sus", min: 0,     max: 1, step: 0.01 }));
    fenvCtrl.appendChild(mkSlider({ param: "filterRelease", label: "F.Rel", min: 0.01,  max: 5, step: 0.01 }));
    controls.appendChild(fenvEl);

    // ---- LFO ----
    const { el: lfoEl, controls: lfoCtrl } = createSection("LFO");
    lfoCtrl.appendChild(mkSlider({ param: "lfoRate",  label: "Rate",  min: 0.01, max: 20, step: 0.01 }));
    lfoCtrl.appendChild(mkSlider({ param: "lfoDepth", label: "Depth", min: 0,    max: 1,  step: 0.01 }));
    lfoCtrl.appendChild(this._makeLfoShapeSelect());
    lfoCtrl.appendChild(this._makeLfoDestSelect());
    controls.appendChild(lfoEl);

    // ---- Octave ----
    const { el: octEl, controls: octCtrl } = createSection("Octave");
    octCtrl.appendChild(mkSlider({ param: "octaveOffset",   label: "Offset",    min: -2, max: 2, step: 1 }));
    octCtrl.appendChild(mkSlider({ param: "octaveJumpProb", label: "Jump Prob", min: 0,  max: 1, step: 0.01 }));
    controls.appendChild(octEl);

    // ---- Sequencer ----
    this._buildSequencerSection(controls, { onRandomize: () => this.randomize() });

    // Step sequencer
    this._seq = document.createElement("web-audio-step-seq");
    const noteOpts = scaleNoteOptions(this._rootMidi, this._scaleName, 24, 72);
    this._seq.init({
      steps: WebAudioSynthMonoControls.DEFAULT_PATTERN(),
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
            const ratchet = s.ratchet ?? 1;
            if (ratchet > 1) {
              const ratchetDuration = subStepDur / ratchet;
              for (let i = 0; i < ratchet; i++) {
                this._instrument.trigger(s.note, ratchetDuration * 0.9, 0.8, subTime + i * ratchetDuration);
              }
            } else {
              this._instrument.trigger(s.note, subStepDur, 0.8, subTime);
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
    if (this._seq) this._seq.steps = newSteps;
    this._emitChange();
  }

  _makeFilterTypeSelect() {
    const wrap = createCtrl("Type");
    this._filterTypeSelect = document.createElement("select");
    this._filterTypeSelect.className = "wac-select";
    for (const [val, label] of [["lowpass","LP"],["highpass","HP"],["bandpass","BP"],["notch","Notch"]]) {
      const opt = document.createElement("option");
      opt.value = val; opt.textContent = label;
      this._filterTypeSelect.appendChild(opt);
    }
    this._filterTypeSelect.value = this._instrument.filterType;
    this._filterTypeSelect.addEventListener("change", () => {
      this._instrument.filterType = this._filterTypeSelect.value;
      this._emitChange();
    });
    wrap.appendChild(this._filterTypeSelect);
    return wrap;
  }

  _makeLfoShapeSelect() {
    const wrap = createCtrl("Shape");
    this._lfoShapeSelect = document.createElement("select");
    this._lfoShapeSelect.className = "wac-select";
    for (const [val, label] of [["sine","Sin"],["triangle","Tri"],["square","Sqr"],["sawtooth","Saw"]]) {
      const opt = document.createElement("option");
      opt.value = val; opt.textContent = label;
      this._lfoShapeSelect.appendChild(opt);
    }
    this._lfoShapeSelect.value = this._instrument.lfoShape;
    this._lfoShapeSelect.addEventListener("change", () => {
      this._instrument.lfoShape = this._lfoShapeSelect.value;
      this._emitChange();
    });
    wrap.appendChild(this._lfoShapeSelect);
    return wrap;
  }

  _makeLfoDestSelect() {
    const wrap = createCtrl("Dest");
    this._lfoDestSelect = document.createElement("select");
    this._lfoDestSelect.className = "wac-select";
    for (const [val, label] of [["filter","Filter"],["pitch","Pitch"],["amp","Amp"]]) {
      const opt = document.createElement("option");
      opt.value = val; opt.textContent = label;
      this._lfoDestSelect.appendChild(opt);
    }
    this._lfoDestSelect.value = this._instrument.lfoDest;
    this._lfoDestSelect.addEventListener("change", () => {
      this._instrument.lfoDest = this._lfoDestSelect.value;
      this._emitChange();
    });
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

  _restoreParam(key, val) {
    switch (key) {
      case "oscType":
        this._instrument.oscType = val;
        this._syncWaveSelect();
        break;
      case "filterType":
        this._instrument.filterType = val;
        if (this._filterTypeSelect) this._filterTypeSelect.value = val;
        break;
      case "lfoShape":
        this._instrument.lfoShape = val;
        if (this._lfoShapeSelect) this._lfoShapeSelect.value = val;
        break;
      case "lfoDest":
        this._instrument.lfoDest = val;
        if (this._lfoDestSelect) this._lfoDestSelect.value = val;
        break;
      default:
        super._restoreParam(key, val);
    }
  }

  _syncExtraControls() {
    this._syncWaveSelect();
    if (this._filterTypeSelect && this._instrument) this._filterTypeSelect.value = this._instrument.filterType;
    if (this._lfoShapeSelect && this._instrument) this._lfoShapeSelect.value = this._instrument.lfoShape;
    if (this._lfoDestSelect && this._instrument) this._lfoDestSelect.value = this._instrument.lfoDest;
  }
}

customElements.define("web-audio-synth-mono-controls", WebAudioSynthMonoControls);
