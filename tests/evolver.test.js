import { describe, expect, it } from "vitest";
import { TrackEvolver, Conductor, VARIATIONS, chooseVariation } from "../src/web-audio/global/evolver.js";
import { seededRng } from "../src/web-audio/global/pattern-gen.js";

const pat = (on) => Array.from({ length: 16 }, (_, i) => ({ active: on.includes(i), note: 36 }));

/** In-memory adapter: one or more patterns, "A" playing. */
function fakeTrack(role = "kick", steps = pat([0, 4, 8, 12])) {
  const store = { A: steps.map((s) => ({ ...s })) };
  const changes = [];
  const adapter = {
    role,
    get: (n) => store[n].map((s) => ({ ...s })),
    set: (n, s) => (store[n] = s.map((x) => ({ ...x }))),
    playing: () => "A",
    notes: () => [36, 38, 39, 41, 43, 44, 46, 48],
    regenerate: () => pat([0, 3, 6, 10]),
    onChange: (kind, info) => changes.push([kind, info.name]),
  };
  return { adapter, store, changes, ev: new TrackEvolver(adapter, { rng: seededRng(7) }) };
}

const on = (steps) => steps.flatMap((s, i) => (s.active ? [i] : []));

describe("chooseVariation", () => {
  it("respects role filters and energy bands", () => {
    const rng = seededRng(1);
    const ctx = { keepFirst: false };
    for (let i = 0; i < 200; i++) {
      const low = chooseVariation("hat", 0.1, ctx, rng);
      expect(low.w[0]).toBeGreaterThan(0);
      expect(low.name).not.toBe("drop"); // kick/bass only
      const high = chooseVariation("pad", 0.9, ctx, rng);
      expect(high.w[2]).toBeGreaterThan(0);
      expect(high.name).not.toBe("fill"); // drums only
    }
  });

  it("every variation has three weights", () => {
    for (const v of VARIATIONS) expect(v.w).toHaveLength(3);
  });
});

describe("TrackEvolver", () => {
  it("vary() is temporary; restore() snaps back to home", () => {
    const { ev, store } = fakeTrack();
    const before = on(store.A);
    ev.vary({ op: "thicken", bar: 0, bars: 2 });
    expect(ev.variation).toMatchObject({ name: "A", until: 2, op: "thicken" });
    expect(on(store.A)).not.toEqual(before);
    expect(on(ev.savedSteps("A"))).toEqual(before); // saving a song saves home
    ev.restore();
    expect(on(store.A)).toEqual(before);
    expect(ev.variation).toBeNull();
    expect(ev.isAway()).toBe(false);
  });

  it("never silences a track", () => {
    const { ev, store } = fakeTrack("kick", pat([0]));
    ev.vary({ op: "thin" });
    expect(on(store.A).length).toBeGreaterThan(0);
  });

  it("keep() adopts the variation as the new home; returnHome() goes back to the original", () => {
    const { ev, store, changes } = fakeTrack();
    const original = on(store.A);
    ev.vary({ op: "thicken" });
    const varied = on(store.A);
    ev.keep();
    expect(ev.variation).toBeNull();
    expect(on(ev.home("A"))).toEqual(varied);
    expect(ev.isAway()).toBe(true);
    expect(changes.some(([k]) => k === "home")).toBe(true);
    ev.returnHome();
    expect(on(store.A)).toEqual(original);
    expect(ev.isAway()).toBe(false);
  });

  it("evolve() changes home permanently; every 4th step is a new pattern; undo() steps back", () => {
    const { ev, store } = fakeTrack();
    const ops = [0, 1, 2, 3].map(() => ev.evolve({ energy: 0.9 }));
    expect(ops[3]).toBe("new pattern");
    expect(on(store.A)).toEqual([0, 3, 6, 10]);
    expect(on(ev.home("A"))).toEqual([0, 3, 6, 10]);
    expect(ev.undo()).toBe(true);
    expect(on(store.A)).not.toEqual([0, 3, 6, 10]);
  });

  it("a user edit during a variation keeps it; outside one it updates home", () => {
    const { ev, store } = fakeTrack();
    ev.vary({ op: "thicken" });
    store.A[1].active = true;
    ev.userEdited("A");
    expect(ev.variation).toBeNull();
    expect(on(ev.home("A"))).toContain(1);
    store.A[2].active = true;
    ev.userEdited("A");
    expect(on(ev.home("A"))).toContain(2);
  });
});

describe("Conductor", () => {
  const setup = (opts = {}) => {
    const t = fakeTrack(opts.role ?? "kick");
    t.ev.label = "Kick";
    const c = new Conductor({ tracks: () => [t.ev], rng: opts.rng ?? (() => 0) });
    return { ...t, c };
  };

  it("does nothing on its own unless auto is on", () => {
    const { c, store } = setup();
    const before = on(store.A);
    for (let bar = 0; bar < 16; bar++) c.onBar(bar, bar * 16);
    expect(on(store.A)).toEqual(before);
    expect(c.log).toEqual([]);
  });

  it("still restores expired manual variations (gravity) with auto off", () => {
    const { c, ev, store } = setup();
    const before = on(store.A);
    ev.vary({ op: "thicken", bar: 0, bars: 1 });
    c.onBar(1, 16);
    expect(on(store.A)).toEqual(before);
  });

  it("auto: fills on the last bar of a phrase, varies at phrase start, restores at drift 0", () => {
    const { c, ev, store } = setup({ rng: () => 0 }); // every chance hits
    c.auto = true;
    c.energy = 0.9;
    const home = on(store.A);
    c.onBar(3, 48); // last bar of a 4-bar phrase
    expect(ev.variation?.op).toBe("fill");
    c.onBar(4, 64); // fill expires, a new variation starts
    expect(ev.variation).not.toBeNull();
    expect(c.log.length).toBe(2);
    c.onBar(ev.variation.until, ev.variation.until * 16);
    expect(on(ev.home("A"))).toEqual(home); // drift 0: home never changes
  });

  it("drift lets a finished variation stick", () => {
    const { c, ev } = setup({ rng: () => 0 });
    c.auto = true;
    c.drift = 1;
    ev.vary({ op: "thicken", bar: 0, bars: 1 });
    const varied = on(ev.a.get("A"));
    c.onBar(1, 16);
    expect(ev.variation).toBeNull();
    expect(on(ev.home("A"))).toEqual(varied);
    expect(c.log[0].what).toMatch(/kept thicken/);
  });

  it("skips tracks that opted out", () => {
    const { c, ev, store } = setup({ rng: () => 0 });
    c.auto = true;
    ev.enabled = false;
    const before = on(store.A);
    for (let bar = 0; bar < 9; bar++) c.onBar(bar, bar * 16);
    expect(on(store.A)).toEqual(before);
  });

  it("settings clamp, dispatch change, and round-trip through JSON", () => {
    const c = new Conductor({ tracks: () => [] });
    const seen = [];
    c.addEventListener("change", (e) => seen.push(e.detail.key));
    c.energy = 2;
    c.drift = -1;
    c.phrase = "8";
    c.auto = 1;
    expect(c.toJSON()).toEqual({ energy: 1, drift: 0, auto: true, phrase: 8 });
    expect(seen).toEqual(["energy", "phrase", "auto"]); // drift was already 0
    const d = new Conductor({ tracks: () => [] });
    d.fromJSON(c.toJSON());
    expect(d.toJSON()).toEqual(c.toJSON());
  });
});
