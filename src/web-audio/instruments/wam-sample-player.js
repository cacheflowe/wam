import WebAudioInstrumentBase from "../global/wam-instrument-base.js";
import { loadSample, buildReverseBuffer } from "../global/wam-sample-utils.js";
import { STEP_WEIGHTS, scaleNoteOptions, buildChordFromScale } from "../global/wam-scales.js";
import "../ui/wam-step-seq.js";
import { WebAudioControlsBase, createSection, createCtrl } from "../ui/wam-controls-base.js";

/**
 * WebAudioSamplePlayer — one-shot sample player with ADSR, pitch, and reverse.
 *
 * Loads a set of WAV files and plays them as one-shots. Supports:
 *   - Drum mode: natural pitch + octave offset
 *   - Melodic mode: pitch-shifted via playback rate to target MIDI note
 *   - ADSR amplitude envelope
 *   - Reverse playback (random chance or deterministic)
 *   - Multiple samples with selection per trigger
 *
 * Usage:
 *   const sampler = new WebAudioSamplePlayer(ctx);
 *   await sampler.loadAll("/audio/samples/kicks/", [{ label: "808", file: "kick-808.wav" }]);
 *   sampler.connect(ctx.destination);
 *   sampler.trigger(null, 0.5, 0.9, ctx.currentTime); // drum mode
 *   sampler.trigger(60, 0.5, 0.9, ctx.currentTime);   // melodic mode (C4)
 */
export default class WebAudioSamplePlayer extends WebAudioInstrumentBase {
  static PRESETS = {
    Default: {
      attack: 0.002,
      decay: 0.1,
      sustain: 1.0,
      release: 0.05,
      useEnvelope: false,
      rootMidi: 60,
      octaveOffset: 0,
      octaveJumpProb: 0,
      reverseChance: 0,
      volume: 1.0,
    },
    Snappy: {
      attack: 0.001,
      decay: 0.05,
      sustain: 0.8,
      release: 0.02,
      useEnvelope: true,
      rootMidi: 60,
      octaveOffset: 0,
      octaveJumpProb: 0,
      reverseChance: 0,
      volume: 1.0,
    },
    Pad: {
      attack: 0.05,
      decay: 0.3,
      sustain: 0.8,
      release: 0.4,
      useEnvelope: true,
      rootMidi: 60,
      octaveOffset: 0,
      octaveJumpProb: 0,
      reverseChance: 0,
      volume: 0.8,
    },
    Long: {
      attack: 0.01,
      decay: 0.5,
      sustain: 1.0,
      release: 1.0,
      useEnvelope: true,
      rootMidi: 60,
      octaveOffset: 0,
      octaveJumpProb: 0,
      reverseChance: 0,
      volume: 0.9,
    },
    Glitch: {
      attack: 0.001,
      decay: 0.02,
      sustain: 0.5,
      release: 0.01,
      useEnvelope: true,
      rootMidi: 60,
      octaveOffset: 0,
      octaveJumpProb: 0.3,
      reverseChance: 0.3,
      volume: 1.0,
    },
  };

  constructor(ctx, preset = "Default") {
    super(ctx, null);
    this._samples = new Map(); // key → { buffer, reverseBuffer, label }
    this._sampleKeys = []; // ordered list of keys
    this._activeSampleKey = null;

    // ADSR
    this.attack = 0.002;
    this.decay = 0.1;
    this.sustain = 1.0;
    this.release = 0.05;
    this.useEnvelope = false;

    // Pitch
    this.rootMidi = 60;
    this.octaveOffset = 0;
    this.octaveJumpProb = 0;

    // Reverse
    this.reverseChance = 0;

    // Choke: when true, each new trigger kills previous voices
    this.choke = true;
    this._activeVoices = []; // [{ source, gain }]

    this.applyPreset(preset);
  }

  // ---- Loading ----

