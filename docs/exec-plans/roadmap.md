# Roadmap

Owner: Justin Gitlin
Last reviewed: 2026-04-28 (updated 2026-04-28)

## Vision

Build a library of browser-based instruments that are:
1. Individually importable into any web app
2. Fully functional with or without the Controls UI
3. Well-documented enough that agents and new contributors can add instruments following existing patterns

## Current State (as of 2026-04-27)

**Instruments (complete)**:
- `WebAudioSynthAcid` — TB-303-style acid bass
- `WebAudioSynth808` — 808 sub-bass
- `WebAudioSynthFM` — 2-op FM poly synth
- `WebAudioSynthMono` — general mono synth
- `WebAudioSynthPad` — poly chord pad
- `WebAudioSynthBlipFX` — procedural SFX
- `WebAudioPercKick` — 808 kick
- `WebAudioPercHihat` — noise hi-hat
- `WebAudioBreakPlayer` — drum loop sampler with time-stretch

**Effects (complete)**:
- Reverb, Delay (BPM-sync), Chorus, Filter, Distortion
- `WebAudioFxUnit` Web Component composing a well-rounded set of effects

**Infrastructure (complete)**:
- Lookahead sequencer
- Slider, step-sequencer, waveform Web Components
- Music theory / scales module
- `toJSON()` / `fromJSON()` state persistence

**Pending**:
- App entry point (`src/site/app.js`) — the demo/harness that wires everything together
- Documentation system (in progress)

## Near-Term Goals

| Goal | Priority | Notes |
|---|---|---|
| Build `src/site/app.js` demo harness | High | Wire all instruments into a playable demo |
| Add test suite | High | See [tech-debt-tracker.md](tech-debt-tracker.md) |
| **Test playground** | High | Isolated per-instrument/per-effect dev environment; see **Test Playground** section below |
| Reorganize `src/web-audio/` into subdirs | High | See **File Organization** section below |
| **Rename & shorten prefix** | High | `web-audio-` prefix is too verbose; see **Renaming** section below |
| Fix FM synth presets | High | Several presets produce dead/silent sounds; audit and retune all |
| Master volume control | Medium | Per-app gain knob in acid-breaks and generative-music apps |
| ~~Per-instrument channel strip~~ | ~~Medium~~ | **Done** — volume, pan, mute, VU meter on every instrument |
| **Master transport panel** | Medium | Transport as a styled instrument-like panel with master FX and waveform; see **Transport Panel** section below |
| Responsive volume / overload protection | Medium | See **Responsive Volume** section below |
| ~~Inline parameter tooltips~~ | ~~Medium~~ | **Done** — PicoCSS `data-tooltip` on all slider labels |
| Acid-breaks UI grid layout | Medium | Container queries for responsive panel grid; see **Layout** section below |
| Pattern evolution tools | Medium | Slow morph / mutation of sequences over time; see **Pattern Evolution** section below |
| **Per-instrument speed multiplier** | Medium | 0.5x / 1x / 2x sequencer rate per instrument; see **Sequencer Speed Multiplier** section below |
| **Long-form pattern variety** | Medium | Bar density, step probability, rotation, conditions, ratcheting; see **Long-Form Pattern Variety** section below |
| **Unified sequencer for all instruments** | Medium | Give every instrument a step sequencer; move probability controls into sequencer logic; see **Unified Sequencer** section below |
| **Jam buttons in channel strip** | Medium | Move manual trigger buttons to channel strip for easy access; see **Jam & Randomize Buttons** section below |
| **Auto-normalization / gain staging** | Medium | Per-instrument default volumes and red-line protection; see **Auto-Normalization** section below |
| **BlipFX random sound toggle** | Low | Option to pick a new random preset on each trigger; see **BlipFX Random Sound** section below |
| Per-instrument product specs | Medium | Fill out individual spec files in [product-specs/](../product-specs/) |
| MIDI learn | Medium | See **MIDI** section below |
| **MediaRecorder WAV recording** | Medium | Record and render WAV files on the fly; see **MediaRecorder Recording** section below |
| Refine existing instruments & effects | Ongoing | Tuning, preset quality, edge cases |
| Add new instruments & effects | Ongoing | See **Possible Future Instruments** section below |
| npm package publication | Low | Export each instrument as a named module; publish to npm |

