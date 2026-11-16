/**
 * WebAudioFxUnit — reusable effects web component (reverb + delay + chorus + filter).
 *
 * UI for an FxChain (fx-chain.js — the audio). Composed from standalone FX classes:
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

import "../ui/slider.js";
import "../ui/filter-sweep.js";
import "../ui/instrument-source-picker.js";
import { FxChain } from "./fx-chain.js";
import { injectControlsCSS, createSection, createCtrl } from "../ui/controls-factory.js";

export default class WebAudioFxUnit extends HTMLElement {
  static #cssInjected = false;

  /** Tempo-sync release divisions (see FxChain). */
  static RELEASE_DIVISIONS = FxChain.RELEASE_DIVISIONS;

  constructor() {
    super();
    this._ctx = null;
    /** @type {FxChain|null} the audio; this element is its UI */
    this.chain = null;
    this._sidechainPicker = null;
  }

  // Stage accessors (the UI code below reads these).
  get _reverb() { return this.chain?.reverb ?? null; }
  get _delay() { return this.chain?.delay ?? null; }
  get _chorus() { return this.chain?.chorus ?? null; }
  get _filter() { return this.chain?.filter ?? null; }
  get _compressor() { return this.chain?.compressor ?? null; }

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
    this.chain = new FxChain(ctx, options);

    // ---- UI ----
    WebAudioFxUnit._injectCSS();
    this._buildUI(options);
  }

  // ---- Properties ----

  set bpm(v) {
    if (this.chain) this.chain.bpm = v;
  }

  // ---- Routing ----

  get input() {
    return this.chain?.input ?? null;
  }

  connect(node) {
    this.chain.connect(node);
    return this;
  }

  /** Hide a bus instance from the sidechain source picker (the host track, to avoid self-feedback). */
  setSidechainHostId(id) {
    if (this._sidechainPicker) this._sidechainPicker.excludeId = id;
  }

  /** Tear down internal nodes. Called when the host channel is removed. */
  destroy() {
    this.chain?.destroy();
  }

  // ---- Serialization ----

  toJSON() {
    if (!this.chain) return null;
    return { ...this.chain.toJSON(), compSourceId: this._sidechainPicker?.value ?? null };
  }

  fromJSON(saved) {
    if (!saved || !this.chain) return;
    // Legacy names/values → current (see FxChain.normalize); raw legacy values go straight to the chain.
    const { params: obj, legacy } = FxChain.normalize(saved);
    obj.compSourceId = saved.compSourceId;
    this.chain.applyLegacy(legacy);

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
    restore("delayFilterSweep", obj.delayFilterSweep, 'wam-filter-sweep[param="delayFilterSweep"]');

    // Chorus
    restore("chorusVoices", obj.chorusVoices);
    restore("chorusRate", obj.chorusRate);
    restore("chorusDepth", obj.chorusDepth);
    restore("chorusDelay", obj.chorusDelay);
    restore("chorusFeedback", obj.chorusFeedback);
    restore("chorusWet", obj.chorusWet);
    restore("chorusSpread", obj.chorusSpread);
    restore("chorusShape", obj.chorusShape);

    // Filter
    restore("filterSweep", obj.filterSweep, "wam-filter-sweep");
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

    const mkFxSection = (label) => {
      const { el, controls } = createSection(label);
      el.setAttribute("data-fx-section", "");
      return { el, controls };
    };
    // ---- Filter ----
    const { el: filtEl, controls: filtCtrl } = mkFxSection("Filter");
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
    const { el: delEl, controls: delCtrl } = mkFxSection("Delay");
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
    const { el: chorEl, controls: chorCtrl } = mkFxSection("Chorus");
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
    const { el: revEl, controls: revCtrl } = mkFxSection("Reverb");
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
    const { el: scEl, controls: scCtrl } = mkFxSection("Sidechain");
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
    this._sidechainPicker.addEventListener("source-change", (e) => {
      this._compressor?.setSidechainSource(e.detail.tapNode);
    });

    // Delegated listener for all knobs and sliders → the chain
    const handleFxInput = (e) => {
      const { param, value } = e.detail;
      this.chain?.set(param, value);
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
        display: contents; /* let child .wam-sections flow into the parent grid */
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
