/**
 * WebAudioFxUnit — reusable effects web component (reverb + delay + chorus + filter).
 *
 * Composed from standalone FX classes:
 *   - WebAudioFxReverb     (convolution reverb with wet/dry)
 *   - WebAudioFxDelay      (dub-style delay with BPM sync, feedback filter, LFO)
 *   - WebAudioFxChorus     (multi-voice chorus with stereo spread)
 *   - WebAudioFxFilter     (combined HP + LP with shared Q)
 *   - WebAudioFxCompressor (sidechain ducking compressor — off until a source is picked)
 *
 * Audio chain (serial):
 *   in → filter → delay → chorus → reverb → compressor → out
 * Each stage handles its own dry/wet internally.
 *
 * Usage:
 *   const fx = document.createElement("wam-fx-unit");
 *   parentEl.appendChild(fx);
 *   fx.init(ctx, { bpm: 128, reverbWet: 0.15, delayInterval: 0.75 });
 *   synth.connect(fx);
 *   fx.connect(ctx.destination);
 *   fx.bpm = 140; // live BPM update
 */

import WebAudioFxReverb from "./fx-reverb.js";
import WebAudioFxDelay from "./fx-delay.js";
import WebAudioFxChorus from "./fx-chorus.js";
import WebAudioFxFilter from "./fx-filter.js";
import WebAudioFxCompressor from "./fx-compressor.js";
import "../ui/slider.js";
import "../ui/filter-sweep.js";
import "../ui/instrument-source-picker.js";
import { injectControlsCSS, createSection, createCtrl } from "../ui/slider.js";

export default class WebAudioFxUnit extends HTMLElement {
  static #cssInjected = false;

  // Tempo-sync release divisions, indexed by the "compReleaseBeats" knob.
  // `beats` = length in quarter-note beats.
  static RELEASE_DIVISIONS = [
    { label: "1/1", beats: 4 },
    { label: "1/2", beats: 2 },
    { label: "1/4", beats: 1 },
    { label: "1/8", beats: 0.5 },
    { label: "1/8T", beats: 1 / 3 },
    { label: "1/16", beats: 0.25 },
  ];

  constructor() {
    super();
    this._ctx = null;
    this._in = null;
    this._out = null;
    this._reverb = null;
    this._delay = null;
    this._chorus = null;
    this._filter = null;
    this._compressor = null;
    this._sidechainPicker = null;
  }