  async loadSample(url, label) {
    const buffer = await loadSample(this.ctx, url);
    const reverseBuffer = buildReverseBuffer(this.ctx, buffer);
    // Use full URL as key so it matches dropdown option values
    const key = url;
    this._samples.set(key, { buffer, reverseBuffer, label: label || key });
    if (!this._sampleKeys.includes(key)) this._sampleKeys.push(key);
    if (!this._activeSampleKey) this._activeSampleKey = key;
    return key;
  }

  async loadAll(basePath, files) {
    for (const { label, file } of files) {
      await this.loadSample(basePath + file, label);
    }
  }

  selectSample(key) {
    if (this._samples.has(key)) this._activeSampleKey = key;
  }

  getSample(key) {
    return this._samples.get(key) || null;
  }

  getRandomSample() {
    if (this._sampleKeys.length === 0) return null;
    const key = this._sampleKeys[Math.floor(Math.random() * this._sampleKeys.length)];
    return { ...this._samples.get(key), key };
  }

  get loaded() {
    return this._samples.size > 0;
  }
  get sampleKeys() {
    return this._sampleKeys;
  }
  get activeSampleKey() {
    return this._activeSampleKey;
  }

  // ---- Playback ----

  /**
   * @param {number|number[]|null} midi  Target MIDI note(s) (null = drum mode, array = chord)
   * @param {number} duration    Step duration in seconds (for ADSR sustain hold)
   * @param {number} velocity    0–1
   * @param {number} atTime      AudioContext scheduled time
   * @param {object} [opts]      { reverse, sampleKey }
   */
  trigger(midi, duration, velocity = 0.8, atTime = 0, { reverse = false, sampleKey = null } = {}) {
    if (!this.loaded) return this;

    // Multi-note (chord): trigger each note independently with gain scaling
    const notes = Array.isArray(midi) ? midi : [midi];
    const gainScale = notes.length > 1 ? 1 / notes.length : 1;
    for (const note of notes) {
      this._triggerSingle(note, duration, velocity * gainScale, atTime, { reverse, sampleKey });
    }
    return this;
  }

  _triggerSingle(midi, duration, velocity, atTime, { reverse = false, sampleKey = null } = {}) {
    const ctx = this.ctx;
    const t = atTime > 0 ? atTime : ctx.currentTime;

    // Choke previous voices
    if (this.choke) {
      for (const v of this._activeVoices) {
        try {
          v.gain.gain.cancelScheduledValues(t);
          v.gain.gain.setValueAtTime(v.gain.gain.value, t);
          v.gain.gain.linearRampToValueAtTime(0, t + 0.005);
          v.source.stop(t + 0.01);
        } catch (_) { /* already stopped */ }
      }
      this._activeVoices = [];
    }

    // Pick sample
    let sample;
    if (sampleKey && this._samples.has(sampleKey)) {
      sample = this._samples.get(sampleKey);
    } else {
      sample = this._samples.get(this._activeSampleKey);
    }
    if (!sample) return;

    // Reverse decision
    const useReverse = reverse || Math.random() < this.reverseChance;
    const buffer = useReverse ? sample.reverseBuffer : sample.buffer;

    // Playback rate (pitch)
    // rootMidi acts as a pitch offset: higher = higher pitch
    let playbackRate = 1.0;
    const jump = Math.random() < this.octaveJumpProb ? 12 : 0;
    const pitchOffset = (this.rootMidi - 60) + this.octaveOffset * 12 + jump;
    if (midi != null) {
      // Melodic mode: shift to target MIDI note + pitch offset
      playbackRate = WebAudioInstrumentBase._midiToFreq(midi + pitchOffset) / WebAudioInstrumentBase._midiToFreq(60);
    } else {
      // Drum mode: pitch offset from natural
      playbackRate = Math.pow(2, pitchOffset / 12);
    }

    // Create source
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;
    source.loop = false;

    if (this.useEnvelope) {
      // ADSR envelope
      const env = ctx.createGain();
      const a = this.attack;
      const d = this.decay;
      const s = this.sustain;
      const r = this.release;
      const peakGain = velocity;
      const sustainGain = peakGain * s;

      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(peakGain, t + a);
      env.gain.linearRampToValueAtTime(sustainGain, t + a + d);

      // Schedule release after duration
      const releaseStart = t + Math.max(duration, a + d);
      env.gain.setValueAtTime(sustainGain, releaseStart);
      env.gain.exponentialRampToValueAtTime(0.001, releaseStart + r);

      source.connect(env);
      env.connect(this._out);

      const voice = { source, gain: env };
      source.start(t);
      const bufferDuration = buffer.duration / playbackRate;
      const envDuration = releaseStart + r + 0.01 - t;
      source.stop(t + Math.min(bufferDuration, envDuration));
      source.onended = () => { this._activeVoices = this._activeVoices.filter((v) => v !== voice); };
      this._activeVoices.push(voice);
    } else {
      // No envelope — play sample at velocity, let it finish naturally
      const gain = ctx.createGain();
      gain.gain.value = velocity;
      source.connect(gain);
      gain.connect(this._out);

      const voice = { source, gain };
      source.start(t);
      source.onended = () => { this._activeVoices = this._activeVoices.filter((v) => v !== voice); };
      this._activeVoices.push(voice);
    }
  }

