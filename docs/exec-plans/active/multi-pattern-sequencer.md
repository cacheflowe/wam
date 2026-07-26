# Multi-Pattern Sequencer

Owner: Justin Gitlin
Created: 2026-06-20
Status: Draft

## Problem

Every instrument has a single 16-step sequencer. This limits musical complexity — patterns loop identically forever, and to create variation you need to stack multiple instruments with different patterns.

## Goal

Add **multiple sequencer patterns per instrument** that can be chained into a playback sequence, while keeping the step grid compact and usable.

---

## What This Is NOT

- NOT a full arrangement/timeline editor (that's the multi-section composition goal)
- NOT layering multiple voices on one pattern (that's a separate multi-sequencer feature)
- NOT replacing the current 16-step grid with a scrollable longer grid

---

## Design

### Pattern Count

**4 patterns per instrument: A, B, C, D**

- Enough for verse/chorus variation (AABABA)
- Fits in a compact tab bar
- Each pattern is a full 16-step sequence with all current features (notes, accent, probability, ratchet, conditions)
- Patterns share speed multiplier, bar density, and rotation — these control **how** the pattern plays, not **which** pattern plays

### Playback: The Chain

A **chain** is an ordered sequence of pattern references that defines playback order. One chain entry fires every `chainLength` bars.

```
Chain: [A, A, B, A, C, A, B, A]
        │── bar 1  │── bar 2  │── bar 3  │── ...
Pattern A plays 16 steps, then A again, then B, then A...
```

- Chain length: 1–16 entries (default: 1, meaning just pattern A looping)
- Each entry = index into [A, B, C, D]
- Chain loops when it reaches the end
- Chain position advances every `playEvery` bars (respects bar density)

### UI Layout

```
┌─ Pattern: [A] [B] [C] [D]  Speed ▾  Density ▾  Rotate ▾  Rand Bars ▾  ⚄ ──────────┐
│ (16-step grid for selected pattern)                                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
┌─ Chain: [A][A][B][A] [▸ next bar]  [⬅ shift]  [▶ shift]  [🔁 loop all] ────────────────────────┐
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Pattern tabs** — click to switch which pattern you're editing. Active tab highlighted in instrument color.

**Pattern controls row** — Speed, Density, Rotate, Rand Bars, Randomize. Always visible above the grid. Replaces the current buried controls at the bottom of the grid.

**Chain bar** — compact sequence of pattern pills `[A][A][B][A]`. Click a pill to cycle its pattern (A→B→C→D→A). Current chain position highlighted.

**Chain controls** — add/remove entries, shift pattern indices, quick-fill buttons.

### Interaction Details

#### Editing a Pattern
- Click pattern tab → grid updates to show that pattern's steps
- All step features work the same as today
- Pattern controls (speed, density, rotation) apply to the instrument, not the individual pattern

#### Building a Chain
- Start with chain = `[A]` (one entry, pattern A looping)
- Click "Add" to append a new entry (defaults to A)
- Click any chain pill to cycle its pattern forward (A→B→C→D→A)
- Right-click pill to delete it (minimum 1 entry)
- Drag to reorder entries (future, not phase 1)

#### Playback
- On each global step tick, the instrument checks current chain position
- Chain position increments every `chainLength * playEvery` bars
- Current pattern's `steps[]` array is used for triggering
- Pattern switch happens at step boundary (no mid-step switching)

#### Active Step Highlight
- The grid shows active step highlight for whichever pattern is **currently playing**
- If you're editing pattern B but pattern A is playing, the highlight still shows (so you can see how your edit would play)
- Pattern tab shows a small play indicator for the currently playing pattern

---

## Data Model

### Pattern Object (new)

```js
{
  steps: [{ active, note, accent, probability, ratchet, conditions }, ...],
  // 16 steps, same structure as today
}
```

### Instrument State (extended)

```js
// In toJSON() output:
{
  params: { ... },
  patterns: {
    A: { steps: [...] },
    B: { steps: [...] },
    C: { steps: [...] },
    D: { steps: [...] }
  },
  chain: [0, 0, 1, 0],       // indices into [A, B, C, D], default [0]
  speedMultiplier: 1,
  patternParams: {
    playEvery: 1,
    rotationOffset: 0,
    rotationIntervalBars: 1
  }
}
```

### Backward Compatibility

**Loading old saves** — if `steps` exists at top level but `patterns` doesn't:
1. Migrate `steps` → `patterns.A.steps`
2. B, C, D get empty/default steps
3. `chain` defaults to `[0]` (just pattern A)

**Saving** — always writes `patterns` and `chain`. Old `steps` at top level is no longer written.

---

## Component Changes

### `wam-step-seq` (src/web-audio/ui/step-seq.js)

Current: single 16-step grid.

**Option 1: Multi-pattern inside step-seq** — the component manages patterns and chain internally. Cleaner encapsulation, but couples the component to chain logic.

**Option 2: Single-pattern step-seq, wrapper manages patterns** — `wam-step-seq` stays as-is (one grid). A new wrapper component (`wam-pattern-selector`) holds the tabs, chain bar, and controls. It renders a `wam-step-seq` and calls `seq.steps = patterns[selected]` on tab change.

**Recommendation: Option 2** — keeps step-seq simple and focused, puts pattern/chain logic at the controls layer where it belongs alongside speed/density.

### `WebAudioControlsBase` (src/web-audio/ui/controls-base.js)

New methods:
```js
// In bind() or subclass override:
this._patterns = { A: [...], B: [...], C: [...], D: [...] };
this._chain = [0];
this._currentPattern = 'A';

// Called by wrapper on tab change:
_selectPattern(name) { ... }

// Called by step() each tick to determine active pattern:
_getActivePatternIndex(globalBar) { ... }
```

New `_buildSequencerSection()` override:
```js
_buildSequencerSection({ onRandomize }) {
  // Returns: pattern tabs row + pattern controls row + chain bar
  // Plus the existing wam-step-seq grid
}
```

### `step()` Method (in each instrument controls)

Current:
```js
step(index, time, stepDurationSec) {
  // reads this._seq.steps[index]
}
```

Extended:
```js
step(index, time, stepDurationSec) {
  const patternIndex = this._getActivePatternIndex(this._globalStep);
  const pattern = this._patterns[patternNames[patternIndex]];
  const stepData = pattern.steps[index];
  // trigger with stepData...
}
```

### `toJSON()` / `fromJSON()`

```js
_extendJSON(obj) {
  obj.patterns = this._patterns;
  obj.chain = this._chain;
  // NOTE: old obj.steps is no longer written
}

_restoreExtra(obj) {
  if (obj.patterns) {
    this._patterns = obj.patterns;
    this._chain = obj.chain ?? [0];
    this._syncSequencerToPattern(this._currentPattern);
  } else if (obj.steps) {
    // Backward compat: migrate single steps to patterns.A
    this._patterns = {
      A: { steps: obj.steps },
      B: { steps: this._emptySteps() },
      C: { steps: this._emptySteps() },
      D: { steps: this._emptySteps() },
    };
    this._chain = [0];
  }
}
```

---

## Consolidation Plan (Phase 0)

Before implementing multi-pattern, we consolidate the duplicated sequencer wiring into `WebAudioControlsBase`. Every instrument currently repeats the same ~50 lines of boilerplate.

### What's Duplicated Today (every sequenced instrument)

| Code | Lines | Purpose |
|---|---|---|
| `this._seq = null` in constructor | 1 | Declare sequencer |
| `document.createElement("wam-step-seq")` + `.init()` | 10-15 | Create + init step grid |
| Event listeners for `step-change` / `pattern-change` | 2 | Emit change on edit |
| `step()` method (multiplier, density, rotation, loop) | 35 | Tick handler |
| `_extendJSON` / `_restoreExtra` for steps | 4 | Serialize steps |
| `setActiveStep()` | 2 | Highlight playhead |
| `randomize()` → `this._seq.steps = newSteps` | 1 | Apply randomized pattern |
| **Total** | **~55 lines per instrument** | |

### Consolidation: Base Class Sequencer

Move all boilerplate into `WebAudioControlsBase`. Subclasses provide callbacks:

```js
// In WebAudioControlsBase

// Constructor
this._seq = null;
this._seqPosition = 0;
this._globalStep = 0;
this._patterns = null; // Phase 1: single pattern
this._chain = [0];

// build() — after _buildControls(), create sequencer
this._createSequencer(options.color);

// Subclass callbacks (override these):
_seqInitOptions(color) {
  return {
    steps: this.constructor.DEFAULT_PATTERN(),
    noteOptions: null, // subclasses add scale notes
    accent: false,
    probability: true,
    ratchet: true,
    conditions: true,
    color,
  };
}

_seqTrigger(stepData, time, duration) {
  // Default: instrument.trigger with velocity 0.8
  // Percussion overrides: trigger(velocity, time)
  // Note instruments: trigger(note, duration, velocity, time)
  this._instrument.trigger(stepData.note, duration, 0.8, time);
}

// Base step() — handles ALL sequencer logic:
step(index, time, stepDurationSec) {
  // multiplier check → density check → rotation → step loop
  // calls this._seqTrigger(s, subTime, subStepDur) for each active step
  // calls this._triggerJam() if pending and no step fired
}
```

### Per-Instrument Changes (after consolidation)

Each instrument loses ~50 lines and just overrides callbacks:

```js
// synth-mono.js (BEFORE: ~50 lines of sequencer boilerplate)
_seqInitOptions(color) {
  return {
    steps: WebAudioSynthMonoControls.DEFAULT_PATTERN(),
    noteOptions: scaleNoteOptions(this._rootMidi, this._scaleName, 24, 72),
    probability: true, ratchet: true, conditions: true,
    color,
  };
}
_seqTrigger(s, subTime, subStepDur) {
  this._instrument.trigger(s.note, subStepDur, 0.8, subTime);
}
```

```js
// perc-kick.js (BEFORE: ~50 lines of sequencer boilerplate)
_seqInitOptions(color) {
  return {
    steps: WebAudioPercKickControls.DEFAULT_PATTERN(),
    probability: true, ratchet: true, conditions: true,
    color,
  };
}
_seqTrigger(s, subTime, subStepDur) {
  this._instrument.trigger(0.9, subTime); // drums: velocity + time only
}
```

### Serialization Consolidation

Base class handles `toJSON`/`fromJSON` for patterns + chain:
```js
_extendJSON(obj) {
  obj.patterns = this._patterns;
  obj.chain = this._chain;
  // Subclass hook for extra data (chordSize, etc.)
}
_restoreExtra(obj) {
  // Backward compat: migrate obj.steps → patterns.A
  // Subclass hook for extra restore
}
```

---

## Implementation Phases

### Phase 1: Core Pattern System

- [ ] Data model: `_patterns: { A, B, C, D }`, `_chain: [0]`
- [ ] `step()` reads from active pattern based on chain position
- [ ] `toJSON()` / `fromJSON()` with backward compat migration
- [ ] Pattern tab bar in sequencer section (A/B/C/D buttons)
- [ ] Click tab → switches grid to show that pattern
- [ ] Pattern controls row above grid (Speed, Density, Rotation, Randomize)
- [ ] Chain bar below grid: `[A][A][B][A]` with click-to-cycle

### Phase 2: Chain Playback

- [ ] Chain position tracking in `step()` (advances every N bars)
- [ ] Chain position highlight in UI
- [ ] "Currently playing" indicator on active pattern tab
- [ ] Add/remove chain entries
- [ ] Chain serialization in `toJSON()`

### Phase 3: Quality of Life

- [ ] Pattern copy (duplicate current pattern to another)
- [ ] Pattern clear (empty all steps in a pattern)
- [ ] Chain quick-fill buttons (e.g., fill entire chain with pattern B)
- [ ] Chain length control (1-16 entries)
- [ ] Beat grouping visual (subtle background on steps 1,5,9,13)
- [ ] Condition row auto-hide (hide when all steps have "off")

### Phase 4: Advanced

- [ ] Drag to reorder chain entries
- [ ] Pattern import/export (copy/paste pattern data)
- [ ] MIDI chain trigger (external controller switches pattern mid-chain)
- [ ] Per-pattern speed/density (optional, controversial)

---

## Design Decisions

### Why 4 patterns, not 8?

4 is the sweet spot. Most patterns are AABABA or AABBCCDD. 8 tabs would crowd the UI. If you need more variation, add another instrument instance.

### Why chain instead of timeline?

A chain is simpler than a full timeline. It's a repeating loop of pattern references — no need for absolute timing, section markers, or transitions. It fits the instrument paradigm (each instrument has its own looping pattern). A full arrangement timeline is the composition serialization goal.

### Why share speed/density across patterns?

Speed and density control **how** the pattern plays, not **what** it plays. Sharing them avoids UI duplication and keeps the pattern tab bar clean. If a pattern needs different speed, it can use rotation or bar density tricks. Per-pattern speed is Phase 4 (advanced, opt-in).

### Why keep 16 steps?

16 steps = 1 bar of 16th notes. This is the standard. 32+ steps gets unwieldy in the grid and makes the step selectors hard to use. Pattern chaining gives you 64+ steps of variation without a wider grid.

---

## Migration Plan

### Existing Instruments

Each instrument's controls class overrides `_buildControls()` and creates `this._seq`. The migration:

1. **Step-seq stays single-pattern** — no changes to `wam-step-seq` itself
2. **Controls base adds pattern management** — `_patterns`, `_chain`, tab bar, chain bar
3. **Each instrument's `step()` updated** — reads from active pattern instead of `this._seq.steps`
4. **`_extendJSON` / `_restoreExtra` updated** — handles `patterns` + `chain`
5. **`_buildSequencerSection` extended** — adds tab bar and chain bar around the grid

This can be done in `WebAudioControlsBase` for all instruments at once, then tested per instrument.

### Affected Files

| File | Changes |
|---|---|
| `ui/step-seq.js` | Minimal — keep single-pattern grid |
| `ui/controls-base.js` | Pattern manager, tab bar, chain bar, extended step() |
| `instruments/synth-*.js` | Update step() to read from active pattern, update toJSON/fromJSON |
| `instruments/perc-*.js` | Same as synths |
| `global/sequencer-conditions.js` | None |
| `ui/sequence-grid.js` | None (visualizer sketch, unrelated) |

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Chain logic introduces timing bugs | Test chain position tracking carefully against global step counter; add logging in dev |
| Backward compat breaks old saves | Migration path tested with sample songs; old `steps` → `patterns.A` |
| UI gets crowded | Phase 3 beat grouping and condition auto-hide reduce visual noise; pattern tabs are compact |
| Instruments with no sequencer (Loop Player, Vocoder) | Pattern system is opt-in via `_buildSequencerSection`; non-sequenced instruments unchanged |
| Serialization format change breaks share codes | Share codes use `toJSON()` output; old codes with `steps` are migrated on load |

---

## Open Questions

1. **Chain entry count**: Fixed at 8? User-configurable 1-16?
2. **Pattern duplication**: Simple copy button, or deeper (merge patterns)?
3. **Per-pattern visibility**: Should chain entries have on/off toggles (skip certain entries)?
4. **MIDI chain control**: Can external controllers trigger pattern switches? (Phase 4)
5. **Randomize scope**: Does Rand randomize the active pattern only, or all patterns?
