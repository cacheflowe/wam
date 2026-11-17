import { describe, expect, it, vi } from "vitest";
import { songId, encodeState, parseShareHash } from "../src/app/playground-share.js";

const state = { v: 1, songName: "Wobbler ∿ 🎛", transport: { bpm: 128 }, instruments: [{ type: "acid", steps: Array(16).fill({ active: true }) }] };

describe("playground share links", () => {
  it("songId slugs song names", () => {
    expect(songId("Electro Break")).toBe("electro-break");
    expect(songId("  Client 04! ")).toBe("client-04");
  });

  it("parses a bundled-song link", async () => {
    expect(await parseShareHash("#playground-app&song=electro-break")).toEqual({ songId: "electro-break" });
  });

  it("round-trips a session (compressed when available), Unicode included", async () => {
    const param = await encodeState(state);
    if (typeof CompressionStream === "function") expect(param.startsWith("z=")).toBe(true);
    expect(await parseShareHash(`#playground-app&${param}`)).toEqual({ state });
  });

  it("falls back to plain s= links without CompressionStream", async () => {
    vi.stubGlobal("CompressionStream", undefined);
    try {
      const param = await encodeState(state);
      expect(param.startsWith("s=")).toBe(true);
      expect(await parseShareHash(`#playground-app&${param}`)).toEqual({ state });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("still opens old links (Latin-1 btoa, legacy #s= route)", async () => {
    const old = { songName: "Café", x: 1 };
    const b64 = btoa(JSON.stringify(old)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(await parseShareHash(`#s=${b64}`)).toEqual({ state: old });
  });

  it("no share params → null", async () => {
    expect(await parseShareHash("#playground-app")).toBeNull();
    expect(await parseShareHash("")).toBeNull();
  });

  it("compressed links are much shorter than plain ones for real songs", async () => {
    if (typeof CompressionStream !== "function") return;
    const song = (await import("../src/data/songs/electro-break.json", { with: { type: "json" } })).default;
    const z = await encodeState(song);
    const plain = btoa(unescape(encodeURIComponent(JSON.stringify(song))));
    expect(z.length).toBeLessThan(plain.length / 3);
  });
});
