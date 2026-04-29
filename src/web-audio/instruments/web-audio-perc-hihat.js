import WebAudioInstrumentBase from "../web-audio-instrument-base.js";
import { WebAudioControlsBase, createSection } from "../web-audio-controls-base.js";

/**
 * WebAudioPercHihat — bandpass-filtered white noise with fast amplitude decay.
 *
 * A pre-generated noise buffer is reused across all triggers for efficiency.
 * Adjust filterFreq/filterQ for open vs closed character, decay for length.
 *
 * Usage:
 *   const hihat = new WebAudioPercHihat(ctx, { decay: 0.04 }); // tight closed hat
 *   hihat.connect(ctx.destination);
 *   hihat.trigger(0.6, time);
 */
export default class WebAudioPercHihat extends WebAudioInstrumentBase {
  static PRESETS = {
    Default: { filterFreq: 8000, filterQ: 0.8, decay: 0.06, volume: 1 },
    Open: { filterFreq: 7000, filterQ: 0.6, decay: 0.3, volume: 0.8 },
    Tight: { filterFreq: 9000, filterQ: 1.2, decay: 0.03, volume: 1 },
    Shaker: { filterFreq: 6000, filterQ: 0.5, decay: 0.12, volume: 0.7 },
  };

  constructor(ctx, preset = "Default") {
    super(ctx, null);
    this._noiseBuffer = this._buildNoiseBuffer();
    this.applyPreset(preset);
  }

  _buildNoiseBuffer() {
    const ctx = this.ctx;
    // Half-second of mono white noise, reused across all triggers
    const length = Math.floor(ctx.sampleRate * 0.5);
    const buf = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /**
   * @param {number} [velocity]  0–1
   * @param {number} [atTime]    AudioContext time
   */
  trigger(velocity = 1, atTime = 0) {
    const ctx = this.ctx;
    const t = atTime > 0 ? atTime : ctx.currentTime;

    const noise = ctx.createBufferSource();
    noise.buffer = this._noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = this.filterFreq;
    filter.Q.value = this.filterQ;

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(velocity, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + this.decay);

    noise.connect(filter);
    filter.connect(amp);
    amp.connect(this._out);

    noise.start(t);
    noise.stop(t + this.decay + 0.05);

    return this;
  }
}

// ---- Controls companion component ----

export class WebAudioPercHihatControls extends WebAudioControlsBase {
  static SLIDER_DEFS = [
    { param: "filterFreq", label: "Freq",  min: 2000, max: 16000, step: 1,   scale: "log", tooltip: "Bandpass filter center frequency. Lower = closed, higher = bright." },
    { param: "filterQ",    label: "Q",     min: 0.1,  max: 5,     step: 0.1,               tooltip: "Filter sharpness. Higher = more metallic, focused tone." },
    { param: "decay",      label: "Decay", min: 0.01, max: 0.5,   step: 0.01,              tooltip: "Amplitude decay time. Shorter = tighter, ticking hat." },
    { param: "volume",     label: "Vol",   min: 0,    max: 1,     step: 0.01 },
  ];

  _defaultColor() { return "#ff0"; }
  _defaultTitle() { return "Hi-Hat"; }
  _fxTitle() { return "HiHat FX"; }

  _buildControls(controls, expanded, mkSlider) {
    const { el, controls: sec } = createSection("Hi-Hat");
    this._makePresetDropdown(WebAudioPercHihat.PRESETS, sec);
    sec.appendChild(mkSlider({ param: "filterFreq", label: "Freq",  min: 2000, max: 16000, step: 1,   scale: "log" }));
    sec.appendChild(mkSlider({ param: "filterQ",    label: "Q",     min: 0.1,  max: 5,     step: 0.1 }));
    sec.appendChild(mkSlider({ param: "decay",      label: "Decay", min: 0.01, max: 0.5,   step: 0.01 }));
    controls.appendChild(el);
  }
}

customElements.define("web-audio-perc-hihat-controls", WebAudioPercHihatControls);
