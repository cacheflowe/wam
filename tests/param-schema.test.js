import { describe, it, expect } from "vitest";
import {
  sliderDefs,
  toNormalized,
  fromNormalized,
  quantize,
  randRange,
  validateParams,
  VOLUME_DEF,
} from "../src/web-audio/global/param-schema.js";
import { randomizeInstrument, mutateInstrument, MUTATE_AMOUNTS } from "../src/web-audio/global/sound-design.js";
import WebAudioSynthAcid, { WebAudioSynthAcidControls } from "../src/web-audio/instruments/synth-acid.js";
import WebAudioSynthPoly, { WebAudioSynthPolyControls } from "../src/web-audio/instruments/synth-poly.js";
import WebAudioSynthMono, { WebAudioSynthMonoControls } from "../src/web-audio/instruments/synth-mono.js";
import WebAudioSynthPad, { WebAudioSynthPadControls } from "../src/web-audio/instruments/synth-pad.js";
import WebAudioPercKick, { WebAudioPercKickControls } from "../src/web-audio/instruments/perc-kick.js";
import WebAudioPercSnare, { WebAudioPercSnareControls } from "../src/web-audio/instruments/perc-snare.js";
import WebAudioPercHihat, { WebAudioPercHihatControls } from "../src/web-audio/instruments/perc-hihat.js";

// Instruments migrated to the schema: [name, Instrument, Controls]. Add each one as it moves over.
const MIGRATED = [
  ["WebAudioSynthAcid", WebAudioSynthAcid, WebAudioSynthAcidControls],
  ["WebAudioSynthPoly", WebAudioSynthPoly, WebAudioSynthPolyControls],
  ["WebAudioSynthMono", WebAudioSynthMono, WebAudioSynthMonoControls],
  ["WebAudioSynthPad", WebAudioSynthPad, WebAudioSynthPadControls],
  ["WebAudioPercKick", WebAudioPercKick, WebAudioPercKickControls],
  ["WebAudioPercSnare", WebAudioPercSnare, WebAudioPercSnareControls],
  ["WebAudioPercHihat", WebAudioPercHihat, WebAudioPercHihatControls],
];

describe("param-schema helpers", () => {
  const lin = { param: "x", min: 0, max: 10, step: 0.5 };
  const log = { param: "f", min: 50, max: 5000, step: 1, scale: "log" };

  it("normalizes linear and log params round-trip", () => {
    expect(toNormalized(lin, 5)).toBe(0.5);
    expect(fromNormalized(lin, 0.5)).toBe(5);
    expect(toNormalized(log, 500)).toBeCloseTo(0.5);
    expect(fromNormalized(log, 0.5)).toBe(500);
  });

  it("clamps and quantizes", () => {
    expect(quantize(lin, 3.3)).toBe(3.5);
    expect(quantize(lin, 99)).toBe(10);
    expect(quantize({ min: 0, max: 1, step: 0.1 }, 0.30000000000000004)).toBe(0.3);
    expect(toNormalized(lin, -5)).toBe(0);
  });

  it("randRange uses curated range, falls back to full range, honors rand:false", () => {
    expect(randRange({ ...lin, rand: { min: 2, max: 4 } })).toEqual({ min: 2, max: 4 });
    expect(randRange(lin)).toEqual({ min: 0, max: 10 });
    expect(randRange({ ...lin, rand: false })).toBeNull();
  });

  it("sliderDefs = volume + numeric params only", () => {
    const defs = sliderDefs([lin, { param: "w", type: "enum", options: ["a"] }, { param: "b", type: "bool" }]);
    expect(defs.map((d) => d.param)).toEqual([VOLUME_DEF.param, "x"]);
  });

  it("validateParams flags bad entries", () => {
    const problems = validateParams([
      { param: "a", min: 1, max: 0 },
      { param: "b", min: 0, max: 1, role: "nope" },
      { param: "c", min: 0, max: 1, rand: { min: -1, max: 1 } },
      { param: "d", type: "enum", options: ["x", "y"], rand: { weights: [1] } },
    ]);
    expect(problems).toHaveLength(4);
  });
});

describe.each(MIGRATED)("%s schema", (name, Cls, Controls) => {
  it("Controls SLIDER_DEFS derive from PARAMS", () => {
    expect(Controls.SLIDER_DEFS).toEqual(sliderDefs(Cls.PARAMS));
  });

  it("randomize/mutate stay in rand ranges and never touch rand:false params", () => {
    const inst = new Cls(new AudioContext());
    const fixed = Object.fromEntries(Cls.PARAMS.filter((d) => d.rand === false).map((d) => [d.param, inst[d.param]]));
    for (let i = 0; i < 100; i++) {
      const v = i % 2 ? mutateInstrument(inst, MUTATE_AMOUNTS.wild) : randomizeInstrument(inst);
      for (const def of Cls.PARAMS) {
        if (def.rand === false) {
          expect(v[def.param], def.param).toEqual(fixed[def.param]);
          continue;
        }
        if ((def.type ?? "number") === "number") {
          // constrain() may pull a value tighter, never outside the param's own range.
          expect(v[def.param], def.param).toBeGreaterThanOrEqual(def.min);
          expect(v[def.param], def.param).toBeLessThanOrEqual(def.max);
        } else if (def.type === "enum") {
          expect(def.options, def.param).toContain(v[def.param]);
        }
      }
    }
  });

  it("is valid", () => {
    expect(validateParams(Cls.PARAMS, name)).toEqual([]);
  });

  it("covers every preset key, with values inside each param's range", () => {
    const names = new Set([...Cls.PARAMS.map((d) => d.param), "volume"]);
    for (const [presetName, preset] of Object.entries(Cls.PRESETS ?? {})) {
      for (const [key, value] of Object.entries(preset)) {
        expect(names.has(key), `${presetName}.${key} not in PARAMS`).toBe(true);
        const def = Cls.PARAMS.find((d) => d.param === key);
        if (def && (def.type ?? "number") === "number") {
          expect(value, `${presetName}.${key}`).toBeGreaterThanOrEqual(def.min);
          expect(value, `${presetName}.${key}`).toBeLessThanOrEqual(def.max);
        }
        if (def?.type === "enum") expect(def.options, `${presetName}.${key}`).toContain(value);
      }
    }
  });
});

