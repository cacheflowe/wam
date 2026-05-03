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
| `WebAudioSynthAcid` | `wam-synth-acid.js` | Mono bass | Filter sweep, portamento, unison, distortion |
| `WebAudioSynth808` | `wam-synth-808.js` | Pitched bass | Pitch sweep, click transient, sub oscillator |
| `WebAudioSynthFM` | `wam-synth-fm.js` | Poly FM | 2-op FM, mod envelope, BPM-synced filter LFO, chord mode |
| `WebAudioSynthMono` | `wam-synth-mono.js` | Mono | Saw/square/tri, ADSR, filter envelope, sub osc |
| `WebAudioSynthPad` | `wam-synth-pad.js` | Poly pad | Chord voicing, constant-power voice scaling |
| `WebAudioSynthBlipFX` | `wam-synth-blipfx.js` | SFX | 6 waveforms, FM, bit-crush, randomization |
| `WebAudioPercKick` | `wam-perc-kick.js` | Percussion | Sine sweep, pitch envelope |
| `WebAudioPercHihat` | `wam-perc-hihat.js` | Percussion | Bandpass noise, open/closed character |
| `WebAudioBreakPlayer` | `wam-break-player.js` | Sampler | Loop playback, time-stretch, reverse, random jumps |

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

## Effects Classes

All effects expose the same `connect()` / `input` interface as instruments.

| Class | File | Dry/Wet | Notes |
|---|---|---|---|
| `WebAudioFxReverb` | `wam-fx-reverb.js` | Yes | Synthesized IR, convolution reverb |
| `WebAudioFxDelay` | `wam-fx-delay.js` | Yes | BPM-synced, LP feedback filter, LFO |
| `WebAudioFxChorus` | `wam-fx-chorus.js` | Yes | 1–6 voices, stereo spread, feedback |
| `WebAudioFxFilter` | `wam-fx-filter.js` | No (always inline) | Series HP → LP, shared Q |
| `WebAudioFxDistortion` | `wam-fx-distortion.js` | Yes | Soft-clip waveshaper |
| `WebAudioFxUnit` | `wam-fx-unit.js` | Per-effect | Web Component composing all above |

### FxUnit Internal Routing

```
input → WebAudioFxReverb  (parallel) ─┐
input → WebAudioFxDelay   (parallel) ─┤→ preOut → WebAudioFxFilter → out
input → WebAudioFxChorus  (parallel) ─┘
```

## AudioWorklet Processors

| File | Purpose |
|---|---|
| `wam-pitch-shift.worklet.js` | Granular overlap-add pitch shift (loaded by `WebAudioPitchShift`) |
| `wam-time-stretch.worklet.js` | Granular time-stretch with independent speed/pitch (loaded by `WebAudioTimeStretch`) |

Worklets must be registered before use:

```js
await ctx.audioWorklet.addModule(
  new URL("./wam-pitch-shift.worklet.js", import.meta.url).href
);
```

## Sequencer

`WebAudioSequencer` (in `wam-sequencer.js`) implements the Chris Wilson lookahead technique:

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

`wam-scales.js` exports:

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