## Test Playground

Goal: a lightweight, isolated dev environment where individual instruments and effects can be instantiated, tweaked, and auditioned without loading the full acid-breaks app.

**Motivation**: the full app wires many instruments together; a bug or half-finished feature in one instrument affects the whole page. A playground lets work be tested in isolation.

**Approach**: a single HTML entry point (`src/playground/index.html`) with a sidebar listing every instrument and effect. Clicking a tile mounts just that component into the main panel — its audio engine, controls UI, FX unit, and waveform display. No sequencer, no other instruments.

```
src/playground/
  index.html       ← Vite entry, loads playground.js
  playground.js    ← registers tiles, handles mount/unmount
  tiles/
    acid.js        ← mounts WebAudioSynthAcid + controls + FX
    fm.js
    808.js
    break-player.js
    blipfx.js
    fx-unit.js     ← standalone FX unit with a test tone source
    ...
```

Each tile module exports a `mount(container, ctx)` function that creates the instrument, its controls, and connects everything to the ctx destination. A top-level Play/Stop button controls a simple one-shot trigger or looped pattern per instrument.

**FX tile**: a dedicated tile that wires a test-tone oscillator → `WebAudioFxUnit`, letting each FX section be auditioned in isolation.

**Vite config**: add `playground/index.html` as a second entry point (or a separate `playground.vite.config.js`). The playground never ships to the production bundle.

**Nice to have**: hot-reload friendly — changing a tile file remounts only that tile.

## Renaming & Prefix Cleanup

Goal: replace the verbose `web-audio-` prefix on file names, Web Component tag names, and CSS class namespaces with something shorter that still avoids collisions.

**Problem**: `web-audio-synth-acid-controls`, `.web-audio-fx-unit`, `web-audio-step-seq.js` are long to type and read, especially in import statements and HTML. The prefix was cargo-culted from the Web Audio API spec name and doesn't add useful information.

**Candidate prefix**: `wam-` (Web Audio Module) — short, project-specific, unlikely to collide with existing custom element registries or CSS resets.

| Current | Proposed |
|---|---|
| `web-audio-synth-acid.js` | `wam-synth-acid.js` |
| `web-audio-fx-unit.js` | `wam-fx-unit.js` |
| `web-audio-slider.js` | `wam-slider.js` |
| `<web-audio-slider>` | `<wam-slider>` |
| `<web-audio-fx-unit>` | `<wam-fx-unit>` |
| `.was-range` / `.wac-section` | `.wam-range` / `.wam-section` |
| `WebAudioSynthAcid` | `WamSynthAcid` (or keep long form for clarity) |

**Class names**: JS class names (`WebAudioSynthAcid`) are only visible in code, not the DOM — keeping the long form is fine. Only file names, custom element tags, and CSS namespaces need renaming.

**Scope**: all files under `src/web-audio/`, all `customElements.define()` calls, all CSS class name prefixes (`.was-*`, `.wac-*`, `.wfs-*`, etc.), and any HTML that uses the old tag names. Update import paths in `src/app/` and `src/site/` too.

**Prerequisite**: complete the File Organization refactor first — moving files into subdirs at the same time as renaming them is cleaner than two separate passes on import paths.

**Migration**: custom element names cannot be changed once registered in a live page; rename all at once, update any serialized state that embeds tag names (none currently — state is pure JSON).



Reorganize `src/web-audio/` from a flat list into intent-based subdirectories:

