// Web Audio API mock for jsdom test environment.
// Provides enough of the API surface to construct and exercise instruments.

function makeAudioParam(initial = 0) {
  let _value = initial;
  return {
    get value() { return _value; },
    set value(v) { _value = v; },
    setValueAtTime(v) { _value = v; return this; },
    linearRampToValueAtTime(v) { _value = v; return this; },
    exponentialRampToValueAtTime(v) { _value = v; return this; },
    setTargetAtTime(v) { _value = v; return this; },
    cancelScheduledValues() { return this; },
  };
}

function makeNode(extra = {}) {
  return {
    connect() { return this; },
    disconnect() {},
    ...extra,
  };
}

function makeGainNode() {
  return makeNode({ gain: makeAudioParam(1) });
}

function makeBiquadFilter() {
  return makeNode({
    type: "lowpass",
    frequency: makeAudioParam(350),
    Q: makeAudioParam(1),
    gain: makeAudioParam(0),
    detune: makeAudioParam(0),
  });
}

function makeOscillator() {
  return makeNode({
    type: "sine",
    frequency: makeAudioParam(440),
    detune: makeAudioParam(0),
    start() {},
    stop() {},
    addEventListener() {},
    removeEventListener() {},
  });
}

function makeWaveShaper() {
  return makeNode({ curve: null, oversample: "none" });
}

function makeBufferSource() {
  return makeNode({
    buffer: null,
    loop: false,
    playbackRate: makeAudioParam(1),
    start() {},
    stop() {},
  });
}

function makeConvolver() {
  return makeNode({ buffer: null, normalize: true });
}

function makeCompressor() {
  return makeNode({
    threshold: makeAudioParam(-24),
    knee: makeAudioParam(30),
    ratio: makeAudioParam(12),
    attack: makeAudioParam(0.003),
    release: makeAudioParam(0.25),
  });
}

function makeDelay() {
  return makeNode({ delayTime: makeAudioParam(0) });
}

function makeAnalyser() {
  return makeNode({
    fftSize: 256,
    frequencyBinCount: 128,
    getByteTimeDomainData() {},
    getByteFrequencyData() {},
  });
}

function makeStereoPanner() {
  return makeNode({ pan: makeAudioParam(0) });
}

function makeAudioBuffer(channels, length, sampleRate) {
  return {
    numberOfChannels: channels,
    length,
    sampleRate,
    getChannelData() { return new Float32Array(length); },
  };
}

class MockAudioContext {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 44100;
    this.state = "running";
    this.destination = makeNode();
  }
  createGain() { return makeGainNode(); }
  createBiquadFilter() { return makeBiquadFilter(); }
  createOscillator() { return makeOscillator(); }
  createWaveShaper() { return makeWaveShaper(); }
  createBufferSource() { return makeBufferSource(); }
  createConvolver() { return makeConvolver(); }
  createDynamicsCompressor() { return makeCompressor(); }
  createDelay() { return makeDelay(); }
  createAnalyser() { return makeAnalyser(); }
  createStereoPanner() { return makeStereoPanner(); }
  createMediaStreamSource() { return makeNode(); }
  createBuffer(channels, length, sampleRate) { return makeAudioBuffer(channels, length, sampleRate); }
  resume() { this.state = "running"; return Promise.resolve(); }
  suspend() { this.state = "suspended"; return Promise.resolve(); }
  close() { this.state = "closed"; return Promise.resolve(); }
  decodeAudioData(_buf, successCb) {
    const buf = makeAudioBuffer(1, this.sampleRate, this.sampleRate);
    if (successCb) successCb(buf);
    return Promise.resolve(buf);
  }
}

globalThis.AudioContext = MockAudioContext;

// Web Components stub — prevents customElements.define errors in non-DOM environments
if (!globalThis.customElements) {
  globalThis.customElements = {
    _registry: new Map(),
    define(name, cls) { this._registry.set(name, cls); },
    get(name) { return this._registry.get(name); },
  };
}
