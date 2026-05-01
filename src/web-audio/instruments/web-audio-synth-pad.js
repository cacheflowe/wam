import WebAudioInstrumentBase from "../web-audio-instrument-base.js";
import "../web-audio-step-seq.js";
import { scaleNoteOptions, buildChordFromScale } from "../web-audio-scales.js";
import { WebAudioControlsBase, createSection, createCtrl } from "../web-audio-controls-base.js";

export default class WebAudioSynthPad extends WebAudioInstrumentBase {
  static PRESETS = {
    Default: {
      oscType: "sine",     attack: 0.5,  decay: 0.4,  sustain: 0.7,  release: 2.0,
      detune2: 0,  filterFreq: 14000, filterQ: 0.8,
      filterType: "lowpass", filterEnvAmt: 0, filterAttack: 0.5, filterDecay: 0.4, filterSustain: 0,
      lfoRate: 2, lfoDepth: 0, lfoShape: "sine", lfoDest: "filter",
      voiceLimit: 12, velToFilter: 0, volume: 1,
    },
    Strings: {
      oscType: "sawtooth", attack: 0.8,  decay: 0.5,  sustain: 0.8,  release: 2.5,
      detune2: 0,  filterFreq: 10000, filterQ: 1,
      filterType: "lowpass", filterEnvAmt: 0, filterAttack: 0.8, filterDecay: 0.5, filterSustain: 0,
      lfoRate: 4, lfoDepth: 0.05, lfoShape: "sine", lfoDest: "pitch",
      voiceLimit: 12, velToFilter: 0.3, volume: 0.7,
    },
    Warm: {
      oscType: "triangle", attack: 0.3,  decay: 0.3,  sustain: 0.9,  release: 1.5,
      detune2: 8,  filterFreq: 7000,  filterQ: 1,
      filterType: "lowpass", filterEnvAmt: 1, filterAttack: 0.3, filterDecay: 0.4, filterSustain: 0.2,
      lfoRate: 1, lfoDepth: 0, lfoShape: "sine", lfoDest: "filter",
      voiceLimit: 12, velToFilter: 0.2, volume: 0.9,
    },
    Stab: {
      oscType: "sawtooth", attack: 0.01, decay: 0.2,  sustain: 0.0,  release: 0.4,
      detune2: 0,  filterFreq: 14000, filterQ: 1,
      filterType: "lowpass", filterEnvAmt: 2, filterAttack: 0.001, filterDecay: 0.15, filterSustain: 0,
      lfoRate: 2, lfoDepth: 0, lfoShape: "sine", lfoDest: "filter",
      voiceLimit: 8, velToFilter: 0.4, volume: 0.9,
    },
    Ocean: {
      oscType: "sine",     attack: 4.0,  decay: 1.0,  sustain: 0.9,  release: 6.0,
      detune2: 0,  filterFreq: 6000,  filterQ: 0.8,
      filterType: "lowpass", filterEnvAmt: 0.5, filterAttack: 4.0, filterDecay: 1.0, filterSustain: 0.6,
      lfoRate: 0.2, lfoDepth: 0.1, lfoShape: "sine", lfoDest: "filter",
      voiceLimit: 16, velToFilter: 0, volume: 0.5,
    },
    Haze: {
      oscType: "triangle", attack: 2.5,  decay: 0.8,  sustain: 0.85, release: 5.0,
      detune2: 6,  filterFreq: 5000,  filterQ: 1.0,
      filterType: "lowpass", filterEnvAmt: 0.3, filterAttack: 2.5, filterDecay: 0.8, filterSustain: 0.4,
      lfoRate: 0.5, lfoDepth: 0.08, lfoShape: "sine", lfoDest: "filter",
      voiceLimit: 16, velToFilter: 0.1, volume: 0.45,
    },
    Vapor: {
      oscType: "triangle", attack: 3.5,  decay: 1.2,  sustain: 0.8,  release: 7.0,
      detune2: 10, filterFreq: 4000,  filterQ: 1.2,
      filterType: "lowpass", filterEnvAmt: 0, filterAttack: 3.5, filterDecay: 1.2, filterSustain: 0.5,
      lfoRate: 0.3, lfoDepth: 0.12, lfoShape: "sine", lfoDest: "filter",
      voiceLimit: 16, velToFilter: 0, volume: 0.4,
    },
    Bloom: {
      oscType: "sawtooth", attack: 1.5,  decay: 0.4,  sustain: 0.75, release: 4.0,
      detune2: 14, filterFreq: 3500,  filterQ: 1.5,
      filterType: "lowpass", filterEnvAmt: 1.5, filterAttack: 0.8, filterDecay: 0.5, filterSustain: 0.3,
      lfoRate: 0.8, lfoDepth: 0.06, lfoShape: "triangle", lfoDest: "filter",
      voiceLimit: 12, velToFilter: 0.3, volume: 0.35,
    },
  };

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
    this.filterEnvAmt = 0; this.filterAttack = 0.5; this.filterDecay = 0.4; this.filterSustain = 0;
    this.lfoRate = 2; this.lfoDepth = 0; this.lfoShape = "sine"; this.lfoDest = "filter";
    this.voiceLimit = 12; this.velToFilter = 0;

