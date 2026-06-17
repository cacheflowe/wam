import WebAudioInstrumentBase from "../global/instrument-base.js";
import { applyADSR, applyFilterEnv } from "../global/dsp/envelope.js";
import { createUnisonOscBank } from "../global/dsp/oscillator.js";
import "../ui/step-seq.js";
import { scaleNoteOptions, scaleNotesInRange, buildChordFromScale } from "../global/scales.js";
import { WebAudioControlsBase, createSection, createCtrl } from "../ui/controls-base.js";

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

  static PRESETS = {
    Default: {
      oscAType: "sawtooth", oscASemi: 0, oscADetune: 0, oscALevel: 0.7,
      oscBType: "sawtooth", oscBSemi: 0, oscBDetune: 8, oscBLevel: 0.5,
      subLevel: 0, noiseLevel: 0,
      unisonVoices: 1, unisonDetune: 0,
      filterType: "lowpass", filterFreq: 1400, filterQ: 3, filterEnvAmt: 1.5, filterKeytrack: 0.3,
      filterAttack: 0.02, filterDecay: 0.3, filterSustain: 0.2, filterRelease: 0.4,
      attack: 0.01, decay: 0.3, sustain: 0.6, release: 0.4,
      glide: 0,
      lfo1Rate: 5, lfo1Sync: 0, lfo1Shape: "sine", lfo1Depth: 0, lfo1Dest: "filter",
      lfo2Rate: 0.5, lfo2Sync: 0, lfo2Shape: "sine", lfo2Depth: 0, lfo2Dest: "pitch",
      voiceLimit: 12,
      volume: 0.8,
    },
    Super_Saw: {
      oscAType: "sawtooth", oscASemi: 0, oscADetune: 0, oscALevel: 0.6,
      oscBType: "sawtooth", oscBSemi: 0, oscBDetune: 0, oscBLevel: 0.6,
      subLevel: 0, noiseLevel: 0,
      unisonVoices: 4, unisonDetune: 22,
      filterType: "lowpass", filterFreq: 2200, filterQ: 2, filterEnvAmt: 1, filterKeytrack: 0.4,
      filterAttack: 0.02, filterDecay: 0.4, filterSustain: 0.4, filterRelease: 0.6,
      attack: 0.02, decay: 0.4, sustain: 0.7, release: 0.6,
      glide: 0,
      lfo1Rate: 5, lfo1Sync: 0, lfo1Shape: "sine", lfo1Depth: 0, lfo1Dest: "filter",
      lfo2Rate: 0.4, lfo2Sync: 0, lfo2Shape: "sine", lfo2Depth: 0.04, lfo2Dest: "pitch",
      voiceLimit: 12,
      volume: 0.55,
    },
    Fat_Bass: {
      oscAType: "sawtooth", oscASemi: 0, oscADetune: 0, oscALevel: 0.7,
      oscBType: "square", oscBSemi: 0, oscBDetune: 5, oscBLevel: 0.4,
      subLevel: 0.6, noiseLevel: 0,
      unisonVoices: 1, unisonDetune: 0,
      filterType: "lowpass", filterFreq: 500, filterQ: 6, filterEnvAmt: 2.5, filterKeytrack: 0.2,
      filterAttack: 0.005, filterDecay: 0.18, filterSustain: 0, filterRelease: 0.2,
      attack: 0.005, decay: 0.2, sustain: 0.6, release: 0.2,
      glide: 0.04,
      lfo1Rate: 5, lfo1Sync: 0, lfo1Shape: "sine", lfo1Depth: 0, lfo1Dest: "filter",
      lfo2Rate: 0.5, lfo2Sync: 0, lfo2Shape: "sine", lfo2Depth: 0, lfo2Dest: "pitch",
      voiceLimit: 8,
      volume: 0.7,
    },
    Hollow_Pad: {
      oscAType: "triangle", oscASemi: 0, oscADetune: 0, oscALevel: 0.6,
      oscBType: "sine", oscBSemi: 12, oscBDetune: 4, oscBLevel: 0.4,
      subLevel: 0.2, noiseLevel: 0,
      unisonVoices: 2, unisonDetune: 10,
      filterType: "lowpass", filterFreq: 3000, filterQ: 1, filterEnvAmt: 0.5, filterKeytrack: 0.5,
      filterAttack: 0.8, filterDecay: 0.6, filterSustain: 0.6, filterRelease: 1.8,
      attack: 0.6, decay: 0.5, sustain: 0.8, release: 2.0,
      glide: 0,
      lfo1Rate: 0.4, lfo1Sync: 0, lfo1Shape: "sine", lfo1Depth: 0.15, lfo1Dest: "filter",
      lfo2Rate: 4, lfo2Sync: 0, lfo2Shape: "sine", lfo2Depth: 0.03, lfo2Dest: "pitch",
      voiceLimit: 12,
      volume: 0.5,
    },
    Pluck: {
      oscAType: "sawtooth", oscASemi: 0, oscADetune: 0, oscALevel: 0.7,
      oscBType: "square", oscBSemi: 0, oscBDetune: 0, oscBLevel: 0.3,
      subLevel: 0, noiseLevel: 0,
      unisonVoices: 1, unisonDetune: 0,
      filterType: "lowpass", filterFreq: 1800, filterQ: 5, filterEnvAmt: 2.5, filterKeytrack: 0.5,
      filterAttack: 0.001, filterDecay: 0.12, filterSustain: 0, filterRelease: 0.15,
      attack: 0.001, decay: 0.18, sustain: 0, release: 0.2,
      glide: 0,
      lfo1Rate: 5, lfo1Sync: 0, lfo1Shape: "sine", lfo1Depth: 0, lfo1Dest: "filter",
      lfo2Rate: 0.5, lfo2Sync: 0, lfo2Shape: "sine", lfo2Depth: 0, lfo2Dest: "pitch",
      voiceLimit: 12,
      volume: 0.7,
    },
    Wobble: {
      oscAType: "sawtooth", oscASemi: 0, oscADetune: 0, oscALevel: 0.7,
      oscBType: "sawtooth", oscBSemi: -12, oscBDetune: 6, oscBLevel: 0.5,
      subLevel: 0.5, noiseLevel: 0,
      unisonVoices: 1, unisonDetune: 0,
      filterType: "lowpass", filterFreq: 600, filterQ: 8, filterEnvAmt: 0, filterKeytrack: 0,
      filterAttack: 0.01, filterDecay: 0.3, filterSustain: 1, filterRelease: 0.3,
      attack: 0.01, decay: 0.3, sustain: 1, release: 0.2,
      glide: 0.02,
      lfo1Rate: 4, lfo1Sync: 1, lfo1Shape: "sine", lfo1Depth: 0.7, lfo1Dest: "filter",
      lfo2Rate: 0.5, lfo2Sync: 0, lfo2Shape: "sine", lfo2Depth: 0, lfo2Dest: "pitch",
      voiceLimit: 6,
      volume: 0.7,
    },
    Detuned_Lead: {
      oscAType: "square", oscASemi: 0, oscADetune: 0, oscALevel: 0.6,
      oscBType: "sawtooth", oscBSemi: 0, oscBDetune: 12, oscBLevel: 0.5,
      subLevel: 0.2, noiseLevel: 0,
      unisonVoices: 2, unisonDetune: 16,
      filterType: "lowpass", filterFreq: 2600, filterQ: 3, filterEnvAmt: 1, filterKeytrack: 0.4,
      filterAttack: 0.01, filterDecay: 0.3, filterSustain: 0.5, filterRelease: 0.4,
      attack: 0.01, decay: 0.25, sustain: 0.7, release: 0.4,
      glide: 0.05,
      lfo1Rate: 5, lfo1Sync: 0, lfo1Shape: "sine", lfo1Depth: 0, lfo1Dest: "filter",
      lfo2Rate: 5.5, lfo2Sync: 0, lfo2Shape: "sine", lfo2Depth: 0.06, lfo2Dest: "pitch",
      voiceLimit: 8,
      volume: 0.55,
    },
    Brass_Stab: {
      oscAType: "sawtooth", oscASemi: 0, oscADetune: 0, oscALevel: 0.6,
      oscBType: "sawtooth", oscBSemi: 0, oscBDetune: 7, oscBLevel: 0.6,
      subLevel: 0, noiseLevel: 0,
      unisonVoices: 1, unisonDetune: 0,
      filterType: "lowpass", filterFreq: 1600, filterQ: 2, filterEnvAmt: 1.8, filterKeytrack: 0.3,
      filterAttack: 0.05, filterDecay: 0.25, filterSustain: 0.3, filterRelease: 0.3,
      attack: 0.04, decay: 0.2, sustain: 0.7, release: 0.3,
      glide: 0,
      lfo1Rate: 5, lfo1Sync: 0, lfo1Shape: "sine", lfo1Depth: 0, lfo1Dest: "filter",
      lfo2Rate: 0.5, lfo2Sync: 0, lfo2Shape: "sine", lfo2Depth: 0, lfo2Dest: "pitch",
      voiceLimit: 8,
      volume: 0.5,
    },
    Reese_Bass: {
      oscAType: "sawtooth", oscASemi: 0, oscADetune: 0, oscALevel: 0.6,
      oscBType: "sawtooth", oscBSemi: 0, oscBDetune: 22, oscBLevel: 0.6,
      subLevel: 0.3, noiseLevel: 0,
      unisonVoices: 2, unisonDetune: 12,
      filterType: "lowpass", filterFreq: 420, filterQ: 4, filterEnvAmt: 0.5, filterKeytrack: 0.1,
      filterAttack: 0.01, filterDecay: 0.3, filterSustain: 0.8, filterRelease: 0.3,
      attack: 0.01, decay: 0.3, sustain: 1, release: 0.3,
      glide: 0.02,
      lfo1Rate: 0.3, lfo1Sync: 0, lfo1Shape: "sine", lfo1Depth: 0.12, lfo1Dest: "filter",
      lfo2Rate: 0.5, lfo2Sync: 0, lfo2Shape: "sine", lfo2Depth: 0, lfo2Dest: "pitch",
      voiceLimit: 6,
      volume: 0.6,
    },
    Warm_Keys: {
      oscAType: "triangle", oscASemi: 0, oscADetune: 0, oscALevel: 0.6,
      oscBType: "sine", oscBSemi: 0, oscBDetune: 4, oscBLevel: 0.4,
      subLevel: 0.2, noiseLevel: 0,
      unisonVoices: 1, unisonDetune: 0,
      filterType: "lowpass", filterFreq: 3500, filterQ: 1, filterEnvAmt: 1, filterKeytrack: 0.5,
      filterAttack: 0.01, filterDecay: 0.4, filterSustain: 0.3, filterRelease: 0.5,
      attack: 0.01, decay: 0.4, sustain: 0.5, release: 0.6,
      glide: 0,
      lfo1Rate: 5, lfo1Sync: 0, lfo1Shape: "sine", lfo1Depth: 0, lfo1Dest: "filter",
      lfo2Rate: 0.5, lfo2Sync: 0, lfo2Shape: "sine", lfo2Depth: 0, lfo2Dest: "pitch",
      voiceLimit: 12,
      volume: 0.6,
    },
    Glass_Bells: {
      // Inharmonic ring: osc B a 3rd partial up (octave + fifth) for a metallic bell tone.
      oscAType: "sine", oscASemi: 0, oscADetune: 0, oscALevel: 0.55,
      oscBType: "sine", oscBSemi: 19, oscBDetune: 6, oscBLevel: 0.45,
      subLevel: 0, noiseLevel: 0,
      unisonVoices: 2, unisonDetune: 7,
      filterType: "lowpass", filterFreq: 9000, filterQ: 2, filterEnvAmt: 1.5, filterKeytrack: 0.6,
      filterAttack: 0.001, filterDecay: 0.5, filterSustain: 0.1, filterRelease: 1.4,
      attack: 0.001, decay: 1.6, sustain: 0, release: 1.8,
      glide: 0,
      lfo1Rate: 5, lfo1Sync: 0, lfo1Shape: "sine", lfo1Depth: 0, lfo1Dest: "filter",
      lfo2Rate: 5.5, lfo2Sync: 0, lfo2Shape: "sine", lfo2Depth: 0.04, lfo2Dest: "pitch",
      voiceLimit: 12,
      volume: 0.55,
    },
    Dream_Pad: {
      oscAType: "sawtooth", oscASemi: 0, oscADetune: 0, oscALevel: 0.5,
      oscBType: "triangle", oscBSemi: 0, oscBDetune: 10, oscBLevel: 0.4,
      subLevel: 0.2, noiseLevel: 0,
      unisonVoices: 2, unisonDetune: 14,
      filterType: "lowpass", filterFreq: 2400, filterQ: 1, filterEnvAmt: 0.5, filterKeytrack: 0.5,
      filterAttack: 1.5, filterDecay: 1.0, filterSustain: 0.6, filterRelease: 2.5,
      attack: 1.2, decay: 0.8, sustain: 0.8, release: 3.0,
      glide: 0,
      lfo1Rate: 0.25, lfo1Sync: 0, lfo1Shape: "sine", lfo1Depth: 0.12, lfo1Dest: "filter",
      lfo2Rate: 4, lfo2Sync: 0, lfo2Shape: "sine", lfo2Depth: 0.03, lfo2Dest: "pitch",
      voiceLimit: 16,
      volume: 0.45,
    },
    Acid_Stab: {
      oscAType: "sawtooth", oscASemi: 0, oscADetune: 0, oscALevel: 0.8,
      oscBType: "sawtooth", oscBSemi: 0, oscBDetune: 0, oscBLevel: 0,
      subLevel: 0, noiseLevel: 0,
      unisonVoices: 1, unisonDetune: 0,
      filterType: "lowpass", filterFreq: 800, filterQ: 12, filterEnvAmt: 3, filterKeytrack: 0.3,
      filterAttack: 0.005, filterDecay: 0.15, filterSustain: 0, filterRelease: 0.15,
      attack: 0.005, decay: 0.2, sustain: 0.2, release: 0.2,
      glide: 0.03,
      lfo1Rate: 5, lfo1Sync: 0, lfo1Shape: "sine", lfo1Depth: 0, lfo1Dest: "filter",
      lfo2Rate: 0.5, lfo2Sync: 0, lfo2Shape: "sine", lfo2Depth: 0, lfo2Dest: "pitch",
      voiceLimit: 6,
      volume: 0.6,
    },
    Sweep_Down: {
      oscAType: "sawtooth", oscASemi: 0, oscADetune: 0, oscALevel: 0.6,
      oscBType: "sawtooth", oscBSemi: 0, oscBDetune: 8, oscBLevel: 0.5,
      subLevel: 0.2, noiseLevel: 0,
      unisonVoices: 1, unisonDetune: 0,
      filterType: "lowpass", filterFreq: 6000, filterQ: 3, filterEnvAmt: -4, filterKeytrack: 0.2,
      filterAttack: 0.3, filterDecay: 0.6, filterSustain: 0, filterRelease: 0.5,
      attack: 0.02, decay: 0.4, sustain: 0.6, release: 0.5,
      glide: 0,
      lfo1Rate: 5, lfo1Sync: 0, lfo1Shape: "sine", lfo1Depth: 0, lfo1Dest: "filter",
      lfo2Rate: 0.5, lfo2Sync: 0, lfo2Shape: "sine", lfo2Depth: 0, lfo2Dest: "pitch",
      voiceLimit: 8,
      volume: 0.5,
    },
    Octave_Lead: {
      oscAType: "square", oscASemi: 0, oscADetune: 0, oscALevel: 0.6,
      oscBType: "square", oscBSemi: 12, oscBDetune: 0, oscBLevel: 0.4,
      subLevel: 0, noiseLevel: 0,
      unisonVoices: 1, unisonDetune: 0,
      filterType: "lowpass", filterFreq: 2800, filterQ: 4, filterEnvAmt: 1.5, filterKeytrack: 0.4,
      filterAttack: 0.005, filterDecay: 0.2, filterSustain: 0.4, filterRelease: 0.3,
      attack: 0.005, decay: 0.2, sustain: 0.6, release: 0.3,
      glide: 0.04,
      lfo1Rate: 5, lfo1Sync: 0, lfo1Shape: "sine", lfo1Depth: 0, lfo1Dest: "filter",
      lfo2Rate: 5.5, lfo2Sync: 0, lfo2Shape: "sine", lfo2Depth: 0.05, lfo2Dest: "pitch",
      voiceLimit: 8,
      volume: 0.5,
    },
    Dark_Synth: {
      oscAType: "sawtooth", oscASemi: 0, oscADetune: 0, oscALevel: 0.6,
      oscBType: "sawtooth", oscBSemi: -12, oscBDetune: 8, oscBLevel: 0.4,
      subLevel: 0.3, noiseLevel: 0,
      unisonVoices: 1, unisonDetune: 0,
      filterType: "lowpass", filterFreq: 1100, filterQ: 4, filterEnvAmt: 1.5, filterKeytrack: 0.3,
      filterAttack: 0.01, filterDecay: 0.25, filterSustain: 0.25, filterRelease: 0.3,
      attack: 0.01, decay: 0.3, sustain: 0.6, release: 0.35,
      glide: 0.02,
      lfo1Rate: 5, lfo1Sync: 0, lfo1Shape: "sine", lfo1Depth: 0, lfo1Dest: "filter",
      lfo2Rate: 0.5, lfo2Sync: 0, lfo2Shape: "sine", lfo2Depth: 0, lfo2Dest: "pitch",
      voiceLimit: 8,
      volume: 0.55,
    },
  };

  constructor(ctx, preset = "Default") {
    super(ctx, null);
    this._lastFreq = 0;
    this._activeVoices = [];
    this._bpm = 120;

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
}

