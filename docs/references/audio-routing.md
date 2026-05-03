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
input (GainNode)
  │
  ├──→ WebAudioFxReverb  ──┐
  ├──→ WebAudioFxDelay   ──┤──→ preOut (GainNode)
  ├──→ WebAudioFxChorus  ──┘         │
  │                             WebAudioFxFilter
  │                                   │
  └──────────────────────────────→  out (GainNode)
```

Reverb, delay, and chorus run in parallel (all receive the input signal). The filter is always inline on the output. Each parallel effect has its own dry/wet control.

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
