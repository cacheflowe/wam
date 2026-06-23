# Roadmap

Owner: Justin Gitlin
Last reviewed: 2026-05-03

## Vision

Build a library of browser-based instruments that are:
1. Individually importable into any web app
2. Fully functional with or without the Controls UI
3. Well-documented enough that agents and new contributors can add instruments following existing patterns

## Current State (as of 2026-05-02)

**Instruments (complete)**:
- `WebAudioSynthAcid` — TB-303-style acid bass
- `WebAudioSynth808` — 808 sub-bass
- `WebAudioSynthFM` — 2-op FM poly synth
- `WebAudioSynthMono` — general mono synth
- `WebAudioSynthPad` — poly chord pad
- `WebAudioSynthBlipFX` — procedural SFX
- `WebAudioPercKick` — 808 kick with click + drive
- `WebAudioPercHihat` — 909-style metallic + noise with open/closed choke
- `WebAudioPercSnare` — layered snare/clap (tone body + noise snap + buzz)
- `WebAudioLoopPlayer` — generalized BPM-synced loop player with time-stretch
- `WebAudioVocoder` — 16-band phase vocoder with mic input (needs work/testing)

**Effects (complete)**:
- Reverb, Delay (BPM-sync), Chorus, Filter, Distortion, Pitch Shift, Time Stretch
- `WebAudioFxUnit` Web Component composing a well-rounded set of effects

**Infrastructure (complete)**:
- Lookahead sequencer with per-instrument speed multiplier (0.5x/1x/2x)
- Per-step probability, ratchet, conditions, pattern rotation, bar density
- Unified step sequencers on all instruments (Acid, 808, FM, Mono, Pad, Kick, HiHat, BlipFX)
- Channel strip (volume, pan, mute, VU meter) on every instrument
- Slider, step-sequencer, waveform, level meter Web Components
- Music theory / scales module
- `toJSON()` / `fromJSON()` state persistence
- PicoCSS tooltips on all slider labels
- Transport panel with master FX, waveform, BPM, key/scale, share URL

**Apps**:
- `acid-breaks` — acid techno live performance app
- `generative-ambient` — plant-driven ambient music generator
- `vocoder` — robotic vocal processor (WIP)

## Recently Completed

