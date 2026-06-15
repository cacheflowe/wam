# Reliability

## Known Failure Modes

### 1. AudioContext suspended (most common)
**Symptom**: No audio; `ctx.state === "suspended"`.
**Cause**: Browsers require a user gesture before allowing audio output.
**Mitigation**: Call `ctx.resume()` in a `click` or `touchstart` handler. A common pattern is a "Start" button that resumes the context and starts the sequencer.

```js
startBtn.addEventListener("click", async () => {
  await ctx.resume();
  seq.start();
});
```

### 2. AudioWorklet module load failure
**Symptom**: `WebAudioPitchShift` or `WebAudioTimeStretch` produces no output; console shows a DOMException on `addModule()`.
**Cause**: Incorrect URL path, CORS, or missing COOP/COEP headers.
**Mitigation**: Use `new URL('./file.worklet.js', import.meta.url).href` to resolve the path correctly in Vite. Ensure the dev server sets COOP/COEP (already configured in `vite.config.js`).

```js
await ctx.audioWorklet.addModule(
  new URL("./pitch-shift.worklet.js", import.meta.url).href
);
```

### 3. Audio sample load failure (Loop Player)
**Symptom**: `WebAudioLoopPlayer` is silent or throws on `fetch()`.
**Cause**: Sample file not found, CORS headers missing, or context suspended at load time.
**Mitigation**: Pre-fetch samples after user gesture; check file paths in `public/audio/loops/` (or fallback `public/audio/breaks/`). The loop player surfaces load failures via controls-level error events.

### 4. Memory growth at very high BPMs
**Symptom**: Page slows over time; audio glitches.
**Cause**: Fire-and-forget voices create many nodes per second; if `osc.onended` cleanup is not wired, nodes accumulate.
**Mitigation**: All instrument `trigger()` methods must set `osc.onended = () => { osc.disconnect(); vca.disconnect(); }`. Verify this is present when adding new instruments.

### 5. setInterval drift (sequencer visual desync)
**Symptom**: Step indicator lags or jumps; audio is correct but visuals are off.
**Cause**: `setInterval` has ~1–4ms jitter. Visual updates use `setTimeout` with `(time - ctx.currentTime) * 1000` delay, which can drift under CPU load.
**Impact**: Audio precision is unaffected (all audio is scheduled via Web Audio timeline). Only the UI indicator may desync.
**Mitigation**: Acceptable at normal BPMs; no fix needed unless jitter becomes noticeable.

### 6. State corruption on `fromJSON()` with unknown keys
**Symptom**: Console errors on load; some controls don't restore.
**Cause**: Saved state references parameters that were renamed or removed.
**Mitigation**: `fromJSON()` uses `?? defaultValue` for all keys. Removing a parameter from `SLIDER_DEFS` should also add a migration comment if old saved states exist.

### 7. MIDI hardware input wedges after sysex output (Windows)
**Symptom**: A connected controller's input goes dead (knobs/buttons stop registering) while LED/sysex **output** still works. It stays dead across page reloads; only physically unplugging and replugging the device restores it.
**Cause**: Two failure triggers, both observed on the Launch Control XL. (1) Sending a separate sysex per incoming MIDI event — e.g. echoing an LED on every CC tick during a knob sweep — floods the port; bursts of tiny `F0…F7` messages stall the device's input callback (a long-standing Chromium/Windows behavior). (2) Opening two `MIDIAccess` objects that contend for the same ports. The stall lives in the OS/driver layer, so a page reload can't clear it.
**Mitigation**: Queue LED changes and flush at most once per animation frame as a single multi-pair sysex (`setLedsMessage` takes many `[index, velocity]` pairs); dedupe on the quantized color. Use exactly one `MIDIAccess` per page — reuse `<wam-midi-input-picker>`'s `.midiAccess` (set its `sysex` attribute) instead of requesting your own. See `_scheduleLedFlush` in [src/app/launch-control-xl.js](../src/app/launch-control-xl.js) and the full writeup in [docs/references/launch-control-xl.md](references/launch-control-xl.md#reliability--hard-won-lessons-windows-especially).
**Recovery**: Replug the device (or restart the browser) to reset the stuck OS port handle.

## Resilience Patterns

- **Idempotent CSS injection**: CSS is injected once per page via a static `#cssInjected` flag. Re-rendering components multiple times is safe.
- **Partial preset application**: `applyPreset()` uses `!= null` guards, so missing keys don't throw.
- **Backward-compatible serialization**: `fromJSON()` `?? defaults` pattern survives parameter additions.
- **Sequencer restart safety**: `seq.start()` calls `stop()` first if already running; double-start is safe.

## Browser Support

Requires modern browser engines supporting:
- Web Audio API Level 2 (AudioWorklet, ConvolverNode, etc.)
- Web Components (`customElements.define`, `HTMLElement` lifecycle)
- ES2020+ (optional chaining, nullish coalescing, private class fields)

Tested targets: Chrome 120+, Firefox 120+, Safari 17+. No IE or legacy Edge support.