```
src/web-audio/
  instruments/
    web-audio-synth-acid.js
    web-audio-synth-808.js
    web-audio-synth-fm.js
    web-audio-synth-mono.js
    web-audio-synth-pad.js
    web-audio-synth-blipfx.js
    web-audio-perc-kick.js
    web-audio-perc-hihat.js
    web-audio-break-player.js
  fx/
    web-audio-fx-reverb.js
    web-audio-fx-delay.js
    web-audio-fx-chorus.js
    web-audio-fx-filter.js
    web-audio-fx-distortion.js
    web-audio-fx-unit.js
    web-audio-pitch-shift.js
    web-audio-pitch-shift.worklet.js
    web-audio-time-stretch.js
    web-audio-time-stretch.worklet.js
  ui/
    web-audio-slider.js
    web-audio-step-seq.js
    web-audio-waveform.js
  global/
    web-audio-sequencer.js
    web-audio-scales.js
```

**Notes**: Update all import paths in instrument files and any app entry points. Worklet `addModule()` paths must also be updated — use `new URL('./file.worklet.js', import.meta.url).href` so Vite resolves them correctly after the move.

## Channel Strip ✓ Done

Every instrument panel has a permanent channel strip (always visible, above the collapsible panel):

- **Volume** — output gain via `_out` GainNode, 0–1
- **Pan** — stereo position via `StereoPannerNode`, −1 to +1
- **Mute** — toggles `_out.gain` to 0 / restores pre-mute volume
- **VU meter** — live peak level display

Built by `createChannelStrip()` in `web-audio-slider.js`. Serialized as `pan`, `volume`, `muted` in every controls `toJSON()`. **Solo** remains a future addition (requires a shared solo bus).

**Pending**: solo bus.

## Transport Panel

Goal: upgrade the transport bar from a plain `<div class="acid-transport">` into a styled instrument-like panel that feels like part of the mixer, with its own master FX unit and master bus waveform display.

**Motivation**: the transport currently looks like a utility bar bolted on top. It should be a first-class panel — visually consistent with the instrument panels below it, and actually useful for shaping the master output.

**Components**:
- **Master FX unit** — a `WebAudioFxUnit` on the master bus (between the master gain and `ctx.destination`). Exposes reverb, delay, chorus, filter, and distortion for the whole mix
- **Master waveform** — a `<web-audio-waveform>` connected to an `AnalyserNode` on the master bus, giving a live view of the full mix output
- **BPM slider** — stays here (already present)
- **Master volume slider** — stays here (already present)
- **Key / Scale selects** — stays here (already present)
- **Play / Stop button** — stays here (already present)
- **Share URL button** — stays here (already present)

**Visual treatment**: wrap everything in a `<div class="instrument-group transport-group">` with `--fx-accent: #fff` (or a neutral accent), matching the border/radius/overflow pattern of the instrument panels. The master FX controls collapse/expand like other FX sections.

**Audio chain change**: insert `masterFxUnit` between `masterGain` and `ctx.destination`:
```
instruments → masterGain → masterFxUnit → analyserNode → ctx.destination
```

**Implementation notes**:
- The `WebAudioFxUnit` already supports `connect()` and `input` getter — slot it in with two wiring calls
- The `AnalyserNode` for the waveform goes after the FX unit so the waveform reflects post-FX output
- BPM changes must also propagate to `masterFxUnit.bpm` for delay sync



Goal: prevent the master output from clipping or distorting when many instruments are playing simultaneously.

Options to evaluate:
- **DynamicsCompressorNode** on the master bus — simplest; Web Audio provides this natively
- **Manual gain scaling** — reduce master gain as more instruments are unmuted
- **Loudness metering** — read `AnalyserNode` peak values and auto-duck when overloading

Recommended approach: add a `DynamicsCompressorNode` between the master gain and `ctx.destination` as a first pass. Expose threshold/ratio/makeup-gain in the app UI. Each app (acid-breaks, generative-music) should have its own master gain slider. See also **Auto-Normalization** for per-instrument gain staging.

## Jam & Randomize Buttons

Goal: standardize where manual-trigger ("jam") and pattern-randomize buttons live across all instruments, rather than having them scattered in different locations per instrument.

