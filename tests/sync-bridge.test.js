import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TransportSync } from "../src/site/sync-bridge.js";
import { SyncManager } from "../src/site/sync-manager.js";

/**
 * Minimal AppStoreDistributed stand-in using only its public surface:
 * set(k, v, broadcast) + getData(k) + senderId. `receive()` mimics an inbound
 * socket message (getData updated, then local set → listeners).
 */
function fakeDistributedStore(senderId = "me") {
  const store = {
    senderId,
    state: {},
    listeners: [],
    methods: {},
    sent: [],
    data: {},
    isConnected: () => true,
    addListener(obj) { this.listeners.push(obj); },
    removeListener(obj) { this.listeners = this.listeners.filter((l) => l !== obj); },
    getData(k) { return this.data[k]; },
    set(k, v, broadcast = false) {
      if (broadcast) { this.sent.push([k, v]); return; }
      this.state[k] = v;
      for (const l of this.listeners) l.storeUpdated(k, v);
    },
    receive(k, v, sender) {
      this.data[k] = { key: k, value: v, sender, time: Date.now() };
      this.set(k, v);
    },
  };
  return store;
}

function fakeTransport() {
  return {
    playing: false,
    bpm: 120,
    calls: [],
    play() { this.playing = true; this.calls.push("play"); window._store.set("transport.playing", true); },
    stop() { this.playing = false; this.calls.push("stop"); window._store.set("transport.playing", false); },
  };
}

describe("TransportSync (both ways, echo-safe)", () => {
  let store, manager, transport, sync;

  beforeEach(() => {
    store = fakeDistributedStore("me");
    window._store = store;
    manager = new SyncManager();
    manager.settings = { ...manager.settings, enabled: true, syncTransport: true, role: "host" };
    transport = fakeTransport();
    // bpm setter mirrors <wam-transport>: local set of transport.bpm
    let bpm = 120;
    Object.defineProperty(transport, "bpm", { get: () => bpm, set: (v) => { bpm = v; window._store.set("transport.bpm", v); } });
    sync = new TransportSync(transport, manager);
    store.addListener(sync);
  });

  afterEach(() => {
    delete window._store;
  });

  it("broadcasts local play/stop and BPM once", () => {
    transport.play();
    transport.bpm = 132;
    transport.stop();
    expect(store.sent).toEqual([["transport.playing", true], ["transport.bpm", 132], ["transport.playing", false]]);
  });

  it("our own echo is a no-op (no re-broadcast, no re-apply)", () => {
    transport.play();
    store.receive("transport.playing", true, "me");
    expect(store.sent).toHaveLength(1);
    expect(transport.calls).toEqual(["play"]);
  });

  it("applies remote play / BPM without re-broadcasting them", () => {
    store.receive("transport.playing", true, "other");
    store.receive("transport.bpm", 140, "other");
    expect(transport.calls).toEqual(["play"]);
    expect(transport.bpm).toBe(140);
    expect(store.sent).toEqual([]);
  });

  it("a local change after a remote one is still broadcast", () => {
    store.receive("transport.playing", true, "other");
    transport.stop();
    expect(store.sent).toEqual([["transport.playing", false]]);
  });

  it("observers apply remote changes but never broadcast", () => {
    manager.settings.role = "observer";
    transport.play();
    expect(store.sent).toEqual([]);
    store.receive("transport.bpm", 99, "host");
    expect(transport.bpm).toBe(99);
  });

  it("does nothing when transport sync is off", () => {
    manager.settings.syncTransport = false;
    transport.play();
    store.receive("transport.bpm", 99, "host");
    expect(store.sent).toEqual([]);
    expect(transport.bpm).toBe(120);
  });
});

describe("SyncManager", () => {
  it("isRemote: only new inbound messages from other senders", () => {
    const store = fakeDistributedStore("me");
    window._store = store;
    const m = new SyncManager();
    expect(m.isRemote("k")).toBe(false); // nothing received
    store.data.k = { value: 1, sender: "other" };
    expect(m.isRemote("k")).toBe(true);
    expect(m.isRemote("k")).toBe(false); // same message already seen → a later local set
    store.data.k = { value: 2, sender: "me" };
    expect(m.isRemote("k")).toBe(false); // our own echo
    delete window._store;
  });

  it("warns about ws:// from an https page to a non-local host", () => {
    const m = new SyncManager();
    m.settings.url = "not a url";
    expect(m.warnings[0]).toMatch(/valid URL/);
    m.settings.url = "http://x";
    expect(m.warnings[0]).toMatch(/ws:\/\//);
  });

  it("shareLink carries server, channel and role", () => {
    const m = new SyncManager();
    m.settings = { ...m.settings, url: "wss://sync.example/ws", channel: "set1" };
    const u = new URL(m.shareLink("control"));
    expect(u.searchParams.get("sync")).toBe("wss://sync.example/ws");
    expect(u.searchParams.get("channel")).toBe("set1");
    expect(u.searchParams.get("role")).toBe("control");
  });
});
