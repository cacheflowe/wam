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

```
src/web-audio/
  web-audio-synth-acid.js        TB-303-style mono bass (instrument + controls)
  web-audio-synth-808.js         808 sub-bass (instrument + controls)
  web-audio-synth-fm.js          2-op FM poly synth (instrument + controls)
  web-audio-synth-mono.js        General mono synth (instrument + controls)
  web-audio-synth-pad.js         Poly chord pad (instrument + controls)
  web-audio-synth-blipfx.js      Procedural SFX (instrument + controls)
  web-audio-perc-kick.js         808-style kick (instrument + controls)
  web-audio-perc-hihat.js        Noise hihat (instrument + controls)
      web-audio-sample-looper.js     Sample loop player (instrument + controls)
  web-audio-fx-reverb.js         Convolution reverb
  web-audio-fx-delay.js          Dub delay (BPM-synced)
  web-audio-fx-chorus.js         Multi-voice chorus
  web-audio-fx-filter.js         HP + LP filter (always inline)
  web-audio-fx-distortion.js     Soft-clip waveshaper
  web-audio-fx-unit.js           Composed FX Web Component (reverb+delay+chorus+filter)
  web-audio-pitch-shift.js       Granular pitch-shift
  web-audio-pitch-shift.worklet.js   AudioWorklet processor
  web-audio-time-stretch.js      Granular time-stretch
  web-audio-time-stretch.worklet.js  AudioWorklet processor
  web-audio-slider.js            Range input Web Component + shared CSS helpers
  web-audio-step-seq.js          16-step sequencer grid Web Component
  web-audio-waveform.js          Visualizer Web Component (scope/spectrogram/FFT)
  web-audio-sequencer.js         Lookahead step sequencer (no UI)
  web-audio-scales.js            Music theory: scales, chords, MIDI helpers

src/site/
  app.js                         Entry point (to be built)
  pico-theme.js                  PicoCSS theme customization

src/css/
  pico.css                       PicoCSS base
  styles.css                     Global site overrides

public/
  audio/breaks/                  Drum loop WAV samples
  images/                        Icons and images
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
