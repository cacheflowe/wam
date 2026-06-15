import { describe, expect, it } from "vitest";
import { AutoMap } from "../src/web-audio/midi/auto-map.js";
import { bindingFor, getControl } from "../src/web-audio/midi/launch-control-xl.js";

// Minimal stand-in for a controls instance: just the bits AutoMap reads/calls.
function fakeControls(paramOrder, manual = {}) {
  const registry = {};
  for (const p of paramOrder) registry[p] = { tagName: "WAM-KNOB" };
  return {
    _learnRegistry: registry,
    _paramBindings: manual,
    autoBindings: null,
    setAutoBindings(map) {
      this.autoBindings = map;
    },
    clearAutoBindings() {
      this.autoBindings = null;
    },
  };
}

describe("AutoMap.computeMap", () => {
  it("maps params to knobs/faders in order", () => {
    const am = new AutoMap();
    const ctrl = fakeControls(["cutoff", "resonance", "decay"]);
    const map = am.computeMap(ctrl);
    expect(map.cutoff).toEqual(bindingFor("knobA1"));
    expect(map.resonance).toEqual(bindingFor("knobA2"));
    expect(map.decay).toEqual(bindingFor("knobA3"));
  });

  it("skips params that are already manually bound", () => {
    const am = new AutoMap();
    // resonance manually bound → excluded from auto-map
    const ctrl = fakeControls(["cutoff", "resonance", "decay"], { resonance: bindingFor("fader1") });
    const map = am.computeMap(ctrl);
    expect(map.resonance).toBeUndefined();
    expect(Object.keys(map)).toEqual(["cutoff", "decay"]);
  });

  it("skips controls already used by a manual binding (no double-driving)", () => {
    const am = new AutoMap();
    // cutoff manually bound to knobA1 → auto-map must not reuse knobA1
    const ctrl = fakeControls(["cutoff", "resonance"], { cutoff: bindingFor("knobA1") });
    const map = am.computeMap(ctrl);
    // resonance is the only unbound param; first available control is knobA2 (knobA1 taken)
    expect(map.resonance).toEqual(bindingFor("knobA2"));
  });

  it("stops when controls run out (more params than 32 knobs+faders)", () => {
    const am = new AutoMap();
    const manyParams = Array.from({ length: 40 }, (_, i) => `p${i}`);
    const map = am.computeMap(fakeControls(manyParams));
    expect(Object.keys(map)).toHaveLength(32); // 24 knobs + 8 faders
  });
});

describe("AutoMap focus lifecycle", () => {
  it("applies auto-bindings on focus and clears the previous on refocus", () => {
    const am = new AutoMap();
    const a = fakeControls(["cutoff"]);
    const b = fakeControls(["gain"]);

    am.focus(a);
    expect(a.autoBindings.cutoff).toEqual(bindingFor("knobA1"));

    am.focus(b);
    expect(a.autoBindings).toBeNull(); // previous cleared
    expect(b.autoBindings.gain).toEqual(bindingFor("knobA1"));

    am.focus(null);
    expect(b.autoBindings).toBeNull();
  });

  it("does nothing when disabled, and clears current", () => {
    const am = new AutoMap();
    const a = fakeControls(["cutoff"]);
    am.focus(a);
    expect(a.autoBindings).not.toBeNull();
    am.setEnabled(false);
    expect(a.autoBindings).toBeNull();
    const b = fakeControls(["gain"]);
    am.focus(b);
    expect(b.autoBindings).toBeNull(); // disabled → no map
  });
});
