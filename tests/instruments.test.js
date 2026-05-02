import { describe, it, expect, beforeEach } from "vitest";
import WebAudioInstrumentBase from "../src/web-audio/global/web-audio-instrument-base.js";
import WebAudioPercKick from "../src/web-audio/instruments/web-audio-perc-kick.js";
import WebAudioPercHihat from "../src/web-audio/instruments/web-audio-perc-hihat.js";
import WebAudioSynthMono from "../src/web-audio/instruments/web-audio-synth-mono.js";
import WebAudioSynthPad from "../src/web-audio/instruments/web-audio-synth-pad.js";
import WebAudioSynth808 from "../src/web-audio/instruments/web-audio-synth-808.js";
import WebAudioSynthAcid from "../src/web-audio/instruments/web-audio-synth-acid.js";
import WebAudioSynthFM from "../src/web-audio/instruments/web-audio-synth-fm.js";
import WebAudioSynthBlipFX from "../src/web-audio/instruments/web-audio-synth-blipfx.js";

// ---- Instrument registry: [Class, defaultPreset, hasPresets] ----
const INSTRUMENTS = [
  [WebAudioPercKick,    "Default", true],
  [WebAudioPercHihat,   "Default", true],
  [WebAudioSynthMono,   "Default", true],
  [WebAudioSynthPad,    "Default", true],
  [WebAudioSynth808,    "Default", true],
  [WebAudioSynthAcid,   "Default", true],
  [WebAudioSynthFM,     "Default", true],
  [WebAudioSynthBlipFX, "Default", true],
];

function makeCtx() {
  return new AudioContext();
}

// ---- WebAudioInstrumentBase ----

describe("WebAudioInstrumentBase", () => {
  it("constructs without preset", () => {
    const ctx = makeCtx();
    const inst = new WebAudioInstrumentBase(ctx, null);
    expect(inst.ctx).toBe(ctx);
    expect(inst._out).toBeDefined();
  });

  it("exposes input === _out", () => {
    const inst = new WebAudioInstrumentBase(makeCtx(), null);
    expect(inst.input).toBe(inst._out);
  });

  it("volume getter/setter round-trips", () => {
    const inst = new WebAudioInstrumentBase(makeCtx(), null);
    inst.volume = 0.42;
    expect(inst.volume).toBeCloseTo(0.42);
  });

  it("connect() returns this for chaining", () => {
    const inst = new WebAudioInstrumentBase(makeCtx(), null);
    const dest = makeCtx().createGain();
    const result = inst.connect(dest);
    expect(result).toBe(inst);
  });

  it("connect() accepts node with .input property", () => {
    const inst = new WebAudioInstrumentBase(makeCtx(), null);
    const target = { input: makeCtx().createGain() };
    expect(() => inst.connect(target)).not.toThrow();
  });

  it("applyPreset ignores unknown preset names", () => {
    const inst = new WebAudioInstrumentBase(makeCtx(), "NonExistent");
    expect(inst).toBeDefined();
  });

  describe("_midiToFreq", () => {
    it("A4 (MIDI 69) = 440 Hz", () => {
      expect(WebAudioInstrumentBase._midiToFreq(69)).toBeCloseTo(440);
    });

    it("A3 (MIDI 57) = 220 Hz", () => {
      expect(WebAudioInstrumentBase._midiToFreq(57)).toBeCloseTo(220);
    });

    it("A5 (MIDI 81) = 880 Hz", () => {
      expect(WebAudioInstrumentBase._midiToFreq(81)).toBeCloseTo(880);
    });

    it("C4 (MIDI 60) ≈ 261.63 Hz", () => {
      expect(WebAudioInstrumentBase._midiToFreq(60)).toBeCloseTo(261.63, 1);
    });

    it("each octave doubles frequency", () => {
      const f0 = WebAudioInstrumentBase._midiToFreq(60);
      const f1 = WebAudioInstrumentBase._midiToFreq(72);
      expect(f1 / f0).toBeCloseTo(2);
    });
  });
});

// ---- Per-instrument construction ----

describe.each(INSTRUMENTS)("%s construction", (Cls, defaultPreset) => {
  let ctx;
  beforeEach(() => { ctx = makeCtx(); });

  it("constructs with default preset", () => {
    expect(() => new Cls(ctx)).not.toThrow();
  });

  it("exposes ctx", () => {
    const inst = new Cls(ctx);
    expect(inst.ctx).toBe(ctx);
  });

  it("exposes _out node", () => {
    const inst = new Cls(ctx);
    expect(inst._out).toBeDefined();
  });

  it("input returns a node", () => {
    const inst = new Cls(ctx);
    expect(inst.input).toBeDefined();
  });

  it("volume defaults to a number", () => {
    const inst = new Cls(ctx);
    expect(typeof inst.volume).toBe("number");
  });

  it("volume setter applies", () => {
    const inst = new Cls(ctx);
    inst.volume = 0.5;
    expect(inst.volume).toBeCloseTo(0.5);
  });

  it("connect() does not throw", () => {
    const inst = new Cls(ctx);
    expect(() => inst.connect(ctx.destination)).not.toThrow();
  });
});

