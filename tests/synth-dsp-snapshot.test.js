// DSP snapshot tests — pin each synth's trigger() automation so the DSP
// refactor (extracting shared envelope/LFO/voice modules) cannot silently
// change the sound. Capture baselines on the current code, then assert they
// stay identical after each synth is migrated to the shared primitives.
//
// Math.random is stubbed so probability-gated branches are deterministic.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRecordingContext } from "./helpers/recording-context.js";
import WebAudioSynthMono from "../src/web-audio/instruments/synth-mono.js";
import WebAudioSynthAcid from "../src/web-audio/instruments/synth-acid.js";
import WebAudioSynthPad from "../src/web-audio/instruments/synth-pad.js";
import WebAudioSynth808 from "../src/web-audio/instruments/synth-808.js";
import WebAudioSynthPoly from "../src/web-audio/instruments/synth-poly.js";

let randomSpy;
beforeEach(() => {
  randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
});
afterEach(() => {
  randomSpy.mockRestore();
});

/** Build a synth, apply per-test param overrides, capture only the trigger log. */
function capture(Cls, preset, overrides, triggerArgs, { warmup } = {}) {
  const { ctx, log } = createRecordingContext();
  const synth = new Cls(ctx, preset);
  Object.assign(synth, overrides ?? {});
  if (warmup) synth.trigger(...warmup); // e.g. seed portamento _lastFreq
  log.length = 0;
  synth.trigger(...triggerArgs);
  return log;
}

describe("WebAudioSynthMono DSP", () => {
  it("Default", () => {
    expect(capture(WebAudioSynthMono, "Default", null, [60, 0.5, 1, 1])).toMatchSnapshot();
  });
  it("Bass (sub osc)", () => {
    expect(capture(WebAudioSynthMono, "Bass", null, [36, 0.5, 1, 1])).toMatchSnapshot();
  });
  it("Lead (unison + pitch LFO)", () => {
    expect(capture(WebAudioSynthMono, "Lead", null, [60, 0.5, 0.8, 1])).toMatchSnapshot();
  });
  it("Pad (filter LFO + smoother)", () => {
    expect(capture(WebAudioSynthMono, "Pad", null, [48, 0.5, 1, 1])).toMatchSnapshot();
  });
  it("amp/tremolo LFO path", () => {
    expect(
      capture(WebAudioSynthMono, "Default", { lfoDest: "amp", lfoDepth: 0.5 }, [60, 0.5, 1, 1]),
    ).toMatchSnapshot();
  });
  it("Cello (portamento, second note)", () => {
    expect(
      capture(WebAudioSynthMono, "Cello", null, [60, 0.5, 1, 2], { warmup: [55, 0.5, 1, 1] }),
    ).toMatchSnapshot();
  });
});

describe("WebAudioSynthAcid DSP", () => {
  it("Default (no accent)", () => {
    expect(capture(WebAudioSynthAcid, "Default", null, [36, 0.5, false, 1])).toMatchSnapshot();
  });
  it("Default (accent)", () => {
    expect(capture(WebAudioSynthAcid, "Default", null, [36, 0.5, true, 1])).toMatchSnapshot();
  });
  it("Fat (unison)", () => {
    expect(capture(WebAudioSynthAcid, "Fat", null, [36, 0.5, true, 1])).toMatchSnapshot();
  });
  it("Hoover (unison + portamento, second note)", () => {
    expect(
      capture(WebAudioSynthAcid, "Hoover", null, [36, 0.5, false, 2], { warmup: [31, 0.5, false, 1] }),
    ).toMatchSnapshot();
  });
  it("filter LFO active", () => {
    expect(
      capture(WebAudioSynthAcid, "Default", { filterLfoActive: true, _lfoStepPosition: 3 }, [36, 0.5, false, 1]),
    ).toMatchSnapshot();
  });
});

describe("WebAudioSynthPad DSP", () => {
  it("Default (single note)", () => {
    expect(capture(WebAudioSynthPad, "Default", null, [60, 0.5, 1, 1])).toMatchSnapshot();
  });
  it("Warm (dual-osc spread + filter env + vel→filter)", () => {
    expect(capture(WebAudioSynthPad, "Warm", null, [48, 0.5, 0.8, 1])).toMatchSnapshot();
  });
  it("Default chord", () => {
    expect(capture(WebAudioSynthPad, "Default", null, [[60, 64, 67], 0.5, 1, 1])).toMatchSnapshot();
  });
  it("Strings (pitch LFO)", () => {
    expect(capture(WebAudioSynthPad, "Strings", null, [60, 0.5, 0.8, 1])).toMatchSnapshot();
  });
  it("amp LFO path", () => {
    expect(
      capture(WebAudioSynthPad, "Default", { lfoDest: "amp", lfoDepth: 0.5 }, [60, 0.5, 1, 1]),
    ).toMatchSnapshot();
  });
});

describe("WebAudioSynth808 DSP", () => {
  it("Default (click)", () => {
    expect(capture(WebAudioSynth808, "Default", null, [36, 0.5, 1])).toMatchSnapshot();
  });
  it("Boom (sub osc)", () => {
    expect(capture(WebAudioSynth808, "Boom", null, [36, 0.5, 1])).toMatchSnapshot();
  });
  it("Dirty (distortion)", () => {
    expect(capture(WebAudioSynth808, "Dirty", null, [36, 0.5, 1])).toMatchSnapshot();
  });
  it("Trap (click + sub)", () => {
    expect(capture(WebAudioSynth808, "Trap", null, [36, 0.5, 1])).toMatchSnapshot();
  });
});

describe("WebAudioSynthPoly DSP", () => {
  it("Default (dual osc + key track + filter env)", () => {
    expect(capture(WebAudioSynthPoly, "Default", null, [60, 0.5, 1, 1])).toMatchSnapshot();
  });
  it("Super_Saw (unison + dual LFO)", () => {
    expect(
      capture(WebAudioSynthPoly, "Super_Saw", { lfo1Depth: 0.3, lfo2Depth: 0.05 }, [60, 0.5, 0.9, 1]),
    ).toMatchSnapshot();
  });
  it("Fat_Bass (sub + glide, second note)", () => {
    expect(
      capture(WebAudioSynthPoly, "Fat_Bass", null, [36, 0.5, 1, 2], { warmup: [31, 0.5, 1, 1] }),
    ).toMatchSnapshot();
  });
  it("noise + bandpass path", () => {
    expect(
      capture(WebAudioSynthPoly, "Default", { noiseLevel: 0.5, filterType: "bandpass" }, [48, 0.5, 0.8, 1]),
    ).toMatchSnapshot();
  });
  it("Wobble (tempo-synced filter LFO)", () => {
    expect(capture(WebAudioSynthPoly, "Wobble", { _bpm: 128 }, [36, 0.5, 1, 1])).toMatchSnapshot();
  });
  it("Default chord", () => {
    expect(capture(WebAudioSynthPoly, "Default", null, [[60, 64, 67], 0.5, 1, 1])).toMatchSnapshot();
  });
});