**Jam buttons**: break player and BlipFX currently have manual trigger buttons buried in their controls panels. These should move to the channel strip so they're always accessible even when the panel is collapsed. A single "Jam" button in the strip triggers the instrument with a default note/velocity. Instruments that support it expose a `jam(time)` method on their controls class.

**Randomize buttons**: currently live alongside instrument-specific controls (e.g. acid "Randomize" button). These belong grouped with the step sequencer, since randomization is fundamentally a pattern operation. The `<web-audio-step-seq>` component (or its container section) should include a "Randomize" button.

**Per-instrument randomization logic**: each instrument provides its own randomize function with appropriate weights and constraints. The acid line uses `STEP_WEIGHTS` and scale-aware note selection; the 808 might emphasize downbeats; the FM chords might prefer sparser patterns. The sequencer/controls provides the button and calls `this._randomize()`, which subclasses override.

**Implementation**: add a `jam` slot to `createChannelStrip()` (optional button after mute). Add a randomize button to the step sequencer section in `_buildControls()`. Move existing jam/randomize handlers into the standardized locations.

## Auto-Normalization

Goal: prevent instruments from red-lining by default, and auto-recover when clipping is detected.

**Problem**: all instrument volumes default to 1.0, but with 5+ instruments summing into a master bus, the combined output easily clips. A sensible default would be ~0.25 per instrument so the sum stays under 1.0.

**Per-instrument default volumes**: each instrument's `PRESETS.Default` should set `volume` to a sensible level (~0.2–0.3) rather than 1.0. This is the simplest fix — just retune the presets.

**Auto-ducking on red-line**: the VU meter already reads peak levels via `AnalyserNode`. If the meter detects sustained clipping (peak > 0.95 for N consecutive frames), automatically reduce that instrument's gain by a small step until it drops below threshold. Visual indicator on the meter (red flash) alerts the user.

**Master bus protection**: a `DynamicsCompressorNode` on the master bus (see **Responsive Volume**) acts as a safety net. But per-instrument gain staging is the first line of defense — compression is a fallback, not the primary solution.

**Approach (phased)**:
1. **Quick win**: retune all `PRESETS.Default` volumes to ~0.25. Adjust existing saved states gracefully (missing volume key defaults to the new lower value).
2. **Auto-duck**: add a simple peak-watch loop to the channel strip meter. If peak > threshold for 10+ frames, nudge `_out.gain.value` down by 0.02 per frame until below threshold. Expose an "auto-gain" toggle in the channel strip.
3. **Master compressor**: add `DynamicsCompressorNode` to the transport's master chain as the final safety net.

## UI Tooltips ✓ Done

PicoCSS `data-tooltip` tooltips on all slider labels. Set `tooltip` in `SLIDER_DEFS`; `mkSlider()` picks it up and `WebAudioSlider._build()` moves it to the `.was-label-text` span so the tooltip only triggers on the label, not the range input. CSS overrides enable multi-line text (`white-space: normal; max-width: 180px`) with a dark background for contrast.

## Acid-Breaks Layout

Goal: instrument panels should form a responsive grid that reflows naturally at different viewport widths, rather than stacking or overflowing.

Approach: switch instrument panel containers to CSS container queries instead of media queries, so each panel reflows based on its own available width, not the viewport. This makes panels composable across different app layouts.

```css
.instrument-panel {
  container-type: inline-size;
}

@container (min-width: 400px) {
  .wac-sliders { display: grid; grid-template-columns: repeat(2, 1fr); }
}
```

The step sequencer grid is the tightest constraint — 16 columns need at least ~320px to be usable.

## Pattern Evolution

Goal: sequences should be able to mutate slowly over time, rather than jumping between fully random states. This enables generative music that evolves rather than restarts.

Planned tools:
- **Step probability nudge**: increment/decrement the on/off probability of individual steps over time, rather than flipping them
- **Note drift**: adjacent scale notes drift up/down by one step per N bars
- **Accent migration**: move accents to neighboring steps rather than randomizing all at once
- **Morph target**: set a "target" pattern and gradually interpolate toward it over X bars

