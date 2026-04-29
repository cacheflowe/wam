import WebAudioInstrumentBase from "../web-audio-instrument-base.js";
import { WebAudioControlsBase, createSection } from "../web-audio-controls-base.js";

/**
 * WebAudioSynthPad — polyphonic pad synth for chord stabs.
 *
 * Accepts an array of MIDI notes per trigger. Each note gets its own
 * oscillator + amp envelope; voices are fire-and-forget.
 *
 * Usage:
 *   const pad = new WebAudioSynthPad(ctx, { attack: 0.5, release: 2 });
 *   pad.connect(reverb);
 *   pad.trigger([48, 51, 55], 1.0, 0.7, time); // C minor triad
 */
export default class WebAudioSynthPad extends WebAudioInstrumentBase {
  static PRESETS = {
    Default: { oscType: "sine", attack: 0.5, decay: 0.4, sustain: 0.7, release: 2.0, volume: 1 },
    Strings: { oscType: "sawtooth", attack: 0.8, decay: 0.5, sustain: 0.8, release: 2.5, volume: 0.7 },
    Warm: { oscType: "triangle", attack: 0.3, decay: 0.3, sustain: 0.9, release: 1.5, volume: 0.9 },
    Stab: { oscType: "sawtooth", attack: 0.01, decay: 0.2, sustain: 0.0, release: 0.4, volume: 0.9 },
  };

  constructor(ctx, preset = "Default") {
    super(ctx, preset);
  }

  /**
   * @param {number|number[]} midiNotes  Single MIDI note or chord array
   * @param {number} durationSec
   * @param {number} [velocity]  0–1
   * @param {number} [atTime]    AudioContext time
   */
  trigger(midiNotes, durationSec, velocity = 1, atTime = 0) {
    const ctx = this.ctx;
    const t = atTime > 0 ? atTime : ctx.currentTime;
    const notes = Array.isArray(midiNotes) ? midiNotes : [midiNotes];
    // Constant-power scaling keeps perceived volume stable across chord sizes
    const perVoice = velocity / Math.sqrt(notes.length);

    notes.forEach((midi) => {
      const freq = 440 * Math.pow(2, (midi - 69) / 12);
      const osc = ctx.createOscillator();
      const amp = ctx.createGain();

      osc.type = this.oscType;
      osc.frequency.value = freq;

      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(perVoice, t + this.attack);
      amp.gain.linearRampToValueAtTime(perVoice * this.sustain, t + this.attack + this.decay);
      amp.gain.setValueAtTime(perVoice * this.sustain, t + durationSec);
      amp.gain.linearRampToValueAtTime(0, t + durationSec + this.release);

      osc.connect(amp);
      amp.connect(this._out);

      osc.start(t);
      osc.stop(t + durationSec + this.release + 0.1);
    });

    return this;
  }
}

// ---- Controls companion component ----

export class WebAudioSynthPadControls extends WebAudioControlsBase {
  static SLIDER_DEFS = [
    { param: "attack",  label: "Attack",  min: 0.01, max: 2, step: 0.01, tooltip: "Amplitude envelope attack time. Longer = softer fade-in." },
    { param: "decay",   label: "Decay",   min: 0.01, max: 2, step: 0.01, tooltip: "Amplitude envelope decay time after peak." },
    { param: "sustain", label: "Sustain", min: 0,    max: 1, step: 0.01, tooltip: "Amplitude sustain level during held notes." },
    { param: "release", label: "Release", min: 0.01, max: 5, step: 0.01, tooltip: "Amplitude fade-out time after note release." },
    { param: "volume",  label: "Vol",     min: 0,    max: 1, step: 0.01 },
  ];

  _defaultColor() { return "#88f"; }
  _defaultTitle() { return "Pad Synth"; }
  _fxTitle() { return "Pad FX"; }

  _buildControls(controls, expanded, mkSlider) {
    // ---- Tone ----
    const { el: toneEl, controls: toneCtrl } = createSection("Tone");
    this._makePresetDropdown(WebAudioSynthPad.PRESETS, toneCtrl);
    this._makeWaveRow(["sine", "triangle", "sawtooth", "square"], toneCtrl);
    controls.appendChild(toneEl);

    // ---- Envelope ----
    const { el: envEl, controls: envCtrl } = createSection("Envelope");
    envCtrl.appendChild(mkSlider({ param: "attack",  label: "Attack",  min: 0.01, max: 2, step: 0.01 }));
    envCtrl.appendChild(mkSlider({ param: "decay",   label: "Decay",   min: 0.01, max: 2, step: 0.01 }));
    envCtrl.appendChild(mkSlider({ param: "sustain", label: "Sustain", min: 0,    max: 1, step: 0.01 }));
    envCtrl.appendChild(mkSlider({ param: "release", label: "Release", min: 0.01, max: 5, step: 0.01 }));
    controls.appendChild(envEl);
  }

  _syncExtraControls() {
    this._syncWaveRow();
  }
}

customElements.define("web-audio-synth-pad-controls", WebAudioSynthPadControls);
