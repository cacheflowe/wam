import WebAudioSynthMono from "../web-audio/instruments/wam-synth-mono.js";
import WebAudioSynthPad from "../web-audio/instruments/wam-synth-pad.js";
import WebAudioSynthFM from "../web-audio/instruments/wam-synth-fm.js";
import WebAudioFxReverb from "../web-audio/fx/wam-fx-reverb.js";
import WebAudioFxDelay from "../web-audio/fx/wam-fx-delay.js";
import WebAudioFxChorus from "../web-audio/fx/wam-fx-chorus.js";
import "../web-audio/ui/wam-slider.js";
import "../web-audio/fx/wam-fx-unit.js";
import "../web-audio/ui/wam-waveform.js";
import "../web-audio/ui/wam-plant-visualizer.js";
import WebAudioSequencer from "../web-audio/global/wam-sequencer.js";
import { SCALES_ORDERED as SCALES, buildChordFromScale } from "../web-audio/global/wam-scales.js";

const ROOT_MIDI = 36; // C2 — lower root for ambient

// ---------------------------------------------------------------------------
// Plant presets
// ---------------------------------------------------------------------------

const PLANT_PRESETS = {
  Cactus: { dryness: 9, size: 120, branching: 2, physicalTexture: 0.0 },
  Seedling: { dryness: 4, size: 90, branching: 3, physicalTexture: 0.4 },
  Fern: { dryness: 2, size: 200, branching: 9, physicalTexture: 0.7 },
  Shrub: { dryness: 5, size: 320, branching: 6, physicalTexture: 0.5 },
  Oak: { dryness: 2, size: 580, branching: 8, physicalTexture: 1.0 },
  Willow: { dryness: 1, size: 700, branching: 7, physicalTexture: 0.9 },
  Unhealthy: { dryness: 9, size: 320, branching: 5, physicalTexture: 0.3 },
  Healthy: { dryness: 2, size: 520, branching: 7, physicalTexture: 0.8 },
};

function normPlant(p) {
  return {
    dry: Math.max(0, Math.min(1, p.dryness / 10)),
    siz: Math.max(0, Math.min(1, (p.size - 50) / 850)),
    br: Math.max(0, Math.min(1, p.branching / 10)),
    tex: Math.max(0, Math.min(1, p.physicalTexture)),
  };
}

// ---------------------------------------------------------------------------
// AmbientDrone — sustained root chord with LFO filter sweep
// ---------------------------------------------------------------------------

class AmbientDrone {
  constructor(ctx) {
    this.ctx = ctx;
    this._activeOscs = [];

    // Output gain
    this._out = ctx.createGain();
    this._out.gain.value = 0.35;

    // Shared filter with LFO modulation
    this._filter = ctx.createBiquadFilter();
    this._filter.type = "lowpass";
    this._filter.frequency.value = 800;
    this._filter.Q.value = 1.2;
    this._filter.connect(this._out);

    // Oscillator mix bus
    this._mix = ctx.createGain();
    this._mix.connect(this._filter);

    // LFO — very slow oscillation on filter freq
    this._lfo = ctx.createOscillator();
    this._lfo.type = "sine";
    this._lfo.frequency.value = 0.04; // ~25s cycle
    this._lfoGain = ctx.createGain();
    this._lfoGain.gain.value = 250;
    this._lfo.connect(this._lfoGain);
    this._lfoGain.connect(this._filter.frequency);
    this._lfo.start();
  }

  /** Replace sustained oscillators with a new root chord, crossfading smoothly. */
  setRoot(midiRoot, scaleIntervals, branchNorm) {
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.05;

    // Fade out old oscillators
    this._activeOscs.forEach(({ osc, amp }) => {
      amp.gain.linearRampToValueAtTime(0, t + 4);
      osc.stop(t + 4.1);
      osc.addEventListener("ended", () => {
        try {
          amp.disconnect();
        } catch (_) {}
      });
    });

    // Voices: root + fifth + octave, optional major 7th when branching is high
    const fifth = scaleIntervals[4] ?? 7;
    const seventh = scaleIntervals[6] ?? 11;
    const voices = [
      { midi: midiRoot, gain: 0.45, type: "sine" },
      { midi: midiRoot + fifth, gain: 0.28, type: "triangle" },
      { midi: midiRoot + 12, gain: 0.18, type: "sine" },
    ];
    if (branchNorm > 0.6) {
      voices.push({ midi: midiRoot + seventh, gain: 0.12, type: "triangle" });
    }

    const newOscs = voices.map(({ midi, gain, type }) => {
      const freq = 440 * Math.pow(2, (midi - 69) / 12);
      const osc = ctx.createOscillator();
      const amp = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      osc.detune.value = (Math.random() - 0.5) * 5;
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(gain, t + 5); // 5s bloom
      osc.connect(amp);
      amp.connect(this._mix);
      osc.start(t);
      return { osc, amp };
    });

    this._activeOscs = newOscs;
  }

  setFilterFreq(freq) {
    this._filter.frequency.linearRampToValueAtTime(freq, this.ctx.currentTime + 3);
  }

  setLFO(rateHz, depthHz) {
    this._lfo.frequency.value = rateHz;
    this._lfoGain.gain.linearRampToValueAtTime(depthHz, this.ctx.currentTime + 2);
  }

  connect(node) {
    this._out.connect(node.input ?? node);
    return this;
  }

  stop() {
    const t = this.ctx.currentTime;
    this._activeOscs.forEach(({ osc, amp }) => {
      amp.gain.linearRampToValueAtTime(0, t + 2);
      osc.stop(t + 2.1);
    });
    this._lfo.stop();
  }
}

// ---------------------------------------------------------------------------
// Plantasia Ambient
// ---------------------------------------------------------------------------

