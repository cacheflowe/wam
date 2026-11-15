# Plan: Jammable Playground — Param Schema, Mutate, Preset Store, LCXL Performance Layout

Status: In progress
Owner: Justin Gitlin
Created: 2026-11-15

## Goal

Make the Instrument Playground *the* app in this repo: a jammable loop-writing tool that grows into a performance tool, driven from the Launch Control XL. Other apps keep using the engine (important for client work), but product effort centers on the playground.

Three user-facing outcomes:
1. **Hardware you can learn.** The same knob does the same kind of thing on every instrument; faders are always the mixer; button modes switch between steps, mixer, and performance actions.
2. **Randomize that sounds good, and Mutate.** Curated per-param ranges, a "nudge from here" mutate, and undo, so rolling sounds is a creative tool rather than a slot machine.
3. **Presets as data.** Presets live in JSON files; nice sounds found while jamming get written straight back to the repo.

## Context (findings, 2026-11-15)

- **Param definitions live in the UI layer.** `SLIDER_DEFS` is a static on each `…Controls` class, not the instrument. The engine doesn't know its own params, so randomize/presets/auto-map all depend on the DOM. This contradicts [PRODUCT_SENSE.md](../../PRODUCT_SENSE.md) principle 1 ("Instruments first, UI second").
- **Params are declared twice.** Most instruments repeat each slider literal in `_buildControls` (`mkSlider({ param: "release", min…max… })`) alongside `SLIDER_DEFS`; ranges can drift apart.
- **Selects/toggles are invisible to the schema.** `oscType`, `lfoShape`, etc. are registered ad hoc in the UI (`_selects`, `_toggles`).
- **Randomize** ([controls-base.js `_randomizeAllParams`](../../../src/web-audio/ui/controls-base.js)) samples uniformly over each slider's full UI range (log-uniform for log params) and picks any select option. UI ranges are sized for sound-design reach, not musical safety.
- **Auto-map is positional** ([auto-map.js](../../../src/web-audio/midi/auto-map.js)): registry order → knobs, then faders. The registry also includes the channel strip's `volume`/`pan`. Same knob = different function per instrument; 7–31 params per instrument vs. 32 controls.
- **Presets** are `static PRESETS` objects in instrument JS. Many are partial, so switching presets can leave stale values from the previous sound. User-saved presets go to localStorage + clipboard JSON for manual pasting; the capture skips `volume`, which is how two presets ended up failing the "every preset has volume" test.
- **Envelopes** were broken on notes shorter than attack+decay — fixed first (Phase 0).

## Decisions (locked 2026-11-15)

| Decision | Choice |
|---|---|
| Faders | **Always the mixer** — volume of instrument slots 1–8, independent of focus. |
| Randomization | Curated ranges per param **plus Mutate** (jitter around current sound). |
| Hardware layout | Semantic knob rows by param role + button modes (Steps / Mixer / Perform). |
| Presets | Move to **JSON data files**; dev server writes new presets to disk. |
| Order | Envelope fix → schema → sound-design engine → preset store → hardware layout → curation. |

## Architecture

### Param schema on the instrument (`static PARAMS`)

Each instrument class owns its param list. Controls read `instrument.constructor.PARAMS` (keeping `SLIDER_DEFS` as a compat alias during migration) and build sliders from it — one declaration per param.

```js
static PARAMS = [
  { param: "cutoff", label: "Cutoff", min: 50, max: 10000, step: 1, scale: "log",
    group: "filter", role: "cutoff", priority: 1, rand: { min: 150, max: 3500 },
    tooltip: "Base filter cutoff. Lower = darker tone." },
  { param: "oscType", label: "Wave", type: "enum", options: ["sawtooth", "square"],
    group: "osc", role: "wave", rand: { weights: [3, 1] } },
  { param: "volume", …, rand: false },   // never randomized
];
```

