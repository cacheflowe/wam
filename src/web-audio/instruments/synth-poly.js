import WebAudioInstrumentBase from "../global/instrument-base.js";
import { applyADSR, applyFilterEnv } from "../global/dsp/envelope.js";
import { createUnisonOscBank } from "../global/dsp/oscillator.js";
import "../ui/step-seq.js";
import { scaleNoteOptions, scaleNotesInRange, buildChordFromScale } from "../global/scales.js";
import { WebAudioControlsBase, createSection, createCtrl } from "../ui/controls-base.js";
import { sliderDefs } from "../global/param-schema.js";
import presetData from "../presets/synth-poly.json" with { type: "json" };
import { presetMap } from "../global/presets.js";

/**
 * WebAudioSynthPoly — robust polyphonic subtractive synthesizer.
 *
 * The flagship "do-everything" subtractive voice, built on the shared DSP
 * primitives (applyADSR, applyFilterEnv, createUnisonOscBank):
 *
 *   Osc A ─┐
 *   Osc B ─┤
 *   Sub   ─┤→ voiceMixer → filter → amp → out
 *   Noise ─┘                 ▲        ▲
 *                       filter ADSR  amp ADSR
 *                       (+ key track) (+ LFO)
 *
 * Per-note fire-and-forget voices give true polyphony with a per-voice filter
 * envelope. Voice stealing (oldest-first) bounds the active node count. Each
 * oscillator can run unison voices for thickness. Two LFOs (free-running or
 * tempo-synced) route to pitch, filter, or amp.
 *
 * trigger() accepts a single MIDI note or an array (chord).
 *
 * Usage:
 *   const poly = new WebAudioSynthPoly(ctx, "Default");
 *   poly.connect(fxUnit);
 *   poly.trigger([48, 52, 55], stepDurSec, 0.9, atTime);
 *   poly.bpm = 128; // for tempo-synced LFOs
 */
export default class WebAudioSynthPoly extends WebAudioInstrumentBase {
  /** Tempo-sync divisions for the LFOs (beats per cycle; 0 = free-running). */
  static LFO_SYNC = [
    { label: "Free", beats: 0 },
    { label: "1 bar", beats: 4 },
    { label: "1/2", beats: 2 },
    { label: "1/4", beats: 1 },
    { label: "1/8", beats: 0.5 },
    { label: "1/8T", beats: 1 / 3 },
    { label: "1/16", beats: 0.25 },
  ];

