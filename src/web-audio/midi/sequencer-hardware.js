/**
 * SequencerHardware — maps the Launch Control XL's 16 channel buttons to the
 * 16 steps of the currently focused instrument's sequencer.
 *
 * - Pressing a button toggles that step (via wam-step-seq's toggleStep).
 * - The 16 button LEDs mirror the focused pattern (active = dim green) with a
 *   bright playhead that follows the running step.
 * - Follows `wam-instrument-focus-change`; clears the buttons when nothing is
 *   focused.
 *
 * Shares the single MidiOutput owned by LedFeedback so all LED traffic is
 * batched/deduped through one port (no flooding, no contention).
 */
import { findControl, LED } from "./launch-control-xl.js";
import { ledFeedback } from "./led-feedback.js";

// Step index 0–15 → LCXL control id (top channel-button row, then bottom row).
const STEP_BUTTON_IDS = [
  "focus1", "focus2", "focus3", "focus4", "focus5", "focus6", "focus7", "focus8",
  "control1", "control2", "control3", "control4", "control5", "control6", "control7", "control8",
];
const STEP_COUNT = STEP_BUTTON_IDS.length;

const ACTIVE_COLOR = LED.GREEN_LOW;
const PLAYHEAD_ACTIVE = LED.GREEN_FULL;
const PLAYHEAD_EMPTY = LED.RED_LOW;

export class SequencerHardware {
  constructor(midiOutput, target = document) {
    this._out = midiOutput;
    this._target = target;
    this._seq = null;
    this._playhead = -1;
    this._started = false;
    this._onInput = (e) => this._handleInput(e.detail);
    this._onFocusChange = (e) => this.setSequencer(e.detail?.controls?.sequencer ?? null);
    this._onStepChange = (e) => {
      if (e.target === this._seq) this._paint();
    };
    this._onStepActive = (e) => {
      if (e.target === this._seq) this._setPlayhead(e.detail?.index ?? -1);
    };
  }

  start() {
    if (this._started) return;
    this._started = true;
    this._target.addEventListener("wam-control-input", this._onInput);
    this._target.addEventListener("wam-instrument-focus-change", this._onFocusChange);
    this._target.addEventListener("step-change", this._onStepChange);
    this._target.addEventListener("step-active", this._onStepActive);
  }

  stop() {
    this._target.removeEventListener("wam-control-input", this._onInput);
    this._target.removeEventListener("wam-instrument-focus-change", this._onFocusChange);
    this._target.removeEventListener("step-change", this._onStepChange);
    this._target.removeEventListener("step-active", this._onStepActive);
    this._started = false;
  }

  /** Point the buttons at a new sequencer (or null to release them). */
  setSequencer(seq) {
    if (seq === this._seq) return;
    this._clear();
    this._seq = seq || null;
    this._playhead = -1;
    if (this._seq) this._paint();
  }

  _handleInput(detail) {
    if (!this._seq || detail?.kind !== "trigger" || detail.pressed === false) return;
    const step = this._stepForBinding(detail.binding);
    if (step != null) this._seq.toggleStep(step); // → step-change → repaint
  }

  _stepForBinding(binding) {
    if (!binding || binding.source !== "midi") return null;
    const control = findControl(binding);
    const idx = control ? STEP_BUTTON_IDS.indexOf(control.id) : -1;
    return idx >= 0 ? idx : null;
  }

  _paint() {
    if (!this._seq) return;
    const steps = this._seq.steps;
    for (let i = 0; i < STEP_COUNT; i++) {
      this._out.queueControlLed(STEP_BUTTON_IDS[i], steps[i]?.active ? ACTIVE_COLOR : LED.OFF);
    }
    if (this._playhead >= 0) this._lightPlayhead(this._playhead);
  }

  _clear() {
    for (let i = 0; i < STEP_COUNT; i++) this._out.queueControlLed(STEP_BUTTON_IDS[i], LED.OFF);
  }

  _setPlayhead(i) {
    // Restore the previous playhead cell to its base color.
    if (this._playhead >= 0 && this._playhead !== i && this._playhead < STEP_COUNT) {
      const wasActive = this._seq?.steps[this._playhead]?.active;
      this._out.queueControlLed(STEP_BUTTON_IDS[this._playhead], wasActive ? ACTIVE_COLOR : LED.OFF);
    }
    this._playhead = i;
    if (i >= 0 && i < STEP_COUNT) this._lightPlayhead(i);
  }

  _lightPlayhead(i) {
    const active = this._seq?.steps[i]?.active;
    this._out.queueControlLed(STEP_BUTTON_IDS[i], active ? PLAYHEAD_ACTIVE : PLAYHEAD_EMPTY);
  }
}

/** Shared singleton, wired to LedFeedback's MidiOutput. Call start() to activate. */
export const sequencerHardware = new SequencerHardware(ledFeedback.output);
