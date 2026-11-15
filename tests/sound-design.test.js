import { describe, it, expect } from "vitest";
import {
  randomizeValues,
  mutateValues,
  captureValues,
  randomizeInstrument,
  mutateInstrument,
  SoundHistory,
  MUTATE_AMOUNTS,
} from "../src/web-audio/global/sound-design.js";
import { randRange } from "../src/web-audio/global/param-schema.js";
import WebAudioSynthAcid from "../src/web-audio/instruments/synth-acid.js";

/** Deterministic PRNG (mulberry32). */
function seeded(seed = 1) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PARAMS = [
  { param: "cutoff", min: 50, max: 10000, step: 1, scale: "log", group: "filter", rand: { min: 200, max: 2000 } },
  { param: "res", min: 0, max: 30, step: 0.1, group: "filter", rand: { min: 2, max: 10 } },
  { param: "decay", min: 0.01, max: 2, step: 0.01, group: "amp-env" },
  { param: "octave", min: -2, max: 2, step: 1, rand: false },
  { param: "wave", type: "enum", options: ["saw", "square"], rand: { weights: [1, 0] } },
];
const CURRENT = { cutoff: 600, res: 5, decay: 0.5, octave: 1, wave: "square" };

describe("randomizeValues", () => {
  it("stays inside curated ranges and never touches rand:false params", () => {
    const rng = seeded(7);
    for (let i = 0; i < 500; i++) {
      const v = randomizeValues(PARAMS, CURRENT, { rng });
      expect(v.cutoff).toBeGreaterThanOrEqual(200);
      expect(v.cutoff).toBeLessThanOrEqual(2000);
      expect(v.res).toBeGreaterThanOrEqual(2);
      expect(v.res).toBeLessThanOrEqual(10);
      expect(v.decay).toBeGreaterThanOrEqual(0.01);
      expect(v.decay).toBeLessThanOrEqual(2);
      expect(v.octave).toBe(1);
      expect(v.wave).toBe("saw"); // weight 0 on square
    }
  });

  it("log params are drawn log-uniformly (median near the geometric mean)", () => {
    const rng = seeded(3);
    const draws = Array.from({ length: 2001 }, () => randomizeValues(PARAMS, CURRENT, { rng }).cutoff).sort((a, b) => a - b);
    const median = draws[1000];
    expect(median).toBeGreaterThan(500); // geometric mean of 200..2000 ≈ 632
    expect(median).toBeLessThan(800); //    (linear mean would be 1100)
  });

  it("respects locks by group and by param name", () => {
    const rng = seeded(9);
    const byGroup = randomizeValues(PARAMS, CURRENT, { rng, locks: new Set(["filter"]) });
    expect(byGroup.cutoff).toBe(600);
    expect(byGroup.res).toBe(5);
    const byName = randomizeValues(PARAMS, CURRENT, { rng, locks: new Set(["decay"]) });
    expect(byName.decay).toBe(0.5);
  });

  it("applies the constrain hook and does not mutate the input", () => {
    const input = { ...CURRENT };
    const v = randomizeValues(PARAMS, input, { rng: seeded(1), constrain: (x) => ({ ...x, res: 0 }) });
    expect(v.res).toBe(0);
    expect(input).toEqual(CURRENT);
  });
});

describe("mutateValues", () => {
  it("amount 0 is the identity", () => {
    expect(mutateValues(PARAMS, CURRENT, 0, { rng: seeded(2) })).toEqual(CURRENT);
  });

  it("small amounts move less than large amounts", () => {
    const rng = seeded(4);
    const dist = (amt) => {
      let total = 0;
      for (let i = 0; i < 300; i++) total += Math.abs(mutateValues(PARAMS, CURRENT, amt, { rng }).res - CURRENT.res);
      return total / 300;
    };
    const subtle = dist(MUTATE_AMOUNTS.subtle);
    const wild = dist(MUTATE_AMOUNTS.wild);
    expect(subtle).toBeGreaterThan(0);
    expect(wild).toBeGreaterThan(subtle * 2);
  });

  it("a value outside the curated range never wanders further out", () => {
    const rng = seeded(5);
    const outside = { ...CURRENT, res: 20 }; // curated range is 2..10
    for (let i = 0; i < 300; i++) {
      const v = mutateValues(PARAMS, outside, MUTATE_AMOUNTS.wild, { rng });
      expect(v.res).toBeLessThanOrEqual(20);
      expect(v.res).toBeGreaterThanOrEqual(2);
    }
  });

  it("never touches rand:false params", () => {
    const rng = seeded(6);
    for (let i = 0; i < 100; i++) expect(mutateValues(PARAMS, CURRENT, 1, { rng }).octave).toBe(1);
  });
});

describe("SoundHistory", () => {
  it("undo/redo walk snapshots and skip no-op entries", () => {
    const h = new SoundHistory();
    const a = { x: 1 };
    const b = { x: 2 };
    const c = { x: 3 };
    h.record(a); // a → b
    h.record(b); // b → c
    expect(h.undo(c)).toEqual(b);
    expect(h.undo(b)).toEqual(a);
    expect(h.undo(a)).toBeNull();
    expect(h.redo(a)).toEqual(b);
    expect(h.redo(b)).toEqual(c);
    expect(h.canRedo).toBe(false);
  });

  it("a new change clears redo; duplicate records collapse", () => {
    const h = new SoundHistory();
    h.record({ x: 1 });
    h.record({ x: 1 });
    expect(h.undo({ x: 2 })).toEqual({ x: 1 });
    h.record({ x: 1 });
    expect(h.canRedo).toBe(false);
  });

  it("caps its length", () => {
    const h = new SoundHistory(3);
    for (let i = 0; i < 10; i++) h.record({ x: i });
    let n = 0;
    let cur = { x: 99 };
    while ((cur = h.undo(cur))) n++;
    expect(n).toBe(3);
  });
});

describe("acid end-to-end (headless)", () => {
  it("randomizeInstrument keeps every param inside its schema range and applies constrain", () => {
    const ctx = new AudioContext();
    const acid = new WebAudioSynthAcid(ctx);
    const realRandom = Math.random;
    Math.random = seeded(11);
    try {
      for (let i = 0; i < 200; i++) {
        const v = randomizeInstrument(acid);
        for (const def of WebAudioSynthAcid.PARAMS) {
          const r = randRange(def);
          if (r && (def.type ?? "number") === "number") {
            expect(v[def.param], def.param).toBeGreaterThanOrEqual(r.min);
            expect(v[def.param], def.param).toBeLessThanOrEqual(r.max);
          }
        }
        if (v.resonance > 18) expect(v.distortion).toBeLessThanOrEqual(0.3);
        if (v.unisonVoices <= 1) expect(v.unisonDetune).toBe(0);
        expect(captureValues(acid)).toEqual(v);
      }
    } finally {
      Math.random = realRandom;
    }
  });

  it("mutateInstrument leaves part-level params (octave, LFO switch) alone", () => {
    const acid = new WebAudioSynthAcid(new AudioContext());
    acid.octaveOffset = 1;
    for (let i = 0; i < 50; i++) mutateInstrument(acid, MUTATE_AMOUNTS.wild);
    expect(acid.octaveOffset).toBe(1);
    expect(acid.filterLfoActive).toBe(false);
  });
});
