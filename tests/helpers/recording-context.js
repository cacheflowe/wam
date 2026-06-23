// Recording AudioContext mock — captures the exact automation a synth schedules.
//
// Every node creation, connection, and AudioParam operation is appended to an
// ordered string log. Two runs with identical inputs produce identical logs, so
// snapshotting the log of an instrument's trigger() pins its DSP behavior: any
// refactor that changes the scheduled sound changes the snapshot.
//
// Usage:
//   const { ctx, log } = createRecordingContext();
//   const synth = new WebAudioSynthMono(ctx, "Default");
//   log.length = 0;                 // ignore construction, capture only trigger
//   synth.trigger(60, 0.5, 1, 1);
//   expect(log).toMatchSnapshot();

function round(v) {
  if (typeof v !== "number" || !isFinite(v)) return v;
  return Number(v.toFixed(6));
}

function ref(target) {
  if (target == null) return "null";
  if (target.__paramId) return target.__paramId;
  if (target.__id) return target.__id;
  return "destination";
}

export function createRecordingContext() {
  const log = [];
  let nodeCounter = 0;

  function makeParam(ownerId, name, initial = 0) {
    const id = `${ownerId}.${name}`;
    let _value = initial;
    return {
      __paramId: id,
      get value() {
        return _value;
      },
      set value(v) {
        _value = v;
        log.push(`${id}.value=${round(v)}`);
      },
      setValueAtTime(v, t) {
        _value = v;
        log.push(`${id}.setValueAtTime(${round(v)},${round(t)})`);
        return this;
      },
      linearRampToValueAtTime(v, t) {
        _value = v;
        log.push(`${id}.linearRampToValueAtTime(${round(v)},${round(t)})`);
        return this;
      },
      exponentialRampToValueAtTime(v, t) {
        _value = v;
        log.push(`${id}.exponentialRampToValueAtTime(${round(v)},${round(t)})`);
        return this;
      },
      setTargetAtTime(v, t, tc) {
        _value = v;
        log.push(`${id}.setTargetAtTime(${round(v)},${round(t)},${round(tc)})`);
        return this;
      },
      setValueCurveAtTime(_curve, t, d) {
        log.push(`${id}.setValueCurveAtTime(len=${_curve?.length ?? 0},${round(t)},${round(d)})`);
        return this;
      },
      cancelScheduledValues(t) {
        log.push(`${id}.cancelScheduledValues(${round(t)})`);
        return this;
      },
    };
  }

  function makeNode(type, params = {}, extra = {}) {
    const id = `${type}#${nodeCounter++}`;
    const node = {
      __id: id,
      __type: type,
      connect(target, outIdx, inIdx) {
        const suffix = inIdx != null ? `,${outIdx},${inIdx}` : "";
        log.push(`${id}.connect(${ref(target)}${suffix})`);
        return target && target.__id ? target : node;
      },
      disconnect(target) {
        log.push(`${id}.disconnect(${target != null ? ref(target) : ""})`);
      },
      ...extra,
    };
    for (const [name, initial] of Object.entries(params)) {
      node[name] = makeParam(id, name, initial);
    }
    return node;
  }

  const oscExtra = () => ({
    type: "sine",
    start(t) {
      log.push(`${this.__id}.start(${round(t)})`);
    },
    stop(t) {
      log.push(`${this.__id}.stop(${round(t)})`);
    },
    addEventListener() {},
    removeEventListener() {},
    set onended(_fn) {},
    get onended() {
      return null;
    },
  });

  const srcExtra = () => ({
    buffer: null,
    loop: false,
    loopStart: 0,
    loopEnd: 0,
    start(t) {
      log.push(`${this.__id}.start(${round(t)})`);
    },
    stop(t) {
      log.push(`${this.__id}.stop(${round(t)})`);
    },
    addEventListener() {},
    set onended(_fn) {},
    get onended() {
      return null;
    },
  });

  const ctx = {
    currentTime: 0,
    sampleRate: 44100,
    state: "running",
    destination: makeNode("destination"),
    createGain: () => makeNode("gain", { gain: 1 }),
    createBiquadFilter: () =>
      makeNode("biquad", { frequency: 350, Q: 1, gain: 0, detune: 0 }, { type: "lowpass" }),
    createOscillator: () => makeNode("osc", { frequency: 440, detune: 0 }, oscExtra()),
    createConstantSource: () => makeNode("const", { offset: 1 }, oscExtra()),
    createWaveShaper: () => makeNode("shaper", {}, { curve: null, oversample: "none" }),
    createBufferSource: () => makeNode("bufsrc", { playbackRate: 1, detune: 0 }, srcExtra()),
    createConvolver: () => makeNode("convolver", {}, { buffer: null, normalize: true }),
    createDynamicsCompressor: () =>
      makeNode("comp", { threshold: -24, knee: 30, ratio: 12, attack: 0.003, release: 0.25 }),
    createDelay: () => makeNode("delay", { delayTime: 0 }),
    createStereoPanner: () => makeNode("panner", { pan: 0 }),
    createAnalyser: () =>
      makeNode("analyser", {}, { fftSize: 256, frequencyBinCount: 128, getByteTimeDomainData() {}, getByteFrequencyData() {} }),
    createBuffer: (channels, length, sampleRate) => ({
      numberOfChannels: channels,
      length,
      sampleRate,
      getChannelData: () => new Float32Array(length),
    }),
    resume: () => Promise.resolve(),
    suspend: () => Promise.resolve(),
  };

  return { ctx, log };
}
