# Roadmap

Owner: Justin Gitlin
Last reviewed: 2026-05-01

## Vision

Build a library of browser-based instruments that are:
1. Individually importable into any web app
2. Fully functional with or without the Controls UI
3. Well-documented enough that agents and new contributors can add instruments following existing patterns

## Current State (as of 2026-05-01)

**Instruments (complete)**:
- `WebAudioSynthAcid` — TB-303-style acid bass
- `WebAudioSynth808` — 808 sub-bass
- `WebAudioSynthFM` — 2-op FM poly synth
- `WebAudioSynthMono` — general mono synth
- `WebAudioSynthPad` — poly chord pad
- `WebAudioSynthBlipFX` — procedural SFX
- `WebAudioPercKick` — 808 kick
- `WebAudioPercHihat` — noise hi-hat
- `WebAudioPercSnare` — layered snare/clap (tone body + noise snap + clap mode)
- `WebAudioBreakPlayer` — drum loop sampler with time-stretch

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

## Near-Term Goals

| Goal | Priority | Notes |
|---|---|---|
| **Sequencer UI cleanup** | High | Step sequencer UI needs polish after probability/ratchet/conditions/rotation additions |
| Build `src/site/app.js` demo harness | High | Wire all instruments into a playable demo |
| Add test suite | High | See [tech-debt-tracker.md](tech-debt-tracker.md) |
| **Test playground** | High | Isolated per-instrument/per-effect dev environment; see **Test Playground** section below |
| Reorganize `src/web-audio/` into subdirs | High | See **File Organization** section below |
| **Rename & shorten prefix** | High | `web-audio-` prefix is too verbose; see **Renaming** section below |
| Fix FM synth presets | High | Several presets produce dead/silent sounds; audit and retune all |
| Responsive volume / overload protection | Medium | See **Responsive Volume** section below |
| Acid-breaks UI grid layout | Medium | Container queries for responsive panel grid; see **Layout** section below |
| Pattern evolution tools | Medium | Slow morph / mutation of sequences over time; see **Pattern Evolution** section below |
| **Auto-normalization / gain staging** | Medium | Per-instrument default volumes and red-line protection; see **Auto-Normalization** section below |
| **Jam buttons in channel strip** | Medium | Move manual trigger buttons to channel strip for easy access; see **Jam & Randomize Buttons** section below |
| **BlipFX lock sound toggle** | Low | Toggle to disable per-trigger randomization so you can keep a sound; see **BlipFX Random Sound** section below |
| Per-instrument product specs | Medium | Fill out individual spec files in [product-specs/](../product-specs/) |
| MIDI learn | Medium | See **MIDI** section below |
| **MediaRecorder WAV recording** | Medium | Record and render WAV files on the fly; see **MediaRecorder Recording** section below |
| Refine existing instruments & effects | Ongoing | Tuning, preset quality, edge cases |
| Add new instruments & effects | Ongoing | See **Possible Future Instruments** section below |
| npm package publication | Low | Export each instrument as a named module; publish to npm |

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

Goal: replace the verbose `web-audio-` prefix on file names, Web Component tag names, and CSS class namespaces with something shorter.

**Candidate prefix**: `wam-` (Web Audio Module) — short, project-specific, unlikely to collide.

| Current | Proposed |
|---|---|
| `web-audio-synth-acid.js` | `wam-synth-acid.js` |
| `<web-audio-slider>` | `<wam-slider>` |
| `.was-range` / `.wac-section` | `.wam-range` / `.wam-section` |

**Prerequisite**: complete the File Organization refactor first.

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

These would live in a `web-audio-evolution.js` module, usable independently of the step sequencer UI.

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

## BlipFX Random Sound

Add a toggle that disables the per-trigger sound randomization. Currently BlipFX picks a new random preset on every trigger — sometimes you want to keep a sound locked in for a while. Toggle serialized in `toJSON()`.

## MIDI

| Feature | Notes |
|---|---|
| MIDI keyboard input | Map note-on/off to `instrument.trigger()`. Web MIDI API, optional. |
| MIDI learn | Click slider, move CC knob to bind. Stored in Controls' `toJSON()`. |
| MIDI clock sync | Sync `WebAudioSequencer` BPM to incoming MIDI clock (24 ppq). |

## New Effects

| Effect | Notes |
|---|---|
| **Sidechain Compressor** | Duck one instrument based on another's amplitude (envelope follower → gain modulation) |
| **Phaser** | Multi-stage all-pass filter sweep; LFO-modulated; stereo |
| **Compressor** | Wrapper + UI around `DynamicsCompressorNode` |
| **Ping-Pong Delay** | `stereo: "pingpong"` mode in existing delay; alternates echoes L→R |
| **Tremolo** | LFO-modulated amplitude; rate/depth/shape |
| **Wah-Wah** | Bandpass filter with LFO + envelope-follower mode |

## MediaRecorder Recording

Goal: record master output as WAV directly in browser.

Approach: `AudioWorklet` captures raw PCM → encode WAV header + int16 data → download link. UI: Record/Stop button in transport panel with elapsed time indicator.

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

## Governance

- Roadmap reviewed monthly by Justin Gitlin
- New instruments must pass the Definition of Done in [QUALITY_SCORE.md](../QUALITY_SCORE.md)
- Active work tracked in [exec-plans/active/](active/)
