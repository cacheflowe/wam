import WebAudioSynthMono, { WebAudioSynthMonoControls } from "../web-audio/instruments/web-audio-synth-mono.js";
import WebAudioSynthPad, { WebAudioSynthPadControls } from "../web-audio/instruments/web-audio-synth-pad.js";
import WebAudioSynthFM, { WebAudioSynthFMControls } from "../web-audio/instruments/web-audio-synth-fm.js";
import WebAudioPercKick, { WebAudioPercKickControls } from "../web-audio/instruments/web-audio-perc-kick.js";
import WebAudioPercHihat, { WebAudioPercHihatControls } from "../web-audio/instruments/web-audio-perc-hihat.js";
import WebAudioFxReverb from "../web-audio/fx/web-audio-fx-reverb.js";
import WebAudioFxDelay from "../web-audio/fx/web-audio-fx-delay.js";
import "../web-audio/web-audio-slider.js";
import "../web-audio/fx/web-audio-fx-unit.js";
import "../web-audio/web-audio-waveform.js";
import "../web-audio/web-audio-plant-visualizer.js";
import "../web-audio/web-audio-sequence-grid.js";
import WebAudioSequencer from "../web-audio/web-audio-sequencer.js";
import { SCALES_ORDERED as SCALES, buildChordFromScale, LEAD_OSC_TYPES } from "../web-audio/web-audio-scales.js";

const ROOT_MIDI = 48; // C3

// ---------------------------------------------------------------------------
// Plant presets — modeled on real archetypes
// ---------------------------------------------------------------------------

const PLANT_PRESETS = {
  Cactus:    { dryness: 9, size: 120, branching: 2, physicalTexture: 0.0 },
  Seedling:  { dryness: 4, size: 90,  branching: 3, physicalTexture: 0.4 },
  Fern:      { dryness: 2, size: 200, branching: 9, physicalTexture: 0.7 },
  Shrub:     { dryness: 5, size: 320, branching: 6, physicalTexture: 0.5 },
  Oak:       { dryness: 2, size: 580, branching: 8, physicalTexture: 1.0 },
  Willow:    { dryness: 1, size: 700, branching: 7, physicalTexture: 0.9 },
  Unhealthy: { dryness: 9, size: 320, branching: 5, physicalTexture: 0.3 }, // papery
  Healthy:   { dryness: 2, size: 520, branching: 7, physicalTexture: 0.8 }, // waxy
};

// Normalize raw plant reading to 0–1 for all parameters
function normPlant(p) {
  return {
    dry: Math.max(0, Math.min(1, p.dryness / 10)),
    siz: Math.max(0, Math.min(1, (p.size - 50) / 850)),
    br:  Math.max(0, Math.min(1, p.branching / 10)),
    tex: Math.max(0, Math.min(1, p.physicalTexture)),
  };
}

// ---------------------------------------------------------------------------
// Plantasia — plant-sensor-driven generative composition
// ---------------------------------------------------------------------------

class WebAudioGenerativeMusicPlants extends HTMLElement {
  connectedCallback() {
    this._started = false;
    this._autoPilot = false;
    this._autoRaf = null;
    this._autoPresetName = null;
    this._autoTarget = { ...PLANT_PRESETS.Fern };
    this._autoNextChange = 0;

    // Current plant reading + master volume
    this._p = { dryness: 2, size: 200, branching: 9, physicalTexture: 0.7, volume: 0.25 }; // Fern default
    // Derived musical state — recomputed at start of each bar via _regenPatterns()
    this._ms = this._musicalState();

    this._beatLeds = [];
    this._sliderRefs = {};
    this._fxUnit = null;
    this._waveform = null;
    this._visualizer = null;
    this._seqGrid = null;
    this._debugPanel = null;

    // Patterns stored as MIDI note numbers (null = rest)
    this._bassPattern = [];
    this._leadPattern = [];
    this._padPattern = [];
    this._kickPattern = [];
    this._hihatPattern = [];
    this._fmChordPattern = [];

    this.buildUI();
    this.addCSS();
  }

  disconnectedCallback() {
    if (this._autoRaf) cancelAnimationFrame(this._autoRaf);
    if (this._seq) this._seq.stop();
    if (this._ctx) this._ctx.close();
  }

  // ---- Plant → musical state derivation ----

  _musicalState() {
    const n = normPlant(this._p);
    const wet = 1 - n.dry;
    return {
      mood:       n.tex * 0.5 + wet * 0.5,           // smooth + wet = brighter mood
      excitement: n.br  * 0.5 + (1 - n.siz) * 0.5,   // complex + small = more energetic
      health:     wet   * 0.6 + n.tex * 0.4,          // wet + smooth = healthy
    };
  }

  // ---- Music theory helpers ----

  _scaleIndex() {
    return Math.min(SCALES.length - 1, Math.floor(this._ms.mood * SCALES.length));
  }
  _scaleName() {
    return SCALES[this._scaleIndex()][0];
  }
  _scaleIntervals() {
    return SCALES[this._scaleIndex()][1];
  }
  _bpm() {
    const n = normPlant(this._p);
    // Larger plants are slower and more stable
    return Math.round(110 - n.siz * 60); // 50–110 BPM
  }

  _notePool(rootMidi, octaves) {
    const intervals = this._scaleIntervals();
    const pool = [];
    for (let o = 0; o < octaves; o++) {
      for (const iv of intervals) {
        const m = rootMidi + o * 12 + iv;
        if (m >= 21 && m <= 108) pool.push(m);
      }
    }
    return pool;
  }

  // ---- Pattern builders ----

  _makeBassPattern() {
    const { excitement } = this._ms;
    const n = normPlant(this._p);
    const ivs = this._scaleIntervals();
    const root = ROOT_MIDI;
    const third = ROOT_MIDI + (ivs[1] ?? 2);
    const fifth = ROOT_MIDI + (ivs[4] ?? 7);
    const high = ROOT_MIDI + 12;
    const d = excitement;
    const spiky = 1 - n.tex; // 0=smooth, 1=spiky
    return [
      root,
      (d > 0.7 || spiky > 0.6) && Math.random() < (0.35 + spiky * 0.3) ? (Math.random() < 0.5 ? root : third) : null,
      d > 0.4 && Math.random() < (0.5 + spiky * 0.25) ? fifth : null,
      spiky > 0.4 && Math.random() < (d * 0.5 + spiky * 0.25) ? third : null,
      d > 0.1 ? (Math.random() < 0.6 ? fifth : root) : null,
      d > 0.4 && Math.random() < (0.35 + spiky * 0.3) ? high : null,
      d > 0.25 && Math.random() < (0.55 + spiky * 0.2) ? (Math.random() < 0.5 ? high : fifth) : null,
      spiky > 0.35 && Math.random() < (d * 0.4 + spiky * 0.2) ? fifth : null,
    ];
  }

