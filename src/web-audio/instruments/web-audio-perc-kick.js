import WebAudioInstrumentBase from "../web-audio-instrument-base.js";
import { WebAudioControlsBase, createSection } from "../web-audio-controls-base.js";

/**
 * WebAudioPercKick — 808-style kick via sine oscillator with pitch sweep.
 *
 * A sine starts at a high frequency and rapidly drops to a low thump,
 * while the amplitude decays. Adjust startFreq/endFreq/sweepTime/decay
 * for different flavors (punchy, boomy, snappy).
 *
 * Usage:
 *   const kick = new WebAudioPercKick(ctx);
 *   kick.connect(ctx.destination);
 *   kick.trigger(0.9, time);
 */
export default class WebAudioPercKick extends WebAudioInstrumentBase {
  static PRESETS = {
    Default: { startFreq: 150, endFreq: 40, sweepTime: 0.08, decay: 0.35, volume: 1 },
    Punchy: { startFreq: 200, endFreq: 50, sweepTime: 0.05, decay: 0.25, volume: 1 },
    Boomy: { startFreq: 100, endFreq: 30, sweepTime: 0.15, decay: 0.6, volume: 0.9 },
    Snap: { startFreq: 300, endFreq: 60, sweepTime: 0.03, decay: 0.18, volume: 1 },
  };

  constructor(ctx, preset = "Default") {
    super(ctx, preset);
  }

  /**
   * @param {number} [velocity]  0–1
   * @param {number} [atTime]    AudioContext time
   */
  trigger(velocity = 1, atTime = 0) {
    const ctx = this.ctx;
    const t = atTime > 0 ? atTime : ctx.currentTime;

    const osc = ctx.createOscillator();
    const amp = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(this.startFreq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, this.endFreq), t + this.sweepTime);

    amp.gain.setValueAtTime(velocity, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + this.decay);

    osc.connect(amp);
    amp.connect(this._out);

    osc.start(t);
    osc.stop(t + this.decay + 0.05);

    return this;
  }
}

// ---- Controls companion component ----

export class WebAudioPercKickControls extends WebAudioControlsBase {
  static SLIDER_DEFS = [
    { param: "startFreq", label: "Start Freq", min: 50, max: 500, step: 1,    tooltip: "Starting pitch of the kick's pitch sweep in Hz." },
    { param: "endFreq",   label: "End Freq",   min: 20, max: 200, step: 1,    tooltip: "Final pitch of the kick at the end of the sweep." },
    { param: "sweepTime", label: "Sweep",      min: 0.01, max: 0.5, step: 0.01, tooltip: "Duration of the pitch sweep from start to end frequency." },
    { param: "decay",     label: "Decay",      min: 0.05, max: 1.5, step: 0.01, tooltip: "Amplitude decay time. Longer = punchier, sustaining kick." },
    { param: "volume",    label: "Vol",        min: 0,    max: 1,   step: 0.01 },
  ];

  _defaultColor() { return "#f44"; }
  _defaultTitle() { return "Kick"; }
  _fxTitle() { return "Kick FX"; }

  _buildControls(controls, expanded, mkSlider) {
    const { el, controls: sec } = createSection("Kick");
    this._makePresetDropdown(WebAudioPercKick.PRESETS, sec);
    sec.appendChild(mkSlider({ param: "startFreq", label: "Start Freq", min: 50, max: 500, step: 1 }));
    sec.appendChild(mkSlider({ param: "endFreq", label: "End Freq", min: 20, max: 200, step: 1 }));
    sec.appendChild(mkSlider({ param: "sweepTime", label: "Sweep", min: 0.01, max: 0.5, step: 0.01 }));
    sec.appendChild(mkSlider({ param: "decay", label: "Decay", min: 0.05, max: 1.5, step: 0.01 }));
    controls.appendChild(el);
  }
}

customElements.define("web-audio-perc-kick-controls", WebAudioPercKickControls);
