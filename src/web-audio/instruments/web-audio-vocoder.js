import WebAudioInstrumentBase from "../web-audio-instrument-base.js";

/**
 * WebAudioVocoder — 16-band phase vocoder with mic input.
 *
 * Architecture per band:
 *   Modulator:  micSource → inputGain → modBP[i] → absShaper → envLP[i]
 *                                                                      ↓ (AudioParam)
 *   Carrier:    carrierBus → synBP[i] → bandGain[i] ─────────────────→ outputMixer
 *
 * Call startMic() to request microphone access, then play() to enable the carrier.
 * The vocoder only produces sound when both mic and carrier are active.
 */
export default class WebAudioVocoder {
  static BAND_COUNT = 16;
  static F_LOW = 80;
  static F_HIGH = 8000;

  constructor(ctx) {
    this.ctx = ctx;
    this._out = ctx.createGain();
    this._out.gain.value = 0.8;

    // State
    this._micSource = null;
    this._micStream = null;
    this._running = false;
    this._carrierStarted = false;
    this._bands = [];

    // Scalar properties (setters update live nodes after _buildGraph)
    this._sensitivity = 10;
    this._envSpeed = 20;
    this._filterQ = 3.5;
    this._formantShift = 0;
    this._carrierType = "sawtooth";
    this._carrierFreq = 220;

    this._buildGraph();
  }

  // ---- Public API ----

  get volume()  { return this._out.gain.value; }
  set volume(v) { this._out.gain.value = v; }

  get input()   { return this._out; }

  connect(node) {
    this._out.connect(node.input ?? node);
    return this;
  }

  /** Request mic access and wire it into the analysis chain. */
  async startMic() {
    if (this._micSource) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this._micStream = stream;
    this._micSource = this.ctx.createMediaStreamSource(stream);
    this._micSource.connect(this._inputGain);
    return stream;
  }

  stopMic() {
    if (this._micSource) { this._micSource.disconnect(); this._micSource = null; }
    if (this._micStream) { this._micStream.getTracks().forEach(t => t.stop()); this._micStream = null; }
  }

  get micActive() { return !!this._micSource; }

