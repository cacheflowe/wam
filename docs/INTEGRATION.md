# WAM — Integration Guide

How to use WAM instruments, effects, UI controls, and app components in an external project.

---

## Requirements

- **ES modules** — all files use `import`/`export`. No CommonJS.
- **Vite (or equivalent bundler)** — required for AudioWorklet URLs (`new URL('./file.worklet.js', import.meta.url).href`). The worklets power time-stretching and pitch-shifting.
- **HTTPS + COOP/COEP headers** — AudioWorklet and SharedArrayBuffer require a secure context with cross-origin isolation headers:
  ```
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  ```
  In Vite, add these in `vite.config.js` under `server.headers` and `preview.headers`.
- **User gesture** — AudioContext must be resumed inside a user interaction before audio plays. Always call `ctx.resume()` in a click/keydown handler.

---

## Using a pre-built app component

The fastest integration path is embedding one of the complete app custom elements. Copy the relevant `src/app/*.js` file (and its imports) into your project and register it.

### `<generative-ambient>`

A self-contained generative ambient music player. Drop it into any page:

```html
<script type="module" src="./generative-ambient.js"></script>
<generative-ambient></generative-ambient>
```

**What it does:** Four plant-biology parameters (Dryness, Size, Branching, Texture) drive a five-layer ambient soundscape — sustained drone, two pad layers, sparse melody, and FM bells. BPM, scale, reverb depth, note density, and instrument timbre all evolve continuously from the plant readings.

**Public JS API:**

```js
const el = document.querySelector("generative-ambient");

// Apply a plant reading object (animates via autopilot morph over ~40s)
el.applyReading({ dryness: 2, size: 520, branching: 7, physicalTexture: 0.8 });

// Apply immediately with no animation
el.applyReading({ dryness: 8, size: 120, branching: 3, physicalTexture: 0.1 }, { animate: false });
```

**Plant parameter ranges:**

| Param | Range | Effect |
|---|---|---|
| `dryness` | 0–10 | 0 = lush rainforest reverb; 10 = dry exposed cactus |
| `size` | 50–900 | Controls BPM (50→70 BPM, 900→30 BPM) and note durations |
| `branching` | 0–10 | Chord complexity, trigger density, FM modulation depth |
| `physicalTexture` | 0–1 | 0 = spiky (sharp attacks); 1 = smooth (long blooms) |

**Built-in presets:** Cactus, Seedling, Fern, Shrub, Oak, Willow, Unhealthy, Healthy

**Dependencies imported by generative-ambient.js:**
- `src/web-audio/instruments/synth-mono.js`
- `src/web-audio/instruments/synth-pad.js`
- `src/web-audio/instruments/synth-fm.js`
- `src/web-audio/fx/fx-reverb.js`, `fx-delay.js`, `fx-chorus.js`
- `src/web-audio/ui/slider.js`, `fx-unit.js`, `waveform.js`, `plant-visualizer.js`
- `src/web-audio/global/sequencer.js`, `scales.js`

---

### `<wam-playground>`

Full instrument rack with transport, all instruments, step sequencer, and pattern save/load.

```html
<script type="module" src="./playground.js"></script>
<wam-playground></wam-playground>
```

### `<acid-breaks>`

Acid synth + breakbeat loop player demo.

```html
<script type="module" src="./acid-breaks.js"></script>
<acid-breaks></acid-breaks>
```

---

## Building a custom audio graph

If you want individual instruments rather than a full app, wire them manually.

### Pattern: instrument → FX → master gain → destination

```js
import WebAudioSynthMono from "./src/web-audio/instruments/synth-mono.js";
import WebAudioFxReverb from "./src/web-audio/fx/fx-reverb.js";

// Always inside a user gesture:
const ctx = new AudioContext();
await ctx.resume();

const master = ctx.createGain();
master.gain.value = 0.8;
master.connect(ctx.destination);

const reverb = new WebAudioFxReverb(ctx, { decay: 4, wet: 0.5 });
reverb.connect(master);

const synth = new WebAudioSynthMono(ctx, "Whisper");
synth.connect(reverb.input);

// Trigger a note: MIDI note, duration (sec), velocity (0-1), scheduleTime
synth.trigger(60, 1.0, 0.7, ctx.currentTime);
```

### Pattern: using the FX rack (wam-fx-unit)

