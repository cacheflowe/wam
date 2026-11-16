/**
 * Track harness for pattern-playback characterization tests.
 *
 * Mounts a REAL Controls panel (FX unit off) in jsdom, loads a track through
 * fromJSON() — the same `state` shape songs store per instrument — then ticks
 * step() the way the playground's sequencer does and records what fires.
 *
 * Tests written against this harness only use the song format + step() /
 * resetSequencer(), so they keep passing when pattern playback moves out of
 * Controls into a headless engine (architecture-refactor Phase 1).
 */
import "../../src/web-audio/ui/step-seq.js";
import "../../src/web-audio/ui/waveform.js";
import "../../src/web-audio/ui/level-meter.js";
import "../../src/web-audio/ui/knob.js";
import "../../src/web-audio/ui/slider.js";
import WebAudioPercKick, { WebAudioPercKickControls } from "../../src/web-audio/instruments/perc-kick.js";

let tagCounter = 0;

/** 16 steps; `active` = indices that are on. `overrides` = { [index]: {probability, ratchet, conditions, …} }. */
export function steps(active = [], overrides = {}) {
  return Array.from({ length: 16 }, (_, i) => ({
    active: active.includes(i),
    note: 36,
    accent: false,
    probability: 1,
    ratchet: 1,
    conditions: "off",
    ...(overrides[i] ?? {}),
  }));
}

/** Song-format track state. `patterns` = { A: [...active], B: … } or full step arrays. */
export function trackState({ patterns = { A: [0] }, chain = [0], playEvery = 1, rotationOffset = 0, rotationIntervalBars = 1, speed = 1 } = {}) {
  const pats = {};
  for (const name of ["A", "B", "C", "D"]) {
    const p = patterns[name];
    pats[name] = { steps: Array.isArray(p) && typeof p[0] === "object" ? p : steps(p ?? []) };
  }
  return {
    patterns: pats,
    chain,
    patternParams: { playEvery, rotationOffset, rotationIntervalBars },
    speedMultiplier: speed,
  };
}

/**
 * Mount a track. Returns helpers:
 *   run(ticks)      tick step() `ticks` times (16 ticks = 1 bar), recording fires
 *   fired           [{ tick, bar, index, time, dur }]  (triggerSequenceStep calls)
 *   hits            [{ time }]                          (instrument.trigger calls — ratchets show here)
 *   byBar(n)        fired step indices grouped per bar for the first n bars
 */
export function mountTrack(state, { Instrument = WebAudioPercKick, Controls = WebAudioPercKickControls, stepDur = 0.125 } = {}) {
  const tag = `test-track-${++tagCounter}`;
  customElements.define(
    tag,
    class extends Controls {
      _createFxUnit() {
        return null;
      }
    },
  );
  const ctx = new AudioContext();
  const inst = new Instrument(ctx);
  const ctrl = document.createElement(tag);
  document.body.appendChild(ctrl);
  ctrl.bind(inst, ctx, {});
  if (state) ctrl.fromJSON(state);
  ctrl.resetSequencer();

  const fired = [];
  const hits = [];
  let tick = 0;
  const origStep = inst.triggerSequenceStep.bind(inst);
  inst.triggerSequenceStep = (index, s, time, dur) => {
    fired.push({ tick, bar: Math.floor(tick / 16), index, time, dur });
    return origStep(index, s, time, dur);
  };
  const origTrigger = inst.trigger.bind(inst);
  inst.trigger = (...args) => {
    hits.push({ tick, args });
    return origTrigger(...args);
  };
  const jams = [];
  const origJam = ctrl._triggerJam.bind(ctrl);
  ctrl._triggerJam = (time, dur) => {
    jams.push({ tick, time });
    return origJam(time, dur);
  };

  const api = {
    ctrl,
    inst,
    fired,
    hits,
    jams,
    get tick() {
      return tick;
    },
    run(ticks) {
      for (let i = 0; i < ticks; i++, tick++) ctrl.step(tick % 16, tick * stepDur, stepDur);
      return api;
    },
    byBar(nBars) {
      const out = Array.from({ length: nBars }, () => []);
      for (const f of fired) if (f.bar < nBars) out[f.bar].push(f.index);
      return out;
    },
    unmount() {
      ctrl.remove();
    },
  };
  return api;
}
