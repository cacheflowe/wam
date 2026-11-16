import { describe, expect, it } from "vitest";
import { AutoMap, layoutKnobs, ROLE_SLOTS } from "../src/web-audio/midi/auto-map.js";
import { bindingFor } from "../src/web-audio/midi/launch-control-xl.js";
import WebAudioSynthAcid from "../src/web-audio/instruments/synth-acid.js";
import WebAudioSynthPoly, { WebAudioSynthPolyControls } from "../src/web-audio/instruments/synth-poly.js";
import { mountTrack } from "./helpers/track-harness.js";
import WebAudioPercKick from "../src/web-audio/instruments/perc-kick.js";

const KNOB = (row, col) => `knob${"ABC"[row]}${col + 1}`;

/** Minimal stand-in for a controls instance: just the bits AutoMap reads/calls. */
function fakeControls(paramsOrCls, manual = {}) {
  const Cls = typeof paramsOrCls === "function" ? paramsOrCls : null;
  const names = Cls ? Cls.PARAMS.map((d) => d.param) : paramsOrCls;
  const registry = { volume: {}, pan: {} };
  for (const p of names) registry[p] = { getAttribute: () => p };
  return {
    _instrument: Cls ? { constructor: Cls } : { constructor: {} },
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

describe("layoutKnobs (pure)", () => {
  it("puts each role on its fixed knob regardless of schema order", () => {
    const [page] = layoutKnobs([
      { param: "rel", role: "release", group: "amp-env" },
      { param: "cut", role: "cutoff", group: "filter" },
      { param: "res", role: "resonance", group: "filter" },
    ]);
    expect(page[0]).toBe("cut");
    expect(page[1]).toBe("res");
    expect(page[8 + 3]).toBe("rel"); // row 2, col 4
  });

  it("second claimant of a role falls back to its group's home row", () => {
    const [page] = layoutKnobs([
      { param: "oscA", role: "wave", group: "osc" },
      { param: "oscB", role: "wave", group: "osc" },
    ]);
    expect(page[4]).toBe("oscA"); // wave slot
    expect(page.indexOf("oscB")).toBeLessThan(8); // somewhere on row 1
  });

  it("spills onto further pages when more than 24 params", () => {
    const defs = Array.from({ length: 30 }, (_, i) => ({ param: `p${i}` }));
    const pages = layoutKnobs(defs);
    expect(pages).toHaveLength(2);
    expect(pages[0].filter(Boolean)).toHaveLength(24);
    expect(pages[1].filter(Boolean)).toHaveLength(6);
  });

  it("never places params on blocked knobs", () => {
    const [page] = layoutKnobs([{ param: "cut", role: "cutoff" }], new Set([0]));
    expect(page[0]).toBeNull();
    expect(page.indexOf("cut")).toBeGreaterThan(0);
  });
});

describe("AutoMap with real instruments", () => {
  it("cutoff / resonance / attack / decay land on the same knobs for every synth", () => {
    for (const Cls of [WebAudioSynthAcid, WebAudioSynthPoly]) {
      const am = new AutoMap();
      const ctrl = fakeControls(Cls);
      am.focus(ctrl);
      const byKnob = Object.fromEntries(
        Object.entries(ctrl.autoBindings).map(([param, b]) => [JSON.stringify(b), param]),
      );
      const at = (row, col) => byKnob[JSON.stringify(bindingFor(KNOB(row, col)))];
      const roleAt = (row, col) => Cls.PARAMS.find((d) => d.param === at(row, col))?.role;
      expect(roleAt(...ROLE_SLOTS.cutoff), Cls.name).toBe("cutoff");
      expect(roleAt(...ROLE_SLOTS.resonance), Cls.name).toBe("resonance");
      expect(roleAt(...ROLE_SLOTS.attack), Cls.name).toBe("attack");
      expect(roleAt(...ROLE_SLOTS.decay), Cls.name).toBe("decay");
    }
  });

  it("never maps volume/pan, enums without a select control, or faders", () => {
    const am = new AutoMap();
    const ctrl = fakeControls(WebAudioSynthPoly);
    am.focus(ctrl);
    const params = Object.keys(ctrl.autoBindings);
    expect(params).not.toContain("volume");
    expect(params).not.toContain("pan");
    expect(params).not.toContain("oscAType"); // enum
    for (const b of Object.values(ctrl.autoBindings)) expect([77, 78, 79, 80, 81, 82, 83, 84]).not.toContain(b.controller);
  });

  it("poly pages: ← / → walks pages and wraps", () => {
    const am = new AutoMap();
    const ctrl = fakeControls(WebAudioSynthPoly);
    am.focus(ctrl);
    expect(am.pageCount).toBe(2);
    const page1 = Object.keys(ctrl.autoBindings);
    am.stepPage(1);
    const page2 = Object.keys(ctrl.autoBindings);
    expect(page2.some((p) => !page1.includes(p))).toBe(true);
    am.stepPage(1);
    expect(am.page).toBe(0);
    am.stepPage(-1);
    expect(am.page).toBe(1);
  });

  it("small instruments fit on one page", () => {
    const am = new AutoMap();
    am.focus(fakeControls(WebAudioPercKick));
    expect(am.pageCount).toBe(1);
  });
});

describe("AutoMap manual bindings", () => {
  it("skips params that are already manually bound", () => {
    const am = new AutoMap();
    const ctrl = fakeControls(["cutoff", "resonance", "decay"], { resonance: bindingFor("fader1") });
    const map = am.computeMap(ctrl);
    expect(map.resonance).toBeUndefined();
    expect(Object.keys(map).sort()).toEqual(["cutoff", "decay"]);
  });

  it("a knob used by a manual binding is skipped and the param moves to a free knob", () => {
    const am = new AutoMap();
    const ctrl = fakeControls(["cutoff", "resonance"], { cutoff: bindingFor("knobA1") });
    const map = am.computeMap(ctrl);
    expect(map.resonance).toBeDefined();
    expect(map.resonance).not.toEqual(bindingFor("knobA1"));
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
    expect(a.autoBindings).toBeNull();
    expect(b.autoBindings.gain).toEqual(bindingFor("knobA1"));
    am.focus(null);
    expect(b.autoBindings).toBeNull();
  });

  it("does nothing when disabled, and clears current; re-enabling restores the focused map", () => {
    const am = new AutoMap();
    const a = fakeControls(["cutoff"]);
    am.focus(a);
    am.setEnabled(false);
    expect(a.autoBindings).toBeNull();
    const b = fakeControls(["gain"]);
    am.focus(b);
    expect(b.autoBindings).toBeNull();
    am.setEnabled(true);
    expect(b.autoBindings.gain).toBeDefined();
  });

  it("emits wam-automap-change with page info and knob labels", () => {
    const target = new EventTarget();
    const am = new AutoMap(target);
    let detail = null;
    target.addEventListener("wam-automap-change", (e) => (detail = e.detail));
    am.focus(fakeControls(["cutoff"]));
    expect(detail.page).toBe(0);
    expect(detail.pageCount).toBe(1);
    expect(detail.assignments.knobA1).toEqual({ param: "cutoff", label: "cutoff" });
  });
});

describe("AutoMap with a real panel (Poly)", () => {
  const knobInput = (binding, value) =>
    document.dispatchEvent(new CustomEvent("wam-control-input", { detail: { binding: { source: "midi", ...binding }, value, kind: "absolute" } }));

  it("page 2 knobs drive page-2 params, and assignments carry live values", () => {
    const { ctrl } = mountTrack(null, { Instrument: WebAudioSynthPoly, Controls: WebAudioSynthPolyControls });
    const am = new AutoMap(document);
    am.focus(ctrl);
    expect(am.pageCount).toBeGreaterThan(1);
    am.stepPage(1);
    const [param, binding] = Object.entries(ctrl._autoBindings).find(([p]) => ctrl._sliders[p]);
    knobInput(binding, 1);
    const el = ctrl._sliders[param];
    expect(Number(el.value)).toBe(Number(el.getAttribute("max")));
    const a = Object.values(am.assignments).find((x) => x.param === param);
    expect(a.value).toBeCloseTo(1);
    expect(typeof a.display).toBe("string");
  });

  it("choice params (enums with a select) map to knobs; the knob steps through the options", () => {
    const { ctrl } = mountTrack(null, { Instrument: WebAudioSynthPoly, Controls: WebAudioSynthPolyControls });
    const am = new AutoMap(document);
    am.focus(ctrl);
    let all = [];
    for (let p = 0; p < am.pageCount; p++) {
      am.setPage(p);
      all.push(...Object.keys(ctrl._autoBindings));
      if (ctrl._autoBindings.oscAType) break;
    }
    expect(all).toContain("oscAType");
    const sel = ctrl._selects.oscAType.el;
    const n = sel.options.length;
    knobInput(ctrl._autoBindings.oscAType, 0.999);
    expect(sel.selectedIndex).toBe(n - 1);
    expect(ctrl._instrument.oscAType).toBe(sel.options[n - 1].value);
    knobInput(ctrl._autoBindings.oscAType, 0);
    expect(ctrl._instrument.oscAType).toBe(sel.options[0].value);
    const a = Object.values(am.assignments).find((x) => x.param === "oscAType");
    expect(a).toMatchObject({ choice: true, value: 0, display: sel.options[0].text });
  });
});