```js
import "./src/web-audio/fx/fx-unit.js"; // registers <wam-fx-unit>

const fxUnit = document.createElement("wam-fx-unit");
document.body.appendChild(fxUnit);
fxUnit.init(ctx, { title: "Main FX", bpm: 120, reverbWet: 0.4, delayMix: 0.2 });

synth.connect(fxUnit.input);
fxUnit.connect(master);
fxUnit.bpm = 140; // update delay sync on BPM change
```

### Pattern: BPM-synced sequencer

```js
import WebAudioSequencer from "./src/web-audio/global/sequencer.js";

const seq = new WebAudioSequencer(ctx, { bpm: 120, steps: 16, subdivision: 4 });
seq.onStep((step, time) => {
  // `time` is AudioContext time — use it for sample-accurate scheduling
  if (step % 4 === 0) synth.trigger(60, 0.25, 0.8, time);
});
seq.start();
// seq.stop();
// seq.bpm = 140;
```

`subdivision: 4` = quarter notes (16 steps = 4 bars). `subdivision: 8` = eighth notes.

---

## Instruments

All instruments share this interface:

```js
const inst = new WebAudioSynthXxx(ctx, presetName?);
inst.connect(destinationNodeOrObject); // .connect(node) or .connect({ input: node })
inst.applyPreset("PresetName");
inst.volume = 0.8; // 0–1 output gain
```

### Synth instruments

#### `WebAudioSynthMono` — monophonic synth
```js
import WebAudioSynthMono from "./src/web-audio/instruments/synth-mono.js";
const synth = new WebAudioSynthMono(ctx, "Whisper");

// trigger(midiNote, durationSec, velocity, atTime)
synth.trigger(60, 0.5, 0.8, ctx.currentTime);

// Live param changes (take effect immediately)
synth.attack = 0.1;
synth.release = 1.2;
synth.filterFreq = 800;
synth.filterQ = 4;
synth.oscType = "sawtooth"; // sawtooth | square | triangle | sine
synth.lfoRate = 4;
synth.lfoDepth = 0.5;
synth.lfoDest = "filter"; // filter | pitch | amp
```

Presets: `Whisper`, `Bass`, `Lead`, `Pad`, `Pluck`, `Drone_Pad`, and more.

#### `WebAudioSynthPad` — polyphonic pad
```js
import WebAudioSynthPad from "./src/web-audio/instruments/synth-pad.js";
const pad = new WebAudioSynthPad(ctx, "Vapor");

// trigger(midiNotes, durationSec, velocity, atTime) — notes can be array for chords
pad.trigger([60, 64, 67], 3.0, 0.6, ctx.currentTime);
pad.trigger(60, 2.0, 0.5, ctx.currentTime); // single note also works
```

#### `WebAudioSynthFM` — 2-operator FM synth
```js
import WebAudioSynthFM from "./src/web-audio/instruments/synth-fm.js";
const fm = new WebAudioSynthFM(ctx, "Bell");

// trigger(midiNotes, stepDurSec, atTime)
fm.trigger([72], 0.5, ctx.currentTime);
fm.bpm = 120; // syncs LFO to tempo

fm.modIndex = 5;    // FM depth; higher = more metallic
fm.carrierRatio = 1;
fm.modRatio = 2;
```

Presets: `Bell`, `E_Piano`, `Vibes`, `Organ`, `Brass`, `Kalimba`, `Sitar`, `Glass`, `Ether`, and more.

#### `WebAudioSynthAcid` — TB-303 acid bass
```js
import WebAudioSynthAcid from "./src/web-audio/instruments/synth-acid.js";
const acid = new WebAudioSynthAcid(ctx, "Squelch");

// trigger(midi, stepDurSec, accent, atTime)
acid.trigger(36, 0.125, false, ctx.currentTime);
acid.trigger(36, 0.125, true, ctx.currentTime); // accented = louder + more filter sweep
```

#### `WebAudioSynth808` — sub bass / 808 kick
```js
import WebAudioSynth808 from "./src/web-audio/instruments/synth-808.js";
const s808 = new WebAudioSynth808(ctx, "Default");

// trigger(midi, stepDurSec, atTime) — lower MIDI = deeper pitch (24–48 typical)
s808.trigger(36, 0.5, ctx.currentTime);
```

