// Characterization tests for pattern playback (architecture-refactor Phase 0).
//
// Driven only through the song format (fromJSON) + step()/resetSequencer(),
// so they survived moving playback into the headless PatternTrack unchanged
// (Phase 1). The former KNOWN BUG / QUESTION tests now state the fixed /
// decided behavior and say what it was before.

import { describe, it, expect, vi, afterEach } from "vitest";
import { mountTrack, trackState, steps } from "./helpers/track-harness.js";

const BAR = 16;

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("pattern playback — basics", () => {
  it("loops a single pattern every bar", () => {
    const t = mountTrack(trackState({ patterns: { A: [0, 4, 8, 12] } })).run(2 * BAR);
    expect(t.byBar(2)).toEqual([[0, 4, 8, 12], [0, 4, 8, 12]]);
  });

  it("fires at the tick's scheduled time with the step duration", () => {
    const t = mountTrack(trackState({ patterns: { A: [4] } })).run(BAR);
    expect(t.fired).toEqual([{ tick: 4, bar: 0, index: 4, time: 0.5, dur: 0.125 }]);
  });

  it("chain plays patterns in order and wraps", () => {
    const t = mountTrack(trackState({ patterns: { A: [0], B: [8] }, chain: [0, 1] })).run(4 * BAR);
    expect(t.byBar(4)).toEqual([[0], [8], [0], [8]]);
  });

  it("resetSequencer restarts the pattern at step 0", () => {
    const t = mountTrack(trackState({ patterns: { A: [0, 8] } })).run(4);
    t.ctrl.resetSequencer();
    t.fired.length = 0;
    t.run(BAR);
    expect(t.fired.map((f) => f.index)).toEqual([0, 8]);
  });

  it("Stop → Play mid-chain restarts the chain from pattern 1 (decided 2026-11-16; was: resumed on the current pattern)", () => {
    const t = mountTrack(trackState({ patterns: { A: [0], B: [8] }, chain: [0, 1] })).run(BAR + 4); // now in B
    t.ctrl.resetSequencer();
    t.fired.length = 0;
    t.run(BAR);
    expect(t.fired.map((f) => f.index)).toEqual([0]);
  });
});

describe("pattern playback — density (playEvery)", () => {
  it("plays every Nth bar and is silent in between", () => {
    const t = mountTrack(trackState({ patterns: { A: [0, 8] }, playEvery: 2 })).run(4 * BAR);
    expect(t.byBar(4)).toEqual([[0, 8], [], [0, 8], []]);
  });

  it("with density, the chain advances every played bar (fixed; was A A B B)", () => {
    const t = mountTrack(trackState({ patterns: { A: [0], B: [8] }, chain: [0, 1], playEvery: 2 })).run(8 * BAR);
    expect(t.byBar(8)).toEqual([[0], [], [8], [], [0], [], [8], []]);
  });
});

describe("pattern playback — rotation", () => {
  it("shifts the pattern left by N steps each bar (where hits land)", () => {
    const t = mountTrack(trackState({ patterns: { A: [0] }, rotationOffset: 1 })).run(4 * BAR);
    expect(t.positionsByBar(4)).toEqual([[0], [15], [14], [13]]);
  });

  it("respects the rotation interval (bars)", () => {
    const t = mountTrack(trackState({ patterns: { A: [0] }, rotationOffset: 1, rotationIntervalBars: 2 })).run(5 * BAR);
    expect(t.positionsByBar(5)).toEqual([[0], [0], [15], [15], [14]]);
  });

  it("with density, rotates once per played bar", () => {
    const t = mountTrack(trackState({ patterns: { A: [0] }, rotationOffset: 1, playEvery: 2 })).run(6 * BAR);
    expect(t.positionsByBar(6)).toEqual([[0], [], [15], [], [14], []]);
  });

  it("rotation is applied at read time — the stored pattern never moves and no step-change storm (fixed; was 67 rotate() calls / 8 bars)", () => {
    const t = mountTrack(trackState({ patterns: { A: [0] }, rotationOffset: 3, playEvery: 2 }));
    let rotations = 0;
    let stepChanges = 0;
    const orig = t.ctrl._seq.rotate.bind(t.ctrl._seq);
    t.ctrl._seq.rotate = (n) => {
      rotations++;
      return orig(n);
    };
    t.ctrl._seq.addEventListener("step-change", () => stepChanges++);
    t.run(8 * BAR);
    expect(rotations).toBe(0);
    expect(stepChanges).toBe(0);
    expect(t.ctrl.toJSON().patterns.A.steps.findIndex((s) => s.active)).toBe(0);
  });
});