  /**
   * Drum-mode convenience trigger (no pitch shifting).
   */
  triggerDrum(velocity = 0.8, duration = 0.5, atTime = 0, { reverse = false, sampleKey = null } = {}) {
    return this.trigger(null, duration, velocity, atTime, { reverse, sampleKey });
  }

  reset() {
    // Nothing to reset — fire-and-forget nodes GC naturally
  }
}

// ---- Controls companion component ----

export class WebAudioSamplePlayerControls extends WebAudioControlsBase {
  static SLIDER_DEFS = [
    {
      param: "attack",
      label: "Atk",
      min: 0.001,
      max: 0.5,
      step: 0.001,
      tooltip: "Attack time — how fast the sound fades in.",
    },
    {
      param: "decay",
      label: "Decay",
      min: 0.01,
      max: 2,
      step: 0.01,
      tooltip: "Decay time — fade from peak to sustain level.",
    },
    { param: "sustain", label: "Sus", min: 0, max: 1, step: 0.01, tooltip: "Sustain level — held until release." },
    {
      param: "release",
      label: "Rel",
      min: 0.01,
      max: 2,
      step: 0.01,
      tooltip: "Release time — fade out after note ends.",
    },
    {
      param: "rootMidi",
      label: "Pitch",
      min: 24,
      max: 84,
      step: 1,
      tooltip: "Pitch offset in semitones (60 = natural).",
    },
    { param: "octaveOffset", label: "Octave", min: -2, max: 2, step: 1, tooltip: "Transpose by octaves." },
    {
      param: "octaveJumpProb",
      label: "Oct Jump",
      min: 0,
      max: 1,
      step: 0.01,
      tooltip: "Chance of jumping up one octave per trigger.",
    },
    {
      param: "reverseChance",
      label: "Reverse",
      min: 0,
      max: 1,
      step: 0.01,
      tooltip: "Chance of playing sample reversed.",
    },
    { param: "volume", label: "Vol", min: 0, max: 1, step: 0.01 },
  ];

  static DEFAULT_PATTERN() {
    return Array.from({ length: 16 }, (_, i) => ({
      active: i === 0 || i === 4 || i === 8 || i === 12,
      note: 60,
      probability: 1,
      ratchet: 1,
      conditions: "off",
    }));
  }

  constructor() {
    super();
    this._seq = null;
    this._globalStep = 0;
    this._seqPosition = 0;
    this._fileSelect = null;
    this._melodicMode = false;
    this._chordSize = 1;
  }

  _defaultColor() {
    return "#f8a";
  }
  _defaultTitle() {
    return "Sampler";
  }
  _fxTitle() {
    return "Sampler FX";
  }

