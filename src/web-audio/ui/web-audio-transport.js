import "./web-audio-slider.js";
import "./web-audio-waveform.js";
import "../fx/web-audio-fx-unit.js";
import { injectControlsCSS, createChannelStrip } from "./web-audio-slider.js";
import { NOTE_NAMES, SCALES } from "../global/web-audio-scales.js";

/**
 * WebAudioTransportControls — master transport panel as a Web Component.
 *
 * Owns the master audio chain (masterGain → FX → analyser → destination),
 * the play/stop + BPM controls, and optional key/scale selects.
 * Shares visual conventions with instrument controls panels (.wac-* classes,
 * channel strip, waveform, collapsible sections, FX unit).
 *
 * Usage:
 *   transport.init(ctx, { bpm: 128, seq, color: "#fff" });
 *   transport.connect(ctx.destination);
 *   transport.registerInstrument(acidControls);
 *   acidControls.connect(transport.masterGain);
 *
 * State:
 *   transport.toJSON()     → { bpm, masterVolume, muted, root, scale, fx }
 *   transport.fromJSON(obj)
 *
 * Events:
 *   transport-play        bubbles on play
 *   transport-stop        bubbles on stop
 *   transport-scale-change  bubbles with { root, scale } on key/scale change
 *   controls-change       bubbles on any parameter change (matches instrument convention)
 */
export class WebAudioTransportControls extends HTMLElement {
  constructor() {
    super();
    this._ctx = null;
    this._seq = null;
    this._masterGain = null;
    this._fxUnit = null;
    this._out = null;
    this._volSlider = null;
    this._bpmSlider = null;
    this._rootSelect = null;
    this._scaleSelect = null;
    this._playBtn = null;
    this._meter = null;
    this._muteHandle = null;
    this._instruments = [];
    this._playing = false;
  }

  /**
   * @param {AudioContext} ctx
   * @param {object}  [options]
   * @param {number}  [options.bpm=128]
   * @param {object}  [options.seq]          WebAudioSequencer instance
   * @param {string}  [options.title]        Panel label (default "Transport")
   * @param {string}  [options.color]        Accent color (default "#fff")
   * @param {boolean} [options.showScales]   Show key/scale section (default true)
   * @param {object}  [options.fx]           Passed to web-audio-fx-unit init
   */
  init(ctx, options = {}) {
    this._ctx = ctx;
    this._seq = options.seq ?? null;
    const bpm = options.bpm ?? 128;
    const color = options.color ?? "#fff";
    const title = options.title ?? "Transport";
    const showScales = options.showScales !== false;

    this.innerHTML = "";
    this.classList.add("wac-panel");
    injectControlsCSS();
    this.style.setProperty("--slider-accent", color);
    this.style.setProperty("--fx-accent", color);

    // Master gain — instruments connect here
    this._masterGain = ctx.createGain();

    // Channel strip (no pan — master bus is always center)
    const strip = createChannelStrip(this, {
      title,
      getOutGain: () => this._masterGain,
      initialVol: 1,
      pan: false,
    });
    this._muteHandle = { isMuted: strip.isMuted, setMuted: strip.setMuted, setPreMuteVolume: strip.setPreMuteVolume };
    this._volSlider = strip.volSlider;
    this._meter = strip.meter;

    this.addEventListener("slider-input", (e) => {
      if (e.detail.param === "volume") {
        if (this._muteHandle.isMuted()) {
          this._muteHandle.setPreMuteVolume(e.detail.value);
        } else {
          this._masterGain.gain.value = e.detail.value;
        }
        this._emitChange();
        e.stopPropagation();
      }
    });

    // ---- Always-visible transport row (between strip and expanded) ----
    const topRow = document.createElement("div");
    topRow.className = "wac-transport-row";

    // Play/Stop
    this._playBtn = document.createElement("button");
    this._playBtn.className = "wac-play-btn";
    this._playBtn.textContent = "▶ Play";
    this._playBtn.addEventListener("click", () => this._playing ? this._stop() : this._play());
    topRow.appendChild(this._playBtn);

    // BPM
    this._bpmSlider = document.createElement("web-audio-slider");
    this._bpmSlider.setAttribute("param", "bpm");
    this._bpmSlider.setAttribute("label", "BPM");
    this._bpmSlider.setAttribute("min", "40");
    this._bpmSlider.setAttribute("max", "200");
    this._bpmSlider.setAttribute("step", "1");
    this._bpmSlider.setAttribute("data-tooltip", "Sequencer tempo in beats per minute.");
    this._bpmSlider.value = bpm;
    this._bpmSlider.addEventListener("slider-input", (e) => {
      this._setBpm(e.detail.value);
      this._emitChange();
    });
    topRow.appendChild(this._bpmSlider);

    // Key/Scale
    if (showScales) {
      this._rootSelect = document.createElement("select");
      this._rootSelect.className = "wac-select";
      for (let midi = 24; midi <= 35; midi++) {
        const opt = document.createElement("option");
        opt.value = midi;
        opt.textContent = NOTE_NAMES[midi % 12];
        if (midi === 29) opt.selected = true;
        this._rootSelect.appendChild(opt);
      }

      this._scaleSelect = document.createElement("select");
      this._scaleSelect.className = "wac-select";
      for (const name of Object.keys(SCALES)) {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        this._scaleSelect.appendChild(opt);
      }

      const onScaleChange = () => { this._broadcastScale(); this._emitChange(); };
      this._rootSelect.addEventListener("change", onScaleChange);
      this._scaleSelect.addEventListener("change", onScaleChange);

      topRow.appendChild(this._rootSelect);
      topRow.appendChild(this._scaleSelect);
    }

    // Share URL slot — apps can append a button here
    this._shareSlot = document.createElement("span");
    this._shareSlot.className = "wac-transport-share-slot";
    topRow.appendChild(this._shareSlot);

    this.appendChild(topRow);

    // Waveform — always visible
    const waveform = document.createElement("web-audio-waveform");
    this.appendChild(waveform);

    // Expanded panel — only Master FX
    const expanded = document.createElement("div");
    expanded.className = "wac-expanded";
    this.appendChild(expanded);

    // FX unit
    this._fxUnit = document.createElement("web-audio-fx-unit");
    expanded.appendChild(this._fxUnit);

    // Audio routing
    this._setupRouting(ctx, waveform, color, bpm, options.fx ?? {});
  }