// ---- Controls companion component ----

export class WebAudioSynthPolyControls extends WebAudioControlsBase {
  static SLIDER_DEFS = [
    { param: "oscASemi", label: "A Semi", min: -24, max: 24, step: 1, tooltip: "Oscillator A pitch offset in semitones." },
    { param: "oscADetune", label: "A Fine", min: -50, max: 50, step: 1, tooltip: "Oscillator A fine detune in cents." },
    { param: "oscALevel", label: "A Level", min: 0, max: 1, step: 0.01, tooltip: "Oscillator A mix level." },
    { param: "oscBSemi", label: "B Semi", min: -24, max: 24, step: 1, tooltip: "Oscillator B pitch offset in semitones." },
    { param: "oscBDetune", label: "B Fine", min: -50, max: 50, step: 1, tooltip: "Oscillator B fine detune in cents." },
    { param: "oscBLevel", label: "B Level", min: 0, max: 1, step: 0.01, tooltip: "Oscillator B mix level." },
    { param: "subLevel", label: "Sub", min: 0, max: 1, step: 0.01, tooltip: "Sub oscillator (sine, one octave below) level." },
    { param: "noiseLevel", label: "Noise", min: 0, max: 1, step: 0.01, tooltip: "White-noise level." },
    { param: "unisonVoices", label: "Unison", min: 1, max: 4, step: 1, tooltip: "Unison voices per oscillator." },
    { param: "unisonDetune", label: "U.Spread", min: 0, max: 50, step: 1, tooltip: "Unison detune spread in cents." },
    { param: "filterFreq", label: "Cutoff", min: 20, max: 16000, step: 1, scale: "log", tooltip: "Filter base cutoff." },
    { param: "filterQ", label: "Res", min: 0.1, max: 20, step: 0.1, tooltip: "Filter resonance." },
    { param: "filterEnvAmt", label: "Env Amt", min: -6, max: 6, step: 0.1, tooltip: "Filter envelope depth in octaves." },
    { param: "filterKeytrack", label: "Key Trk", min: 0, max: 1, step: 0.01, tooltip: "Filter cutoff tracking of note pitch." },
    { param: "filterAttack", label: "F.Atk", min: 0.001, max: 8, step: 0.001, tooltip: "Filter envelope attack." },
    { param: "filterDecay", label: "F.Dec", min: 0.01, max: 4, step: 0.01, tooltip: "Filter envelope decay." },
    { param: "filterSustain", label: "F.Sus", min: 0, max: 1, step: 0.01, tooltip: "Filter envelope sustain." },
    { param: "filterRelease", label: "F.Rel", min: 0.01, max: 8, step: 0.01, tooltip: "Filter envelope release." },
    { param: "attack", label: "Attack", min: 0.001, max: 8, step: 0.001, tooltip: "Amplitude attack." },
    { param: "decay", label: "Decay", min: 0.01, max: 4, step: 0.01, tooltip: "Amplitude decay." },
    { param: "sustain", label: "Sustain", min: 0, max: 1, step: 0.01, tooltip: "Amplitude sustain." },
    { param: "release", label: "Release", min: 0.01, max: 8, step: 0.01, tooltip: "Amplitude release." },
    { param: "glide", label: "Glide", min: 0, max: 2, step: 0.01, tooltip: "Portamento glide time." },
    { param: "lfo1Rate", label: "L1 Rate", min: 0.01, max: 20, step: 0.01, tooltip: "LFO 1 free rate (Hz). Used when Sync = Free." },
    { param: "lfo1Depth", label: "L1 Depth", min: 0, max: 1, step: 0.01, tooltip: "LFO 1 depth (0 = off)." },
    { param: "lfo2Rate", label: "L2 Rate", min: 0.01, max: 20, step: 0.01, tooltip: "LFO 2 free rate (Hz). Used when Sync = Free." },
    { param: "lfo2Depth", label: "L2 Depth", min: 0, max: 1, step: 0.01, tooltip: "LFO 2 depth (0 = off)." },
    { param: "octaveOffset", label: "Octave", min: -2, max: 2, step: 1, tooltip: "Shift all notes by octaves." },
    { param: "octaveJumpProb", label: "Oct Jump", min: 0, max: 1, step: 0.01, tooltip: "Chance of an octave jump per note." },
    { param: "voiceLimit", label: "V.Limit", min: 0, max: 16, step: 1, tooltip: "Max simultaneous voices (0 = unlimited)." },
    { param: "volume", label: "Vol", min: 0, max: 1, step: 0.01 },
  ];

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
    this._seq = null;
    this._rootMidi = 41;
    this._scaleName = "Minor";
    this._chordSize = 1;
    this._globalStep = 0;
    this._seqPosition = 0;
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
    aCtrl.appendChild(mkSlider({ param: "oscASemi", label: "Semi", min: -24, max: 24, step: 1 }));
    aCtrl.appendChild(mkSlider({ param: "oscADetune", label: "Fine", min: -50, max: 50, step: 1 }));
    aCtrl.appendChild(mkSlider({ param: "oscALevel", label: "Level", min: 0, max: 1, step: 0.01 }));
    controls.appendChild(aEl);