These would live as utility functions in `web-audio-scales.js` or a new `web-audio-evolution.js` module, usable independently of the step sequencer UI.

## Sequencer Speed Multiplier

Goal: per-instrument 0.5x / 1x / 2x speed control, so one instrument can play half-time while another plays double-time against the same master BPM.

**Problem**: the master sequencer currently ticks at one rate and all instruments respond to every tick. A 0.5x instrument should only trigger on every other step; a 2x instrument should trigger twice per step.

**Approach**: run the master sequencer at the fastest needed resolution (2x the base BPM, i.e. 32nd notes if the base is 16th notes). Each instrument's controls gets a speed multiplier select (0.5x / 1x / 2x). The sequencer broadcasts every tick, and each instrument decides whether to act:

- **2x**: respond to every tick (sequencer is already running at 2x)
- **1x**: respond to every other tick
- **0.5x**: respond to every 4th tick

Alternatively, the sequencer could broadcast a sub-tick index and let instruments filter. Either way the master clock stays unified.

**UI**: a small select or toggle in the channel strip or transport section per instrument. Serialized in `toJSON()`.

## Long-Form Pattern Variety

Goal: make a 16-step sequencer feel like a much longer composition by adding per-instrument controls that vary playback across multiple bars. The sequencer stays simple (counts 0–15, fires callbacks); the intelligence lives in each instrument's `.step()` handler.

**Bar density / play cycle** (high priority): `playEvery: N` per instrument. In `.step()`, check `Math.floor(globalStep / 16) % N !== 0` → skip the whole bar. "Play 1 of 2" or "1 of 4" instantly turns a 16-step acid line into a 32- or 64-step phrase. Simplest to implement, biggest impact.

**Per-step probability**: each step gets a 0–100% fire chance instead of binary on/off. Store as `{ active, note, accent, probability }`. A hi-hat at 60% feels alive without changing the pattern. The step-seq UI could show probability as opacity or a small vertical bar per step. Pairs well with the Unified Sequencer proposal.

**Pattern rotation**: shift the pattern start point by N steps every M bars. One slider ("rotate every N bars") makes a 16-step pattern play as a 64-step phrase with no new note data. Applied in `.step()` by offseting the step index: `steps[(index + rotateOffset) % 16]`.

**Step conditions (Elektron-style)**: a step fires only on certain bars of a cycle. Conditions like "1:2" (every other bar), "3:4" (only 3rd of every 4 bars), "fill" (last bar of a 4-bar cycle). Most expressive option but needs per-step UI for condition selection — heavier to build.

**Ratcheting**: a step can subdivide into 2x or 3x rapid-fire repeats within its duration. Turns a single hit into a roll. Especially useful for drums and acid accents. Stored per-step as `{ ..., ratchet: 1|2|3 }`.

**Lower priority ideas**:
- **A/B patterns** — two 16-step pattern slots, alternate every N bars
- **Euclidean rhythms** — algorithmically distribute N hits across 16 steps from two numbers (hits + length)
- **Swing / shuffle** — offset even-numbered steps by a % of step duration for groove

**Implementation note**: bar density and pattern rotation only need a `globalStep` counter (already tracked in acid-breaks). Per-step probability and ratcheting extend the step data model in `<web-audio-step-seq>`. Step conditions are the most UI-intensive and could be deferred until the Unified Sequencer work.

## Unified Sequencer

Goal: give every instrument a step sequencer (not just Acid, 808, FM, and BlipFX) and move probability/randomness controls out of instruments and into the sequencer layer where the decisions actually happen.

**Motivation**: instruments like BreakPlayer have `randomChance` and `reverseChance` as instrument parameters, but these are really sequencer decisions — "should this step play?" and "should this step be reversed?" Making them sequencer concerns means:
- Consistent UI pattern across all instruments
- Probability is visible in the step grid (e.g. dimmed steps for low probability)
- Randomness decisions are made at sequence time, not trigger time
- Easier to add new probability types (e.g. per-step velocity range, per-step note alternatives)

