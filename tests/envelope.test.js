// Envelope scheduling — evaluate the automation timeline the way Web Audio
// does (events sorted by time; each ramp starts from the previous event) and
// assert the *audible* contour, not just the call list.

import { describe, it, expect } from "vitest";
import { scheduleEnvelope, applyADSR, applyFilterEnv } from "../src/web-audio/global/dsp/envelope.js";

/** AudioParam stand-in that records events and can evaluate value(t). */
function makeParam() {
  const events = [];
  const push = (type) => (value, time) => {
    events.push({ type, value, time });
  };
  return {
    events,
    setValueAtTime: push("set"),
    linearRampToValueAtTime: push("linear"),
    exponentialRampToValueAtTime: push("exp"),
    valueAt(t) {
      const sorted = events.map((e, i) => ({ ...e, i })).sort((a, b) => a.time - b.time || a.i - b.i);
      let prev = null;
      for (const e of sorted) {
        if (t < e.time) {
          if (!prev) return 0;
          if (e.type === "set") return prev.value;
          const f = (t - prev.time) / (e.time - prev.time);
          return e.type === "linear"
            ? prev.value + (e.value - prev.value) * f
            : prev.value * Math.pow(e.value / prev.value, f);
        }
        prev = e;
      }
      return prev ? prev.value : 0;
    },
  };
}

const sample = (p, from, to, n = 400) =>
  Array.from({ length: n + 1 }, (_, i) => from + ((to - from) * i) / n).map((t) => [t, p.valueAt(t)]);

/** After note-off the level must only fall (no post-release swell). */
function expectMonotonicRelease(p, releaseAt, end, floor = 0) {
  let last = Infinity;
  for (const [, v] of sample(p, releaseAt, end + 1)) {
    expect(v).toBeLessThanOrEqual(last + 1e-9);
    last = v;
  }
  expect(p.valueAt(end + 1)).toBeCloseTo(floor, 6);
}

describe("scheduleEnvelope", () => {
  it("full note: reaches peak, decays to sustain, holds, releases", () => {
    const p = makeParam();
    const lvl = scheduleEnvelope(p, { start: 0, releaseAt: 2, peak: 1, sustain: 0.5, attack: 0.1, decay: 0.2, release: 0.3 });
    expect(lvl).toBe(0.5);
    expect(p.valueAt(0.1)).toBeCloseTo(1);
    expect(p.valueAt(1)).toBeCloseTo(0.5);
    expect(p.valueAt(2.15)).toBeCloseTo(0.25);
    expectMonotonicRelease(p, 2, 2.3);
  });

  it("note shorter than attack: releases from the partial attack level, never swells", () => {
    const p = makeParam();
    const lvl = scheduleEnvelope(p, { start: 0, releaseAt: 0.1, peak: 1, sustain: 0.8, attack: 0.5, decay: 0.4, release: 0.2 });
    expect(lvl).toBeCloseTo(0.2);
    expect(p.valueAt(0.05)).toBeCloseTo(0.1); // still rising during the note
    expectMonotonicRelease(p, 0.1, 0.3);
    for (const [, v] of sample(p, 0, 5)) expect(v).toBeLessThanOrEqual(0.2 + 1e-9);
  });

  it("note released mid-decay: releases from the partial decay level", () => {
    const p = makeParam();
    const lvl = scheduleEnvelope(p, { start: 0, releaseAt: 0.3, peak: 1, sustain: 0.6, attack: 0.1, decay: 0.4, release: 0.1 });
    expect(lvl).toBeCloseTo(0.8);
    expectMonotonicRelease(p, 0.3, 0.4);
  });

  it("zero-length note is silent", () => {
    const p = makeParam();
    scheduleEnvelope(p, { start: 1, releaseAt: 1, peak: 1, sustain: 1, attack: 0.5, decay: 0, release: 0.1 });
    for (const [, v] of sample(p, 0, 3)) expect(v).toBeCloseTo(0, 9);
  });

  it("exponential curve: partial-decay level follows the exponential path", () => {
    const p = makeParam();
    const lvl = scheduleEnvelope(p, {
      start: 0, releaseAt: 0.3, from: 0.0001, to: 0.0001, peak: 1, sustain: 0.25,
      attack: 0.1, decay: 0.4, release: 0.05, curve: "exponential",
    });
    expect(lvl).toBeCloseTo(0.5); // halfway through decay: 1 · 0.25^0.5
    expectMonotonicRelease(p, 0.3, 0.35, 0.0001);
  });

  it("events are scheduled in chronological order", () => {
    for (const releaseAt of [0.05, 0.3, 0.6, 2]) {
      const p = makeParam();
      scheduleEnvelope(p, { start: 0, releaseAt, peak: 1, sustain: 0.5, attack: 0.25, decay: 0.25, release: 0.1 });
      const times = p.events.map((e) => e.time);
      expect(times).toEqual([...times].sort((a, b) => a - b));
    }
  });
});

describe("applyADSR / applyFilterEnv wrappers", () => {
  it("applyADSR: sustain is a fraction of peak; short note never swells", () => {
    const p = makeParam();
    applyADSR(p, { start: 0, peak: 0.8, attack: 1, decay: 1, sustain: 0.5, release: 0.5, releaseAt: 0.25 });
    expect(p.valueAt(0.25)).toBeCloseTo(0.2);
    expectMonotonicRelease(p, 0.25, 0.75);
  });

  it("applyFilterEnv: returns peak/sus and returns to base after release", () => {
    const p = makeParam();
    const { peak, sus } = applyFilterEnv(p, {
      base: 500, envAmtOctaves: 2, sustain: 0.5, attack: 0.1, decay: 0.1, release: 0.2, start: 0, releaseAt: 1,
    });
    expect(peak).toBe(2000);
    expect(sus).toBe(1250);
    expect(p.valueAt(0.1)).toBeCloseTo(2000);
    expect(p.valueAt(5)).toBeCloseTo(500);
  });
});
