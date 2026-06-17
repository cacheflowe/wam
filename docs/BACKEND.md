# Audio Engine Layer

This project has no server-side backend. "Backend" in this context refers to the audio engine: the instrument classes, effects, worklet processors, sequencer, and music theory utilities that run below the UI layer.

## AudioContext Lifecycle

The `AudioContext` is created once by the app and passed to every instrument and effect constructor:

```js
const ctx = new AudioContext();
// Must resume on user gesture:
document.addEventListener("click", () => ctx.resume(), { once: true });
```

All audio nodes are children of this context. Nodes from different contexts cannot be connected.

## Instrument Classes

All instruments follow the same interface:

```js
class WebAudioSynthAcid {
  constructor(ctx, preset = "Default")  // create nodes, apply preset
  trigger(midi, durationSec, velocity, atTime)  // schedule a note
  connect(node)                          // route output to downstream node
  get input()                            // expose input for upstream nodes
  applyPreset(name)                      // apply a named preset
  reset()                                // clear portamento / last-note state
}
```

### Instrument Inventory

| Class | File | Type | Notable Features |
|---|---|---|---|
| `WebAudioSynthAcid` | `synth-acid.js` | Mono bass | Filter sweep, portamento, unison, distortion |
| `WebAudioSynth808` | `synth-808.js` | Pitched bass | Pitch sweep, click transient, sub oscillator |
| `WebAudioSynthFM` | `synth-fm.js` | Poly FM | 2-op FM, mod envelope, BPM-synced filter LFO, chord mode |
| `WebAudioSynthMono` | `synth-mono.js` | Mono | Saw/square/tri, ADSR, filter envelope, sub osc |
| `WebAudioSynthPad` | `synth-pad.js` | Poly pad | Chord voicing, constant-power voice scaling |
| `WebAudioSynthPoly` | `synth-poly.js` | Poly subtractive | Dual osc + sub + noise, unison, per-voice filter ADSR + key track, dual tempo-syncable LFOs, voice stealing, chords. Built on the shared `dsp/` primitives. |
| `WebAudioSynthBlipFX` | `synth-blipfx.js` | SFX | 6 waveforms, FM, bit-crush, randomization |
| `WebAudioPercKick` | `perc-kick.js` | Percussion | Sine sweep, pitch envelope |
| `WebAudioPercHihat` | `perc-hihat.js` | Percussion | Bandpass noise, open/closed character |
| `WebAudioLoopPlayer` | `sample-looper.js` | Loop player | Continuous loop playback, BPM sync, time-stretch, reverse, random jumps |

### Fire-and-Forget Voice Architecture

No voice pool. Each `trigger()` call creates a fresh `OscillatorNode` / `GainNode` / `BiquadFilterNode` chain, schedules it on the Web Audio timeline, and cleans up via `osc.onended`:

```js
osc.onended = () => { osc.disconnect(); vca.disconnect(); };
```

The browser's GC reclaims nodes after `stop()` completes. This gives unlimited polyphony at the cost of node creation per trigger; at typical BPMs this is negligible.

### Static PRESETS + applyPreset()

```js
static PRESETS = {
  Default: { cutoff: 600, resonance: 18, ... },
  Squelch: { cutoff: 400, resonance: 24, ... },
};

applyPreset(name) {
  const p = WebAudioSynthAcid.PRESETS[name];
  if (!p) return;
  if (p.cutoff != null) this.cutoff = p.cutoff; // != null allows 0
}
```

The `!= null` guard allows partial presets; new parameters can be added without invalidating existing preset objects.

### Shared DSP primitives (`global/dsp/`)

Common per-voice DSP is factored into standalone functions that **schedule on existing AudioParams or create nodes at a caller-controlled point** — keeping the fire-and-forget model (no stateful classes, synths still own their node graph and creation order).