class WebAudioGenerativeAmbient extends HTMLElement {
  connectedCallback() {
    this._started = false;
    this._autoPilot = false;
    this._autoRaf = null;
    this._autoPresetName = null;
    this._autoTarget = { ...PLANT_PRESETS.Willow };
    this._autoNextChange = 0;

    this._p = { dryness: 1, size: 700, branching: 7, physicalTexture: 0.9, volume: 0.3 }; // Willow default
    this._ms = this._musicalState();

    this._beatLeds = [];
    this._sliderRefs = {};
    this._fxUnit = null;
    this._waveform = null;
    this._visualizer = null;
    this._debugPanel = null;
    this._debugControls = [];

    // Trigger spacing trackers (monotonic step count)
    this._stepCount = 0;
    this._lastPad = -32;
    this._lastPadB = -16;
    this._lastMelody = -8;
    this._lastFM = -8;

    // Note pools (recomputed each bar)
    this._padChord = [];
    this._melPool = [];
    this._fmPool = [];

    this.buildUI();
    this.addCSS();

    this._onKeyDown = (e) => {
      if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
      if (e.repeat) return;
      if (e.key === " ") { e.preventDefault(); this._toggle(); }
    };
    document.addEventListener("keydown", this._onKeyDown);
  }

  disconnectedCallback() {
    if (this._onKeyDown) document.removeEventListener("keydown", this._onKeyDown);
    if (this._autoRaf) cancelAnimationFrame(this._autoRaf);
    if (this._seq) this._seq.stop();
    if (this._drone) this._drone.stop();
    if (this._ctx) this._ctx.close();
  }

  // ---- Plant → musical state ----

  _musicalState() {
    const n = normPlant(this._p);
    const wet = 1 - n.dry;
    return {
      mood: n.tex * 0.5 + wet * 0.5,
      excitement: n.br * 0.5 + (1 - n.siz) * 0.5,
      health: wet * 0.6 + n.tex * 0.4,
    };
  }

  _scaleIndex() {
    return Math.min(SCALES.length - 1, Math.floor(this._ms.mood * SCALES.length));
  }
  _scaleName() {
    return SCALES[this._scaleIndex()][0];
  }
  _scaleIntervals() {
    return SCALES[this._scaleIndex()][1];
  }

