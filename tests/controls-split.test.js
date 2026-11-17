import { describe, expect, it } from "vitest";
import { WebAudioControlsBase } from "../src/web-audio/ui/controls-base.js";
import { installMethods } from "../src/web-audio/ui/controls/install.js";
import { InputLearnMixin } from "../src/web-audio/ui/input-learn.js";
import { JamControls } from "../src/web-audio/ui/controls/jam.js";
import { SequencerUI } from "../src/web-audio/ui/controls/sequencer-ui.js";
import { Playback } from "../src/web-audio/ui/controls/playback.js";
import { EvolveControls } from "../src/web-audio/ui/controls/evolve.js";
import { PresetControls } from "../src/web-audio/ui/controls/presets.js";
import { SoundDesignControls } from "../src/web-audio/ui/controls/sound-design-ui.js";
import { SerializationControls } from "../src/web-audio/ui/controls/serialization.js";

const GROUPS = [SequencerUI, Playback, EvolveControls, JamControls, PresetControls, SoundDesignControls, SerializationControls];

describe("controls-base split (ui/controls/*)", () => {
  it("every feature method/accessor is installed on WebAudioControlsBase", () => {
    const proto = WebAudioControlsBase.prototype;
    for (const G of GROUPS) {
      for (const [name, desc] of Object.entries(Object.getOwnPropertyDescriptors(G.prototype))) {
        if (name === "constructor") continue;
        const got = Object.getOwnPropertyDescriptor(proto, name);
        expect(got, `${G.name}.${name}`).toBeDefined();
        expect(got.value ?? got.get ?? got.set).toBe(desc.value ?? desc.get ?? desc.set);
      }
    }
  });

  it("jam input interception wins over the generic input-learn mixin (install order)", () => {
    const proto = WebAudioControlsBase.prototype;
    expect(proto._handleControlInput).toBe(JamControls.prototype._handleControlInput);
    expect(proto._onInputExtra).toBe(JamControls.prototype._onInputExtra);
    expect(proto._handleControlInput).not.toBe(InputLearnMixin._handleControlInput);
    // …while the rest of the mixin is still there
    expect(proto._applyInput).toBe(InputLearnMixin._applyInput);
  });

  it("installMethods refuses to replace an existing method", () => {
    class Target { a() {} }
    class G { a() {} }
    expect(() => installMethods(Target, [G])).toThrow(/already defined/);
  });

  it("accessors survive the install (getter + setter pairs)", () => {
    const d = Object.getOwnPropertyDescriptor(WebAudioControlsBase.prototype, "speedMultiplier");
    expect(typeof d.get).toBe("function");
    expect(typeof d.set).toBe("function");
  });
});
