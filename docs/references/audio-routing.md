# Audio Routing Patterns

Implementation reference for assembling audio graphs with this library.

## The connect() / input Protocol

Every instrument and effect in this library exposes:

```js
connect(node)     // routes this._out to node.input ?? node; returns this
get input()       // returns the entry AudioNode for upstream connections
```

This lets library objects and raw `AudioNode`s chain interchangeably:

```js
acid.connect(delay);            // delay.input is a GainNode
delay.connect(ctx.destination); // ctx.destination has no .input
acid.connect(analyser);         // AnalyserNode has no .input
```

## Typical Signal Chain

```
Instrument
   │  .connect(fxUnit)
   ▼
FxUnit
   │  .connect(masterGain)
   ▼
masterGain (ctx.createGain())
   │  .connect(ctx.destination)
   ▼
ctx.destination
```

With the Controls component, the chain is assembled inside `bind()`:

```
instrument → analyser → fxUnit.input → fxUnit → controls._out
                │
         waveformDisplay
```

The app then calls `controls.connect(masterGain)`.

## FxUnit Internal Graph

```
input → WebAudioFxFilter → WebAudioFxDelay → WebAudioFxChorus → WebAudioFxReverb → WebAudioFxCompressor → out
```

The stages run **serially** — each effect feeds the next. Filter, delay, chorus, and reverb each handle their own dry/wet mix internally (0 wet = transparent). The compressor is the final stage.

### Sidechain compressor

`WebAudioFxCompressor` is a per-channel sidechain ducker. It wraps an `AudioWorkletNode` (`sidechain-compressor-processor`) with two inputs:

- **input 0** — the channel signal (fed from reverb)
- **input 1** — the sidechain *key*, set via `comp.setSidechainSource(tapNode)`

The worklet runs an envelope follower (independent **attack**/**release**) on the key and reduces the channel gain by up to **amount** once the key passes **threshold** — the classic kick-driven pump.

**Tempo-synced release:** with **Sync** on, the release time is derived from a beat division (`RELEASE_DIVISIONS` on `WebAudioFxUnit`: 1/1 … 1/16, incl. 1/8T) and the current BPM (`release = beats × 60/bpm`), recomputed whenever `fxUnit.bpm` changes. With Sync off, the free **Release** (ms) knob is used.

**Gain-reduction meter:** the worklet posts its peak reduction (0..1) to the main thread roughly every 30 ms via `port.postMessage`; `WebAudioFxCompressor` exposes it as `comp.reduction` and an `onReduction` callback, which the FX UI renders as a live "Reduction" bar.

The key source is chosen in the FX UI via `<wam-instrument-source-picker>`, which lists the playground's instrument bus (each track's pre-fader tap). **With no source selected the envelope stays at 0, so audio passes through untouched — the effect is off until a track is picked.** The worklet module loads asynchronously; until it is ready the compressor routes through a dry bypass gain so the chain is valid synchronously.

> Note: a channel's own pre-fader tap appears in the picker, so self-sidechaining (compressing a track by its own level) is possible but creates a feedback path through the compressor — pick the kick (or another track) for the intended pump.

## Parallel Sends (Manual)

To send one instrument to multiple effects in parallel (e.g., a send reverb):

```js
instrument.connect(dryGain);
instrument.connect(sendGain);
sendGain.connect(reverbNode);
reverbNode.connect(masterGain);
dryGain.connect(masterGain);
```

The library doesn't provide a send-bus abstraction — wire it manually from the instrument's `_out`.

## Assembling a Full Scene

```js
const ctx = new AudioContext();
const master = ctx.createGain();
master.connect(ctx.destination);

// Instrument 1
const acid = new WebAudioSynthAcid(ctx);
const acidCtrl = document.createElement("wam-synth-acid-controls");
document.body.appendChild(acidCtrl);
acidCtrl.bind(acid, ctx, { color: "#0f0", fx: { bpm: 128 } });
acidCtrl.connect(master);

// Instrument 2
const kick = new WebAudioPercKick(ctx);
const kickCtrl = document.createElement("wam-perc-kick-controls");
document.body.appendChild(kickCtrl);
kickCtrl.bind(kick, ctx, { color: "#f80" });
kickCtrl.connect(master);

// Sequencer
const seq = new WebAudioSequencer(ctx, { bpm: 128 });
seq.onStep((step, time) => {
  acidCtrl.step(step, time, seq.stepDurationSec());
  kickCtrl.step(step, time, seq.stepDurationSec());
});
seq.start();

// BPM change
function setBpm(bpm) {
  seq.bpm = bpm;
  acidCtrl.bpm = bpm;
  kickCtrl.bpm = bpm;
}
```

## Without Controls (Headless)

```js
const ctx = new AudioContext();
const acid = new WebAudioSynthAcid(ctx, "Squelch");
acid.connect(ctx.destination);

// Manual trigger
acid.trigger(36, 0.25, 0.8, ctx.currentTime);
```

## Notes

- Always call `ctx.resume()` after a user gesture before triggering any audio.
- `connect()` returns `this`, enabling chaining: `instrument.connect(fx).connect(master)`.
- Do not call `this._out.connect()` from outside a class — always go through the public `connect()` method.
- Multiple calls to `connect()` on the same source create multiple connections (fan-out), which is valid Web Audio behavior and useful for sends.

## Related Docs

- [wam-api.md](wam-api.md) — AudioContext, node types, AudioParam scheduling
- [docs/BACKEND.md](../BACKEND.md) — instrument and effect inventory
