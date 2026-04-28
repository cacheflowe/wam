# Fire-and-Forget Voices

Status: Active | Owner: Justin Gitlin | Last reviewed: 2026-04-27

## Context

Polyphonic synthesis requires managing multiple simultaneous voices. The standard approaches are: (1) voice pool with fixed size, (2) voice pool with dynamic allocation, (3) fire-and-forget with browser GC.

## Decision

Fire-and-forget: each `trigger()` call creates a fresh node chain and cleans up via `osc.onended`.

```js
trigger(midi, durationSec, velocity, atTime) {
  const osc = this.ctx.createOscillator();
  const vca = this.ctx.createGain();
  // ... set frequency, schedule envelope, connect, start, stop ...
  osc.onended = () => { osc.disconnect(); vca.disconnect(); };
}
```

## Options Considered

1. **Fixed voice pool**: Pre-allocate N voices, cycle through them. Simple but causes note stealing at N+1 simultaneous triggers.
2. **Dynamic voice pool**: Allocate on demand, track active voices, release on note end. More complex; polyphony is still finite in practice.
3. **Fire-and-forget (chosen)**: Create nodes on demand, release via `osc.onended`. No voice management code needed.

## Rationale

- The Web Audio API was designed for this pattern. `AudioNode` creation is fast; GC handles cleanup after `stop()` and `disconnect()`.
- No voice-stealing artifacts: all triggered notes play to completion.
- Zero allocation bookkeeping: no free-list, no age-based eviction.
- Suitable for step sequencers: at 16th notes at 200 BPM, that's ~5.3 triggers/second per instrument — well within browser audio node budgets.

## Consequences

- Every trigger allocates 3–8 `AudioNode` objects. At pathological rates (>50 triggers/second per instrument) this could stress GC. This is not a concern at musical tempos.
- **Critical**: every trigger must call `osc.onended` to disconnect nodes. If omitted, disconnected nodes accumulate and leak. All instruments in this library set `osc.onended` — this must be maintained in new instruments.
- Node creation latency (~microseconds) is negligible compared to the lookahead window (100ms). This is not a real-time concern.

## Monitoring

If memory growth or audio glitches appear at high BPMs, profile with Chrome's Web Audio inspector and check for unreleased nodes. The fix is always to ensure `osc.onended` disconnects all nodes in the voice chain.
