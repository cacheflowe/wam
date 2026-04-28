/**
 * WebAudioFxFilter — combined HP + LP with a single bipolar sweep control.
 *
 * Audio chain:  in → HPF → LPF → out
 *
 * sweep = 0   → both filters at bypass (HP: 20Hz, LP: 20kHz) — no effect
 * sweep < 0   → LP sweeps down: 0 → -1 maps 20kHz → 80Hz (log). HP stays at 20Hz.
 * sweep > 0   → HP sweeps up:   0 → +1 maps 20Hz → 8kHz  (log). LP stays at 20kHz.
 *
 * Always inline (no dry/wet) — acts as a DJ-style sweep filter.
 */

export const SWEEP_LP_MAX = 20000;
export const SWEEP_LP_MIN = 80;
export const SWEEP_HP_MIN = 20;
export const SWEEP_HP_MAX = 8000;

/** Map sweep position (-1..0) to LP cutoff frequency. */
export function sweepToLpFreq(v) {
  return SWEEP_LP_MAX * Math.pow(SWEEP_LP_MIN / SWEEP_LP_MAX, -Math.min(0, v));
}

/** Map sweep position (0..+1) to HP cutoff frequency. */
export function sweepToHpFreq(v) {
  return SWEEP_HP_MIN * Math.pow(SWEEP_HP_MAX / SWEEP_HP_MIN, Math.max(0, v));
}

export default class WebAudioFxFilter {
  constructor(ctx, options = {}) {
    this._sweep = options.sweep ?? 0;

    this._hp = ctx.createBiquadFilter();
    this._hp.type = "highpass";
    this._hp.Q.value = options.q ?? 0.7;

    this._lp = ctx.createBiquadFilter();
    this._lp.type = "lowpass";
    this._lp.Q.value = options.q ?? 0.7;

    // in → hp → lp → out
    this._hp.connect(this._lp);

    // Apply initial sweep (sets both filter frequencies)
    this.sweep = this._sweep;
  }

  get sweep() {
    return this._sweep;
  }
  set sweep(v) {
    this._sweep = Math.max(-1, Math.min(1, v));
    this._lp.frequency.value = sweepToLpFreq(this._sweep);
    this._hp.frequency.value = sweepToHpFreq(this._sweep);
  }

  // Direct setters kept for programmatic use / backwards-compat
  get lpFreq() {
    return this._lp.frequency.value;
  }
  set lpFreq(v) {
    this._lp.frequency.value = v;
  }

  get hpFreq() {
    return this._hp.frequency.value;
  }
  set hpFreq(v) {
    this._hp.frequency.value = v;
  }

  get q() {
    return this._lp.Q.value;
  }
  set q(v) {
    this._lp.Q.value = v;
    this._hp.Q.value = v;
  }

  get input() {
    return this._hp;
  }

  connect(node) {
    this._lp.connect(node.input ?? node);
    return this;
  }
}