  /**
   * @param {AudioContext} ctx
   * @param {object} [options]
   * @param {string}  [options.title="FX"]
   * @param {number}  [options.bpm=120]
   * @param {number}  [options.reverbDecay=2.5]
   * @param {number}  [options.reverbWet=0]
   * @param {number}  [options.reverbPreDelay=0]    ms (0–80)
   * @param {number}  [options.reverbHpFreq=80]     Hz
   * @param {number}  [options.reverbLpFreq=8000]   Hz
   * @param {number}  [options.delayInterval=0.75]   beat multiplier
   * @param {number}  [options.delayFeedback=0.35]
   * @param {number}  [options.delayMix=0]
   * @param {number}  [options.delayFilterSweep=0]    Bipolar -1..+1 (LP←0→HP) for feedback filter
   * @param {number}  [options.chorusVoices=3]
   * @param {number}  [options.chorusRate=0.8]
   * @param {number}  [options.chorusDepth=0.5]
   * @param {number}  [options.chorusDelay=10]
   * @param {number}  [options.chorusFeedback=0]
   * @param {number}  [options.chorusWet=0]
   * @param {number}  [options.chorusSpread=1]
   * @param {number}  [options.chorusShape='sine']
   * @param {number}  [options.filterSweep=0]  Bipolar sweep -1..+1 (LP←0→HP)
   * @param {number}  [options.filterQ=0.7]
   * @param {number}  [options.compAmount=0.7]     Sidechain duck depth (0–1)
   * @param {number}  [options.compAttack=10]      Sidechain attack (ms)
   * @param {number}  [options.compRelease=200]    Sidechain release (ms, used when Sync off)
   * @param {number}  [options.compSync=0]         Tempo-sync release (0/1)
   * @param {number}  [options.compReleaseBeats=3] Synced release division index (see RELEASE_DIVISIONS)
   * @param {number}  [options.compThreshold=0.1]  Key level (0–1) at which ducking begins
   */
  init(ctx, options = {}) {
    this._ctx = ctx;

    // ---- Audio chain (serial: filter → delay → chorus → reverb) ----
    this._in = ctx.createGain();
    this._out = ctx.createGain();

    this._filter = new WebAudioFxFilter(ctx, {
      sweep: options.filterSweep ?? 0,
      q: options.filterQ ?? 0.7,
    });

    this._delay = new WebAudioFxDelay(ctx, {
      interval: options.delayInterval ?? 0.75,
      bpm: options.bpm ?? 120,
      feedback: options.delayFeedback ?? 0.35,
      wet: options.delayMix ?? 0,
      filterSweep: options.delayFilterSweep ?? 0,
      modulation: 0,
    });

    this._chorus = new WebAudioFxChorus(ctx, {
      voices: options.chorusVoices ?? 3,
      rate: options.chorusRate ?? 0.8,
      depth: options.chorusDepth ?? 0.5,
      delay: options.chorusDelay ?? 10,
      feedback: options.chorusFeedback ?? 0,
      wet: options.chorusWet ?? 0,
      spread: options.chorusSpread ?? 1,
      shape: options.chorusShape ?? "sine",
    });

    this._reverb = new WebAudioFxReverb(ctx, {
      decay: options.reverbDecay ?? 2.5,
      wet: options.reverbWet ?? 0,
      preDelay: options.reverbPreDelay ?? 0,
      hpFreq: options.reverbHpFreq ?? 80,
      lpFreq: options.reverbLpFreq ?? 8000,
      damping: options.reverbDamping ?? 0.5,
      width: options.reverbWidth ?? 1,
    });

    this._compressor = new WebAudioFxCompressor(ctx, {
      amount: options.compAmount ?? 0.7,
      attack: (options.compAttack ?? 10) / 1000,
      release: (options.compRelease ?? 200) / 1000,
      threshold: options.compThreshold ?? 0.1,
    });
    this._bpm = options.bpm ?? 120;
    this._compSync = (options.compSync ?? 0) >= 0.5;
    this._compReleaseBeats = options.compReleaseBeats ?? 3;
    this._compReleaseMs = options.compRelease ?? 200;

    this._in.connect(this._filter.input);
    this._filter.connect(this._delay.input);
    this._delay.connect(this._chorus.input);
    this._chorus.connect(this._reverb.input);
    this._reverb.connect(this._compressor.input);
    this._compressor.connect(this._out);

    // ---- UI ----
    WebAudioFxUnit._injectCSS();
    this._buildUI(options);
  }

  // ---- Properties ----

  set bpm(v) {
    this._bpm = v;
    if (this._delay) this._delay.bpm = v;
    if (this._compSync) this._applyCompRelease();
  }

  /** Apply the compressor release time from either the free (ms) or tempo-synced setting. */
  _applyCompRelease() {
    if (!this._compressor) return;
    if (this._compSync) {
      const divs = WebAudioFxUnit.RELEASE_DIVISIONS;
      const div = divs[this._compReleaseBeats] ?? divs[3];
      const secPerBeat = 60 / (this._bpm || 120);
      this._compressor.release = Math.max(0.01, div.beats * secPerBeat);
    } else {
      this._compressor.release = this._compReleaseMs / 1000;
    }
  }

  // ---- Routing ----

  get input() {
    return this._in;
  }

  connect(node) {
    this._out.connect(node.input ?? node);
    return this;
  }

  /** Hide a bus instance from the sidechain source picker (the host track, to avoid self-feedback). */
  setSidechainHostId(id) {
    if (this._sidechainPicker) this._sidechainPicker.excludeId = id;
  }

  /** Tear down internal nodes. Called when the host channel is removed. */
  destroy() {
    this._compressor?.destroy();
  }

