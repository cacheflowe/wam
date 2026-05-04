# Loop Player

Status: Active | Owner: Justin Gitlin | Last reviewed: 2026-05-04

## User Story

As a musician or creative coder, I want to load and manipulate loop audio (breaks, textures, vocals, percussion) that stays locked to transport tempo, so I can build arrangements without manual time editing.

## Scope

`WebAudioLoopPlayer` is a continuous BPM-synced loop instrument implemented in `sample-looper.js`.

It is not a one-shot sampler:
- Loop player: continuous playback, timeline-aware jumps, beat-locked return behavior
- Sampler: one-shot trigger and envelope lifecycle per hit

## Core Behaviors

1. BPM sync via playback-rate compensation
2. Optional time-stretch workflow with pitch compensation
3. Random forward jumps to subdivision slots
4. Random reverse events with scheduled return
5. Segment jump controls for manual jamming
6. Loop file selection from configurable file catalogs

## Parameter Surface

| Parameter | Type | Default | Description |
|---|---|---|---|
| `speedMultiplier` | number | `1` | Multiplies loop cycle speed relative to BPM sync |
| `subdivision` | number | `8` | Grid resolution for random jump slots |
| `returnSteps` | number | `4` | Steps before returning from random event |
| `randomChance` | number | `0.1` | Chance of forward jump each step |
| `reverseChance` | number | `0.04` | Chance of reverse event each step |
| `volume` | number | `0.8` | Output gain |
| `useTimeStretch` | boolean | `false` | Enables pitch-shift compensation path |

## File Catalog Contract

The loop player supports folder-discovered loop catalogs via controls/app wiring:

```js
{
  files: [{ label: "Think (4 bars)", file: "0034-break-think.badsister_loop_4_.wav" }],
  basePath: "audio/loops/breaks/"
}
```

When no dedicated loop folder is present, apps may fallback to `audio/breaks/`.

## Controls Component

Custom element: `wam-sample-looper-controls`

Responsibilities:
1. Render loop file selector + loop behavior controls
2. Bind sliders/selects to instrument params
3. Dispatch `controls-error` when loop file loading fails
4. Serialize and restore full state with `toJSON()` / `fromJSON()`

## Compatibility

Legacy break-player aliases were removed. Callers must use `sample-looper.js` with `WebAudioLoopPlayer` and `WebAudioLoopPlayerControls`.

New code should use:
- `sample-looper.js`
- `WebAudioLoopPlayer`
- `wam-sample-looper-controls`

## Out of Scope

- Slice editing UI (manual waveform slicing)
- Stretch artifact correction modes beyond current pitch-shift path
- Crossfaded loop boundaries and transient detection
- MIDI-driven slice triggering
