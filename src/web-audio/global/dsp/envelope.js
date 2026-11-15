/**
 * Shared envelope scheduling helpers for fire-and-forget synth voices.
 *
 * These functions schedule automation on an existing AudioParam — they create
 * no nodes — so a synth keeps its own node graph and creation order. That makes
 * them safe drop-in replacements for the hand-written ADSR blocks duplicated
 * across the instruments.
 *
 * Gate semantics: the note is released at `releaseAt` no matter where the
 * envelope is. If that lands mid-attack or mid-decay, the envelope stops at the
 * level it had actually reached and releases from there — like an analog ADSR.
 *
 * Why this matters: Web Audio sorts automation events by time, and a ramp
 * always starts from the *previous* event. Naively scheduling the attack/decay
 * ramps and then a release at a fixed note-off time puts events out of
 * order whenever the note is shorter than attack+decay: the param sits at its
 * start value until note-off, jumps, releases, then the late attack ramp
 * swells the voice back up after release. We only schedule the segments that
 * occur before `releaseAt`.
 */

/**
 * Schedule a gated attack → decay → sustain → release contour.
 *
 * Attack is always linear. Decay and release are linear or exponential
 * (`curve: "exponential"` requires `from`, `sustain`, `peak` and `to` > 0).
 *
 * @param {AudioParam} param
 * @param {object} o
 * @param {number} o.start        Note start time (AudioContext seconds).
 * @param {number} o.releaseAt    Note-off time.
 * @param {number} o.peak         Level reached at the end of the attack.
 * @param {number} o.sustain      Absolute sustain level (not a fraction).
 * @param {number} o.attack       Attack time (s).
 * @param {number} o.decay        Decay time (s).
 * @param {number} o.release      Release time (s).
 * @param {number} [o.from=0]     Starting level.
 * @param {number} [o.to=from]    Level the release returns to.
 * @param {"linear"|"exponential"} [o.curve="linear"]  Decay/release curve.
 * @returns {number} The level at `releaseAt` (where the release starts from).
 */
export function scheduleEnvelope(
  param,
  { start, releaseAt, peak, sustain, attack, decay, release, from = 0, to = from, curve = "linear" },
) {
  const exp = curve === "exponential";
  const ramp = exp ? "exponentialRampToValueAtTime" : "linearRampToValueAtTime";
  const atk = Math.max(0, attack);
  const dec = Math.max(0, decay);
  const held = Math.max(0, releaseAt - start);

  param.setValueAtTime(from, start);

  let level;
  if (held < atk) {
    // Released mid-attack: stop the ramp where it actually got to.
    level = from + (peak - from) * (held / atk);
    param.linearRampToValueAtTime(level, releaseAt);
  } else {
    param.linearRampToValueAtTime(peak, start + atk);
    if (held < atk + dec) {
      // Released mid-decay: stop the decay where it actually got to.
      const f = (held - atk) / dec;
      level = exp ? peak * Math.pow(sustain / peak, f) : peak + (sustain - peak) * f;
      param[ramp](level, releaseAt);
    } else {
      level = sustain;
      // Zero-length when decay is 0 (an instant step); skipped for a pure
      // attack-hold contour where sustain === peak.
      if (dec > 0 || sustain !== peak) param[ramp](sustain, start + atk + dec);
      param.setValueAtTime(sustain, releaseAt);
    }
  }

  param[ramp](to, releaseAt + Math.max(0, release));
  return level;
}

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
  scheduleEnvelope(param, { start, releaseAt, peak, sustain: peak * sustain, attack, decay, release });
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
  scheduleEnvelope(param, {
    start,
    releaseAt,
    from: base,
    peak,
    sustain: sus,
    attack: Math.max(0.001, attack),
    decay,
    release,
  });
  return { peak, sus };
}