  // ---- Serialization ----

  toJSON() {
    return {
      reverbWet: this._reverb?.wet ?? 0,
      reverbDecay: this._reverb?.decay ?? 2.5,
      reverbPreDelay: this._reverb?.preDelay ?? 0,
      reverbHpFreq: this._reverb?.hpFreq ?? 80,
      reverbLpFreq: this._reverb?.lpFreq ?? 8000,
      reverbDamping: this._reverb?.damping ?? 0.5,
      reverbWidth: this._reverb?.width ?? 1,
      delayInterval: this._delay?.interval ?? 0.75,
      delayFeedback: this._delay?.feedback ?? 0.35,
      delayMix: this._delay?.wet ?? 0,
      delayFilterSweep: this._delay?.filterSweep ?? 0,
      delayModulation: this._delay?.modulation ?? 0,
      chorusVoices: this._chorus?.voices ?? 3,
      chorusRate: this._chorus?.rate ?? 0.8,
      chorusDepth: this._chorus?.depth ?? 0.5,
      chorusDelay: this._chorus?.delay ?? 10,
      chorusFeedback: this._chorus?.feedback ?? 0,
      chorusWet: this._chorus?.wet ?? 0,
      chorusSpread: this._chorus?.spread ?? 1,
      chorusShape: ["sine", "triangle"].indexOf(this._chorus?.shape ?? "sine"),
      filterSweep: this._filter?.sweep ?? 0,
      filterQ: this._filter?.q ?? 0.7,
      compAmount: this._compressor?.amount ?? 0.7,
      compAttack: Math.round((this._compressor?.attack ?? 0.01) * 1000),
      compRelease: this._compReleaseMs ?? 200,
      compSync: this._compSync ? 1 : 0,
      compReleaseBeats: this._compReleaseBeats ?? 3,
      compThreshold: this._compressor?.threshold ?? 0.1,
      compSourceId: this._sidechainPicker?.value ?? null,
    };
  }

  fromJSON(obj) {
    if (!obj) return;

    /** Set a knob value and dispatch its event so handleFxInput applies the change. */
    const restore = (param, value, selector) => {
      if (value == null) return;
      const s = this.querySelector(selector || `wam-knob[param="${param}"]`);
      if (s) {
        s.value = value;
        s.dispatchEvent(
          new CustomEvent("knob-input", {
            bubbles: true,
            detail: { param, value: typeof value === "number" ? value : parseFloat(value) },
          }),
        );
      }
    };

    // Reverb
    restore("reverbWet", obj.reverbWet);
    restore("reverbPreDelay", obj.reverbPreDelay);
    restore("reverbHpFreq", obj.reverbHpFreq);
    restore("reverbLpFreq", obj.reverbLpFreq);
    restore("reverbDecay", obj.reverbDecay);
    restore("reverbDamping", obj.reverbDamping);
    restore("reverbWidth", obj.reverbWidth);

    // Delay
    restore("delayInterval", obj.delayInterval);
    restore("delayFeedback", obj.delayFeedback);
    restore("delayMix", obj.delayMix);
    restore("delayModulation", obj.delayModulation);
    if (obj.delayFilterSweep != null) {
      restore("delayFilterSweep", obj.delayFilterSweep, 'wam-filter-sweep[param="delayFilterSweep"]');
    } else if (obj.delayFilterFreq != null && this._delay) {
      // backwards-compat: old saves stored raw LP frequency
      this._delay.filterFreq = obj.delayFilterFreq;
    }

    // Chorus
    restore("chorusVoices", obj.chorusVoices);
    restore("chorusRate", obj.chorusRate);
    restore("chorusDepth", obj.chorusDepth);
    restore("chorusDelay", obj.chorusDelay);
    restore("chorusFeedback", obj.chorusFeedback);
    restore("chorusWet", obj.chorusWet);
    restore("chorusSpread", obj.chorusSpread);
    if (obj.chorusShape != null) {
      // backwards-compat: old saves stored string, new saves store index
      const shapes = ["sine", "triangle"];
      const idx = typeof obj.chorusShape === "string" ? Math.max(0, shapes.indexOf(obj.chorusShape)) : obj.chorusShape;
      restore("chorusShape", idx);
    }

    // Filter
    if (obj.filterSweep != null) {
      restore("filterSweep", obj.filterSweep, "wam-filter-sweep");
    } else {
      // backwards-compat: old saves had separate lpFreq/hpFreq
      if (obj.lpFreq != null && this._filter) this._filter.lpFreq = obj.lpFreq;
      if (obj.hpFreq != null && this._filter) this._filter.hpFreq = obj.hpFreq;
    }
    restore("filterQ", obj.filterQ);

    // Sidechain compressor
    restore("compAmount", obj.compAmount);
    restore("compAttack", obj.compAttack);
    restore("compRelease", obj.compRelease);
    restore("compSync", obj.compSync);
    restore("compReleaseBeats", obj.compReleaseBeats);
    restore("compThreshold", obj.compThreshold);
    if (obj.compSourceId != null) {
      // Defer: the instrument bus may not be populated yet on load.
      setTimeout(() => {
        if (!this._sidechainPicker) return;
        this._sidechainPicker.value = obj.compSourceId;
        const tap = this._sidechainPicker.tapNode;
        if (tap) this._compressor?.setSidechainSource(tap);
      }, 0);
    }
  }