#### `WebAudioSynthBlipFX` — procedural SFX synth
```js
import WebAudioSynthBlipFX from "./src/web-audio/instruments/synth-blipfx.js";
const blip = new WebAudioSynthBlipFX(ctx);

blip.trigger(ctx.currentTime); // fires pre-baked buffer
blip.randomize();              // generate a random sound
```

### Percussion

```js
import WebAudioPercKick from "./src/web-audio/instruments/perc-kick.js";
import WebAudioPercSnare from "./src/web-audio/instruments/perc-snare.js";
import WebAudioPercHihat from "./src/web-audio/instruments/perc-hihat.js";

// trigger(velocity, atTime)
kick.trigger(1.0, ctx.currentTime);
snare.trigger(0.8, ctx.currentTime);
hihat.trigger(0.6, ctx.currentTime, false); // third arg: open (true) or closed (false)
```

### Sample players

#### `WebAudioSamplePlayer` — one-shot sampler
```js
import WebAudioSamplePlayer from "./src/web-audio/instruments/sample-player.js";
const player = new WebAudioSamplePlayer(ctx);

// Load a single sample
await player.loadSample("/audio/kick.wav", "kick");

// Or load multiple
await player.loadAll("/audio/samples/", ["kick.wav", "snare.wav", "hat.wav"]);
player.selectSample("kick");

// Drum mode (no pitch shift): triggerDrum(velocity, duration, atTime)
player.triggerDrum(1.0, 0.5, ctx.currentTime);

// Melodic mode: trigger(midi, duration, velocity, atTime)
player.trigger(60, 0.5, 0.8, ctx.currentTime);
```

#### `WebAudioLoopPlayer` — BPM-synced loop player
```js
import WebAudioLoopPlayer from "./src/web-audio/instruments/sample-looper.js";
const looper = new WebAudioLoopPlayer(ctx, {
  subdivision: 4,   // quarter notes
  returnSteps: 4,   // steps before returning to nominal position after a jump
  randomChance: 0.1 // probability of random position jump per step
});

await looper.load("/audio/breaks/myloop.wav", 4); // 4 = loop length in bars

// Call every sequencer step
seq.onStep((step, time) => {
  looper.trigger(step, bpm, time);
});

// Jump to a segment (e.g. for jam controls)
looper.jumpToSegment(0, 3, bpm, time, step); // segIndex, numSegments, bpm, atTime, globalStep
```

---

## Effects

All FX take `ctx` and an options object. They expose `.input` (AudioNode to connect into) and `.connect(node)` (to route output).

```js
import WebAudioFxReverb  from "./src/web-audio/fx/fx-reverb.js";
import WebAudioFxDelay   from "./src/web-audio/fx/fx-delay.js";
import WebAudioFxChorus  from "./src/web-audio/fx/fx-chorus.js";
import WebAudioFxFilter  from "./src/web-audio/fx/fx-filter.js";

const reverb = new WebAudioFxReverb(ctx, { decay: 6, wet: 0.6, preDelay: 20 });
const delay  = new WebAudioFxDelay(ctx,  { interval: 0.5, bpm: 120, feedback: 0.4, wet: 0.3 });
const chorus = new WebAudioFxChorus(ctx, { voices: 3, rate: 0.3, depth: 10, wet: 0.5 });

// Serial chain: synth → chorus → delay → reverb → master
synth.connect(chorus.input);
chorus.connect(delay.input);
delay.connect(reverb.input);
reverb.connect(master);

// Live updates
reverb.wet = 0.8;
reverb.decay = 10;
delay.bpm = 140;    // re-syncs delay time
delay.feedback = 0.5;
chorus.wet = 0.4;
```

---

## UI Controls

### Attaching control panels to instruments

Each instrument has a paired `*-controls` custom element. These provide sliders, preset selectors, sequencer grid, FX unit, and waveform visualizer — all wired to the instrument automatically.

```js
import "./src/web-audio/instruments/synth-mono.js";         // instrument
import "./src/web-audio/ui/controls-base.js";               // base (auto-imported by controls)
// The controls element is defined inside the instrument file or a paired *-controls file:

const synth = new WebAudioSynthMono(ctx, "Whisper");
const ctrl = document.createElement("wam-synth-mono-controls");
document.body.appendChild(ctrl);

// bind(instrument, ctx, options) wires everything up
ctrl.bind(synth, ctx, {
  title: "Melody",
  color: "#99eeff",
});

// Route controls output to your FX/master
ctrl.connect(reverb.input);

// Serialization
const state = ctrl.toJSON();
ctrl.fromJSON(state);
```

