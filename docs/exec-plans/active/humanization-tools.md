# Humanization Tools Implementation Plan

**Status:** Planning phase  
**Last updated:** 2026-06-23  
**Priority:** Medium (per roadmap)

---

## Goal

Make sequenced patterns feel more organic and less machine-rigid by adding controllable humanization parameters to instruments.

---

## Tools to Implement

| Tool | Description | Scope | Complexity |
|------|-------------|-------|------------|
| **Swing** | Shift even-numbered steps later by percentage of step duration | Sequencer-level | Medium |
| **Trigger delay** | Fixed microsecond offset per step | Per-instrument | Easy |
| **Timing jitter** | Random per-trigger timing offset (±0–20ms) | Per-instrument | Medium |
| **Velocity variation** | Random velocity offset per trigger (±0–20%) | Per-instrument | Easy |
| **Ghost notes** | Randomly insert quiet hits on inactive steps | Sequencer-level | Hard |
| **Accent drift** | Shift which steps get emphasized over time | Sequencer-level | Hard |

---

## Implementation Strategy

### Architecture Overview

```plaintext
WebAudioSequencer (global/sequencer.js)
    └── onStep(callback)
        └── InstrumentControls.step(index, time, stepDurationSec)
            └── Instrument.trigger(midi, duration, accent, atTime)
```

**Humanization modifiers will be applied:**
- **Swing** → applied in `InstrumentControls.step()` by adjusting `time` for even steps
- **Trigger delay, jitter, velocity variation** → applied in `Instrument.trigger()` or wrapper methods
- **Ghost notes** → handled in `InstrumentControls.step()` by injecting synthetic triggers
- **Accent drift** → handled in `InstrumentControls.step()` by dynamically modifying accent flags

---

## Phase 1: Foundation (2-3 days)

### 1. Add Humanization Config to `WebAudioInstrumentBase`

**File:** `src/web-audio/global/instrument-base.js`

Add humanization parameters as instance properties (with defaults = 0):

```javascript
export default class WebAudioInstrumentBase {
  constructor(ctx, preset) {
    this.ctx = ctx;
    this._out = ctx.createGain();
    if (preset) this.applyPreset(preset);

    // Humanization parameters (0 = off)
    this.triggerDelaySec = 0;          // fixed offset (microseconds to milliseconds)
    this.timingJitterProb = 0;         // probability of applying jitter
    this.timingJitterMaxMs = 20;       // max ±ms of jitter
    this.velocityVariationProb = 0;    // probability of applying velocity variation
    this.velocityVariationMaxPct = 20; // max ±percent of velocity
  }
  
  // Serialization hooks
  _serializeHumanization() {
    return {
      triggerDelaySec: this.triggerDelaySec,
      timingJitterProb: this.timingJitterProb,
      timingJitterMaxMs: this.timingJitterMaxMs,
      velocityVariationProb: this.velocityVariationProb,
      velocityVariationMaxPct: this.velocityVariationMaxPct,
    };
  }

  _deserializeHumanization(params) {
    if (!params) return;
    this.triggerDelaySec = params.triggerDelaySec ?? 0;
    this.timingJitterProb = params.timingJitterProb ?? 0;
    this.timingJitterMaxMs = params.timingJitterMaxMs ?? 20;
    this.velocityVariationProb = params.velocityVariationProb ?? 0;
    this.velocityVariationMaxPct = params.velocityVariationMaxPct ?? 20;
  }
}
```

---

### 2. Add Humanization UI to `WebAudioControlsBase`

**File:** `src/web-audio/ui/controls-base.js`

Add a shared "Humanize" section to all instruments:

```javascript
// Add to WebAudioControlsBase._buildControls() or create a new method
_buildHumanizeSection() {
  const { el, controls } = createSection("Humanize");
  
  // Swing (global per-transport)
  const swingWrap = createCtrl("Swing", {
    tooltip: "Even-step delay as percentage of step duration (0-75%)"
  });
  this._swingSlider = document.createElement("input");
  this._swingSlider.type = "range";
  this._swingSlider.min = 0;
  this._swingSlider.max = 75;
  this._swingSlider.step = 5;
  this._swingSlider.value = 0;
  this._swingSlider.addEventListener("input", () => {
    this.dispatchEvent(new CustomEvent("wam-swing-change", {
      bubbles: true,
      detail: { swingPercent: parseFloat(this._swingSlider.value) }
    }));
  });
  swingWrap.appendChild(this._swingSlider);
  controls.appendChild(swingWrap);

  // Trigger delay
  const delayWrap = createCtrl("Delay", {
    tooltip: "Fixed per-trigger timing offset (±0-20ms)"
  });
  this._delaySlider = document.createElement("input");
  this._delaySlider.type = "range";
  this._delaySlider.min = 0;
  this._delaySlider.max = 20;
  this._delaySlider.step = 1;
  this._delaySlider.value = 0;
  this._delaySlider.addEventListener("input", () => {
    this._updateHumanizationFromUI();
  });
  delayWrap.appendChild(this._delaySlider);
  controls.appendChild(delayWrap);

  // Timing jitter
  const jitterWrap = createCtrl("Jitter", { tooltip: "Random timing variation probability (%)" });
  this._jitterProbSlider = document.createElement("input");
  this._jitterProbSlider.type = "range";
  this._jitterProbSlider.min = 0;
  this._jitterProbSlider.max = 100;
  this._jitterProbSlider.step = 5;
  this._jitterProbSlider.value = 0;
  this._jitterProbSlider.addEventListener("input", () => {
    this._updateHumanizationFromUI();
  });
  jitterWrap.appendChild(this._jitterProbSlider);
  controls.appendChild(jitterWrap);

  // Velocity variation
  const velWrap = createCtrl("Velocity", { tooltip: "Random velocity variation probability (%)" });
  this._velProbSlider = document.createElement("input");
  this._velProbSlider.type = "range";
  this._velProbSlider.min = 0;
  this._velProbSlider.max = 100;
  this._velProbSlider.step = 5;
  this._velProbSlider.value = 0;
  this._velProbSlider.addEventListener("input", () => {
    this._updateHumanizationFromUI();
  });
  velWrap.appendChild(this._velProbSlider);
  controls.appendChild(velWrap);

  el.appendChild(controls);
  return el;
}

// Add helper method
_updateHumanizationFromUI() {
  if (!this._instrument) return;
  this._instrument.triggerDelaySec = this._delaySlider.value / 1000;
  this._instrument.timingJitterProb = parseFloat(this._jitterProbSlider.value) / 100;
  this._instrument.timingJitterMaxMs = parseFloat(this._jitterProbSlider.max); // or separate slider
  this._instrument.velocityVariationProb = parseFloat(this._velProbSlider.value) / 100;
  this._instrument.velocityVariationMaxPct = parseFloat(this._velProbSlider.max); // or separate slider
}
```

---

### 3. Apply Humanization in `Instrument.trigger()` Methods

Update instrument `trigger()` methods to accept and apply humanization:

```javascript
// Example for WebAudioSynthAcid.trigger() (simplified)
trigger(midi, stepDurSec, accent, atTime, options = {}) {
  const ctx = this.ctx;
  
  // Apply trigger delay
  atTime += this.triggerDelaySec;
  
  // Apply timing jitter
  if (this.timingJitterProb > 0 && Math.random() < this.timingJitterProb) {
    const jitterMs = Math.random() * this.timingJitterMaxMs;
    atTime += (jitterMs / 1000) * (Math.random() < 0.5 ? 1 : -1);
  }
  
  // Apply velocity variation
  let velocity = accent ? 1.0 : 0.65;
  if (this.velocityVariationProb > 0 && Math.random() < this.velocityVariationProb) {
    const varPct = Math.random() * this.velocityVariationMaxPct;
    velocity *= 1 + (varPct / 100) * (Math.random() < 0.5 ? 1 : -1);
    velocity = Math.max(0.1, Math.min(1, velocity)); // clamp
  }

  // ... rest of trigger logic uses `velocity` and `atTime`
}
```

---

## Phase 2: Swing Implementation (1-2 days)

### 4. Swing at Sequencer Level

**File:** `src/web-audio/global/sequencer.js`

Add swing to the sequencer (global per-transport):

