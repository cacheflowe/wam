/**
 * WebAudioVocoderFx — bus-based vocoder: two instrument taps in, processed audio out.
 *
 * Unlike WebAudioVocoder (which expects mic input), this variant accepts external
 * audio bus taps for both the modulator (spectral analysis input, e.g. vocals)
 * and the carrier (resynthesis source, e.g. a synth pad).
 *
 * Usage:
 *   const vfx = new WebAudioVocoderFx(ctx);
 *   vfx.setModulatorSource(vocalLoopTap);
 *   vfx.setCarrierSource(synthPadTap);
 *   vfx.connect(masterGain);
 *
 * WebAudioVocoderFxControls — instrument control panel for WebAudioVocoderFx.
 *   Registered as <wam-vocoder-fx-controls>.
 */

import WebAudioVocoder from "../instruments/vocoder.js";
import { WebAudioControlsBase, createSection, createCtrl } from "../ui/controls-base.js";
import "../ui/instrument-source-picker.js";

class WebAudioVocoderFx {
  constructor(ctx) {
    this._vocoder = new WebAudioVocoder(ctx);
    this._vocoder.carrierType = "external";
    this._vocoder.play(); // Open carrier bus gate; internal osc/noise gains are 0

    // Carrier boost node — sits between the tap and the carrier bus so the
    // carrier signal can be amplified before hitting the narrow bandpass filters
    this._carrierBoost = ctx.createGain();
    this._carrierBoost.gain.value = 3;
    this._carrierBoost.connect(this._vocoder.carrierInput);

    this._modulatorTap = null;
    this._carrierTap = null;
  }

  get volume() {
    return this._vocoder.volume;
  }
  set volume(v) {
    this._vocoder.volume = v;
  }

  connect(node) {
    return this._vocoder.connect(node);
  }

  /** Connect a tap GainNode as the modulator (analysis) input. Pass null to disconnect. */
  setModulatorSource(tapNode) {
    if (this._modulatorTap) this._modulatorTap.disconnect(this._vocoder.modulatorInput);
    this._modulatorTap = tapNode;
    if (tapNode) tapNode.connect(this._vocoder.modulatorInput);
  }

  /** Connect a tap GainNode as the carrier (resynthesis) input. Pass null to disconnect. */
  setCarrierSource(tapNode) {
    if (this._carrierTap) this._carrierTap.disconnect(this._carrierBoost);
    this._carrierTap = tapNode;
    if (tapNode) tapNode.connect(this._carrierBoost);
  }

  get carrierGain() { return this._carrierBoost.gain.value; }
  set carrierGain(v) { this._carrierBoost.gain.value = v; }

  // Forward all vocoder params
  get sensitivity() { return this._vocoder.sensitivity; }
  set sensitivity(v) { this._vocoder.sensitivity = v; }
  get envSpeed() { return this._vocoder.envSpeed; }
  set envSpeed(v) { this._vocoder.envSpeed = v; }
  get filterQ() { return this._vocoder.filterQ; }
  set filterQ(v) { this._vocoder.filterQ = v; }
  get formantShift() { return this._vocoder.formantShift; }
  set formantShift(v) { this._vocoder.formantShift = v; }
  get gate() { return this._vocoder.gate; }
  set gate(v) { this._vocoder.gate = v; }

  reset() {}

  destroy() {
    this.setModulatorSource(null);
    this.setCarrierSource(null);
    this._carrierBoost.disconnect();
    this._vocoder.destroy();
  }
}

// ---- Controls panel ----