| File | Export | Used by | Purpose |
|---|---|---|---|
| `dsp/envelope.js` | `applyADSR` | mono, pad, poly | Linear ADSR contour on a VCA gain param. |
| `dsp/envelope.js` | `applyFilterEnv` | mono, poly | Octave-based ADSR filter sweep (`base·2^envAmt`). |
| `dsp/oscillator.js` | `createUnisonOscBank` | mono, poly | Detuned unison oscillators with optional portamento glide. |
| `dsp/distortion.js` | `makeSoftClipCurve` | acid, 808 | Soft-clip waveshaper curve. |

`WebAudioSynthPoly` (the flagship subtractive synth) is built entirely on these primitives — it's the proof that the foundation supports new instruments.

These are intentionally not forced onto every synth: acid's unison (per-voice gain + cleanup), pad's shared-filter envelope, and FM's exponential operator envelopes are genuinely distinct and stay bespoke. The primitives are also the foundation for future synths.

**Regression guard:** [tests/synth-dsp-snapshot.test.js](tests/synth-dsp-snapshot.test.js) records each synth's exact `trigger()` automation (via [tests/helpers/recording-context.js](tests/helpers/recording-context.js)) so any change to the scheduled sound shows up as a snapshot diff. The refactor above is byte-identical against these snapshots.

## Effects Classes

All effects expose the same `connect()` / `input` interface as instruments.

| Class | File | Dry/Wet | Notes |
|---|---|---|---|
| `WebAudioFxReverb` | `fx-reverb.js` | Yes | Synthesized IR, convolution reverb |
| `WebAudioFxDelay` | `fx-delay.js` | Yes | BPM-synced, LP feedback filter, LFO |
| `WebAudioFxChorus` | `fx-chorus.js` | Yes | 1–6 voices, stereo spread, feedback |
| `WebAudioFxFilter` | `fx-filter.js` | No (always inline) | Series HP → LP, shared Q |
| `WebAudioFxDistortion` | `fx-distortion.js` | Yes | Soft-clip waveshaper |
| `WebAudioFxCompressor` | `fx-compressor.js` | Bypass until source picked | Per-channel sidechain ducker. AudioWorklet envelope follower (attack/release/threshold) ducks the channel by a key tap chosen in the FX UI. Params: `amount`, `attack`, `release`, `threshold`. Release can tempo-sync to a beat division; worklet posts live gain reduction (`comp.reduction` / `onReduction`) for a meter. |
| `WebAudioFxUnit` | `fx-unit.js` | Per-effect | Web Component composing all above |

### Bus-based FX (instrument-tap inputs)

Unlike the inline FX above, these take their input from one or more **instrument bus taps** (selected at runtime via `<wam-instrument-source-picker>`) rather than sitting in a single instrument's chain. Each ships a `*Controls` panel extending `WebAudioControlsBase`.

| Class | File | Control element | Notes |
|---|---|---|---|
| `WebAudioVocoderFx` | `fx-vocoder.js` | `<wam-vocoder-fx-controls>` | Wraps `WebAudioVocoder` in `external` carrier mode. Two taps — modulator (analysis, e.g. vocals) and carrier (resynthesis, e.g. a pad). Internal osc/noise gains are 0; external sources only. |

`WebAudioVocoder` (in `vocoder.js`) gained a `carrierType = "external"` mode exposing `carrierInput` and `modulatorInput` GainNodes so the bus-tap wrapper can feed it.

> Sidechain ducking is now a per-channel FX-strip stage (`WebAudioFxCompressor`), not a bus-based master effect — see the FX table above. The old master-bus `WebAudioSidechainFx` was retired in favor of that pattern.

### FxUnit Internal Routing

Stages run **serially**, each feeding the next:

```
input → WebAudioFxFilter → WebAudioFxDelay → WebAudioFxChorus → WebAudioFxReverb → WebAudioFxCompressor → out
```

The compressor is the final stage. Its sidechain key (input 1) comes from a track tap selected via `<wam-instrument-source-picker>` in the FX UI; with no source selected it passes audio through untouched. See [audio-routing.md](docs/references/audio-routing.md) for the sidechain detail.