```javascript
export default class WebAudioSequencer {
  constructor(ctx, options = {}) {
    this.ctx = ctx;
    this.bpm = options.bpm ?? 120;
    this.steps = options.steps ?? 16;
    this.subdivision = options.subdivision ?? 16;
    
    // Swing
    this.swingPercent = 0; // 0-75%
    
    this._callbacks = [];
    // ...
  }

  /** Duration of one step in seconds, accounting for swing. */
  stepDurationSec(stepIndex) {
    const base = (60 / this.bpm) * (4 / this.subdivision);
    
    // Even steps (0, 2, 4...) get delayed by swing%
    if (this.swingPercent > 0 && stepIndex % 2 === 0) {
      const delay = base * (this.swingPercent / 100);
      return base + delay;
    }
    return base;
  }

  _tick() {
    // Track swing state per step
    const step = this._currentStep;
    const time = this._nextNoteTime;
    
    // For swing: even steps have longer duration, odd steps have shorter
    // This requires tracking the *actual* elapsed time
    const baseStepDur = (60 / this.bpm) * (4 / this.subdivision);
    const swingFactor = this.swingPercent > 0 && step % 2 === 0 ? (1 + this.swingPercent / 100) : 1;
    const stepDur = baseStepDur * swingFactor;
    
    this._callbacks.forEach((cb) => cb(step, time));
    this._nextNoteTime += stepDur;
    this._currentStep = (this._currentStep + 1) % this.steps;
  }
  
  // Add public setter
  setSwing(percent) {
    this.swingPercent = Math.max(0, Math.min(75, percent));
  }
}
```

---

### 5. Update Sequencer Callbacks to Use Swing-Aware Timing

**File:** `src/web-audio/instruments/synth-acid.js` (in the `step()` method)

Update the sequencer callback to account for swing:

**Important:** Swing changes step durations dynamically. The sequencer lookahead needs to account for this:

```javascript
// In the step() method where triggers happen:
const swingPercent = this._swingPercent ?? 0; // from transport
const applySwing = swingPercent > 0 && stepIndex % 2 === 0;
let adjustedTime = time;

if (applySwing) {
  const baseStepDur = (60 / bpm) * (4 / 16); // assuming 16-step
  const swingDelay = baseStepDur * (swingPercent / 100);
  adjustedTime = time + swingDelay;
}

// Then trigger with adjusted time
this._instrument.trigger(s.note, subStepDur, s.accent, adjustedTime);
```

---

## Phase 3: Ghost Notes (2 days)

### 6. Ghost Notes Implementation

Ghost notes require injecting synthetic triggers on inactive steps at low probability.

**File:** `src/web-audio/instruments/synth-acid.js` (in `step()` method)

```javascript
// After the normal trigger logic, before the jam check:

// Ghost notes: inject quiet hits on inactive steps
const ghostProb = this._ghostProb ?? 0; // 0-1 probability
const ghostVelocity = this._ghostVelocity ?? 0.2; // 10-30% of programmed velocity

if (Math.random() < ghostProb && !s?.active) {
  const ghostNote = this._getGhostNote(); // pick from scale
  this._instrument.trigger(ghostNote, subStepDur, false, time + ghostOffset);
}

// Add helper
_getGhostNote() {
  const notes = scaleNotesInRange(this._rootMidi, this._scaleName, 24, 60);
  if (!notes.length) return 36; // default fallback
  return notes[Math.floor(Math.random() * notes.length)];
}
```

---

## Phase 4: Accent Drift (2 days)

### 7. Accent Drift Implementation

Accent drift shifts which steps get emphasized over time.

**File:** `src/web-audio/instrument-controls.js` (new base class for controls with humanization)

```javascript
export class WebAudioInstrumentControlsBase extends WebAudioControlsBase {
  constructor() {
    super();
    this._accentDriftActive = false;
    this._accentDriftIntervalBars = 1;
    this._accentDriftOffset = 0;
    this._currentAccentDrift = 0;
  }

  applyAccentDrift(accent, currentStep, currentBar) {
    if (!this._accentDriftActive) return accent;
    
    // Shift accents every N bars by M steps
    const driftInterval = this._accentDriftIntervalBars;
    if (currentBar % driftInterval === 0 && currentBar > 0) {
      this._currentAccentDrift = (this._currentAccentDrift + 1) % 4; // shift by 1 step per drift
    }
    
    // Check if this step should be accented due to drift
    const driftedStep = (currentStep + this._currentAccentDrift) % 16;
    const driftAccentSteps = [0, 4, 8, 12]; // original accent beats
    const shouldAccent = driftAccentSteps.includes(driftedStep);
    
    return accent || shouldAccent;
  }
}
```