  // Slower BPM than rhythmic — large plants breathe slowly
  _bpm() {
    const n = normPlant(this._p);
    return Math.round(70 - n.siz * 40); // 30–70 BPM
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

  // ---- Audio graph ----

  _startAudio() {
    this._ctx = new AudioContext();

    this._master = this._ctx.createGain();
    this._master.gain.value = this._p.volume;
    this._master.connect(this._ctx.destination);

    // Gentle master LP on the whole mix
    this._masterFilter = this._ctx.createBiquadFilter();
    this._masterFilter.type = "lowpass";
    this._masterFilter.frequency.value = 9000;
    this._masterFilter.connect(this._master);

    // ---- Per-layer FX chains ----

    // Drone: long reverb
    this._droneReverb = new WebAudioFxReverb(this._ctx, { decay: 8, wet: 0.7 });
    this._droneReverb.connect(this._masterFilter);

    // Pad A: huge reverb + subtle chorus
    this._padReverb = new WebAudioFxReverb(this._ctx, { decay: 10, wet: 0.8 });
    this._padReverb.connect(this._masterFilter);
    this._padChorus = new WebAudioFxChorus(this._ctx, { wet: 0.5, voices: 3, rate: 0.15, depth: 8 });
    this._padChorus.connect(this._padReverb.input);

    // Pad B (secondary melody pad): medium reverb + delay
    this._padBReverb = new WebAudioFxReverb(this._ctx, { decay: 7, wet: 0.7 });
    this._padBReverb.connect(this._masterFilter);
    this._padBDelay = new WebAudioFxDelay(this._ctx, { wet: 0.25, feedback: 0.4 });
    this._padBDelay.connect(this._padBReverb.input);

    // Melody: reverb + delay
    this._melReverb = new WebAudioFxReverb(this._ctx, { decay: 5, wet: 0.6 });
    this._melReverb.connect(this._masterFilter);
    this._melDelay = new WebAudioFxDelay(this._ctx, { wet: 0.3, feedback: 0.35 });
    this._melDelay.connect(this._melReverb.input);

    // FM: reverb
    this._fmReverb = new WebAudioFxReverb(this._ctx, { decay: 6, wet: 0.65 });
    this._fmReverb.connect(this._masterFilter);

    // ---- Instruments ----

    this._drone = new AmbientDrone(this._ctx);
    this._drone.connect(this._droneReverb.input);

    this._pad = new WebAudioSynthPad(this._ctx, "Vapor");
    this._pad.volume = 0.55;

    this._padB = new WebAudioSynthMono(this._ctx, "Drone_Pad");

    this._melody = new WebAudioSynthMono(this._ctx, "Whisper");

    this._fm = new WebAudioSynthFM(this._ctx, "Ether");

    // ---- Master FX unit ----
    if (this._fxUnit) {
      this._fxUnit.init(this._ctx, { title: "Master FX", bpm: this._bpm(), reverbWet: 0, delayMix: 0, chorusWet: 0 });
      this._masterFilter.disconnect();
      this._masterFilter.connect(this._fxUnit.input);
      this._fxUnit.connect(this._master);
    }

    // ---- Per-instrument analysers for the mandala visualizer ----
    const mkA = (fftSize = 256) => {
      const a = this._ctx.createAnalyser();
      a.fftSize = fftSize;
      return a;
    };
    const droneA = mkA(64);
    const padA = mkA(256);
    const padBA = mkA(128);
    const melA = mkA(128);
    const fmA = mkA(128);

    this._drone.connect(droneA);
    this._pad.connect(padA);
    this._padB.connect(padBA);
    this._melody.connect(melA);
    this._fm.connect(fmA);

    if (this._visualizer) {
      this._visualizer.init(
        [
          {
            analyser: droneA,
            color: "#6688ff",
            baseRadius: 110,
            radiusScale: 60,
            bins: 8,
            rotMult: 0.4,
            lineWidth: 3.0,
            alpha: 0.8,
          },
          {
            analyser: padA,
            color: "#aa66ff",
            baseRadius: 85,
            radiusScale: 50,
            bins: 20,
            rotMult: 0.6,
            lineWidth: 2.0,
            alpha: 0.65,
          },
          {
            analyser: padBA,
            color: "#66aaff",
            baseRadius: 62,
            radiusScale: 38,
            bins: 24,
            rotMult: 0.9,
            lineWidth: 1.5,
            alpha: 0.55,
          },
          {
            analyser: melA,
            color: "#99eeff",
            baseRadius: 42,
            radiusScale: 28,
            bins: 28,
            rotMult: 1.2,
            lineWidth: 1.5,
            alpha: 0.55,
          },
          {
            analyser: fmA,
            color: "#eeccff",
            baseRadius: 24,
            radiusScale: 18,
            bins: 32,
            rotMult: 1.8,
            lineWidth: 1.0,
            alpha: 0.45,
          },
        ],
        { symmetry: 5 },
      );
    }

    if (this._waveform) {
      const masterA = this._ctx.createAnalyser();
      this._master.connect(masterA);
      this._waveform.init(masterA, "#8899ff");
    }

    // ---- Sequencer — quarter-note subdivision, 16 steps = 4 bars ----
    this._seq = new WebAudioSequencer(this._ctx, { bpm: this._bpm(), steps: 16, subdivision: 4 });
    this._seq.onStep((step, time) => this._onStep(step, time));

    this._buildDebugControls();
    this._started = true;
    this._regenAmbient(this._ctx.currentTime);
    this._seq.start();
  }

  // ---- Per-step handler ----

  _onStep(step, time) {
    if (step === 0) this._regenAmbient(time);

    const tick = this._stepCount++;
    const dur = this._seq.stepDurationSec();
    const n = normPlant(this._p);
    const { mood, excitement } = this._ms;

    // ---- Pad A — slow chord swells ----
    // Minimum spacing: 8 steps (2 bars) at low branch; 4 steps (1 bar) at high branch
    const padSpacing = Math.max(4, Math.round(10 - n.br * 6));
    if (tick - this._lastPad >= padSpacing) {
      const padProb = 0.5 + n.br * 0.4;
      if (Math.random() < padProb && this._padChord.length) {
        const noteDur = dur * (4 + n.tex * 10); // 4–14 beats
        const vel = 0.3 + mood * 0.35;
        this._pad.trigger(this._padChord, noteDur, vel, time);
        this._lastPad = tick;
      }
    }

    // ---- Pad B — secondary melodic texture ----
    const padBSpacing = Math.max(3, Math.round(7 - n.br * 4));
    if (tick - this._lastPadB >= padBSpacing) {
      const padBProb = 0.4 + n.br * 0.4 + (1 - n.dry) * 0.1;
      if (Math.random() < padBProb && this._melPool.length) {
        const note = this._melPool[Math.floor(Math.random() * this._melPool.length)];
        const noteDur = dur * (3 + n.tex * 8);
        this._padB.trigger(note, noteDur, 0.25 + mood * 0.25, time);
        this._lastPadB = tick;
      }
    }

    // ---- Melody — sparse slow notes ----
    const melSpacing = Math.max(2, Math.round(5 - excitement * 3));
    if (tick - this._lastMelody >= melSpacing) {
      const melProb = 0.15 + excitement * 0.25 + n.br * 0.15;
      if (Math.random() < melProb && this._melPool.length) {
        const note = this._melPool[Math.floor(Math.random() * this._melPool.length)];
        const noteDur = dur * (2 + n.tex * 6);
        this._melody.trigger(note, noteDur, 0.2 + excitement * 0.3, time);
        this._lastMelody = tick;
      }
    }

    // ---- FM bells / shimmer — mood-gated ----
    const fmSpacing = Math.max(2, Math.round(6 - mood * 4));
    if (tick - this._lastFM >= fmSpacing) {
      const fmProb = 0.1 + mood * 0.2 + n.br * 0.1;
      if (Math.random() < fmProb && this._fmPool.length) {
        const note = this._fmPool[Math.floor(Math.random() * this._fmPool.length)];
        const noteDur = dur * (1 + n.tex * 4);
        this._fm.trigger([note], noteDur, time);
        this._lastFM = tick;
      }
    }

    // Beat flash on quarter notes
    const delayMs = Math.max(0, (time - this._ctx.currentTime) * 1000);
    setTimeout(() => this._flashBeat(step), delayMs);
  }

  // ---- Regen every 4 bars ----

  _regenAmbient(time = 0) {
    this._ms = this._musicalState();
    const n = normPlant(this._p);
    const ivs = this._scaleIntervals();

    // Chord for Pad A: 3–5 voices depending on branching
    const voiceCount = 3 + Math.round(n.br * 2);
    this._padChord = buildChordFromScale(ROOT_MIDI + 24, this._scaleName(), voiceCount);

    // Melody pool: 2 octaves above root
    this._melPool = this._notePool(ROOT_MIDI + 24, 2);

    // FM pool: high register, sparse
    this._fmPool = this._notePool(ROOT_MIDI + 24, 2);

    // Drone: update root chord and LFO
    this._drone.setRoot(ROOT_MIDI, ivs, n.br);

    // Sync BPM
    this._seq.bpm = this._bpm();
    if (this._fxUnit) this._fxUnit.bpm = this._bpm();

    this._updateInstrumentCharacter();
    this._updateEffects();
    this._updateStatus();
  }

  // ---- Instrument character — plant → timbre ----

  _updateInstrumentCharacter() {
    if (!this._melody || !this._padB) return;
    const { health } = this._ms;

    // Melody: healthy = soft warm attacks; unhealthy = sharp thin stabs
    this._melody.attack = health * 0.8; // 0 (sharp) to 0.8 (soft)
    this._melody.decay = 0.2 + health * 0.8;
    this._melody.sustain = 0.1 + health * 0.6;
    this._melody.release = 0.2 + health * 2.5;
    this._melody.filterFreq = 300 + health * 3500; // thin when unhealthy
    this._melody.filterQ = 1 + (1 - health) * 6; // resonant/harsh when unhealthy

    // Pad B: healthy = warm sustained bloom; unhealthy = short brittle notes
    this._padB.attack = 0.05 + health * 2.5;
    this._padB.decay = 0.2 + health * 1.0;
    this._padB.sustain = 0.1 + health * 0.7;
    this._padB.release = 0.3 + health * 3.5;
    this._padB.filterFreq = 200 + health * 3000;
    this._padB.filterQ = 1 + (1 - health) * 5;

    // Pad A: healthy = lush slow bloom; unhealthy = thin and short
    this._pad.attack = 0.2 + health * 5.0;
    this._pad.release = 0.5 + health * 8.0;
    this._pad.filterFreq = 150 + health * 4000;
    this._pad.filterQ = 0.7 + (1 - health) * 3;

    // FM: healthy = gentle bells; unhealthy = metallic/harsh
    if (this._fm) {
      const fmPresets = Object.keys(WebAudioSynthFM.PRESETS);
      // Healthy → mellow presets (early); unhealthy → harsher presets (later)
      const fmIdx = Math.min(fmPresets.length - 1, Math.floor((1 - health) * fmPresets.length));
      this._fm.applyPreset(fmPresets[fmIdx]);
      // Unhealthy: higher mod index = more dissonant overtones
      this._fm.modIndex = Math.min(12, this._fm.modIndex * (0.3 + (1 - health) * 1.5));
      this._fm.attack = health * 0.1;
      this._fm.release = 0.3 + health * 3.0;
    }

    // Drone LFO: unhealthy = faster/wider sweep (anxious); healthy = slow/gentle
    this._drone.setLFO(
      0.01 + (1 - health) * 0.12, // unhealthy: faster 0.13Hz; healthy: slow 0.01Hz
      100 + (1 - health) * 900,   // unhealthy: wider sweep; healthy: subtle
    );

    this._syncDebugControls();
  }

  // ---- Effects ----

  _updateEffects() {
    if (!this._started) return;
    const { mood, excitement } = this._ms;
    const n = normPlant(this._p);
    const wet = 1 - n.dry;
    const health = wet * 0.6 + n.tex * 0.4; // 0 = dying, 1 = thriving

    // Drone: healthy = warm open filter; unhealthy = narrow, exposed
    const droneFilterHz = 100 + Math.pow(health, 2) * 4000;
    this._drone.setFilterFreq(droneFilterHz);

    // Delay times synced to quarter note duration
    const stepSec = 60 / this._bpm();
    if (this._melDelay?.delayTime != null) this._melDelay.delayTime = stepSec * 2;
    if (this._padBDelay?.delayTime != null) this._padBDelay.delayTime = stepSec * 3;

    // Reverb: healthy plants bloom in deep reverb; dry plants are exposed and thin
    this._droneReverb.wet = 0.2 + health * 0.7;
    this._droneReverb.decay = 3 + health * 8;
    this._padReverb.wet = 0.2 + health * 0.7;
    this._padReverb.decay = 3 + health * 12;
    this._padBReverb.wet = 0.15 + health * 0.6;
    this._padBReverb.decay = 2 + health * 7;
    this._melReverb.wet = 0.1 + health * 0.6;
    this._melReverb.decay = 2 + health * 6;
    this._fmReverb.wet = 0.15 + health * 0.55;
    this._fmReverb.decay = 2 + health * 5;

    // Delay feedback: healthy = lush trails; dry = sparse/short
    if (this._melDelay?.feedback != null) this._melDelay.feedback = 0.1 + health * 0.4;
    if (this._melDelay?.wet != null) this._melDelay.wet = 0.05 + health * 0.35;
    if (this._padBDelay?.feedback != null) this._padBDelay.feedback = 0.1 + health * 0.45;
    if (this._padBDelay?.wet != null) this._padBDelay.wet = 0.05 + health * 0.3;

    // Chorus: healthy = rich, wide; dry = off
    if (this._padChorus) {
      this._padChorus.wet = health * 0.6;
      this._padChorus.rate = 0.03 + n.tex * 0.15;
      this._padChorus.depth = health * 18;
    }

    // Master filter: healthy = warm and full; unhealthy = thin, exposed highs
    // Healthy: lower cutoff (warm), Unhealthy: higher cutoff (thin/bright/harsh)
    this._masterFilter.frequency.value = 2000 + (1 - health) * 6000 + health * 2000;
    // Unhealthy gets resonant peak for harshness
    this._masterFilter.Q.value = 0.5 + (1 - health) * 3;

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
    this._beatLeds.forEach((led, i) => led.classList.toggle("ga-led-on", i === step % 8));
    setTimeout(() => {
      this._beatLeds.forEach((led) => led.classList.remove("ga-led-on"));
    }, 200);
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
      this._playBtn.textContent = "▶ Start";
    } else {
      this._seq.start();
      this._playBtn.textContent = "◼ Stop";
    }
  }