describe("pattern playback — speed multiplier", () => {
  it("2x plays the 16-step pattern twice per bar", () => {
    const t = mountTrack(trackState({ patterns: { A: [0] }, speed: 2 })).run(2 * BAR);
    expect(t.fired.map((f) => [f.tick, f.index])).toEqual([[0, 0], [8, 0], [16, 0], [24, 0]]);
  });

  it("2x splits each tick into two sub-steps (second at +half a step)", () => {
    const t = mountTrack(trackState({ patterns: { A: [1] }, speed: 2 })).run(1);
    expect(t.fired).toEqual([{ tick: 0, bar: 0, index: 1, time: 0.0625, dur: 0.0625 }]);
  });

  it("0.5x plays one step every other tick (pattern spans 2 bars)", () => {
    const t = mountTrack(trackState({ patterns: { A: [0, 1] }, speed: 0.5 })).run(4 * BAR);
    expect(t.fired.map((f) => [f.tick, f.index])).toEqual([[0, 0], [2, 1], [32, 0], [34, 1]]);
  });
});

describe("pattern playback — per-step options", () => {
  it("probability: fires when Math.random() < probability", () => {
    const seq = [0.1, 0.9, 0.1, 0.9];
    let k = 0;
    vi.spyOn(Math, "random").mockImplementation(() => seq[k++ % seq.length]);
    const t = mountTrack(trackState({ patterns: { A: steps([0], { 0: { probability: 0.5 } }) } })).run(4 * BAR);
    expect(t.byBar(4)).toEqual([[0], [], [0], []]);
  });

  it("trig condition 1:2 fires on the first of every two bars", () => {
    const t = mountTrack(trackState({ patterns: { A: steps([0], { 0: { conditions: "1:2" } }) } })).run(4 * BAR);
    expect(t.byBar(4)).toEqual([[0], [], [0], []]);
  });

  it("trig conditions count pattern cycles at 0.5x (1:2 → real bars 0 and 4)", () => {
    const t = mountTrack(trackState({ patterns: { A: steps([0], { 0: { conditions: "1:2" } }) }, speed: 0.5 })).run(8 * BAR);
    expect(t.fired.map((f) => f.bar)).toEqual([0, 4]);
  });

  it("trig conditions count played cycles: with density 2, 1:2 fires on every other played bar (decided 2026-11-16; was every played bar)", () => {
    const t = mountTrack(trackState({ patterns: { A: steps([0], { 0: { conditions: "1:2" } }) }, playEvery: 2 })).run(8 * BAR);
    expect(t.byBar(8)).toEqual([[0], [], [], [], [0], [], [], []]);
  });

  it("ratchet N triggers the instrument N times within the step, evenly spaced", () => {
    const t = mountTrack(trackState({ patterns: { A: steps([0], { 0: { ratchet: 3 } }) } })).run(BAR);
    expect(t.fired).toHaveLength(1);
    const times = t.hits.map((h) => h.args[1]); // kick.trigger(velocity, atTime)
    expect(times).toHaveLength(3);
    expect(times[0]).toBeCloseTo(0);
    expect(times[1]).toBeCloseTo(0.125 / 3);
    expect(times[2]).toBeCloseTo((2 * 0.125) / 3);
  });
});

describe("pattern playback — jam + launch", () => {
  it("a queued jam plays only on a tick where no step fired", () => {
    const t = mountTrack(trackState({ patterns: { A: [0] } }));
    t.ctrl._queueJam();
    t.run(1); // step 0 fires → jam swallowed
    t.ctrl._queueJam();
    t.run(1); // step 1 empty → jam plays
    expect(t.jams.map((j) => j.tick)).toEqual([1]);
  });

  it("launchPattern mid-bar queues until the next bar, then loops alone", () => {
    const t = mountTrack(trackState({ patterns: { A: [0], B: [4] }, chain: [0, 1] })).run(6);
    t.ctrl.launchPattern("B");
    expect(t.ctrl.queuedPattern).toBe("B");
    t.run(BAR - 6 + 2 * BAR);
    expect(t.byBar(3)).toEqual([[0], [4], [4]]);
    expect(t.ctrl.queuedPattern).toBeNull();
    expect(t.ctrl.playingPattern).toBe("B");
  });

  it("launchPattern on a bar boundary switches immediately", () => {
    const t = mountTrack(trackState({ patterns: { A: [0], B: [4] } }));
    t.ctrl.launchPattern("B");
    expect(t.ctrl.queuedPattern).toBeNull();
    t.run(BAR);
    expect(t.byBar(1)).toEqual([[4]]);
  });
});