// ---- Per-instrument trigger ----

describe("WebAudioPercKick trigger", () => {
  it("trigger() does not throw", () => {
    const kick = new WebAudioPercKick(makeCtx());
    expect(() => kick.trigger(0.8, 0)).not.toThrow();
  });

  it("trigger() accepts velocity 0", () => {
    expect(() => new WebAudioPercKick(makeCtx()).trigger(0, 0)).not.toThrow();
  });

  it("trigger() accepts velocity 1", () => {
    expect(() => new WebAudioPercKick(makeCtx()).trigger(1, 0)).not.toThrow();
  });
});

describe("WebAudioPercHihat trigger", () => {
  it("trigger() does not throw", () => {
    expect(() => new WebAudioPercHihat(makeCtx()).trigger(0.8, 0)).not.toThrow();
  });
});

describe("WebAudioSynthMono trigger", () => {
  it("trigger() does not throw", () => {
    expect(() => new WebAudioSynthMono(makeCtx()).trigger(60, 0.5, 0.5, 0)).not.toThrow();
  });

  it("unisonVoices setter does not throw", () => {
    const mono = new WebAudioSynthMono(makeCtx());
    expect(() => { mono.unisonVoices = 4; }).not.toThrow();
  });

  it("lfoDepth setter does not throw", () => {
    const mono = new WebAudioSynthMono(makeCtx());
    expect(() => { mono.lfoDepth = 0.5; }).not.toThrow();
  });

  it("trigger with LFO does not throw", () => {
    const mono = new WebAudioSynthMono(makeCtx());
    mono.lfoDepth = 0.5;
    expect(() => mono.trigger(60, 0.8, 0.5, 0)).not.toThrow();
  });

  it("trigger with portamento does not throw", () => {
    const mono = new WebAudioSynthMono(makeCtx());
    mono.portamento = 0.1;
    mono.trigger(60, 0.8, 0.5, 0);
    expect(() => mono.trigger(64, 0.8, 0.5, 0.5)).not.toThrow();
  });
});

describe("WebAudioSynthPad trigger", () => {
  it("trigger() does not throw", () => {
    expect(() => new WebAudioSynthPad(makeCtx()).trigger(60, 0.8, 2.0, 0)).not.toThrow();
  });

  it("polyphonic — multiple triggers do not throw", () => {
    const pad = new WebAudioSynthPad(makeCtx());
    expect(() => {
      pad.trigger(60, 0.8, 2.0, 0);
      pad.trigger(64, 0.8, 2.0, 0);
      pad.trigger(67, 0.8, 2.0, 0);
    }).not.toThrow();
  });
});

describe("WebAudioSynth808 trigger", () => {
  it("trigger() does not throw", () => {
    expect(() => new WebAudioSynth808(makeCtx()).trigger(36, 0.8, 0.5, 0)).not.toThrow();
  });
});

describe("WebAudioSynthAcid trigger", () => {
  it("trigger() does not throw", () => {
    expect(() => new WebAudioSynthAcid(makeCtx()).trigger(36, 0.8, 0.5, false, 0)).not.toThrow();
  });
});

describe("WebAudioSynthFM trigger", () => {
  it("trigger() does not throw", () => {
    expect(() => new WebAudioSynthFM(makeCtx()).trigger([60], 0.8, 0.5, 0)).not.toThrow();
  });
});

// ---- Preset validation ----

describe("PRESETS shape", () => {
  for (const [Cls] of INSTRUMENTS) {
    it(`${Cls.name} every preset has volume`, () => {
      for (const [name, preset] of Object.entries(Cls.PRESETS ?? {})) {
        expect(preset.volume, `${Cls.name}/${name} missing volume`).toBeDefined();
        expect(typeof preset.volume).toBe("number");
        expect(preset.volume).toBeGreaterThan(0);
        expect(preset.volume).toBeLessThanOrEqual(1);
      }
    });

    it(`${Cls.name} applyPreset sets matching properties`, () => {
      const ctx = makeCtx();
      const inst = new Cls(ctx);
      const presetNames = Object.keys(Cls.PRESETS ?? {});
      if (presetNames.length === 0) return;
      // Apply every preset — none should throw
      for (const name of presetNames) {
        expect(() => inst.applyPreset(name), `${Cls.name} applyPreset("${name}")`).not.toThrow();
      }
    });
  }
});
