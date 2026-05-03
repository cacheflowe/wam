/**
 * WebAudioFxChorus — multi-voice chorus with configurable modulation.
 *
 * Each voice is a modulated delay line: an LFO oscillates the delay time
 * around a base value, creating pitch/time variations that thicken the sound.
 * Multiple voices are phase-spread so their LFOs don't correlate, producing
 * a wider, richer effect.
 *
 * Audio chain (per voice):
 *   in → delay[v] → voiceGain → wetBus → out
 *         ↑
 *   lfo[v] → lfoGain[v] → delay[v].delayTime
 *
 *   in → dry → out
 *   wetBus → feedback → in  (optional feedback loop)
 *
 * Usage:
 *   const chorus = new WebAudioFxChorus(ctx, {
 *     voices: 3, rate: 1.2, depth: 0.6, delay: 12, feedback: 0.1, wet: 0.5,
 *   });
 *   synth.connect(chorus);
 *   chorus.connect(ctx.destination);
 */
export default class WebAudioFxChorus {
  /**
   * @param {AudioContext} ctx
   * @param {object} [options]
   * @param {number} [options.voices=3]       Number of chorus voices (1–6)
   * @param {number} [options.rate=0.8]       LFO rate in Hz (0.05–10)
   * @param {number} [options.depth=0.5]      LFO depth 0–1 (scaled to max ±depthMs)
   * @param {number} [options.depthMs=7]      Max delay sweep in ms (1–30)
   * @param {number} [options.delay=10]       Base delay in ms (1–50)
   * @param {number} [options.feedback=0]     Feedback 0–0.9 (0 = clean chorus, >0 = flanger)
   * @param {number} [options.shape='sine']   LFO waveform: sine, triangle
   * @param {number} [options.spread=1]       Stereo spread 0–1 (0 = mono, 1 = wide)
   * @param {number} [options.wet=0.5]        Wet mix 0–1
   */
  constructor(ctx, options = {}) {
    this.ctx = ctx;

    this._in = ctx.createGain();
    this._out = ctx.createGain();
    this._dry = ctx.createGain();
    this._wetBus = ctx.createGain();
    this._feedbackGain = ctx.createGain();

    // If stereo destination, use a channel merger for spread
    this._merger = ctx.createChannelMerger(2);
    this._monoWet = ctx.createGain(); // fallback mono wet path

    // in → dry → out
    this._in.connect(this._dry);
    this._dry.connect(this._out);
    this._dry.gain.value = 1;

    // wetBus → out (stereo or mono routed during _buildVoices)
    // feedback: wetBus → feedbackGain → in (re-enters delay lines)
    this._feedbackGain.gain.value = 0;
    this._wetBus.connect(this._feedbackGain);
    this._feedbackGain.connect(this._in);

    // Store params
    this._numVoices = Math.max(1, Math.min(6, options.voices ?? 3));
    this._rate = options.rate ?? 0.8;
    this._depthMs = options.depthMs ?? 7;
    this._depth = options.depth ?? 0.5;
    this._delayMs = options.delay ?? 10;
    this._shape = options.shape ?? "sine";
    this._spread = options.spread ?? 1;
    this._voices = [];

    this._buildVoices();

    this.wet = options.wet ?? 0.5;
    this.feedback = options.feedback ?? 0;
  }

  // ---- Voice management ----