  _makeLeadPattern() {
    const { mood, excitement, health } = this._ms;
    const n = normPlant(this._p);
    const pool = this._notePool(ROOT_MIDI + 12, 2);
    const d = excitement;
    const h = health;
    const tex = n.tex;
    // Spiky or unhealthy plants pull notes outside the strict scale
    const chromaPool =
      h < 0.4 || tex < 0.2
        ? [...pool, ...pool.map((m) => m + (Math.random() < 0.5 ? 1 : -1))].filter((m) => m >= 21 && m <= 108)
        : pool;
    const weights = [0.95, 0.15, 0.45, 0.25, 0.75, 0.2, 0.55, 0.65, 0.8, 0.2, 0.45, 0.3, 0.65, 0.35, 0.5, 0.4];
    const notes = new Array(16).fill(null);
    let prev = pool[0];
    for (let i = 0; i < 16; i++) {
      // Spiky plants (low tex) get denser, stabbier patterns
      const density = weights[i] * (0.15 + d * 0.65 + (1 - tex) * 0.3);
      if (Math.random() < density) {
        // Spiky = wider interval leaps; smooth = stepwise motion; high mood = broader range
        const maxInterval = tex < 0.3 ? 9 : d > 0.7 ? 8 : 4 + Math.round(mood * 3);
        const nearby = chromaPool.filter((m) => Math.abs(m - prev) <= maxInterval);
        const src = nearby.length >= 2 ? nearby : chromaPool;
        // High excitement: occasional leap to any note for surprise
        prev = Math.random() < d * 0.2
          ? chromaPool[Math.floor(Math.random() * chromaPool.length)]
          : src[Math.floor(Math.random() * src.length)];
        notes[i] = prev;
      }
    }
    if (d > 0.65 && Math.random() < 0.6) {
      const fillPool = this._notePool(ROOT_MIDI + 24, 1);
      for (let i = 12; i < 16; i++) {
        if (Math.random() < d * 0.7) notes[i] = fillPool[Math.floor(Math.random() * fillPool.length)];
      }
    }
    notes[0] = pool[0];
    return notes;
  }

  _makePadPattern() {
    const { mood, excitement } = this._ms;
    const ivs = this._scaleIntervals();
    const chord = [ROOT_MIDI + 12, ROOT_MIDI + 12 + (ivs[2] ?? 3), ROOT_MIDI + 12 + (ivs[4] ?? 7)];
    // Branching = richer chords (more extensions)
    const n = normPlant(this._p);
    if (n.br > 0.6 && ivs[6] != null) chord.push(ROOT_MIDI + 12 + ivs[6]);
    if (mood > 0.3 && mood < 0.7 && Math.random() < 0.35) chord.push(chord.shift());
    const pat = [chord, null, null, null, chord, null, null, null];
    if (excitement > 0.6 && Math.random() < 0.5) pat[6] = chord;
    if (excitement > 0.8 && Math.random() < 0.3) pat[2] = chord;
    return pat;
  }

  _makeKickPattern() {
    const { excitement } = this._ms;
    const d = excitement;
    if (d < 0.15) return [1, 0, 0, 0, 0, 0, 0, 0];
    if (d < 0.35) return [1, 0, 0, 0, 1, 0, 0, 0];
    if (d < 0.55) return [1, 0, 1, 0, 1, 0, 0, 0];
    if (d < 0.75) return [1, 0, 1, 0, 1, 0, 1, 0];
    return [1, 0, 1, Math.random() < 0.4 ? 1 : 0, 1, 0, 1, Math.random() < 0.35 ? 1 : 0];
  }

  _makeHihatPattern() {
    const { excitement } = this._ms;
    const n = normPlant(this._p);
    const d = excitement;
    const br = n.br;
    return new Array(16).fill(0).map((_, i) => {
      const isDownbeat = i % 4 === 0;
      const isOffbeat  = i % 2 === 1;
      const base = isDownbeat ? d * 0.85 : isOffbeat ? d * 0.45 : d * 0.6;
      const brBonus = isOffbeat ? br * 0.4 : 0; // branching = more offbeat hits
      return Math.random() < base + brBonus ? 1 : 0;
    });
  }

  _makeFmChordPattern() {
    const { excitement, mood } = this._ms;
    const n = normPlant(this._p);
    const chordRoot = ROOT_MIDI + 24;
    // Branching drives chord richness
    const voiceCount = 2 + Math.round(n.br * 2); // 2–4 voices
    const chord = buildChordFromScale(chordRoot, this._scaleName(), voiceCount);
    const pat = [chord, null, null, null, chord, null, null, null];
    if (excitement > 0.5 && Math.random() < 0.4) pat[6] = chord;
    if (excitement > 0.7 && Math.random() < 0.3) pat[2] = chord;
    return pat;
  }

  _regenPatterns() {
    this._ms = this._musicalState();
    this._bassPattern = this._makeBassPattern();
    this._leadPattern = this._makeLeadPattern();
    this._padPattern = this._makePadPattern();
    this._kickPattern = this._makeKickPattern();
    this._hihatPattern = this._makeHihatPattern();
    this._fmChordPattern = this._makeFmChordPattern();
    this._seq.bpm = this._bpm();
    if (this._fxUnit) this._fxUnit.bpm = this._bpm();
    this._updateInstrumentCharacter();
    this._updateSeqGrid();
    this._updateStatus();
  }

  _updateSeqGrid() {
    if (!this._seqGrid) return;
    // Expand 8-step patterns to 16-step grid (odd columns always off)
    const expand = (pat8) =>
      Array.from({ length: 16 }, (_, i) =>
        i % 2 === 0 ? (pat8[i >> 1] != null && pat8[i >> 1] !== 0) : false,
      );
    this._seqGrid.setPatterns([
      { label: "K", steps: expand(this._kickPattern) },
      { label: "H", steps: this._hihatPattern.map(Boolean) },
      { label: "B", steps: expand(this._bassPattern) },
      { label: "L", steps: this._leadPattern.map((n) => n != null) },
      { label: "P", steps: expand(this._padPattern) },
      { label: "F", steps: expand(this._fmChordPattern) },
    ]);
  }

  // ---- Audio graph ----

