/**
 * WebAudioFxReverb — ConvolverNode with a synthesized impulse response.
 *
 * The impulse response is generated synchronously at construction time
 * (no async/await needed, unlike Tone.js Reverb). The dry signal always
 * passes through at full gain; the wet gain controls reverb amount.
 *
 * IR synthesis features:
 *   - Early reflections: tapped delays simulating first wall bounces
 *   - Frequency-dependent decay: highs decay faster than lows (natural rooms)
 *   - Stereo decorrelation: independent L/R noise + adjustable width
 *   - Density shaping: exponential envelope with configurable curve
 *
 * Wet signal chain:
 *   in → preDelay → convolver → hp → lp → wetGain → out
 *
 * Controls:
 *   wet        — reverb send level (0–1)
 *   decay      — tail length in seconds (rebuilds IR)
 *   preDelay   — ms before tail starts (0–80ms)
 *   hpFreq     — HP filter on wet path, cuts mud (20–800 Hz)
 *   lpFreq     — LP filter on wet path, simulates air damping (2k–20k Hz)
 *   damping    — high-frequency decay rate (0 = bright, 1 = dark/muffled)
 *   width      — stereo width (0 = mono, 1 = full stereo)
 *
 * Usage:
 *   const reverb = new WebAudioFxReverb(ctx, { decay: 3, wet: 0.4, damping: 0.5 });
 *   synth.connect(reverb);
 *   reverb.connect(ctx.destination);
 *   reverb.wet = 0.6; // update at any time
 */
export default class WebAudioFxReverb {
  constructor(ctx, options = {}) {
    this.ctx = ctx;

    this._in = ctx.createGain();
    this._out = ctx.createGain();
    this._dry = ctx.createGain();
    this._wetGain = ctx.createGain();
    this._convolver = ctx.createConvolver();

    this._preDelay = ctx.createDelay(0.1);
    this._preDelay.delayTime.value = (options.preDelay ?? 0) / 1000;

    this._hp = ctx.createBiquadFilter();
    this._hp.type = "highpass";
    this._hp.frequency.value = options.hpFreq ?? 80;
    this._hp.Q.value = 0.5;

    this._lp = ctx.createBiquadFilter();
    this._lp.type = "lowpass";
    this._lp.frequency.value = options.lpFreq ?? 8000;
    this._lp.Q.value = 0.5;

    this._decay = options.decay ?? 2.5;
    this._damping = options.damping ?? 0.5;
    this._width = options.width ?? 1;

    this._convolver.buffer = this._buildImpulse();

    // in → dry → out
    this._in.connect(this._dry);
    this._dry.connect(this._out);
    this._dry.gain.value = 1;

    // in → preDelay → convolver → hp → lp → wetGain → out
    this._preDelay.connect(this._convolver);
    this._convolver.connect(this._hp);
    this._hp.connect(this._lp);
    this._lp.connect(this._wetGain);
    this._wetGain.connect(this._out);

    this._wetConnected = false;
    this.wet = options.wet ?? 0.3;
  }

  // ---- IR synthesis ----

  _buildImpulse() {
    const sr = this.ctx.sampleRate;
    const length = Math.floor(sr * this._decay);
    const buf = this.ctx.createBuffer(2, length, sr);
    const dataL = buf.getChannelData(0);
    const dataR = buf.getChannelData(1);

    // Frequency-dependent decay: damping controls how fast HF content dies.
    // We apply a per-sample low-pass via a simple one-pole filter on the noise.
    // Higher damping = more HF rolloff over time = warmer, darker tail.
    const dampCoeff = 0.2 + this._damping * 0.7; // 0.2 (bright) to 0.9 (dark)

    // Generate decorrelated noise for L and R
    let lpStateL = 0;
    let lpStateR = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      // Envelope: combination of exponential decay + linear taper for natural tail
      const env = Math.exp(-3 * t) * (1 - t);

      // White noise, independently per channel for stereo decorrelation
      const noiseL = Math.random() * 2 - 1;
      const noiseR = Math.random() * 2 - 1;

      // One-pole LP filter: progressively cuts highs as time increases
      // The cutoff tightens over time, simulating air absorption
      const timeVaryingDamp = dampCoeff * t;
      lpStateL += (noiseL - lpStateL) * (1 - timeVaryingDamp);
      lpStateR += (noiseR - lpStateR) * (1 - timeVaryingDamp);

      dataL[i] = lpStateL * env;
      dataR[i] = lpStateR * env;
    }

