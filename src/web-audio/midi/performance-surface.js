/**
 * PerformanceSurface — turns the Launch Control XL into a performance
 * controller with three button modes, a permanent fader mixer, and LED state.
 *
 *   Faders 1–8         Mixer: volume of instrument slots 1–8 (always, any mode).
 *                      Soft takeover: a fader only grabs a volume once it passes
 *                      through the current value, so levels never jump.
 *   Mute / Solo / Arm  Mode select: STEPS / MIXER / PERFORM (lit = current).
 *   ← / →              Knob page (see auto-map.js) when an instrument has >24 params.
 *
 *   16 channel buttons, by mode:
 *     STEPS    toggle steps of the focused pattern (sequencer-hardware.js)
 *     MIXER    top: mute slot 1–8 · bottom: focus slot 1–8
 *     PERFORM  top: launch pattern A–D · prev preset · next preset · random pattern
 *              bottom: mutate subtle / medium / wild · randomize sound · undo · redo
 *
 * Device-agnostic in spirit: everything acts on Controls' public performance
 * API (launchPattern, mutate, setVolume, toggleMute, …). LED output goes through
 * the single shared, batched MidiOutput (see RELIABILITY.md — never flood sysex).
 */
import { CONTROLS, COMMANDS, LED, findControl } from "./launch-control-xl.js";
import { MUTATE_AMOUNTS } from "../global/sound-design.js";
import { ledFeedback } from "./led-feedback.js";
import { sequencerHardware } from "./sequencer-hardware.js";
import { autoMap } from "./auto-map.js";

export const MODES = Object.freeze({ STEPS: "steps", MIXER: "mixer", PERFORM: "perform" });

const MODE_BUTTONS = { [MODES.STEPS]: "mute", [MODES.MIXER]: "solo", [MODES.PERFORM]: "recordArm" };
const TOP = CONTROLS.filter((c) => c.group === "buttonsRow1").map((c) => c.id); // focus1–8
const BOTTOM = CONTROLS.filter((c) => c.group === "buttonsRow2").map((c) => c.id); // control1–8
const FADERS = CONTROLS.filter((c) => c.kind === "fader").map((c) => c.id);
const PATTERNS = ["A", "B", "C", "D"];

/** PERFORM-mode button actions: [label, run(ctrl), available(ctrl)] per button. */
const PERFORM_TOP = [
  ...PATTERNS.map((p) => ({
    label: `Pattern ${p}`,
    run: (c) => c.launchPattern?.(p),
    led: (c) =>
      !c?.patternNames?.includes(p) ? LED.OFF
        : c.queuedPattern === p ? LED.AMBER_FULL
          : c.playingPattern === p ? LED.GREEN_FULL
            : c.patternHasSteps?.(p) ? LED.GREEN_LOW : LED.RED_LOW,
  })),
  { label: "Prev preset", run: (c) => c.stepPreset?.(-1), led: (c) => (c?._presetSelect ? LED.AMBER_LOW : LED.OFF) },
  { label: "Next preset", run: (c) => c.stepPreset?.(1), led: (c) => (c?._presetSelect ? LED.AMBER_LOW : LED.OFF) },
  { label: "Random pattern", run: (c) => c.randomizePattern?.(), led: (c) => (typeof c?.randomize === "function" ? LED.AMBER_LOW : LED.OFF) },
  null,
];
const hasSchema = (c) => !!c?._paramSchema;
const PERFORM_BOTTOM = [
  { label: "Mutate subtle", run: (c) => c.mutate?.(MUTATE_AMOUNTS.subtle), led: (c) => (hasSchema(c) ? LED.GREEN_LOW : LED.OFF) },
  { label: "Mutate medium", run: (c) => c.mutate?.(MUTATE_AMOUNTS.medium), led: (c) => (hasSchema(c) ? LED.AMBER_LOW : LED.OFF) },
  { label: "Mutate wild", run: (c) => c.mutate?.(MUTATE_AMOUNTS.wild), led: (c) => (hasSchema(c) ? LED.RED_LOW : LED.OFF) },
  { label: "Randomize sound", run: (c) => c._randomizeAllParams?.(), led: (c) => (c?._presetSelect ? LED.RED_FULL : LED.OFF) },
  { label: "Undo sound", run: (c) => c.undoSound?.(), led: (c) => (c?._soundHistory?.canUndo ? LED.AMBER_FULL : LED.OFF) },
  { label: "Redo sound", run: (c) => c.redoSound?.(), led: (c) => (c?._soundHistory?.canRedo ? LED.AMBER_FULL : LED.OFF) },
  null,
  null,
];

/** Labels for the on-screen hardware map, per mode. */
export const BUTTON_LABELS = {
  [MODES.STEPS]: {
    top: TOP.map((_, i) => `Step ${i + 1}`),
    bottom: BOTTOM.map((_, i) => `Step ${i + 9}`),
  },
  [MODES.MIXER]: {
    top: TOP.map((_, i) => `Mute ${i + 1}`),
    bottom: BOTTOM.map((_, i) => `Focus ${i + 1}`),
  },
  [MODES.PERFORM]: {
    top: PERFORM_TOP.map((a) => a?.label ?? ""),
    bottom: PERFORM_BOTTOM.map((a) => a?.label ?? ""),
  },
};