  /**
   * Param schema (see global/param-schema.js). Single source of truth for the
   * UI, serialization, randomize/mutate, and hardware mapping. `rand` ranges
   * are the musically useful sub-ranges a randomize/mutate may land in.
   * Waveform option order: saw, square, triangle, sine.
   */
  static PARAMS = [
    // ---- Osc A ----
    { param: "oscAType", label: "A Wave", type: "enum", options: ["sawtooth", "square", "triangle", "sine"],
      group: "osc", role: "wave", priority: 1, rand: { weights: [4, 2, 2, 1] },
      tooltip: "Oscillator A waveform." },
    { param: "oscASemi", label: "A Semi", min: -24, max: 24, step: 1,
      group: "osc", role: "pitch", priority: 3, rand: false,
      tooltip: "Oscillator A pitch offset in semitones." },
    { param: "oscADetune", label: "A Fine", min: -50, max: 50, step: 1,
      group: "osc", role: "detune", priority: 3, rand: { min: -10, max: 10 },
      tooltip: "Oscillator A fine detune in cents." },
    { param: "oscALevel", label: "A Level", min: 0, max: 1, step: 0.01,
      group: "osc", role: "level", priority: 3, rand: { min: 0.4, max: 0.8 },
      tooltip: "Oscillator A mix level." },
    // ---- Osc B ----
    { param: "oscBType", label: "B Wave", type: "enum", options: ["sawtooth", "square", "triangle", "sine"],
      group: "osc", role: "wave", priority: 2, rand: { weights: [4, 2, 2, 1] },
      tooltip: "Oscillator B waveform." },
    { param: "oscBSemi", label: "B Semi", min: -24, max: 24, step: 1,
      group: "osc", role: "pitch", priority: 2, rand: false,
      tooltip: "Oscillator B pitch offset in semitones." },
    { param: "oscBDetune", label: "B Fine", min: -50, max: 50, step: 1,
      group: "osc", role: "detune", priority: 2, rand: { min: -25, max: 25 },
      tooltip: "Oscillator B fine detune in cents." },
    { param: "oscBLevel", label: "B Level", min: 0, max: 1, step: 0.01,
      group: "osc", role: "level", priority: 2, rand: { min: 0, max: 0.7 },
      tooltip: "Oscillator B mix level." },
    // ---- Mix ----
    { param: "subLevel", label: "Sub", min: 0, max: 1, step: 0.01,
      group: "osc", role: "level", priority: 2, rand: { min: 0, max: 0.5 },
      tooltip: "Sub oscillator (sine, one octave below) level." },
    { param: "noiseLevel", label: "Noise", min: 0, max: 1, step: 0.01,
      group: "osc", role: "noise", priority: 2, rand: { min: 0, max: 0.15, bias: 2 },
      tooltip: "White-noise level." },
    { param: "unisonVoices", label: "Unison", min: 1, max: 4, step: 1,
      group: "osc", role: "unison", priority: 3, rand: { min: 1, max: 3 },
      tooltip: "Unison voices per oscillator." },
    { param: "unisonDetune", label: "U.Spread", min: 0, max: 50, step: 1,
      group: "osc", role: "detune", priority: 2, rand: { min: 0, max: 25 },
      tooltip: "Unison detune spread in cents." },
    // ---- Filter ----
    { param: "filterType", label: "Filter Type", type: "enum", options: ["lowpass", "highpass", "bandpass", "notch"],
      group: "filter", role: "filterType", priority: 3, rand: { weights: [6, 1, 1, 0] },
      tooltip: "Filter mode." },
    { param: "filterFreq", label: "Cutoff", min: 20, max: 16000, step: 1, scale: "log",
      group: "filter", role: "cutoff", priority: 1, rand: { min: 300, max: 6000 },
      tooltip: "Filter base cutoff." },
    { param: "filterQ", label: "Res", min: 0.1, max: 20, step: 0.1,
      group: "filter", role: "resonance", priority: 1, rand: { min: 0.5, max: 10 },
      tooltip: "Filter resonance." },
    { param: "filterEnvAmt", label: "Env Amt", min: -6, max: 6, step: 0.1,
      group: "filter", role: "envAmt", priority: 1, rand: { min: -1.5, max: 4 },
      tooltip: "Filter envelope depth in octaves." },
    { param: "filterKeytrack", label: "Key Trk", min: 0, max: 1, step: 0.01,
      group: "filter", role: "keytrack", priority: 3, rand: { min: 0, max: 0.7 },
      tooltip: "Filter cutoff tracking of note pitch." },
    // ---- Filter envelope ----
    { param: "filterAttack", label: "F.Atk", min: 0.001, max: 8, step: 0.001,
      group: "filter-env", role: "filterAttack", priority: 2, rand: { min: 0.001, max: 0.4, bias: 2 },
      tooltip: "Filter envelope attack." },
    { param: "filterDecay", label: "F.Dec", min: 0.01, max: 4, step: 0.01,
      group: "filter-env", role: "filterDecay", priority: 1, rand: { min: 0.05, max: 1.2 },
      tooltip: "Filter envelope decay." },
    { param: "filterSustain", label: "F.Sus", min: 0, max: 1, step: 0.01,
      group: "filter-env", role: "filterSustain", priority: 2, rand: { min: 0, max: 0.8 },
      tooltip: "Filter envelope sustain." },
    { param: "filterRelease", label: "F.Rel", min: 0.01, max: 8, step: 0.01,
      group: "filter-env", role: "filterRelease", priority: 2, rand: { min: 0.05, max: 1.5 },
      tooltip: "Filter envelope release." },
    // ---- Amp envelope ----
    { param: "attack", label: "Attack", min: 0.001, max: 8, step: 0.001,
      group: "amp-env", role: "attack", priority: 1, rand: { min: 0.001, max: 0.5, bias: 2 },
      tooltip: "Amplitude attack." },
    { param: "decay", label: "Decay", min: 0.01, max: 4, step: 0.01,
      group: "amp-env", role: "decay", priority: 1, rand: { min: 0.05, max: 1.5 },
      tooltip: "Amplitude decay." },
    { param: "sustain", label: "Sustain", min: 0, max: 1, step: 0.01,
      group: "amp-env", role: "sustain", priority: 1, rand: { min: 0, max: 1 },
      tooltip: "Amplitude sustain." },
    { param: "release", label: "Release", min: 0.01, max: 8, step: 0.01,
      group: "amp-env", role: "release", priority: 1, rand: { min: 0.05, max: 1.5 },
      tooltip: "Amplitude release." },
    { param: "gate", label: "Gate", min: 0.1, max: 16, step: 0.05, scale: "log",
      group: "amp-env", role: "gate", priority: 2, rand: false,
      tooltip: "Sequenced note length, in steps. Long attacks need a long gate to bloom." },
    { param: "glide", label: "Glide", min: 0, max: 2, step: 0.01,
      group: "pitch", role: "glide", priority: 2, rand: { min: 0, max: 0.1, bias: 2 },
      tooltip: "Portamento glide time." },
    // ---- LFO 1 ----
    { param: "lfo1Sync", label: "L1 Sync", type: "enum", options: [0, 4, 2, 1, 0.5, 1 / 3, 0.25],
      group: "mod", role: "lfoRate", priority: 3, rand: { weights: [3, 1, 1, 1, 1, 1, 1] },
      tooltip: "LFO 1 tempo sync (beats per cycle; Free = use Rate)." },
    { param: "lfo1Rate", label: "L1 Rate", min: 0.01, max: 20, step: 0.01,
      group: "mod", role: "lfoRate", priority: 2, rand: { min: 0.1, max: 8 },
      tooltip: "LFO 1 free rate (Hz). Used when Sync = Free." },
    { param: "lfo1Depth", label: "L1 Depth", min: 0, max: 1, step: 0.01,
      group: "mod", role: "lfoDepth", priority: 2, rand: { min: 0, max: 0.4, bias: 2 },
      tooltip: "LFO 1 depth (0 = off)." },
    { param: "lfo1Shape", label: "L1 Shape", type: "enum", options: ["sawtooth", "square", "triangle", "sine"],
      group: "mod", role: "lfoShape", priority: 3, rand: { weights: [1, 1, 2, 3] },
      tooltip: "LFO 1 waveform." },
    { param: "lfo1Dest", label: "L1 Dest", type: "enum", options: ["off", "filter", "pitch", "amp"],
      group: "mod", role: "lfoTarget", priority: 3, rand: { weights: [1, 4, 1, 1] },
      tooltip: "LFO 1 destination." },
    // ---- LFO 2 ----
    { param: "lfo2Sync", label: "L2 Sync", type: "enum", options: [0, 4, 2, 1, 0.5, 1 / 3, 0.25],
      group: "mod", role: "lfoRate", priority: 3, rand: { weights: [3, 1, 1, 1, 1, 1, 1] },
      tooltip: "LFO 2 tempo sync (beats per cycle; Free = use Rate)." },
    { param: "lfo2Rate", label: "L2 Rate", min: 0.01, max: 20, step: 0.01,
      group: "mod", role: "lfoRate", priority: 3, rand: { min: 0.1, max: 8 },
      tooltip: "LFO 2 free rate (Hz). Used when Sync = Free." },
    { param: "lfo2Depth", label: "L2 Depth", min: 0, max: 1, step: 0.01,
      group: "mod", role: "lfoDepth", priority: 3, rand: { min: 0, max: 0.4, bias: 2 },
      tooltip: "LFO 2 depth (0 = off)." },
    { param: "lfo2Shape", label: "L2 Shape", type: "enum", options: ["sawtooth", "square", "triangle", "sine"],
      group: "mod", role: "lfoShape", priority: 3, rand: { weights: [1, 1, 2, 3] },
      tooltip: "LFO 2 waveform." },
    { param: "lfo2Dest", label: "L2 Dest", type: "enum", options: ["off", "filter", "pitch", "amp"],
      group: "mod", role: "lfoTarget", priority: 3, rand: { weights: [2, 1, 2, 1] },
      tooltip: "LFO 2 destination." },
    // ---- Voice / sequencing (part-level: excluded from randomize) ----
    { param: "octaveOffset", label: "Octave", min: -2, max: 2, step: 1,
      group: "pitch", role: "octave", priority: 3, rand: false,
      tooltip: "Shift all notes by octaves." },
    { param: "octaveJumpProb", label: "Oct Jump", min: 0, max: 1, step: 0.01,
      group: "seq", role: "octaveJump", priority: 3, rand: false,
      tooltip: "Chance of an octave jump per note." },
    { param: "voiceLimit", label: "V.Limit", min: 0, max: 16, step: 1,
      group: "seq", role: "voices", priority: 3, rand: false,
      tooltip: "Max simultaneous voices (0 = unlimited)." },
  ];