  // ---- Auto-pilot ----

  _toggleAutoPilot() {
    this._autoPilot = !this._autoPilot;
    this._autoBtn.classList.toggle("ga-auto-active", this._autoPilot);
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
    this._autoNextChange = performance.now() + 30000 + Math.random() * 30000; // slower morph for ambient
    this._syncPresetButtons(this._autoPresetName);
  }

  _tickAutoPilot() {
    if (!this._autoPilot) return;
    const speed = 0.002; // slower than rhythmic version
    for (const key of ["dryness", "size", "branching", "physicalTexture"]) {
      this._p[key] += (this._autoTarget[key] - this._p[key]) * speed;
      if (this._sliderRefs[key]) this._sliderRefs[key].value = this._p[key];
    }
    if (performance.now() >= this._autoNextChange) this._pickNewAutoTarget();
    if (this._started) this._updateEffects();
    this._autoRaf = requestAnimationFrame(() => this._tickAutoPilot());
  }

  // ---- Public API ----

  applyReading(reading, { animate = true } = {}) {
    const keys = ["dryness", "size", "branching", "physicalTexture"];
    if (animate) {
      for (const key of keys) if (reading[key] != null) this._autoTarget[key] = reading[key];
      this._autoNextChange = performance.now() + 40000;
      if (!this._autoPilot) {
        this._autoPilot = true;
        this._autoBtn.classList.add("ga-auto-active");
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

  // ---- UI helpers ----

  _makeEl(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text) el.textContent = text;
    return el;
  }

  _makeColWrap(title, mobileCollapsed = false) {
    const root = this._makeEl("div", "ga-col");
    if (mobileCollapsed) root.setAttribute("data-collapsed", "");
    const header = this._makeEl("div", "ga-col-header");
    header.appendChild(this._makeEl("span", "ga-col-chevron", "▾"));
    header.appendChild(this._makeEl("span", null, title));
    header.addEventListener("click", () => root.toggleAttribute("data-collapsed"));
    root.appendChild(header);
    const body = this._makeEl("div", "ga-col-body");
    root.appendChild(body);
    return { root, body };
  }

  buildUI() {
    const layout = this._makeEl("div", "ga-layout");
    this.appendChild(layout);

    const col1 = this._makeColWrap("Controls", false);
    layout.appendChild(col1.root);
    const c1 = col1.body;

    const col2 = this._makeColWrap("Instruments", true);
    layout.appendChild(col2.root);
    this._debugPanel = col2.body;

    const col3 = this._makeColWrap("System Guide", true);
    layout.appendChild(col3.root);

    // Header
    const header = this._makeEl("div", "ga-header");
    c1.appendChild(header);

    this._playBtn = this._makeEl("button", "ga-play-btn", "▶ Start");
    this._playBtn.addEventListener("click", () => this._toggle());
    header.appendChild(this._playBtn);

    this._autoBtn = this._makeEl("button", "ga-auto-btn", "○ Auto");
    this._autoBtn.addEventListener("click", () => this._toggleAutoPilot());
    header.appendChild(this._autoBtn);

    this._statusEl = this._makeEl("div", "ga-status", "—");
    header.appendChild(this._statusEl);

    // Beat LEDs (8 for 2 bars)
    const ledRow = this._makeEl("div", "ga-led-row");
    c1.appendChild(ledRow);
    for (let i = 0; i < 8; i++) {
      const led = this._makeEl("div", `ga-led${[0, 4].includes(i) ? " ga-led-down" : ""}`);
      ledRow.appendChild(led);
      this._beatLeds.push(led);
    }

    // Preset buttons
    const presetRow = this._makeEl("div", "ga-preset-row");
    c1.appendChild(presetRow);
    this._presetBtns = {};
    for (const name of Object.keys(PLANT_PRESETS)) {
      const btn = this._makeEl("button", "ga-preset-btn", name);
      btn.addEventListener("click", () => {
        this.applyReading({ ...PLANT_PRESETS[name] }, { animate: false });
        this._autoTarget = { ...PLANT_PRESETS[name] };
        this._autoPresetName = name;
        this._syncPresetButtons(name);
      });
      presetRow.appendChild(btn);
      this._presetBtns[name] = btn;
    }
    this._syncPresetButtons("Willow");

    // Plant reading sliders
    const paramSec = this._makeSection("Plant Reading", c1);
    paramSec.appendChild(
      this._makeParamSlider("dryness", "Dryness", 0, 10, 0.1, this._p.dryness, "Cactus — Rainforest"),
    );
    paramSec.appendChild(this._makeParamSlider("size", "Size", 50, 900, 10, this._p.size, "Seedling — Ancient Tree"));
    paramSec.appendChild(
      this._makeParamSlider("branching", "Branching", 0, 10, 0.1, this._p.branching, "Simple — Complex"),
    );
    paramSec.appendChild(
      this._makeParamSlider("physicalTexture", "Texture", 0, 1, 0.01, this._p.physicalTexture, "Spiky — Smooth"),
    );

    const volSec = this._makeSection("Volume", c1);
    volSec.appendChild(this._makeParamSlider("volume", "Master Vol", 0, 1, 0.01, this._p.volume));

    // Delegated slider listener
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

    // Visualizer + FX + waveform
    this._visualizer = this._makeEl("wam-plant-visualizer", "ga-visualizer");
    c1.appendChild(this._visualizer);

    this._fxUnit = document.createElement("wam-fx-unit");
    c1.appendChild(this._fxUnit);
    this._waveform = document.createElement("wam-waveform");
    c1.appendChild(this._waveform);

    this._buildSystemGuideInto(col3.body);
  }

  // ---- Debug instrument panel ----

  _buildDebugControls() {
    if (!this._debugPanel) return;
    this._debugPanel.innerHTML = "";
    this._debugControls = [];

    const INSTRUMENTS = [
      { label: "Pad A", tag: "wam-synth-pad-controls", inst: this._pad, color: "#aa66ff", dest: this._padChorus.input },
      { label: "Pad B", tag: "wam-synth-mono-controls", inst: this._padB, color: "#6688ff", dest: this._padBDelay.input },
      { label: "Melody", tag: "wam-synth-mono-controls", inst: this._melody, color: "#99eeff", dest: this._melDelay.input },
      { label: "FM", tag: "wam-synth-fm-controls", inst: this._fm, color: "#eeccff", dest: this._fmReverb.input },
    ];

    for (const { label, tag, inst, color, dest } of INSTRUMENTS) {
      // Collapsible wrapper
      const wrap = this._makeEl("div", "ga-inst-wrap");
      const hdr = this._makeEl("div", "ga-inst-header");
      const chevron = this._makeEl("span", "ga-inst-chevron", "▾");
      hdr.appendChild(chevron);
      hdr.appendChild(this._makeEl("span", "ga-inst-label", label));
      hdr.style.setProperty("--inst-color", color);

      // Log Preset button — lets user dial in sound live and capture it
      const logBtn = this._makeEl("button", "ga-log-btn", "Log Preset");
      logBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const params = {};
        for (const def of (tag.includes("fm") ? [] : []).concat(
          Object.entries(inst)
            .filter(([k, v]) => typeof v !== "function" && !k.startsWith("_") && k !== "ctx")
            .map(([k]) => ({ param: k })),
        )) {
          if (inst[def.param] !== undefined) params[def.param] = inst[def.param];
        }
        // Use SLIDER_DEFS if available for a cleaner output
        const ctrl = this._debugControls.find((c) => c._instrument === inst);
        if (ctrl) {
          const clean = {};
          for (const def of ctrl.constructor.SLIDER_DEFS || []) {
            clean[def.param] = inst[def.param];
          }
          if (inst.oscType !== undefined) clean.oscType = inst.oscType;
          if (inst.lfoShape !== undefined) clean.lfoShape = inst.lfoShape;
          if (inst.lfoInterval !== undefined) clean.lfoInterval = inst.lfoInterval;
          console.group(`[${label}] Live Preset — copy into PRESETS:`);
          console.log(JSON.stringify(clean, null, 2));
          console.groupEnd();
        }
        logBtn.textContent = "✓ Logged!";
        setTimeout(() => (logBtn.textContent = "Log Preset"), 2000);
      });
      hdr.appendChild(logBtn);

      // wrap.setAttribute("data-collapsed", "");
      hdr.addEventListener("click", () => wrap.toggleAttribute("data-collapsed"));
      wrap.appendChild(hdr);

      const body = this._makeEl("div", "ga-inst-body");
      const ctrl = document.createElement(tag);
      ctrl.bind(inst, this._ctx, { title: label, color });
      ctrl.showSequencer = false;
      ctrl.connect(dest);
      body.appendChild(ctrl);
      wrap.appendChild(body);
      this._debugPanel.appendChild(wrap);
      this._debugControls.push(ctrl);
    }
  }

