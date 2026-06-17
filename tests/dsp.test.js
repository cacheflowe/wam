// Unit tests for shared DSP primitives. The snapshot tests cover scheduled
// automation but not waveshaper curve contents, so the distortion curve is
// verified here against its mathematical definition.

import { describe, it, expect } from "vitest";
import { makeSoftClipCurve } from "../src/web-audio/global/dsp/distortion.js";

describe("makeSoftClipCurve", () => {
  it("is the identity at amount 0", () => {
    const c = makeSoftClipCurve(0);
    expect(c.length).toBe(512);
    for (let i = 0; i < c.length; i++) {
      const x = (i * 2) / 512 - 1;
      expect(c[i]).toBeCloseTo(x, 10);
    }
  });

  it("matches the soft-clip formula at amount 0.5", () => {
    const amount = 0.5;
    const k = amount * 200;
    const c = makeSoftClipCurve(amount);
    for (const i of [0, 128, 256, 384, 511]) {
      const x = (i * 2) / 512 - 1;
      const expected = ((Math.PI + k) * x) / (Math.PI + k * Math.abs(x));
      // Float32Array storage gives ~7 significant digits of precision.
      expect(c[i]).toBeCloseTo(expected, 6);
    }
  });

  it("supports a custom resolution", () => {
    expect(makeSoftClipCurve(1, 256).length).toBe(256);
  });
});