Then apply in the `step()` method:

```javascript
// After getting the pattern params:
const patternParams = this._seq?.getPatternParams() ?? {};
const driftInterval = patternParams.accentDriftIntervalBars ?? 0;
const currentBar = Math.floor(this._globalStep / 16);

// Apply accent drift
let accent = s.accent;
if (driftInterval > 0) {
  accent = this.applyAccentDrift(accent, stepIndex, currentBar);
}
```

---

## Phase 5: Serialization & UI (1 day)

### 8. Update `toJSON()` / `fromJSON()` Hooks

**File:** `src/web-audio/instruments/*.js`

Add humanization to serialization:

```javascript
// In WebAudioSynthAcidControls._extraToJSON():
_extraToJSON(params) {
  super._extraToJSON(params);
  
  // Humanization
  params.humanize = {
    swingPercent: this._swingPercent ?? 0,
    triggerDelaySec: this._instrument.triggerDelaySec ?? 0,
    timingJitterProb: this._instrument.timingJitterProb ?? 0,
    timingJitterMaxMs: this._instrument.timingJitterMaxMs ?? 20,
    velocityVariationProb: this._instrument.velocityVariationProb ?? 0,
    velocityVariationMaxPct: this._instrument.velocityVariationMaxPct ?? 20,
    ghostProb: this._ghostProb ?? 0,
    ghostVelocity: this._ghostVelocity ?? 0.2,
    accentDriftActive: this._accentDriftActive ?? false,
    accentDriftIntervalBars: this._accentDriftIntervalBars ?? 1,
  };
}

// In WebAudioSynthAcidControls._restoreExtra():
_restoreExtra(obj) {
  super._restoreExtra(obj);
  
  if (obj.humanize) {
    const h = obj.humanize;
    // Update UI sliders
    if (this._swingSlider) this._swingSlider.value = h.swingPercent ?? 0;
    if (this._delaySlider) this._delaySlider.value = (h.triggerDelaySec ?? 0) * 1000;
    
    // Update instrument
    if (this._instrument) {
      this._instrument.triggerDelaySec = h.triggerDelaySec ?? 0;
      this._instrument.timingJitterProb = h.timingJitterProb ?? 0;
      this._instrument.timingJitterMaxMs = h.timingJitterMaxMs ?? 20;
      this._instrument.velocityVariationProb = h.velocityVariationProb ?? 0;
      this._instrument.velocityVariationMaxPct = h.velocityVariationMaxPct ?? 20;
    }
  }
}
```

---

## Testing Strategy

### Unit Tests
- Test each humanization parameter produces expected timing/velocity shifts
- Test swing produces correct even-step delay
- Test ghost notes don't fire when probability is 0
- Test accent drift shifts accents over time

### Integration Tests
- Test full chain: sequencer → controls → instrument → audio output
- Test save/load preserves all humanization settings
- Test multiple instruments with different humanization settings play together