/** Fader soft-takeover tolerance (0..1). */
const PICKUP_WINDOW = 0.04;

export class PerformanceSurface {
  /**
   * @param {object} o
   * @param {object} o.output              shared MidiOutput (LedFeedback's)
   * @param {object} [o.sequencerHardware] released while not in STEPS mode
   * @param {object} [o.autoMap]           knob paging + focus source
   */
  constructor({ output, sequencerHardware = null, autoMap = null, target = document } = {}) {
    this._out = output;
    this._seqHw = sequencerHardware;
    this._autoMap = autoMap;
    this._target = target;
    this._mode = MODES.STEPS;
    this._instruments = () => [];
    this._faders = FADERS.map(() => ({ picked: false, last: null, ctrl: null, set: null }));
    this._started = false;
    this._raf = null;

    this._onInput = (e) => this._handleInput(e.detail);
    this._onCommand = (e) => this.handleCommand(e.detail?.command);
    this._onChange = () => this.requestRefresh();
  }

  start() {
    if (this._started) return;
    this._started = true;
    this._target.addEventListener("wam-control-input", this._onInput);
    this._target.addEventListener("wam-command", this._onCommand);
    for (const ev of ["wam-instrument-focus-change", "wam-automap-change", "controls-change", "pattern-launched", "pattern-queued"]) {
      this._target.addEventListener(ev, this._onChange);
    }
    this._seqHw?.setEnabled?.(this._mode === MODES.STEPS);
    this.refresh();
  }

  stop() {
    this._target.removeEventListener("wam-control-input", this._onInput);
    this._target.removeEventListener("wam-command", this._onCommand);
    for (const ev of ["wam-instrument-focus-change", "wam-automap-change", "controls-change", "pattern-launched", "pattern-queued"]) {
      this._target.removeEventListener(ev, this._onChange);
    }
    this._started = false;
  }

  /** Provide the ordered instrument Controls list (slot 1 = index 0). */
  setInstrumentsProvider(fn) {
    this._instruments = fn;
    this.requestRefresh();
  }

  get mode() {
    return this._mode;
  }

  setMode(mode) {
    if (!Object.values(MODES).includes(mode) || mode === this._mode) return;
    this._mode = mode;
    // STEPS hands the 16 buttons to the sequencer mapping; other modes own them.
    this._seqHw?.setEnabled?.(mode === MODES.STEPS);
    this.refresh();
  }

  /** Commands from the side/arrow buttons (or keyboard mirrors). */
  handleCommand(command) {
    switch (command) {
      case COMMANDS.MODE_STEPS: return this.setMode(MODES.STEPS);
      case COMMANDS.MODE_MIXER: return this.setMode(MODES.MIXER);
      case COMMANDS.MODE_PERFORM: return this.setMode(MODES.PERFORM);
      case COMMANDS.PAGE_PREV: return this._autoMap?.stepPage(-1);
      case COMMANDS.PAGE_NEXT: return this._autoMap?.stepPage(1);
    }
  }

  get _focused() {
    return this._autoMap?.focused ?? null;
  }

  // ---- Input ----

  _handleInput(detail) {
    if (!detail?.binding || detail.binding.source !== "midi") return;
    const control = findControl(detail.binding);
    if (!control) return;
    if (control.kind === "fader") return this._handleFader(FADERS.indexOf(control.id), detail);
    if (this._mode === MODES.STEPS) return; // sequencer-hardware owns the buttons
    if (detail.kind !== "trigger" || detail.pressed === false) return;
    const top = TOP.indexOf(control.id);
    const bottom = BOTTOM.indexOf(control.id);
    if (top < 0 && bottom < 0) return;
    if (this._mode === MODES.MIXER) this._mixerPress(top, bottom);
    else this._performPress(top, bottom);
    this.requestRefresh();
  }

  /**
   * Press a channel button by position — same path as the hardware. Lets the
   * on-screen map (or a test) drive MIXER/PERFORM without a device.
   * @param {"top"|"bottom"} row
   * @param {number} i  0–7
   */
  pressButton(row, i) {
    const top = row === "top" ? i : -1;
    const bottom = row === "bottom" ? i : -1;
    if (this._mode === MODES.MIXER) this._mixerPress(top, bottom);
    else if (this._mode === MODES.PERFORM) this._performPress(top, bottom);
    else {
      const seq = this._focused?.sequencer;
      seq?.toggleStep?.(top >= 0 ? top : 8 + bottom);
    }
    this.requestRefresh();
  }

  _mixerPress(top, bottom) {
    const list = this._instruments();
    if (top >= 0) list[top]?.toggleMute?.();
    if (bottom >= 0 && list[bottom]) {
      list[bottom].dispatchEvent(new CustomEvent("wam-instrument-focus", { bubbles: true, detail: { controls: list[bottom] } }));
    }
  }

