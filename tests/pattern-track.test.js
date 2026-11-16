import { describe, it, expect } from "vitest";
import { trackPosition, rotatedIndex, stepFires, cycleLength, PatternTrack } from "../src/web-audio/global/pattern-track.js";

const steps = (active) => Array.from({ length: 16 }, (_, i) => ({ active: active.includes(i), probability: 1, conditions: "off" }));

describe("trackPosition (pure, derived from the global tick)", () => {
  it("cycle length follows speed", () => {
    expect([cycleLength(1), cycleLength(2), cycleLength(0.5)]).toEqual([16, 8, 32]);
  });

  it("is a pure function of the tick — seeking works", () => {
    const p = { playEvery: 2, rotationOffset: 1, chainLength: 3 };
    expect(trackPosition(1000, p)).toEqual(trackPosition(1000, p));
    const at = trackPosition(16 * 6 + 5, p); // bar 6, step 5
    expect(at).toMatchObject({ cycle: 6, cycleTick: 5, played: true, playedCount: 3, chainIndex: 0, rotation: 3 });
  });

  it("density skips cycles; played cycles drive chain, rotation and conditions", () => {
    const p = { playEvery: 2, chainLength: 2 };
    expect(trackPosition(16, p).played).toBe(false);
    expect(trackPosition(16, p).slots).toEqual([]);
    expect(trackPosition(32, p)).toMatchObject({ played: true, playedCount: 1, chainIndex: 1 });
  });

  it("speed slots: 2x = two sub-steps per tick, 0.5x = every other tick", () => {
    expect(trackPosition(3, { speed: 2 }).slots).toEqual([{ index: 6, sub: 0, of: 2 }, { index: 7, sub: 1, of: 2 }]);
    expect(trackPosition(3, { speed: 0.5 }).slots).toEqual([]);
    expect(trackPosition(4, { speed: 0.5 }).slots).toEqual([{ index: 2, sub: 0, of: 1 }]);
  });

  it("rotation shifts left and wraps; interval groups played cycles", () => {
    expect(rotatedIndex(15, 1)).toBe(0);
    expect(trackPosition(16 * 5, { rotationOffset: 3, rotationIntervalBars: 2 }).rotation).toBe(6);
    expect(trackPosition(16 * 20, { rotationOffset: 3 }).rotation).toBe((20 * 3) % 16);
  });
});

describe("stepFires", () => {
  it("needs active, passes probability, and checks conditions against played cycles", () => {
    expect(stepFires({ active: false }, 0)).toBe(false);
    expect(stepFires({ active: true, probability: 0.5 }, 0, () => 0.4)).toBe(true);
    expect(stepFires({ active: true, probability: 0.5 }, 0, () => 0.6)).toBe(false);
    expect(stepFires({ active: true, conditions: "1:2" }, 0)).toBe(true);
    expect(stepFires({ active: true, conditions: "1:2" }, 1)).toBe(false);
  });
});

describe("PatternTrack (headless)", () => {
  it("plays a chain from data alone — no DOM", () => {
    const t = new PatternTrack({ patterns: { A: { steps: steps([0]) }, B: { steps: steps([8]) } }, chain: [0, 1] });
    const fired = [];
    for (let tick = 0; tick < 64; tick++) {
      const r = t.tick(tick, tick * 0.1, 0.1);
      for (const s of r.slots) if (s.fires) fired.push([tick, r.patternName, s.index]);
    }
    expect(fired).toEqual([[0, "A", 0], [24, "B", 8], [32, "A", 0], [56, "B", 8]]);
  });

  it("launch queues to the next cycle and replaces the shared chain in place", () => {
    const chain = [0, 1];
    const t = new PatternTrack({ patterns: { A: { steps: steps([0]) }, B: { steps: steps([4]) }, C: { steps: steps([2]) } }, chain });
    t.tick(0, 0, 0.1);
    t.launch("C");
    expect(t.queued).toBe("C");
    for (let tick = 1; tick < 16; tick++) t.tick(tick, 0, 0.1);
    const r = t.tick(16, 1.6, 0.1);
    expect(r.launched).toBe("C");
    expect(chain).toEqual([2]); // the UI's array sees it
    expect(t.queued).toBeNull();
  });

  it("launch on a boundary (or before playing) applies immediately", () => {
    const t = new PatternTrack({ patterns: { A: { steps: steps([0]) }, B: { steps: steps([4]) } }, chain: [0] });
    t.launch("B");
    expect(t.queued).toBeNull();
    expect(t.chain).toEqual([1]);
  });
});
