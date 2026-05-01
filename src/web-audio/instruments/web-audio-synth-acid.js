import "../web-audio-slider.js";
import "../web-audio-step-seq.js";
import { scaleNoteOptions, scaleNotesInRange, STEP_WEIGHTS } from "../web-audio-scales.js";
import WebAudioInstrumentBase from "../web-audio-instrument-base.js";
import { WebAudioControlsBase, createSection } from "../web-audio-controls-base.js";

/**
 * WebAudioSynthAcid — TB-303-style monophonic acid bass synthesizer.
 *
 * Fire-and-forget voice architecture: each trigger() call creates a fresh
 * oscillator/filter/VCA chain scheduled precisely at `atTime`. Nodes are
 * self-cleaning via osc.onended.
 *
 * Routing convention:
 *   synth.connect(masterGain);          // dry
 *   synth.connect(delayNode);           // or connect to wet send too
 *
 * Usage:
 *   const acid = new WebAudioSynthAcid(ctx, { cutoff: 800, resonance: 20 });
 *   acid.connect(ctx.destination);
 *   acid.trigger(midi, stepDurSec, accent, atTime);
 *   acid.reset(); // clear portamento tracking (call on stop/restart)
 */
export default class WebAudioSynthAcid extends WebAudioInstrumentBase {
  static PRESETS = {
    Default: {
      cutoff: 600,
      resonance: 18,
      envMod: 0.6,
      decay: 0.25,
      attack: 0.005,
      distortion: 0,
      portamento: 0,
      oscType: "sawtooth",
      volume: 1.0,
      unisonVoices: 1,
      unisonDetune: 0,
    },
    Squelch: {
      cutoff: 400,
      resonance: 24,
      envMod: 0.9,
      decay: 0.18,
      attack: 0.003,
      distortion: 0,
      portamento: 0,
      oscType: "sawtooth",
      volume: 0.9,
      unisonVoices: 1,
      unisonDetune: 0,
    },
    Growl: {
      cutoff: 300,
      resonance: 16,
      envMod: 0.7,
      decay: 0.35,
      attack: 0.008,
      distortion: 0.4,
      portamento: 0,
      oscType: "sawtooth",
      volume: 0.85,
      unisonVoices: 1,
      unisonDetune: 0,
    },
    Smooth: {
      cutoff: 800,
      resonance: 8,
      envMod: 0.4,
      decay: 0.4,
      attack: 0.015,
      distortion: 0,
      portamento: 0.05,
      oscType: "sawtooth",
      volume: 1.0,
      unisonVoices: 1,
      unisonDetune: 0,
    },
    Square: {
      cutoff: 500,
      resonance: 20,
      envMod: 0.75,
      decay: 0.2,
      attack: 0.004,
      distortion: 0,
      portamento: 0,
      oscType: "square",
      volume: 0.8,
      unisonVoices: 1,
      unisonDetune: 0,
    },
    Fat: {
      cutoff: 500,
      resonance: 14,
      envMod: 0.5,
      decay: 0.3,
      attack: 0.005,
      distortion: 0.2,
      portamento: 0,
      oscType: "sawtooth",
      volume: 0.9,
      unisonVoices: 3,
      unisonDetune: 15,
    },
    Hoover: {
      cutoff: 600,
      resonance: 10,
      envMod: 0.5,
      decay: 0.4,
      attack: 0.01,
      distortion: 0.3,
      portamento: 0.08,
      oscType: "sawtooth",
      volume: 0.85,
      unisonVoices: 4,
      unisonDetune: 30,
    },
  };

  constructor(ctx, preset = "Default") {
    super(ctx, null); // creates ctx + _out but skips preset
    this._distortion = 0;
    this._distortionCurve = this._makeDistortionCurve(0);
    this._lastScheduledFreq = null;
    this.unisonVoices = 1;
    this.unisonDetune = 0;
    this.octaveOffset = 0;
    this.octaveJumpProb = 0;
    this.applyPreset(preset);
  }

  // ---- Properties ----

  get distortion() {
    return this._distortion;
  }