**Approach**: extend `<web-audio-step-seq>` (or a new variant) to support per-step probability. Migrate existing probability params from instrument code into the sequencer's step data. Instruments that currently lack sequencers (Pad, Mono, Kick, HiHat) would gain them.

## BlipFX Random Sound

Goal: toggle that makes BlipFX randomly pick a new sound/preset on each trigger, for constantly evolving SFX textures.

**Trade-off**: after a sequencer is added to BlipFX, you sometimes want a consistent repeating pattern (same sound each step) and sometimes want chaos (new random sound each trigger). This should be an explicit toggle, not the default.

**UI**: a button or checkbox in the BlipFX controls section — "Random" or "Shuffle". When enabled, each `trigger()` call randomizes params within the current preset's ranges (or picks a fully random preset). Serialized in `toJSON()`.

## MIDI

| Feature | Notes |
|---|---|
| MIDI keyboard input | Map incoming note-on/note-off to `instrument.trigger()` calls. Web MIDI API, optional — degrade gracefully if unavailable. |
| MIDI learn | Click a slider, move a MIDI CC knob to bind it. Map stored in Controls' `toJSON()` state. |
| MIDI clock sync | Sync `WebAudioSequencer` BPM to incoming MIDI clock (24 ppq). |

MIDI features should be optional and additive — instruments must work without MIDI.

## New Effects

