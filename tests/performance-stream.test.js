import { describe, it, expect, vi } from "vitest";
import { describeTrigger } from "../src/web-audio/global/note-event.js";
import { PerformanceStream, STREAM_KEYS } from "../src/web-audio/global/performance-stream.js";

const modules = import.meta.glob("../src/web-audio/instruments/*.js", { eager: true });
const INSTRUMENTS = Object.values(modules).map((m) => m.default).filter((C) => C?.TRIGGER_ARGS);

describe("describeTrigger", () => {
  it("normalizes each instrument's own trigger signature", () => {
    const acid = { TRIGGER_ARGS: { trigger: ["notes", "duration", "accent", "time"] } };
    expect(describeTrigger(acid, "trigger", [36, 0.1, true, 2.5])).toEqual({
      notes: [36], velocity: 1, duration: 0.1, accent: true, time: 2.5,
    });
    expect(describeTrigger(acid, "trigger", [36, 0.1, false, 2.5]).velocity).toBe(0.8);

    const poly = { TRIGGER_ARGS: { trigger: ["notes", "duration", "velocity", "time"] } };
    expect(describeTrigger(poly, "trigger", [[60, 64, 67], 0.5, 0.7, 1]).notes).toEqual([60, 64, 67]);

    const hat = { TRIGGER_ARGS: { trigger: ["velocity", "time", "open"] } };
    expect(describeTrigger(hat, "trigger", [0.7, 3, true])).toEqual({
      notes: [], velocity: 0.7, duration: null, accent: false, time: 3, open: true,
    });
  });

  it("returns null for undescribed methods/instruments; clamps velocity", () => {
    expect(describeTrigger({}, "trigger", [1])).toBeNull();
    expect(describeTrigger({ TRIGGER_ARGS: { trigger: ["velocity"] } }, "triggerDrum", [1])).toBeNull();
    expect(describeTrigger({ TRIGGER_ARGS: { trigger: ["velocity"] } }, "trigger", [3]).velocity).toBe(1);
  });

  it("every declared instrument layout matches its trigger() arity", () => {
    expect(INSTRUMENTS.length).toBeGreaterThanOrEqual(11);
    for (const Cls of INSTRUMENTS) {
      for (const [method, layout] of Object.entries(Cls.TRIGGER_ARGS)) {
        const fn = Cls.prototype[method];
        expect(typeof fn, `${Cls.name}.${method}`).toBe("function");
        expect(layout.length, `${Cls.name}.${method} layout longer than its params`).toBeLessThanOrEqual(
          fn.toString().slice(fn.toString().indexOf("(") + 1, fn.toString().indexOf(")")).split(",").length,
        );
      }
    }
  });
});

/** Fake stores mirroring the two AppStore flavors. */
function localStore() {
  return { calls: [], set(k, v, ...rest) { this.calls.push([k, v, ...rest]); } };
}
/** AppStoreDistributed stand-in: records set() calls by kind (public API only). */
function distributedStore() {
  return {
    senderId: "wam_host_x",
    sent: [],
    local: [],
    isConnected: () => true,
    set(k, v, broadcast = false, receiver = null, sendOnly = false) {
      if (broadcast) this.sent.push({ key: k, value: v, receiver, sendOnly });
      else this.local.push([k, v]);
    },
  };
}

