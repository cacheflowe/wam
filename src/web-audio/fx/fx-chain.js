/**
 * FxChain — the per-channel effects chain, audio only (no DOM).
 *
 *   in → filter → delay → chorus → reverb → compressor (sidechain duck) → out
 *
 * Each stage handles its own dry/wet. Params are addressed by flat names
 * (`reverbWet`, `delayInterval`, `compThreshold`, …) via set()/get(), and the
 * whole chain round-trips through toJSON()/fromJSON() in the song format.
 *
 * <wam-fx-unit> is the UI for this chain; the headless song player uses it
 * directly (architecture-refactor Phase 1).
 *
 *   const fx = new FxChain(ctx, { bpm: 128, reverbWet: 0.15 });
 *   synth.connect(fx);
 *   fx.connect(ctx.destination);
 *   fx.set("delayMix", 0.3);
 *   fx.bpm = 140;
 */
import WebAudioFxReverb from "./fx-reverb.js";
import WebAudioFxDelay from "./fx-delay.js";
import WebAudioFxChorus from "./fx-chorus.js";
import WebAudioFxFilter from "./fx-filter.js";
import WebAudioFxCompressor from "./fx-compressor.js";

const CHORUS_SHAPES = ["sine", "triangle"];

export class FxChain {
  /** Tempo-sync release divisions, indexed by `compReleaseBeats`. `beats` = quarter-note beats. */
  static RELEASE_DIVISIONS = [
    { label: "1/1", beats: 4 },
    { label: "1/2", beats: 2 },
    { label: "1/4", beats: 1 },
    { label: "1/8", beats: 0.5 },
    { label: "1/8T", beats: 1 / 3 },
    { label: "1/16", beats: 0.25 },
  ];

  /**
   * @param {AudioContext} ctx
   * @param {object} [options]  initial params (same names as toJSON) + `bpm`
   */
  constructor(ctx, options = {}) {
    this.ctx = ctx;
    this._in = ctx.createGain();
    this._out = ctx.createGain();

    this.filter = new WebAudioFxFilter(ctx, {
      sweep: options.filterSweep ?? 0,
      q: options.filterQ ?? 0.7,
    });
    this.delay = new WebAudioFxDelay(ctx, {
      interval: options.delayInterval ?? 0.75,
      bpm: options.bpm ?? 120,
      feedback: options.delayFeedback ?? 0.35,
      wet: options.delayMix ?? 0,
      filterSweep: options.delayFilterSweep ?? 0,
      modulation: 0,
    });
    this.chorus = new WebAudioFxChorus(ctx, {
      voices: options.chorusVoices ?? 3,
      rate: options.chorusRate ?? 0.8,
      depth: options.chorusDepth ?? 0.5,
      delay: options.chorusDelay ?? 10,
      feedback: options.chorusFeedback ?? 0,
      wet: options.chorusWet ?? 0,
      spread: options.chorusSpread ?? 1,
      shape: options.chorusShape ?? "sine",
    });
    this.reverb = new WebAudioFxReverb(ctx, {
      decay: options.reverbDecay ?? 2.5,
      wet: options.reverbWet ?? 0,
      preDelay: options.reverbPreDelay ?? 0,
      hpFreq: options.reverbHpFreq ?? 80,
      lpFreq: options.reverbLpFreq ?? 8000,
      damping: options.reverbDamping ?? 0.5,
      width: options.reverbWidth ?? 1,
    });
    this.compressor = new WebAudioFxCompressor(ctx, {
      amount: options.compAmount ?? 0.7,
      attack: (options.compAttack ?? 10) / 1000,
      release: (options.compRelease ?? 200) / 1000,
      threshold: options.compThreshold ?? 0.1,
    });
    this._bpm = options.bpm ?? 120;
    this._compSync = (options.compSync ?? 0) >= 0.5;
    this._compReleaseBeats = options.compReleaseBeats ?? 3;
    this._compReleaseMs = options.compRelease ?? 200;

    this._in.connect(this.filter.input);
    this.filter.connect(this.delay.input);
    this.delay.connect(this.chorus.input);
    this.chorus.connect(this.reverb.input);
    this.reverb.connect(this.compressor.input);
    this.compressor.connect(this._out);
    this._applyCompRelease();
  }

  // ---- Routing ----

  get input() {
    return this._in;
  }

  connect(node) {
    this._out.connect(node.input ?? node);
    return this;
  }

  disconnect() {
    this._out.disconnect();
  }

  /** Key the sidechain ducker from another channel's tap (null = off). */
  setSidechainSource(tapNode) {
    this.compressor.setSidechainSource(tapNode);
  }

  /** Live gain-reduction callback (0..1) for a meter. */
  set onReduction(fn) {
    this.compressor.onReduction = fn;
  }

  destroy() {
    this.compressor?.destroy();
  }

  // ---- Tempo ----

  get bpm() {
    return this._bpm;
  }

  set bpm(v) {
    this._bpm = v;
    this.delay.bpm = v;
    if (this._compSync) this._applyCompRelease();
  }

  /** Compressor release from either the free (ms) or tempo-synced setting. */
  _applyCompRelease() {
    if (this._compSync) {
      const divs = FxChain.RELEASE_DIVISIONS;
      const div = divs[this._compReleaseBeats] ?? divs[3];
      this.compressor.release = Math.max(0.01, div.beats * (60 / (this._bpm || 120)));
    } else {
      this.compressor.release = this._compReleaseMs / 1000;
    }
  }

  // ---- Params ----