  /**
   * Cross-param rules applied after randomize/mutate (see sound-design.js).
   * Keeps rolled sounds out of harsh, seasick, or silent corners.
   */
  static constrain(v) {
    for (const n of [1, 2]) {
      // Pitch LFO depth is ×1200 cents — cap at ~±1 semitone of vibrato.
      if (v[`lfo${n}Dest`] === "pitch" && v[`lfo${n}Depth`] > 0.08) v[`lfo${n}Depth`] = 0.08;
      // Deep tremolo chops the sound to silence.
      if (v[`lfo${n}Dest`] === "amp" && v[`lfo${n}Depth`] > 0.5) v[`lfo${n}Depth`] = 0.5;
    }
    // A highpass with a high cutoff leaves nothing but fizz.
    if (v.filterType === "highpass" && v.filterFreq > 1500) v.filterFreq = 1500;
    // A closed lowpass with little envelope sweep is near-silent mud.
    if (v.filterType === "lowpass" && v.filterFreq < 400 && v.filterEnvAmt < 1) v.filterEnvAmt = 1;
    // High resonance + a big upward sweep screams.
    if (v.filterQ > 12 && v.filterEnvAmt > 3) v.filterEnvAmt = 3;
    // Keep the oscillators audible.
    if (v.oscALevel + v.oscBLevel + v.subLevel < 0.4) v.oscALevel = 0.6;
    // Spread does nothing on a single voice; keep it at 0 so the knob reads honestly.
    if (v.unisonVoices <= 1) v.unisonDetune = 0;
    return v;
  }

