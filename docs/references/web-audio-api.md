# Web Audio API Reference

Implementation guide for common patterns used in this library.

## AudioContext

```js
const ctx = new AudioContext();
// ctx.state: "suspended" | "running" | "closed"
await ctx.resume(); // required after user gesture
ctx.currentTime;    // monotonic clock in seconds (never resets)
ctx.sampleRate;     // typically 44100 or 48000
ctx.destination;    // final output node (speakers)
```

## Node Types Used in This Library

| Node | Use |
|---|---|
| `OscillatorNode` | All pitched synthesis; start/stop on schedule |
| `GainNode` | VCA envelopes, master gain, dry/wet mixing |
| `BiquadFilterNode` | Lowpass (instrument filters), highpass, bandpass (hihat) |
| `ConvolverNode` | Convolution reverb (synthesized IR) |
| `DelayNode` | Delay effect |
| `WaveShaperNode` | Distortion (soft-clip curve) |
| `AnalyserNode` | Waveform and FFT display |
| `AudioBufferSourceNode` | Sample playback (break player) |
| `AudioWorkletNode` | Pitch shift and time-stretch processors |
| `ChannelMergerNode` | Stereo routing in chorus |
| `ChannelSplitterNode` | Stereo routing in chorus |
| `StereoPannerNode` | Voice panning in chorus |

## AudioParam Scheduling

All envelope and modulation scheduling uses `AudioParam` methods for sample accuracy:

```js
const now = ctx.currentTime;

// Immediate set
param.setValueAtTime(value, now);

// Linear ramp (e.g., attack)
param.linearRampToValueAtTime(targetValue, now + attackSec);

// Exponential ramp (e.g., filter decay) — cannot target 0, use 0.001
param.exponentialRampToValueAtTime(0.001, now + decaySec);

// Cancel scheduled values (when retriggering)
param.cancelScheduledValues(now);
```

**Important**: Exponential ramps cannot target exactly 0. Use `0.001` or similar small value for silencing. After `exponentialRampToValueAtTime(0.001, t)`, set `setValueAtTime(0, t)` to fully silence.

## OscillatorNode Lifecycle

```js
const osc = ctx.createOscillator();
osc.type = "sawtooth"; // sine | square | sawtooth | triangle | custom
osc.frequency.setValueAtTime(midiToFreq(midi), atTime);
osc.connect(vca);
osc.start(atTime);
osc.stop(atTime + durationSec);
osc.onended = () => { osc.disconnect(); vca.disconnect(); };
```

An `OscillatorNode` can only be started and stopped once. Create a new node for each trigger.

## MIDI to Frequency

```js
function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
```

A4 = MIDI 69 = 440 Hz. Middle C = MIDI 60 = ~261.6 Hz.

## AudioWorklet

```js
// Registration (once per context, after user gesture)
await ctx.audioWorklet.addModule(
  new URL("./wam-pitch-shift.worklet.js", import.meta.url).href
);

// Instantiation
const node = new AudioWorkletNode(ctx, "pitch-shift-processor");
node.parameters.get("pitch").value = 1.5; // semitones
sourceNode.connect(node);
node.connect(ctx.destination);
```

Worklet processors run in a separate thread. They cannot access the DOM or `ctx.currentTime` directly — they receive `currentFrame` and `currentTime` in the `process()` callback.

## AudioBuffer (for samples)

```js
const response = await fetch("/audio/breaks/sample.wav");
const arrayBuffer = await response.arrayBuffer();
const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

// Playback
const source = ctx.createBufferSource();
source.buffer = audioBuffer;
source.loop = true;
source.playbackRate.value = 1.0; // 1.0 = original speed
source.connect(ctx.destination);
source.start(ctx.currentTime);
```

## AnalyserNode

```js
const analyser = ctx.createAnalyser();
analyser.fftSize = 2048;
const bufferLength = analyser.frequencyBinCount; // fftSize / 2
const dataArray = new Uint8Array(bufferLength);

// Oscilloscope
analyser.getByteTimeDomainData(dataArray);

// FFT
analyser.getByteFrequencyData(dataArray);
```

The `WebAudioWaveform` component uses an `AnalyserNode` provided by the Controls `bind()` call.

## Cross-Origin Isolation (Required for AudioWorklet)

The page must be served with these headers:
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Without them, `ctx.audioWorklet.addModule()` throws or `SharedArrayBuffer` is unavailable.

## Related Docs

- [audio-routing.md](audio-routing.md) — how to assemble audio graphs using the library's `connect()` / `input` protocol
- [docs/RELIABILITY.md](../RELIABILITY.md) — failure modes and AudioContext lifecycle
