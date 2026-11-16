// Characterization tests for pattern playback (architecture-refactor Phase 0).
//
// They pin what Controls.step() does TODAY, driven only through the song
// format (fromJSON) + step()/resetSequencer(), so they keep passing when
// playback moves into a headless engine. Behaviors that look wrong are pinned
// too and labelled KNOWN BUG / QUESTION — fixing one should be a deliberate,
// visible edit to that test.

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

  it("QUESTION: resetSequencer keeps the chain position — Stop → Play mid-chain resumes on the current pattern, not pattern 1", () => {
    const t = mountTrack(trackState({ patterns: { A: [0], B: [8] }, chain: [0, 1] })).run(BAR + 4); // now in B
    t.ctrl.resetSequencer();
    t.fired.length = 0;
    t.run(BAR);
    // If Play should restart the chain from the top: [0]
    expect(t.fired.map((f) => f.index)).toEqual([8]);
  });
});

describe("pattern playback — density (playEvery)", () => {
  it("plays every Nth bar and is silent in between", () => {
    const t = mountTrack(trackState({ patterns: { A: [0, 8] }, playEvery: 2 })).run(4 * BAR);
    expect(t.byBar(4)).toEqual([[0, 8], [], [0, 8], []]);
  });

  it("KNOWN BUG: with density, the chain advances every 2 *played* bars (A A B B), not every played bar (A B)", () => {
    const t = mountTrack(trackState({ patterns: { A: [0], B: [8] }, chain: [0, 1], playEvery: 2 })).run(8 * BAR);
    // Expected once fixed: [[0], [], [8], [], [0], [], [8], []]
    expect(t.byBar(8)).toEqual([[0], [], [0], [], [8], [], [8], []]);
  });
});

describe("pattern playback — rotation", () => {
  it("shifts the pattern left by N steps each bar", () => {
    const t = mountTrack(trackState({ patterns: { A: [0] }, rotationOffset: 1 })).run(4 * BAR);
    expect(t.byBar(4)).toEqual([[0], [15], [14], [13]]);
  });

  it("respects the rotation interval (bars)", () => {
    const t = mountTrack(trackState({ patterns: { A: [0] }, rotationOffset: 1, rotationIntervalBars: 2 })).run(5 * BAR);
    expect(t.byBar(5)).toEqual([[0], [0], [15], [15], [14]]);
  });

  it("with density, rotates once per played bar (audible result)", () => {
    const t = mountTrack(trackState({ patterns: { A: [0] }, rotationOffset: 1, playEvery: 2 })).run(6 * BAR);
    expect(t.byBar(6)).toEqual([[0], [], [15], [], [14], []]);
  });

  it("KNOWN BUG: with density, rotate() runs on every tick of a skipped bar (net-zero, but floods step-change events)", () => {
    const t = mountTrack(trackState({ patterns: { A: [0] }, rotationOffset: 3, playEvery: 2 }));
    let rotations = 0;
    const orig = t.ctrl._seq.rotate.bind(t.ctrl._seq);
    t.ctrl._seq.rotate = (n) => {
      rotations++;
      return orig(n);
    };
    t.run(8 * BAR);
    // Expected once fixed: 3 (one per played bar after the first). 16 extra per skipped bar today.
    expect(rotations).toBe(67);
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

  it("QUESTION: with density 2, a 1:2 condition fires on every played bar (counts real bars, and played bars are all even)", () => {
    const t = mountTrack(trackState({ patterns: { A: steps([0], { 0: { conditions: "1:2" } }) }, playEvery: 2 })).run(8 * BAR);
    // If conditions should count *played* bars instead: [[0], [], [], [], [0], [], [], []]
    expect(t.byBar(8)).toEqual([[0], [], [0], [], [0], [], [0], []]);
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