  /** Presets live in ../presets/synth-poly.json (written by the dev preset store). */
  static PRESET_DATA = presetData;
  static PRESETS = presetMap(presetData);

  constructor(ctx, preset = "Default") {
    super(ctx, null);
    this._lastFreq = 0;
    this._activeVoices = [];
    this._bpm = 120;
    // Chord context for sequenced steps (mirrored from Controls on change)
    this._scaleName = "Minor";
    this._chordSize = 1;

    // Pre-baked 1s white-noise buffer, looped per voice when noise is enabled.
    const len = Math.ceil(ctx.sampleRate);
    this._noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const nd = this._noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) nd[i] = Math.random() * 2 - 1;

    // ---- Defaults (overridden by applyPreset) ----
    this.oscAType = "sawtooth"; this.oscASemi = 0; this.oscADetune = 0; this.oscALevel = 0.7;
    this.oscBType = "sawtooth"; this.oscBSemi = 0; this.oscBDetune = 8; this.oscBLevel = 0.5;
    this.subLevel = 0; this.noiseLevel = 0;
    this.unisonVoices = 1; this.unisonDetune = 0;
    this.filterType = "lowpass"; this.filterFreq = 1400; this.filterQ = 3;
    this.filterEnvAmt = 1.5; this.filterKeytrack = 0.3;
    this.filterAttack = 0.02; this.filterDecay = 0.3; this.filterSustain = 0.2; this.filterRelease = 0.4;
    this.attack = 0.01; this.decay = 0.3; this.sustain = 0.6; this.release = 0.4;
    this.glide = 0;
    this.lfo1Rate = 5; this.lfo1Sync = 0; this.lfo1Shape = "sine"; this.lfo1Depth = 0; this.lfo1Dest = "filter";
    this.lfo2Rate = 0.5; this.lfo2Sync = 0; this.lfo2Shape = "sine"; this.lfo2Depth = 0; this.lfo2Dest = "pitch";
    this.voiceLimit = 12;
    this.octaveOffset = 0;
    this.octaveJumpProb = 0;
    this.gate = 1; // note length in steps (sequencer)