class WebAudioVocoderFxControls extends WebAudioControlsBase {
  static SLIDER_DEFS = [
    {
      param: "carrierGain",
      label: "Car. Boost",
      min: 0.1,
      max: 20,
      step: 0.1,
      scale: "log",
      tooltip: "Carrier input boost. The carrier splits across 16 narrow filters so often needs significant gain.",
    },
    {
      param: "sensitivity",
      label: "Sens",
      min: 0.1,
      max: 30,
      step: 0.1,
      tooltip: "Modulator input gain. Higher values detect quieter signals.",
    },
    {
      param: "envSpeed",
      label: "Env Hz",
      min: 1,
      max: 200,
      step: 1,
      tooltip: "Envelope follower speed in Hz. Lower = smoother, more legato.",
    },
    {
      param: "filterQ",
      label: "Q",
      min: 0.5,
      max: 20,
      step: 0.1,
      tooltip: "Filter bank resonance. Higher Q = more robotic / nasal character.",
    },
    {
      param: "formantShift",
      label: "Formant",
      min: -12,
      max: 12,
      step: 0.5,
      tooltip: "Shift synthesis bands by semitones. Negative = deeper voice.",
    },
    {
      param: "gate",
      label: "Gate",
      min: 0,
      max: 1,
      step: 0.01,
      tooltip: "Noise gate on modulator. Suppresses silent / ambient input.",
    },
  ];

  _defaultTitle() { return "Vocoder"; }
  _defaultColor() { return "#4fda"; }
  _fxTitle() { return "Vocoder"; }

  // No FX chain — vocoder IS the processing
  _createFxUnit() { return null; }

  // No jam button — vocoder is a continuous processor
  _buildStripActions() {}

  _buildControls(controls, _expanded, mkSlider, _ctx, _options) {
    // Hide seq and fx section buttons (unused for vocoder)
    if (this._seqBtn) this._seqBtn.style.display = "none";
    if (this._fxBtn) this._fxBtn.style.display = "none";

    const { el, controls: sec } = createSection("Vocoder");

    const modWrap = createCtrl("Modulator", { tooltip: "Modulator input: spectral analysis source (e.g. vocals)." });
    this._modPicker = document.createElement("wam-instrument-source-picker");
    modWrap.appendChild(this._modPicker);
    sec.appendChild(modWrap);

    const carWrap = createCtrl("Carrier", { tooltip: "Carrier input: resynthesis source (e.g. synth, pad)." });
    this._carPicker = document.createElement("wam-instrument-source-picker");
    carWrap.appendChild(this._carPicker);
    sec.appendChild(carWrap);

    for (const def of WebAudioVocoderFxControls.SLIDER_DEFS) {
      const wrap = createCtrl(def.label, { tooltip: def.tooltip });
      wrap.appendChild(mkSlider(def));
      sec.appendChild(wrap);
    }

    controls.appendChild(el);

    this._modPicker.addEventListener("source-change", (e) => {
      this._instrument?.setModulatorSource(e.detail.tapNode);
    });
    this._carPicker.addEventListener("source-change", (e) => {
      this._instrument?.setCarrierSource(e.detail.tapNode);
    });
  }

  disconnect() {
    this._instrument?.destroy?.();
    super.disconnect();
  }

  // ---- Serialization ----

  _extraToJSON(params) {
    params._modulatorInstanceId = this._modPicker?.value ?? null;
    params._carrierInstanceId = this._carPicker?.value ?? null;
  }

  _restoreExtra(obj) {
    const modId = obj.params?._modulatorInstanceId;
    const carId = obj.params?._carrierInstanceId;
    if (modId == null && carId == null) return;
    // Defer one tick so all instruments are added before reconnecting
    setTimeout(() => {
      if (modId != null && this._modPicker) {
        this._modPicker.value = modId;
        const tap = this._modPicker.tapNode;
        if (tap) this._instrument?.setModulatorSource(tap);
      }
      if (carId != null && this._carPicker) {
        this._carPicker.value = carId;
        const tap = this._carPicker.tapNode;
        if (tap) this._instrument?.setCarrierSource(tap);
      }
    }, 0);
  }
}

customElements.define("wam-vocoder-fx-controls", WebAudioVocoderFxControls);

export default WebAudioVocoderFx;
