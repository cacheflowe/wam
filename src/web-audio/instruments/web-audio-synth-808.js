import "../web-audio-slider.js";
import { injectControlsCSS, createSection, createChannelStrip } from "../web-audio-slider.js";
import "../web-audio-step-seq.js";
import { scaleNoteOptions, STEP_WEIGHTS } from "../web-audio-scales.js";

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
export default class WebAudioSynth808 {
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
   * @param {object} [options]
   * @param {number} [options.pitchSweepSemitones=24]  Semitones above target at start of sweep
   * @param {number} [options.pitchDecay=0.1]           Seconds for pitch to reach target note
   * @param {number} [options.decay=0.8]                Amplitude decay in seconds
   * @param {number} [options.distortion=0]             Soft-clip amount 0–1
   * @param {number} [options.click=0.4]                Noise transient click level 0–1
   * @param {number} [options.subOscMix=0]              Sub oscillator (octave below) mix 0–1
   * @param {number} [options.tone=3000]                Tone lowpass cutoff Hz
   * @param {number} [options.volume=1.0]
   */
  constructor(ctx, preset = "Default") {
    this.ctx = ctx;
    this._distortion = 0;
    this._distortionCurve = this._makeDistortionCurve(0);

    // Tone lowpass — shaping before output
    this._filter = ctx.createBiquadFilter();
    this._filter.type = "lowpass";
    this._filter.Q.value = 1;

    this._out = ctx.createGain();
    this._filter.connect(this._out);

    // Pre-bake click noise buffer (15ms, linearly enveloped) — reused on every trigger
    const clickSamples = Math.ceil(ctx.sampleRate * 0.015);
    this._clickBuffer = ctx.createBuffer(1, clickSamples, ctx.sampleRate);
    const cd = this._clickBuffer.getChannelData(0);
    for (let i = 0; i < clickSamples; i++) {
      cd[i] = (Math.random() * 2 - 1) * (1 - i / clickSamples);
    }

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

  get volume() {
    return this._out.gain.value;
  }

  set volume(v) {
    this._out.gain.value = v;
  }

  // ---- Routing ----

  get input() {
    return this._out;
  }

  connect(node) {
    this._out.connect(node.input ?? node);
    return this;
  }

  /**
   * Apply a named preset, updating all synth parameters in place.
   * @param {string} name  Key of WebAudioSynth808.PRESETS
   */
  applyPreset(name) {
    const p = WebAudioSynth808.PRESETS[name];
    if (!p) return;
    if (p.pitchSweepSemitones != null) this.pitchSweepSemitones = p.pitchSweepSemitones;
    if (p.pitchDecay != null) this.pitchDecay = p.pitchDecay;
    if (p.decay != null) this.decay = p.decay;
    if (p.distortion != null) this.distortion = p.distortion;
    if (p.click != null) this.click = p.click;
    if (p.subOscMix != null) this.subOscMix = p.subOscMix;
    if (p.tone != null) this.tone = p.tone;
    if (p.volume != null) this.volume = p.volume;
  }

  // ---- Helpers ----

  _midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

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
    const targetFreq = this._midiToFreq(midi);
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

export class WebAudioSynth808Controls extends HTMLElement {
  static SLIDER_DEFS = [
    { param: "volume", label: "Vol", min: 0, max: 1, step: 0.01 },
    { param: "decay", label: "Decay", min: 0.1, max: 3, step: 0.01 },
    { param: "pitchSweepSemitones", label: "Pitch Sweep", min: 0, max: 36, step: 1 },
    { param: "pitchDecay", label: "Pitch Decay", min: 0.01, max: 1, step: 0.01 },
    { param: "distortion", label: "Distortion", min: 0, max: 1, step: 0.01 },
    { param: "click", label: "Click", min: 0, max: 1, step: 0.01 },
    { param: "subOscMix", label: "Sub Mix", min: 0, max: 1, step: 0.01 },
    { param: "tone", label: "Tone", min: 50, max: 8000, step: 1, scale: "log" },
  ];

  static DEFAULT_PATTERN() {
    return Array.from({ length: 16 }, (_, i) => ({ active: i === 0 || i === 8, note: 29 }));
  }

  constructor() {
    super();
    this._instrument = null;
    this._sliders = {};
    this._presetSelect = null;
    this._out = null;
    this._pan = null;
    this._panSlider = null;
    this._seq = null;
    this._rootMidi = 29;
    this._scaleName = "Minor";
  }

  bind(instrument, ctx, options = {}) {
    this._instrument = instrument;
    const color = options.color || "#fa0";
    this.innerHTML = "";
    injectControlsCSS();
    this.style.setProperty("--slider-accent", color);

    const strip = createChannelStrip(this, {
      title: options.title || "808 Bass",
      getOutGain: () => this._out,
      initialVol: instrument.volume,
      initialPan: 0,
    });
    this._muteHandle = { isMuted: strip.isMuted, setMuted: strip.setMuted };
    this._sliders["volume"] = strip.volSlider;
    this._panSlider = strip.panSlider;

    // Waveform — always visible (visualizer)
    const waveform = document.createElement("web-audio-waveform");
    this.appendChild(waveform);

    // Expanded panel — hidden when collapsed
    const expanded = document.createElement("div");
    expanded.className = "wac-expanded";
    this.appendChild(expanded);

    // Controls wrapper inside expanded
    const controls = document.createElement("div");
    controls.className = "wac-controls";
    expanded.appendChild(controls);

    const mkSlider = (def) => {
      const s = document.createElement("web-audio-slider");
      s.setAttribute("param", def.param);
      s.setAttribute("label", def.label);
      s.setAttribute("min", def.min);
      s.setAttribute("max", def.max);
      s.setAttribute("step", def.step);
      if (def.scale) s.setAttribute("scale", def.scale);
      s.value = instrument[def.param];
      this._sliders[def.param] = s;
      return s;
    };

    // ---- Tone ----
    const { el: toneEl, controls: toneCtrl } = createSection("Tone");
    this._presetSelect = document.createElement("select");
    this._presetSelect.className = "wac-select";
    Object.keys(WebAudioSynth808.PRESETS).forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name.replace(/_/g, " ");
      this._presetSelect.appendChild(opt);
    });
    this._presetSelect.addEventListener("change", () => {
      this.applyPreset(this._presetSelect.value);
      this._emitChange();
    });
    toneCtrl.appendChild(this._presetSelect);
    toneCtrl.appendChild(mkSlider({ param: "tone",   label: "Tone", min: 50, max: 8000, step: 1, scale: "log" }));
    controls.appendChild(toneEl);

    // ---- Shape ----
    const { el: shapeEl, controls: shapeCtrl } = createSection("Shape");
    shapeCtrl.appendChild(mkSlider({ param: "decay",               label: "Decay",       min: 0.1,  max: 3,   step: 0.01 }));
    shapeCtrl.appendChild(mkSlider({ param: "pitchSweepSemitones", label: "Pitch Sweep", min: 0,    max: 36,  step: 1 }));
    shapeCtrl.appendChild(mkSlider({ param: "pitchDecay",          label: "Pitch Decay", min: 0.01, max: 1,   step: 0.01 }));
    controls.appendChild(shapeEl);

    // ---- Character ----
    const { el: charEl, controls: charCtrl } = createSection("Character");
    charCtrl.appendChild(mkSlider({ param: "distortion", label: "Distortion", min: 0, max: 1, step: 0.01 }));
    charCtrl.appendChild(mkSlider({ param: "click",      label: "Click",      min: 0, max: 1, step: 0.01 }));
    charCtrl.appendChild(mkSlider({ param: "subOscMix",  label: "Sub Mix",    min: 0, max: 1, step: 0.01 }));
    controls.appendChild(charEl);

    this.addEventListener("slider-input", (e) => {
      if (!this._instrument) return;
      const { param, value } = e.detail;
      if (param === "pan") {
        if (this._pan) this._pan.pan.value = value;
      } else {
        this._instrument[param] = value;
      }
      this._emitChange();
    });

    // Randomize button
    const actionRow = document.createElement("div");
    actionRow.className = "wac-action-row";
    const randBtn = document.createElement("button");
    randBtn.textContent = "⚄ Randomize";
    randBtn.className = "wac-action-btn";
    randBtn.addEventListener("click", () => this.randomize());
    actionRow.appendChild(randBtn);
    expanded.appendChild(actionRow);

    // Step sequencer
    this._seq = document.createElement("web-audio-step-seq");
    const noteOpts = scaleNoteOptions(this._rootMidi, this._scaleName, 24, 48);
    this._seq.init({
      steps: WebAudioSynth808Controls.DEFAULT_PATTERN(),
      noteOptions: noteOpts,
      color,
    });
    expanded.appendChild(this._seq);
    this._seq.addEventListener("step-change", () => this._emitChange());

    // Audio routing: instrument → _out → _pan
    // analyser taps from _out so waveform goes dark when muted
    this._out = ctx.createGain();
    instrument.connect(this._out);
    this._pan = ctx.createStereoPanner();
    this._out.connect(this._pan);
    const analyser = ctx.createAnalyser();
    this._out.connect(analyser);
    const meterAnalyser = ctx.createAnalyser();
    meterAnalyser.fftSize = 256;
    this._out.connect(meterAnalyser);
    strip.meter.setAnalyser(meterAnalyser);
    waveform.init(analyser, color);
  }