    this.applyPreset(preset);
  }

  /** BPM is forwarded by the controls for tempo-synced LFOs. */
  get bpm() {
    return this._bpm;
  }
  set bpm(v) {
    this._bpm = v;
  }

  /** Clear portamento memory — call when stopping/restarting the sequencer. */
  reset() {
    this._lastFreq = 0;
  }

  /**
   * @param {number|number[]} midiNotes  Single MIDI note or chord array.
   * @param {number} durationSec
   * @param {number} [velocity]  0–1
   * @param {number} [atTime]    AudioContext time
   */
  trigger(midiNotes, durationSec, velocity = 1, atTime = 0) {
    const ctx = this.ctx;
    const t = atTime > 0 ? atTime : ctx.currentTime;
    const shift = this.octaveOffset * 12 + (Math.random() < this.octaveJumpProb ? 12 : 0);
    const notes = (Array.isArray(midiNotes) ? midiNotes : [midiNotes]).map((n) => n + shift);
    const peak = velocity / Math.sqrt(notes.length);
    const prevFreq = this._lastFreq;

    this._steal(notes.length);

    for (const midi of notes) this._voice(midi, durationSec, peak, t, prevFreq);

    this._lastFreq = 440 * Math.pow(2, (notes[0] - 69) / 12);
  }

  /** Prune ended voices and steal the oldest until the new note count fits. */
  _steal(newCount) {
    if (this.voiceLimit <= 0) return;
    const now = this.ctx.currentTime;
    this._activeVoices = this._activeVoices.filter((v) => v.stopTime > now);
    while (this._activeVoices.length + newCount > this.voiceLimit) {
      const stolen = this._activeVoices.shift();
      if (!stolen) break;
      stolen.amp.gain.cancelScheduledValues(now);
      stolen.amp.gain.setValueAtTime(stolen.amp.gain.value, now);
      stolen.amp.gain.linearRampToValueAtTime(0, now + 0.05);
    }
  }

  _voice(midi, durationSec, peak, t, prevFreq) {
    const ctx = this.ctx;
    const noteFreq = 440 * Math.pow(2, (midi - 69) / 12);
    const stopTime = t + durationSec + Math.max(this.release, this.filterRelease) + 0.1;
    const uni = Math.max(1, Math.round(this.unisonVoices));
    const uniComp = 1 / Math.sqrt(uni);

    const voiceMixer = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const amp = ctx.createGain();
    const nodes = [voiceMixer, filter, amp];
    const oscs = [];

    // ---- Oscillator A ----
    const aGain = ctx.createGain();
    aGain.gain.value = this.oscALevel * uniComp;
    aGain.connect(voiceMixer);
    nodes.push(aGain);
    oscs.push(
      ...createUnisonOscBank(ctx, {
        voices: uni, type: this.oscAType,
        detune: this.oscASemi * 100 + this.oscADetune, spread: this.unisonDetune,
        freq: noteFreq, glideFrom: prevFreq, glideTime: this.glide,
        start: t, stop: stopTime, dest: aGain,
      }),
    );

    // ---- Oscillator B ----
    const bGain = ctx.createGain();
    bGain.gain.value = this.oscBLevel * uniComp;
    bGain.connect(voiceMixer);
    nodes.push(bGain);
    oscs.push(
      ...createUnisonOscBank(ctx, {
        voices: uni, type: this.oscBType,
        detune: this.oscBSemi * 100 + this.oscBDetune, spread: this.unisonDetune,
        freq: noteFreq, glideFrom: prevFreq, glideTime: this.glide,
        start: t, stop: stopTime, dest: bGain,
      }),
    );

    // ---- Sub oscillator (sine, one octave below) ----
    if (this.subLevel > 0) {
      const subOsc = ctx.createOscillator();
      const subGain = ctx.createGain();
      subOsc.type = "sine";
      subOsc.frequency.value = noteFreq / 2;
      subGain.gain.value = this.subLevel;
      subOsc.connect(subGain);
      subGain.connect(voiceMixer);
      subOsc.start(t);
      subOsc.stop(stopTime);
      nodes.push(subOsc, subGain);
    }

    // ---- Noise ----
    if (this.noiseLevel > 0) {
      const noise = ctx.createBufferSource();
      const noiseGain = ctx.createGain();
      noise.buffer = this._noiseBuffer;
      noise.loop = true;
      noiseGain.gain.value = this.noiseLevel;
      noise.connect(noiseGain);
      noiseGain.connect(voiceMixer);
      noise.start(t);
      noise.stop(stopTime);
      nodes.push(noise, noiseGain);
    }

    // ---- Filter (per voice) with key tracking + envelope ----
    filter.type = this.filterType;
    filter.Q.value = this.filterQ;
    const base = Math.max(20, Math.min(20000, this.filterFreq * Math.pow(2, (this.filterKeytrack * (midi - 60)) / 12)));
    applyFilterEnv(filter.frequency, {
      base, envAmtOctaves: this.filterEnvAmt, sustain: this.filterSustain,
      attack: this.filterAttack, decay: this.filterDecay, release: this.filterRelease,
      start: t, releaseAt: t + durationSec,
    });

    // ---- Amp envelope ----
    applyADSR(amp.gain, {
      start: t, peak,
      attack: this.attack, decay: this.decay, sustain: this.sustain, release: this.release,
      releaseAt: t + durationSec,
    });

    voiceMixer.connect(filter);
    filter.connect(amp);
    amp.connect(this._out);

    // ---- LFOs ----
    this._applyLFO(1, { filter, amp, oscs, start: t, stop: stopTime }, nodes);
    this._applyLFO(2, { filter, amp, oscs, start: t, stop: stopTime }, nodes);

    if (this.voiceLimit > 0) this._activeVoices.push({ amp, stopTime });

    // Clean up the whole voice when its longest oscillator ends.
    oscs[oscs.length - 1].onended = () => {
      for (const n of nodes) n.disconnect();
    };
  }

  /** Wire LFO `n` (1 or 2) to its destination. */
  _applyLFO(n, { filter, amp, oscs, start, stop }, nodes) {
    const depth = this[`lfo${n}Depth`];
    const dest = this[`lfo${n}Dest`];
    if (depth <= 0 || dest === "off") return;

    const sync = this[`lfo${n}Sync`];
    const freq = sync > 0 ? this._bpm / 60 / sync : this[`lfo${n}Rate`];

    const lfoOsc = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfoOsc.type = this[`lfo${n}Shape`];
    lfoOsc.frequency.value = freq;
    lfoOsc.connect(lfoGain);

    if (dest === "pitch") {
      lfoGain.gain.value = depth * 1200; // cents
      for (const o of oscs) lfoGain.connect(o.detune);
    } else if (dest === "amp") {
      lfoGain.gain.value = depth * 0.5;
      lfoGain.connect(amp.gain);
    } else {
      // filter
      lfoGain.gain.value = depth * 2400; // cents on filter detune
      lfoGain.connect(filter.detune);
    }

    lfoOsc.start(start);
    lfoOsc.stop(stop);
    nodes.push(lfoOsc, lfoGain);
  }

  /** Trigger the sequence step, building a chord from the current scale and handling ratchet. */
  triggerSequenceStep(index, s, subTime, subStepDur) {
    const chordSize = this._chordSize ?? 1;
    const chord = chordSize === 1 ? s.note : buildChordFromScale(s.note, this._scaleName, chordSize);
    this._triggerRatcheted(s, subTime, subStepDur, (t, dur) => this.trigger(chord, dur, 0.8, t));
  }
}