### Manual QA
- Listen for "machine gun" effect reduction with velocity variation
- Verify swing feels like an MPC/TR-808 groove
- Check that jitter feels random, not "messy"
- Verify ghost notes are subtle (don't drown out main pattern)
- Test accent drift creates natural accent migration

---

## Implementation Order

**Week 1:**
1. Add humanization properties to `WebAudioInstrumentBase`
2. Add humanization UI to `WebAudioControlsBase`
3. Update instrument `trigger()` methods to accept humanization
4. Write unit tests for jitter/velocity/trigger delay

**Week 2:**
5. Implement swing in `WebAudioSequencer`
6. Update sequencer callbacks to apply swing
7. Implement ghost notes
8. Write integration tests

**Week 3:**
9. Implement accent drift
10. Update `toJSON()` / `fromJSON()` for all instruments
11. Build UI for ghost notes and accent drift parameters
12. Final QA and polish

---

## Known Challenges

1. **Swing timing precision:** Swing changes the *duration* of steps, which affects lookahead scheduling. May need to adjust `_nextNoteTime` calculation carefully.

2. **Ghost note placement:** Need to avoid clashing with actual triggers. Consider minimum spacing (e.g., no ghost notes within 1 step of active notes).

3. **Accent drift complexity:** Should drift be per-instrument or global? Per-instrument gives more flexibility but adds UI complexity.

4. **Performance:** High-resolution jitter (microsecond timing) in JS may cause audio glitches. Test on mobile devices.

---

## Success Criteria

- [ ] All six humanization tools implemented and controllable
- [ ] Humanization settings save/load correctly via JSON
- [ ] No audible artifacts when humanization is off (0)
- [ ] Performance remains stable at 60 FPS during playback
- [ ] Documentation includes usage examples and musical examples

---

## Next Steps

1. Implement Phase 1 (foundation)
2. Add humanization UI to one instrument (e.g., `synth-acid`) as a testbed
3. Validate the UI works and settings persist
4. Iterate on design before expanding to all instruments

---

## Complete Implementation Checklist

### Phase 1: Foundation (Per-Instrument Humanization)

- [ ] Add humanization properties to `WebAudioInstrumentBase` constructor
- [ ] Implement `_serializeHumanization()` method
- [ ] Implement `_deserializeHumanization(params)` method
- [ ] Add humanization UI section to `WebAudioControlsBase`
- [ ] Implement `_updateHumanizationFromUI()` helper
- [ ] Update `WebAudioSynthAcid.trigger()` to apply humanization
- [ ] Update `WebAudioSynthKick.trigger()` to apply humanization
- [ ] Update `WebAudioSynthHiHat.trigger()` to apply humanization
- [ ] Update `WebAudioSynthSnare.trigger()` to apply humanization
- [ ] Update `WebAudioSynthPad.trigger()` to apply humanization
- [ ] Update `WebAudioSynthMono.trigger()` to apply humanization
- [ ] Update `WebAudioSynth808 Kick/Hihat/Snare.trigger()` to apply humanization

### Phase 1a: Serialization

- [ ] Add `_extraToJSON()` override to `WebAudioSynthAcidControls`
- [ ] Add `_restoreExtra()` override to `WebAudioSynthAcidControls`
- [ ] Test save/load cycle preserves all humanization settings
- [ ] Verify JSON structure matches expected format

### Phase 2: Swing Implementation

- [ ] Add `swingPercent` property to `WebAudioSequencer`
- [ ] Implement `stepDurationSec(stepIndex)` with swing calculation
- [ ] Update `_tick()` to apply swing to timing
- [ ] Implement `setSwing(percent)` public method
- [ ] Update `WebAudioSynthAcid.step()` to apply swing
- [ ] Test swing at 0%, 25%, 50%, 75%
- [ ] Verify swing doesn't cause audio glitches

### Phase 3: Ghost Notes

- [ ] Add `_ghostProb` and `_ghostVelocity` properties to controls
- [ ] Implement `_getGhostNote()` helper method
- [ ] Update `step()` method to inject ghost notes
- [ ] Add ghost note UI controls
- [ ] Test ghost note probability (0-100%)
- [ ] Test ghost note velocity (10-30%)

### Phase 4: Accent Drift

- [ ] Decide on architecture: per-instrument vs global
- [ ] Implement drift logic in `InstrumentControls.step()`
- [ ] Add drift UI controls
- [ ] Test accent migration over time
- [ ] Verify drift doesn't create clashing triggers

### Phase 5: Testing & Documentation

- [ ] Write unit tests for each humanization tool
- [ ] Write integration tests for full chain
- [ ] Perform manual QA with all instruments
- [ ] Document usage in `docs/`
- [ ] Add musical examples to documentation

### Post-Phase 1: Expand to All Instruments

- [ ] Implement humanization for FM Synth
- [ ] Implement humanization for Vocoder
- [ ] Implement humanization for LoopPlayer
- [ ] Implement humanization for FX Unit

---

**Related:**
- [Roadmap Humanization section](../roadmap.md)
- [Composition Serialization spec](../roadmap.md#composition-serialization)
- [Quality Score Definition](../QUALITY_SCORE.md) (all new features must pass)