  /** Enable carrier output. */
  play() {
    if (this._running) return;
    this._running = true;
    if (!this._carrierStarted) {
      this._carrierStarted = true;
      this._carrierOsc.start();
      this._noiseSource.start();
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    this._carrierBus.gain.setTargetAtTime(1, this.ctx.currentTime, 0.02);
  }

  /** Silence carrier output (keeps mic active). */
  stop() {
    this._running = false;
    this._carrierBus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
  }

  get playing() { return this._running; }

  // ---- Properties with live node updates ----

  get carrierFreq() { return this._carrierFreq; }
  set carrierFreq(hz) {
    this._carrierFreq = hz;
    if (this._carrierOsc) this._carrierOsc.frequency.setTargetAtTime(hz, this.ctx.currentTime, 0.01);
  }

  get carrierType() { return this._carrierType; }
  set carrierType(v) {
    this._carrierType = v;
    if (!this._carrierOsc) return;
    if (v === "noise") {
      this._oscGain.gain.value = 0;
      this._noiseGain.gain.value = 1;
    } else {
      this._oscGain.gain.value = 1;
      this._noiseGain.gain.value = 0;
      this._carrierOsc.type = v;
    }
  }

  get sensitivity() { return this._sensitivity; }
  set sensitivity(v) {
    this._sensitivity = v;
    if (this._inputGain) this._inputGain.gain.value = v;
  }

  get envSpeed() { return this._envSpeed; }
  set envSpeed(v) {
    this._envSpeed = v;
    for (const b of this._bands) b.envLP.frequency.value = v;
  }

  get filterQ() { return this._filterQ; }
  set filterQ(v) {
    this._filterQ = v;
    for (const b of this._bands) {
      b.modBP.Q.value = v;
      b.synBP.Q.value = v;
    }
  }

  /** Formant shift in semitones — shifts synthesis bands relative to analysis bands. */
  get formantShift() { return this._formantShift; }
  set formantShift(semitones) {
    this._formantShift = semitones;
    const freqs = this._computeFreqs();
    const ratio = Math.pow(2, semitones / 12);
    for (let i = 0; i < this._bands.length; i++) {
      this._bands[i].synBP.frequency.value = Math.min(freqs[i] * ratio, this.ctx.sampleRate / 2);
    }
  }

  // ---- DSP graph ----

  _buildGraph() {
    const ctx = this.ctx;
    const n = WebAudioVocoder.BAND_COUNT;
    const freqs = this._computeFreqs();
    const absCurve = this._makeAbsCurve();

    // Modulator input gain — user-controlled sensitivity
    this._inputGain = ctx.createGain();
    this._inputGain.gain.value = this._sensitivity;

    // Carrier bus — gated by play/stop
    this._carrierBus = ctx.createGain();
    this._carrierBus.gain.value = 0;

    // Output mixer — level-compensates for N bands
    const outputMixer = ctx.createGain();
    outputMixer.gain.value = 1 / Math.sqrt(n);
    outputMixer.connect(this._out);

    // Build filter bank
    this._bands = [];
    for (let i = 0; i < n; i++) {
      const freq = freqs[i];

      // Analysis chain (modulator)
      const modBP = ctx.createBiquadFilter();
      modBP.type = "bandpass";
      modBP.frequency.value = freq;
      modBP.Q.value = this._filterQ;

      const absShaper = ctx.createWaveShaper();
      absShaper.curve = absCurve;
      absShaper.oversample = "2x";

      const envLP = ctx.createBiquadFilter();
      envLP.type = "lowpass";
      envLP.frequency.value = this._envSpeed;

      // Synthesis chain (carrier)
      const synBP = ctx.createBiquadFilter();
      synBP.type = "bandpass";
      synBP.frequency.value = freq;
      synBP.Q.value = this._filterQ;

      const bandGain = ctx.createGain();
      bandGain.gain.value = 0;

      // Wire modulator chain
      this._inputGain.connect(modBP);
      modBP.connect(absShaper);
      absShaper.connect(envLP);
      envLP.connect(bandGain.gain); // modulates carrier band amplitude

      // Wire synthesis chain
      this._carrierBus.connect(synBP);
      synBP.connect(bandGain);
      bandGain.connect(outputMixer);

      this._bands.push({ modBP, synBP, absShaper, envLP, bandGain, freq });
    }

    // Carrier oscillator
    this._carrierOsc = ctx.createOscillator();
    this._carrierOsc.type = "sawtooth";
    this._carrierOsc.frequency.value = this._carrierFreq;
    this._oscGain = ctx.createGain();
    this._oscGain.gain.value = 1;
    this._carrierOsc.connect(this._oscGain);
    this._oscGain.connect(this._carrierBus);

    // Noise carrier (looping buffer)
    this._noiseSource = ctx.createAudioBufferSource();
    this._noiseSource.buffer = this._makeNoiseBuffer();
    this._noiseSource.loop = true;
    this._noiseGain = ctx.createGain();
    this._noiseGain.gain.value = 0;
    this._noiseSource.connect(this._noiseGain);
    this._noiseGain.connect(this._carrierBus);
  }

  _computeFreqs() {
    const n = WebAudioVocoder.BAND_COUNT;
    const { F_LOW, F_HIGH } = WebAudioVocoder;
    return Array.from({ length: n }, (_, i) => F_LOW * Math.pow(F_HIGH / F_LOW, i / (n - 1)));
  }

  _makeAbsCurve(size = 256) {
    const curve = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      curve[i] = Math.abs((i / (size - 1)) * 2 - 1);
    }
    return curve;
  }

  _makeNoiseBuffer() {
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  destroy() {
    this.stop();
    this.stopMic();
    this._carrierOsc?.disconnect();
    this._noiseSource?.disconnect();
  }
}