### Tuna.js Review
Study [tuna.js](https://github.com/Theodeus/tuna/blob/master/tuna.js) to see if any of its effect implementations are more robust than ours (especially Chorus, Phaser, Compressor, Wahwah). Where improvements are found, reimplement in our style (ES class, no dependencies, `connect()` / `input` getter pattern).

### Effects to Implement

| Effect | Notes |
|---|---|
| **Sidechain Compressor** | Duck one instrument's output based on another's amplitude; see detail below |
| **Phaser** | Multi-stage all-pass filter sweep; LFO-modulated; stereo; wet/dry |
| **Compressor** | Thin wrapper + UI around `DynamicsCompressorNode`; threshold/ratio/attack/release/knee |
| **Ping-Pong Delay** | Add `stereo: "pingpong"` mode to existing `WebAudioFxDelay`; alternates echoes L→R→L |
| **Tremolo** | LFO-modulated amplitude; rate/depth/shape (sine/square); wet/dry |
| **Wah-Wah** | Bandpass filter with LFO + envelope-follower mode; auto-wah and manual sweep |

All effects follow the same pattern as existing FX: standalone audio class + Controls section in `WebAudioFxUnit`.

### Sidechain Compressor

Goal: duck one instrument's volume in response to another instrument's amplitude — the classic "pumping" effect where pads or bass duck on every kick hit.

**How it works**: instrument A's output feeds an envelope follower (AnalyserNode reading peak amplitude). That envelope is inverted and applied as a gain multiplier on instrument B's output. When the kick hits, the pad ducks; when the kick decays, the pad swells back.

**Implementation approach**: a `WebAudioFxSidechain` class with:
- `input` — the audio to be ducked (instrument B)
- `setSidechainSource(node)` — the signal to follow (instrument A's output or analyser)
- Parameters: `threshold`, `ratio`, `attack`, `release`, `depth` (how much to duck)
- Internally: `AnalyserNode` on the sidechain source, a `GainNode` on the input path, and a `requestAnimationFrame` or `AudioWorklet` loop that reads the source peak and modulates the gain

**UI**: a sidechain section in the FX unit (or a standalone FX slot) with a `<select>` to choose the source instrument by name. The transport or app registers instrument names so the select can be populated.

**AudioWorklet alternative**: for sample-accurate ducking, an `AudioWorklet` that receives both the sidechain signal and the main signal, computes the envelope, and applies gain reduction in real time. More precise than `requestAnimationFrame` polling but heavier to implement.

**Where it lives**: could be a new section in `WebAudioFxUnit` (per-instrument, like reverb/delay/chorus), or a standalone effect wired at the app level between instrument outputs and the master bus. Per-instrument FX unit placement is more flexible — any instrument can sidechain from any other.

### Filter Sweep in Delay
Add LP/HP sweep control to the delay's feedback filter (currently LP-only). Completed ✓

## MediaRecorder Recording

Goal: let users record the master output as a WAV file directly in the browser, with a simple record/stop UI.

**Approach**: use the [MediaRecorder API](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder) with `MediaStreamDestination`:

1. Create a `MediaStreamAudioDestinationNode` connected to the master bus (in parallel with `ctx.destination`)
2. Feed its `.stream` into a `MediaRecorder` instance
3. On stop, collect the recorded `Blob` chunks and convert to WAV
4. Offer a download link or in-page playback

**WAV conversion**: `MediaRecorder` typically outputs WebM/Opus. To produce WAV:
- Option A: use an `AudioWorklet` to capture raw PCM samples, then encode WAV manually (header + interleaved float32/int16)
- Option B: record as WebM, then decode the blob via `decodeAudioData()` and re-encode to WAV
- Option A is preferred — lower latency, no re-decode step, and produces lossless output

**UI**: a Record / Stop button in the transport panel. While recording, show elapsed time and a pulsing indicator. On stop, present a download link.

**Scope**: master bus only initially. Per-instrument stem recording is a future extension.

## Possible Future Instruments

| Instrument | Type | Notes |
|---|---|---|
| **Full-featured polysynth** | Synthesis | Production-quality synth to replace/subsume Mono, Pad, and possibly Acid; see **Production Synth** section below |
| Arpeggiator | Utility | BPM-synced note pattern over a chord input |
| Plucked string | Physical model | Karplus-Strong synthesis |
| Snare / clap | Percussion | Noise + tone layering |
| Sampler (melodic) | Sampler | Pitched sample playback, like a one-shot player |
| Granular synth | Synthesis | Granular texture from a buffer |
| Bitcrusher | Effect | Standalone effect (currently embedded in BlipFX only) |
| Ring modulator | Effect | AM/ring mod for metallic textures |

## Production Synth

Goal: a single, full-featured polyphonic synthesizer that sounds like a real production instrument (think Vital, Serum, or a Moog sub) and could eventually replace or subsume SynthMono, SynthPad, and SynthAcid — those become presets of the bigger engine rather than separate instruments.

### What the current synths lack

- **SynthMono**: single oscillator, no unison, no sub, no noise layer, fixed filter envelope
- **SynthPad**: poly voices but minimal modulation — no LFOs, no filter envelope, no oscillator mix
- **SynthAcid**: mono, single osc, specialized for 303 acid — accent/slide logic doesn't generalize
- **SynthFM**: 2-op FM only, no subtractive layer, no noise

No single synth currently supports multi-oscillator + unison + routable modulation + multiple envelope stages. Building one engine with these features covers 90% of what the specialized synths do.

### Architecture: voice-based polyphony

Each note triggers a **voice** — a self-contained signal chain that is allocated from a voice pool and released after the amplitude envelope completes:

```
Voice:
  Osc A (saw/square/tri/sine/wavetable) ──┐
  Osc B (saw/square/tri/sine/wavetable) ──┤
  Sub Osc (sine/square, -1/-2 oct) ───────┤──▶ Mix ──▶ Filter ──▶ Amp ──▶ voice out
  Noise (white/pink) ─────────────────────┘
```

**Voice pool**: fixed pool of N voices (8–16). When all voices are in use, steal the oldest. Each voice is pre-built at init and reused (avoids per-note `createOscillator` GC churn for short notes, though long sustains still need fresh nodes).

### Oscillator features

- **2 main oscillators** (A + B): selectable waveform (saw, square, triangle, sine, pulse) + octave offset + semitone detune + fine detune + mix level
- **Sub oscillator**: sine or square, 1 or 2 octaves below, mix level
- **Noise layer**: white or pink noise, mix level
- **Unison**: per-oscillator voice count (1–8) with spread (detune amount) and stereo width. Stacks multiple detuned copies for thickness. Implemented as multiple `OscillatorNode`s per voice oscillator slot.
- **Wavetable** (future): `PeriodicWave` or `AudioWorklet`-based custom waveforms. Start with basic waveforms; wavetable import is a stretch goal.

### Filter

- **Type**: LP, HP, BP, notch (via `BiquadFilterNode.type`)
- **Cutoff + resonance**: standard knobs
- **Filter envelope**: dedicated ADSR that modulates cutoff. Envelope amount (bipolar) controls how much the envelope sweeps the filter.
- **Key tracking**: higher notes open the filter proportionally (0–100%)

### Envelopes

- **Amp envelope**: ADSR on the voice gain node (existing pattern)
- **Filter envelope**: ADSR → filter cutoff modulation (new)
- **Pitch envelope** (optional): attack-only or AD envelope → oscillator frequency for pitch sweeps (kick-like attacks, plucks)

### LFOs

- **2 LFOs**: each with rate, depth, shape (sine/triangle/square/saw)
- **Destinations**: routable to filter cutoff, oscillator pitch, amplitude, pan, osc mix — via a simple destination select, not a full mod matrix
- **Sync**: free-running or BPM-synced (existing pattern from SynthFM)

### Polyphony

- **Voice count**: 1 (mono with glide) to 16 (full poly)
- **Mono mode**: legato with portamento/glide time
- **Poly mode**: round-robin voice allocation with voice stealing

### What this replaces

With the right presets, the production synth covers:
- **SynthMono**: mono mode + 1 osc + filter envelope
- **SynthPad**: poly mode + 2 oscs with slow attack + unison spread
- **SynthAcid**: mono mode + saw osc + resonant LP filter + filter envelope with short decay (accent/slide would need special handling or could remain acid-specific)

SynthFM stays separate — FM synthesis is a fundamentally different algorithm. Synth808 and the percussion instruments also stay separate.

### Implementation phases

1. **Phase 1 — Core engine**: 2 oscs + sub + noise + filter + amp envelope + filter envelope. Mono and poly modes. Basic presets that match current SynthMono and SynthPad sounds. This alone is a usable production synth.
2. **Phase 2 — Unison + LFOs**: unison stacking with spread, 2 routable LFOs. This is where it starts sounding thick and modern.
3. **Phase 3 — Advanced**: pitch envelope, key tracking, wavetable oscillators via `PeriodicWave`, mono glide/legato.
4. **Phase 4 — Consolidation**: build presets that replicate SynthMono, SynthPad, and SynthAcid sounds. Evaluate whether the originals can be retired.

### Web Audio API feasibility

The Web Audio API can achieve production-quality subtractive/additive synthesis. The main constraints:
- **Oscillator quality**: `OscillatorNode` produces alias-free waveforms natively — no anti-aliasing work needed
- **Unison cost**: 8 unison voices × 2 oscillators × 8 polyphony = 128 oscillator nodes. Web Audio handles this fine on modern hardware, but voice count may need limiting on mobile.
- **Envelope precision**: `setValueAtTime` / `linearRampToValueAtTime` / `exponentialRampToValueAtTime` give sample-accurate automation — no JS timing jitter
- **Filter**: `BiquadFilterNode` is a standard 2nd-order IIR filter. For more aggressive resonance (Moog-style 4-pole ladder), an `AudioWorklet` would be needed — but the stock filter is good enough for Phase 1–2.
- **Wavetable**: `PeriodicWave` supports arbitrary harmonic content. For Serum-style wavetable morphing, an `AudioWorklet` with pre-computed tables would be needed.

## Governance

- Roadmap reviewed monthly by Justin Gitlin
- New instruments must pass the Definition of Done in [QUALITY_SCORE.md](../QUALITY_SCORE.md)
- Active work tracked in [exec-plans/active/](active/)
