import "../ui/slider.js";
import "../ui/step-seq.js";
import { scaleNoteOptions, scaleNotesInRange, STEP_WEIGHTS } from "../global/scales.js";
import WebAudioInstrumentBase from "../global/instrument-base.js";
import { WebAudioControlsBase, createSection } from "../ui/controls-base.js";
import { makeSoftClipCurve } from "../global/dsp/distortion.js";
import { sliderDefs } from "../global/param-schema.js";
import presetData from "../presets/synth-808.json" with { type: "json" };
import { presetMap } from "../global/presets.js";

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
  /** Presets live in ../presets/synth-808.json (written by the dev preset store). */
  static PRESET_DATA = presetData;
  static PRESETS = presetMap(presetData);

  /** trigger() argument layout, for note events (see global/note-event.js). */
  static TRIGGER_ARGS = { trigger: ["notes", "duration", "time"] };

  /**
   * Param schema (see global/param-schema.js). Single source of truth for the
   * UI, serialization, randomize/mutate, and hardware mapping. `rand` ranges
   * keep rolled sounds subby and mostly clean.
   */
  static PARAMS = [
    // ---- Tone ----
    { param: "tone", label: "Tone", min: 50, max: 8000, step: 1, scale: "log",
      group: "filter", role: "tone", priority: 1, rand: { min: 800, max: 5000 },
      tooltip: "Tone filter cutoff. Lower = rounder, darker bass." },
    // ---- Shape ----
    { param: "decay", label: "Decay", min: 0.1, max: 3, step: 0.01,
      group: "amp-env", role: "decay", priority: 1, rand: { min: 0.3, max: 2 },
      tooltip: "Amplitude decay time. Longer = sustained sub-bass thump." },
    { param: "pitchSweepSemitones", label: "Pitch Sweep", min: 0, max: 36, step: 1,
      group: "pitch", role: "pitchAmt", priority: 1, rand: { min: 5, max: 30 },
      tooltip: "Starting pitch above target in semitones — creates the 808 pitch drop." },
    { param: "pitchDecay", label: "Pitch Decay", min: 0.01, max: 1, step: 0.01,
      group: "pitch", role: "pitchDecay", priority: 1, rand: { min: 0.03, max: 0.25 },
      tooltip: "How quickly the pitch drop resolves to the target note." },
    // ---- Character ----
    { param: "distortion", label: "Distortion", min: 0, max: 1, step: 0.01,
      group: "character", role: "drive", priority: 1, rand: { min: 0, max: 0.4, bias: 2 },
      tooltip: "Adds saturation and harmonic content to the bass." },
    { param: "click", label: "Click", min: 0, max: 1, step: 0.01,
      group: "character", role: "click", priority: 2, rand: { min: 0, max: 0.6 },
      tooltip: "Adds a transient click at note onset for extra punch." },
    { param: "subOscMix", label: "Sub Mix", min: 0, max: 1, step: 0.01,
      group: "body", role: "body", priority: 2, rand: { min: 0, max: 0.6 },
      tooltip: "Blend of a sub-octave oscillator beneath the main tone." },
    // ---- Pitch / sequencing (part-level: excluded from randomize) ----
    { param: "octaveOffset", label: "Octave", min: -2, max: 2, step: 1,
      group: "pitch", role: "octave", priority: 3, rand: false,
      tooltip: "Shift all notes up or down by octaves." },
    { param: "octaveJumpProb", label: "Oct Jump", min: 0, max: 1, step: 0.01,
      group: "seq", role: "octaveJump", priority: 3, rand: false,
      tooltip: "Probability of randomly jumping an octave on each note." },
  ];

  /** Cross-param rules applied after randomize/mutate (see sound-design.js). */
  static constrain(v) {
    // A big, slow pitch drop reads as a siren rather than a boom.
    if (v.pitchSweepSemitones > 24 && v.pitchDecay > 0.15) v.pitchDecay = 0.15;
    // Heavy drive plus a loud click gets harsh; keep the dirt in the body.
    if (v.distortion > 0.25 && v.click > 0.4) v.click = 0.4;
    return v;
  }

  /**
   * @param {AudioContext} ctx
   * @param {string} [preset="Default"]
   */
  constructor(ctx, preset = "Default") {
    super(ctx, null); // creates ctx + _out, skips preset (extra nodes not ready yet)

    this._distortion = 0;
    this._distortionCurve = makeSoftClipCurve(0);

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
    this._distortionCurve = makeSoftClipCurve(v);
  }

  get tone() {
    return this._filter.frequency.value;
  }
  set tone(v) {
    this._filter.frequency.value = v;
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

  /** Trigger the sequence step, handling ratchet subdivisions. */
  triggerSequenceStep(index, s, subTime, subStepDur) {
    this._triggerRatcheted(s, subTime, subStepDur, (t, dur) => this.trigger(s.note, dur, t));
  }
}

// ---- Controls companion component ----

export class WebAudioSynth808Controls extends WebAudioControlsBase {
  static SLIDER_DEFS = sliderDefs(WebAudioSynth808.PARAMS);

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
    this._rootMidi = 29;
    this._scaleName = "Minor";
  }

  // ---- Identity overrides ----

  _defaultColor() {
    return "#fa0";
  }
  _defaultTitle() {
    return "808 Bass";
  }

  _fxTitle() {
    return "Bass FX";
  }

  _triggerJam(time, stepDurationSec) {
    const notes = scaleNotesInRange(this._rootMidi, this._scaleName, 24, 48);
    if (notes.length) {
      this._instrument.trigger(notes[Math.floor(Math.random() * notes.length)], stepDurationSec, time);
    }
  }

  // ---- Build controls ----

  _buildControls(controls, expanded, mkSlider, ctx, options) {
    const color = options.color || this._defaultColor();

    // ---- Tone ----
    const { el: toneEl, controls: toneCtrl } = createSection("Tone");

    toneCtrl.appendChild(mkSlider("tone"));
    controls.appendChild(toneEl);

    // ---- Shape ----
    const { el: shapeEl, controls: shapeCtrl } = createSection("Shape");
    shapeCtrl.appendChild(mkSlider("decay"));
    shapeCtrl.appendChild(mkSlider("pitchSweepSemitones"));
    shapeCtrl.appendChild(mkSlider("pitchDecay"));
    controls.appendChild(shapeEl);

    // ---- Character ----
    const { el: charEl, controls: charCtrl } = createSection("Character");
    charCtrl.appendChild(mkSlider("distortion"));
    charCtrl.appendChild(mkSlider("click"));
    charCtrl.appendChild(mkSlider("subOscMix"));
    controls.appendChild(charEl);

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
      steps: WebAudioSynth808Controls.DEFAULT_PATTERN(),
      noteOptions: scaleNoteOptions(this._rootMidi, this._scaleName, 24, 48),
      probability: true,
      ratchet: true,
      conditions: true,
      color,
    };
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
    this._instrument.steps = newSteps;
    this._emitChange();
  }

  _extendJSON(obj) {}

  _restoreExtra(obj) {}
}

customElements.define("wam-synth-808-controls", WebAudioSynth808Controls);
