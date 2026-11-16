import { describe, it, expect, afterEach } from "vitest";
import { Clock, positionAt } from "../src/web-audio/global/clock.js";
import { mountTrack, trackState } from "./helpers/track-harness.js";

describe("Clock", () => {
  it("positionAt derives step / bar / beat / downbeat from the tick", () => {
    expect(positionAt(0)).toEqual({ tick: 0, step: 0, bar: 0, beat: 0, downbeat: true });
    expect(positionAt(37)).toEqual({ tick: 37, step: 5, bar: 2, beat: 1, downbeat: false });
  });

  it("advance() emits consecutive ticks with time, dur and bpm; current tracks the latest", () => {
    const c = new Clock(new AudioContext(), { bpm: 120 });
    const seen = [];
    const off = c.onTick((p) => seen.push(p));
    c.advance(1);
    c.advance(1.125);
    expect(seen.map((p) => p.tick)).toEqual([0, 1]);
    expect(seen[1]).toMatchObject({ step: 1, time: 1.125, dur: 0.125, bpm: 120 });
    expect(c.current.tick).toBe(1);
    off();
    c.advance(2);
    expect(seen).toHaveLength(2);
  });

  it("start() / rewind() go back to tick 0", () => {
    const c = new Clock(new AudioContext());
    c.advance(0);
    c.advance(0);
    c.rewind();
    expect(c.current).toBeNull();
    expect(c.advance(0).tick).toBe(0);
  });

  it("is a drop-in for sequencer consumers (bpm, onStep, stepDurationSec)", () => {
    const c = new Clock(new AudioContext(), { bpm: 60 });
    const steps = [];
    c.onStep((step, time) => steps.push([step, time]));
    c.advance(5);
    expect(steps).toEqual([[0, 5]]);
    c.bpm = 120;
    expect(c.stepDurationSec()).toBeCloseTo(0.125);
  });
});

describe("panels follow the global clock", () => {
  afterEach(() => (document.body.innerHTML = ""));

  it("a panel added mid-song joins at the GLOBAL chain position (in step with the others)", () => {
    const clock = new Clock(new AudioContext(), { bpm: 120 });
    for (let i = 0; i < 16 * 7; i++) clock.advance(i * 0.125); // 7 bars in
    const t = mountTrack(trackState({ patterns: { A: [0], B: [8] }, chain: [0, 1] }));
    t.ctrl.clock = clock;
    const fired = [];
    const orig = t.inst.triggerSequenceStep.bind(t.inst);
    t.inst.triggerSequenceStep = (index, ...rest) => (fired.push([clock.current.bar, index]), orig(index, ...rest));
    clock.onTick((p) => t.ctrl.step(p.step, p.time, p.dur));
    for (let i = 0; i < 32; i++) clock.advance((16 * 7 + i) * 0.125);
    expect(fired).toEqual([[7, 8], [8, 0]]); // bar 7 = B (odd bar), bar 8 = A
  });
});
