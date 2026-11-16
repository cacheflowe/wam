import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PlaygroundAutosave } from "../src/app/playground-autosave.js";

/** Minimal Storage implementation (optionally with a byte quota). */
function memStorage(quota = Infinity) {
  const m = new Map();
  const size = () => [...m.values()].reduce((n, v) => n + v.length, 0);
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem(k, v) {
      const next = size() - (m.get(k)?.length ?? 0) + String(v).length;
      if (next > quota) { const e = new Error("quota"); e.name = "QuotaExceededError"; throw e; }
      m.set(k, String(v));
    },
    removeItem: (k) => m.delete(k),
    _map: m,
  };
}

const song = (n, name = null) => ({ v: 1, songName: name, instruments: Array.from({ length: n }, (_, i) => ({ id: "kick", state: { i } })) });

describe("PlaygroundAutosave", () => {
  let ls;
  beforeEach(() => {
    ls = memStorage();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  /** A "tab": its own sessionStorage, shared localStorage. */
  const tab = (state, session = memStorage(), opts = {}) =>
    new PlaygroundAutosave({ getState: () => state.current, storage: ls, session, win: null, ...opts });

  it("debounces, and flush() writes a pending save immediately", () => {
    const state = { current: song(1) };
    const a = tab(state);
    a.schedule();
    expect(a.load()).toBeNull();
    a.flush();
    expect(a.load().state.instruments).toHaveLength(1);
  });

  it("a refresh (same sessionStorage) restores THIS tab's work even if another tab saved later", () => {
    const sessA = memStorage();
    const a = tab({ current: song(3, "mine") }, sessA);
    a.save();
    vi.advanceTimersByTime(10);
    const b = tab({ current: song(1, "stale") });
    b.save(); // e.g. a background tab reacting to MIDI
    const aReloaded = tab({ current: null }, sessA);
    expect(aReloaded.tabId).toBe(a.tabId);
    expect(aReloaded.load()).toMatchObject({ source: "tab", state: { songName: "mine" } });
  });

  it("a new tab starts from the newest save across tabs", () => {
    tab({ current: song(1, "old") }).save();
    vi.setSystemTime(Date.now() + 1000);
    tab({ current: song(2, "new") }).save();
    expect(tab({ current: null }).load()).toMatchObject({ source: "newest", state: { songName: "new" } });
  });

  it("migrates the legacy single-key save", () => {
    ls.setItem("wam_playground_settings", JSON.stringify(song(4, "legacy")));
    expect(tab({ current: null }).load()).toMatchObject({ source: "legacy", state: { songName: "legacy" } });
  });

  it("reports serialization errors instead of failing silently", () => {
    const statuses = [];
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const a = tab({ get current() { throw new Error("toJSON blew up"); } }, memStorage(), { onStatus: (s) => statuses.push(s) });
    expect(a.save()).toBe(false);
    expect(statuses.at(-1)).toMatchObject({ ok: false });
    expect(statuses.at(-1).error).toMatch(/toJSON blew up/);
    err.mockRestore();
  });

  it("on a full store, prunes other tabs' old saves and retries", () => {
    ls = memStorage(2500);
    const big = (name) => ({ songName: name, instruments: [], pad: "x".repeat(600) });
    for (let i = 0; i < 3; i++) {
      vi.setSystemTime(1000 + i);
      tab({ current: big(`t${i}`) }).save();
    }
    const statuses = [];
    vi.setSystemTime(5000);
    const a = tab({ current: big("mine") }, memStorage(), { onStatus: (s) => statuses.push(s) });
    expect(a.save()).toBe(true);
    expect(a.load().state.songName).toBe("mine");
    expect(statuses.at(-1).ok).toBe(true);
  });

  it("schedule() is ignored while suspended (loading)", () => {
    const a = tab({ current: song(1) });
    a.suspended = true;
    a.schedule();
    a.flush();
    expect(a.load()).toBeNull();
  });

  it("backup() keeps the state about to be loaded; recent() lists sessions newest first", () => {
    const a = tab({ current: song(2, "x") });
    a.backup(song(5, "pre"), "startup");
    expect(a.loadBackup()).toMatchObject({ label: "startup", state: { songName: "pre" } });
    a.save();
    vi.setSystemTime(Date.now() + 1000);
    tab({ current: song(1, "other") }).save();
    const r = a.recent();
    expect(r.map((x) => [x.songName, x.thisTab])).toEqual([["other", false], ["x", true]]);
  });
});