  _syncDebugControls() {
    if (!this._debugControls) return;
    for (const ctrl of this._debugControls) {
      if (!ctrl._sliders || !ctrl._instrument) continue;
      for (const [param, slider] of Object.entries(ctrl._sliders)) {
        if (slider && param in ctrl._instrument) slider.value = ctrl._instrument[param];
      }
    }
  }

  // ---- System guide ----

  _buildSystemGuideInto(container) {
    container.innerHTML = /*html*/ `
      <div class="ga-guide">

        <div class="ga-guide-intro">
          <p>Four plant parameters shape every aspect of the ambient soundscape — drone tuning, pad bloom speed, harmonic complexity, and texture filtering. All values are recomputed at the start of each 4-bar cycle.</p>
        </div>

        <div class="ga-guide-param">
          <div class="ga-guide-name">Dryness <span class="ga-guide-range">0–10</span></div>
          <div class="ga-guide-hint">Cactus (10) → Rainforest (0)</div>
          <ul>
            <li><b>Reverb wetness</b>: wetter plants bloom into deeper, longer reverb on all layers.</li>
            <li><b>Drone filter</b>: drier plants raise LFO sweep depth, adding more motion to the drone.</li>
            <li><b>Drone filter center</b>: combines with branching — <code>wet×0.6 + br×0.4</code>.</li>
            <li><b>Pad B delay</b>: dryness contributes to feedback depth.</li>
          </ul>
        </div>

        <div class="ga-guide-param">
          <div class="ga-guide-name">Size <span class="ga-guide-range">50–900</span></div>
          <div class="ga-guide-hint">Seedling (50) → Ancient Tree (900)</div>
          <ul>
            <li><b>BPM</b>: <code>70 - siz×40</code> → small=70 BPM, large=30 BPM. Sequencer is quarter-note based, so 30 BPM means very slow, spacious breathing.</li>
            <li><b>Note duration</b>: size multiplies pad and melody sustain lengths.</li>
            <li><b>Reverb decay</b>: pad reverb scales 6–14s, FM reverb 4–8s.</li>
            <li><b>Envelope release</b>: size extends the release of all melodic layers.</li>
          </ul>
        </div>

        <div class="ga-guide-param">
          <div class="ga-guide-name">Branching <span class="ga-guide-range">0–10</span></div>
          <div class="ga-guide-hint">Single Stem (0) → Highly Complex (10)</div>
          <ul>
            <li><b>Chord complexity</b>: low branch = 3-voice triad; high branch = 5-voice extended chord. Also adds a 7th to the drone at branching &gt; 0.6.</li>
            <li><b>Trigger density</b>: branching increases the probability of pads, melody, and FM triggering each step.</li>
            <li><b>Pad spacing</b>: minimum steps between pad triggers shrinks from 14 to 6 as branching rises.</li>
            <li><b>Chorus richness</b>: pad A chorus wet mix, rate, and depth all scale with branching.</li>
            <li><b>FM modulation</b>: <code>modIndex × (0.4 + br×0.8)</code>.</li>
          </ul>
        </div>

        <div class="ga-guide-param">
          <div class="ga-guide-name">Texture <span class="ga-guide-range">0–1</span></div>
          <div class="ga-guide-hint">Spiky (0) → Smooth (1)</div>
          <ul>
            <li><b>Pad bloom speed</b>: spiky = 1s attack; smooth = 6s slow bloom. This is the most audible parameter.</li>
            <li><b>Note duration</b>: smooth plants hold notes for much longer (<code>4 + tex×10</code> beats for Pad A).</li>
            <li><b>Drone LFO rate</b>: smooth = very slow sweep (50s cycle); spiky = faster modulation (12s cycle).</li>
            <li><b>Reverb tail</b>: pad release scales with texture — smooth plants let sounds linger.</li>
            <li><b>Filter brightness</b>: contributes 30% of master filter openness.</li>
          </ul>
        </div>

        <div class="ga-guide-param">
          <div class="ga-guide-name">Layers</div>
          <div class="ga-guide-hint">Five concurrent sound sources</div>
          <ul>
            <li><b>Drone</b>: root + fifth + octave oscillators held continuously. Crossfades to new tuning each 4-bar cycle. Filtered with LFO sweep.</li>
            <li><b>Pad A</b>: slow-blooming chords (3–5 voices). The most prominent ambient layer. Huge reverb + chorus.</li>
            <li><b>Pad B</b>: secondary melodic texture — single note, slower mono pad timbre. Delay + reverb.</li>
            <li><b>Melody</b>: very sparse single notes from the scale pool. Short probability gates to keep it minimal.</li>
            <li><b>FM</b>: bell or shimmer textures that decay naturally. Mood selects preset; branching modulates FM index.</li>
          </ul>
        </div>

        <div class="ga-guide-param">
          <div class="ga-guide-name">Instrument Panel</div>
          <div class="ga-guide-hint">Live tuning + preset export</div>
          <p>Expand the Instruments column to access all parameter sliders for each layer. After tuning a sound to your liking, click <b>Log Preset</b> to print the current parameter values as JSON to the browser console — ready to paste into the instrument's PRESETS object.</p>
        </div>

      </div>
    `;
  }

