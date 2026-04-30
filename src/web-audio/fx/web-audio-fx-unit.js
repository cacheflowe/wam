/**
 * WebAudioFxUnit — reusable effects web component (reverb + delay + chorus + filter).
 *
 * Composed from standalone FX classes:
 *   - WebAudioFxReverb  (convolution reverb with wet/dry)
 *   - WebAudioFxDelay   (dub-style delay with BPM sync, feedback filter, LFO)
 *   - WebAudioFxChorus  (multi-voice chorus with stereo spread)
 *   - WebAudioFxFilter  (combined HP + LP with shared Q)
 *
 * Audio chain (serial):
 *   in → filter → delay → chorus → reverb → out
 * Each stage handles its own dry/wet internally.
 *
 * Usage:
 *   const fx = document.createElement("web-audio-fx-unit");
 *   parentEl.appendChild(fx);
 *   fx.init(ctx, { bpm: 128, reverbWet: 0.15, delayInterval: 0.75 });
 *   synth.connect(fx);
 *   fx.connect(ctx.destination);
 *   fx.bpm = 140; // live BPM update
 */

import WebAudioFxReverb from "./web-audio-fx-reverb.js";
import WebAudioFxDelay from "./web-audio-fx-delay.js";
import WebAudioFxChorus from "./web-audio-fx-chorus.js";
import WebAudioFxFilter from "./web-audio-fx-filter.js";
import "../web-audio-slider.js";
import "../web-audio-filter-sweep.js";
import { injectControlsCSS, createSection, createCtrl } from "../web-audio-slider.js";

// Set to false to start FX units expanded by default.
const FX_UNIT_COLLAPSED_DEFAULT = true;

export default class WebAudioFxUnit extends HTMLElement {
  static #cssInjected = false;