**Controls element tags:**

| Instrument | Controls tag |
|---|---|
| `WebAudioSynthMono` | `wam-synth-mono-controls` |
| `WebAudioSynthPad` | `wam-synth-pad-controls` |
| `WebAudioSynthFM` | `wam-synth-fm-controls` |
| `WebAudioSynthAcid` | `wam-synth-acid-controls` |
| `WebAudioSynth808` | `wam-synth-808-controls` |
| `WebAudioSynthBlipFX` | `wam-synth-blipfx-controls` |
| `WebAudioPercKick` | `wam-perc-kick-controls` |
| `WebAudioPercSnare` | `wam-perc-snare-controls` |
| `WebAudioPercHihat` | `wam-perc-hihat-controls` |
| `WebAudioSamplePlayer` | `wam-sample-player-controls` |
| `WebAudioLoopPlayer` | `wam-sample-looper-controls` |

### Transport

```js
import "./src/web-audio/ui/transport.js"; // registers <wam-transport>

const transport = document.createElement("wam-transport");
document.body.appendChild(transport);
transport.init(ctx, { bpm: 120, steps: 16 });

// Register instrument controls to receive step callbacks
transport.registerInstrument(ctrl); // ctrl = wam-synth-mono-controls etc.

// Connect transport output to master
transport.connect(master);

// Events
transport.addEventListener("transport-play",  () => { /* started */ });
transport.addEventListener("transport-stop",  () => { /* stopped */ });
transport.addEventListener("transport-scale-change", (e) => {
  const { root, scale } = e.detail; // root = MIDI note, scale = interval array
});
```

### Sliders

```js
import "./src/web-audio/ui/slider.js"; // registers <wam-slider>

const slider = document.createElement("wam-slider");
slider.setAttribute("label", "Cutoff");
slider.setAttribute("param", "filterFreq");
slider.setAttribute("min", "80");
slider.setAttribute("max", "20000");
slider.setAttribute("step", "1");
slider.setAttribute("scale", "log"); // optional: logarithmic scale
slider.value = 2000;

slider.addEventListener("slider-input", (e) => {
  const { param, value } = e.detail;
  synth[param] = value;
});
```

---

## Music helpers

### Scales

```js
import { SCALES, SCALES_ORDERED, NOTE_NAMES, buildChordFromScale, scaleNotesInRange } from
  "./src/web-audio/global/scales.js";

// SCALES: object keyed by scale name → interval array
// SCALES_ORDERED: array of [name, intervals] sorted dark→bright

// Build a chord rooted at MIDI 60 in "Major" scale with 4 voices
const chord = buildChordFromScale(60, "Major", 4); // → [60, 64, 67, 71]

// All scale notes in a MIDI range
const pool = scaleNotesInRange("Minor", 60, 48, 84); // scaleName, root, lo, hi
```

Available scale names: `Phrygian`, `Blues`, `Minor`, `Dorian`, `Pent_Minor`, `Pent_Major`, `Major`, `Lydian`

---

## Typical integration checklist

1. Copy `src/web-audio/` into your project (instruments, fx, ui, global subdirs).
2. Configure COOP/COEP headers in your server (required for AudioWorklet).
3. Resume AudioContext on first user gesture.
4. Instantiate `WebAudioSequencer` for timing; connect `onStep` to your instrument triggers.
5. Wire instruments → FX → master gain → `ctx.destination`.
6. Optionally create `*-controls` elements with `ctrl.bind(inst, ctx, options)` for full UI.
7. Optionally embed `<wam-transport>` and call `transport.registerInstrument(ctrl)` for each instrument to get BPM/play/stop/scale UI for free.

---

## Notes on AudioWorklet paths

The pitch-shifting and time-stretching effects use AudioWorklets. In Vite, worklet URLs are resolved like this in the source:

```js
new URL("./pitch-shift.worklet.js", import.meta.url).href
```

If you're not using Vite, you'll need to serve the worklet files as static assets and provide their URL manually. This affects `WebAudioPitchShift` (used inside `WebAudioLoopPlayer`) and `WebAudioTimeStretch`.