    // ---- Osc B ----
    const { el: bEl, controls: bCtrl } = createSection("Osc B");
    bCtrl.appendChild(this._select("Wave", "oscBType", WAVES));
    bCtrl.appendChild(mkSlider({ param: "oscBSemi", label: "Semi", min: -24, max: 24, step: 1 }));
    bCtrl.appendChild(mkSlider({ param: "oscBDetune", label: "Fine", min: -50, max: 50, step: 1 }));
    bCtrl.appendChild(mkSlider({ param: "oscBLevel", label: "Level", min: 0, max: 1, step: 0.01 }));
    controls.appendChild(bEl);

    // ---- Mix ----
    const { el: mixEl, controls: mixCtrl } = createSection("Mix");
    mixCtrl.appendChild(mkSlider({ param: "subLevel", label: "Sub", min: 0, max: 1, step: 0.01 }));
    mixCtrl.appendChild(mkSlider({ param: "noiseLevel", label: "Noise", min: 0, max: 1, step: 0.01 }));
    mixCtrl.appendChild(mkSlider({ param: "unisonVoices", label: "Unison", min: 1, max: 4, step: 1 }));
    mixCtrl.appendChild(mkSlider({ param: "unisonDetune", label: "Spread", min: 0, max: 50, step: 1 }));
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
    fCtrl.appendChild(mkSlider({ param: "filterFreq", label: "Cutoff", min: 20, max: 16000, step: 1, scale: "log" }));
    fCtrl.appendChild(mkSlider({ param: "filterQ", label: "Res", min: 0.1, max: 20, step: 0.1 }));
    fCtrl.appendChild(mkSlider({ param: "filterEnvAmt", label: "Env Amt", min: -6, max: 6, step: 0.1 }));
    fCtrl.appendChild(mkSlider({ param: "filterKeytrack", label: "Key Trk", min: 0, max: 1, step: 0.01 }));
    controls.appendChild(fEl);

