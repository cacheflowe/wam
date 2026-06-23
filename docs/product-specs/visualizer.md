# Visualizer System

## Architecture

- `WamAnalysisBus` (src/web-audio/ui/analysis-bus.js) — singleton aggregator that collects audio data from all sources
- `<wam-visualizer>` (src/web-audio/ui/visualizer.js) — Web Component hosting a p5.js instance-mode canvas
- Sketches (src/web-audio/ui/sketches/*.js) — hot-loadable ES modules, each exports a default function(p, bus, ctx, container)
- p5's sketch checker is disabled in the component because deployment builds are bundled/minified ES modules; the checker parses the final app script and can report false global-name collisions such as `nf`.

## Data Flow

```
Instruments → _wrapTrigger → "wam-trigger" CustomEvent (bubbles) → playground listener → bus.trigger()
Sequencer onStep → bus.setBeat(step, bar, bpm, stepDuration, audioTime)
Transport masterAnalyser → bus.setMaster(analyser)
Per-instrument ctrl._analyser → bus.addInstrument(key, ctrl)
Each frame: sketch calls bus.snapshot(ctx.currentTime) → retained object with all data
```

## Accessing Instrument Data (via snapshot)

- `snap.master.fft` — Uint8Array (1024 bins) frequency data from master bus
- `snap.master.waveform` — Uint8Array (2048 samples) time-domain from master bus
- `snap.master.rms` — 0–1 normalized amplitude (master)
- `snap.instruments["Kick 0"].fft` — per-instrument frequency data
- `snap.instruments["Kick 0"].waveform` — per-instrument time-domain
- `snap.instruments["Kick 0"].rms` — per-instrument amplitude
- `snap.instruments["Kick 0"].trigger` — { velocity, age, scheduledTime } or null
- `snap.beat.step` — current sequencer step (0–15)
- `snap.beat.bar` — current bar number
- `snap.beat.phase` — 0–1 progress through current step
- `snap.beat.bpm` — current BPM
- `snap.triggers` — rolling array (max 64) of recent trigger events { instrument, velocity, step, age, scheduledTime }

## Trigger System

- `_wrapTrigger(instrument)` in controls-base.js wraps `trigger()` and `triggerDrum()` methods
- Automatically dispatches bubbling "wam-trigger" CustomEvent on every note
- Muted instruments do NOT emit triggers (checks `_muteHandle.isMuted()`)
- Velocity is always 1 (instrument trigger signatures vary too much to extract meaningful velocity)
- Instance-unique keys: "Kick 0", "Snare 3", etc. — sketches use `name.includes("kick")` for matching

## Timing / Latency Compensation

- Problem: Web Audio uses lookahead scheduling — notes are scheduled 25–100ms in the future
- Triggers store `scheduledTime` (from bus._stepTime, set by setBeat before step functions run)
- Triggers start with `age = -1` (not yet arrived)
- In `snapshot(now)`, trigger flips to `age = 1` only when `now >= scheduledTime + ctx.outputLatency`
- `ctx.outputLatency` accounts for OS/hardware speaker delay
- Sketches check `t.age === 1` to detect "just arrived" — this fires in sync with perceived audio
- Beat phase calculation also uses scheduled step time for smooth interpolation

## Memory / Performance

- Pre-allocated snapshot object — mutated in place, zero per-frame allocations
- Typed array buffers (fft, waveform) allocated once per analyser, reused via getByteFrequencyData
- Per-instrument snap objects created once in addInstrument()
- Trigger ring buffer recycles oldest slot when at capacity (max 64)
- lastTrigger objects mutated in place, not replaced

## Sketch API

```js
export default function mySketch(p, bus, ctx, container) {
  p.setup = () => { /* create canvas using container.getBoundingClientRect() */ };
  p.windowResized = () => { /* resize canvas */ };
  p.draw = () => {
    const snap = bus.snapshot(ctx.currentTime);
    // Use snap.master, snap.instruments, snap.beat, snap.triggers
  };
}
```

## Sketch Selector

- Dropdown in playground's visualizer panel (collapsible `<details>` section)
- Sketches array in playground.js defines { label, path } entries
- Default loads from first option via `this._sketchSelect.value`
- Hot-swaps via `vizEl.loadSketch(url)` — destroys old p5 instance, dynamic imports new module

## Current Sketches

- **Pulse Shapes** — expanding stroked shapes on triggers (kick=square, snare=circle, hihat=small circle)
- **Reactive Geometry** — radial waveform ring, FFT spikes, particles on triggers, beat pulse