| Goal | Completed |
|---|---|
| **Composition serialization (Phase 1/2)** | 2026-05-05 — Schema designed, `playground.js` now auto-saves arrangement state to `localStorage` and supports Base64 URL share codes via the transport panel. |
| **Octave controls on all note instruments** | 2026-05-02 — `octaveOffset`/`octaveJumpProb` added to Mono, Pad, 808; FM already had them |
| **Chord synths → single-note capable** | 2026-05-02 — FM and Pad chord selector now includes "1 note" option; sequencer bypasses chord builder when size=1 |
| **Transport spacebar everywhere** | 2026-05-02 — Spacebar play/stop added to Playground, Generative Music, Generative Ambient, Plants apps |
| **Slider focus blur** | 2026-05-02 — `pointerup` → `blur()` added to `WebAudioSlider` |
| **BlipFX lock sound toggle** | 2026-05-02 — 🔓/🔒 button in BlipFX action row; guards `randomize()` in `step()` and `triggerNow()`; persisted in JSON |
| **Jam buttons in channel strip** | 2026-05-02 — ♩ (Acid), ♫ (FM), ▶ (BlipFX) moved to always-visible channel strip via `_buildStripActions` hook; `.wam-jam-btn` style |
| **Sequencer UI cleanup** | 2026-05-02 — Randomize button moved into step-seq `patternControls` row via `onRandomize` callback; action rows removed from Kick, HiHat, Snare, Mono, 808, Pad, Acid; FM action row trimmed to chord-size + rand-preset |
| **Build `src/site/app.js` demo harness** | Pre-existing — hash-routed menu wiring all apps; confirmed complete |
| **Test playground** | Pre-existing — `playground.js` with per-instrument add/remove and shared transport; confirmed complete |
| **Reorganize `src/web-audio/` into subdirs** | Pre-existing — `instruments/`, `fx/`, `ui/`, `global/` already in place; confirmed complete |
| **Loop Player migration** | 2026-05-04 — `sample-looper.js` introduced with `WebAudioLoopPlayer`; folder-based loop discovery in apps; later cleanup removed `break-player.js` compatibility alias |
| **Rename & shorten prefix** | 2026-05-03 — Replaced verbose `web-audio-` prefix on all file names, Web Component tag names, and CSS class namespaces with `wam-` (Web Audio Module) |
| **Channel strip section toggles** | 2026-05-03 — Independent Controls / Sequencer / FX toggle buttons replace single expand/collapse drawer; state persisted in JSON |
| **Loop Player (Break Player evolution)** | 2026-05-04 — Generalized break player into BPM-synced `WebAudioLoopPlayer` supporting any audio loop type |
| **Composition serialization & saving (Phase 3+)** | 2026-05-09 — Full IndexedDB integration via `arrangement-library.js` with CRUD, drag-to-reorder, export/import, clipboard support, and sample songs; wired into Playground UI |
| **Knob controls / compact UI** | 2026-05-11 — `<wam-knob>` SVG rotary knob component replaces sliders across all instruments, FX, channel strips, and filter sweep; `<wam-param-display>` floating overlay for touch feedback |
| **Reverb overhaul** | 2026-05-11 — Improved IR synthesis with early reflections, frequency-dependent decay (damping), stereo decorrelation (width), normalization; 3 new controls (Decay, Damping, Width) exposed in FX unit UI |
| **Event-driven control everywhere** | 2026-05-11 — All parameter changes flow through `knob-input` events via delegated listener; `_registerSelect()`/`_registerToggle()` base-class helpers eliminate per-instrument boilerplate; presets, restore, and automation all use the same event path |
| **UI grid layout** | 2026-05-11 — `.wam-controls` and `wam-fx-unit` use CSS Grid (`auto-fill, minmax(200px, 1fr)`) for responsive section columns; `.wam-section` bordered cards; `.wam-section-controls` nested grid for knob layout; `.wam-ctrl`/`.wam-ctrl-wide` column spanning |

## Near-Term Goals

| Goal | Priority | Notes |
|---|---|---|
| **Vocoder polish & testing** | High | Gate threshold added, needs more testing; latency optimization; carrier routing verified |
| **FM synth quality** | High | FM sounds inferior to Mono — investigate why; retune presets; fix silent presets |
| **MIDI keyboard input** | Medium | Map note-on/off to currently-selected instrument's `trigger()`; see **MIDI** section below |
| **MIDI sync to focused instrument** | High | Ensure transport-linked MIDI control targets the active/focused instrument UI + engine instance in real time; see **MIDI** section below |
| **Launchpad XL full control mapping** | Medium | Create complete Launchpad XL mapping for transport, sequencer, mixer, and macro controls; include external controller PDF in docs and map by control ID |
| **Double-click/tap reset to default** | Medium | Double-click (or double-tap) any UI control (sliders, knobs, dropdowns, toggles) resets it to its default value |
| **True preset save/recall** | Medium | Two modes: (1) Vite dev — externalize presets to JSON files, auto-write on save/delete via dev middleware; (2) Static site — download preset collection as .json, drag-and-drop .json onto instrument to restore. Currently localStorage + clipboard export; see **Preset Persistence** section below |
| **Per-section randomize** | Medium | Randomize individual control-panel sections (e.g. just Oscillator, just Filter, just Envelope) instead of all params at once; add a randomize button per section header |
| **Ad hoc audio loading** | Medium | Drop an audio file (or use file input selector) onto `sample-looper.js` and `sample-player.js` controls to load custom user audio |
| **Parametric EQ** | Medium | 3-4 band EQ as first effect in FX unit chain; new `eq.js` with engine + UI; see **New Effects** section below |
| **Sidechain compressor** | Medium | Duck instrument gain based on another instrument's amplitude; instrument selector UI (like vocoder carrier routing); see **New Effects** section below |
| **MediaRecorder video+audio capture** | Medium | Record window/interface as video+audio; transport-aware loop recording; see **MediaRecorder Recording** section below |
| **Visualizer corner positioning for LED output** | Medium | Add position presets (top-left/top-right/bottom-left/bottom-right) with emphasis on top-corner LED panel capture workflows |
| **Visualizer focused-knob mode** | Medium | Add a mode where the active knob takes the full visualizer view with large label + live value readout |
| **Major code review and refactor pass** | High | Repository-wide audit for duplication, dead code, naming consistency, and module boundaries; ship as phased refactor with regression checks |
| Responsive volume / overload protection | Medium | See **Responsive Volume** section below |
| Pattern evolution tools | Medium | Slow morph / mutation of sequences over time; see **Pattern Evolution** section below |
| **Humanization tools** | Medium | Swing, trigger delay, velocity variation, timing jitter, ghost notes; see **Humanization** section below |
| **Auto-normalization / gain staging** | Medium | Per-instrument default volumes and red-line protection; see **Auto-Normalization** section below |
| MIDI learn | Medium | See **MIDI** section below |
| Per-instrument product specs | Medium | Fill out individual spec files in [product-specs/](../product-specs/) |
| Refine existing instruments & effects | Ongoing | Tuning, preset quality, edge cases |
| Add new instruments & effects | Ongoing | See **Possible Future Instruments** section below |
| npm package publication | Low | Export each instrument as a named module; publish to npm |
| **WebSocket remote-control jamming surface** | Future | Expand collaborative jamming into a dedicated remote-control UI surface with synced shared state over WebSocket |