// ---- Controls companion component ----

export class WebAudioSynthPolyControls extends WebAudioControlsBase {
  static SLIDER_DEFS = sliderDefs(WebAudioSynthPoly.PARAMS);

  static DEFAULT_PATTERN() {
    const active = new Set([0, 4, 8, 12]);
    return Array.from({ length: 16 }, (_, i) => ({
      active: active.has(i),
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
    this._chordSize = 1;
  }

  _defaultColor() {
    return "#7cf";
  }
  _defaultTitle() {
    return "Poly Synth";
  }
  _fxTitle() {
    return "Poly FX";
  }

  _triggerJam(time, stepDurationSec) {
    const notes = scaleNotesInRange(this._rootMidi, this._scaleName, 36, 84);
    if (notes.length) {
      const note = notes[Math.floor(Math.random() * notes.length)];
      const chord = this._chordSize === 1 ? note : buildChordFromScale(note, this._scaleName, this._chordSize);
      this._instrument.trigger(chord, stepDurationSec, 0.8, time);
    }
  }

  set bpm(v) {
    super.bpm = v;
    if (this._instrument) this._instrument._bpm = v;
  }

  /** Build a labeled <select> bound to an instrument param. */
  _select(label, param, options, opts = {}) {
    const wrap = createCtrl(label, opts.tooltip ? { tooltip: opts.tooltip } : {});
    const sel = document.createElement("select");
    sel.className = "wam-select";
    for (const [val, text] of options) {
      const o = document.createElement("option");
      o.value = val;
      o.textContent = text;
      sel.appendChild(o);
    }
    sel.value = this._instrument[param];
    this._registerSelect(param, sel, opts.parse ? { parse: opts.parse } : {});
    wrap.appendChild(sel);
    return wrap;
  }

  _buildControls(controls, expanded, mkSlider, ctx, options) {
    const color = options.color || this._defaultColor();
    const WAVES = [
      ["sawtooth", "Saw"],
      ["square", "Sqr"],
      ["triangle", "Tri"],
      ["sine", "Sin"],
    ];
    const SYNC = WebAudioSynthPoly.LFO_SYNC.map(({ label, beats }) => [String(beats), label]);
    const DESTS = [
      ["off", "Off"],
      ["filter", "Filter"],
      ["pitch", "Pitch"],
      ["amp", "Amp"],
    ];

    // ---- Osc A ----
    const { el: aEl, controls: aCtrl } = createSection("Osc A");
    aCtrl.appendChild(this._select("Wave", "oscAType", WAVES));
    aCtrl.appendChild(mkSlider("oscASemi", { label: "Semi" }));
    aCtrl.appendChild(mkSlider("oscADetune", { label: "Fine" }));
    aCtrl.appendChild(mkSlider("oscALevel", { label: "Level" }));
    controls.appendChild(aEl);

    // ---- Osc B ----
    const { el: bEl, controls: bCtrl } = createSection("Osc B");
    bCtrl.appendChild(this._select("Wave", "oscBType", WAVES));
    bCtrl.appendChild(mkSlider("oscBSemi", { label: "Semi" }));
    bCtrl.appendChild(mkSlider("oscBDetune", { label: "Fine" }));
    bCtrl.appendChild(mkSlider("oscBLevel", { label: "Level" }));
    controls.appendChild(bEl);

    // ---- Mix ----
    const { el: mixEl, controls: mixCtrl } = createSection("Mix");
    mixCtrl.appendChild(mkSlider("subLevel"));
    mixCtrl.appendChild(mkSlider("noiseLevel"));
    mixCtrl.appendChild(mkSlider("unisonVoices"));
    mixCtrl.appendChild(mkSlider("unisonDetune", { label: "Spread" }));
    controls.appendChild(mixEl);

    // ---- Filter ----
    const { el: fEl, controls: fCtrl } = createSection("Filter");
    fCtrl.appendChild(
      this._select("Type", "filterType", [
        ["lowpass", "LP"],
        ["highpass", "HP"],
        ["bandpass", "BP"],
        ["notch", "Notch"],
      ]),
    );
    fCtrl.appendChild(mkSlider("filterFreq"));
    fCtrl.appendChild(mkSlider("filterQ"));
    fCtrl.appendChild(mkSlider("filterEnvAmt"));
    fCtrl.appendChild(mkSlider("filterKeytrack"));
    controls.appendChild(fEl);

    // ---- Filter Envelope ----
    const { el: feEl, controls: feCtrl } = createSection("Filter Env");
    feCtrl.appendChild(mkSlider("filterAttack"));
    feCtrl.appendChild(mkSlider("filterDecay"));
    feCtrl.appendChild(mkSlider("filterSustain"));
    feCtrl.appendChild(mkSlider("filterRelease"));
    controls.appendChild(feEl);

    // ---- Amp Envelope ----
    const { el: envEl, controls: envCtrl } = createSection("Envelope");
    envCtrl.appendChild(mkSlider("attack"));
    envCtrl.appendChild(mkSlider("decay"));
    envCtrl.appendChild(mkSlider("sustain"));
    envCtrl.appendChild(mkSlider("release"));
    envCtrl.appendChild(mkSlider("gate"));
    envCtrl.appendChild(mkSlider("glide"));
    controls.appendChild(envEl);

    // ---- LFO 1 & 2 ----
    for (const n of [1, 2]) {
      const { el, controls: lc } = createSection(`LFO ${n}`);
      lc.appendChild(this._select("Sync", `lfo${n}Sync`, SYNC, { parse: parseFloat }));
      lc.appendChild(mkSlider(`lfo${n}Rate`, { label: "Rate" }));
      lc.appendChild(mkSlider(`lfo${n}Depth`, { label: "Depth" }));
      lc.appendChild(this._select("Shape", `lfo${n}Shape`, WAVES));
      lc.appendChild(this._select("Dest", `lfo${n}Dest`, DESTS));
      controls.appendChild(el);
    }

    // ---- Voice ----
    const { el: vEl, controls: vCtrl } = createSection("Voice");
    vCtrl.appendChild(mkSlider("octaveOffset"));
    vCtrl.appendChild(mkSlider("octaveJumpProb", { label: "Jump" }));
    vCtrl.appendChild(mkSlider("voiceLimit"));
    controls.appendChild(vEl);

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

    this._createSequencer(expanded, color);
  }

  // ---- Subclass hooks ----

  _seqInitOptions(color) {
    return {
      steps: WebAudioSynthPolyControls.DEFAULT_PATTERN(),
      noteOptions: scaleNoteOptions(this._rootMidi, this._scaleName, 24, 84),
      probability: true,
      ratchet: true,
      conditions: true,
      color,
    };
  }

  setScale(rootMidi, scaleName) {
    this._rootMidi = rootMidi;
    this._scaleName = scaleName;
    this._instrument._scaleName = scaleName;
    this._seq?.setNoteOptions(scaleNoteOptions(rootMidi, scaleName, 24, 84));
  }

  randomize() {
    const noteOpts = scaleNoteOptions(this._rootMidi, this._scaleName, 36, 72);
    const notes = noteOpts.map(([, midi]) => midi);
    if (!notes.length) return;
    const numActive = 3 + Math.floor(Math.random() * 4);
    const activeSet = new Set([0]);
    while (activeSet.size < numActive) activeSet.add(Math.floor(Math.random() * 16));
    const newSteps = Array.from({ length: 16 }, (_, i) => ({
      active: activeSet.has(i),
      note: notes[Math.floor(Math.random() * notes.length)],
      probability: 1,
      ratchet: 1,
      conditions: "off",
    }));
    newSteps[0] = { active: true, note: this._rootMidi, probability: 1, ratchet: 1, conditions: "off" };
    this._instrument.steps = newSteps;
    this._emitChange();
  }

  // ---- Serialization ----

  _extraToJSON(params) {
    params.oscAType = this._instrument.oscAType;
    params.oscBType = this._instrument.oscBType;
    params.filterType = this._instrument.filterType;
    params.lfo1Shape = this._instrument.lfo1Shape;
    params.lfo1Dest = this._instrument.lfo1Dest;
    params.lfo1Sync = this._instrument.lfo1Sync;
    params.lfo2Shape = this._instrument.lfo2Shape;
    params.lfo2Dest = this._instrument.lfo2Dest;
    params.lfo2Sync = this._instrument.lfo2Sync;
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

customElements.define("wam-synth-poly-controls", WebAudioSynthPolyControls);
