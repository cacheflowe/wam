import { describe, it, expect } from "vitest";
import { MasterLimiter, makeCeilingCurve } from "../src/web-audio/fx/fx-limiter.js";
import { SongPlayer } from "../src/web-audio/global/song-player.js";

describe("MasterLimiter", () => {
  it("ceiling curve: transparent below the knee, never above the ceiling, odd-symmetric", () => {
    const c = makeCeilingCurve(4097);
    const at = (x) => c[Math.round(((x + 1) / 2) * (c.length - 1))];
    expect(at(0.5)).toBeCloseTo(0.5, 3);
    expect(at(-0.8)).toBeCloseTo(-0.8, 3);
    expect(Math.max(...c)).toBeLessThan(1);
    expect(Math.min(...c)).toBeGreaterThan(-1);
    expect(at(1)).toBeCloseTo(-at(-1), 6);
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThanOrEqual(c[i - 1]); // monotonic
  });

  it("is on by default and can be bypassed", () => {
    const l = new MasterLimiter(new AudioContext());
    expect(l.enabled).toBe(true);
    l.enabled = false;
    expect(l.enabled).toBe(false);
    l.enabled = true;
    expect(l.enabled).toBe(true);
  });

  it("the song player honors transport.limiter (default on)", async () => {
    const a = new SongPlayer(new AudioContext());
    await a.load({ transport: {}, instruments: [] });
    expect(a.limiter.enabled).toBe(true);
    const b = new SongPlayer(new AudioContext());
    await b.load({ transport: { limiter: false }, instruments: [] });
    expect(b.limiter.enabled).toBe(false);
  });
});
