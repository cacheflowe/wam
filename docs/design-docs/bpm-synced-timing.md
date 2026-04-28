# BPM-Synced Timing

Status: Active | Owner: Justin Gitlin | Last reviewed: 2026-04-27

## Context

Several effects (delay, LFO) and the sequencer need to sync to a global tempo. The question was whether to express these in absolute time (seconds, Hz) or musical time (beats).

## Decision

All tempo-dependent parameters are expressed in beats. A single BPM value propagates from the app's transport layer through `controls.bpm = v` → `fxUnit.bpm = v` → individual effect instances.

## Musical Intervals

Both the delay and FM LFO use a shared interval model:

```js
static INTERVALS = [
  { label: "1/16", beats: 0.25 },
  { label: "1/8",  beats: 0.5 },
  { label: "1/8.", beats: 0.75 },
  { label: "1/4",  beats: 1 },
  { label: "1/4.", beats: 1.5 },
  { label: "1/2",  beats: 2 },
];
```

Conversion to seconds:
```js
delayTimeSeconds = (60 / bpm) * beats;
```

Conversion to Hz:
```js
lfoHz = (bpm / 60) / beats;
```

## Sequencer Timing

`WebAudioSequencer` uses the Chris Wilson lookahead technique to decouple JS timer jitter from audio precision:

1. `setInterval` fires every 25ms (the "lookahead tick")
2. Each tick schedules all steps within the next 100ms
3. Steps are Web Audio events at precise `AudioContext.currentTime` values
4. UI updates use `setTimeout` with `(scheduledTime - ctx.currentTime) * 1000` delay

This means sequencer timing is sample-accurate regardless of JS event loop load.

## Rationale

- Musical intervals are more useful than raw Hz/seconds for sound design
- A single BPM source avoids drift between the sequencer and effects
- The lookahead technique is the industry standard for Web Audio scheduling; reinventing it was not considered

## Consequences

- BPM changes must propagate to all Controls components and their FX units. The app is responsible for calling `controls.bpm = newBpm` on every instrument after a tempo change.
- Delay time updates on BPM change cause an audible click if the `AudioParam` is set with `setValueAtTime`. Future improvement: use a short ramp or wait for the current delay echo to decay.
- The sequencer's 25ms lookahead interval is a tradeoff between CPU usage and scheduling precision. Increasing it reduces CPU; decreasing it increases precision at the cost of more frequent ticks.