  set distortion(v) {
    this._distortion = v;
    this._distortionCurve = this._makeDistortionCurve(v);
  }

  // ---- Helpers ----

  _makeDistortionCurve(amount) {
    const n = 512;
    const curve = new Float32Array(n);
    const k = amount * 200;
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = k > 0 ? ((Math.PI + k) * x) / (Math.PI + k * Math.abs(x)) : x;
    }
    return curve;
  }

  /** Clear portamento memory — call when stopping/restarting the sequencer. */
  reset() {
    this._lastScheduledFreq = null;
  }

  // ---- Playback ----

  /**
   * Schedule one note.
   *
   * @param {number} midi        MIDI note number (24–60 typical for acid bass)
   * @param {number} stepDurSec  Duration of one sequencer step in seconds
   * @param {boolean} accent     Accent flag — louder with stronger filter sweep
   * @param {number} atTime      AudioContext scheduled time
   */
  trigger(midi, stepDurSec, accent, atTime) {
    const ctx = this.ctx;
    const shifted = midi + this.octaveOffset * 12 + (Math.random() < this.octaveJumpProb ? 12 : 0);
    const freq = WebAudioInstrumentBase._midiToFreq(shifted);
    const prevFreq = this._lastScheduledFreq;
    this._lastScheduledFreq = freq;

    const dist = ctx.createWaveShaper();
    const filter = ctx.createBiquadFilter();
    const vca = ctx.createGain();

    // Distortion before filter so harmonics get shaped by the cutoff sweep
    dist.curve = this._distortionCurve;

    // Filter envelope
    filter.type = "lowpass";
    filter.Q.value = this.resonance;
    const base = this.cutoff;
    const peak = Math.min(base + base * this.envMod * 4 * (accent ? 1.5 : 1), 18000);
    filter.frequency.setValueAtTime(base, atTime);
    filter.frequency.linearRampToValueAtTime(peak, atTime + this.attack);
    filter.frequency.exponentialRampToValueAtTime(Math.max(base, 30), atTime + this.attack + this.decay);

    // VCA envelope — attack matches filter attack for a unified feel
    const vel = accent ? 1.0 : 0.65;
    const hold = stepDurSec * 0.7;
    const release = 0.05;
    vca.gain.setValueAtTime(0.0001, atTime);
    vca.gain.linearRampToValueAtTime(vel, atTime + this.attack);
    vca.gain.setValueAtTime(vel, atTime + hold);
    vca.gain.exponentialRampToValueAtTime(0.0001, atTime + hold + release);

    // Create oscillator(s) — unison voices with symmetric detune spread
    const numVoices = Math.max(1, Math.round(this.unisonVoices));
    const voiceGain = 1 / numVoices;
    const oscs = [];

    for (let v = 0; v < numVoices; v++) {
      const osc = ctx.createOscillator();
      osc.type = this.oscType;

      // Detune spread: symmetric around center
      const detuneOffset = numVoices > 1 ? this.unisonDetune * ((v / (numVoices - 1)) * 2 - 1) : 0;
      osc.detune.value = detuneOffset;

      // Portamento: slide from previous note's frequency
      if (this.portamento > 0 && prevFreq !== null && prevFreq !== freq) {
        osc.frequency.setValueAtTime(prevFreq, atTime);
        osc.frequency.exponentialRampToValueAtTime(freq, atTime + this.portamento);
      } else {
        osc.frequency.setValueAtTime(freq, atTime);
      }

      // Per-voice gain for headroom
      if (numVoices > 1) {
        const vGain = ctx.createGain();
        vGain.gain.value = voiceGain;
        osc.connect(vGain);
        vGain.connect(dist);
        osc.onended = () => {
          osc.disconnect();
          vGain.disconnect();
        };
      } else {
        osc.connect(dist);
        osc.onended = () => {
          osc.disconnect();
        };
      }

      osc.start(atTime);
      osc.stop(atTime + hold + release + 0.01);
      oscs.push(osc);
    }

    // Chain: oscs → dist → filter → vca → output
    dist.connect(filter);
    filter.connect(vca);
    vca.connect(this._out);

    // Clean up shared nodes when last voice ends
    oscs[oscs.length - 1].addEventListener("ended", () => {
      dist.disconnect();
      filter.disconnect();
      vca.disconnect();
    });
  }
}

