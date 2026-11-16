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
| `WebAudioSynthFM` | `synth-fm.js` | Poly FM | 2-op FM, mod envelope, BPM-synced filter LFO, chord mode, unison |
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

### Presets (JSON data + applyPreset())

Presets live in JSON data files, one per instrument: `src/web-audio/presets/<instrument-id>.json`. The instrument module imports its file, so importing one instrument still gets you its presets:

```js
import presetData from "../presets/synth-acid.json" with { type: "json" };
import { presetMap } from "../global/presets.js";

static PRESET_DATA = presetData;          // { instrument, presets: [{ name, tags, params }] }
static PRESETS = presetMap(presetData);   // { name: params } — the shape applyPreset() reads
```

`applyPreset(name)` (in `instrument-base.js`) sets every key in the preset's `params` on the instrument. Presets are **complete** for every *sound* param in the instrument's `PARAMS` schema, so switching presets never leaves values behind from the previous sound. *Part-level* params (octave, octave jump, gate, voice limit — see `isPartParam` in `global/presets.js`) are deliberately left out, so changing the sound doesn't change the part. `volume` is the instrument's own output gain (not the channel-strip fader). [tests/presets.test.js](tests/presets.test.js) enforces both rules.

**Saving presets.** Under `npm run dev`, the Presets panel's Save/Del buttons write straight to the JSON file through a dev-only Vite plugin ([vite-plugins/wam-preset-store.js](vite-plugins/wam-preset-store.js), `POST`/`DELETE /__wam/presets/<id>`). Its own writes skip HMR so saving mid-jam doesn't reload the page. Production builds have no endpoint and fall back to localStorage user presets. Presets can carry `tags`; when any preset is tagged, the dropdown groups by first tag. ◀ ▶ (and `controls.stepPreset(±1)`) step through presets.

### Headless playback stack (architecture-refactor Phase 1)

Everything that makes sound is plain classes; Web Components are UI over them.

| Piece | File | Role |
|---|---|---|
| Instrument registry | `instruments/registry.js` | Type id → class, controls tag, color, constructor options, default FX, `sequenced`, app sample set. `createInstrument`, `controlsOptions`. |
| `FxChain` | `fx/fx-chain.js` | filter → delay → chorus → reverb → sidechain compressor. Flat params via `set()`, `toJSON`/`fromJSON` (+ legacy save normalization), BPM sync. `<wam-fx-unit>` is its UI (`fxUnit.chain`). |
| `Channel` | `global/channel.js` | instrument → input → [FxChain] → preFader (bus tap) → fader → pan. Fader gain is **derived**: `volume × !muted × !soloSuppressed` — volume, mute and solo are independent state (no "pre-mute volume" juggling). Controls own one (`ctrl._channel`); the strip is UI over its fader state. `gainFaderState()` applies the same model to a single node (master bus). |
| `Clock` | `global/clock.js` | The one musical clock: wraps the lookahead `WebAudioSequencer`, owns the tick since Play, emits `{ tick, step, bar, beat, downbeat, time, dur, bpm }` to `onTick` subscribers; `advance(time)` for offline/tests. Panels read `clock.current.tick`. |
| `PatternTrack` | `global/pattern-track.js` | Pattern playback derived from the clock tick (below). |
| `MasterLimiter` | `fx/fx-limiter.js` | End-of-master safety limiter (fast compressor + waveshaper ceiling ≈ −0.1 dBFS), bypassable; used by `<wam-transport>` ("Limit" toggle, `transport.limiter`) and `SongPlayer`. |
| `SongPlayer` | `global/song-player.js` | Loads a song JSON → registry instruments + Channels + PatternTracks on one `WebAudioSequencer` clock; master = gain → FxChain (same order as `<wam-transport>`). Verified step-for-step against the UI panels (`tests/song-player.test.js`). |