  constructor() {
    super();
    this._ctx = null;
    this._in = null;
    this._out = null;
    this._reverb = null;
    this._delay = null;
    this._chorus = null;
    this._filter = null;
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
    });

    this._in.connect(this._filter.input);
    this._filter.connect(this._delay.input);
    this._delay.connect(this._chorus.input);
    this._chorus.connect(this._reverb.input);
    this._reverb.connect(this._out);

    // ---- UI ----
    WebAudioFxUnit._injectCSS();
    this._buildUI(options);
  }

  // ---- Properties ----

  set bpm(v) {
    if (this._delay) this._delay.bpm = v;
  }

  // ---- Routing ----

  get input() {
    return this._in;
  }

  connect(node) {
    this._out.connect(node.input ?? node);
    return this;
  }

  // ---- Serialization ----

  toJSON() {
    return {
      reverbWet: this._reverb?.wet ?? 0,
      reverbPreDelay: this._reverb?.preDelay ?? 0,
      reverbHpFreq: this._reverb?.hpFreq ?? 80,
      reverbLpFreq: this._reverb?.lpFreq ?? 8000,
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
      chorusShape: this._chorus?.shape ?? "sine",
      filterSweep: this._filter?.sweep ?? 0,
      filterQ: this._filter?.q ?? 0.7,
    };
  }

  fromJSON(obj) {
    if (!obj) return;
    if (obj.reverbWet != null && this._reverb) {
      this._reverb.wet = obj.reverbWet;
      const s = this.querySelector('web-audio-slider[param="reverbWet"]');
      if (s) s.value = obj.reverbWet;
    }
    if (obj.reverbPreDelay != null && this._reverb) {
      this._reverb.preDelay = obj.reverbPreDelay;
      const s = this.querySelector('web-audio-slider[param="reverbPreDelay"]');
      if (s) s.value = obj.reverbPreDelay;
    }
    if (obj.reverbHpFreq != null && this._reverb) {
      this._reverb.hpFreq = obj.reverbHpFreq;
      const s = this.querySelector('web-audio-slider[param="reverbHpFreq"]');
      if (s) s.value = obj.reverbHpFreq;
    }
    if (obj.reverbLpFreq != null && this._reverb) {
      this._reverb.lpFreq = obj.reverbLpFreq;
      const s = this.querySelector('web-audio-slider[param="reverbLpFreq"]');
      if (s) s.value = obj.reverbLpFreq;
    }
    if (obj.delayInterval != null && this._delay) {
      this._delay.interval = obj.delayInterval;
      const sel = this.querySelector('select[data-param="delayInterval"]');
      if (sel) sel.value = obj.delayInterval;
    }
    if (obj.delayFeedback != null && this._delay) {
      this._delay.feedback = obj.delayFeedback;
      const s = this.querySelector('web-audio-slider[param="delayFeedback"]');
      if (s) s.value = obj.delayFeedback;
    }
    if (obj.delayMix != null && this._delay) {
      this._delay.wet = obj.delayMix;
      const s = this.querySelector('web-audio-slider[param="delayMix"]');
      if (s) s.value = obj.delayMix;
    }
    if (obj.delayFilterSweep != null && this._delay) {
      this._delay.filterSweep = obj.delayFilterSweep;
      const s = this.querySelector('web-audio-filter-sweep[param="delayFilterSweep"]');
      if (s) s.value = obj.delayFilterSweep;
    } else if (obj.delayFilterFreq != null && this._delay) {
      // backwards-compat: old saves stored raw LP frequency — map to a negative sweep
      this._delay.filterFreq = obj.delayFilterFreq;
    }
    if (obj.delayModulation != null && this._delay) {
      this._delay.modulation = obj.delayModulation;
      const s = this.querySelector('web-audio-slider[param="delayModulation"]');
      if (s) s.value = obj.delayModulation;
    }
    if (obj.chorusVoices != null && this._chorus) {
      this._chorus.voices = obj.chorusVoices;
      const sel = this.querySelector('select[data-param="chorusVoices"]');
      if (sel) sel.value = obj.chorusVoices;
    }
    if (obj.chorusRate != null && this._chorus) {
      this._chorus.rate = obj.chorusRate;
      const s = this.querySelector('web-audio-slider[param="chorusRate"]');
      if (s) s.value = obj.chorusRate;
    }
    if (obj.chorusDepth != null && this._chorus) {
      this._chorus.depth = obj.chorusDepth;
      const s = this.querySelector('web-audio-slider[param="chorusDepth"]');
      if (s) s.value = obj.chorusDepth;
    }
    if (obj.chorusDelay != null && this._chorus) {
      this._chorus.delay = obj.chorusDelay;
      const s = this.querySelector('web-audio-slider[param="chorusDelay"]');
      if (s) s.value = obj.chorusDelay;
    }
    if (obj.chorusFeedback != null && this._chorus) {
      this._chorus.feedback = obj.chorusFeedback;
      const s = this.querySelector('web-audio-slider[param="chorusFeedback"]');
      if (s) s.value = obj.chorusFeedback;
    }
    if (obj.chorusSpread != null && this._chorus) {
      this._chorus.spread = obj.chorusSpread;
      const s = this.querySelector('web-audio-slider[param="chorusSpread"]');
      if (s) s.value = obj.chorusSpread;
    }
    if (obj.chorusWet != null && this._chorus) {
      this._chorus.wet = obj.chorusWet;
      const s = this.querySelector('web-audio-slider[param="chorusWet"]');
      if (s) s.value = obj.chorusWet;
    }
    if (obj.chorusShape != null && this._chorus) {
      this._chorus.shape = obj.chorusShape;
      const sel = this.querySelector('select[data-param="chorusShape"]');
      if (sel) sel.value = obj.chorusShape;
    }
    if (obj.filterSweep != null && this._filter) {
      this._filter.sweep = obj.filterSweep;
      const s = this.querySelector("web-audio-filter-sweep");
      if (s) s.value = obj.filterSweep;
    } else {
      // backwards-compat: old saves had separate lpFreq/hpFreq
      if (obj.lpFreq != null && this._filter) this._filter.lpFreq = obj.lpFreq;
      if (obj.hpFreq != null && this._filter) this._filter.hpFreq = obj.hpFreq;
    }
    if (obj.filterQ != null && this._filter) {
      this._filter.q = obj.filterQ;
      const s = this.querySelector('web-audio-slider[param="filterQ"]');
      if (s) s.value = obj.filterQ;
    }
  }

  // ---- UI ----

  _buildUI(options) {
    this.innerHTML = "";
    injectControlsCSS();

    const header = document.createElement("div");
    header.className = "fx-unit-header";
    const titleSpan = document.createElement("span");
    titleSpan.textContent = options.title ?? "FX";
    const chevron = document.createElement("span");
    chevron.className = "fx-unit-chevron";
    chevron.textContent = "▾";
    header.appendChild(titleSpan);
    header.appendChild(chevron);
    header.addEventListener("click", () => this.toggleAttribute("data-collapsed"));
    this.appendChild(header);

    if (FX_UNIT_COLLAPSED_DEFAULT) this.setAttribute("data-collapsed", "");

    const mkSelect = (labelText, appendTo, tooltip = null) => {
      const wrap = createCtrl(labelText, { tooltip });
      const sel = document.createElement("select");
      sel.className = "wac-select";
      wrap.appendChild(sel);
      appendTo.appendChild(wrap);
      return sel;
    };

    // ---- Filter ----
    const { el: filtEl, controls: filtCtrl } = createSection("Filter");
    const sweep = document.createElement("web-audio-filter-sweep");
    sweep.setAttribute("param", "filterSweep");
    sweep.setAttribute("label", "Sweep");
    sweep.setAttribute("data-tooltip", "Combined HP+LP filter sweep. Left = cut lows, right = cut highs, center = bypass.");
    sweep.value = options.filterSweep ?? 0;
    filtCtrl.appendChild(sweep);
    filtCtrl.appendChild(this._addSlider("filterQ", "Q", 0.5, 15, 0.1, options.filterQ ?? 0.7, {
      tooltip: "Filter resonance. Higher values add a peak at the cutoff, creating a sharper, more nasal tone.",
    }));
    this.appendChild(filtEl);

    // ---- Delay ----
    const { el: delEl, controls: delCtrl } = createSection("Delay");
    delCtrl.appendChild(this._addSlider("delayMix", "Mix", 0, 1, 0.01, options.delayMix ?? 0, {
      tooltip: "Delay wet/dry mix. 0 = dry only, 1 = delay only.",
    }));
    const intervalSelect = mkSelect("Interval", delCtrl, "Delay time as a rhythmic fraction. Syncs to the current BPM.");
    intervalSelect.dataset.param = "delayInterval";
    WebAudioFxDelay.INTERVALS.forEach(({ label, beats }) => {
      const opt = document.createElement("option");
      opt.value = beats;
      opt.textContent = label;
      if (beats === (options.delayInterval ?? 0.75)) opt.selected = true;
      intervalSelect.appendChild(opt);
    });
    intervalSelect.addEventListener("change", () => {
      if (this._delay) this._delay.interval = parseFloat(intervalSelect.value);
    });
    delCtrl.appendChild(this._addSlider("delayFeedback", "Feedbk", 0, 0.9, 0.01, options.delayFeedback ?? 0.35, {
      tooltip: "How much of the delay output feeds back into the input. High values = long, cascading repeats.",
    }));
    const delayFilterSweep = document.createElement("web-audio-filter-sweep");
    delayFilterSweep.setAttribute("param", "delayFilterSweep");
    delayFilterSweep.setAttribute("label", "Dub Filt");
    delayFilterSweep.setAttribute("data-tooltip", "Filter applied to the delay feedback path. Creates dub-style filtered echoes.");
    delayFilterSweep.value = options.delayFilterSweep ?? 0;
    delCtrl.appendChild(delayFilterSweep);
    delCtrl.appendChild(this._addSlider("delayModulation", "Mod", 0, 1, 0.01, 0, {
      tooltip: "LFO modulation depth on the delay time. Adds a chorus-like pitch wobble to the echoes.",
    }));
    this.appendChild(delEl);

    // ---- Chorus ----
    const { el: chorEl, controls: chorCtrl } = createSection("Chorus");
    chorCtrl.appendChild(this._addSlider("chorusWet", "Wet", 0, 1, 0.01, options.chorusWet ?? 0, {
      tooltip: "Chorus wet/dry mix. 0 = dry, 1 = full chorus effect.",
    }));
    const voicesSelect = mkSelect("Voices", chorCtrl, "Number of chorus voices. More voices = thicker, denser modulation.");
    voicesSelect.dataset.param = "chorusVoices";
    for (let v = 1; v <= 6; v++) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      if (v === (options.chorusVoices ?? 3)) opt.selected = true;
      voicesSelect.appendChild(opt);
    }
    voicesSelect.addEventListener("change", () => {
      if (this._chorus) this._chorus.voices = parseInt(voicesSelect.value);
    });
    const shapeSelect = mkSelect("Shape", chorCtrl, "LFO waveform for modulation. Sine = smooth sweep, triangle = slightly sharper.");
    shapeSelect.dataset.param = "chorusShape";
    ["sine", "triangle"].forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s;
      opt.textContent = s;
      if (s === (options.chorusShape ?? "sine")) opt.selected = true;
      shapeSelect.appendChild(opt);
    });
    shapeSelect.addEventListener("change", () => {
      if (this._chorus) this._chorus.shape = shapeSelect.value;
    });
    chorCtrl.appendChild(
      this._addSlider("chorusRate", "Rate", 0.05, 10, 0.01, options.chorusRate ?? 0.8, {
        scale: "log",
        tooltip: "LFO speed in Hz. Slow = gentle shimmer, fast = vibrato-like wobble.",
      }),
    );
    chorCtrl.appendChild(this._addSlider("chorusDepth", "Depth", 0, 1, 0.01, options.chorusDepth ?? 0.5, {
      tooltip: "Amount of pitch modulation per voice. Higher = more pronounced detuning.",
    }));
    chorCtrl.appendChild(this._addSlider("chorusDelay", "Delay", 1, 50, 0.1, options.chorusDelay ?? 10, {
      tooltip: "Base delay offset per voice in ms. Longer = more spacious, wider stereo image.",
    }));
    chorCtrl.appendChild(this._addSlider("chorusFeedback", "Feedbk", 0, 0.9, 0.01, options.chorusFeedback ?? 0, {
      tooltip: "Feedback within chorus voices. Higher values add resonance and metallic coloring.",
    }));
    chorCtrl.appendChild(this._addSlider("chorusSpread", "Spread", 0, 1, 0.01, options.chorusSpread ?? 1, {
      tooltip: "Stereo spread of chorus voices. 0 = mono, 1 = full stereo width.",
    }));
    this.appendChild(chorEl);

    // ---- Reverb ----
    const { el: revEl, controls: revCtrl } = createSection("Reverb");
    revCtrl.appendChild(this._addSlider("reverbWet", "Wet", 0, 1, 0.01, options.reverbWet ?? 0, {
      tooltip: "Reverb wet/dry mix. 0 = dry, 1 = reverb only.",
    }));
    revCtrl.appendChild(this._addSlider("reverbPreDelay", "Pre-dly", 0, 80, 1, options.reverbPreDelay ?? 0, {
      tooltip: "Pre-delay before the reverb tail in ms. Adds space between the source and its reflections.",
    }));
    revCtrl.appendChild(
      this._addSlider("reverbHpFreq", "HP", 20, 800, 1, options.reverbHpFreq ?? 80, {
        scale: "log",
        tooltip: "High-pass filter on the reverb output. Cuts muddy low frequencies from the tail.",
      }),
    );
    revCtrl.appendChild(
      this._addSlider("reverbLpFreq", "Damp", 2000, 20000, 1, options.reverbLpFreq ?? 8000, {
        scale: "log",
        tooltip: "Low-pass filter on the reverb output. Lower = darker, warmer tail. Higher = bright, airy reverb.",
      }),
    );
    this.appendChild(revEl);

    // Delegated listener for all sliders
    this.addEventListener("slider-input", (e) => {
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
        case "delayFeedback":
          if (this._delay) this._delay.feedback = value;
          break;
        case "delayMix":
          if (this._delay) this._delay.wet = value;
          break;
        case "delayFilterSweep":
          if (this._delay) this._delay.filterSweep = value;
          break;
        case "delayModulation":
          if (this._delay) this._delay.modulation = value;
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
        case "chorusWet":
          if (this._chorus) this._chorus.wet = value;
          break;
        case "filterSweep":
          if (this._filter) this._filter.sweep = value;
          break;
        case "filterQ":
          if (this._filter) this._filter.q = value;
          break;
      }
    });
  }

  _addSlider(param, label, min, max, step, value, opts = {}) {
    const slider = document.createElement("web-audio-slider");
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
      web-audio-fx-unit {
        display: flex;
        flex-direction: column;
        gap: 0;
        padding: 6px 14px 10px;
        background: #0d0d0d;
        border-top: 1px solid #1e1e1e;
        border-radius: 0 0 5px 5px;
        font-family: monospace;
        --slider-accent: var(--fx-accent, #0f0);
      }
      .fx-unit-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 0.62em;
        color: #3a3a3a;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        padding: 6px 0 4px;
        cursor: pointer;
        user-select: none;
      }
      .fx-unit-chevron {
        font-size: 2em;
        color: #555;
        transition: transform 0.15s ease;
        line-height: 1;
      }
      web-audio-fx-unit[data-collapsed] .fx-unit-chevron { transform: rotate(-90deg); }
      web-audio-fx-unit[data-collapsed] .wac-section { display: none; }
    `;
    document.head.appendChild(style);
  }
}

customElements.define("web-audio-fx-unit", WebAudioFxUnit);