// ---- Controls companion component ----

/**
 * WebAudioSynthAcidControls — portable control panel for WebAudioSynthAcid.
 *
 * Creates parameter sliders, preset dropdown, SAW/SQR toggle, step sequencer,
 * randomize/note buttons, waveform display, and FX unit.
 *
 * Audio routing: instrument → analyser → fxUnit → controls._out
 *
 * Usage:
 *   const controls = document.createElement("web-audio-synth-acid-controls");
 *   parent.appendChild(controls);
 *   controls.bind(acid, ctx, { fx: { bpm: 128 } });
 *   controls.setScale(29, "Minor");
 *   controls.connect(masterGain);
 *   // On each sequencer tick:
 *   controls.step(index, time, stepDurationSec);
 */
export class WebAudioSynthAcidControls extends WebAudioControlsBase {
  static SLIDER_DEFS = [
    { param: "volume", label: "Vol", min: 0, max: 1, step: 0.01 },
    {
      param: "cutoff",
      label: "Cutoff",
      min: 50,
      max: 10000,
      step: 1,
      scale: "log",
      tooltip: "Base filter cutoff. Lower = darker tone.",
    },
    {
      param: "resonance",
      label: "Resonance",
      min: 0.1,
      max: 30,
      step: 0.1,
      tooltip: "Filter resonance. High values add a nasal peak at the cutoff.",
    },
    {
      param: "envMod",
      label: "Env Mod",
      min: 0,
      max: 1,
      step: 0.01,
      tooltip: "How much the envelope opens the filter. Higher = more 'wah'.",
    },
    {
      param: "decay",
      label: "Decay",
      min: 0.01,
      max: 2,
      step: 0.01,
      tooltip: "Envelope decay time. Sets how quickly the filter closes.",
    },
    {
      param: "attack",
      label: "Attack",
      min: 0.001,
      max: 0.3,
      step: 0.001,
      tooltip: "Envelope attack time. Short = sharp pluck, long = swell.",
    },
    {
      param: "distortion",
      label: "Distortion",
      min: 0,
      max: 1,
      step: 0.01,
      tooltip: "Waveshaper distortion. Adds harmonic grit to the bass.",
    },
    {
      param: "portamento",
      label: "Portamento",
      min: 0,
      max: 0.5,
      step: 0.001,
      tooltip: "Slide time between notes. 0 = instant pitch change.",
    },
    {
      param: "unisonVoices",
      label: "Unison",
      min: 1,
      max: 4,
      step: 1,
      tooltip: "Number of detuned oscillator voices stacked together.",
    },
    {
      param: "unisonDetune",
      label: "Detune",
      min: 0,
      max: 50,
      step: 1,
      tooltip: "Pitch spread between unison voices in cents.",
    },
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
      tooltip: "Probability of randomly jumping an octave on each note.",
    },
  ];

  static DEFAULT_PATTERN() {
    const notes = [29, 29, 36, 29, 34, 29, 36, 41, 29, 36, 34, 29, 32, 34, 36, 29];
    const active = new Set([0, 2, 4, 6, 7, 9, 11, 12, 14]);
    const accent = new Set([0, 7, 12]);
    return notes.map((note, i) => ({
      active: active.has(i),
      note,
      accent: accent.has(i),
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
    this._pendingNote = null;

    // Sequencer position tracking
    this._globalStep = 0;
    this._seqPosition = 0;
  }

  // ---- Base class overrides ----

  _defaultColor() {
    return "#0f0";
  }
  _defaultTitle() {
    return "TB-303 Acid";
  }
  _fxTitle() {
    return "Acid FX";
  }

  _buildControls(controls, expanded, mkSlider, ctx, options) {
    const color = options.color || this._defaultColor();

    // ---- Tone ----
    const { el: toneEl, controls: toneCtrl } = createSection("Tone");
    this._makeWaveRow(["sawtooth", "square"], toneCtrl);
    this._makePresetDropdown(WebAudioSynthAcid.PRESETS, toneCtrl);
    controls.appendChild(toneEl);

    // ---- Filter ----
    const { el: filterEl, controls: filterCtrl } = createSection("Filter");
    filterCtrl.appendChild(mkSlider({ param: "cutoff", label: "Cutoff", min: 50, max: 10000, step: 1, scale: "log" }));
    filterCtrl.appendChild(mkSlider({ param: "resonance", label: "Resonance", min: 0.1, max: 30, step: 0.1 }));
    filterCtrl.appendChild(mkSlider({ param: "envMod", label: "Env Mod", min: 0, max: 1, step: 0.01 }));
    controls.appendChild(filterEl);

    // ---- Envelope ----
    const { el: envEl, controls: envCtrl } = createSection("Envelope");
    envCtrl.appendChild(mkSlider({ param: "attack", label: "Attack", min: 0.001, max: 0.3, step: 0.001 }));
    envCtrl.appendChild(mkSlider({ param: "decay", label: "Decay", min: 0.01, max: 2, step: 0.01 }));
    controls.appendChild(envEl);

    // ---- Character ----
    const { el: charEl, controls: charCtrl } = createSection("Character");
    charCtrl.appendChild(mkSlider({ param: "distortion", label: "Distortion", min: 0, max: 1, step: 0.01 }));
    charCtrl.appendChild(mkSlider({ param: "portamento", label: "Portamento", min: 0, max: 0.5, step: 0.001 }));
    controls.appendChild(charEl);

    // ---- Unison ----
    const { el: unisonEl, controls: unisonCtrl } = createSection("Unison");
    unisonCtrl.appendChild(mkSlider({ param: "unisonVoices", label: "Voices", min: 1, max: 4, step: 1 }));
    unisonCtrl.appendChild(mkSlider({ param: "unisonDetune", label: "Detune", min: 0, max: 50, step: 1 }));
    controls.appendChild(unisonEl);

    // ---- Octave ----
    const { el: octEl, controls: octCtrl } = createSection("Octave");
    octCtrl.appendChild(mkSlider({ param: "octaveOffset", label: "Offset", min: -2, max: 2, step: 1 }));
    octCtrl.appendChild(mkSlider({ param: "octaveJumpProb", label: "Jump Prob", min: 0, max: 1, step: 0.01 }));
    controls.appendChild(octEl);

    // ---- Sequencer Speed ----
    const { el: speedEl, controls: speedCtrl } = createSection("Sequencer");
    const speedSelect = document.createElement("select");
    speedSelect.className = "wac-select";
    speedSelect.setAttribute("data-tooltip", "Playback rate multiplier for this instrument");
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
    controls.appendChild(speedEl);

    // Action row — randomize + note buttons
    const actionRow = document.createElement("div");
    actionRow.className = "wac-action-row";

    const randBtn = document.createElement("button");
    randBtn.textContent = "⚄ Randomize";
    randBtn.className = "wac-action-btn";
    randBtn.addEventListener("click", () => this.randomize());
    actionRow.appendChild(randBtn);

    const noteBtn = document.createElement("button");
    noteBtn.textContent = "♩ Note [B]";
    noteBtn.className = "wac-action-btn";
    noteBtn.addEventListener("click", () => this.queueRandomNote());
    actionRow.appendChild(noteBtn);

    expanded.appendChild(actionRow);

    // Step sequencer
    this._seq = document.createElement("web-audio-step-seq");
    const noteOpts = scaleNoteOptions(this._rootMidi, this._scaleName, 24, 60);
    this._seq.init({
      steps: WebAudioSynthAcidControls.DEFAULT_PATTERN(),
      noteOptions: noteOpts,
      accent: true,
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

  // ---- Serialization hooks ----

  _extraToJSON(params) {
    params.oscType = this._instrument.oscType;
  }

  _extendJSON(obj) {
    obj.steps = this._seq?.steps ?? [];
    if (this._presetSelect) obj.preset = this._presetSelect.value;
  }

  _restoreParam(key, val) {
    if (key === "oscType") {
      this._instrument.oscType = val;
      this._syncWaveRow();
    } else {
      this._instrument[key] = val;
      if (this._sliders[key]) this._sliders[key].value = val;
    }
  }

  _restoreExtra(obj) {
    if (obj.steps && this._seq) this._seq.steps = obj.steps;
    if (obj.preset && this._presetSelect) this._presetSelect.value = obj.preset;
  }

  _syncExtraControls() {
    this._syncWaveRow();
  }

  // ---- Sequencer integration ----

  /** Called by the host on each sequencer tick. */
  step(index, time, stepDurationSec) {
    if (!this._instrument || !this._seq) return;

    // Speed multiplier: 0.5x skips odd ticks
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

    // Bar density: skip if not a play cycle
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
        const probability = s.probability ?? 1;
        if (Math.random() < probability) {
          if (!s.conditions || s.conditions === "off" || this._meetsCondition(s.conditions, currentBar)) {
            const ratchet = s.ratchet ?? 1;
            if (ratchet > 1) {
              const ratchetDuration = subStepDur / ratchet;
              for (let i = 0; i < ratchet; i++) {
                this._instrument.trigger(s.note, ratchetDuration * 0.9, s.accent && i === 0, subTime + i * ratchetDuration);
              }
            } else {
              this._instrument.trigger(s.note, subStepDur, s.accent, subTime);
            }
          }
        }
      }

      this._seqPosition++;
    }

    // Pending note (keyboard jam)
    if (this._pendingNote !== null) {
      this._instrument.trigger(this._pendingNote, stepDurationSec, false, time);
      this._pendingNote = null;
    }

    this._globalStep++;
  }

  /** Check if a step meets its condition (e.g., "1:2" = every other bar). */
  _meetsCondition(condition, barIndex) {
    switch (condition) {
      case "off":
        return true;
      case "1:2":
        return barIndex % 2 === 0;
      case "3:4":
        return barIndex % 4 === 2;
      case "fill":
        return barIndex % 4 === 3;
      default:
        return true;
    }
  }

  /** Highlight the currently playing step. */
  setActiveStep() {
    this._seq?.setActiveStep((this._seqPosition - 1 + 16) % 16);
  }

  /** Update note options when global scale changes. */
  setScale(rootMidi, scaleName) {
    this._rootMidi = rootMidi;
    this._scaleName = scaleName;
    this._seq?.setNoteOptions(scaleNoteOptions(rootMidi, scaleName, 24, 60));
  }

  /** Queue a random note to be played on the next step. */
  queueRandomNote() {
    const notes = scaleNotesInRange(this._rootMidi, this._scaleName, 24, 60);
    if (notes.length) this._pendingNote = notes[Math.floor(Math.random() * notes.length)];
  }

  /** Randomize the step pattern using weighted probability. */
  randomize() {
    const notes = scaleNotesInRange(this._rootMidi, this._scaleName, 24, 60);
    if (!notes.length) return;
    const root = this._rootMidi;
    const pool = notes.flatMap((n) => {
      const octaveAbove = Math.floor((n - root) / 12);
      const weight = Math.max(1, 4 - octaveAbove * 2) + (n === root || n === root + 12 ? 2 : 0);
      return Array(weight).fill(n);
    });

    let prevNote = root;
    const newSteps = Array.from({ length: 16 }, (_, i) => {
      const active = Math.random() < STEP_WEIGHTS[i];
      const nearby = pool.filter((n) => Math.abs(n - prevNote) <= 7);
      const src = nearby.length >= 3 ? nearby : pool;
      const note = src[Math.floor(Math.random() * src.length)];
      if (active) prevNote = note;
      const accent = [0, 4, 8, 12].includes(i) && Math.random() < 0.4;
      return { active, note, accent };
    });
    newSteps[0] = { active: true, note: root, accent: Math.random() < 0.5 };
    this._seq.steps = newSteps;
    this._emitChange();
  }
}

customElements.define("web-audio-synth-acid-controls", WebAudioSynthAcidControls);
