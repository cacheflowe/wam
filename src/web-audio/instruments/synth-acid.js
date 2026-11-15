import "../ui/slider.js";
import "../ui/step-seq.js";
import { scaleNoteOptions, scaleNotesInRange, STEP_WEIGHTS } from "../global/scales.js";
import WebAudioInstrumentBase from "../global/instrument-base.js";
import { WebAudioControlsBase, createSection } from "../ui/controls-base.js";
import { createCtrl } from "../ui/controls-factory.js";
import { makeSoftClipCurve } from "../global/dsp/distortion.js";
import { scheduleEnvelope } from "../global/dsp/envelope.js";
import { sliderDefs } from "../global/param-schema.js";

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

  /** Beat-fraction intervals for the filter LFO rate. */
  static LFO_INTERVALS = [
    { label: "1/4", beats: 1 },
    { label: "1/2", beats: 2 },
    { label: "1 bar", beats: 4 },
  ];

  /**
   * Param schema (see global/param-schema.js). Single source of truth for the
   * UI, serialization, randomize/mutate, and hardware mapping. `rand` ranges
   * are the musically useful sub-ranges a randomize/mutate may land in.
   */
  static PARAMS = [
    // ---- Filter ----
    { param: "cutoff", label: "Cutoff", min: 50, max: 10000, step: 1, scale: "log",
      group: "filter", role: "cutoff", priority: 1, rand: { min: 150, max: 2500 },
      tooltip: "Base filter cutoff. Lower = darker tone." },
    { param: "resonance", label: "Resonance", min: 0.1, max: 30, step: 0.1,
      group: "filter", role: "resonance", priority: 1, rand: { min: 4, max: 24 },
      tooltip: "Filter resonance. High values add a nasal peak at the cutoff." },
    { param: "envMod", label: "Env Mod", min: 0, max: 1, step: 0.01,
      group: "filter", role: "envAmt", priority: 1, rand: { min: 0.2, max: 0.95 },
      tooltip: "How much the envelope opens the filter. Higher = more 'wah'." },
    // ---- Envelope ----
    { param: "decay", label: "Decay", min: 0.01, max: 2, step: 0.01,
      group: "amp-env", role: "decay", priority: 1, rand: { min: 0.08, max: 0.6 },
      tooltip: "Envelope decay time. Sets how quickly the filter closes." },
    { param: "attack", label: "Attack", min: 0.001, max: 0.3, step: 0.001,
      group: "amp-env", role: "attack", priority: 2, rand: { min: 0.001, max: 0.02 },
      tooltip: "Envelope attack time. Short = sharp pluck, long = swell." },
    // ---- Character ----
    { param: "distortion", label: "Distortion", min: 0, max: 1, step: 0.01,
      group: "character", role: "drive", priority: 1, rand: { min: 0, max: 0.5 },
      tooltip: "Waveshaper distortion. Adds harmonic grit to the bass." },
    { param: "portamento", label: "Portamento", min: 0, max: 0.5, step: 0.001,
      group: "pitch", role: "glide", priority: 2, rand: { min: 0, max: 0.08 },
      tooltip: "Slide time between notes. 0 = instant pitch change." },
    // ---- Oscillator ----
    { param: "oscType", label: "Shape", type: "enum", options: ["sawtooth", "square"],
      group: "osc", role: "wave", priority: 1, rand: { weights: [3, 1] },
      tooltip: "Oscillator waveform." },
    { param: "unisonVoices", label: "Unison", min: 1, max: 4, step: 1,
      group: "osc", role: "unison", priority: 3, rand: { min: 1, max: 2 },
      tooltip: "Number of detuned oscillator voices stacked together." },
    { param: "unisonDetune", label: "Detune", min: 0, max: 50, step: 1,
      group: "osc", role: "detune", priority: 2, rand: { min: 0, max: 20 },
      tooltip: "Pitch spread between unison voices in cents." },
    // ---- Filter LFO ----
    { param: "filterLfoActive", label: "Active", type: "bool",
      group: "mod", role: "lfoOn", priority: 3, rand: false,
      tooltip: "Toggle filter cutoff oscillation synced to BPM." },
    { param: "filterLfoLow", label: "Low", min: 50, max: 10000, step: 1, scale: "log",
      group: "mod", role: "lfoLow", priority: 3, rand: { min: 100, max: 1000 },
      tooltip: "Lower bound of the LFO cutoff sweep." },
    { param: "filterLfoHigh", label: "High", min: 50, max: 10000, step: 1, scale: "log",
      group: "mod", role: "lfoHigh", priority: 3, rand: { min: 600, max: 6000 },
      tooltip: "Upper bound of the LFO cutoff sweep." },
    { param: "filterLfoInterval", label: "Rate", type: "enum", options: [1, 2, 4],
      group: "mod", role: "lfoRate", priority: 3, rand: false,
      tooltip: "LFO cycle length as a rhythmic division. Syncs to the current BPM." },
    { param: "filterLfoOffset", label: "Offset", min: 0, max: 15, step: 1,
      group: "mod", role: "lfoPhase", priority: 3, rand: false,
      tooltip: "Phase offset in steps. Shifts where the LFO cycle starts within the loop." },
    // ---- Pitch / sequencing (part-level: excluded from randomize) ----
    { param: "octaveOffset", label: "Octave", min: -2, max: 2, step: 1,
      group: "pitch", role: "octave", priority: 3, rand: false,
      tooltip: "Shift all notes up or down by octaves." },
    { param: "octaveJumpProb", label: "Oct Jump", min: 0, max: 1, step: 0.01,
      group: "seq", role: "octaveJump", priority: 3, rand: false,
      tooltip: "Probability of randomly jumping an octave on each note." },
  ];

  constructor(ctx, preset = "Default") {
    super(ctx, null); // creates ctx + _out but skips preset
    this._distortion = 0;
    this._distortionCurve = makeSoftClipCurve(0);
    this._lastScheduledFreq = null;
    this.unisonVoices = 1;
    this.unisonDetune = 0;
    this.octaveOffset = 0;
    this.octaveJumpProb = 0;

    // Filter LFO — oscillates cutoff between low/high, synced to BPM
    this.filterLfoActive = false;
    this.filterLfoLow = 100;
    this.filterLfoHigh = 4000;
    this.filterLfoInterval = 4; // beats per full LFO cycle
    this.filterLfoOffset = 0; // phase offset in steps
    this._bpm = 120;
    this._lfoStepPosition = 0; // set by controls on each step tick

    this.applyPreset(preset);
  }

  // ---- Properties ----

  get distortion() {
    return this._distortion;
  }

  set distortion(v) {
    this._distortion = v;
    this._distortionCurve = makeSoftClipCurve(v);
  }

  // ---- Helpers ----

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
  /** Compute the effective cutoff given a step position, applying LFO if active. */
  _effectiveCutoff(stepPosition) {
    if (!this.filterLfoActive) return this.cutoff;
    // Convert interval from beats to steps (16th notes = 4 steps per beat)
    const cycleSteps = this.filterLfoInterval * 4;
    const phase = (((stepPosition + this.filterLfoOffset) % cycleSteps) / cycleSteps) * Math.PI * 2;
    const t = (Math.sin(phase) + 1) / 2; // 0..1
    // Logarithmic interpolation between low and high
    const logLow = Math.log(this.filterLfoLow);
    const logHigh = Math.log(this.filterLfoHigh);
    return Math.exp(logLow + t * (logHigh - logLow));
  }

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
    const base = this._effectiveCutoff(this._lfoStepPosition);
    const peak = Math.min(base + base * this.envMod * 4 * (accent ? 1.5 : 1), 18000);
    filter.frequency.setValueAtTime(base, atTime);
    filter.frequency.linearRampToValueAtTime(peak, atTime + this.attack);
    filter.frequency.exponentialRampToValueAtTime(Math.max(base, 30), atTime + this.attack + this.decay);

    // VCA envelope — attack matches filter attack for a unified feel
    const vel = accent ? 1.0 : 0.65;
    const hold = stepDurSec * 0.7;
    const release = 0.05;
    // Attack → hold → release. If the attack outlasts the hold, the release
    // starts from wherever the attack got to (see scheduleEnvelope).
    scheduleEnvelope(vca.gain, {
      start: atTime,
      releaseAt: atTime + hold,
      from: 0.0001,
      peak: vel,
      sustain: vel,
      attack: this.attack,
      decay: 0,
      release,
      curve: "exponential",
    });

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

  /** Trigger the sequence step, delegating to the instrument. */
  triggerSequenceStep(index, s, time, dur) {
    this._seqTriggerStep(s, time, dur);
  }

  /** Internal sequencer trigger logic (audio). */
  _seqTriggerStep(s, subTime, subStepDur) {
    this._triggerRatcheted(s, subTime, subStepDur, (t, dur, i) =>
      this.trigger(s.note, dur, s.accent && i === 0, t),
    );
  }

  /** Update internal LFO state. */
  _onStepTick(index) {
    this._lfoStepPosition = index;
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
 *   const controls = document.createElement("wam-synth-acid-controls");
 *   parent.appendChild(controls);
 *   controls.bind(acid, ctx, { fx: { bpm: 128 } });
 *   controls.setScale(29, "Minor");
 *   controls.connect(masterGain);
 *   // On each sequencer tick:
 *   controls.step(index, time, stepDurationSec);
 */
export class WebAudioSynthAcidControls extends WebAudioControlsBase {
  static SLIDER_DEFS = sliderDefs(WebAudioSynthAcid.PARAMS);

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
    this._rootMidi = 29;
    this._scaleName = "Minor";
    this._lfoAnimId = null;
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

  _defaultJamKey() {
    return "b";
  }

  _triggerJam(time, stepDurationSec) {
    const notes = scaleNotesInRange(this._rootMidi, this._scaleName, 24, 60);
    if (notes.length) {
      this._instrument.trigger(notes[Math.floor(Math.random() * notes.length)], stepDurationSec, false, time);
    }
  }

  _buildControls(controls, expanded, mkSlider, ctx, options) {
    const color = options.color || this._defaultColor();

    // ---- Tone ----
    const { el: toneEl, controls: toneCtrl } = createSection("Tone");
    this._makeWaveSelect(["sawtooth", "square"], toneCtrl);

    controls.appendChild(toneEl);

    // ---- Filter ----
    const { el: filterEl, controls: filterCtrl } = createSection("Filter");
    filterCtrl.appendChild(mkSlider("cutoff"));
    filterCtrl.appendChild(mkSlider("resonance"));
    filterCtrl.appendChild(mkSlider("envMod"));
    controls.appendChild(filterEl);

    // ---- Filter LFO ----
    const { el: lfoEl, controls: lfoCtrl } = createSection("Filter LFO");
    // Active toggle
    const lfoToggle = document.createElement("button");
    lfoToggle.className = "wam-toggle-btn";
    lfoToggle.textContent = "Off";
    const lfoWrap = createCtrl("Active", { tooltip: "Toggle filter cutoff oscillation synced to BPM." });
    lfoWrap.appendChild(lfoToggle);
    this._registerToggle("filterLfoActive", lfoToggle);
    this._lfoToggle = lfoToggle;
    lfoCtrl.appendChild(lfoWrap);
    lfoCtrl.appendChild(
      mkSlider("filterLfoLow"),
    );
    lfoCtrl.appendChild(
      mkSlider("filterLfoHigh"),
    );
    lfoCtrl.appendChild(
      (() => {
        const rateWrap = createCtrl("Rate", {
          tooltip: "LFO cycle length as a rhythmic division. Syncs to the current BPM.",
        });
        this._lfoRateSelect = document.createElement("select");
        this._lfoRateSelect.className = "wam-select";
        for (const { label, beats } of WebAudioSynthAcid.LFO_INTERVALS) {
          const opt = document.createElement("option");
          opt.value = beats;
          opt.textContent = label;
          if (beats === this._instrument.filterLfoInterval) opt.selected = true;
          this._lfoRateSelect.appendChild(opt);
        }
        this._registerSelect("filterLfoInterval", this._lfoRateSelect, { parse: parseFloat });
        rateWrap.appendChild(this._lfoRateSelect);
        return rateWrap;
      })(),
    );
    lfoCtrl.appendChild(
      mkSlider("filterLfoOffset"),
    );
    controls.appendChild(lfoEl);

    // ---- Envelope ----
    const { el: envEl, controls: envCtrl } = createSection("Envelope");
    envCtrl.appendChild(mkSlider("attack"));
    envCtrl.appendChild(mkSlider("decay"));
    controls.appendChild(envEl);

    // ---- Character ----
    const { el: charEl, controls: charCtrl } = createSection("Character");
    charCtrl.appendChild(mkSlider("distortion"));
    charCtrl.appendChild(mkSlider("portamento"));
    controls.appendChild(charEl);

    // ---- Unison ----
    const { el: unisonEl, controls: unisonCtrl } = createSection("Unison");
    unisonCtrl.appendChild(mkSlider("unisonVoices", { label: "Voices" }));
    unisonCtrl.appendChild(mkSlider("unisonDetune"));
    controls.appendChild(unisonEl);

    // ---- Octave ----
    const { el: octEl, controls: octCtrl } = createSection("Octave");
    octCtrl.appendChild(mkSlider("octaveOffset", { label: "Offset" }));
    octCtrl.appendChild(mkSlider("octaveJumpProb", { label: "Jump Prob" }));
    controls.appendChild(octEl);

    // ---- Sequencer ----
    const onRandomize = () => this.randomize();
    this._buildSequencerSection({ onRandomize });
    this._createSequencer(expanded, color, onRandomize);
  }

  // ---- Subclass hooks ----

  _seqInitOptions(color) {
    return {
      steps: WebAudioSynthAcidControls.DEFAULT_PATTERN(),
      noteOptions: scaleNoteOptions(this._rootMidi, this._scaleName, 24, 60),
      accent: true,
      probability: true,
      ratchet: true,
      conditions: true,
      color,
    };
  }

  _onStepTick(index) {
    this._instrument._onStepTick(index);
  }

  // ---- Serialization hooks ----

  _extraToJSON(params) {
    params.oscType = this._instrument.oscType;
    params.filterLfoActive = this._instrument.filterLfoActive;
    params.filterLfoLow = this._instrument.filterLfoLow;
    params.filterLfoHigh = this._instrument.filterLfoHigh;
    params.filterLfoInterval = this._instrument.filterLfoInterval;
    params.filterLfoOffset = this._instrument.filterLfoOffset;
  }

  _onSliderInput(param, value) {
    super._onSliderInput(param, value);
    if (param === "filterLfoActive" && this._lfoToggle) {
      this._lfoToggle.textContent = value ? "On" : "Off";
      if (value) {
        this._lfoToggle.setAttribute("data-active", "");
        this._startLfoAnim();
      } else {
        this._lfoToggle.removeAttribute("data-active");
        this._stopLfoAnim();
      }
    }
  }

  _extendJSON(obj) {
    if (this._presetSelect) obj.preset = this._presetSelect.value;
  }

  _restoreExtra(obj) {
    if (obj.preset && this._presetSelect) this._presetSelect.value = obj.preset;
  }

  _syncExtraControls() {
    if (this._lfoToggle && this._instrument) {
      const active = this._instrument.filterLfoActive;
      this._lfoToggle.textContent = active ? "On" : "Off";
      if (active) this._lfoToggle.setAttribute("data-active", "");
      else this._lfoToggle.removeAttribute("data-active");
    }
  }

  // ---- BPM forwarding ----

  set bpm(v) {
    super.bpm = v;
    if (this._instrument) this._instrument._bpm = v;
  }

  // ---- Filter LFO animation ----

  _startLfoAnim() {
    if (this._lfoAnimId) return;
    const tick = () => {
      if (!this._instrument?.filterLfoActive) {
        this._lfoAnimId = null;
        return;
      }
      const cutoffVal = this._instrument._effectiveCutoff(this._instrument._lfoStepPosition);
      const knob = this._sliders["cutoff"];
      if (knob) {
        knob.value = cutoffVal;
        knob.dispatchEvent(
          new CustomEvent("knob-input", {
            bubbles: true,
            detail: { param: "cutoff", label: knob.getAttribute("label"), value: cutoffVal },
          }),
        );
      }
      this._lfoAnimId = requestAnimationFrame(tick);
    };
    this._lfoAnimId = requestAnimationFrame(tick);
  }

  _stopLfoAnim() {
    if (this._lfoAnimId) {
      cancelAnimationFrame(this._lfoAnimId);
      this._lfoAnimId = null;
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._stopLfoAnim();
  }

  /** Check if a step meets its condition (e.g., "1:2" = every other bar). */

  /** Update note options when global scale changes. */
  setScale(rootMidi, scaleName) {
    this._rootMidi = rootMidi;
    this._scaleName = scaleName;
    this._seq?.setNoteOptions(scaleNoteOptions(rootMidi, scaleName, 24, 60));
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
    const currentSteps = this._instrument.steps;
    const newSteps = currentSteps.map((s, i) => {
      const active = Math.random() < STEP_WEIGHTS[i];
      const nearby = pool.filter((n) => Math.abs(n - prevNote) <= 7);
      const src = nearby.length >= 3 ? nearby : pool;
      const note = src[Math.floor(Math.random() * src.length)];
      if (active) prevNote = note;
      const accent = [0, 4, 8, 12].includes(i) && Math.random() < 0.4;
      return { ...s, active, note, accent };
    });
    newSteps[0] = { ...currentSteps[0], active: true, note: root, accent: Math.random() < 0.5 };
    this._instrument.steps = newSteps;
  }
}

customElements.define("wam-synth-acid-controls", WebAudioSynthAcidControls);
