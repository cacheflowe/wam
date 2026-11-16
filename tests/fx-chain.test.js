import { describe, it, expect } from "vitest";
import { FxChain } from "../src/web-audio/fx/fx-chain.js";
import "../src/web-audio/fx/fx-unit.js";

const SAMPLE_FX = {
  reverbWet: 0.3, reverbDecay: 4, reverbPreDelay: 20, reverbHpFreq: 120, reverbLpFreq: 6000, reverbDamping: 0.4, reverbWidth: 0.8,
  delayInterval: 0.5, delayFeedback: 0.5, delayMix: 0.25, delayFilterSweep: -0.3, delayModulation: 0.2,
  chorusVoices: 4, chorusRate: 1.5, chorusDepth: 0.6, chorusDelay: 12, chorusFeedback: 0.1, chorusWet: 0.4, chorusSpread: 0.7, chorusShape: 1,
  filterSweep: 0.2, filterQ: 2,
  compAmount: 0.5, compAttack: 20, compRelease: 300, compSync: 1, compReleaseBeats: 2, compThreshold: 0.3,
};

describe("FxChain (headless)", () => {
  it("round-trips every param through set()/toJSON()", () => {
    const fx = new FxChain(new AudioContext());
    fx.fromJSON(SAMPLE_FX);
    const out = fx.toJSON();
    for (const [k, v] of Object.entries(SAMPLE_FX)) expect(out[k], k).toBeCloseTo(v, 5);
  });

  it("constructor options seed the params; defaults otherwise", () => {
    const fx = new FxChain(new AudioContext(), { bpm: 128, reverbWet: 0.15, delayInterval: 0.75 });
    expect(fx.toJSON()).toMatchObject({ reverbWet: 0.15, delayInterval: 0.75, delayMix: 0, filterQ: 0.7, compReleaseBeats: 3 });
    expect(fx.bpm).toBe(128);
  });

  it("tempo-synced compressor release follows bpm", () => {
    const fx = new FxChain(new AudioContext(), { bpm: 120, compSync: 1, compReleaseBeats: 2 }); // 1/4 = 1 beat
    expect(fx.compressor.release).toBeCloseTo(0.5);
    fx.bpm = 60;
    expect(fx.compressor.release).toBeCloseTo(1);
    fx.set("compSync", 0);
    expect(fx.compressor.release).toBeCloseTo(0.2); // free release (200 ms default)
  });

  it("normalizes legacy saves", () => {
    const { params, legacy } = FxChain.normalize({ chorusShape: "triangle", lpFreq: 3000, delayFilterFreq: 900, compSourceId: "x" });
    expect(params).toEqual({ chorusShape: 1 });
    expect(legacy).toEqual({ lpFreq: 3000, delayFilterFreq: 900 });
  });
});

describe("<wam-fx-unit> is the UI for an FxChain", () => {
  const mount = (opts = {}) => {
    const el = document.createElement("wam-fx-unit");
    document.body.appendChild(el);
    el.init(new AudioContext(), { bpm: 120, ...opts });
    return el;
  };

  it("fromJSON moves the knobs AND the chain; toJSON reports the chain (+ sidechain source)", () => {
    const el = mount();
    el.fromJSON(SAMPLE_FX);
    const out = el.toJSON();
    for (const [k, v] of Object.entries(SAMPLE_FX)) expect(out[k], k).toBeCloseTo(v, 5);
    expect(out).toHaveProperty("compSourceId");
    expect(Number(el.querySelector('wam-knob[param="reverbWet"]').value)).toBeCloseTo(0.3);
  });

  it("knob input drives the chain", () => {
    const el = mount();
    const knob = el.querySelector('wam-knob[param="delayMix"]');
    knob.dispatchEvent(new CustomEvent("knob-input", { bubbles: true, detail: { param: "delayMix", value: 0.6 } }));
    expect(el.chain.toJSON().delayMix).toBeCloseTo(0.6);
  });

  it("legacy chorusShape string restores through the UI", () => {
    const el = mount();
    el.fromJSON({ chorusShape: "triangle" });
    expect(el.toJSON().chorusShape).toBe(1);
  });
});