  _startAudio() {
    this._ctx = new AudioContext();

    this._master = this._ctx.createGain();
    this._master.gain.value = this._p.volume;
    this._master.connect(this._ctx.destination);

    // Master low-pass filter — dryness + physicalTexture control openness
    this._masterFilter = this._ctx.createBiquadFilter();
    this._masterFilter.type = "lowpass";
    this._masterFilter.frequency.value = 8000;
    this._masterFilter.connect(this._master);

    // ---- Per-instrument FX chains ----

    // Lead: delay → reverb → masterFilter
    this._leadReverb = new WebAudioFxReverb(this._ctx, { decay: 4, wet: 0.5 });
    this._leadReverb.connect(this._masterFilter);
    this._leadDelay = new WebAudioFxDelay(this._ctx, { wet: 0.15, feedback: 0.25 });
    this._leadDelay.connect(this._leadReverb.input);

    // Pad: reverb → masterFilter
    this._padReverb = new WebAudioFxReverb(this._ctx, { decay: 5, wet: 0.6 });
    this._padReverb.connect(this._masterFilter);

    // Bass: delay → masterFilter
    this._bassDelay = new WebAudioFxDelay(this._ctx, { wet: 0.1, feedback: 0.2 });
    this._bassDelay.connect(this._masterFilter);

    // FM: reverb → masterFilter
    this._fmReverb = new WebAudioFxReverb(this._ctx, { decay: 3, wet: 0.4 });
    this._fmReverb.connect(this._masterFilter);

    // ---- Instruments ----

    this._bass = new WebAudioSynthMono(this._ctx, "Soft_Bass");
    this._bass.connect(this._bassDelay.input);

    this._lead = new WebAudioSynthMono(this._ctx, "Airy_Lead");
    this._lead.oscType = LEAD_OSC_TYPES[this._scaleIndex()];
    this._lead.connect(this._leadDelay.input);

    this._pad = new WebAudioSynthPad(this._ctx);
    this._pad.volume = 0.5;
    this._pad.connect(this._padReverb.input);

    this._kick = new WebAudioPercKick(this._ctx);
    this._kick.volume = 0.9;
    this._kick.connect(this._masterFilter);

    this._hihat = new WebAudioPercHihat(this._ctx);
    this._hihat.volume = 0.4;
    this._hihat.connect(this._masterFilter);

    this._fm = new WebAudioSynthFM(this._ctx);
    this._fm.connect(this._fmReverb.input);

    // ---- Master FX unit (sits between masterFilter and master gain) ----
    if (this._fxUnit) {
      this._fxUnit.init(this._ctx, { title: "Master FX", bpm: this._bpm(), reverbWet: 0, delayMix: 0 });
      this._masterFilter.disconnect();
      this._masterFilter.connect(this._fxUnit.input);
      this._fxUnit.connect(this._master);
    }

    // ---- Per-instrument analysers for the mandala visualizer ----
    const mkAnalyser = (fftSize = 256) => {
      const a = this._ctx.createAnalyser();
      a.fftSize = fftSize;
      return a;
    };

    const kickAnalyser  = mkAnalyser(32);
    const bassAnalyser  = mkAnalyser(64);
    const padAnalyser   = mkAnalyser(256);
    const leadAnalyser  = mkAnalyser(128);
    const fmAnalyser    = mkAnalyser(128);
    const hihatAnalyser = mkAnalyser(512);

    // Tap analysers in parallel (instrument → analyser + normal route)
    this._kick.connect(kickAnalyser);
    this._bass.connect(bassAnalyser);
    this._pad.connect(padAnalyser);
    this._lead.connect(leadAnalyser);
    this._fm.connect(fmAnalyser);
    this._hihat.connect(hihatAnalyser);

    // ---- Wire visualizer ----
    if (this._visualizer) {
      this._visualizer.init([
        { analyser: kickAnalyser,  color: "#ffffff", baseRadius: 115, radiusScale: 55, bins: 4,  rotMult: 2.0, lineWidth: 2.5, alpha: 0.85 },
        { analyser: bassAnalyser,  color: "#4477ff", baseRadius: 90,  radiusScale: 50, bins: 16, rotMult: 1.0, lineWidth: 2,   alpha: 0.70 },
        { analyser: fmAnalyser,    color: "#cc44ff", baseRadius: 70,  radiusScale: 35, bins: 20, rotMult: 1.7, lineWidth: 1.5, alpha: 0.55 },
        { analyser: leadAnalyser,  color: "#00dd88", baseRadius: 52,  radiusScale: 30, bins: 24, rotMult: 1.3, lineWidth: 1.5, alpha: 0.60 },
        { analyser: padAnalyser,   color: "#ff8844", baseRadius: 35,  radiusScale: 22, bins: 32, rotMult: 0.7, lineWidth: 1,   alpha: 0.45 },
        { analyser: hihatAnalyser, color: "#ffee33", baseRadius: 18,  radiusScale: 16, bins: 48, rotMult: 3.1, lineWidth: 1,   alpha: 0.40 },
      ], { symmetry: 6 });
    }

    // ---- Master waveform ----
    if (this._waveform) {
      const masterAnalyser = this._ctx.createAnalyser();
      this._master.connect(masterAnalyser);
      this._waveform.init(masterAnalyser, "#9090ff");
    }

    // ---- Sequencer ----
    this._seq = new WebAudioSequencer(this._ctx, { bpm: this._bpm(), steps: 16, subdivision: 16 });

    this._seq.onStep((step, time) => {
      if (step === 0) {
        this._regenPatterns();
        const step8sec = this._seq.stepDurationSec() * 2;
        // Sync delay times to current BPM
        if (this._leadDelay && this._leadDelay.delayTime != null) this._leadDelay.delayTime = step8sec;
        if (this._bassDelay && this._bassDelay.delayTime != null) this._bassDelay.delayTime = step8sec;
        // FM preset + plant overrides
        if (this._fm) {
          const presetNames = Object.keys(WebAudioSynthFM.PRESETS);
          const idx = Math.min(presetNames.length - 1, Math.floor(this._ms.mood * presetNames.length));
          this._fm.applyPreset(presetNames[idx]);
          // Plant overrides on top of preset
          const fn = normPlant(this._p);
          this._fm.modIndex = Math.min(10, this._fm.modIndex * (0.6 + fn.br * 0.9));
          this._fm.modDecay  = 0.05 + (1 - fn.tex) * 0.08 + fn.tex * 0.8;
          // Envelope: cactus = instant snap; oak = slow bloom
          this._fm.attack  = fn.tex * 0.04;
          this._fm.decay   = 0.1 + fn.siz * 0.4 + fn.tex * 0.3;
          this._fm.sustain = Math.max(0.001, 0.2 + fn.tex * 0.5);
          this._fm.release = 0.1 + fn.tex * 0.8 + fn.siz * 0.2;
        }
      }

      const step16sec = this._seq.stepDurationSec();
      const step8sec = step16sec * 2;
      // physicalTexture drives staccato (0) vs legato (1) note durations
      const tex = normPlant(this._p).tex;

      // Advance sequence grid playhead
      const delayMs0 = Math.max(0, (time - this._ctx.currentTime) * 1000);
      setTimeout(() => this._seqGrid?.setStep(step), delayMs0);

      // Lead (16th notes)
      const leadNote = this._leadPattern[step];
      if (leadNote != null) {
        const dur = step16sec * (0.25 + tex * 1.75); // 0.25x → 2x step
        this._lead.trigger(leadNote, dur, 0.3 + this._ms.excitement * 0.5, time);
      }

      // Hihat (16th notes)
      if (this._hihatPattern[step]) {
        this._hihat.trigger(0.6 + this._ms.excitement * 0.35, time);
      }

      // 8th-note instruments
      if (step % 2 === 0) {
        const s8 = step >> 1;

        if (this._kickPattern[s8]) {
          this._kick.trigger(0.9, time);
          const delayMs = Math.max(0, (time - this._ctx.currentTime) * 1000);
          setTimeout(() => this._visualizer?.pulseBeat(), delayMs);
        }

        const bassNote = this._bassPattern[s8];
        if (bassNote != null) {
          const bassDur = step8sec * (0.4 + tex * 1.1);
          this._bass.trigger(bassNote, bassDur, 0.4 + this._ms.excitement * 0.45, time);
        }

        const chord = this._padPattern[s8];
        if (chord != null) {
          const padDur = step8sec * (2.0 + tex * 3.0); // smooth plants hold pads longer
          this._pad.trigger(chord, padDur, 0.2 + this._ms.mood * 0.3, time);
        }

        const fmChord = this._fmChordPattern[s8];
        if (fmChord != null && this._fm) {
          this._fm.trigger(fmChord, step8sec * 2, time);
        }

        const delayMs = Math.max(0, (time - this._ctx.currentTime) * 1000);
        setTimeout(() => this._flashBeat(s8), delayMs);
      }
    });

    this._buildDebugControls();
    this._started = true;
    this._regenPatterns();
    this._updateEffects();
    this._seq.start();
  }

