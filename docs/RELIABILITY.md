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

### 3. Audio sample load failure (BreakPlayer)
**Symptom**: `WebAudioBreakPlayer` is silent or throws on `fetch()`.
**Cause**: Sample file not found, CORS headers missing, or context suspended at load time.
**Mitigation**: Pre-fetch samples after user gesture; check file paths in `public/audio/breaks/`. The break player should catch load errors and surface them.

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
