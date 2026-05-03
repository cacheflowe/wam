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
- `WebAudioBreakPlayer` — drum loop sampler with time-stretch
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

## Near-Term Goals

| Goal | Priority | Notes |
|---|---|---|
| **Vocoder polish & testing** | High | Gate threshold added, needs more testing; latency optimization; carrier routing verified |
| **FM synth quality** | High | FM sounds inferior to Mono — investigate why; retune presets; fix silent presets |
| **Composition serialization** | High | Full JSON state for multi-instrument arrangements; see **Composition Serialization** section below |
| **Rename & shorten prefix** | ~~High~~ | ~~`web-audio-` prefix too verbose~~ — **Done 2026-05-03** |
| **MIDI keyboard input** | Medium | Map note-on/off to currently-selected instrument's `trigger()`; see **MIDI** section below |
| **Channel strip section toggles** | ~~Medium~~ | ~~Independent Controls / Sequencer / FX toggle buttons~~ — **Done 2026-05-03** |
| **Double-click/tap reset to default** | Medium | Double-click (or double-tap) any UI control (sliders, knobs, dropdowns, toggles) resets it to its default value |
| **Knob controls / compact UI** | Medium | Replace sliders with compact knob controls for VST-like density; see **UI Direction** section below |
| **Parametric EQ** | Medium | 3-4 band EQ as first effect in FX unit chain; new `wam-eq.js` with engine + UI; see **New Effects** section below |
| **MediaRecorder video+audio capture** | Medium | Record window/interface as video+audio; transport-aware loop recording; see **MediaRecorder Recording** section below |
| Responsive volume / overload protection | Medium | See **Responsive Volume** section below |
| Acid-breaks UI grid layout | Medium | Container queries for responsive panel grid; see **Layout** section below |
| Pattern evolution tools | Medium | Slow morph / mutation of sequences over time; see **Pattern Evolution** section below |
| **Humanization tools** | Medium | Swing, trigger delay, velocity variation, timing jitter, ghost notes; see **Humanization** section below |
| **Auto-normalization / gain staging** | Medium | Per-instrument default volumes and red-line protection; see **Auto-Normalization** section below |
| MIDI learn | Medium | See **MIDI** section below |
| Per-instrument product specs | Medium | Fill out individual spec files in [product-specs/](../product-specs/) |
| Refine existing instruments & effects | Ongoing | Tuning, preset quality, edge cases |
| **Loop Player (Break Player evolution)** | Medium | Generalize break player into a BPM-synced loop player; see **Loop Player** section below |
| Add new instruments & effects | Ongoing | See **Possible Future Instruments** section below |
| npm package publication | Low | Export each instrument as a named module; publish to npm |
| **Multi-user jamming** | Future | WebSocket shared state for collaborative sessions; explore later |

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
| `web-audio-synth-acid.js` | `wam-synth-acid.js` |
| `<web-audio-slider>` | `<wam-slider>` |
| `.wac-section` / `.was-range` | `.wam-section` / `.wam-range` |

## File Organization

Reorganize `src/web-audio/` from a flat list into intent-based subdirectories:

```
src/web-audio/
  instruments/    ← synths + percussion + break player
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

These would live in a `wam-evolution.js` module, usable independently of the step sequencer UI.

## Loop Player

Goal: evolve `WebAudioBreakPlayer` into a general-purpose BPM-synced loop player that supports any audio loop — not just breakbeats.

**Motivation**: The current break player is hardcoded to a single set of breakbeat files. Users want to play ambient textures, melodic loops, vocal chops, percussion loops, etc. — anything that should lock to transport BPM via time-stretch.

**Key changes from current break player**:
- **Folder-based file discovery** — use Vite glob pattern (like the sampler) to auto-discover loops from configurable `public/audio/loops/` subdirectories
- **Multiple instances** — register as a normal instrument in the playground/acid-breaks with different loop folders (breaks, textures, vocals, etc.)
- **Rename** — `WebAudioBreakPlayer` → `WebAudioLoopPlayer` (keep break player as alias or migrate)
- **Same core engine** — time-stretch, subdivision slicing, BPM sync, return/random/reverse logic all still apply

**NOT extending the sampler** — the playback models are fundamentally different:
- Sampler = one-shot trigger → ADSR → done (fire-and-forget voices)
- Loop player = continuous BPM-synced playback with time-stretch and beat-locked looping

They share `wam-sample-utils.js` for loading and the Vite glob pattern for file discovery, but the audio engines have nothing in common.

**Implementation phases**:
1. Refactor break player to accept `files` + `basePath` via options (like sampler does) instead of hardcoded manifest
2. Add Vite glob discovery for loop folders
3. Allow multiple instances in playground with different folders
4. Rename to `WebAudioLoopPlayer` (optional, could wait for prefix rename)

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
| MIDI learn | Click slider, move CC knob to bind. Stored in Controls' `toJSON()`. |
| MIDI clock sync | Sync `WebAudioSequencer` BPM to incoming MIDI clock (24 ppq). |

## New Effects

| Effect | Notes |
|---|---|
| **Parametric EQ** | 3–4 band parametric EQ (low shelf, mid peaking, high shelf + optional mid 2) using `BiquadFilterNode`; new `wam-eq.js` with audio engine + UI controls; first effect in FX unit chain so it shapes tone before reverb/delay/etc. |
| **Sidechain Compressor** | Duck one instrument based on another's amplitude (envelope follower → gain modulation) |
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

1. **Phase 1 — Schema design** — plan the JSON structure, audit existing `toJSON()`/`fromJSON()` across all instruments and FX, identify gaps
2. **Phase 2 — Playground save/load** — IndexedDB arrangement library with save/load/delete in the playground UI
3. **Phase 3 — Share codes** — compressed Base64 export/import (generalize acid-breaks share URL approach)
4. **Phase 4 — Multi-section** — arrangement timeline with section transitions (future)

## Multi-User Jamming (Future)

Goal: collaborative real-time music making via WebSocket shared state.

Existing tools (WebSocket, shared state primitives) could enable this. Low priority for now — revisit once the single-user experience is solid. Key questions: what state to share (transport, patterns, knob positions?), latency tolerance, conflict resolution.

## Governance

- Roadmap reviewed monthly by Justin Gitlin
- New instruments must pass the Definition of Done in [QUALITY_SCORE.md](../QUALITY_SCORE.md)
- Active work tracked in [exec-plans/active/](active/)