    // Early reflections: discrete taps simulating first wall bounces
    // These give the reverb a sense of room geometry
    const earlyTaps = [
      { time: 0.007, gain: 0.7 },
      { time: 0.013, gain: 0.55 },
      { time: 0.022, gain: 0.45 },
      { time: 0.034, gain: 0.35 },
      { time: 0.048, gain: 0.25 },
      { time: 0.065, gain: 0.18 },
    ];
    for (const tap of earlyTaps) {
      const idx = Math.floor(tap.time * sr);
      if (idx < length) {
        // Alternate L/R panning for spatial early reflections
        dataL[idx] += tap.gain * (0.7 + Math.random() * 0.3);
        dataR[idx] += tap.gain * (0.7 + Math.random() * 0.3);
      }
    }

    // Stereo width: crossfade between L and R channels
    // width=0 → mono (L=R=mid), width=1 → full stereo (independent L/R)
    if (this._width < 1) {
      const mid = 1;
      const side = this._width;
      for (let i = 0; i < length; i++) {
        const m = (dataL[i] + dataR[i]) * 0.5;
        const s = (dataL[i] - dataR[i]) * 0.5;
        dataL[i] = m * mid + s * side;
        dataR[i] = m * mid - s * side;
      }
    }

    // Normalize to prevent clipping
    let peak = 0;
    for (let i = 0; i < length; i++) {
      peak = Math.max(peak, Math.abs(dataL[i]), Math.abs(dataR[i]));
    }
    if (peak > 0) {
      const norm = 0.85 / peak;
      for (let i = 0; i < length; i++) {
        dataL[i] *= norm;
        dataR[i] *= norm;
      }
    }

    return buf;
  }

  /** Rebuild the IR (called when decay, damping, or width change).
   *  Debounced to avoid blocking the main thread during knob drags. */
  _rebuild() {
    clearTimeout(this._rebuildTimer);
    this._rebuildTimer = setTimeout(() => {
      this._convolver.buffer = this._buildImpulse();
    }, 120);
  }

  // ---- Properties ----

  get wet() {
    return this._wetGain.gain.value;
  }
  set wet(v) {
    v = Math.max(0, Math.min(1, v));
    const wasZero = this._wetGain.gain.value === 0;
    this._wetGain.gain.value = v;
    // Connect/disconnect wet processing chain to save CPU
    if (v > 0 && !this._wetConnected) {
      this._in.connect(this._preDelay);
      this._wetConnected = true;
    } else if (v === 0 && this._wetConnected) {
      this._in.disconnect(this._preDelay);
      this._wetConnected = false;
    }
  }

  /** Decay tail length in seconds. Rebuilds the impulse response. */
  get decay() {
    return this._decay;
  }
  set decay(v) {
    this._decay = Math.max(0.1, v);
    this._rebuild();
  }

  /** Pre-delay in milliseconds (0–80). */
  get preDelay() {
    return this._preDelay.delayTime.value * 1000;
  }
  set preDelay(ms) {
    this._preDelay.delayTime.setTargetAtTime(Math.max(0, Math.min(80, ms)) / 1000, this.ctx.currentTime, 0.02);
  }

  /** High-pass frequency on wet path (Hz). */
  get hpFreq() {
    return this._hp.frequency.value;
  }
  set hpFreq(hz) {
    this._hp.frequency.setTargetAtTime(hz, this.ctx.currentTime, 0.02);
  }

  /** Low-pass / damping frequency on wet path (Hz). */
  get lpFreq() {
    return this._lp.frequency.value;
  }
  set lpFreq(hz) {
    this._lp.frequency.setTargetAtTime(hz, this.ctx.currentTime, 0.02);
  }

  /** HF damping amount (0 = bright, 1 = dark). Rebuilds the impulse response. */
  get damping() {
    return this._damping;
  }
  set damping(v) {
    this._damping = Math.max(0, Math.min(1, v));
    this._rebuild();
  }

  /** Stereo width (0 = mono, 1 = full stereo). Rebuilds the impulse response. */
  get width() {
    return this._width;
  }
  set width(v) {
    this._width = Math.max(0, Math.min(1, v));
    this._rebuild();
  }

  /** Entry point — upstream sources connect here. */
  get input() {
    return this._in;
  }

  connect(node) {
    this._out.connect(node.input ?? node);
    return this;
  }
}
