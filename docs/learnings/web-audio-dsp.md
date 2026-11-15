# Learnings — Web Audio DSP

## Web Audio envelopes: post-release "swell" on short notes

**Symptom:** Long-attack sounds (pads) on short sequenced steps are silent during
the note, click at note-off, then swell back up *after* release and get cut off
when the oscillator stops.

**Root cause:** Automation events are sorted by time, and each ramp starts from
the *previous* event. Scheduling `ramp(peak, start+attack)` / `ramp(sus, start+attack+decay)`
and then `set(sus, releaseAt)` + release ramp leaves the attack/decay ramps
*after* the release when the note is shorter than attack+decay.

**Fix:** `scheduleEnvelope` in `global/dsp/envelope.js` computes the level at
note-off and only schedules segments before it. Give long sounds a long
`gate` (note length in steps) instead of extending notes implicitly. A
recording-param timeline evaluator in `tests/envelope.test.js` asserts the
audible contour (no rise after note-off).
