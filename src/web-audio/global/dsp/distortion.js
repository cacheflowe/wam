/**
 * Shared waveshaper curve generators for synth/effect distortion.
 */

/**
 * Build a soft-clip (arctan-like) waveshaper curve.
 *
 * curve(x) = ((π + k)·x) / (π + k·|x|),  k = amount·200
 * At amount 0 the curve is the identity (no shaping). Higher amounts push
 * toward harder clipping. This is the curve used by the acid and 808 synths.
 *
 * @param {number} amount  Drive amount (0 = clean).
 * @param {number} [n=512] Curve resolution (samples).
 * @returns {Float32Array}
 */
export function makeSoftClipCurve(amount, n = 512) {
  const curve = new Float32Array(n);
  const k = amount * 200;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = k > 0 ? ((Math.PI + k) * x) / (Math.PI + k * Math.abs(x)) : x;
  }
  return curve;
}