**Instrument musical context (public API, `instrument-base.js`):** `setScale(root, scaleName)`, `scaleName`, `scaleRoot`, `chordSize`, `bpm`, and `onTick(step)` (per-tick hook; acid's filter LFO uses it). Sampler adds `melodicMode`. Controls and the song player both use these — no more writing `instrument._scaleName` / `_chordSize` / `_bpm` from outside.

### Pattern playback (`global/pattern-track.js`)

Pattern playback is headless. `PatternTrack` holds a track's patterns (A–D), chain and params, and `tick(tick, time, stepDur)` returns what sounds on that tick. Everything is **derived from the tick count since Play** (Interphase-style: one clock, tracks compute their position) rather than accumulated in counters:

- **Cycle** = one pass through the 16 steps: 16 ticks at 1×, 8 at 2× (two sub-steps per tick), 32 at 0.5× (a step every other tick).
- **Density** (`playEvery`) plays every Nth cycle. **Chain position, rotation and trig conditions count *played* cycles**, so with density 2 a chain A→B plays A, –, B, –, and `1:2` fires on every other played cycle.
- **Rotation** is an index offset applied at read time — the stored pattern (and saved song) never moves; the grid playhead shows the rotated position.
- **Play** (tick 0) always starts at the top of the chain. **Launching** a pattern replaces the chain with it at the next cycle start (immediately when on a boundary).
- Probability and conditions are checked per step (`stepFires`); ratchets and gate are applied by the instrument (`_triggerRatcheted`).

`WebAudioControlsBase.step()` delegates to its `PatternTrack` (sharing the panel's pattern/chain arrays) and only applies the result: trigger the instrument, follow the chain in the UI, play queued jams. Behavior is pinned by [tests/pattern-playback.test.js](tests/pattern-playback.test.js) (through the song format) and [tests/pattern-track.test.js](tests/pattern-track.test.js) (the pure engine).

### Param schema (`global/param-schema.js`)

Instruments declare their parameters as `static PARAMS` on the **instrument** class (not the Controls class), so the engine knows its own params headless. Each entry carries range/scale/step plus `group` (UI section + randomize-lock unit), `role` (shared vocabulary that drives hardware mapping — the same role lands on the same knob on every instrument), `priority`, and `rand` (the curated, musically useful sub-range for randomize/mutate, or `false`). Enum and bool params are included. Controls derive `SLIDER_DEFS = sliderDefs(Instrument.PARAMS)` and build each knob with `mkSlider("param", overrides?)`, so a param is declared exactly once. Migration status and the role list: [exec-plans/active/jammable-playground.md](exec-plans/active/jammable-playground.md). Validation: [tests/param-schema.test.js](tests/param-schema.test.js).

### Sound design engine (`global/sound-design.js`)

Randomize / mutate / undo for any instrument with `static PARAMS`, no DOM required. `randomizeValues` draws each param inside its curated `rand` range (log params log-uniformly; enums by `rand.weights`); `mutateValues(amount)` takes a gaussian step sized to `amount` × the rand range in normalized space (values already outside the range never wander further out). Both skip `rand: false` and locked params/groups and run the instrument's optional `static constrain(values)` for cross-param rules. `SoundHistory` provides undo/redo. Headless helpers `randomizeInstrument` / `mutateInstrument` let generative apps use it directly; the Controls UI wraps the pure functions and applies results through the `knob-input` event path.

### Shared DSP primitives (`global/dsp/`)

Common per-voice DSP is factored into standalone functions that **schedule on existing AudioParams or create nodes at a caller-controlled point** — keeping the fire-and-forget model (no stateful classes, synths still own their node graph and creation order).

| File | Export | Used by | Purpose |
|---|---|---|---|
| `dsp/envelope.js` | `scheduleEnvelope` | acid (VCA), via wrappers below | Gated A→D→S→R core, linear or exponential decay/release. If note-off lands mid-attack/decay, releases from the level actually reached. |
| `dsp/envelope.js` | `applyADSR` | mono, pad, poly, FM (mod env) | Linear ADSR contour on a VCA gain param. |
| `dsp/envelope.js` | `applyFilterEnv` | mono, poly | Octave-based ADSR filter sweep (`base·2^envAmt`). |
| `dsp/oscillator.js` | `createUnisonOscBank` | mono, poly | Detuned unison oscillators with optional portamento glide. |
| `dsp/distortion.js` | `makeSoftClipCurve` | acid, 808 | Soft-clip waveshaper curve. |

`WebAudioSynthPoly` (the flagship subtractive synth) is built entirely on these primitives — it's the proof that the foundation supports new instruments.

These are intentionally not forced onto every synth: acid's unison (per-voice gain + cleanup), pad's shared-filter envelope, and FM's exponential operator envelopes are genuinely distinct and stay bespoke. The primitives are also the foundation for future synths.

**Gated envelopes & note length:** never schedule attack/decay ramps that end after note-off. Web Audio sorts events by time and a ramp starts from the *previous* event, so a note shorter than attack+decay used to sit silent, jump at note-off, release, then swell back up. `scheduleEnvelope` only schedules segments that occur before `releaseAt`; [tests/envelope.test.js](tests/envelope.test.js) evaluates the timeline to prove it. Note length on sequenced notes comes from the instrument's `gate` param (steps; mono/poly default 1, pad 4), applied in `_triggerRatcheted` — instruments without `gate` are unaffected.

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

### Step trig conditions ("gate by bar cycle")

Per-step `X:Y` conditions (Elektron-style) gate a step to fire only on pass X of every Y bars. `global/sequencer-conditions.js` is the single source of truth:

- `CONDITION_GROUPS` — grouped dropdown options (Off, Every 2 / 3 / 4 / 8 bars), built into `<optgroup>`s by `<wam-step-seq>`.
- `meetsBarCondition(condition, barIndex)` — the evaluator, called from `WebAudioControlsBase._meetsCondition()` so every instrument's `step()` loop shares one implementation (previously duplicated as an identical switch in all 11 control panels).
- `normalizeCondition()` — upgrades the legacy `"fill"` value to its explicit `"4:4"` form on load.

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