- `group` — UI section + lock unit (`osc`, `filter`, `amp-env`, `filter-env`, `mod`, `pitch`, `fx`, `seq`).
- `role` — shared vocabulary in `global/param-roles.js` (`cutoff`, `resonance`, `envAmt`, `drive`, `attack`, `decay`, `sustain`, `release`, `gate`, `detune`, `lfoRate`, `lfoDepth`, `glide`, `octave`, `tone`, `noise`, `wave`, …). Drives the hardware layout.
- `priority` — which params get hardware first when an instrument has more params than knobs.
- `rand` — curated `{min, max}` (scale-aware), optional `bias`, enum `weights`, or `false` to exclude.

### Sound-design engine (`global/sound-design.js`, no DOM)

- `randomize(instrument, { locks })` — sample each param inside its `rand` range (log params in log space).
- `mutate(instrument, amount, { locks })` — gaussian jitter in normalized, scale-aware space, clamped to the `rand` range; enums switch with probability ∝ amount.
- `static constrain(params)` hook per instrument for cross-param rules (e.g. high resonance caps drive; attack < gate length on mono).
- **Sound history**: every randomize/mutate/preset load pushes a snapshot → **Undo / Redo**.
- Works headless, so the generative apps and client projects can mutate sounds too.

### Preset store (`src/data/presets/<instrument>.json`)

```json
{ "instrument": "synth-acid", "presets": [
  { "name": "Squelch", "tags": ["bass", "acid"], "params": { "cutoff": 400, … } } ] }
```

- Instrument modules import their JSON (`with { type: "json" }`) → still "import one file, get presets".
- `applyPreset` fills params missing from a preset with schema defaults → no stale-value leakage.
- **Dev-only Vite plugin** (`configureServer` middleware): `POST /__wam/presets/<instrument>` writes the file (stable key order, pretty-printed). In production builds Save falls back to localStorage + Export, as today.
- Validation test: every preset's keys ⊆ schema, values within `min/max`.

### LCXL performance layout

| Surface | Function |
|---|---|
| 8 faders | Mixer: slot 1–8 volume (LED mirror where supported). |
| Knob row 1 | Focused instrument **tone**: cutoff · resonance · envAmt · drive · wave/tone · filter-env decay · noise/character · (priority fill) |
| Knob row 2 | **Envelope/amp**: attack · decay · sustain · release · gate · filter attack · filter release · (fill) |
| Knob row 3 | **Movement/pitch/FX**: detune · lfoRate · lfoDepth · glide · octave · reverb send · delay send · preset browse |
| ← / → | Page through the remaining params (page 2+ by priority). |
| ↑ / ↓ | Previous / next instrument (exists). |
| Mute / Solo / Rec Arm | Mode select: **Steps** / **Mixer** / **Perform**; lit button = current mode. |
| 16 buttons — Steps | Toggle steps of the focused pattern (exists). |
| 16 buttons — Mixer | Top: mute slot 1–8 · Bottom: focus slot 1–8 (solo TBD). |
| 16 buttons — Perform | Top: pattern A–D, prev/next preset, save preset · Bottom: mutate small / mutate big / randomize / undo / redo / lock group. |

Placement is by `role` (fixed knob per role), then unfilled slots in a row get that row's highest-priority unplaced params. Manual MIDI-learn still wins. An on-screen **hardware map** strip shows what each knob/fader/button does for the focused instrument and current mode.

## Phases

### Phase 0 — Envelope fix ✅ (`9628943`)
- [x] `scheduleEnvelope` core; `applyADSR`/`applyFilterEnv` wrap it; acid VCA migrated.
- [x] Per-instrument `gate` (note length in steps): mono/poly 1, pad 4.
- [x] Timeline-evaluating envelope tests; snapshots updated only for the bug cases.

