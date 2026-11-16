import { describe, it, expect } from "vitest";
import { INSTRUMENTS, instrumentDef, createInstrument, controlsOptions } from "../src/web-audio/instruments/registry.js";

describe("instrument registry", () => {
  it("ids are unique and every entry is complete", () => {
    expect(new Set(INSTRUMENTS.map((d) => d.id)).size).toBe(INSTRUMENTS.length);
    for (const d of INSTRUMENTS) {
      expect(d.label, d.id).toBeTruthy();
      expect(d.color, d.id).toBeTruthy();
      expect(typeof d.Instrument, d.id).toBe("function");
      expect(customElements.get(d.controlsTag), `${d.id} → <${d.controlsTag}> registered`).toBeTruthy();
    }
  });

  it("creates every instrument type", () => {
    const ctx = new AudioContext();
    for (const d of INSTRUMENTS) expect(createInstrument(d.id, ctx), d.id).toBeInstanceOf(d.Instrument);
    expect(() => createInstrument("nope", ctx)).toThrow(/Unknown instrument/);
  });

  it("controls options: color, FX defaults + bpm, sample files for sample-based types", () => {
    expect(controlsOptions(instrumentDef("acid"), { bpm: 120 })).toEqual({
      color: "#8f0",
      fx: { bpm: 120, reverbWet: 0.15, delayInterval: 0.75, delayFeedback: 0.35, delayMix: 0 },
    });
    expect(controlsOptions(instrumentDef("sampler-kicks"), { bpm: 90, files: ["a.wav"] })).toEqual({
      color: "#f8a", fx: { bpm: 90 }, files: ["a.wav"], basePath: "",
    });
    expect(controlsOptions(instrumentDef("vocoder"), { bpm: 90 })).toEqual({ color: "#4fd" });
  });

  it("sequenced types expose Controls.step()", () => {
    for (const d of INSTRUMENTS.filter((x) => x.sequenced)) {
      expect(typeof customElements.get(d.controlsTag).prototype.step, d.id).toBe("function");
    }
  });
});