  _setupRouting(ctx, waveform, color, bpm, fxOptions) {
    this._fxUnit.init(ctx, { title: "Master FX", bpm, ...fxOptions });
    this._masterGain.connect(this._fxUnit.input);

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    this._fxUnit.connect(analyser);
    this._out = analyser;

    const meterAnalyser = ctx.createAnalyser();
    meterAnalyser.fftSize = 256;
    this._fxUnit.connect(meterAnalyser);
    this._meter?.setAnalyser(meterAnalyser);

    waveform.init(analyser, color);
  }

  // ---- Routing ----

  get masterGain() { return this._masterGain; }

  /** Slot element where apps can append a share/export button. */
  get shareSlot() { return this._shareSlot; }

  connect(node) {
    this._out?.connect(node.input ?? node);
    return this;
  }

  // ---- Instrument registration (BPM + scale broadcast) ----

  registerInstrument(controls) {
    if (!this._instruments.includes(controls)) this._instruments.push(controls);
    return this;
  }

  unregisterInstrument(controls) {
    this._instruments = this._instruments.filter(c => c !== controls);
    return this;
  }

  // ---- BPM ----

  get bpm() { return this._bpmSlider ? parseFloat(this._bpmSlider.value) : 128; }
  set bpm(v) { this._setBpm(v); }

  _setBpm(v) {
    if (this._bpmSlider) this._bpmSlider.value = v;
    if (this._seq) this._seq.bpm = v;
    if (this._fxUnit) this._fxUnit.bpm = v;
    for (const c of this._instruments) if (c.bpm !== undefined) c.bpm = v;
  }

  // ---- Key / Scale ----

  setScale(root, scale) {
    if (this._rootSelect) this._rootSelect.value = root;
    if (this._scaleSelect) this._scaleSelect.value = scale;
    this._broadcastScale();
  }

  _broadcastScale() {
    if (!this._rootSelect || !this._scaleSelect) return;
    const root = parseInt(this._rootSelect.value);
    const scale = this._scaleSelect.value;
    for (const c of this._instruments) c.setScale?.(root, scale);
    this.dispatchEvent(new CustomEvent("transport-scale-change", {
      bubbles: true,
      detail: { root, scale },
    }));
  }

  // ---- Play / Stop ----

  get playing() { return this._playing; }

  play()  { this._play(); }
  stop()  { this._stop(); }
  broadcastScale() { this._broadcastScale(); }

  _play() {
    this._playing = true;
    if (this._playBtn) {
      this._playBtn.textContent = "◼ Stop";
      this._playBtn.classList.add("wac-playing");
    }
    if (this._seq) this._seq.start();
    this.dispatchEvent(new CustomEvent("transport-play", { bubbles: true }));
  }

  _stop() {
    this._playing = false;
    if (this._playBtn) {
      this._playBtn.textContent = "▶ Play";
      this._playBtn.classList.remove("wac-playing");
    }
    if (this._seq) this._seq.stop();
    this.dispatchEvent(new CustomEvent("transport-stop", { bubbles: true }));
  }

  // ---- Serialization ----

  _emitChange() {
    this.dispatchEvent(new CustomEvent("controls-change", { bubbles: true }));
  }

  toJSON() {
    return {
      bpm: this.bpm,
      masterVolume: this._masterGain?.gain.value ?? 1,
      muted: this._muteHandle?.isMuted() ?? false,
      root: this._rootSelect ? parseInt(this._rootSelect.value) : null,
      scale: this._scaleSelect?.value ?? null,
      fx: this._fxUnit?.toJSON(),
    };
  }

  fromJSON(obj) {
    if (!obj) return;
    if (obj.bpm != null) this._setBpm(obj.bpm);
    if (obj.masterVolume != null) {
      if (this._masterGain) this._masterGain.gain.value = obj.masterVolume;
      if (this._volSlider) this._volSlider.value = obj.masterVolume;
    }
    if (obj.muted != null) this._muteHandle?.setMuted(obj.muted);
    if (obj.root != null && this._rootSelect) this._rootSelect.value = obj.root;
    if (obj.scale != null && this._scaleSelect) this._scaleSelect.value = obj.scale;
    if ((obj.root != null || obj.scale != null)) this._broadcastScale();
    if (obj.fx) this._fxUnit?.fromJSON(obj.fx);
  }
}

customElements.define("web-audio-transport", WebAudioTransportControls);
