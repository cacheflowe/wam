/**
 * WebAudioFxReverb — ConvolverNode with a synthesized impulse response.
 *
 * The impulse response is generated synchronously at construction time
 * (no async/await needed, unlike Tone.js Reverb). The dry signal always
 * passes through at full gain; the wet gain controls reverb amount.
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
 *
 * Usage:
 *   const reverb = new WebAudioFxReverb(ctx, { decay: 3, wet: 0.4 });
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

    this._convolver.buffer = this._buildImpulse(options.decay ?? 2.5);

    // in → dry → out
    this._in.connect(this._dry);
    this._dry.connect(this._out);
    this._dry.gain.value = 1;

    // in → preDelay → convolver → hp → lp → wetGain → out
    this._in.connect(this._preDelay);
    this._preDelay.connect(this._convolver);
    this._convolver.connect(this._hp);
    this._hp.connect(this._lp);
    this._lp.connect(this._wetGain);
    this._wetGain.connect(this._out);

    this.wet = options.wet ?? 0.3;
  }

  _buildImpulse(duration) {
    const ctx = this.ctx;
    const length = Math.floor(ctx.sampleRate * duration);
    const buf = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        // Exponential decay envelope on white noise
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2);
      }
    }
    return buf;
  }

  get wet() { return this._wetGain.gain.value; }
  set wet(v) { this._wetGain.gain.value = Math.max(0, Math.min(1, v)); }

  /** Pre-delay in milliseconds (0–80). */
  get preDelay() { return this._preDelay.delayTime.value * 1000; }
  set preDelay(ms) { this._preDelay.delayTime.value = Math.max(0, Math.min(80, ms)) / 1000; }

  /** High-pass frequency on wet path (Hz). */
  get hpFreq() { return this._hp.frequency.value; }
  set hpFreq(hz) { this._hp.frequency.value = hz; }

  /** Low-pass / damping frequency on wet path (Hz). */
  get lpFreq() { return this._lp.frequency.value; }
  set lpFreq(hz) { this._lp.frequency.value = hz; }

  /** Entry point — upstream sources connect here. */
  get input() { return this._in; }

  connect(node) {
    this._out.connect(node.input ?? node);
    return this;
  }
}