  // ---- Instrument character — maps plant state to synth timbre ----

  _updateInstrumentCharacter() {
    if (!this._lead || !this._bass) return;
    const { mood, excitement, health } = this._ms;
    const n = normPlant(this._p);

    // Lead: osc type follows scale/mood; low dryness = lush detune
    this._lead.oscType = LEAD_OSC_TYPES[this._scaleIndex()];
    this._lead.detune = n.dry > 0.6 ? (n.dry - 0.6) * 25 * (Math.random() < 0.5 ? 1 : -1) : 0;
    this._lead.detune2 = n.dry > 0.6 ? (n.dry - 0.6) * 15 : 0;
    this._lead.filterFreq = 800 + mood * 5000 + excitement * 1500;
    this._lead.filterQ = 0.5 + (1 - mood) * 2.5;
    // Envelope: cactus = instant no-attack snap; oak = gentle ramp, longer sustain
    this._lead.attack  = n.tex * 0.03;
    this._lead.decay   = 0.04 + n.siz * 0.15 + n.tex * 0.2;
    this._lead.sustain = 0.3 + n.tex * 0.4;
    this._lead.release = 0.03 + n.tex * 0.35 + n.siz * 0.1;

    // Bass: dark mood = square + sub; bright = sawtooth; spiky = bright filter
    this._bass.oscType = mood < 0.35 ? "square" : "sawtooth";
    this._bass.subGain = (1 - mood) * 0.45;
    this._bass.detune2 = excitement * 6;
    this._bass.filterFreq = 300 + (1 - n.tex) * 900; // spiky=bright 1200Hz; smooth=warm 300Hz
    this._bass.filterQ = 3 + (1 - n.tex) * 7;         // spiky=more resonant ring
    // Envelope: cactus = punchy click; oak = slow sustained thud
    this._bass.attack  = n.tex * 0.02;
    this._bass.decay   = 0.05 + n.siz * 0.2 + n.tex * 0.25;
    this._bass.sustain = 0.2 + n.tex * 0.5;
    this._bass.release = 0.04 + n.tex * 0.4 + n.siz * 0.1;

    // Kick: large plant = boomy long decay; small/spiky = punchy tight hit
    if (this._kick) {
      this._kick.startFreq = 180 - n.tex * 80;   // spiky: 180 Hz punch; smooth: 100 Hz thud
      this._kick.sweepTime = 0.025 + n.tex * 0.1; // spiky: tight 25ms; smooth: slower 125ms
      this._kick.decay = 0.2 + n.siz * 0.7;       // small=short 0.2s; big=boomy 0.9s
    }

    // Hihat: spiky = bright & crisp; smooth = duller, longer tail
    if (this._hihat) {
      this._hihat.filterFreq = 3000 + (1 - n.tex) * 9000; // spiky: 12000 Hz; smooth: 3000 Hz
      this._hihat.decay = 0.03 + n.tex * 0.22;             // spiky: 30ms snap; smooth: 250ms wash
    }

    // Pad: smooth/wet = slow-blooming pads; spiky = quicker stab + faster release
    if (this._pad) {
      this._pad.attack  = 0.05 + n.tex * 1.5; // spiky: 50ms; smooth: 1.55s
      this._pad.release = 0.5  + n.tex * 3.0; // spiky: 0.5s; smooth: 3.5s
    }

    // Reflect all instrument param changes into the debug UI sliders
    this._syncDebugControls();
  }

  // ---- Effects — all values derived from plant readings ----

  _updateEffects() {
    if (!this._started) return;
    const { mood, excitement, health } = this._ms;
    const n = normPlant(this._p);
    const wet = 1 - n.dry;

    // Bass delay: branching + dryness drive rhythmic echoes (spiky = punchy echoes)
    this._bassDelay.wet = n.br * 0.2 + n.dry * 0.1;
    this._bassDelay.feedback = n.br * 0.3 + n.dry * 0.08;

    // Lead reverb: wetter plants get more spacious reverb; size = decay length
    this._leadReverb.wet = 0.1 + wet * 0.7;
    this._leadReverb.decay = 2 + n.siz * 4; // 2–6 s
    // Lead delay: dry/spiky plants get rhythmic stab echoes; excitement drives feedback
    this._leadDelay.wet = excitement * 0.25 + n.dry * 0.2;
    this._leadDelay.feedback = excitement * 0.3 + n.br * 0.15;

    // Pad: wetter + bigger = deeper wash
    this._padReverb.wet = Math.min(0.92, 0.3 + wet * 0.5 + n.siz * 0.15);
    this._padReverb.decay = 3 + n.siz * 5; // 3–8 s

    // FM reverb: branching complexity drives brightness
    this._fmReverb.wet = 0.2 + n.br * 0.3;

    // Master filter: spiky/dry (low tex) = bright open; smooth (high tex) = warmer
    const cutoff = (1 - n.tex) * 0.55 + n.br * 0.45;
    this._masterFilter.frequency.value = 200 + Math.pow(cutoff, 2) * 14800;

    this._updateInstrumentCharacter();
    this._updateStatus();
  }

  _updateStatus() {
    if (!this._statusEl) return;
    const n = normPlant(this._p);
    const wetPct = Math.round((1 - n.dry) * 100);
    this._statusEl.textContent = `${this._scaleName()} · ${this._bpm()} BPM · ${wetPct}% wet`;
  }

  _flashBeat(step) {
    this._beatLeds.forEach((led, i) => led.classList.toggle("gm-led-on", i === step));
  }

  // ---- Transport ----

  _toggle() {
    if (!this._started) {
      this._playBtn.textContent = "Loading…";
      this._playBtn.disabled = true;
      this._startAudio();
      this._playBtn.textContent = "◼ Stop";
      this._playBtn.disabled = false;
    } else if (this._seq.running) {
      this._seq.stop();
      this._flashBeat(-1);
      this._playBtn.textContent = "▶ Start";
    } else {
      this._seq.start();
      this._playBtn.textContent = "◼ Stop";
    }
  }

  // ---- Auto-pilot — morphs between plant presets ----

  _toggleAutoPilot() {
    this._autoPilot = !this._autoPilot;
    this._autoBtn.classList.toggle("gm-auto-active", this._autoPilot);
    this._autoBtn.textContent = this._autoPilot ? "◉ Auto" : "○ Auto";
    if (this._autoPilot) {
      this._pickNewAutoTarget();
      this._tickAutoPilot();
    } else {
      if (this._autoRaf) cancelAnimationFrame(this._autoRaf);
      this._autoRaf = null;
    }
  }