## Open Questions

- **Do we need vitest-style tests?** The test suite adds maintenance burden. Consider whether manual playground testing + build checks are sufficient, or if automated tests provide enough value for this project.

## UI Direction

Goal: evolve from the current slider-heavy layout toward a more VST-like compact interface.

**Key changes**:
- **Knob controls** to replace horizontal sliders — more compact, better use of space. Here are some nice options/inspiration:
  - https://denilson.sa.nom.br/html5-knob/
  - https://nicegui.io/documentation/knob
  - https://codepen.io/jhnsnc/pen/KXYayG
  - https://www.cssscript.com/demo/touch-enabled-knob-control-pure-javascript-jim-knopf/
  - https://dev.to/ndesmic/how-to-make-a-rotational-knob-input-with-web-components-43e3
- **Tighter instrument panels** — current CSS leaves too much empty space
- **VST-inspired layouts** — group related params visually (osc section, filter section, envelope section)
- This is a gradual migration; knob component first, then instrument-by-instrument conversion

## Channel Strip: Independent Section Toggles

Goal: replace the single expand/collapse drawer with three independent toggle buttons — **Controls**, **Sequencer**, and **FX** — so panels can be shown and hidden in any combination.

**Motivation**: In a multi-instrument arrangement, most of the time you want to see all sequencers at once and only open sound controls on the instrument you're editing. The current all-or-nothing drawer forces a choose between seeing the pattern or the parameters.

**Behavior**:
- Three toggle buttons live permanently in the channel strip (always visible, alongside Mute)
- Each button independently shows/hides its section (Controls = instrument sliders, Sequencer = step-seq grid, FX = FX unit)
- Button style mirrors the existing Mute button — consistent toggle appearance across all channel strip actions
- Default state: Sequencer visible, Controls and FX collapsed (prioritizes the live-performance view)
- State persisted in `toJSON()` / `fromJSON()`

**Implementation notes**:
- The three sections are already DOM-separate (`div.wam-controls`, `div.wam-expanded` for sequencer, `wam-fx-unit`)
- Toggle buttons can use the same `.wam-mute-btn` / active-state pattern as Mute
- This is part of a broader push to normalize button and control styles across the UI — all toggle-style buttons (Mute, Controls, Seq, FX, Lock, Jam) should share a single visual language

**Phases**:
1. Add Controls / Sequencer / FX toggle buttons to `WebAudioControlsBase` channel strip
2. Wire each button to show/hide its corresponding DOM section
3. Unify toggle button CSS into a single reusable `.wam-toggle-btn` class (Mute + new buttons + Lock + Jam)
4. Persist section visibility in `toJSON()` / `fromJSON()`