### Phase 1 — Param schema in the engine (no behavior change)
- [x] Role + group vocabulary — lives in `global/param-schema.js` (`ROLES`, `GROUPS`) with normalize/quantize/`randRange`/`validateParams` helpers.
- [x] `static PARAMS` on instrument classes; Controls `SLIDER_DEFS = sliderDefs(Instrument.PARAMS)` (acid).
- [ ] Enum params (selects) in the schema; UI registers selects from it.
- [x] `mkSlider("param", overrides?)` looks up the schema def; acid's duplicated literals removed. Remaining instruments: per migration below.
- [x] Schema validation test ([tests/param-schema.test.js](../../../tests/param-schema.test.js)) — add each instrument to `MIGRATED` as it moves.
- [ ] Migrate: ~~acid (pilot)~~ ✅ → poly → mono → pad → fm → 808 → kick/snare/hihat → blipfx → sample player/looper.

### Phase 2 — Sound-design engine
- [x] `global/sound-design.js`: pure `randomizeValues`/`mutateValues` (locks, `constrain` hook, seeded rng), headless `randomizeInstrument`/`mutateInstrument`, `SoundHistory` (undo/redo, capped, collapses no-ops).
- [ ] Curated `rand` ranges per instrument (by ear, with Justin). Acid: first pass + `static constrain` done — needs a listening pass.
- [x] Controls: Rand uses the engine (legacy full-range fallback for unmigrated instruments); **Mutate** + Subtle/Medium/Wild; **Undo/Redo** (preset loads are undoable too). All applied via the `knob-input` event path.
- [ ] Group-lock UI (engine supports `locks`; controls read `this._soundLocks`). Proposed: click a section title to lock it.
- [ ] Level safety: per-instrument gain trim after randomize — investigate rendering a test note in an `OfflineAudioContext` to measure RMS.
- [x] Tests: [tests/sound-design.test.js](../../../tests/sound-design.test.js) — ranges, log-uniform draws, locks, constrain, mutate scaling/identity/no-wander, history, acid end-to-end. Verified in-browser: Rand/Mutate/Undo/Redo keep knobs and instrument in sync.

### Phase 3 — Preset store
- [ ] Migration script: `static PRESETS` → `src/data/presets/<instrument>.json` (full param sets, tags).
- [ ] `applyPreset` fills missing params from schema defaults.
- [ ] Dev-only Vite plugin writes presets; Save button posts there in dev, localStorage/Export in prod.
- [ ] Preset dropdown grouped/filterable by tag; prev/next preset actions.
- [ ] Validation test over all preset files.

### Phase 4 — LCXL performance layout
- [ ] Role-based auto-map (rows by role, paging for overflow); drop volume/pan from knob candidates.
- [ ] Faders → mixer (slot volumes), independent of focus.
- [ ] Button modes (Steps / Mixer / Perform) on Mute/Solo/Rec Arm with LED mode indicator.
- [ ] Perform-mode actions wired to commands (`mutate`, `randomize`, `undo`, `preset-next`, `pattern-select`, …) — keyboard mirrors where sensible.
- [ ] On-screen hardware map strip.
- [ ] Update [launch-control-xl-mapping.md](launch-control-xl-mapping.md) Phase 6 items that this supersedes; manual QA in [midi-input-and-led-testing.md](../../testing/midi-input-and-led-testing.md).

### Phase 5 — Curation
- [ ] Per instrument: jam, mutate, save keepers to JSON, delete weak presets, tag everything.
- [ ] Every instrument ships ≥ 6 strong presets across its useful roles.

### Phase 6 — Product framing & docs
- [ ] PRODUCT_SENSE / roadmap: playground is the primary product; engine is the reusable layer for client work.
- [ ] FRONTEND/BACKEND/ARCHITECTURE updated for schema, sound-design engine, preset store.

## Open questions

- Mixer mode bottom row: focus-select vs. solo? (Proposed: focus; solo via shift-hold later.)
- More than 8 instruments: fader banks via ←/→ in Mixer mode?
- Keep Device button as play/stop, or make it a shift modifier?
- Pad's default `gate` of 4 steps — confirm by ear. Acid's fixed `hold = 0.7 × step` could become its `gate`.
- Should `gate` be per-step (ties / note length per step) later? Per-instrument is enough for now.

## Out of scope

- Per-step parameter locks (Elektron p-locks) — natural follow-up once the schema exists.
- Non-LCXL controller layouts (the role-based map makes them cheap to add later).
