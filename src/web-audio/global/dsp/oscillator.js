/**
 * Shared oscillator helpers for fire-and-forget synth voices.
 */

/**
 * Create a bank of detuned unison oscillators feeding a shared destination.
 *
 * Voices are spread symmetrically around center: voice i is offset by
 * `(i/(voices-1) - 0.5) · spread` cents (a single voice gets no offset). Each
 * oscillator optionally glides from a previous frequency (portamento).
 *
 * The caller owns the destination/mixer node (and any gain compensation on it),
 * so this helper only creates the oscillators — keeping node creation order
 * under the caller's control.
 *
 * @param {AudioContext} ctx
 * @param {object} o
 * @param {number} o.voices            Voice count (>=1).
 * @param {OscillatorType} o.type      Waveform.
 * @param {number} o.detune            Base detune applied to every voice (cents).
 * @param {number} o.spread            Total unison spread across voices (cents).
 * @param {number} o.freq              Target frequency (Hz).
 * @param {number} [o.glideFrom=0]     Frequency to glide from; glide skipped if <= 0.
 * @param {number} [o.glideTime=0]     Portamento time (s); glide skipped if <= 0.
 * @param {"linear"|"exp"} [o.glideCurve="linear"]  Glide ramp shape.
 * @param {number} o.start             Start time.
 * @param {number} o.stop              Stop time.
 * @param {AudioNode} o.dest           Destination node each oscillator connects to.
 * @returns {OscillatorNode[]} The created oscillators (already started/stopped).
 */
export function createUnisonOscBank(ctx, {
  voices,
  type,
  detune,
  spread,
  freq,
  glideFrom = 0,
  glideTime = 0,
  glideCurve = "linear",
  start,
  stop,
  dest,
}) {
  const oscs = [];
  for (let i = 0; i < voices; i++) {
    const offset = voices > 1 ? (i / (voices - 1) - 0.5) * spread : 0;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.detune.value = detune + offset;
    if (glideTime > 0 && glideFrom > 0) {
      osc.frequency.setValueAtTime(glideFrom, start);
      if (glideCurve === "exp") {
        osc.frequency.exponentialRampToValueAtTime(freq, start + glideTime);
      } else {
        osc.frequency.linearRampToValueAtTime(freq, start + glideTime);
      }
    } else {
      osc.frequency.value = freq;
    }
    osc.connect(dest);
    osc.start(start);
    osc.stop(stop);
    oscs.push(osc);
  }
  return oscs;
}