    // ---- Filter Envelope ----
    const { el: feEl, controls: feCtrl } = createSection("Filter Env");
    feCtrl.appendChild(mkSlider({ param: "filterAttack", label: "F.Atk", min: 0.001, max: 8, step: 0.001 }));
    feCtrl.appendChild(mkSlider({ param: "filterDecay", label: "F.Dec", min: 0.01, max: 4, step: 0.01 }));
    feCtrl.appendChild(mkSlider({ param: "filterSustain", label: "F.Sus", min: 0, max: 1, step: 0.01 }));
    feCtrl.appendChild(mkSlider({ param: "filterRelease", label: "F.Rel", min: 0.01, max: 8, step: 0.01 }));
    controls.appendChild(feEl);

    // ---- Amp Envelope ----
    const { el: envEl, controls: envCtrl } = createSection("Envelope");
    envCtrl.appendChild(mkSlider({ param: "attack", label: "Attack", min: 0.001, max: 8, step: 0.001 }));
    envCtrl.appendChild(mkSlider({ param: "decay", label: "Decay", min: 0.01, max: 4, step: 0.01 }));
    envCtrl.appendChild(mkSlider({ param: "sustain", label: "Sustain", min: 0, max: 1, step: 0.01 }));
    envCtrl.appendChild(mkSlider({ param: "release", label: "Release", min: 0.01, max: 8, step: 0.01 }));
    envCtrl.appendChild(mkSlider({ param: "glide", label: "Glide", min: 0, max: 2, step: 0.01 }));
    controls.appendChild(envEl);