  // ---- UI ----

  _buildUI(options) {
    this.innerHTML = "";
    injectControlsCSS();

    // ---- Filter ----
    const { el: filtEl, controls: filtCtrl } = createSection("Filter");
    const sweep = document.createElement("wam-filter-sweep");
    sweep.setAttribute("param", "filterSweep");
    sweep.setAttribute("label", "Sweep");
    sweep.setAttribute(
      "data-tooltip",
      "Combined HP+LP filter sweep. Left = cut lows, right = cut highs, center = bypass.",
    );
    sweep.value = options.filterSweep ?? 0;
    filtCtrl.appendChild(sweep);
    filtCtrl.appendChild(
      this._addSlider("filterQ", "Q", 0.5, 15, 0.1, options.filterQ ?? 0.7, {
        tooltip: "Filter resonance. Higher values add a peak at the cutoff, creating a sharper, more nasal tone.",
      }),
    );
    this.appendChild(filtEl);

    // ---- Delay ----
    const { el: delEl, controls: delCtrl } = createSection("Delay");
    delCtrl.appendChild(
      this._addSlider("delayMix", "Mix", 0, 1, 0.01, options.delayMix ?? 0, {
        tooltip: "Delay wet/dry mix. 0 = dry only, 1 = delay only.",
      }),
    );
    delCtrl.appendChild(
      this._addSlider("delayInterval", "Interval", 0.25, 2, 0.25, options.delayInterval ?? 0.75, {
        tooltip: "Delay time as a rhythmic fraction. Syncs to the current BPM.",
      }),
    );
    delCtrl.appendChild(
      this._addSlider("delayFeedback", "Feedbk", 0, 0.9, 0.01, options.delayFeedback ?? 0.35, {
        tooltip: "How much of the delay output feeds back into the input. High values = long, cascading repeats.",
      }),
    );
    const delayFilterSweep = document.createElement("wam-filter-sweep");
    delayFilterSweep.setAttribute("param", "delayFilterSweep");
    delayFilterSweep.setAttribute("label", "Dub Filt");
    delayFilterSweep.setAttribute(
      "data-tooltip",
      "Filter applied to the delay feedback path. Creates dub-style filtered echoes.",
    );
    delayFilterSweep.value = options.delayFilterSweep ?? 0;
    delCtrl.appendChild(delayFilterSweep);
    delCtrl.appendChild(
      this._addSlider("delayModulation", "Mod", 0, 1, 0.01, 0, {
        tooltip: "LFO modulation depth on the delay time. Adds a chorus-like pitch wobble to the echoes.",
      }),
    );
    this.appendChild(delEl);

    // ---- Chorus ----
    const { el: chorEl, controls: chorCtrl } = createSection("Chorus");
    chorCtrl.appendChild(
      this._addSlider("chorusWet", "Wet", 0, 1, 0.01, options.chorusWet ?? 0, {
        tooltip: "Chorus wet/dry mix. 0 = dry, 1 = full chorus effect.",
      }),
    );
    chorCtrl.appendChild(
      this._addSlider("chorusVoices", "Voices", 1, 6, 1, options.chorusVoices ?? 3, {
        tooltip: "Number of chorus voices. More voices = thicker, denser modulation.",
      }),
    );
    const CHORUS_SHAPES = ["sine", "triangle"];
    const shapeIdx = CHORUS_SHAPES.indexOf(options.chorusShape ?? "sine");
    chorCtrl.appendChild(
      this._addSlider("chorusShape", "Shape", 0, 1, 1, Math.max(0, shapeIdx), {
        tooltip: "LFO waveform. 0 = sine (smooth sweep), 1 = triangle (slightly sharper).",
      }),
    );
    chorCtrl.appendChild(
      this._addSlider("chorusRate", "Rate", 0.05, 10, 0.01, options.chorusRate ?? 0.8, {
        scale: "log",
        tooltip: "LFO speed in Hz. Slow = gentle shimmer, fast = vibrato-like wobble.",
      }),
    );
    chorCtrl.appendChild(
      this._addSlider("chorusDepth", "Depth", 0, 1, 0.01, options.chorusDepth ?? 0.5, {
        tooltip: "Amount of pitch modulation per voice. Higher = more pronounced detuning.",
      }),
    );
    chorCtrl.appendChild(
      this._addSlider("chorusDelay", "Delay", 1, 50, 0.1, options.chorusDelay ?? 10, {
        tooltip: "Base delay offset per voice in ms. Longer = more spacious, wider stereo image.",
      }),
    );
    chorCtrl.appendChild(
      this._addSlider("chorusFeedback", "Feedbk", 0, 0.9, 0.01, options.chorusFeedback ?? 0, {
        tooltip: "Feedback within chorus voices. Higher values add resonance and metallic coloring.",
      }),
    );
    chorCtrl.appendChild(
      this._addSlider("chorusSpread", "Spread", 0, 1, 0.01, options.chorusSpread ?? 1, {
        tooltip: "Stereo spread of chorus voices. 0 = mono, 1 = full stereo width.",
      }),
    );
    this.appendChild(chorEl);

    // ---- Reverb ----
    const { el: revEl, controls: revCtrl } = createSection("Reverb");
    revCtrl.appendChild(
      this._addSlider("reverbWet", "Wet", 0, 1, 0.01, options.reverbWet ?? 0, {
        tooltip: "Reverb wet/dry mix. 0 = dry, 1 = reverb only.",
      }),
    );
    revCtrl.appendChild(
      this._addSlider("reverbDecay", "Decay", 0.1, 8, 0.1, options.reverbDecay ?? 2.5, {
        tooltip: "Reverb tail length in seconds. Longer = larger room.",
      }),
    );
    revCtrl.appendChild(
      this._addSlider("reverbDamping", "Damping", 0, 1, 0.01, options.reverbDamping ?? 0.5, {
        tooltip: "High-frequency decay rate in the tail. Higher = darker, warmer room. Lower = bright, shimmery.",
      }),
    );
    revCtrl.appendChild(
      this._addSlider("reverbWidth", "Width", 0, 1, 0.01, options.reverbWidth ?? 1, {
        tooltip: "Stereo width of the reverb. 0 = mono, 1 = full stereo spread.",
      }),
    );
    revCtrl.appendChild(
      this._addSlider("reverbPreDelay", "Pre-dly", 0, 80, 1, options.reverbPreDelay ?? 0, {
        tooltip: "Pre-delay before the reverb tail in ms. Adds space between the source and its reflections.",
      }),
    );
    revCtrl.appendChild(
      this._addSlider("reverbHpFreq", "HP", 20, 800, 1, options.reverbHpFreq ?? 80, {
        scale: "log",
        tooltip: "High-pass filter on the reverb output. Cuts muddy low frequencies from the tail.",
      }),
    );
    revCtrl.appendChild(
      this._addSlider("reverbLpFreq", "LP", 2000, 20000, 1, options.reverbLpFreq ?? 8000, {
        scale: "log",
        tooltip: "Low-pass filter on the reverb output. Lower = darker, warmer tail.",
      }),
    );
    this.appendChild(revEl);

    // ---- Sidechain compressor ----
    const { el: scEl, controls: scCtrl } = createSection("Sidechain");
    const srcWrap = createCtrl("Source", {
      wide: true,
      tooltip: "Track whose level ducks this channel. Off until a source is selected — pick a kick for a classic pump.",
    });
    this._sidechainPicker = document.createElement("wam-instrument-source-picker");
    srcWrap.appendChild(this._sidechainPicker);
    scCtrl.appendChild(srcWrap);
    scCtrl.appendChild(
      this._addSlider("compAmount", "Amount", 0, 1, 0.01, options.compAmount ?? 0.7, {
        tooltip: "How much the volume ducks. 0 = no effect, 1 = full duck to silence.",
      }),
    );
    scCtrl.appendChild(
      this._addSlider("compAttack", "Attack", 1, 200, 1, options.compAttack ?? 10, {
        scale: "log",
        tooltip: "How fast the duck engages, in ms. Short = snappy pump.",
      }),
    );
    scCtrl.appendChild(
      this._addSlider("compRelease", "Release", 10, 1500, 1, options.compRelease ?? 200, {
        scale: "log",
        tooltip: "How fast the volume returns, in ms. Used when Sync is off. Longer = smoother pump.",
      }),
    );
    scCtrl.appendChild(
      this._addSlider("compSync", "Sync", 0, 1, 1, options.compSync ?? 0, {
        tooltip: "Tempo-sync the release. 0 = free (Release ms), 1 = locked to the Div beat division.",
      }),
    );
    scCtrl.appendChild(
      this._addSlider("compReleaseBeats", "Div", 0, 5, 1, options.compReleaseBeats ?? 3, {
        tooltip: "Release as a beat division when Sync is on: 0=1/1, 1=1/2, 2=1/4, 3=1/8, 4=1/8T, 5=1/16.",
      }),
    );
    scCtrl.appendChild(
      this._addSlider("compThreshold", "Thresh", 0, 1, 0.01, options.compThreshold ?? 0.1, {
        tooltip: "Source level at which ducking begins. Lower = ducks on quieter hits.",
      }),
    );

    // Live gain-reduction meter
    const grWrap = createCtrl("Reduction", {
      wide: true,
      tooltip: "Live gain reduction — how much this channel is currently ducking.",
    });
    this._grMeter = document.createElement("div");
    this._grMeter.className = "wam-gr-meter";
    this._grFill = document.createElement("div");
    this._grFill.className = "wam-gr-fill";
    this._grMeter.appendChild(this._grFill);
    grWrap.appendChild(this._grMeter);
    scCtrl.appendChild(grWrap);

    this.appendChild(scEl);

    this._compressor.onReduction = (gr) => {
      if (this._grFill) this._grFill.style.width = `${Math.min(100, gr * 100)}%`;
    };
    this._applyCompRelease();

    this._sidechainPicker.addEventListener("source-change", (e) => {
      this._compressor?.setSidechainSource(e.detail.tapNode);
    });

    // Delegated listener for all knobs and sliders
    const handleFxInput = (e) => {
      const { param, value } = e.detail;
      switch (param) {
        case "reverbWet":
          if (this._reverb) this._reverb.wet = value;
          break;
        case "reverbPreDelay":
          if (this._reverb) this._reverb.preDelay = value;
          break;
        case "reverbHpFreq":
          if (this._reverb) this._reverb.hpFreq = value;
          break;
        case "reverbLpFreq":
          if (this._reverb) this._reverb.lpFreq = value;
          break;
        case "reverbDecay":
          if (this._reverb) this._reverb.decay = value;
          break;
        case "reverbDamping":
          if (this._reverb) this._reverb.damping = value;
          break;
        case "reverbWidth":
          if (this._reverb) this._reverb.width = value;
          break;
        case "delayFeedback":
          if (this._delay) this._delay.feedback = value;
          break;
        case "delayMix":
          if (this._delay) this._delay.wet = value;
          break;
        case "delayFilterSweep":
          if (this._delay) this._delay.filterSweep = value;
          break;
        case "delayInterval":
          if (this._delay) this._delay.interval = value;
          break;
        case "delayModulation":
          if (this._delay) this._delay.modulation = value;
          break;
        case "chorusVoices":
          if (this._chorus) this._chorus.voices = Math.round(value);
          break;
        case "chorusRate":
          if (this._chorus) this._chorus.rate = value;
          break;
        case "chorusDepth":
          if (this._chorus) this._chorus.depth = value;
          break;
        case "chorusDelay":
          if (this._chorus) this._chorus.delay = value;
          break;
        case "chorusFeedback":
          if (this._chorus) this._chorus.feedback = value;
          break;
        case "chorusSpread":
          if (this._chorus) this._chorus.spread = value;
          break;
        case "chorusShape":
          if (this._chorus) this._chorus.shape = ["sine", "triangle"][Math.round(value)] || "sine";
          break;
        case "chorusWet":
          if (this._chorus) this._chorus.wet = value;
          break;
        case "filterSweep":
          if (this._filter) this._filter.sweep = value;
          break;
        case "filterQ":
          if (this._filter) this._filter.q = value;
          break;
        case "compAmount":
          if (this._compressor) this._compressor.amount = value;
          break;
        case "compAttack":
          if (this._compressor) this._compressor.attack = value / 1000;
          break;
        case "compRelease":
          this._compReleaseMs = value;
          this._applyCompRelease();
          break;
        case "compSync":
          this._compSync = value >= 0.5;
          this._applyCompRelease();
          break;
        case "compReleaseBeats":
          this._compReleaseBeats = Math.round(value);
          this._applyCompRelease();
          break;
        case "compThreshold":
          if (this._compressor) this._compressor.threshold = value;
          break;
      }
    };
    this.addEventListener("knob-input", handleFxInput);
    this.addEventListener("slider-input", handleFxInput);
  }

