import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { SongPlayer } from "../src/web-audio/global/song-player.js";
import { instrumentDef } from "../src/web-audio/instruments/registry.js";
import { mountTrack } from "./helpers/track-harness.js";

const song = (name) => JSON.parse(fs.readFileSync(path.resolve(__dirname, `../src/data/songs/${name}.json`), "utf8"));
const TICKS = 16 * 8;

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("SongPlayer (headless)", () => {
  it("loads a song: tracks for supported types, skipped list for the rest", async () => {
    const p = new SongPlayer(new AudioContext());
    const { tracks, skipped } = await p.load({
      transport: { bpm: 100, root: 29, scale: "Minor" },
      instruments: [{ id: "kick", state: {} }, { id: "acid", state: { chordSize: 1 } }, { id: "loop-breaks", state: {} }, { id: "nope" }],
    });
    expect(tracks.map((t) => t.id)).toEqual(["kick", "acid"]);
    expect(skipped.map((s) => s.id)).toEqual(["loop-breaks", "nope"]);
    expect(p.bpm).toBe(100);
    expect(tracks[1].instrument.scaleName).toBe("Minor");
  });

  it("applies params, channel (volume/pan/mute) and solo", async () => {
    const p = new SongPlayer(new AudioContext());
    const { tracks } = await p.load({
      transport: {},
      instruments: [
        { id: "acid", state: { params: { cutoff: 1234, volume: 0.4 }, pan: -0.5, muted: true } },
        { id: "kick", state: { soloed: true } },
      ],
    });
    expect(tracks[0].instrument.cutoff).toBe(1234);
    expect(tracks[0].channel.toJSON()).toEqual({ volume: 0.4, pan: -0.5, muted: true });
    expect(tracks[0].channel.soloSuppressed).toBe(true);
    expect(tracks[1].channel.soloSuppressed).toBe(false);
  });

  describe.each(["wobbler", "techdrift"])("plays %s exactly like the playground panels", (name) => {
    const data = song(name);
    const supported = data.instruments.filter((i) => {
      const d = instrumentDef(i.id);
      return d && d.sequenced && !d.samples && d.id !== "vocoder";
    });

    it.each(supported.map((i, n) => [`${i.id}#${n}`, i]))("%s fires the same steps at the same times", async (_label, inst) => {
      vi.spyOn(Math, "random").mockReturnValue(0.5); // probability + octave jumps deterministic on both sides

      // Headless
      const p = new SongPlayer(new AudioContext());
      await p.load({ transport: data.transport, instruments: [inst] });
      const tr = p.tracks[0];
      const headless = [];
      let tick = 0;
      const orig = tr.instrument.triggerSequenceStep.bind(tr.instrument);
      tr.instrument.triggerSequenceStep = (index, s, time, dur) => {
        headless.push([tick, index, +time.toFixed(6)]);
        return orig(index, s, time, dur);
      };
      p.bpm = 120; // harness uses 0.125 s ticks
      for (; tick < TICKS; tick++) p.tick(tick % 16, tick * 0.125);

      // UI panel loaded from the same song state
      const def = instrumentDef(inst.id);
      const ui = mountTrack(inst.state, { Instrument: def.Instrument, Controls: customElements.get(def.controlsTag) }).run(TICKS);
      const panel = ui.fired.map((f) => [f.tick, f.index, +f.time.toFixed(6)]);

      expect(headless.length).toBeGreaterThan(0);
      expect(headless).toEqual(panel);
    });
  });
});