## Preset Persistence

Goal: allow true save/recall of user presets with two operational modes depending on the hosting environment.

**Current state** (2026-05-16): User presets are stored in `localStorage` keyed per instrument class. Save copies JSON to clipboard. Export All copies the full collection. Delete with confirmation.

**Mode 1 — Vite dev server (local development)**:
- Externalize presets into per-instrument JSON files (e.g. `src/data/presets/synth-mono.json`)
- Instrument loads built-in presets from `static PRESETS` merged with the JSON file at dev time
- Save/delete operations POST to a small Vite middleware that rewrites the JSON file
- Zero manual copy-paste workflow — presets are immediately persisted in version-controlled files
- On production build, JSON files are inlined/bundled as normal

**Mode 2 — Static site (deployed / no write access)**:
- localStorage remains the runtime store (current behavior)
- "Download" button exports the user preset collection as a `.json` file
- Drag-and-drop a `.json` file onto the instrument panel (or use a file input) to import/restore presets
- Merge strategy: imported presets are added alongside existing ones; duplicates prompt overwrite confirmation

**Implementation plan**:
1. Define JSON schema for preset files: `{ "instrumentClass": "...", "presets": { "Name": { ...params }, ... } }`
2. Add Vite plugin/middleware (dev only) that handles `POST /api/presets/:instrument` and `DELETE /api/presets/:instrument/:name`
3. Add download button to preset section (straightforward — `Blob` + `URL.createObjectURL`)
4. Add drag-and-drop / file input handler on the controls panel for `.json` import
5. Detect environment: if `POST /api/presets/...` returns 404, fall back to localStorage-only mode

## Test Playground

Goal: a lightweight dev environment where instruments can be instantiated, tweaked, and auditioned — individually or in ad hoc combinations.

**Approach**: a single HTML entry point with buttons to add each instrument. Click a button to mount that instrument (audio engine + controls UI + FX + sequencer). Multiple instruments can be active simultaneously for exploring combos, but the primary use case is one-at-a-time auditioning.

**Key features**:
- Add/remove buttons for every instrument and effect
- Shared transport (play/stop, BPM) drives all active sequencers
- Each added instrument gets its full controls panel, channel strip, and FX
- Multiple instruments route to a shared master bus
- No fixed layout — instruments stack as added, remove individually

## Renaming & Prefix Cleanup

**Completed 2026-05-03.** Replaced the verbose `web-audio-` prefix on all file names, Web Component tag names, and CSS class namespaces with `wam-` (Web Audio Module).

| Was | Now |
|---|---|
| `web-audio-synth-acid.js` | `synth-acid.js` |
| `<web-audio-slider>` | `<wam-slider>` |
| `.wac-section` / `.was-range` | `.wam-section` / `.wam-range` |

## File Organization

Reorganize `src/web-audio/` from a flat list into intent-based subdirectories:

```
src/web-audio/
  instruments/    ← synths + percussion + loop player
  fx/             ← effects + worklets
  ui/             ← slider, step-seq, waveform
  global/         ← sequencer, scales
```

## Responsive Volume

Goal: prevent the master output from clipping when many instruments play simultaneously.

Recommended approach: `DynamicsCompressorNode` on the master bus + per-instrument gain staging. See also **Auto-Normalization**.

## Acid-Breaks Layout

Goal: responsive grid layout using CSS container queries so panels reflow based on their own width. The step sequencer grid (16 columns) needs ~320px minimum.

## Pattern Evolution

Goal: sequences mutate slowly over time rather than jumping between random states.

Planned tools:
- **Step probability nudge**: increment/decrement per-step probability over time
- **Note drift**: adjacent scale notes drift up/down by one step per N bars
- **Accent migration**: move accents to neighboring steps
- **Morph target**: set a target pattern and interpolate toward it over X bars

These would live in a `evolution.js` module, usable independently of the step sequencer UI.

## Visualizer Modes

Goal: support both stream/LED-friendly layouts and performance-centric parameter feedback.