  _performPress(top, bottom) {
    const ctrl = this._focused;
    if (!ctrl) return;
    const action = top >= 0 ? PERFORM_TOP[top] : PERFORM_BOTTOM[bottom];
    action?.run(ctrl);
  }

  /** Fader → slot volume with soft takeover. */
  _handleFader(i, detail) {
    if (i < 0 || detail.value == null) return;
    const ctrl = this._instruments()[i];
    const state = this._faders[i];
    if (!ctrl?.setVolume || this._faderManuallyBound(FADERS[i])) return;
    const v = detail.value;
    const current = ctrl.volume;
    // Re-arm pickup when the slot's instrument changed or its volume moved elsewhere (UI, song load).
    if (state.ctrl !== ctrl || (state.set != null && Math.abs(current - state.set) > 0.02)) {
      state.picked = false;
      state.ctrl = ctrl;
    }
    if (!state.picked) {
      const crossed = state.last != null && (state.last - current) * (v - current) <= 0;
      if (Math.abs(v - current) <= PICKUP_WINDOW || crossed) state.picked = true;
    }
    state.last = v;
    if (state.picked) {
      ctrl.setVolume(v);
      state.set = v;
    }
    this._emitState();
  }

  /** A manual MIDI-learn binding on a fader (any instrument) takes it out of the mixer. */
  _faderManuallyBound(faderId) {
    return this._instruments().some((c) =>
      Object.values(c._paramBindings ?? {}).some((b) => findControl(b)?.id === faderId),
    );
  }

  /** Is fader i currently in control of its slot's volume? */
  faderPicked(i) {
    return !!this._faders[i]?.picked && this._faders[i].ctrl === this._instruments()[i];
  }

  // ---- LEDs + UI state ----

  /** Coalesce LED/state repaints to at most one per animation frame. */
  requestRefresh() {
    if (this._raf != null) return;
    const raf = globalThis.requestAnimationFrame ?? ((fn) => setTimeout(fn, 16));
    this._raf = raf(() => {
      this._raf = null;
      this.refresh();
    });
  }

  refresh() {
    this._paintSide();
    if (this._mode === MODES.MIXER) this._paintMixer();
    else if (this._mode === MODES.PERFORM) this._paintPerform();
    this._emitState();
  }

  _led(id, vel) {
    this._out?.queueControlLed?.(id, vel);
  }

  _paintSide() {
    for (const [mode, id] of Object.entries(MODE_BUTTONS)) this._led(id, mode === this._mode ? LED.YELLOW_FULL : LED.OFF);
    const pages = this._autoMap?.pageCount ?? 1;
    this._led("left", pages > 1 ? LED.RED_FULL : LED.OFF);
    this._led("right", pages > 1 ? LED.RED_FULL : LED.OFF);
    const many = this._instruments().length > 1;
    this._led("up", many ? LED.RED_LOW : LED.OFF);
    this._led("down", many ? LED.RED_LOW : LED.OFF);
  }

  _paintMixer() {
    const list = this._instruments();
    const focused = this._focused;
    TOP.forEach((id, i) => this._led(id, !list[i] ? LED.OFF : list[i].muted ? LED.RED_FULL : LED.GREEN_LOW));
    BOTTOM.forEach((id, i) => this._led(id, !list[i] ? LED.OFF : list[i] === focused ? LED.AMBER_FULL : LED.AMBER_LOW));
  }

  _paintPerform() {
    const ctrl = this._focused;
    TOP.forEach((id, i) => this._led(id, ctrl && PERFORM_TOP[i] ? PERFORM_TOP[i].led(ctrl) : LED.OFF));
    BOTTOM.forEach((id, i) => this._led(id, ctrl && PERFORM_BOTTOM[i] ? PERFORM_BOTTOM[i].led(ctrl) : LED.OFF));
  }

  /** Snapshot for the on-screen hardware map. */
  get state() {
    const list = this._instruments();
    const focused = this._focused;
    return {
      mode: this._mode,
      page: this._autoMap?.page ?? 0,
      pageCount: this._autoMap?.pageCount ?? 1,
      knobs: this._autoMap?.assignments ?? {},
      focusedTitle: focused?._defaultTitle?.() ?? null,
      buttons: BUTTON_LABELS[this._mode],
      faders: FADERS.map((_, i) => {
        const c = list[i];
        return c ? { title: c._defaultTitle?.() ?? `Slot ${i + 1}`, volume: c.volume, muted: c.muted, focused: c === focused, picked: this.faderPicked(i) } : null;
      }),
      patterns: focused?.patternNames?.map((p) => ({ name: p, playing: focused.playingPattern === p, queued: focused.queuedPattern === p })) ?? [],
    };
  }

  _emitState() {
    this._target.dispatchEvent(new CustomEvent("wam-hardware-state", { detail: this.state }));
  }
}

/** Shared singleton wired to the shared LED output, sequencer mapping and auto-map. */
export const performanceSurface = new PerformanceSurface({
  output: ledFeedback.output,
  sequencerHardware,
  autoMap,
});
