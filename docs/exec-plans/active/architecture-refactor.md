# Plan: Architecture Refactor — Headless Pattern Engine, Schema-Driven Controls, Smaller Pieces

Status: In progress
Owner: Justin Gitlin
Created: 2026-11-16

## Goal

Pay down the structural debt from the early "throw it together" phase now that the playground's direction is clear, so that:

1. **Songs play without the UI.** Client projects and the generative apps can load a playground song JSON and play it with the same engine the playground uses.
2. **Each instrument is declared once.** Params, serialization, controls and presets all derive from the `PARAMS` schema.
3. **No 2,000-line classes.** `controls-base.js` becomes a set of small, separately-testable pieces.
4. **Modules talk through public APIs**, not each other's `_private` fields.

Each phase ships on its own with the suite green. No behavior changes unless a phase says so (and characterization tests document it).

## Findings (2026-11-16)

| Area | Evidence | Problem |
|---|---|---|
| Pattern playback lives in the UI | `WebAudioControlsBase.step()` runs patterns A–D, chain, density (`playEvery`), rotation, trig conditions, probability, jam; ratchets/gate in `instrument-base._triggerRatcheted` | Can't play a song headless; the song format (`toJSON`/`fromJSON`) is owned by the UI; generative apps re-implement simpler loops. |
| Pattern playback is untested | 24 test files; none cover chain/density/rotation/conditions | Any refactor is blind. |
| God class | `controls-base.js`: 2,375 lines, 111 methods — strip, presets, sound design, sequencer UI + engine, FX, routing, serialization, performance API | Hard to change one concern without touching others. |
| Schema half-adopted | 9 subclasses hand-copy enum params in `_extraToJSON`; selects/toggles hand-built per instrument | Every new param needs edits in 3–4 places. |
| Private reach-ins | `inst._chordSize` ×11, `inst._scaleName` ×6, `ctrl._instrument`, `ctrl._sliders`, `_paramBindings`; Phase 4's performance surface uses `c._presetSelect`, `c._soundHistory`, `c._randomizeAllParams` | Hidden coupling; renames break distant code. |
| Instrument registry in the app | `INSTRUMENT_TYPES` in `playground.js` repeats `color` twice and an identical `step` lambda 13× | A headless song loader needs this registry in the library. |
| Stringly-typed events | 30 custom event names as string literals | Typos fail silently. |
| Duplicated pattern randomizers | 7 instruments copy the `STEP_WEIGHTS` weighted-pattern logic | Improvements must be made 7 times. |
| Dead code | `_makePresetDropdown` (deprecated, no callers); `_seqExtendJSON` / `_seqRestoreExtra` hooks (no overrides) | Noise. |
| CSS sprawl | 52 inline `style.cssText` assignments; 25 files inject `<style>` | Low priority. |

### What the Phase 0 tests found in `step()`

Confirmed by [tests/pattern-playback.test.js](../../../tests/pattern-playback.test.js) (each pinned as `KNOWN BUG` / `QUESTION`):

| # | Behavior | Verdict |
|---|---|---|
| 1 | **Chain + density:** with `playEvery: 2`, chain A→B plays A A B B — the chain advances every 2 *played* bars (4 real bars) instead of every played bar. | **KNOWN BUG** |
| 2 | **Rotation + density:** the rotation check runs before the density skip, so `rotate()` fires on every tick of a skipped bar — 67 calls in 8 bars at density 2 (97 at density 4) instead of 3. Audibly correct only because 16 extra rotations of a 16-step pattern are a full cycle; each call still emits `step-change` (grid repaint, pattern re-sync, LCXL step-LED repaint). | **KNOWN BUG** (perf / event storm) |
| 3 | **Conditions + density:** trig conditions count real bars, and with density 2 every played bar is even, so `1:2` never skips. | **QUESTION** — should conditions count played bars? |
| 4 | **Stop → Play mid-chain:** `resetSequencer()` resets the step position but not the chain position, so Play resumes on the current chain pattern rather than pattern 1. | **QUESTION** — intended? |

Ruled out (behave sensibly, now pinned): rotation does affect multi-pattern playback; at 0.5× speed, conditions and density count *pattern cycles* consistently.

## Phases

### Phase 0 — Characterization tests for pattern playback
- [x] Harness [tests/helpers/track-harness.js](../../../tests/helpers/track-harness.js): mounts a real Controls panel in jsdom (FX off), loads a track via `fromJSON()` (song `state` shape), ticks `step()`, records fires / instrument hits / jams. Shared test setup gained canvas, ResizeObserver and analyser stubs so UI panels build in jsdom.
- [x] 22 tests: single pattern, timing, chain + wrap, reset, density, rotation (+ interval, + density), speed 2× / 0.5×, probability (seeded), trig conditions (incl. 0.5× and density), ratchets, jam, `launchPattern` (mid-bar queue, boundary).
- [x] Findings pinned as `KNOWN BUG` / `QUESTION` (table above).

### Phase 1 — Headless pattern engine + song player
- [ ] `global/pattern-track.js`: patterns A–D, chain, density, rotation, conditions, probability, jam queue, launch/queue — pure data + `tick()` → step events. No DOM.
- [ ] `instruments/index.js`: the instrument registry (id, label, color, class, controls tag, default FX) — moved out of the playground.
- [ ] `global/song-player.js`: load a song JSON → instruments + tracks, driven by the existing `Sequencer`. Works with no UI (client projects, generative apps, Node-free tests).
- [ ] Controls own a `PatternTrack` and render it; `Controls.step()` delegates. Phase 0 tests pass unchanged.
- [ ] Fix the confirmed `step()` bugs (one at a time, updating the KNOWN BUG tests).

### Phase 2 — Schema-driven serialization and controls
- [ ] `toJSON`/`fromJSON` param sections iterate `PARAMS` (numbers, enums, bools); delete per-instrument `_extraToJSON` copies.
- [ ] Generate selects/toggles from enum/bool schema entries; delete hand-built ones.
- [ ] Migrate blipfx, sample player, loop player to `PARAMS`.

### Phase 3 — Split `controls-base.js`
- [ ] Extract `ChannelStrip`, `PresetPanel` (presets + sound design + locks), `SequencerPanel` (grid, tabs, chain bar, density/rotate UI), composed by a thin `WebAudioControlsBase`.
- [ ] Target: no file over ~600 lines in `ui/`.

### Phase 4 — Public APIs only
- [ ] Instruments: public `scale` / `chordSize` (replace `_scaleName` / `_chordSize` reach-ins).
- [ ] Controls: performance API covers everything the MIDI layer uses (`hasPresets`, `canUndo`, `randomizeSound()`, `title`); `performance-surface.js` / `auto-map.js` stop touching `_` fields.

### Phase 5 — Small cleanups
- [ ] `global/events.js` — event-name constants (like `StoreKeys`).
- [ ] `global/pattern-gen.js` — shared drum/melodic pattern generators; instruments keep only their parameters.
- [ ] Delete dead code (`_makePresetDropdown`, unused hooks).
- [ ] Move playground inline styles into CSS.

## Out of scope

- Rewriting the generative apps. Keep them working; they can adopt the song player and registry later.
- New features — this plan is structure only (bug fixes in Phase 1 excepted).
