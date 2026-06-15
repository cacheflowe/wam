/**
 * WebAudioSidechainFx — master bus ducker driven by an instrument tap.
 *
 * Envelope follower chain:
 *   triggerTap → _inputGain → _absShaper → _envLP → _duckingShaper → sidechainGain.gain
 *
 * The duckingShaper maps envelope [0,1] → delta [0,-depth]. Since AudioParam
 * modulation adds to the param's scheduled value, with sidechainGain.gain.value=1:
 *   master gain = 1 + delta  =  1 to (1-depth)
 *
 * Attach the ducking chain to the playground's sidechainGain node via
 * `attachToGain(playground._sidechainGain)`.
 *
 * Usage:
 *   const sc = new WebAudioSidechainFx(ctx);
 *   sc.setTriggerSource(kickTap);
 *   sc.attachToGain(playground._sidechainGain); // done by controls.connectedCallback
 *
 * WebAudioSidechainControls — instrument control panel for WebAudioSidechainFx.
 *   Registered as <wam-sidechain-controls>.
 */

import { WebAudioControlsBase, createSection, createCtrl } from "../ui/controls-base.js";
import "../ui/instrument-source-picker.js";

class WebAudioSidechainFx {
  constructor(ctx) {
    this.ctx = ctx;
    this._depth = 0.8;
    this._speed = 20;

    this._inputGain = ctx.createGain();
    this._inputGain.gain.value = 1;

    // Full-wave rectifier for envelope detection
    this._absShaper = ctx.createWaveShaper();
    this._absShaper.curve = WebAudioSidechainFx._makeAbsCurve();
    this._absShaper.oversample = "2x";

    // Smoothing filter — cutoff controls attack/release speed
    this._envLP = ctx.createBiquadFilter();
    this._envLP.type = "lowpass";
    this._envLP.frequency.value = this._speed;

    // Maps smoothed envelope to a negative gain delta
    this._duckingShaper = ctx.createWaveShaper();
    this._duckingShaper.curve = WebAudioSidechainFx._makeDuckingCurve(this._depth);

    this._inputGain.connect(this._absShaper);
    this._absShaper.connect(this._envLP);
    this._envLP.connect(this._duckingShaper);
    // _duckingShaper is connected to sidechainGain.gain by attachToGain()

    this._triggerTap = null;
    this._targetGain = null;
  }

  // No audio output — these implement the standard instrument interface as no-ops
  get volume() { return 1; }
  set volume(_) {}
  connect(_) { return this; }

  get depth() { return this._depth; }
  set depth(v) {
    this._depth = v;
    this._duckingShaper.curve = WebAudioSidechainFx._makeDuckingCurve(v);
  }

  get speed() { return this._speed; }
  set speed(v) {
    this._speed = v;
    this._envLP.frequency.value = v;
  }

  /** Connect a tap GainNode as the sidechain trigger. Pass null to disconnect. */
  setTriggerSource(tapNode) {
    if (this._triggerTap) this._triggerTap.disconnect(this._inputGain);
    this._triggerTap = tapNode;
    if (tapNode) tapNode.connect(this._inputGain);
  }

  /** Wire the ducking output to a GainNode's AudioParam. Pass null to detach. */
  attachToGain(gainNode) {
    if (this._targetGain) this._duckingShaper.disconnect(this._targetGain.gain);
    this._targetGain = gainNode;
    if (gainNode) this._duckingShaper.connect(gainNode.gain);
  }

  reset() {}

  destroy() {
    this.setTriggerSource(null);
    this.attachToGain(null);
  }

  static _makeAbsCurve(size = 256) {
    const curve = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      curve[i] = Math.abs((i / (size - 1)) * 2 - 1);
    }
    return curve;
  }

  static _makeDuckingCurve(depth, size = 256) {
    const curve = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      // Maps |x| ∈ [0,1] → [0,-depth]
      curve[i] = -depth * Math.abs((i / (size - 1)) * 2 - 1);
    }
    return curve;
  }
}

// ---- Controls panel ----

class WebAudioSidechainControls extends WebAudioControlsBase {
  static SLIDER_DEFS = [
    {
      param: "depth",
      label: "Depth",
      min: 0,
      max: 1,
      step: 0.01,
      tooltip: "Ducking depth (0 = no effect, 1 = full silence).",
    },
    {
      param: "speed",
      label: "Speed",
      min: 1,
      max: 500,
      step: 1,
      tooltip: "Envelope follower speed in Hz. Higher = snappier attack/release.",
    },
  ];

  _defaultTitle() { return "Sidechain"; }
  _defaultColor() { return "#f4a"; }
  _fxTitle() { return "Sidechain"; }

  _createFxUnit() { return null; }
  _buildStripActions() {}

  connectedCallback() {
    if (!this._instrument) return;
    const playground = this.closest("playground-app");
    if (playground?._sidechainGain) {
      this._instrument.attachToGain(playground._sidechainGain);
    }
  }

  _buildControls(controls, _expanded, mkSlider, _ctx, _options) {
    if (this._seqBtn) this._seqBtn.style.display = "none";
    if (this._fxBtn) this._fxBtn.style.display = "none";

    const { el, controls: sec } = createSection("Sidechain");

    const trigWrap = createCtrl("Trigger", { tooltip: "Select the instrument that triggers ducking." });
    this._triggerPicker = document.createElement("wam-instrument-source-picker");
    trigWrap.appendChild(this._triggerPicker);
    sec.appendChild(trigWrap);

    for (const def of WebAudioSidechainControls.SLIDER_DEFS) {
      const wrap = createCtrl(def.label, { tooltip: def.tooltip });
      wrap.appendChild(mkSlider(def));
      sec.appendChild(wrap);
    }

    controls.appendChild(el);

    this._triggerPicker.addEventListener("source-change", (e) => {
      this._instrument?.setTriggerSource(e.detail.tapNode);
    });
  }

  disconnect() {
    this._instrument?.destroy?.();
    super.disconnect();
  }

  // ---- Serialization ----

  _extraToJSON(params) {
    params._triggerInstanceId = this._triggerPicker?.value ?? null;
  }

  _restoreExtra(obj) {
    const triggerId = obj.params?._triggerInstanceId;
    if (triggerId == null) return;
    setTimeout(() => {
      if (this._triggerPicker) {
        this._triggerPicker.value = triggerId;
        const tap = this._triggerPicker.tapNode;
        if (tap) this._instrument?.setTriggerSource(tap);
      }
    }, 0);
  }
}

customElements.define("wam-sidechain-controls", WebAudioSidechainControls);

export default WebAudioSidechainFx;