  _pickNewAutoTarget() {
    const names = Object.keys(PLANT_PRESETS).filter((n) => n !== this._autoPresetName);
    this._autoPresetName = names[Math.floor(Math.random() * names.length)];
    this._autoTarget = { ...PLANT_PRESETS[this._autoPresetName] };
    // Schedule next forced change in 20–40 s
    this._autoNextChange = performance.now() + 20000 + Math.random() * 20000;
    // Update preset buttons to show current target
    this._syncPresetButtons(this._autoPresetName);
  }

  _tickAutoPilot() {
    if (!this._autoPilot) return;

    // Exponential approach toward target (scale-invariant convergence ~30s)
    const speed = 0.003;
    for (const key of ["dryness", "size", "branching", "physicalTexture"]) {
      const diff = this._autoTarget[key] - this._p[key];
      this._p[key] += diff * speed;
      if (this._sliderRefs[key]) this._sliderRefs[key].value = this._p[key];
    }

    // Pick a new target on schedule
    if (performance.now() >= this._autoNextChange) {
      this._pickNewAutoTarget();
    }

    if (this._started) this._updateEffects();

    this._autoRaf = requestAnimationFrame(() => this._tickAutoPilot());
  }

  // ---- Public API ----

  /**
   * Feed a live plant sensor reading to drive the music.
   * @param {{ dryness?: number, size?: number, branching?: number, physicalTexture?: number }} reading
   * @param {{ animate?: boolean }} [opts]  animate=true morphs slowly; animate=false snaps
   */
  applyReading(reading, { animate = true } = {}) {
    const keys = ["dryness", "size", "branching", "physicalTexture"];
    if (animate) {
      // Set as new auto-pilot target and start morphing
      for (const key of keys) {
        if (reading[key] != null) this._autoTarget[key] = reading[key];
      }
      this._autoNextChange = performance.now() + 30000;
      if (!this._autoPilot) {
        this._autoPilot = true;
        this._autoBtn.classList.add("gm-auto-active");
        this._autoBtn.textContent = "◉ Auto";
        this._tickAutoPilot();
      }
    } else {
      for (const key of keys) {
        if (reading[key] != null) {
          this._p[key] = reading[key];
          if (this._sliderRefs[key]) this._sliderRefs[key].value = reading[key];
        }
      }
      if (this._started) this._updateEffects();
    }
  }

  // ---- UI ----