  _addSlider(param, label, min, max, step, value, opts = {}) {
    const slider = document.createElement("wam-knob");
    slider.setAttribute("param", param);
    slider.setAttribute("label", label);
    slider.setAttribute("min", min);
    slider.setAttribute("max", max);
    slider.setAttribute("step", step);
    if (opts.scale) slider.setAttribute("scale", opts.scale);
    if (opts.tooltip) slider.setAttribute("data-tooltip", opts.tooltip);
    slider.value = value;
    return slider;
  }

  // ---- CSS (injected once per page) ----

  static _injectCSS() {
    if (WebAudioFxUnit.#cssInjected) return;
    WebAudioFxUnit.#cssInjected = true;
    const style = document.createElement("style");
    style.textContent = `
      wam-fx-unit {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: 8px;
        padding: 8px 14px 10px;
        background: #0d0d0d;
        font-family: monospace;
        --slider-accent: var(--fx-accent, #0f0);
      }
      /* FX sections are narrow (~3 inner columns), so the shared "span 4" wide
         control overflows. Make wide controls fill the section's row instead. */
      wam-fx-unit .wam-ctrl-wide {
        grid-column: 1 / -1;
        min-width: 0;
      }
      wam-fx-unit .wam-gr-meter {
        position: relative;
        width: 100%;
        height: 8px;
        background: #222;
        border-radius: 3px;
        overflow: hidden;
      }
      wam-fx-unit .wam-gr-fill {
        position: absolute;
        inset: 0 auto 0 0;
        width: 0%;
        max-width: 100%;
        background: var(--fx-accent, #0f0);
        transition: width 60ms linear;
      }
    `;
    document.head.appendChild(style);
  }
}

customElements.define("wam-fx-unit", WebAudioFxUnit);