  _syncPresetButtons(activeName) {
    for (const [name, btn] of Object.entries(this._presetBtns)) {
      btn.classList.toggle("ga-preset-active", name === activeName);
    }
  }

  _makeSection(title, parent = this) {
    const sec = this._makeEl("div", "ga-section");
    sec.appendChild(this._makeEl("div", "ga-section-title", title));
    parent.appendChild(sec);
    return sec;
  }

  _makeParamSlider(param, label, min, max, step, initial, hint) {
    const slider = document.createElement("wam-slider");
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
      generative-ambient {
        display: block;
        font-family: monospace;
        background: #07070f;
        color: #bbc;
        padding: 22px;
        border-radius: 8px;
        max-width: 1400px;
        --slider-accent: #8899ff;
      }

      generative-ambient .ga-layout {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 16px;
        align-items: start;
      }

      generative-ambient .ga-col-header { display: none; }
      generative-ambient .ga-col-body { display: block; }

      @media (max-width: 900px) {
        generative-ambient .ga-layout { grid-template-columns: 1fr; }
        generative-ambient .ga-col-header {
          display: flex; align-items: center; gap: 7px;
          padding: 9px 0; cursor: pointer; user-select: none;
          font-size: 0.68em; color: #2a2a5a; text-transform: uppercase;
          letter-spacing: 0.1em; border-bottom: 1px solid #1a1a3a; margin-bottom: 10px;
        }
        generative-ambient .ga-col-header:hover { color: #8899ff; }
        generative-ambient .ga-col-chevron { font-size: 0.9em; transition: transform 0.15s ease; }
        generative-ambient .ga-col[data-collapsed] .ga-col-chevron { transform: rotate(-90deg); }
        generative-ambient .ga-col[data-collapsed] .ga-col-body { display: none; }
      }

      generative-ambient .ga-header {
        display: flex; align-items: center; gap: 12px; margin-bottom: 16px;
      }

      generative-ambient .ga-play-btn {
        padding: 9px 22px; font-family: monospace; font-size: 1em;
        background: #0a0a1e; color: #8899ff; border: 2px solid #8899ff;
        border-radius: 4px; cursor: pointer; white-space: nowrap; flex-shrink: 0;
      }
      generative-ambient .ga-play-btn:hover:not(:disabled) { background: #8899ff; color: #000; }
      generative-ambient .ga-play-btn:disabled { opacity: 0.5; cursor: default; }

      generative-ambient .ga-auto-btn {
        padding: 9px 16px; font-family: monospace; font-size: 1em;
        background: #0a0a1e; color: #2a2a5a; border: 2px solid #1a1a3a;
        border-radius: 4px; cursor: pointer; white-space: nowrap; flex-shrink: 0;
        transition: color 0.2s, border-color 0.2s;
      }
      generative-ambient .ga-auto-btn:hover { color: #aabbff; border-color: #3a3a7a; }
      generative-ambient .ga-auto-btn.ga-auto-active {
        color: #aabbff; border-color: #8899ff;
        animation: ga-pulse 3s ease-in-out infinite;
      }
      @keyframes ga-pulse {
        0%, 100% { box-shadow: 0 0 0 0 #8899ff44; }
        50%       { box-shadow: 0 0 0 6px #8899ff00; }
      }

      generative-ambient .ga-status {
        font-size: 0.72em; color: #2a2a5a; letter-spacing: 0.06em;
        min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }

      generative-ambient .ga-led-row { display: flex; gap: 7px; margin-bottom: 14px; }
      generative-ambient .ga-led {
        flex: 1; height: 6px; border-radius: 2px; background: #0c0c1f;
        transition: background 0.08s, box-shadow 0.08s;
      }
      generative-ambient .ga-led.ga-led-down { background: #131325; }
      generative-ambient .ga-led.ga-led-on   { background: #8899ff; box-shadow: 0 0 10px #8899ff88; }

      generative-ambient .ga-preset-row {
        display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 14px;
      }
      generative-ambient .ga-preset-btn {
        font-family: monospace; font-size: 0.75em; padding: 5px 12px;
        background: #0c0c1f; color: #2a2a5a; border: 1px solid #1a1a3a;
        border-radius: 3px; cursor: pointer; text-transform: uppercase; letter-spacing: 0.05em;
        transition: color 0.15s, border-color 0.15s;
      }
      generative-ambient .ga-preset-btn:hover { color: #aabbff; border-color: #3a3a7a; }
      generative-ambient .ga-preset-btn.ga-preset-active {
        color: #8899ff; border-color: #8899ff; background: #0f0f2a;
      }

      generative-ambient .ga-section {
        display: flex; flex-direction: column; gap: 14px;
        background: #0a0a1c; border: 1px solid #1a1a3a;
        border-radius: 6px; padding: 14px 16px; margin-bottom: 10px;
      }
      generative-ambient .ga-section-title {
        font-size: 0.63em; color: #2a2a5a;
        text-transform: uppercase; letter-spacing: 0.12em; margin-bottom: -2px;
      }

      generative-ambient .ga-visualizer {
        width: 100%; aspect-ratio: 1;
        background: #040408; border-radius: 4px;
        margin-bottom: 10px; border: 1px solid #0f0f1f;
      }

      /* ---- Instrument debug collapsibles ---- */
      generative-ambient .ga-inst-wrap {
        border: 1px solid #1a1a3a; border-radius: 6px;
        margin-bottom: 8px; overflow: hidden;
      }
      generative-ambient .ga-inst-header {
        display: flex; align-items: center; gap: 8px;
        padding: 8px 12px; cursor: pointer; user-select: none;
        background: #0a0a1c; border-bottom: 1px solid #0f0f2a;
      }
      generative-ambient .ga-inst-header:hover { background: #0f0f28; }
      generative-ambient .ga-inst-chevron {
        font-size: 0.85em; transition: transform 0.15s ease; flex-shrink: 0;
        color: var(--inst-color, #8899ff);
      }
      generative-ambient .ga-inst-wrap[data-collapsed] .ga-inst-chevron {
        transform: rotate(-90deg);
      }
      generative-ambient .ga-inst-label {
        font-size: 0.72em; color: var(--inst-color, #8899ff);
        text-transform: uppercase; letter-spacing: 0.08em; flex: 1;
      }
      generative-ambient .ga-inst-body { background: #060610; }
      generative-ambient .ga-inst-wrap[data-collapsed] .ga-inst-body { display: none; }

      generative-ambient .ga-log-btn {
        font-family: monospace; font-size: 0.68em;
        padding: 3px 8px; height: 20px; box-sizing: border-box;
        background: #0a0a1c; color: #4455aa; border: 1px solid #2a2a5a;
        border-radius: 3px; cursor: pointer; white-space: nowrap; flex-shrink: 0;
      }
      generative-ambient .ga-log-btn:hover { color: #8899ff; border-color: #5566cc; }

      /* ---- System guide ---- */
      generative-ambient .ga-guide {
        display: flex; flex-direction: column; gap: 18px; padding: 4px 0;
      }
      generative-ambient .ga-guide-intro p {
        font-size: 0.72em; color: #4455aa; line-height: 1.5; margin: 0;
      }
      generative-ambient .ga-guide-param {
        border-left: 2px solid #1a1a4a; padding-left: 12px;
      }
      generative-ambient .ga-guide-name {
        font-size: 0.78em; color: #8899ff; font-weight: bold; margin-bottom: 2px;
      }
      generative-ambient .ga-guide-range {
        font-size: 0.85em; color: #2a2a5a; font-weight: normal; margin-left: 6px;
      }
      generative-ambient .ga-guide-hint {
        font-size: 0.65em; color: #2a2a5a; letter-spacing: 0.06em;
        margin-bottom: 6px; text-transform: uppercase;
      }
      generative-ambient .ga-guide p {
        font-size: 0.72em; color: #5566aa; line-height: 1.5; margin: 0 0 6px 0;
      }
      generative-ambient .ga-guide ul {
        margin: 0; padding-left: 16px; display: flex; flex-direction: column; gap: 3px;
      }
      generative-ambient .ga-guide li { font-size: 0.68em; color: #334488; line-height: 1.45; }
      generative-ambient .ga-guide li b { color: #5566aa; }
      generative-ambient .ga-guide code {
        font-family: monospace; background: #0c0c20; padding: 1px 4px;
        border-radius: 2px; color: #8899ff; font-size: 0.95em;
      }

      wam-waveform {
        height: 40px; background: #040408;
        border-top: 1px solid #0f0f1f; display: block;
      }
    `;
    document.head.appendChild(style);
  }
}

customElements.define("generative-ambient", WebAudioGenerativeAmbient);
