# Architecture

## System Context

`wam` is a purely browser-side library. There is no server, no database, and no network calls during audio playback. All audio synthesis happens in the browser's Web Audio API engine.

```
┌─────────────────────────────────────────────────────┐
│  Browser                                            │
│                                                     │
│  App / Demo (src/site/)                             │
│    │  creates AudioContext, wires instruments       │
│    │                                                │
│  Controls Layer (Web Components)                    │
│    │  *Controls classes — UI, serialization,        │
│    │  FX chain, waveform display                    │
│    │                                                │
│  Instrument Layer (plain JS classes)                │
│    │  WebAudioSynth*, WebAudioPerc*, WebAudioBreak* │
│    │  trigger() API, connect()/input routing        │
│    │                                                │
│  Effects & Utilities                                │
│    │  FX classes, WebAudioSequencer,                │
│       WebAudioScales, Worklet processors            │
└─────────────────────────────────────────────────────┘
```

## Data Ownership

| Entity | Owner | Lifetime |
|---|---|---|
| `AudioContext` | App layer | Session (one per page) |
| Audio nodes (osc, filter, vca) | Instrument | Per trigger (fire-and-forget) |
| Instrument parameters (cutoff, decay…) | Instrument class instance | Instrument lifetime |
| UI + step sequencer state | `*Controls` Web Component | Component lifetime |
| FX state | `WebAudioFxUnit` Web Component | Component lifetime |
| Serialized state (JSON) | `toJSON()` / `fromJSON()` on Controls | App-managed; saved to `localStorage` |
| Lookahead timer | `WebAudioSequencer` | Between `start()` / `stop()` |

## End-to-End Flow (Sequencer → Audio Output)

```
1. WebAudioSequencer._tick() fires every 25ms via setInterval
      │
2. Schedules all steps within the next 100ms lookahead window
      │  cb(step, audioContextTime)
3. App's onStep callback delegates to each Controls.step(index, time, dur)
      │
4. Controls checks step pattern; if active, calls instrument.trigger(midi, dur, vel, time)
      │
5. Instrument creates fresh osc/filter/vca chain, sets frequencies and envelopes
      │  (all scheduled as AudioParam.setValueAtTime / exponentialRampToValueAtTime)
6. Browser audio engine renders the graph sample-accurately
      │
7. Audio flows: instrument._out → analyser → FxUnit → master gain → AudioContext.destination
      │
8. Controls.setActiveStep(i) is called via setTimeout to update the UI
```

## Domain Boundaries and Directory Map

Each instrument/effect file co-locates its audio class and `*Controls` Web Component (see [design-docs/instrument-architecture.md](design-docs/instrument-architecture.md)).

```
src/web-audio/
  instruments/                   Audio class + Controls component per file
    synth-acid.js                TB-303-style mono bass
    synth-808.js                 808 sub-bass
    synth-fm.js                  2-op FM poly synth
    synth-mono.js                General mono synth (uses global/dsp/ primitives)
    synth-pad.js                 Poly chord pad
    synth-poly.js                Flagship poly subtractive synth (unison, per-voice
                                 filter ADSR, dual LFOs, voice stealing; built on global/dsp/)
    synth-blipfx.js              Procedural SFX
    perc-kick.js                 808-style kick
    perc-hihat.js                Noise hihat
    perc-snare.js                Noise/tone snare
    sample-player.js             One-shot sample player
    sample-looper.js             Sample loop player
    vocoder.js                   Vocoder vocal processor

  fx/                            Effects (shared connect() / input interface)
    fx-reverb.js                 Convolution reverb
    fx-delay.js                  Dub delay (BPM-synced)
    fx-chorus.js                 Multi-voice chorus
    fx-filter.js                 HP + LP filter (always inline)
    fx-distortion.js             Soft-clip waveshaper
    fx-compressor.js (+ .worklet.js)   Sidechain compressor
    fx-vocoder.js                Vocoder effect
    fx-unit.js                   Composed FX Web Component (reverb+delay+chorus+filter)
    pitch-shift.js (+ .worklet.js)     Granular pitch-shift
    time-stretch.js (+ .worklet.js)    Granular time-stretch

  global/                        Headless engine + shared utilities (no DOM)
    instrument-base.js           Base audio class shared by instruments
    sequencer.js                 Lookahead step sequencer (no UI)
    sequencer-conditions.js      Trig-condition (X:Y bar-cycle) source of truth
    scales.js                    Music theory: scales, chords, MIDI helpers
    sample-utils.js              Sample load/decode helpers
    store-keys.js                Persistence key constants
    dsp/                         Shared fire-and-forget DSP primitives
      envelope.js                applyADSR / applyFilterEnv
      oscillator.js              createUnisonOscBank
      distortion.js              makeSoftClipCurve

  ui/                            Web Components and panel infrastructure
    controls-base.js             WebAudioControlsBase (slider factory, step loop,
                                 _meetsCondition, input-learn mixin host)
    slider.js / knob.js          Range / knob input components
    step-seq.js                  16-step sequencer grid component
    transport.js                 Transport (play/stop/BPM) controls
    visualizer.js / waveform.js  Scope / spectrogram / FFT visualizers
    level-meter.js / param-display.js   Metering & readouts
    drawer.js / arrangement-library.js  App-shell chrome & preset/arrangement UI
    midi-input-picker.js / midi-monitor.js   MIDI device UI
    focus-manager.js / input-learn.js   Panel focus + learn (see FRONTEND.md)
    sketches/                    Canvas visual sketches

  midi/                          Device drivers (see references/launch-control-xl.md)
    launch-control-xl.js         Launch Control XL map
    auto-map.js                  Sequencer auto-mapping on focus
    led-feedback.js              Hardware LED feedback
    midi-output.js               Rate-limited/batched sysex output
    sequencer-hardware.js        Hardware sequencer bridge

  input/                         Source-agnostic input abstraction (see FRONTEND.md)
    input-bindings.js            Binding contract + registry
    keyboard-source.js           Computer-keyboard adapter
    midi-source.js               MIDI adapter

src/app/                         Standalone demo apps (playground, generative, vocoder)
src/site/
  app.js                         Entry point
  pico-theme.js                  PicoCSS theme customization

src/css/
  pico.css                       PicoCSS base
  styles.css                     Global site overrides

public/
  audio/                         Drum loop / sample WAVs
  images/                        Icons and images
  manifest.json / sw.js          PWA manifest + service worker
```

## Key Architecture Decisions

| Decision | Rationale |
|---|---|
| Fire-and-forget voices | No voice pool management; browser GC handles cleanup after `osc.stop()`. Simple, leak-free, unlimited polyphony. |
| Instrument + Controls co-located per file | Each file is a self-contained instrument module. Import one file, get both the audio class and the UI component. |
| No Shadow DOM | CSS custom properties can't cross shadow boundaries easily; light DOM keeps the component tree inspectable and themable. |
| `connect()` / `input` routing protocol | Lets library objects and raw `AudioNode`s chain interchangeably via `node.input ?? node`. |
| BPM-synced timing throughout | Delay times and LFO rates expressed in beats, not Hz/seconds. All timing derives from one BPM source. |
| Static `PRESETS` + `applyPreset()` | Partial presets via `!= null` guards; new params can be added without breaking existing preset objects. |

See [docs/design-docs/index.md](docs/design-docs/index.md) for extended rationale on each decision.
