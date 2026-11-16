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

## Decisions (2026-11-16)

| Question | Decision |
|---|---|
| Playback model | **One global clock; tracks derive position from the tick** (borrowed from Interphase's `Metronome` → `BEAT` → `Sequencer` design). No per-track counters. |
| Trig conditions vs density | Conditions count **played cycles** (consistent with how they already counted at 0.5×). |
| Stop → Play mid-chain | Play **restarts the chain from pattern 1**. |
| Rotation | Applied at read time; stored patterns never move. |
| Note storage | **Scale degrees by default** (`{ degree, octave }` relative to the song root, resolved against the current key/scale at play time) with optional per-step `accidental` (±1 semitone) and optional absolute `midi` escape hatch. Key changes transpose; scale changes keep melodic contour (degrees wrap into the next octave across scale sizes). Old songs convert losslessly on load (in-scale → degree; out-of-scale → degree + accidental) and the song JSON gains a format version. |

All are overridable — say the word and the tests flip.

## Borrowing from Interphase

Reviewed `haxademic/.../media/audio/interphase` (Metronome, Sequencer, SequencerConfig, Scales, `core.data.patterns`). Adopting:

- **Global clock → derived track position** (Phase 1, done for playback).
- **Pattern generators as strategies** (`ISequencerPattern`: Interval, Sine-threshold, Noise-threshold, weighted Random, Techno) + pattern ops (`ensureOneStepActive`, `limitToMaxSteps`, `nudge`, `morph`), with **per-instrument generator lists** in the instrument registry (like `SequencerConfig`). Replaces the 7 copied `STEP_WEIGHTS` randomizers.
- **Evolve**: per-track small (nudge/morph) vs. big (every 4th: new pattern + note scheme) pattern changes; global auto-evolve **staggered across tracks** so only one changes at a time.
- **Play-time note schemes** (Interphase `notesByStep`): optional per-track generative melody (step + offset through the scale, 4th/5th harmony, octave jumps) on top of degree storage.
- **Ensemble configs** → registry "kits" + a "new jam" starter.
- BPM easing (glide between tempos).

Not adopting: static globals, string-prefixed UI keys, clock-message triggering (wam's lookahead + audio-clock timestamps are more precise), hardcoded channel special cases.

## Phases

### Phase 0 — Characterization tests for pattern playback
- [x] Harness [tests/helpers/track-harness.js](../../../tests/helpers/track-harness.js): mounts a real Controls panel in jsdom (FX off), loads a track via `fromJSON()` (song `state` shape), ticks `step()`, records fires / instrument hits / jams. Shared test setup gained canvas, ResizeObserver and analyser stubs so UI panels build in jsdom.
- [x] 22 tests: single pattern, timing, chain + wrap, reset, density, rotation (+ interval, + density), speed 2× / 0.5×, probability (seeded), trig conditions (incl. 0.5× and density), ratchets, jam, `launchPattern` (mid-bar queue, boundary).
- [x] Findings pinned as `KNOWN BUG` / `QUESTION` (table above).

### Phase 1 — Headless pattern engine + song player
- [x] `global/pattern-track.js`: `trackPosition` (pure, derived from tick), `stepFires`, `PatternTrack` (patterns, chain, density, rotation at read time, speed sub-steps, launch/queue). [tests/pattern-track.test.js](../../../tests/pattern-track.test.js).
- [x] `Controls.step()` delegates (one `_tick` counter; old `_seqPosition` / `_globalStep` / `_seqRotate` gone). Phase 0 tests passed unchanged except the four decided changes, which flipped deliberately: chain + density fixed, rotation storm gone (0 `rotate()` calls), conditions count played cycles, Play restarts the chain. Verified in-browser with `wobbler` (chained acid/fm alternate A/B per bar).
- [x] `instruments/registry.js`: instrument registry (id, label, color, class, controls tag, constructor options, default FX, sequenced, app sample set) + `createInstrument` / `controlsOptions`. Playground's 190-line table → a 12-line mapping that adds its sample folders; verified identical to the old table for all 17 types. Pattern generators get added in 1b.
- [x] **Headless audio channel**: `fx/fx-chain.js` (`<wam-fx-unit>` is now its UI; one `set(param)` replaces the knob switch; legacy-save normalization moved in) and `global/channel.js` (`Channel` with derived fader gain = volume × mute × solo; replaced the strip's pre-mute/pre-solo volume juggling for instruments AND the master bus via `gainFaderState`).
- [x] Public instrument musical context: `setScale`, `scaleName`, `scaleRoot`, `chordSize`, `bpm`, `onTick`, sampler `melodicMode` — Controls stopped writing `_scaleName` / `_chordSize` / `_melodicMode` / `_bpm` (part of Phase 4 done early).
- [x] `global/song-player.js`: loads a song → registry instruments + Channels + PatternTracks on one clock; master gain → master FxChain (transport order). 15 per-instrument equivalence tests (wobbler + techdrift): headless fires the same steps at the same times as the UI panels. Renders offline in the browser (wobbler: 8 tracks, 80 notes / 4 bars).
- [ ] Song player v2: samplers / loop players (sample loading without UI), vocoder, sidechain routing (`compSourceId`), performance-stream hookup.
- [x] Master safety limiter (`fx/fx-limiter.js`: fast DynamicsCompressor + waveshaper ceiling at ≈ −0.1 dBFS) at the end of the master bus — before meters, recorder and output — in both `<wam-transport>` ("Limit" toggle on the master strip, default on, saved as `transport.limiter`) and `SongPlayer`. wobbler offline: peak 1.585 / 1,201 samples over full scale → 0.990 / 0, RMS unchanged.
- [x] Global clock (`global/clock.js`): wraps the lookahead sequencer, owns the tick since Play, emits `{ tick, step, bar, beat, downbeat, time, dur, bpm }`; sequencer-compatible surface so transport/recorder take it as-is. Playground (panels, loop players, visualizer beat, performance stream) and SongPlayer run on it; the playground's `_globalStep` is gone; panels read `clock.current.tick` (own counter only as a standalone fallback). Behavior change: a panel added mid-song joins at the **global** chain position (in step with the others). BPM easing → later, if wanted.

### Phase 1b — Generators, evolve, scale-degree notes
- [x] `global/pattern-gen.js`: rhythm generators (Interphase interval/sine/noise/random/techno + euclid, weighted, backbeat, offbeat, clave, broken), note schemes (byStep + walk, rootFifth, arp, motif, pedal, random), step decorators (accents, ghosts, ratchets, conditions, open hats), ops for Evolve (rotate, nudge, morph, flip, thin, thicken, fill, reverse, invert, transpose, shuffleNotes, redecorate), role recipes (kick/snare/hat/bass/lead/keys/pad/fx). Instruments declare `PATTERN_ROLE` / `NOTE_RANGE` / `PATTERN_ACCENTS`; one base `Controls.randomize()` replaced 9 copied randomizers (808/FM ones were dropping step fields). Rand tooltip shows the generator ("euclid 5/16 · walk"). Seeded + reproducible from `meta`.
- [x] Evolve (`global/evolver.js`): per-track variations with gravity (home/original layers) + permanent evolve/keep/return/undo; `Conductor` with Energy / Drift / Auto / phrase, round-robin staggering, pre-phrase drum fills; ∿ Evolve drawer panel; LCXL C8 = Energy, Mixer bottom row = Jam, Perform Evolve / Keep / Return. Grid round-trip made lossless (hi-hat `open` was dropped).
- [ ] Scale-degree note storage (+ accidental / absolute escape hatches), song format version + lossless migration, note picker shows degrees in the current key.
- [ ] Optional per-track generative note scheme.

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