  // ---- Sequencer integration ----

  step(index, time, stepDurationSec) {
    if (!this._instrument || !this._seq) return;
    const s = this._seq.steps[index];
    if (s?.active) {
      this._instrument.trigger(s.note, stepDurationSec, time);
    }
  }

  setActiveStep(i) {
    this._seq?.setActiveStep(i);
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

  // ---- Serialization ----

  _emitChange() {
    this.dispatchEvent(new CustomEvent("controls-change", { bubbles: true }));
  }

  toJSON() {
    if (!this._instrument) return null;
    const params = {};
    for (const def of WebAudioSynth808Controls.SLIDER_DEFS) params[def.param] = this._instrument[def.param];
    return {
      params,
      steps: this._seq?.steps ?? [],
      muted: this._muteHandle?.isMuted() ?? false,
      pan: this._pan?.pan.value ?? 0,
    };
  }

  fromJSON(obj) {
    if (!obj || !this._instrument) return;
    if (obj.params) {
      for (const [key, val] of Object.entries(obj.params)) {
        this._instrument[key] = val;
        if (this._sliders[key]) this._sliders[key].value = val;
      }
    }
    if (obj.steps && this._seq) this._seq.steps = obj.steps;
    if (obj.muted != null) this._muteHandle?.setMuted(obj.muted);
    if (obj.pan != null && this._pan) {
      this._pan.pan.value = obj.pan;
      if (this._panSlider) this._panSlider.value = obj.pan;
    }
  }

  // ---- Preset / routing ----

  applyPreset(name) {
    if (!this._instrument) return;
    this._instrument.applyPreset(name);
    for (const def of WebAudioSynth808Controls.SLIDER_DEFS) {
      const slider = this._sliders[def.param];
      if (slider) slider.value = this._instrument[def.param];
    }
    if (this._presetSelect) this._presetSelect.value = name;
  }

  set bpm(_) { /* 808 has no FX unit to sync */ }

  connect(node) {
    (this._pan ?? this._out)?.connect(node.input ?? node);
    return this;
  }
}

customElements.define("web-audio-synth-808-controls", WebAudioSynth808Controls);