    this.applyPreset(preset);
  }

  // ---- Properties ----

  get filterFreq() { return this._filter.frequency.value; }
  set filterFreq(v) {
    this._filter.frequency.cancelScheduledValues(0);
    this._filter.frequency.value = v;
  }

  get filterQ() { return this._filter.Q.value; }
  set filterQ(v) { this._filter.Q.value = v; }

  get filterType() { return this._filter.type; }
  set filterType(v) { this._filter.type = v; }

  /**
   * @param {number|number[]} midiNotes  Single MIDI note or chord array
   * @param {number} durationSec
   * @param {number} [velocity]  0–1
   * @param {number} [atTime]    AudioContext time
   */
  trigger(midiNotes, durationSec, velocity = 1, atTime = 0) {
    const ctx = this.ctx;
    const t = atTime > 0 ? atTime : ctx.currentTime;
    const notes = Array.isArray(midiNotes) ? midiNotes : [midiNotes];
    const perVoice = velocity / Math.sqrt(notes.length);
    const mixerGain = this.detune2 > 0 ? 0.7 : 1;
    const noteStopTime = t + durationSec + this.release + 0.1;

    // Voice stealing — remove ended voices, then steal oldest if over limit
    if (this.voiceLimit > 0) {
      const now = ctx.currentTime;
      this._activeVoices = this._activeVoices.filter(v => v.stopTime > now);
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
        amp.gain.setValueAtTime(0, t);
        amp.gain.linearRampToValueAtTime(vol, t + this.attack);
        amp.gain.linearRampToValueAtTime(vol * this.sustain, t + this.attack + this.decay);
        amp.gain.setValueAtTime(vol * this.sustain, t + durationSec);
        amp.gain.linearRampToValueAtTime(0, t + durationSec + this.release);

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
}

// ---- Controls companion component ----

export class WebAudioSynthPadControls extends WebAudioControlsBase {
  static SLIDER_DEFS = [
    { param: "attack",        label: "Attack",    min: 0.01, max: 8,     step: 0.01,  tooltip: "Amplitude envelope attack time." },
    { param: "decay",         label: "Decay",     min: 0.01, max: 2,     step: 0.01,  tooltip: "Amplitude envelope decay time." },
    { param: "sustain",       label: "Sustain",   min: 0,    max: 1,     step: 0.01,  tooltip: "Amplitude sustain level during held notes." },
    { param: "release",       label: "Release",   min: 0.01, max: 10,    step: 0.01,  tooltip: "Amplitude release time." },
    { param: "filterFreq",    label: "Cutoff",    min: 80,   max: 16000, step: 10, scale: "log", tooltip: "Output lowpass cutoff. Shapes brightness of the whole pad." },
    { param: "filterQ",       label: "Res",       min: 0.1,  max: 10,    step: 0.1,   tooltip: "Filter resonance." },
    { param: "filterEnvAmt",  label: "Env Amt",   min: -6,   max: 6,     step: 0.1,   tooltip: "Filter envelope depth in octaves. Negative = downward sweep." },
    { param: "filterAttack",  label: "F.Atk",     min: 0.001, max: 8,    step: 0.001, tooltip: "Filter envelope attack time." },
    { param: "filterDecay",   label: "F.Dec",     min: 0.01, max: 4,     step: 0.01,  tooltip: "Filter envelope decay time." },
    { param: "filterSustain", label: "F.Sus",     min: 0,    max: 1,     step: 0.01,  tooltip: "Filter sustain level (0 = full decay back to base)." },
    { param: "detune2",       label: "Spread",    min: 0,    max: 60,    step: 1,     tooltip: "Dual-oscillator spread in cents for chorus-like thickness." },
    { param: "lfoRate",       label: "LFO Rate",  min: 0.01, max: 20,    step: 0.01,  tooltip: "LFO speed in Hz." },
    { param: "lfoDepth",      label: "LFO Depth", min: 0,    max: 1,     step: 0.01,  tooltip: "LFO modulation depth (0 = off)." },
    { param: "voiceLimit",    label: "V.Limit",   min: 0,    max: 16,    step: 1,     tooltip: "Max simultaneous voices. Oldest voice stolen when exceeded. 0 = unlimited." },
    { param: "velToFilter",   label: "Vel→Flt",   min: 0,    max: 1,     step: 0.01,  tooltip: "Velocity modulates filter cutoff (0–2 octaves at max)." },
    { param: "volume",        label: "Vol",       min: 0,    max: 1,     step: 0.01 },
  ];

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
    this._seq = null;
    this._rootMidi = 29;
    this._scaleName = "Minor";
    this._chordSize = 3;

    // Sequencer position tracking
    this._globalStep = 0;
    this._seqPosition = 0;
  }

  _defaultColor() { return "#88f"; }
  _defaultTitle() { return "Pad Synth"; }
  _fxTitle() { return "Pad FX"; }

  _buildControls(controls, expanded, mkSlider, ctx, options) {
    const color = options.color || this._defaultColor();
    // ---- Tone ----
    const { el: toneEl, controls: toneCtrl } = createSection("Tone");
    this._makePresetDropdown(WebAudioSynthPad.PRESETS, toneCtrl);
    this._makeWaveRow(["sine", "triangle", "sawtooth", "square"], toneCtrl);
    toneCtrl.appendChild(mkSlider({ param: "detune2", label: "Spread", min: 0, max: 60, step: 1 }));
    controls.appendChild(toneEl);

    // ---- Envelope ----
    const { el: envEl, controls: envCtrl } = createSection("Envelope");
    envCtrl.appendChild(mkSlider({ param: "attack",  label: "Attack",  min: 0.01, max: 8,  step: 0.01 }));
    envCtrl.appendChild(mkSlider({ param: "decay",   label: "Decay",   min: 0.01, max: 2,  step: 0.01 }));
    envCtrl.appendChild(mkSlider({ param: "sustain", label: "Sustain", min: 0,    max: 1,  step: 0.01 }));
    envCtrl.appendChild(mkSlider({ param: "release", label: "Release", min: 0.01, max: 10, step: 0.01 }));
    controls.appendChild(envEl);

    // ---- Filter ----
    const { el: filterEl, controls: filterCtrl } = createSection("Filter");
    filterCtrl.appendChild(this._makeFilterTypeSelect());
    filterCtrl.appendChild(mkSlider({ param: "filterFreq",   label: "Cutoff",  min: 80,  max: 16000, step: 10, scale: "log" }));
    filterCtrl.appendChild(mkSlider({ param: "filterQ",      label: "Res",     min: 0.1, max: 10,    step: 0.1 }));
    filterCtrl.appendChild(mkSlider({ param: "filterEnvAmt", label: "Env Amt", min: -6,  max: 6,     step: 0.1 }));
    controls.appendChild(filterEl);

    // ---- Filter Envelope ----
    const { el: fenvEl, controls: fenvCtrl } = createSection("Filter Env");
    fenvCtrl.appendChild(mkSlider({ param: "filterAttack",  label: "F.Atk", min: 0.001, max: 8, step: 0.001 }));
    fenvCtrl.appendChild(mkSlider({ param: "filterDecay",   label: "F.Dec", min: 0.01,  max: 4, step: 0.01 }));
    fenvCtrl.appendChild(mkSlider({ param: "filterSustain", label: "F.Sus", min: 0,     max: 1, step: 0.01 }));
    controls.appendChild(fenvEl);

    // ---- LFO ----
    const { el: lfoEl, controls: lfoCtrl } = createSection("LFO");
    lfoCtrl.appendChild(mkSlider({ param: "lfoRate",  label: "Rate",  min: 0.01, max: 20, step: 0.01 }));
    lfoCtrl.appendChild(mkSlider({ param: "lfoDepth", label: "Depth", min: 0,    max: 1,  step: 0.01 }));
    lfoCtrl.appendChild(this._makeLfoShapeSelect());
    lfoCtrl.appendChild(this._makeLfoDestSelect());
    controls.appendChild(lfoEl);

    // ---- Voice ----
    const { el: voiceEl, controls: voiceCtrl } = createSection("Voice");
    voiceCtrl.appendChild(mkSlider({ param: "voiceLimit",  label: "V.Limit", min: 0,   max: 16, step: 1 }));
    voiceCtrl.appendChild(mkSlider({ param: "velToFilter", label: "Vel→Flt", min: 0,   max: 1,  step: 0.01 }));
    controls.appendChild(voiceEl);

    // ---- Sequencer Speed ----
    const { el: speedEl, controls: speedCtrl } = createSection("Sequencer");
    const speedSelect = document.createElement("select");
    speedSelect.className = "wac-select";
    [0.5, 1, 2].forEach((val) => {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = val === 0.5 ? "0.5x" : val === 1 ? "1x (Normal)" : "2x";
      if (val === 1) opt.selected = true;
      speedSelect.appendChild(opt);
    });
    speedSelect.addEventListener("change", () => {
      this.speedMultiplier = parseFloat(speedSelect.value);
      this._emitChange();
    });
    const speedLabel = document.createElement("label");
    speedLabel.style.display = "flex";
    speedLabel.style.gap = "6px";
    speedLabel.style.alignItems = "center";
    speedLabel.appendChild(document.createTextNode("Speed:"));
    speedLabel.appendChild(speedSelect);
    speedCtrl.appendChild(speedLabel);

    const chordSizeSelect = document.createElement("select");
    chordSizeSelect.className = "wac-select";
    this._chordSizeSelect = chordSizeSelect;
    [2, 3, 4].forEach((n) => {
      const opt = document.createElement("option");
      opt.value = n;
      opt.textContent = `${n} notes`;
      if (n === this._chordSize) opt.selected = true;
      chordSizeSelect.appendChild(opt);
    });
    chordSizeSelect.addEventListener("change", () => {
      this._chordSize = parseInt(chordSizeSelect.value);
      this._emitChange();
    });
    const chordLabel = document.createElement("label");
    chordLabel.style.display = "flex";
    chordLabel.style.gap = "6px";
    chordLabel.style.alignItems = "center";
    chordLabel.appendChild(document.createTextNode("Chord:"));
    chordLabel.appendChild(chordSizeSelect);
    speedCtrl.appendChild(chordLabel);
    controls.appendChild(speedEl);

    // Randomize button
    const actionRow = document.createElement("div");
    actionRow.className = "wac-action-row";
    const randBtn = document.createElement("button");
    randBtn.textContent = "\u2684 Randomize";
    randBtn.className = "wac-action-btn";
    randBtn.addEventListener("click", () => this.randomize());
    actionRow.appendChild(randBtn);
    expanded.appendChild(actionRow);

    // Step sequencer
    this._seq = document.createElement("web-audio-step-seq");
    const noteOpts = scaleNoteOptions(this._rootMidi, this._scaleName, 36, 72);
    this._seq.init({
      steps: WebAudioSynthPadControls.DEFAULT_PATTERN(),
      noteOptions: noteOpts,
      probability: true,
      ratchet: true,
      conditions: true,
      patternControls: true,
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
            const chord = buildChordFromScale(s.note, this._scaleName, this._chordSize);
            const ratchet = s.ratchet ?? 1;
            if (ratchet > 1) {
              const ratchetDuration = subStepDur / ratchet;
              for (let i = 0; i < ratchet; i++) {
                this._instrument.trigger(chord, ratchetDuration * 0.9, 0.8, subTime + i * ratchetDuration);
              }
            } else {
              this._instrument.trigger(chord, subStepDur, 0.8, subTime);
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
    obj.chordSize = this._chordSize;
  }

  _restoreParam(key, val) {
    switch (key) {
      case "oscType":
        this._instrument.oscType = val;
        this._syncWaveRow();
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

  _restoreExtra(obj) {
    if (obj.chordSize != null) {
      this._chordSize = obj.chordSize;
      if (this._chordSizeSelect) this._chordSizeSelect.value = obj.chordSize;
    }
    if (obj.steps && this._seq) this._seq.steps = obj.steps;
  }

  _syncExtraControls() {
    this._syncWaveRow();
    if (this._filterTypeSelect && this._instrument) this._filterTypeSelect.value = this._instrument.filterType;
    if (this._lfoShapeSelect && this._instrument) this._lfoShapeSelect.value = this._instrument.lfoShape;
    if (this._lfoDestSelect && this._instrument) this._lfoDestSelect.value = this._instrument.lfoDest;
  }
}

customElements.define("web-audio-synth-pad-controls", WebAudioSynthPadControls);
