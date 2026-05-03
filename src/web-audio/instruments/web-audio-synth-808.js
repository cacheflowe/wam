import "../ui/web-audio-slider.js";
import "../ui/web-audio-step-seq.js";
import { scaleNoteOptions, STEP_WEIGHTS } from "../global/web-audio-scales.js";
import WebAudioInstrumentBase from "../global/web-audio-instrument-base.js";
import { WebAudioControlsBase, createSection } from "../ui/web-audio-controls-base.js";

/**
 * WebAudioSynth808 — pitched 808-style sub-bass synthesizer.
 *
 * A sine oscillator sweeps from a starting pitch (target + pitchSweepSemitones)
 * down to the target note over `pitchDecay` seconds, with an exponential
 * amplitude decay. The characteristic 808 "boom" comes from the pitch sweep
 * landing on the fundamental while the sub-bass sustains.
 *
 * Optional soft-clip distortion for the "dirty 808" trap sound.
 * Optional click transient (pre-baked noise burst) for punch and presence.
 * Optional sub oscillator (one octave down) for extra weight.
 * Optional tone lowpass filter for bright/dark shaping.
 *
 * Usage:
 *   const bass = new WebAudioSynth808(ctx, { decay: 1.2, pitchSweepSemitones: 24 });
 *   bass.connect(ctx.destination);
 *   bass.trigger(36, stepDurSec, atTime); // C2
 */
export default class WebAudioSynth808 extends WebAudioInstrumentBase {
  static PRESETS = {
    Default: {
      pitchSweepSemitones: 24,
      pitchDecay: 0.1,
      decay: 0.8,
      distortion: 0,
      click: 0.4,
      subOscMix: 0,
      tone: 3000,
      volume: 1.0,
    },
    Boom: {
      pitchSweepSemitones: 12,
      pitchDecay: 0.2,
      decay: 3.0,
      distortion: 0,
      click: 0.2,
      subOscMix: 0.5,
      tone: 2000,
      volume: 0.9,
    },
    Tight: {
      pitchSweepSemitones: 24,
      pitchDecay: 0.06,
      decay: 0.4,
      distortion: 0,
      click: 0.6,
      subOscMix: 0,
      tone: 4000,
      volume: 1.0,
    },
    Dirty: {
      pitchSweepSemitones: 24,
      pitchDecay: 0.1,
      decay: 0.7,
      distortion: 0.5,
      click: 0.4,
      subOscMix: 0,
      tone: 2500,
      volume: 0.85,
    },
    Deep: {
      pitchSweepSemitones: 8,
      pitchDecay: 0.25,
      decay: 2.0,
      distortion: 0,
      click: 0.1,
      subOscMix: 0.7,
      tone: 1500,
      volume: 0.9,
    },
    Trap: {
      pitchSweepSemitones: 36,
      pitchDecay: 0.04,
      decay: 0.6,
      distortion: 0,
      click: 0.8,
      subOscMix: 0.2,
      tone: 5000,
      volume: 0.95,
    },
  };