  _buildVoices() {
    // Tear down existing voices
    for (const v of this._voices) {
      v.lfo.stop();
      v.lfo.disconnect();
      v.lfoGain.disconnect();
      v.delay.disconnect();
      v.gain.disconnect();
      if (v.panL) v.panL.disconnect();
      if (v.panR) v.panR.disconnect();
    }
    this._wetBus.disconnect(this._feedbackGain);
    this._monoWet.disconnect();
    try {
      this._merger.disconnect();
    } catch (_) {
      /* not connected */
    }
    this._voices = [];

    const n = this._numVoices;
    const baseDelaySec = this._delayMs / 1000;
    const maxSweep = (this._depthMs / 1000) * this._depth;
    const useStereo = this._spread > 0 && n > 1;

    for (let i = 0; i < n; i++) {
      // Delay — max time = base + sweep + margin
      const delay = this.ctx.createDelay(0.1);
      delay.delayTime.value = baseDelaySec;

      // LFO with phase offset — spread evenly across cycle
      const lfo = this.ctx.createOscillator();
      lfo.type = this._shape;
      lfo.frequency.value = this._rate;

      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = maxSweep;

      lfo.connect(lfoGain);
      lfoGain.connect(delay.delayTime);

      // Per-voice gain (normalize loudness)
      const gain = this.ctx.createGain();
      gain.gain.value = 1 / n;

      this._in.connect(delay);
      delay.connect(gain);

      // Stereo spread: pan voices across L/R
      let panL = null;
      let panR = null;
      if (useStereo) {
        panL = this.ctx.createGain();
        panR = this.ctx.createGain();
        const pan = n > 1 ? ((i / (n - 1)) * 2 - 1) * this._spread : 0; // -1..1
        // Equal-power panning
        const angle = ((pan + 1) * Math.PI) / 4; // 0..π/2
        panL.gain.value = Math.cos(angle);
        panR.gain.value = Math.sin(angle);
        gain.connect(panL);
        gain.connect(panR);
        panL.connect(this._merger, 0, 0); // left channel
        panR.connect(this._merger, 0, 1); // right channel
      } else {
        gain.connect(this._wetBus);
      }

      // Phase spread via micro-detune: each voice's LFO runs at a slightly
      // different frequency so they drift in and out of phase over time,
      // producing genuine chorus spread. ±10% spread across n voices.
      const detuneFactor = n > 1 ? 1 + 0.1 * ((i / (n - 1)) * 2 - 1) : 1;
      lfo.frequency.value = this._rate * detuneFactor;

      // Seed each voice at a different point in its cycle by offsetting the
      // initial delay time (best approximation without true phase control).
      delay.delayTime.setValueAtTime(baseDelaySec + maxSweep * Math.sin((2 * Math.PI * i) / n), this.ctx.currentTime);
      lfo.start();

      this._voices.push({ delay, lfo, lfoGain, gain, panL, panR });
    }

    if (useStereo) {
      this._merger.connect(this._wetBus);
    }

    // Re-connect wetBus → feedback + output
    this._wetBus.connect(this._feedbackGain);
    this._wetBus.connect(this._out);
  }

  // ---- Properties ----

  get voices() {
    return this._numVoices;
  }
  set voices(v) {
    const clamped = Math.max(1, Math.min(6, Math.round(v)));
    if (clamped === this._numVoices) return;
    this._numVoices = clamped;
    this._buildVoices();
  }

  get rate() {
    return this._rate;
  }
  set rate(v) {
    this._rate = Math.max(0.05, Math.min(10, v));
    const n = this._voices.length;
    this._voices.forEach((voice, i) => {
      const detuneFactor = n > 1 ? 1 + 0.1 * ((i / (n - 1)) * 2 - 1) : 1;
      voice.lfo.frequency.value = this._rate * detuneFactor;
    });
  }

  get depth() {
    return this._depth;
  }
  set depth(v) {
    this._depth = Math.max(0, Math.min(1, v));
    const sweep = (this._depthMs / 1000) * this._depth;
    for (const voice of this._voices) voice.lfoGain.gain.value = sweep;
  }

  get depthMs() {
    return this._depthMs;
  }
  set depthMs(v) {
    this._depthMs = Math.max(1, Math.min(30, v));
    const sweep = (this._depthMs / 1000) * this._depth;
    for (const voice of this._voices) voice.lfoGain.gain.value = sweep;
  }

  get delay() {
    return this._delayMs;
  }
  set delay(v) {
    this._delayMs = Math.max(1, Math.min(50, v));
    const sec = this._delayMs / 1000;
    for (const voice of this._voices) voice.delay.delayTime.value = sec;
  }

  get feedback() {
    return this._feedbackGain.gain.value;
  }
  set feedback(v) {
    this._feedbackGain.gain.value = Math.max(0, Math.min(0.9, v));
  }

  get wet() {
    return this._wetBus.gain.value;
  }
  set wet(v) {
    this._wetBus.gain.value = Math.max(0, Math.min(1, v));
  }

  get shape() {
    return this._shape;
  }
  set shape(v) {
    this._shape = v;
    for (const voice of this._voices) voice.lfo.type = v;
  }

  get spread() {
    return this._spread;
  }
  set spread(v) {
    this._spread = Math.max(0, Math.min(1, v));
    // Spread requires voice rebuild for pan recalculation
    this._buildVoices();
  }

  // ---- Routing ----

  get input() {
    return this._in;
  }

  connect(node) {
    this._out.connect(node.input ?? node);
    return this;
  }
}
