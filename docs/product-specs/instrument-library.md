# Instrument Library

Status: Active | Owner: Justin Gitlin | Last reviewed: 2026-04-27

## User Story

As a creative coder, I want to import a synthesizer module and have it produce musical sound immediately, so I can focus on building my app rather than tuning oscillators and writing envelope code from scratch.

## The Standard Instrument Contract

Every instrument in the library must:

1. **Construct with an AudioContext**: `new WebAudioSynthX(ctx, preset?)`
2. **Trigger notes**: `trigger(midiNote, durationSec, velocity, scheduledTime)`
3. **Route audio**: `connect(node)` and `get input()`
4. **Apply presets**: `static PRESETS` + `applyPreset(name)`
5. **Expose parameters as setters**: so `instrument.cutoff = 800` works live
6. **Pair with a Controls Web Component**: `*Controls` with `bind()`, `toJSON()`, `fromJSON()`

## Parameter Conventions

| Parameter type | Range convention | Unit |
|---|---|---|
| Frequency | 20–20000 Hz | Hz |
| Volume / Gain | 0–1 | linear |
| Envelope times | 0.001–10 | seconds |
| Resonance / Q | 0.1–30 | Q factor |
| Detune | -100–100 | cents |
| BPM | 60–200 | BPM |

## Preset Convention

Every instrument ships with:
- **Default**: a musically neutral starting point
- At least **2 additional named presets** that are musically distinct

Presets are partial: only override parameters that define the character. New parameters added to an instrument should have sensible defaults that make existing presets sound the same.

## Flows

### Headless use (no UI)

```js
const ctx = new AudioContext();
const synth = new WebAudioSynthAcid(ctx, "Squelch");
synth.connect(ctx.destination);
synth.trigger(36, 0.25, 0.8, ctx.currentTime + 0.1);
```

### With Controls UI

```js
const synth = new WebAudioSynthAcid(ctx);
const controls = document.createElement("web-audio-synth-acid-controls");
container.appendChild(controls);
controls.bind(synth, ctx, { color: "#0f0", fx: { bpm: 128 } });
controls.connect(masterGain);
```

### With Sequencer

```js
const seq = new WebAudioSequencer(ctx, { bpm: 128 });
seq.onStep((step, time) => {
  controls.step(step, time, seq.stepDurationSec());
});
seq.start();
```

## Edge Cases

- `trigger()` called before AudioContext is resumed: schedules correctly but produces no audio until `ctx.resume()` is called.
- `trigger()` called with `velocity = 0`: produces silence (VCA gain 0), which is correct.
- `applyPreset()` with unknown name: no-op (returns early without throwing).
- `connect()` to a null node: will throw a native `TypeError`; callers must ensure the destination exists.

## Out of Scope

- MIDI device input
- Pitch bend / modulation wheel from MIDI
- Polyphonic aftertouch
- Voice stealing or polyphony limits
- Undo / redo history

## Related Specs

- Individual instrument specs: [index.md](index.md)
- [docs/BACKEND.md](../BACKEND.md)