  /** Set one param by its flat name. Unknown names are ignored. */
  set(param, value) {
    switch (param) {
      case "reverbWet": this.reverb.wet = value; break;
      case "reverbPreDelay": this.reverb.preDelay = value; break;
      case "reverbHpFreq": this.reverb.hpFreq = value; break;
      case "reverbLpFreq": this.reverb.lpFreq = value; break;
      case "reverbDecay": this.reverb.decay = value; break;
      case "reverbDamping": this.reverb.damping = value; break;
      case "reverbWidth": this.reverb.width = value; break;
      case "delayFeedback": this.delay.feedback = value; break;
      case "delayMix": this.delay.wet = value; break;
      case "delayFilterSweep": this.delay.filterSweep = value; break;
      case "delayInterval": this.delay.interval = value; break;
      case "delayModulation": this.delay.modulation = value; break;
      case "chorusVoices": this.chorus.voices = Math.round(value); break;
      case "chorusRate": this.chorus.rate = value; break;
      case "chorusDepth": this.chorus.depth = value; break;
      case "chorusDelay": this.chorus.delay = value; break;
      case "chorusFeedback": this.chorus.feedback = value; break;
      case "chorusSpread": this.chorus.spread = value; break;
      case "chorusShape": this.chorus.shape = CHORUS_SHAPES[Math.round(value)] || "sine"; break;
      case "chorusWet": this.chorus.wet = value; break;
      case "filterSweep": this.filter.sweep = value; break;
      case "filterQ": this.filter.q = value; break;
      case "compAmount": this.compressor.amount = value; break;
      case "compAttack": this.compressor.attack = value / 1000; break;
      case "compRelease": this._compReleaseMs = value; this._applyCompRelease(); break;
      case "compSync": this._compSync = value >= 0.5; this._applyCompRelease(); break;
      case "compReleaseBeats": this._compReleaseBeats = Math.round(value); this._applyCompRelease(); break;
      case "compThreshold": this.compressor.threshold = value; break;
    }
  }

  /** All params as a flat object — the `fx` section of the song format. */
  toJSON() {
    return {
      reverbWet: this.reverb.wet ?? 0,
      reverbDecay: this.reverb.decay ?? 2.5,
      reverbPreDelay: this.reverb.preDelay ?? 0,
      reverbHpFreq: this.reverb.hpFreq ?? 80,
      reverbLpFreq: this.reverb.lpFreq ?? 8000,
      reverbDamping: this.reverb.damping ?? 0.5,
      reverbWidth: this.reverb.width ?? 1,
      delayInterval: this.delay.interval ?? 0.75,
      delayFeedback: this.delay.feedback ?? 0.35,
      delayMix: this.delay.wet ?? 0,
      delayFilterSweep: this.delay.filterSweep ?? 0,
      delayModulation: this.delay.modulation ?? 0,
      chorusVoices: this.chorus.voices ?? 3,
      chorusRate: this.chorus.rate ?? 0.8,
      chorusDepth: this.chorus.depth ?? 0.5,
      chorusDelay: this.chorus.delay ?? 10,
      chorusFeedback: this.chorus.feedback ?? 0,
      chorusWet: this.chorus.wet ?? 0,
      chorusSpread: this.chorus.spread ?? 1,
      chorusShape: CHORUS_SHAPES.indexOf(this.chorus.shape ?? "sine"),
      filterSweep: this.filter.sweep ?? 0,
      filterQ: this.filter.q ?? 0.7,
      compAmount: this.compressor.amount ?? 0.7,
      compAttack: Math.round((this.compressor.attack ?? 0.01) * 1000),
      compRelease: this._compReleaseMs ?? 200,
      compSync: this._compSync ? 1 : 0,
      compReleaseBeats: this._compReleaseBeats ?? 3,
      compThreshold: this.compressor.threshold ?? 0.1,
    };
  }

  /**
   * Normalize a saved `fx` object to current param names/values (legacy saves).
   * Returns { params, legacy } — `legacy` holds raw values with no current param.
   */
  static normalize(obj) {
    const params = { ...obj };
    const legacy = {};
    if (typeof params.chorusShape === "string") params.chorusShape = Math.max(0, CHORUS_SHAPES.indexOf(params.chorusShape));
    if (params.delayFilterSweep == null && params.delayFilterFreq != null) legacy.delayFilterFreq = params.delayFilterFreq;
    if (params.filterSweep == null) {
      if (params.lpFreq != null) legacy.lpFreq = params.lpFreq;
      if (params.hpFreq != null) legacy.hpFreq = params.hpFreq;
    }
    for (const k of ["delayFilterFreq", "lpFreq", "hpFreq", "compSourceId"]) delete params[k];
    return { params, legacy };
  }

  /** Apply legacy-only values (see normalize). */
  applyLegacy(legacy) {
    if (legacy.delayFilterFreq != null) this.delay.filterFreq = legacy.delayFilterFreq;
    if (legacy.lpFreq != null) this.filter.lpFreq = legacy.lpFreq;
    if (legacy.hpFreq != null) this.filter.hpFreq = legacy.hpFreq;
  }

  /** Restore from the song format (headless — the UI version also moves knobs). */
  fromJSON(obj) {
    if (!obj) return;
    const { params, legacy } = FxChain.normalize(obj);
    for (const [k, v] of Object.entries(params)) if (v != null) this.set(k, typeof v === "number" ? v : parseFloat(v));
    this.applyLegacy(legacy);
  }
}

export default FxChain;
