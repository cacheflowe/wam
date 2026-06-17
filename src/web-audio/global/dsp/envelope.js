/**
 * Shared envelope scheduling helpers for fire-and-forget synth voices.
 *
 * These functions schedule automation on an existing AudioParam — they create
 * no nodes — so a synth keeps its own node graph and creation order. That makes
 * them safe drop-in replacements for the hand-written ADSR blocks duplicated
 * across the instruments.
 */

/**
 * Schedule a linear ADSR contour on a gain-style AudioParam.
 *
 * Contour: 0 → peak (attack) → peak·sustain (decay) → held until `releaseAt`
 * → 0 (release). This matches the long-standing mono/pad amplitude envelope.
 *
 * @param {AudioParam} param      Target param (typically a VCA gain).
 * @param {object} o
 * @param {number} o.start        Note start time (AudioContext seconds).
 * @param {number} o.peak         Peak level (e.g. velocity).
 * @param {number} o.attack       Attack time (s).
 * @param {number} o.decay        Decay time (s).
 * @param {number} o.sustain      Sustain level as a fraction of peak (0–1).
 * @param {number} o.release      Release time (s).
 * @param {number} o.releaseAt    Time the note is released (start + duration).
 */
export function applyADSR(param, { start, peak, attack, decay, sustain, release, releaseAt }) {
  const sus = peak * sustain;
  param.setValueAtTime(0, start);
  param.linearRampToValueAtTime(peak, start + attack);
  param.linearRampToValueAtTime(sus, start + attack + decay);
  param.setValueAtTime(sus, releaseAt);
  param.linearRampToValueAtTime(0, releaseAt + release);
}

/**
 * Schedule an octave-based ADSR filter sweep on a filter frequency AudioParam.
 *
 * The peak cutoff is `base · 2^envAmtOctaves` (clamped to audible range), so the
 * envelope amount is expressed in octaves and can sweep downward when negative.
 * The sustain level interpolates between base and peak.
 *
 * @param {AudioParam} param        filter.frequency
 * @param {object} o
 * @param {number} o.base           Base cutoff (Hz).
 * @param {number} o.envAmtOctaves  Envelope depth in octaves (may be negative).
 * @param {number} o.sustain        Sustain fraction between base and peak (0–1).
 * @param {number} o.attack         Filter attack time (s; floored at 1ms).
 * @param {number} o.decay          Filter decay time (s).
 * @param {number} o.release        Filter release time (s).
 * @param {number} o.start          Note start time.
 * @param {number} o.releaseAt      Note release time.
 * @returns {{ peak: number, sus: number }} Computed peak/sustain frequencies.
 */
export function applyFilterEnv(param, { base, envAmtOctaves, sustain, attack, decay, release, start, releaseAt }) {
  const peak = Math.max(20, Math.min(20000, base * Math.pow(2, envAmtOctaves)));
  const sus = base + (peak - base) * sustain;
  const atk = Math.max(0.001, attack);
  param.setValueAtTime(base, start);
  param.linearRampToValueAtTime(peak, start + atk);
  param.linearRampToValueAtTime(sus, start + atk + decay);
  param.setValueAtTime(sus, releaseAt);
  param.linearRampToValueAtTime(base, releaseAt + release);
  return { peak, sus };
}
