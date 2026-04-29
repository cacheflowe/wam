/**
 * WebAudioInstrumentBase — shared foundation for all headless audio instruments.
 *
 * Provides the universal output-gain node, volume getter/setter, connect(),
 * applyPreset(), and MIDI-to-frequency conversion. Subclasses define
 * `static PRESETS`, implement `trigger()`, and add any extra audio nodes.
 *
 * Constructor pattern for subclasses with extra nodes:
 *   constructor(ctx, preset = "Default") {
 *     super(ctx, null);          // creates ctx + _out but skips preset
 *     this._filter = ctx.createBiquadFilter();
 *     this._filter.connect(this._out);
 *     this.applyPreset(preset);  // now safe — extra nodes exist
 *   }
 */
export default class WebAudioInstrumentBase {
  constructor(ctx, preset) {
    this.ctx = ctx;
    this._out = ctx.createGain();
    if (preset) this.applyPreset(preset);
  }

  get input() {
    return this._out;
  }

  get volume() {
    return this._out.gain.value;
  }
  set volume(v) {
    this._out.gain.value = v;
  }

  connect(node) {
    this._out.connect(node.input ?? node);
    return this;
  }

  /**
   * Apply a named preset from `this.constructor.PRESETS`.
   * Iterates all keys in the preset and sets `this[key] = val`.
   * Override in subclasses that need post-apply side-effects (e.g. BlipFX._rebake).
   */
  applyPreset(name) {
    const p = this.constructor.PRESETS?.[name];
    if (!p) return;
    for (const [key, val] of Object.entries(p)) {
      if (val != null) this[key] = val;
    }
  }

  /**
   * Convert MIDI note number to frequency in Hz.
   * @param {number} midi  MIDI note (e.g. 69 = A4 = 440 Hz)
   * @returns {number}
   */
  static _midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }
}