    // ---- LFO 1 & 2 ----
    for (const n of [1, 2]) {
      const { el, controls: lc } = createSection(`LFO ${n}`);
      lc.appendChild(this._select("Sync", `lfo${n}Sync`, SYNC, { parse: parseFloat }));
      lc.appendChild(mkSlider({ param: `lfo${n}Rate`, label: "Rate", min: 0.01, max: 20, step: 0.01 }));
      lc.appendChild(mkSlider({ param: `lfo${n}Depth`, label: "Depth", min: 0, max: 1, step: 0.01 }));
      lc.appendChild(this._select("Shape", `lfo${n}Shape`, WAVES));
      lc.appendChild(this._select("Dest", `lfo${n}Dest`, DESTS));
      controls.appendChild(el);
    }

    // ---- Voice ----
    const { el: vEl, controls: vCtrl } = createSection("Voice");
    vCtrl.appendChild(mkSlider({ param: "octaveOffset", label: "Octave", min: -2, max: 2, step: 1 }));
    vCtrl.appendChild(mkSlider({ param: "octaveJumpProb", label: "Jump", min: 0, max: 1, step: 0.01 }));
    vCtrl.appendChild(mkSlider({ param: "voiceLimit", label: "V.Limit", min: 0, max: 16, step: 1 }));
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
      this._emitChange();
    });
    chordWrap.appendChild(this._chordSizeSelect);
    seqCtrl.appendChild(chordWrap);

    this._seq = document.createElement("wam-step-seq");
    const noteOpts = scaleNoteOptions(this._rootMidi, this._scaleName, 24, 84);
    this._seq.init({
      steps: WebAudioSynthPolyControls.DEFAULT_PATTERN(),
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

    const patternParams = this._seq?.getPatternParams() ?? {};
    const playEvery = patternParams.playEvery ?? 1;
    const rotationOffset = patternParams.rotationOffset ?? 0;
    const rotationIntervalBars = patternParams.rotationIntervalBars ?? 1;

    if (this._seqPosition > 0 && this._seqPosition % 16 === 0 && rotationOffset > 0) {
      const localBar = this._seqPosition / 16;
      if (localBar % rotationIntervalBars === 0) this._seq.rotate(rotationOffset);
    }

    const currentBar = Math.floor(this._globalStep / 16);
    if (currentBar % playEvery !== 0) {
      this._globalStep++;
      return;
    }

    const stepsToAdvance = multiplier === 2 ? 2 : 1;
    const subStepDur = stepDurationSec / stepsToAdvance;
    let stepFired = false;
    for (let si = 0; si < stepsToAdvance; si++) {
      const subTime = time + si * subStepDur;
      const stepIndex = this._seqPosition % 16;
      const s = this._seq.steps[stepIndex];

      if (s?.active && Math.random() < (s.probability ?? 1)) {
        if (!s.conditions || s.conditions === "off" || this._meetsCondition(s.conditions, currentBar)) {
          stepFired = true;
          const chord = this._chordSize === 1 ? s.note : buildChordFromScale(s.note, this._scaleName, this._chordSize);
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

      this._seqPosition++;
    }

    if (this._jamPending && !stepFired) this._triggerJam(time, stepDurationSec);
    this._jamPending = false;
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
    if (this._seq) this._seq.steps = newSteps;
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
    obj.steps = this._seq?.steps ?? [];
    obj.chordSize = this._chordSize;
  }

  _restoreExtra(obj) {
    if (obj.chordSize != null) {
      this._chordSize = obj.chordSize;
      if (this._chordSizeSelect) this._chordSizeSelect.value = obj.chordSize;
    }
    if (obj.steps && this._seq) this._seq.steps = obj.steps;
  }
}

customElements.define("wam-synth-poly-controls", WebAudioSynthPolyControls);