  _buildControls(controls, expanded, mkSlider, ctx, options) {
    const color = options.color || this._defaultColor();

    // ---- Sample selection ----
    const { el: sampleEl, controls: sampleCtrl } = createSection("Sample");
    this._makePresetDropdown(WebAudioSamplePlayer.PRESETS, sampleCtrl);

    // File dropdown
    const fileWrap = createCtrl("File", { tooltip: "Select which sample file to play." });
    this._fileSelect = document.createElement("select");
    this._fileSelect.className = "wam-select";
    if (options.files) {
      for (const { label, file } of options.files) {
        const opt = document.createElement("option");
        opt.value = file;
        opt.textContent = label;
        this._fileSelect.appendChild(opt);
      }
    }
    this._fileSelect.addEventListener("change", () => {
      this._instrument.selectSample(this._fileSelect.value);
      this._emitChange();
    });
    fileWrap.appendChild(this._fileSelect);
    sampleCtrl.appendChild(fileWrap);

    // Random sample picker
    const randWrap = createCtrl("Random", { tooltip: "Pick a random sample from the loaded set." });
    const randBtn = document.createElement("button");
    randBtn.className = "wam-wave-btn";
    randBtn.textContent = "PICK";
    randBtn.addEventListener("click", () => {
      if (!this._instrument?.loaded) return;
      const sample = this._instrument.getRandomSample();
      if (sample) {
        this._instrument.selectSample(sample.key);
        this._fileSelect.value = sample.key;
        this._emitChange();
      }
    });
    randWrap.appendChild(randBtn);
    sampleCtrl.appendChild(randWrap);

    // Melodic mode toggle
    const melodicWrap = createCtrl("Mode", { tooltip: "Melodic: pitch samples to scale notes. Drum: natural pitch." });
    this._melodicBtn = document.createElement("button");
    this._melodicBtn.className = "wam-wave-btn";
    this._melodicBtn.textContent = "MELODIC";
    if (this._melodicMode) this._melodicBtn.classList.add("wam-wave-active");
    this._melodicBtn.addEventListener("click", () => {
      this._melodicMode = !this._melodicMode;
      this._melodicBtn.classList.toggle("wam-wave-active", this._melodicMode);
      // Update sequencer note options
      if (this._melodicMode) {
        this._seq?.setNoteOptions(scaleNoteOptions(this._rootMidi ?? 48, this._scaleName ?? "Chromatic", 36, 72));
      } else {
        this._seq?.setNoteOptions([]);
      }
      this._emitChange();
    });
    melodicWrap.appendChild(this._melodicBtn);
    sampleCtrl.appendChild(melodicWrap);

    // Choke toggle (mono voice — cut previous on retrigger)
    const chokeWrap = createCtrl("Choke", { tooltip: "Cut previous sound on retrigger. Off = polyphonic layering." });
    this._chokeBtn = document.createElement("button");
    this._chokeBtn.className = "wam-wave-btn";
    this._chokeBtn.textContent = "CHOKE";
    if (this._instrument?.choke) this._chokeBtn.classList.add("wam-wave-active");
    this._chokeBtn.addEventListener("click", () => {
      this._instrument.choke = !this._instrument.choke;
      this._chokeBtn.classList.toggle("wam-wave-active", this._instrument.choke);
      this._emitChange();
    });
    chokeWrap.appendChild(this._chokeBtn);
    sampleCtrl.appendChild(chokeWrap);

    // Chord size (only effective in melodic mode)
    const chordWrap = createCtrl("Chord", { tooltip: "Number of notes per step trigger (melodic mode)." });
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
      this._emitChange();
    });
    chordWrap.appendChild(this._chordSizeSelect);
    sampleCtrl.appendChild(chordWrap);

    controls.appendChild(sampleEl);

    // ---- Envelope ----
    const { el: envEl, controls: envCtrl } = createSection("Envelope");

    // Envelope on/off toggle
    const envToggleWrap = createCtrl("ADSR", { tooltip: "Enable ADSR envelope shaping. Off = play full sample." });
    this._envToggleBtn = document.createElement("button");
    this._envToggleBtn.className = "wam-wave-btn";
    this._envToggleBtn.textContent = "ENV";
    if (this._instrument?.useEnvelope) this._envToggleBtn.classList.add("wam-wave-active");
    this._envToggleBtn.addEventListener("click", () => {
      this._instrument.useEnvelope = !this._instrument.useEnvelope;
      this._envToggleBtn.classList.toggle("wam-wave-active", this._instrument.useEnvelope);
      this._emitChange();
    });
    envToggleWrap.appendChild(this._envToggleBtn);
    envCtrl.appendChild(envToggleWrap);

    envCtrl.appendChild(mkSlider({ param: "attack", label: "Atk", min: 0.001, max: 0.5, step: 0.001 }));
    envCtrl.appendChild(mkSlider({ param: "decay", label: "Decay", min: 0.01, max: 2, step: 0.01 }));
    envCtrl.appendChild(mkSlider({ param: "sustain", label: "Sus", min: 0, max: 1, step: 0.01 }));
    envCtrl.appendChild(mkSlider({ param: "release", label: "Rel", min: 0.01, max: 2, step: 0.01 }));
    controls.appendChild(envEl);

    // ---- Pitch ----
    const { el: pitchEl, controls: pitchCtrl } = createSection("Pitch");
    pitchCtrl.appendChild(mkSlider({ param: "rootMidi", label: "Pitch", min: 24, max: 84, step: 1, tooltip: "Pitch offset in semitones (60 = natural)." }));
    pitchCtrl.appendChild(mkSlider({ param: "octaveOffset", label: "Octave", min: -2, max: 2, step: 1 }));
    pitchCtrl.appendChild(mkSlider({ param: "octaveJumpProb", label: "Oct Jump", min: 0, max: 1, step: 0.01 }));
    pitchCtrl.appendChild(mkSlider({ param: "reverseChance", label: "Reverse", min: 0, max: 1, step: 0.01 }));
    controls.appendChild(pitchEl);

    // ---- Sequencer Speed ----
    this._buildSequencerSection({
      onRandomize: () => this.randomize(),
    });

    // ---- Step sequencer ----
    this._seq = document.createElement("wam-step-seq");
    const seqOpts = {
      steps: WebAudioSamplePlayerControls.DEFAULT_PATTERN(),
      probability: true,
      ratchet: true,
      conditions: true,
      patternControls: true,
      color,
    };
    // Melodic mode gets note options
    if (this._melodicMode) {
      seqOpts.noteOptions = scaleNoteOptions(this._rootMidi ?? 48, this._scaleName ?? "Chromatic", 36, 72);
    }
    this._seq.init(seqOpts);
    expanded.appendChild(this._seq);
    this._seq.addEventListener("step-change", () => this._emitChange());
    this._seq.addEventListener("pattern-change", () => this._emitChange());

    // Load samples
    if (options.files) {
      this._basePath = options.basePath ?? "";
      this._instrument.loadAll(this._basePath, options.files);
    }
  }

  _buildStripActions(strip) {
    const btn = document.createElement("button");
    btn.className = "wam-jam-btn";
    btn.textContent = "\u25B6";
    btn.title = "Trigger sample";
    btn.addEventListener("mousedown", () => {
      if (!this._instrument?.loaded) return;
      if (this._ctx?.state === "suspended") this._ctx.resume();
      this._instrument.triggerDrum(0.9, 0.5, this._ctx.currentTime);
    });
    strip.appendChild(btn);
  }

  // ---- Scale broadcast ----

  setScale(rootMidi, scaleName) {
    this._rootMidi = rootMidi;
    this._scaleName = scaleName;
    if (this._seq && this._melodicMode) {
      this._seq.setNoteOptions(scaleNoteOptions(rootMidi, scaleName, 36, 72));
    }
  }

  // ---- Sequencer integration ----

  resetSequencer() {
    this._globalStep = 0;
    this._seqPosition = 0;
  }

  step(index, time, stepDurationSec) {
    if (!this._instrument || !this._seq) return;

    const multiplier = this.speedMultiplier ?? 1;
    if (multiplier === 0.5 && index % 2 !== 0) return;

    // Pattern parameters
    const patternParams = this._seq?.getPatternParams() ?? {};
    const playEvery = patternParams.playEvery ?? 1;
    const rotationOffset = patternParams.rotationOffset ?? 0;
    const rotationIntervalBars = patternParams.rotationIntervalBars ?? 1;

    // Apply rotation
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

    // Advance
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
            let midi;
            if (this._melodicMode) {
              const rootNote = (s.note ?? 60) + 24;
              midi = this._chordSize === 1
                ? rootNote
                : buildChordFromScale(rootNote, this._scaleName ?? "Chromatic", this._chordSize);
            } else {
              midi = null;
            }
            if (ratchet > 1) {
              const ratchetDur = subStepDur / ratchet;
              for (let i = 0; i < ratchet; i++) {
                this._instrument.trigger(midi, ratchetDur, 0.8, subTime + i * ratchetDur);
              }
            } else {
              this._instrument.trigger(midi, subStepDur, 0.8, subTime);
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

  setActiveStep(step) {
    if (step < 0) {
      this._seq?.setActiveStep(-1);
    } else {
      this._seq?.setActiveStep((this._seqPosition - 1 + 16) % 16);
    }
  }

  randomize() {
    const newSteps = Array.from({ length: 16 }, (_, i) => ({
      active: Math.random() < STEP_WEIGHTS[i] * 0.5,
      note: 60,
      probability: 1,
      ratchet: 1,
      conditions: "off",
    }));
    if (this._seq) this._seq.steps = newSteps;
    this._emitChange();
  }

  // ---- Serialization ----

  _extraToJSON(params) {
    params.rootMidi = this._instrument?.rootMidi ?? 60;
    params.octaveOffset = this._instrument?.octaveOffset ?? 0;
    params.octaveJumpProb = this._instrument?.octaveJumpProb ?? 0;
    params.reverseChance = this._instrument?.reverseChance ?? 0;
    params.useEnvelope = this._instrument?.useEnvelope ?? false;
    params.choke = this._instrument?.choke ?? true;
  }

  _extendJSON(obj) {
    obj.steps = this._seq?.steps ?? [];
    obj.file = this._fileSelect?.value || "";
    obj.melodicMode = this._melodicMode;
    obj.chordSize = this._chordSize;
  }

  _restoreExtra(obj) {
    if (obj.steps && this._seq) this._seq.steps = obj.steps;
    if (obj.file && this._fileSelect) {
      this._fileSelect.value = obj.file;
      this._instrument?.selectSample(obj.file);
    }
    if (obj.melodicMode != null) {
      this._melodicMode = obj.melodicMode;
      if (this._melodicBtn) {
        this._melodicBtn.classList.toggle("wam-wave-active", obj.melodicMode);
      }
      if (this._melodicMode && this._seq) {
        this._seq.setNoteOptions(scaleNoteOptions(this._rootMidi ?? 48, this._scaleName ?? "Chromatic", 36, 72));
      }
    }
    if (obj.chordSize != null) {
      this._chordSize = obj.chordSize;
      if (this._chordSizeSelect) this._chordSizeSelect.value = obj.chordSize;
    }
    if (obj.choke != null) {
      this._instrument.choke = obj.choke;
      if (this._chokeBtn) {
        this._chokeBtn.classList.toggle("wam-wave-active", obj.choke);
      }
    }
  }
}

customElements.define("wam-sample-player-controls", WebAudioSamplePlayerControls);