  /**
   * @param {AudioContext} ctx
   * @param {string} [preset="Default"]
   */
  constructor(ctx, preset = "Default") {
    super(ctx, null); // creates ctx + _out, skips preset (extra nodes not ready yet)

    this._distortion = 0;
    this._distortionCurve = this._makeDistortionCurve(0);

    // Tone lowpass — shaping before output
    this._filter = ctx.createBiquadFilter();
    this._filter.type = "lowpass";
    this._filter.Q.value = 1;
    this._filter.connect(this._out);

    // Pre-bake click noise buffer (15ms, linearly enveloped) — reused on every trigger
    const clickSamples = Math.ceil(ctx.sampleRate * 0.015);
    this._clickBuffer = ctx.createBuffer(1, clickSamples, ctx.sampleRate);
    const cd = this._clickBuffer.getChannelData(0);
    for (let i = 0; i < clickSamples; i++) {
      cd[i] = (Math.random() * 2 - 1) * (1 - i / clickSamples);
    }

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

  get tone() {
    return this._filter.frequency.value;
  }
  set tone(v) {
    this._filter.frequency.value = v;
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

  // ---- Playback ----

  /**
   * Schedule one 808 hit.
   *
   * @param {number} midi        MIDI note number (24–48 typical for 808 bass)
   * @param {number} stepDurSec  Duration of one sequencer step in seconds (unused but kept for API consistency)
   * @param {number} atTime      AudioContext scheduled time
   */
  trigger(midi, stepDurSec, atTime) {
    const ctx = this.ctx;
    const shifted = midi + this.octaveOffset * 12 + (Math.random() < this.octaveJumpProb ? 12 : 0);
    const targetFreq = WebAudioInstrumentBase._midiToFreq(shifted);
    const startFreq = targetFreq * Math.pow(2, this.pitchSweepSemitones / 12);

    const osc = ctx.createOscillator();
    const dist = ctx.createWaveShaper();
    const vca = ctx.createGain();

    osc.type = "sine";

    // Pitch sweep: start high, exponentially fall to target
    osc.frequency.setValueAtTime(startFreq, atTime);
    osc.frequency.exponentialRampToValueAtTime(targetFreq, atTime + this.pitchDecay);

    dist.curve = this._distortionCurve;

    // Amplitude: instant peak, exponential decay
    vca.gain.setValueAtTime(1.0, atTime);
    vca.gain.exponentialRampToValueAtTime(0.0001, atTime + this.decay);

    osc.connect(dist);
    dist.connect(vca);
    vca.connect(this._filter); // → tone filter → _out

    osc.start(atTime);
    osc.stop(atTime + this.decay + 0.05);
    osc.onended = () => {
      osc.disconnect();
      dist.disconnect();
      vca.disconnect();
    };

    // Click transient — pre-baked noise burst, bypasses tone filter for raw punch
    if (this.click > 0) {
      const clickSrc = ctx.createBufferSource();
      clickSrc.buffer = this._clickBuffer;
      const clickGain = ctx.createGain();
      clickGain.gain.setValueAtTime(this.click, atTime);
      clickSrc.connect(clickGain);
      clickGain.connect(this._out);
      clickSrc.start(atTime);
      clickSrc.onended = () => {
        clickSrc.disconnect();
        clickGain.disconnect();
      };
    }

    // Sub oscillator — one octave below, through tone filter
    if (this.subOscMix > 0) {
      const subOsc = ctx.createOscillator();
      const subGain = ctx.createGain();
      subOsc.type = "sine";
      subOsc.frequency.value = targetFreq / 2;
      subGain.gain.setValueAtTime(this.subOscMix, atTime);
      subGain.gain.exponentialRampToValueAtTime(0.0001, atTime + this.decay);
      subOsc.connect(subGain);
      subGain.connect(this._filter);
      subOsc.start(atTime);
      subOsc.stop(atTime + this.decay + 0.05);
      subOsc.onended = () => {
        subOsc.disconnect();
        subGain.disconnect();
      };
    }
  }
}

// ---- Controls companion component ----

export class WebAudioSynth808Controls extends WebAudioControlsBase {
  static SLIDER_DEFS = [
    { param: "volume", label: "Vol", min: 0, max: 1, step: 0.01 },
    {
      param: "decay",
      label: "Decay",
      min: 0.1,
      max: 3,
      step: 0.01,
      tooltip: "Amplitude decay time. Longer = sustained sub-bass thump.",
    },
    {
      param: "pitchSweepSemitones",
      label: "Pitch Sweep",
      min: 0,
      max: 36,
      step: 1,
      tooltip: "Starting pitch above target in semitones — creates the 808 pitch drop.",
    },
    {
      param: "pitchDecay",
      label: "Pitch Decay",
      min: 0.01,
      max: 1,
      step: 0.01,
      tooltip: "How quickly the pitch drop resolves to the target note.",
    },
    {
      param: "distortion",
      label: "Distortion",
      min: 0,
      max: 1,
      step: 0.01,
      tooltip: "Adds saturation and harmonic content to the bass.",
    },
    {
      param: "click",
      label: "Click",
      min: 0,
      max: 1,
      step: 0.01,
      tooltip: "Adds a transient click at note onset for extra punch.",
    },
    {
      param: "subOscMix",
      label: "Sub Mix",
      min: 0,
      max: 1,
      step: 0.01,
      tooltip: "Blend of a sub-octave oscillator beneath the main tone.",
    },
    {
      param: "tone",
      label: "Tone",
      min: 50,
      max: 8000,
      step: 1,
      scale: "log",
      tooltip: "Tone filter cutoff. Lower = rounder, darker bass.",
    },
    { param: "octaveOffset",   label: "Octave",   min: -2, max: 2, step: 1,    tooltip: "Shift all notes up or down by octaves." },
    { param: "octaveJumpProb", label: "Oct Jump", min: 0,  max: 1, step: 0.01, tooltip: "Probability of randomly jumping an octave on each note." },
  ];

  static DEFAULT_PATTERN() {
    return Array.from({ length: 16 }, (_, i) => ({
      active: i === 0 || i === 8,
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

    // Sequencer position tracking
    this._globalStep = 0;
    this._seqPosition = 0;
  }

  // ---- Identity overrides ----

  _defaultColor() {
    return "#fa0";
  }
  _defaultTitle() {
    return "808 Bass";
  }

  // ---- No FX unit ----

  _createFxUnit() {
    return null;
  }

  // ---- Build controls ----

  _buildControls(controls, expanded, mkSlider, ctx, options) {
    const color = options.color || this._defaultColor();

    // ---- Tone ----
    const { el: toneEl, controls: toneCtrl } = createSection("Tone");
    this._makePresetDropdown(WebAudioSynth808.PRESETS, toneCtrl);
    toneCtrl.appendChild(mkSlider({ param: "tone", label: "Tone", min: 50, max: 8000, step: 1, scale: "log" }));
    controls.appendChild(toneEl);

    // ---- Shape ----
    const { el: shapeEl, controls: shapeCtrl } = createSection("Shape");
    shapeCtrl.appendChild(mkSlider({ param: "decay", label: "Decay", min: 0.1, max: 3, step: 0.01 }));
    shapeCtrl.appendChild(mkSlider({ param: "pitchSweepSemitones", label: "Pitch Sweep", min: 0, max: 36, step: 1 }));
    shapeCtrl.appendChild(mkSlider({ param: "pitchDecay", label: "Pitch Decay", min: 0.01, max: 1, step: 0.01 }));
    controls.appendChild(shapeEl);

    // ---- Character ----
    const { el: charEl, controls: charCtrl } = createSection("Character");
    charCtrl.appendChild(mkSlider({ param: "distortion", label: "Distortion", min: 0, max: 1, step: 0.01 }));
    charCtrl.appendChild(mkSlider({ param: "click", label: "Click", min: 0, max: 1, step: 0.01 }));
    charCtrl.appendChild(mkSlider({ param: "subOscMix", label: "Sub Mix", min: 0, max: 1, step: 0.01 }));
    controls.appendChild(charEl);

    // ---- Octave ----
    const { el: octEl, controls: octCtrl } = createSection("Octave");
    octCtrl.appendChild(mkSlider({ param: "octaveOffset",   label: "Offset",    min: -2, max: 2, step: 1 }));
    octCtrl.appendChild(mkSlider({ param: "octaveJumpProb", label: "Jump Prob", min: 0,  max: 1, step: 0.01 }));
    controls.appendChild(octEl);

    // ---- Sequencer ----
    this._buildSequencerSection(controls, { onRandomize: () => this.randomize() });

    // Step sequencer
    this._seq = document.createElement("web-audio-step-seq");
    const noteOpts = scaleNoteOptions(this._rootMidi, this._scaleName, 24, 48);
    this._seq.init({
      steps: WebAudioSynth808Controls.DEFAULT_PATTERN(),
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
                this._instrument.trigger(s.note, ratchetDuration * 0.9, subTime + i * ratchetDuration);
              }
            } else {
              this._instrument.trigger(s.note, subStepDur, subTime);
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

  /** Randomize the step pattern — rhythm only, note chosen from current scale. */
  randomize() {
    const noteOpts = scaleNoteOptions(this._rootMidi, this._scaleName, 24, 48);
    const notes = noteOpts.map(([, midi]) => midi);
    if (!notes.length) return;
    // Bias toward root and lower notes for bass feel
    const root = this._rootMidi;
    const pool = notes.flatMap((n) => {
      const weight = n <= root + 12 ? 3 : 1;
      return Array(weight).fill(n);
    });
    const newSteps = Array.from({ length: 16 }, (_, i) => {
      const active = Math.random() < STEP_WEIGHTS[i] * 0.7; // sparser than acid
      const note = pool[Math.floor(Math.random() * pool.length)];
      return { active, note };
    });
    newSteps[0] = { active: true, note: root }; // always hit on beat 1
    this._seq.steps = newSteps;
    this._emitChange();
  }

  // ---- Serialization hooks ----

  _extendJSON(obj) {
    obj.steps = this._seq?.steps ?? [];
  }

  _restoreExtra(obj) {
    if (obj.steps && this._seq) this._seq.steps = obj.steps;
  }
}

customElements.define("web-audio-synth-808-controls", WebAudioSynth808Controls);
