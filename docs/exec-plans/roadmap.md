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
- `WebAudioFxUnit` Web Component composing all effects

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
| **Per-instrument channel strip** | Medium | Volume, pan, mute per instrument; see **Channel Strip** section below |
| **Master transport panel** | Medium | Transport as a styled instrument-like panel with master FX and waveform; see **Transport Panel** section below |
| Responsive volume / overload protection | Medium | See **Responsive Volume** section below |
| Inline parameter tooltips | Medium | Explain each slider's purpose; see **UI Tooltips** section below |
| Acid-breaks UI grid layout | Medium | Container queries for responsive panel grid; see **Layout** section below |
| Pattern evolution tools | Medium | Slow morph / mutation of sequences over time; see **Pattern Evolution** section below |
| Per-instrument product specs | Medium | Fill out individual spec files in [product-specs/](../product-specs/) |
| MIDI learn | Medium | See **MIDI** section below |
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
  ui/
    web-audio-slider.js
    web-audio-step-seq.js
    web-audio-waveform.js
  global/
    web-audio-sequencer.js
    web-audio-scales.js
    web-audio-pitch-shift.js
    web-audio-pitch-shift.worklet.js
    web-audio-time-stretch.js
    web-audio-time-stretch.worklet.js
```

**Notes**: Update all import paths in instrument files and any app entry points. Worklet `addModule()` paths must also be updated — use `new URL('./file.worklet.js', import.meta.url).href` so Vite resolves them correctly after the move.

## Channel Strip

Goal: every instrument panel gets a small "channel strip" section (volume, pan, mute) that mirrors the mental model of a mixing board. Currently mute lives in the title row and pan doesn't exist.

**Controls** (proposed, per instrument):
- **Volume** — output gain, 0–1, replaces the per-instrument `vol` slider where it exists
- **Pan** — stereo position, −1 (L) to +1 (R), default 0; implemented via `StereoPannerNode`
- **Mute** — existing mute toggle, moved into this section for consistency
- **Solo** (optional, later) — cuts all other instruments; requires a shared solo bus

**Audio change**: each instrument's output chain gains a `StereoPannerNode` inserted between the instrument output gain and the master gain. The controls component owns this node via a `_pan` property.

**UI**: a dedicated `Channel` section at the top of every controls panel, rendered before instrument-specific sections. Visually consistent with `.wac-section` / `.wac-section-label` pattern. The mute button moves here from the title row.

**Serialization**: `pan` and `volume` added to every controls component's `toJSON()` / `fromJSON()`. Old saves without `pan` default to 0.

**Scope**: `WebAudioSynthAcid`, `WebAudioSynth808`, `WebAudioSynthFM`, `WebAudioSynthBlipFX`, `WebAudioBreakPlayer`, and any future instruments. The channel strip logic can be extracted into a shared helper (e.g. `createChannelStrip(controls, instrument)`) to avoid duplication.

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

Recommended approach: add a `DynamicsCompressorNode` between the master gain and `ctx.destination` as a first pass. Expose threshold/ratio/makeup-gain in the app UI. Each app (acid-breaks, generative-music) should have its own master gain slider.

## UI Tooltips

Goal: give users in-context explanations of what each slider does without cluttering the UI.

Approach: use [PicoCSS tooltips](https://picocss.com/docs/tooltip) (`data-tooltip` attribute). Add a short tooltip string to each entry in `SLIDER_DEFS`:

```js
static SLIDER_DEFS = [
  { param: "cutoff", label: "Cutoff", ..., tooltip: "Base filter frequency. Lower = darker tone." },
  { param: "resonance", label: "Reso", ..., tooltip: "Filter resonance. High values = pronounced peak at cutoff." },
];
```

The Controls `bind()` method sets `data-tooltip` on the slider wrapper element. PicoCSS renders the tooltip on hover/focus with no JS.

**Fallback**: if PicoCSS tooltip styling conflicts with the `.wac-*` CSS, a `title` attribute provides a native browser tooltip at zero cost.

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

## MIDI

| Feature | Notes |
|---|---|
| MIDI keyboard input | Map incoming note-on/note-off to `instrument.trigger()` calls. Web MIDI API, optional — degrade gracefully if unavailable. |
| MIDI learn | Click a slider, move a MIDI CC knob to bind it. Map stored in Controls' `toJSON()` state. |
| MIDI clock sync | Sync `WebAudioSequencer` BPM to incoming MIDI clock (24 ppq). |

MIDI features should be optional and additive — instruments must work without MIDI.

## Possible Future Instruments

| Instrument | Type | Notes |
|---|---|---|
| Arpeggiator | Utility | BPM-synced note pattern over a chord input |
| Plucked string | Physical model | Karplus-Strong synthesis |
| Snare / clap | Percussion | Noise + tone layering |
| Sampler (melodic) | Sampler | Pitched sample playback, like a one-shot player |
| Granular synth | Synthesis | Granular texture from a buffer |
| Bitcrusher | Effect | Standalone effect (currently embedded in BlipFX only) |
| Ring modulator | Effect | AM/ring mod for metallic textures |

## Governance

- Roadmap reviewed monthly by Justin Gitlin
- New instruments must pass the Definition of Done in [QUALITY_SCORE.md](../QUALITY_SCORE.md)
- Active work tracked in [exec-plans/active/](active/)
