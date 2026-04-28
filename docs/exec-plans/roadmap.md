# Roadmap

Owner: Justin Gitlin
Last reviewed: 2026-04-27 (updated 2026-04-27)

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
| Reorganize `src/web-audio/` into subdirs | High | See **File Organization** section below |
| Fix FM synth presets | High | Several presets produce dead/silent sounds; audit and retune all |
| Master volume control | Medium | Per-app gain knob in acid-breaks and generative-music apps |
| Responsive volume / overload protection | Medium | See **Responsive Volume** section below |
| Inline parameter tooltips | Medium | Explain each slider's purpose; see **UI Tooltips** section below |
| Acid-breaks UI grid layout | Medium | Container queries for responsive panel grid; see **Layout** section below |
| Pattern evolution tools | Medium | Slow morph / mutation of sequences over time; see **Pattern Evolution** section below |
| Per-instrument product specs | Medium | Fill out individual spec files in [product-specs/](../product-specs/) |
| MIDI learn | Medium | See **MIDI** section below |
| Refine existing instruments & effects | Ongoing | Tuning, preset quality, edge cases |
| Add new instruments & effects | Ongoing | See **Possible Future Instruments** section below |
| npm package publication | Low | Export each instrument as a named module; publish to npm |

## File Organization

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

## Responsive Volume / Overload Protection

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
