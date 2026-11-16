/**
 * MasterLimiter — safety limiter for the end of the master bus.
 *
 *   in → DynamicsCompressor (fast, high ratio, just under 0 dBFS)
 *      → WaveShaper ceiling (catches the compressor's attack overshoot)
 *      → out
 *
 * Keeps a hot mix from clipping the output / recordings. Bypassable
 * (`enabled = false` routes in → out untouched). Audio only — the transport
 * strip shows a toggle; the headless SongPlayer uses it the same way.
 */

/** Ceiling of the waveshaper (linear). ~-0.1 dBFS. */
const CEILING = 0.989;
/** Where the shaper starts bending (linear). Below this the signal is untouched. */
const KNEE_START = 0.9;

/** Transparent below KNEE_START, smooth knee up to CEILING, flat beyond (input clamps to ±1 → CEILING). */
export function makeCeilingCurve(n = 4096) {
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    let y;
    if (a <= KNEE_START) y = a;
    else {
      const t = (a - KNEE_START) / (1 - KNEE_START); // 0..1 across the knee
      y = KNEE_START + (CEILING - KNEE_START) * Math.sin((t * Math.PI) / 2);
    }
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}

export class MasterLimiter {
  /**
   * @param {AudioContext} ctx
   * @param {{ enabled?: boolean }} [o]
   */
  constructor(ctx, { enabled = true } = {}) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this._out = ctx.createGain();

    this._comp = ctx.createDynamicsCompressor();
    const set = (param, v) => {
      if (param && "value" in param) param.value = v;
    };
    set(this._comp.threshold, -1.5);
    set(this._comp.knee, 0);
    set(this._comp.ratio, 20);
    set(this._comp.attack, 0.001);
    set(this._comp.release, 0.12);

    this._ceiling = ctx.createWaveShaper();
    this._ceiling.curve = makeCeilingCurve();
    this._ceiling.oversample = "4x";

    this._comp.connect(this._ceiling);
    this._ceiling.connect(this._out);
    this._enabled = null;
    this.enabled = enabled;
  }

  get enabled() {
    return this._enabled;
  }

  set enabled(v) {
    v = !!v;
    if (v === this._enabled) return;
    this._enabled = v;
    this.input.disconnect();
    this.input.connect(v ? this._comp : this._out);
  }

  /** Current gain reduction in dB (≤ 0), for a meter. */
  get reduction() {
    const r = this._comp.reduction;
    return typeof r === "number" ? r : (r?.value ?? 0);
  }

  connect(node) {
    this._out.connect(node.input ?? node);
    return this;
  }

  disconnect() {
    this._out.disconnect();
  }

  /** Recorder etc. tap `output`. */
  get output() {
    return this._out;
  }
}

export default MasterLimiter;