describe("PerformanceStream", () => {
  it("local AppStore: plain set()", () => {
    const store = localStore();
    const ps = new PerformanceStream({ getStore: () => store });
    ps.note({ note: 60 });
    expect(store.calls).toEqual([[STREAM_KEYS.TRIGGER, { note: 60 }]]);
  });

  it("distributed: set(k, v, true, null, sendOnly) and delivered locally too", () => {
    const store = distributedStore();
    const ps = new PerformanceStream({ getStore: () => store });
    ps.note({ note: 60 });
    expect(store.sent).toEqual([{ key: "trigger", value: { note: 60 }, receiver: null, sendOnly: true }]);
    expect(store.local).toEqual([["trigger", { note: 60 }]]);
  });

  it("instrument list: broadcast, not sendOnly; local copy arrives via the echo", () => {
    const store = distributedStore();
    const ps = new PerformanceStream({ getStore: () => store });
    ps.instruments([{ slot: 1 }]);
    expect(store.sent).toEqual([{ key: "instruments.list", value: [{ slot: 1 }], receiver: null, sendOnly: false }]);
    expect(store.local).toEqual([]);
  });

  it("per-key switches", () => {
    const store = localStore();
    const ps = new PerformanceStream({ getStore: () => store });
    ps.setKeyEnabled(STREAM_KEYS.BEAT, false);
    ps.beat({ step: 0 });
    ps.note({ a: 1 });
    expect(store.calls.map((c) => c[0])).toEqual(["trigger"]);
    ps.setKeyEnabled(STREAM_KEYS.BEAT, true);
    ps.beat({ step: 1 });
    expect(store.calls).toHaveLength(2);
  });

  it("holds notes until their audio time (+ output latency + offset)", () => {
    const store = localStore();
    const timers = [];
    const ps = new PerformanceStream({ getStore: () => store, setTimer: (fn, ms) => timers.push({ fn, ms }) });
    ps.setContext({ currentTime: 10, outputLatency: 0.02 });
    ps.offsetMs = 5;
    ps.note({ note: 1 }, 10.1);
    expect(store.calls).toEqual([]);
    expect(timers[0].ms).toBeCloseTo(100 + 20 + 5);
    timers[0].fn();
    expect(store.calls).toHaveLength(1);
  });

  it("publishes immediately when the time is now/past or unknown", () => {
    const store = localStore();
    const ps = new PerformanceStream({ getStore: () => store, setTimer: () => { throw new Error("no timer"); } });
    ps.setContext({ currentTime: 10 });
    ps.note({ a: 1 }, 9);
    ps.beat({ step: 0 });
    expect(store.calls.map((c) => c[0])).toEqual(["trigger", "transport.beat"]);
  });

  it("respects canPublish (only the host publishes) and enabled", () => {
    const store = localStore();
    const ps = new PerformanceStream({ getStore: () => store, canPublish: () => false });
    ps.note({ a: 1 });
    ps.instruments([]);
    expect(store.calls).toEqual([]);
    const ps2 = new PerformanceStream({ getStore: () => store });
    ps2.enabled = false;
    ps2.note({ a: 1 });
    expect(store.calls).toEqual([]);
  });

  it("no store → no-op", () => {
    const ps = new PerformanceStream({ getStore: () => null });
    expect(() => ps.note({ a: 1 })).not.toThrow();
  });
});

describe("Controls trigger wrapper", () => {
  it("emits one wam-trigger with a note description per call (nested triggerDrum → trigger counts once)", async () => {
    const { WebAudioControlsBase } = await import("../src/web-audio/ui/controls-base.js");
    const events = [];
    class Inst {
      static TRIGGER_ARGS = { trigger: ["notes", "duration", "velocity", "time"], triggerDrum: ["velocity", "duration", "time"] };
      trigger() {}
      triggerDrum(v, d, t) { return this.trigger(null, d, v, t); }
    }
    const inst = new Inst();
    const fake = Object.create(WebAudioControlsBase.prototype);
    fake.dispatchEvent = (e) => events.push(e.detail);
    fake._muteHandle = { isMuted: () => false };
    WebAudioControlsBase.prototype._wrapTrigger.call(fake, inst);
    inst.triggerDrum(0.9, 0.5, 4);
    inst.trigger([60], 0.25, 0.5, 5);
    expect(events).toHaveLength(2);
    expect(events[0].note).toMatchObject({ notes: [], velocity: 0.9, time: 4 });
    expect(events[1].note).toMatchObject({ notes: [60], velocity: 0.5, duration: 0.25, time: 5 });
    fake._muteHandle = { isMuted: () => true };
    inst.trigger([60], 0.25, 0.5, 6);
    expect(events).toHaveLength(2); // muted → no event
  });
});