Planned additions:
- **Output position presets**: corner placement options, prioritizing top-corner layouts for LED panel output capture
- **Focused control overlay**: when a knob is active, visualizer can switch to full-view mode with large control label and value display

## Loop Player / Time-Stretch

**Status**: Completed 2026-05-04.

## Reference Libraries

Mature Web Audio libraries worth reading for inspiration, DSP patterns, and effect implementations. These are **not** runtime dependencies (see [core-beliefs.md](../design-docs/core-beliefs.md)) — the goal is to study their source for ideas and port algorithms selectively.

### Tone.js

[Tone.js](https://github.com/Tonejs/Tone.js) is the most widely used high-level Web Audio framework. Despite being excluded as a runtime dependency, its source is worth studying for:

- **Signal graph patterns**: how it structures envelope, LFO, and modulation routing
- **Transport and scheduling**: its `Transport` clock uses a lookahead worker similar to ours; worth comparing tick accuracy strategies
- **Effect implementations**: Chorus, Phaser, Tremolo, PingPongDelay, AutoWah — all hand-rolled over Web Audio primitives with battle-tested parameter ranges
- **Instrument architecture**: `Synth`, `AMSynth`, `FMSynth`, `PluckSynth` (Karplus-Strong) are clean reference implementations

### Tuna.js

[Tuna.js](https://github.com/Theodeus/tuna) is a focused Web Audio effects library — no instruments, no transport, just effects. Very readable source. Useful for:

- **Effect parameter ranges**: well-tuned defaults for Chorus, Phaser, Compressor, Delay, Overdrive, Cabinet IR, Tremolo, PingPongDelay, MoogFilter, Bitcrusher
- **Filter topology**: MoogFilter implementation using a ladder-filter approximation worth comparing to our BiquadFilter-based approach
- **Bitcrusher**: clean implementation that could be lifted directly for the standalone Bitcrusher effect listed in the roadmap
- **Overdrive / Waveshaper curves**: comparison point for our existing distortion WaveShaper curves

### SoundTouchJS — potential usage or inspiration

[SoundTouchJS](https://github.com/cutterbl/SoundTouchJS) is a JS port of the SoundTouch C++ library, which implements high-quality time-stretching and pitch-shifting via WSOLA (Waveform Similarity Overlap-Add) and phase vocoder algorithms. Worth investigating as an alternative or supplement to the current OLA pitch-shift worklet, particularly for:

- **Better time-stretch quality**: WSOLA produces fewer transient smearing artifacts than plain OLA, especially at extreme ratios
- **Decoupled pitch/tempo**: SoundTouch handles pitch shift and time stretch as independent operations, unlike our current approach which links them through the pitch-ratio calculation
- **Vintage mode replacement**: could offer a more convincing "tape" character than the current grain-size hack

**Trade-offs to evaluate**:
- Runs in an AudioWorklet (or ScriptProcessorNode); assess latency vs. our current `BufferSourceNode`-as-source architecture
- Library size and licensing (LGPL)
- Whether it integrates cleanly with the existing `sample-looper.js` transport timing model (start/seek at `AudioContext.currentTime` offsets)

 `WebAudioLoopPlayer` is now the general-purpose BPM-synced loop instrument, replacing the breakbeat-only break player.

### What Was Built

`WebAudioLoopPlayer` (`sample-looper.js`) generalizes loop playback to support any audio loop type — breaks, textures, vocals, percussion — not just hardcoded breakbeats. It is a continously playing, timeline-aware instrument that stays locked to transport BPM via time-stretch and offers beat-locked looping with random jumps and reverse playback.

### Migration Details

**Folder-based file discovery** — apps now use Vite glob patterns (like the sampler) to auto-discover loops from configurable `public/audio/loops/` subdirectories (breaks, textures, vocals).

**Multiple instances** — Loop Player registers as a standard instrument in playground and acid-breaks with different loop folders per instance. Each can have distinct playback styles (e.g., breaks with 4-slot subdivision; textures with 8-slot subdivision).

**Rename and cleanup** — `WebAudioBreakPlayer` → `WebAudioLoopPlayer`. Compatibility alias exports/tags were removed; callers now use `sample-looper.js` directly.

**Unchanged core engine** — time-stretch, subdivision slicing, BPM sync, return/random/reverse logic all retained from the original break player. The audio routing and scheduling patterns are identical.

**NOT extending the sampler** — the playback models are fundamentally different:
- Sampler = one-shot trigger → ADSR → done (fire-and-forget voices)
- Loop player = continuous BPM-synced playback with time-stretch and beat-locked looping

They share `sample-utils.js` for loading and the Vite glob pattern for file discovery, but the audio engines have nothing in common.

### Future Enhancements

Potential improvements for future work:
- Slice editing UI and transient detection
- Advanced stretch artifact correction modes
- Crossfaded loop boundaries
- MIDI-driven slice triggering

## Jam & Randomize Buttons

Goal: standardize jam (manual trigger) and randomize button placement.

- **Jam**: move to channel strip so it's always accessible when collapsed
- **Randomize**: group with step sequencer since it's a pattern operation

## Auto-Normalization

Goal: prevent instruments from red-lining by default.

**Phased approach**:
1. Retune all `PRESETS.Default` volumes to ~0.25
2. Auto-duck: channel strip meter watches for sustained clipping and nudges gain down
3. Master compressor as safety net

## Humanization

Goal: make sequenced patterns feel more organic and less machine-rigid.

**Tools** (all amounts controllable per instrument, 0 = off):

| Tool | Description |
|---|---|
| **Swing** | Shift even-numbered steps later by a percentage (0–75%) of the step duration. Classic MPC/TR-style groove. Could be global (transport-level) and/or per-instrument. |
| **Trigger delay** | Fixed microsecond offset per step — lets instruments sit slightly behind or ahead of the beat (e.g. snare drags, hi-hat pushes). Per-instrument setting. |
| **Timing jitter** | Random per-trigger timing offset (±0–20ms). Unlike swing (systematic), jitter is stochastic — no two hits land in exactly the same place. |
| **Velocity variation** | Random velocity offset per trigger (±0–20% of programmed value). Prevents the "machine gun" effect on repeated hits. |
| **Ghost notes** | Randomly insert quiet hits (10–30% velocity) on inactive steps at low probability. Fills in gaps the way a real drummer would. |
| **Accent drift** | Subtly shift which steps get emphasized over time — accents migrate to neighboring steps every N bars. |

**Implementation notes**:
- Swing and timing jitter are the highest-impact tools — implement first
- Swing is best applied at the sequencer level (`WebAudioSequencer` or per-instrument `step()`) by offsetting the `time` parameter for even steps
- Jitter and velocity variation are per-trigger modifiers applied at the instrument controls `step()` method
- Ghost notes could be a sequencer-level feature that injects synthetic step triggers
- All values should be serializable in `toJSON()` / `fromJSON()`

## MIDI

| Feature | Notes |
|---|---|
| **MIDI keyboard input** | Map note-on/off to currently-selected instrument's `trigger()`. Web MIDI API. Should work alongside QWERTY keyboard input. |
| **MIDI sync to focused instrument** | Route incoming MIDI note/CC to the active/focused instrument by default; provide optional focus lock so routing stays pinned while browsing other panels. |
| **Launchpad XL full control mapping** | Full mapping for pads/knobs/buttons across transport, sequencer, mixer, macros, and selected instrument controls. |
| **Launchpad XL docs import** | Ingest controller PDF mappings into project docs so control IDs and behavior stay maintainable as mappings evolve. |
| MIDI learn | Click slider, move CC knob to bind. Stored in Controls' `toJSON()`. |
| MIDI clock sync | Sync `WebAudioSequencer` BPM to incoming MIDI clock (24 ppq). |

## New Effects

| Effect | Notes |
|---|---|
| **Parametric EQ** | 3–4 band parametric EQ (low shelf, mid peaking, high shelf + optional mid 2) using `BiquadFilterNode`; new `eq.js` with audio engine + UI controls; first effect in FX unit chain so it shapes tone before reverb/delay/etc. |
| ~~**Sidechain Compressor**~~ | ✅ Done — `WebAudioFxCompressor` (AudioWorklet envelope follower), final stage of the per-channel FX strip; key source picked via `<wam-instrument-source-picker>` |
| **Phaser** | Multi-stage all-pass filter sweep; LFO-modulated; stereo |
| **Compressor** | Wrapper + UI around `DynamicsCompressorNode` |
| **Ping-Pong Delay** | `stereo: "pingpong"` mode in existing delay; alternates echoes L→R |
| **Tremolo** | LFO-modulated amplitude; rate/depth/shape |
| **Wah-Wah** | Bandpass filter with LFO + envelope-follower mode |

## MediaRecorder Recording

Goal: record master output as WAV and capture video+audio of the interface.

**Audio recording**: `AudioWorklet` captures raw PCM → encode WAV header + int16 data → download link. UI: Record/Stop button in transport panel with elapsed time indicator.

**Video+audio capture**: Use `getDisplayMedia()` or `captureStream()` to record the current window or a specified portion of the wam interface as video+audio. In the future, when visuals are added, the output could be more artistic.

**Perfect loop recording**: The recorder should be transport-aware — start/stop aligned to bar boundaries so exports loop cleanly.

## Possible Future Instruments

| Instrument | Type | Notes |
|---|---|---|
| **Full-featured polysynth** | Synthesis | Production-quality synth to replace/subsume Mono, Pad, and possibly Acid; see **Production Synth** section below |
| **Vocoder / Vocal Filter** | Effect/Instrument | Robotic vocal processor combining vocoder bands, pitch shifting (vintage mode), and unique algorithms; see **Vocoder** section below |
| Arpeggiator | Utility | BPM-synced note pattern over a chord input |
| Plucked string | Physical model | Karplus-Strong synthesis |
| Sampler (melodic) | Sampler | Pitched sample playback, like a one-shot player |
| Granular synth | Synthesis | Granular texture from a buffer |
| Bitcrusher | Effect | Standalone effect (currently embedded in BlipFX only) |
| Ring modulator | Effect | AM/ring mod for metallic textures |

## Production Synth

Goal: a single, full-featured polyphonic synthesizer (think Vital/Serum/Moog) that could eventually subsume SynthMono, SynthPad, and SynthAcid as presets.

### Architecture

```
Voice:
  Osc A (saw/square/tri/sine/wavetable) ──┐
  Osc B (saw/square/tri/sine/wavetable) ──┤
  Sub Osc (sine/square, -1/-2 oct) ───────┤──▶ Mix ──▶ Filter ──▶ Amp ──▶ voice out
  Noise (white/pink) ─────────────────────┘
```

**Key features**: 2 main oscillators + sub + noise, unison stacking, filter with dedicated ADSR, 2 routable LFOs, mono/poly modes (1–16 voices), voice stealing.

### Implementation phases

1. **Phase 1 — Core engine**: 2 oscs + sub + noise + filter + amp/filter envelopes. Mono and poly modes.
2. **Phase 2 — Unison + LFOs**: unison with spread, 2 routable LFOs.
3. **Phase 3 — Advanced**: pitch envelope, key tracking, wavetable via `PeriodicWave`, mono glide.
4. **Phase 4 — Consolidation**: presets replicating existing synths; evaluate retiring originals.

## Vocoder / Vocal Filter

Goal: a robotic vocal processing instrument combining classic vocoder techniques with the existing pitch shift effect (especially vintage mode) and additional creative algorithms.

### Core Features

- **Vocoder engine**: 16–32 bandpass filter bank, envelope followers, carrier modulation
- **Pitch shifting**: existing `WebAudioPitchShift` with vintage mode for character/grit
- **Creative algorithms**: formant shifting, whisper mode, freeze/sustain, ring mod, granular voice, autotune (via scales module)

### Architecture

```
Mic/Input → [Pitch Shift] → Analysis (bandpass bank → envelope followers)
                                              ↓ envelopes
Carrier (saw/square/noise/external) → Synthesis (bandpass bank × envelopes) → Output
```

**Input**: `getUserMedia()` mic or any `AudioNode` source.

**Carrier options**: internal oscillator, noise (whisper), external audio (cross-synthesis), chord from existing synths.

### Parameters

| Parameter | Range | Notes |
|---|---|---|
| Band count | 8–32 | More = clearer speech, more CPU |
| Carrier type | saw/square/noise/external | Synthesis waveform |
| Formant shift | -12 to +12 semitones | Shift analysis bands |
| Pitch shift | -24 to +24 semitones | Via PitchShift effect |
| Vintage mode | on/off | Lo-fi artifacts as feature |
| Attack/Release | 1–50ms / 10–200ms | Envelope follower |
| Freeze | toggle | Hold current frame |

### Implementation Phases

1. **Phase 1 — Basic vocoder**: 16-band filter bank + envelope followers + saw carrier + mic input
2. **Phase 2 — Pitch integration**: wire PitchShift (vintage mode), formant shift, pitch tracking
3. **Phase 3 — Creative modes**: freeze, whisper, ring mod, autotune
4. **Phase 4 — UI & presets**: controls panel, band visualizer, presets (Robot, Whisper, Choir, Alien, Dalek)

## Composition Serialization

Goal: a single JSON document that fully describes a multi-instrument arrangement — which instruments are loaded, all their parameter settings, sequencer patterns, FX chains, and transport state. This is the foundation for saving, sharing, and eventually multi-section compositions.

**This needs a dedicated planning session** to design the schema, nesting strategy (instrument → controls → FX sub-serialization), and versioning approach.

### Key Capabilities

1. **Full arrangement recall** — load a JSON and get the exact same set of instruments, patterns, and settings
2. **Save/load library** — IndexedDB or localStorage list of named arrangements with save/load/delete UI
3. **Share via link** — export arrangement as compressed/hashed code; paste into a new window to import (revisit the existing acid-breaks "Copy Link" feature and generalize it)
4. **Playground integration** — the test playground already has full instrument config; add save/load/share there as the first testing ground
5. **Sub-serialization** — each layer (instrument, FX unit, sequencer, transport) owns its own `toJSON()`/`fromJSON()`; the composition schema composes them

### Schema Sketch

```json
{
  "v": 1,
  "name": "My Arrangement",
  "transport": { "bpm": 128, "root": "C", "scale": "minor", "masterVolume": 0.8, "fx": {} },
  "instruments": [
    {
      "type": "wam-synth-acid",
      "params": { "cutoff": 800, "resonance": 12, "volume": 0.6 },
      "fx": { "reverbWet": 0.2, "delayMix": 0.1 },
      "seq": { "steps": [...], "speedMultiplier": 1, "patternParams": {} }
    }
  ]
}
```

### Future: Multi-Section Compositions

Once single-arrangement serialization is solid, this structure could extend to compositions with multiple sections/parts that play over time (intro → verse → chorus → etc.). Much more complex, but refining the single-arrangement JSON is a huge step toward it.

### Implementation Phases

1. ~~**Phase 1 — Schema design** — plan the JSON structure, audit existing `toJSON()`/`fromJSON()` across all instruments and FX, identify gaps~~ (Done 2026-05-05)
2. ~~**Phase 2 — Playground save/load** — localStorage integration in the playground UI~~ (Done 2026-05-05)
3. ~~**Phase 3 — Share codes** — compressed Base64 export/import (generalize acid-breaks share URL approach)~~ (Done 2026-05-05)
4. ~~**Phase 4 — Save/Load Library UI** — Build IndexedDB integration allowing users to save and browse a named "Library" of shared songs locally within the browser.~~ (Done 2026-05-09)
5. **Phase 5 — Multi-section** — arrangement timeline with section transitions (future)

## Multi-User Jamming (Future)

Goal: collaborative real-time music making via WebSocket shared state.

Existing tools (WebSocket, shared state primitives) could enable this. Low priority for now — revisit once the single-user experience is solid. Key questions: what state to share (transport, patterns, knob positions?), latency tolerance, conflict resolution.

## Governance

- Roadmap reviewed monthly by Justin Gitlin
- New instruments must pass the Definition of Done in [QUALITY_SCORE.md](../QUALITY_SCORE.md)
- Active work tracked in [exec-plans/active/](active/)
