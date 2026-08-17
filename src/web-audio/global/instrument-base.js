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
export default class WebAudioInstrumentBase extends EventTarget {
  constructor(ctx, preset) {
    super();
    this.ctx = ctx;
    this._out = ctx.createGain();
    this._steps = [];
    if (preset) this.applyPreset(preset);
  }

  get steps() {
    return this._steps;
  }

  set steps(newSteps) {
    this._steps = newSteps;
    this.dispatchEvent(new CustomEvent("steps-changed", { detail: { steps: newSteps } }));
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

  /**
   * Trigger an audio event based on sequencer step data. Override in subclasses —
   * most implementations just call `this._triggerRatcheted(s, subTime, subStepDur, hit)`.
   * @param {number} index - The step's index in the pattern (0–15).
   * @param {Object} s - The step data { active, note, accent, probability, ratchet, conditions }.
   * @param {number} subTime - The scheduled audio time.
   * @param {number} subStepDur - The duration of the step in seconds.
   */
  triggerSequenceStep(index, s, subTime, subStepDur) {}

  /**
   * Shared ratchet-subdivision helper for triggerSequenceStep() implementations.
   * Calls `hit(time, dur, i)` once per ratchet subdivision (or once, unratcheted,
   * when `s.ratchet` is 1 or unset). `dur` is shortened to 90% of the subdivision
   * when ratcheted, so repeats don't run together; `i` is the subdivision index
   * (0-based), useful for one-shot articulation like an accent on the first hit only.
   * @param {Object} s - The step data (reads `s.ratchet`).
   * @param {number} subTime - The step's scheduled start time.
   * @param {number} subStepDur - The step's full duration.
   * @param {(time: number, dur: number, i: number) => void} hit - Called per subdivision.
   */
  _triggerRatcheted(s, subTime, subStepDur, hit) {
    const ratchet = s.ratchet ?? 1;
    if (ratchet > 1) {
      const ratchetDuration = subStepDur / ratchet;
      for (let i = 0; i < ratchet; i++) {
        hit(subTime + i * ratchetDuration, ratchetDuration * 0.9, i);
      }
    } else {
      hit(subTime, subStepDur, 0);
    }
  }
}