  _makeEl(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text) el.textContent = text;
    return el;
  }

  // ---- Column wrapper helper (mobile-collapsible, desktop-always-open) ----

  _makeColWrap(title, mobileCollapsed = false) {
    const root = this._makeEl("div", "gm-col");
    if (mobileCollapsed) root.setAttribute("data-collapsed", "");
    const header = this._makeEl("div", "gm-col-header");
    const chevron = this._makeEl("span", "gm-col-chevron", "▾");
    header.appendChild(chevron);
    header.appendChild(this._makeEl("span", null, title));
    header.addEventListener("click", () => root.toggleAttribute("data-collapsed"));
    root.appendChild(header);
    const body = this._makeEl("div", "gm-col-body");
    root.appendChild(body);
    return { root, body };
  }

  buildUI() {
    const layout = this._makeEl("div", "gm-layout");
    this.appendChild(layout);

    // ---- Three columns ----
    const col1 = this._makeColWrap("Controls", false);
    layout.appendChild(col1.root);
    const c1 = col1.body;

    const col2 = this._makeColWrap("Instruments", true);
    layout.appendChild(col2.root);
    this._debugPanel = col2.body;

    const col3 = this._makeColWrap("System Guide", true);
    layout.appendChild(col3.root);

    // ---- Column 1: main controls & visuals ----
    const header = this._makeEl("div", "gm-header");
    c1.appendChild(header);

    this._playBtn = this._makeEl("button", "gm-play-btn", "▶ Start");
    this._playBtn.addEventListener("click", () => this._toggle());
    header.appendChild(this._playBtn);

    this._autoBtn = this._makeEl("button", "gm-auto-btn", "○ Auto");
    this._autoBtn.addEventListener("click", () => this._toggleAutoPilot());
    header.appendChild(this._autoBtn);

    this._statusEl = this._makeEl("div", "gm-status", "—");
    header.appendChild(this._statusEl);

    const ledRow = this._makeEl("div", "gm-led-row");
    c1.appendChild(ledRow);
    for (let i = 0; i < 8; i++) {
      const led = this._makeEl("div", `gm-led${[0, 4].includes(i) ? " gm-led-down" : ""}`);
      ledRow.appendChild(led);
      this._beatLeds.push(led);
    }

    const presetRow = this._makeEl("div", "gm-preset-row");
    c1.appendChild(presetRow);
    this._presetBtns = {};
    for (const name of Object.keys(PLANT_PRESETS)) {
      const btn = this._makeEl("button", "gm-preset-btn", name);
      btn.addEventListener("click", () => {
        this.applyReading({ ...PLANT_PRESETS[name] }, { animate: false });
        this._autoTarget = { ...PLANT_PRESETS[name] };
        this._autoPresetName = name;
        this._syncPresetButtons(name);
      });
      presetRow.appendChild(btn);
      this._presetBtns[name] = btn;
    }
    this._syncPresetButtons("Fern");

    const paramSec = this._makeSection("Plant Reading", c1);
    paramSec.appendChild(this._makeParamSlider("dryness",        "Dryness",   0,   10,  0.1,  this._p.dryness,        "Cactus — Rainforest"));
    paramSec.appendChild(this._makeParamSlider("size",           "Size",      50,  900, 10,   this._p.size,           "Seedling — Ancient Tree"));
    paramSec.appendChild(this._makeParamSlider("branching",      "Branching", 0,   10,  0.1,  this._p.branching,      "Simple — Complex"));
    paramSec.appendChild(this._makeParamSlider("physicalTexture","Texture",   0,   1,   0.01, this._p.physicalTexture,"Spiky — Smooth"));

    const volSec = this._makeSection("Volume", c1);
    volSec.appendChild(this._makeParamSlider("volume", "Master Vol", 0, 1, 0.01, this._p.volume));

    // Delegated slider listener — scoped to plant params only
    const plantParams = new Set(["dryness", "size", "branching", "physicalTexture", "volume"]);
    layout.addEventListener("slider-input", (e) => {
      const { param, value } = e.detail;
      if (!plantParams.has(param)) return;
      this._p[param] = value;
      if (param === "volume" && this._master) {
        this._master.gain.value = value;
      } else if (this._started) {
        this._ms = this._musicalState();
        this._updateEffects();
      }
    });

    this._seqGrid = document.createElement("web-audio-sequence-grid");
    c1.appendChild(this._seqGrid);

    this._visualizer = this._makeEl("web-audio-plant-visualizer", "gm-visualizer");
    c1.appendChild(this._visualizer);

    this._fxUnit = document.createElement("web-audio-fx-unit");
    c1.appendChild(this._fxUnit);
    this._waveform = document.createElement("web-audio-waveform");
    c1.appendChild(this._waveform);

    // ---- Column 3: system guide ----
    this._buildSystemGuideInto(col3.body);
  }

  // ---- Collapsible helper ----

  _makeCollapsible(title, defaultCollapsed = true) {
    const root = this._makeEl("div", "gm-collapsible");
    if (defaultCollapsed) root.setAttribute("data-collapsed", "");
    const header = this._makeEl("div", "gm-collapsible-header");
    const chevron = this._makeEl("span", "gm-collapsible-chevron", "▾");
    const titleSpan = this._makeEl("span", "gm-collapsible-title", title);
    header.appendChild(chevron);
    header.appendChild(titleSpan);
    header.addEventListener("click", () => root.toggleAttribute("data-collapsed"));
    root.appendChild(header);
    const body = this._makeEl("div", "gm-collapsible-body");
    root.appendChild(body);
    return { root, body };
  }

  // ---- Instrument debug panel — bound after _startAudio() ----

  _buildDebugControls() {
    if (!this._debugPanel) return;
    this._debugPanel.innerHTML = "";
    this._debugControls = [];

    const INSTRUMENTS = [
      { label: "Bass",     tag: "web-audio-synth-mono-controls",  inst: this._bass,  color: "#4477ff" },
      { label: "Lead",     tag: "web-audio-synth-mono-controls",  inst: this._lead,  color: "#00dd88" },
      { label: "Kick",     tag: "web-audio-perc-kick-controls",   inst: this._kick,  color: "#ffffff" },
      { label: "Hihat",    tag: "web-audio-perc-hihat-controls",  inst: this._hihat, color: "#ffee33" },
      { label: "Pad",      tag: "web-audio-synth-pad-controls",   inst: this._pad,   color: "#ff8844" },
      { label: "FM Chord", tag: "web-audio-synth-fm-controls",    inst: this._fm,    color: "#cc44ff" },
    ];

    for (const { label, tag, inst, color } of INSTRUMENTS) {
      const ctrl = document.createElement(tag);
      ctrl.bind(inst, this._ctx, { title: label, color, fx: { bpm: this._bpm() } });
      this._debugPanel.appendChild(ctrl);
      this._debugControls.push(ctrl);
    }
  }

  _syncDebugControls() {
    if (!this._debugControls) return;
    for (const ctrl of this._debugControls) {
      if (!ctrl._sliders || !ctrl._instrument) continue;
      for (const [param, slider] of Object.entries(ctrl._sliders)) {
        if (slider && param in ctrl._instrument) {
          slider.value = ctrl._instrument[param];
        }
      }
    }
  }

  // ---- System guide — static parameter documentation ----

  _buildSystemGuideInto(container) {
    container.innerHTML = /*html*/ `
      <div class="gm-guide">

        <div class="gm-guide-param">
          <div class="gm-guide-name">Dryness <span class="gm-guide-range">0–10</span></div>
          <div class="gm-guide-hint">Cactus (10) → Rainforest (0)</div>
          <p>How parched the plant is. High dryness creates a dry, rhythmic, bright character; low dryness creates a lush, reverb-heavy, atmospheric wash.</p>
          <ul>
            <li><b>Mood</b> (via <code>wet = 1 - dryness/10</code>): wet plants shift toward brighter, happier scales.</li>
            <li><b>Health</b>: wet + smooth = stable in-scale melody; drier plants risk chromatic drift in the lead.</li>
            <li><b>Lead</b>: dryness &gt; 0.6 adds random pitch detune and sub-oscillator detuning for a gritty, unstable tone.</li>
            <li><b>Lead delay</b>: dry plants get more rhythmic stab echoes (<code>dry × 0.2</code> added to delay mix, <code>dry × 0.35</code> to feedback).</li>
            <li><b>Bass delay</b>: dryness and branching together drive echo density — <code>wet = br×0.2 + dry×0.1</code>, <code>feedback = br×0.3 + dry×0.08</code>.</li>
            <li><b>Lead reverb</b>: wetter plants bloom into longer, wider reverb tails (<code>0.1 + wet×0.7</code>).</li>
          </ul>
        </div>

        <div class="gm-guide-param">
          <div class="gm-guide-name">Size <span class="gm-guide-range">50–900</span></div>
          <div class="gm-guide-hint">Seedling (50) → Ancient Tree (900)</div>
          <p>Physical mass of the plant. Larger plants are slower and more resonant; smaller ones are quicker and punchier.</p>
          <ul>
            <li><b>BPM</b>: <code>110 - siz × 60</code> → small=110 BPM, large=50 BPM.</li>
            <li><b>Excitement</b> (via <code>1 - siz</code>): small plants are inherently more energetic.</li>
            <li><b>Kick decay</b>: <code>0.2 + siz × 0.7</code> → small=0.2s punch, large=0.9s boom.</li>
            <li><b>Reverb decays</b>: lead reverb 2–6s, pad reverb 3–8s — both scale with size.</li>
            <li><b>Note envelopes</b>: size extends the decay and release of lead, bass, and FM. Large plants let notes ring longer; combined with texture for the full formula (see Texture).</li>
          </ul>
        </div>

        <div class="gm-guide-param">
          <div class="gm-guide-name">Branching <span class="gm-guide-range">0–10</span></div>
          <div class="gm-guide-hint">Single Stem (0) → Highly Complex (10)</div>
          <p>Structural complexity of the plant. More branches = more musical activity, harmonic density, and rhythmic variation.</p>
          <ul>
            <li><b>Excitement</b> (via <code>br × 0.5</code>): branching directly raises energy level alongside size.</li>
            <li><b>Hihat offbeats</b>: high branching adds probabilistic 16th-note offbeats (<code>br × 0.4</code> bonus per offbeat slot).</li>
            <li><b>Bass activity</b>: more branching increases the probability of extra notes (thirds, repeated roots, octave runs) in the bass pattern.</li>
            <li><b>Pad chords</b>: branching &gt; 0.6 adds a 7th chord extension when the scale supports it.</li>
            <li><b>FM modulation</b>: branching multiplies <code>modIndex</code> post-preset (<code>0.6 + br × 0.9</code>), making the FM timbre richer and more complex.</li>
            <li><b>Delays</b>: higher branching increases both bass delay wet/feedback and lead delay feedback.</li>
            <li><b>Master filter</b>: branching contributes 45% of filter openness (<code>(1-tex)×0.55 + br×0.45</code>).</li>
          </ul>
        </div>

        <div class="gm-guide-param">
          <div class="gm-guide-name">Texture <span class="gm-guide-range">0–1</span></div>
          <div class="gm-guide-hint">Spiky (0) → Smooth (1)</div>
          <p>The physical surface of the plant. Spiky plants are bright, staccato, and dense; smooth plants are warm, legato, and spacious. Texture is the primary driver of envelope shape across all melodic instruments.</p>
          <ul>
            <li><b>Note duration</b>: <code>step × (0.25 + tex × 1.75)</code> — spiky=25% of a step, smooth=200%.</li>
            <li><b>Lead density</b>: spiky adds up to 0.3 bonus probability to every note slot in the 16-step pattern.</li>
            <li><b>Lead intervals</b>: spiky allows wider melodic leaps (up to 9 semitones); smooth stays stepwise (4–7 semitones, modulated by mood).</li>
            <li><b>Chromatic drift</b>: spiky plants (tex &lt; 0.2) and unhealthy plants (health &lt; 0.4) can introduce notes ±1 semitone outside the scale.</li>
            <li><b>Bass pattern</b>: spiky drives busier bass lines — more thirds, repeated hits, and octave jumps alongside excitement-based activity.</li>
            <li><b>Attack</b>: lead <code>tex × 0.03s</code>, bass <code>tex × 0.02s</code>, FM <code>tex × 0.04s</code> — spiky instruments hit instantly (0ms); smooth ones ramp up gently.</li>
            <li><b>Decay</b>: lead <code>0.04 + siz×0.15 + tex×0.2</code>, bass <code>0.05 + siz×0.2 + tex×0.25</code>, FM <code>0.1 + siz×0.4 + tex×0.3</code> — texture and size both lengthen the note body.</li>
            <li><b>Sustain</b>: lead <code>0.3 + tex×0.4</code>, bass <code>0.2 + tex×0.5</code> — spiky notes die quickly after peak; smooth notes hold their level.</li>
            <li><b>Release</b>: lead <code>0.03 + tex×0.35 + siz×0.1</code>, bass <code>0.04 + tex×0.4 + siz×0.1</code>, FM <code>0.1 + tex×0.8 + siz×0.2</code> — smooth/large plants trail off slowly.</li>
            <li><b>Master filter</b>: spiky = bright open filter; smooth = warm filtered sound. Formula: <code>(1 - tex) × 0.55 + br × 0.45</code>.</li>
            <li><b>Bass filter</b>: spiky = 1200 Hz resonant ring (<code>Q up to 10</code>); smooth = 300 Hz warm low-pass (<code>Q=3</code>).</li>
            <li><b>Kick</b>: spiky = tight 25ms sweep from 180 Hz; smooth = slow 125ms sweep from 100 Hz.</li>
            <li><b>Hihat</b>: spiky = bright 12 kHz crisp snap (30ms decay); smooth = dark 3 kHz wash (250ms).</li>
            <li><b>Pad</b>: spiky = quick 50ms attack, 0.5s release; smooth = slow 1.5s bloom, 3.5s release.</li>
            <li><b>FM modDecay</b>: <code>0.05 + (1-tex)×0.08 + tex×0.8</code> — spiky = short clicking transient; smooth = long evolving timbre.</li>
          </ul>
        </div>

        <div class="gm-guide-param">
          <div class="gm-guide-name">Derived States</div>
          <div class="gm-guide-hint">Computed each bar from the four inputs above</div>
          <ul>
            <li><b>mood</b> = <code>tex × 0.5 + wet × 0.5</code> — 0=dark/minor, 1=bright/major. Selects scale, lead oscillator type, bass waveform (square vs sawtooth), sub-oscillator mix.</li>
            <li><b>excitement</b> = <code>br × 0.5 + (1 - siz) × 0.5</code> — 0=calm, 1=energetic. Drives note density in all patterns, kick pattern complexity, velocity, lead/bass delay amounts.</li>
            <li><b>health</b> = <code>wet × 0.6 + tex × 0.4</code> — 0=stressed, 1=thriving. Low health introduces chromatic notes (±1 semitone) into the lead melody, alongside spiky texture.</li>
          </ul>
        </div>

        <div class="gm-guide-param">
          <div class="gm-guide-name">Presets</div>
          <div class="gm-guide-hint">Reference values for named plant archetypes</div>
          <ul>
            <li><b>Cactus</b>: dry=9, size=120, branch=2, tex=0.0 — fastest BPM, spiky stabs, bright filter, no attack.</li>
            <li><b>Seedling</b>: dry=4, size=90, branch=3, tex=0.4 — fast, moderately bright, light reverb.</li>
            <li><b>Fern</b>: dry=2, size=200, branch=9, tex=0.7 — complex branching, lush reverb, wide chords.</li>
            <li><b>Shrub</b>: dry=5, size=320, branch=6, tex=0.5 — balanced midpoint across all params.</li>
            <li><b>Oak</b>: dry=2, size=580, branch=8, tex=1.0 — slow BPM, smooth envelopes, maximum attack ramp, deep resonance.</li>
            <li><b>Willow</b>: dry=1, size=700, branch=7, tex=0.9 — wettest, slowest, most atmospheric.</li>
            <li><b>Unhealthy</b>: dry=9, size=320, branch=5, tex=0.3 (papery) — dry and stressed; chromatic drift, bright but rough.</li>
            <li><b>Healthy</b>: dry=2, size=520, branch=7, tex=0.8 (waxy) — moist and thriving; smooth, lush, in-scale.</li>
          </ul>
        </div>

      </div>
    `;
  }

  _syncPresetButtons(activeName) {
    for (const [name, btn] of Object.entries(this._presetBtns)) {
      btn.classList.toggle("gm-preset-active", name === activeName);
    }
  }

  _makeSection(title, parent = this) {
    const sec = this._makeEl("div", "gm-section");
    sec.appendChild(this._makeEl("div", "gm-section-title", title));
    parent.appendChild(sec);
    return sec;
  }

  _makeParamSlider(param, label, min, max, step, initial, hint) {
    const slider = document.createElement("web-audio-slider");
    slider.setAttribute("param", param);
    slider.setAttribute("label", label);
    slider.setAttribute("min", min);
    slider.setAttribute("max", max);
    slider.setAttribute("step", step);
    if (hint) slider.setAttribute("hint", hint);
    slider.value = initial;
    this._sliderRefs[param] = slider;
    return slider;
  }

  addCSS() {
    const style = document.createElement("style");
    style.textContent = /*css*/ `
      generative-music-plants {
        display: block;
        font-family: monospace;
        background: #070d09;
        color: #ccc;
        padding: 22px;
        border-radius: 8px;
        max-width: 1400px;
        --slider-accent: #44cc88;
      }

      /* ---- 3-column layout ---- */
      generative-music-plants .gm-layout {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 16px;
        align-items: start;
      }

      generative-music-plants .gm-col-header {
        display: none; /* hidden on desktop — columns always open */
      }
      generative-music-plants .gm-col-body {
        display: block;
      }

      /* Mobile: single column with collapsible headers */
      @media (max-width: 900px) {
        generative-music-plants .gm-layout {
          grid-template-columns: 1fr;
        }
        generative-music-plants .gm-col-header {
          display: flex;
          align-items: center;
          gap: 7px;
          padding: 9px 0;
          cursor: pointer;
          user-select: none;
          font-size: 0.68em;
          color: #2a5038;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          border-bottom: 1px solid #1a2e1f;
          margin-bottom: 10px;
        }
        generative-music-plants .gm-col-header:hover { color: #44cc88; }
        generative-music-plants .gm-col-chevron {
          font-size: 0.9em;
          transition: transform 0.15s ease;
        }
        generative-music-plants .gm-col[data-collapsed] .gm-col-chevron {
          transform: rotate(-90deg);
        }
        generative-music-plants .gm-col[data-collapsed] .gm-col-body {
          display: none;
        }
      }

      generative-music-plants .gm-header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 16px;
      }

      generative-music-plants .gm-play-btn {
        padding: 9px 22px;
        font-family: monospace;
        font-size: 1em;
        background: #0a1a0e;
        color: #44cc88;
        border: 2px solid #44cc88;
        border-radius: 4px;
        cursor: pointer;
        white-space: nowrap;
        flex-shrink: 0;
      }
      generative-music-plants .gm-play-btn:hover:not(:disabled) { background: #44cc88; color: #000; }
      generative-music-plants .gm-play-btn:disabled { opacity: 0.5; cursor: default; }

      generative-music-plants .gm-auto-btn {
        padding: 9px 16px;
        font-family: monospace;
        font-size: 1em;
        background: #0a1a0e;
        color: #2a5038;
        border: 2px solid #1a3024;
        border-radius: 4px;
        cursor: pointer;
        white-space: nowrap;
        flex-shrink: 0;
        transition: color 0.2s, border-color 0.2s;
      }
      generative-music-plants .gm-auto-btn:hover { color: #66dd99; border-color: #2a5038; }
      generative-music-plants .gm-auto-btn.gm-auto-active {
        color: #66dd99;
        border-color: #66dd99;
        animation: gm-pulse 2.5s ease-in-out infinite;
      }
      @keyframes gm-pulse {
        0%, 100% { box-shadow: 0 0 0 0 #44cc8844; }
        50%       { box-shadow: 0 0 0 6px #44cc8800; }
      }

      generative-music-plants .gm-status {
        font-size: 0.72em;
        color: #2a5038;
        letter-spacing: 0.06em;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      generative-music-plants .gm-led-row {
        display: flex;
        gap: 7px;
        margin-bottom: 14px;
      }
      generative-music-plants .gm-led {
        flex: 1;
        height: 8px;
        border-radius: 2px;
        background: #0f1f14;
        transition: background 0.05s, box-shadow 0.05s;
      }
      generative-music-plants .gm-led.gm-led-down { background: #152218; }
      generative-music-plants .gm-led.gm-led-on   { background: #44cc88; box-shadow: 0 0 10px #44cc8888; }

      generative-music-plants .gm-preset-row {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        margin-bottom: 14px;
      }
      generative-music-plants .gm-preset-btn {
        font-family: monospace;
        font-size: 0.75em;
        padding: 5px 12px;
        background: #0f1f14;
        color: #3a6848;
        border: 1px solid #1e3828;
        border-radius: 3px;
        cursor: pointer;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        transition: color 0.15s, border-color 0.15s, background 0.15s;
      }
      generative-music-plants .gm-preset-btn:hover { color: #66dd99; border-color: #3a6848; }
      generative-music-plants .gm-preset-btn.gm-preset-active {
        color: #44cc88;
        border-color: #44cc88;
        background: #0c2216;
      }

      generative-music-plants .gm-section {
        display: flex;
        flex-direction: column;
        gap: 14px;
        background: #0c1a10;
        border: 1px solid #1a2e1f;
        border-radius: 6px;
        padding: 14px 16px;
        margin-bottom: 10px;
      }
      generative-music-plants .gm-section-title {
        font-size: 0.63em;
        color: #2a5038;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        margin-bottom: -2px;
      }

      generative-music-plants web-audio-sequence-grid {
        width: 100%;
        height: 88px;
        margin-bottom: 10px;
        border: 1px solid #0f1f14;
        border-radius: 4px;
        background: #000;
      }

      generative-music-plants .gm-visualizer {
        width: 100%;
        aspect-ratio: 1;
        background: #040805;
        border-radius: 4px;
        margin-bottom: 10px;
        border: 1px solid #0f1f14;
      }

      /* ---- Instrument collapsibles (inside col2) ---- */
      generative-music-plants .gm-collapsible {
        border: 1px solid #1a2e1f;
        border-radius: 6px;
        margin-bottom: 10px;
        overflow: hidden;
      }
      generative-music-plants .gm-collapsible-header {
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 9px 14px;
        cursor: pointer;
        user-select: none;
        background: #0c1a10;
        font-size: 0.68em;
        color: #2a5038;
        text-transform: uppercase;
        letter-spacing: 0.1em;
      }
      generative-music-plants .gm-collapsible-header:hover { color: #44cc88; }
      generative-music-plants .gm-collapsible-chevron {
        font-size: 0.9em;
        transition: transform 0.15s ease;
        flex-shrink: 0;
      }
      generative-music-plants .gm-collapsible[data-collapsed] .gm-collapsible-chevron {
        transform: rotate(-90deg);
      }
      generative-music-plants .gm-collapsible-body { padding: 0; }
      generative-music-plants .gm-collapsible[data-collapsed] .gm-collapsible-body {
        display: none;
      }

      generative-music-plants .gm-instrument-sub {
        border: none;
        border-radius: 0;
        border-bottom: 1px solid #111e14;
        margin-bottom: 0;
      }
      generative-music-plants .gm-instrument-sub:last-child { border-bottom: none; }
      generative-music-plants .gm-instrument-sub .gm-collapsible-header {
        background: #09140b;
        padding: 7px 14px;
      }
      generative-music-plants .gm-instrument-sub .gm-collapsible-body {
        background: #060e08;
      }

      /* ---- System guide ---- */
      generative-music-plants .gm-guide {
        padding: 4px 0;
        display: flex;
        flex-direction: column;
        gap: 18px;
      }
      generative-music-plants .gm-guide-param {
        border-left: 2px solid #1a3024;
        padding-left: 12px;
      }
      generative-music-plants .gm-guide-name {
        font-size: 0.78em;
        color: #44cc88;
        font-weight: bold;
        margin-bottom: 2px;
      }
      generative-music-plants .gm-guide-range {
        font-size: 0.85em;
        color: #2a5038;
        font-weight: normal;
        margin-left: 6px;
      }
      generative-music-plants .gm-guide-hint {
        font-size: 0.65em;
        color: #2a5038;
        letter-spacing: 0.06em;
        margin-bottom: 6px;
        text-transform: uppercase;
      }
      generative-music-plants .gm-guide p {
        font-size: 0.72em;
        color: #7a9e88;
        line-height: 1.5;
        margin: 0 0 6px 0;
      }
      generative-music-plants .gm-guide ul {
        margin: 0;
        padding-left: 16px;
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      generative-music-plants .gm-guide li {
        font-size: 0.68em;
        color: #4a7058;
        line-height: 1.45;
      }
      generative-music-plants .gm-guide li b { color: #6a9878; }
      generative-music-plants .gm-guide code {
        font-family: monospace;
        background: #0c1a10;
        padding: 1px 4px;
        border-radius: 2px;
        color: #44cc88;
        font-size: 0.95em;
      }
    `;
    document.head.appendChild(style);

  }
}

customElements.define("generative-music-plants", WebAudioGenerativeMusicPlants);