## AudioWorklet Processors

| File | Purpose |
|---|---|
| `pitch-shift.worklet.js` | Granular overlap-add pitch shift (loaded by `WebAudioPitchShift`) |
| `time-stretch.worklet.js` | Granular time-stretch with independent speed/pitch (loaded by `WebAudioTimeStretch`) |
| `fx-compressor.worklet.js` | Sidechain ducking envelope follower (loaded by `WebAudioFxCompressor`) — 2 inputs (audio + key), attack/release/threshold/amount |

Worklets must be registered before use:

```js
await ctx.audioWorklet.addModule(
  new URL("./pitch-shift.worklet.js", import.meta.url).href
);
```

## Sequencer

`WebAudioSequencer` (in `sequencer.js`) implements the Chris Wilson lookahead technique:

- `setInterval` fires every 25ms
- Each tick pre-schedules steps within the next 100ms window
- Steps are Web Audio events, not JS timers — sample-accurate

```js
const seq = new WebAudioSequencer(ctx, { bpm: 128, steps: 16 });
seq.onStep((step, time) => {
  if (pattern[step]) instrument.trigger(midi, dur, vel, time);
});
seq.start();
seq.bpm = 140; // live tempo change
```

## Music Theory Utilities

`scales.js` exports:

| Export | Description |
|---|---|
| `SCALES` | 8 scales ordered dark-to-bright: Phrygian, Blues, Minor, Dorian, Pentatonic Minor, Pentatonic Major, Major, Lydian |
| `scaleNotesInRange(root, scale, min, max)` | All MIDI notes matching a scale within a MIDI range |
| `scaleNoteOptions(root, scale, min, max)` | `[["C2", 36], ...]` pairs suitable for `<select>` options |
| `buildChordFromScale(root, scale, size)` | Stacked-thirds chord builder |
| `STEP_WEIGHTS` | 16-entry trigger probability array (higher weight on downbeats) |
| `LEAD_OSC_TYPES` | Oscillator type names mapped dark-to-bright |

## Audio Routing Convention

See [references/audio-routing.md](references/audio-routing.md) for the full `connect()` / `input` routing protocol and graph assembly patterns.

## MIDI Hardware Control

Hardware drivers live in [src/web-audio/midi/](../src/web-audio/midi/). They sit below the UI and consume the normalized input layer (see [docs/FRONTEND.md](FRONTEND.md#input-abstraction--learn)).

| File | Export | Purpose |
|---|---|---|
| `launch-control-xl.js` | `CONTROLS`, `LED`, `setLedsMessage()`, `templateFromChannel()`, … | Full Novation Launch Control XL reference: control map, LED color palette, and sysex/channel-message builders. See [references/launch-control-xl.md](references/launch-control-xl.md). |
| `midi-output.js` | `MidiOutput` | Safe, rate-limited LED/sysex output: queues changes and flushes at most once per `requestAnimationFrame` as a single multi-pair sysex, deduped on quantized color. |
| `led-feedback.js` | `ledFeedback` singleton | Mirrors `wam-binding-feedback` (bound / unbound / value) to LCXL LEDs. |
| `sequencer-hardware.js` | `sequencerHardware` singleton | Maps the LCXL's 16 buttons to sequencer steps; lights active steps + playhead and follows the focused instrument via `wam-instrument-focus-change`. |

**Reliability is load-bearing here.** On Windows, flooding sysex (one message per incoming CC) or opening a second `MIDIAccess` wedges the device's input until it is physically replugged. Always batch LED output through `MidiOutput` and reuse the single `MIDIAccess` owned by `<wam-midi-input-picker>`. Full failure mode + mitigation: [docs/RELIABILITY.md](RELIABILITY.md) and [references/launch-control-xl.md](references/launch-control-xl.md#reliability--hard-won-lessons-windows-especially).
