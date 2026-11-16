import { describe, it, expect, afterEach } from "vitest";
import { Channel, gainFaderState } from "../src/web-audio/global/channel.js";
import { FxChain } from "../src/web-audio/fx/fx-chain.js";
import { mountTrack, trackState } from "./helpers/track-harness.js";

const gainOf = (ch) => ch.fader.gain.value;

describe("Channel — derived gain (volume × mute × solo)", () => {
  it("volume changes while muted are kept and come back on unmute", () => {
    const ch = new Channel(new AudioContext(), { volume: 0.8 });
    ch.muted = true;
    expect(gainOf(ch)).toBe(0);
    ch.volume = 0.3;
    expect(gainOf(ch)).toBe(0);
    ch.muted = false;
    expect(gainOf(ch)).toBe(0.3);
  });

  it("solo suppression and mute are independent", () => {
    const ch = new Channel(new AudioContext(), { volume: 0.5 });
    ch.soloSuppressed = true;
    ch.muted = true;
    ch.soloSuppressed = false; // solo released while still muted
    expect(gainOf(ch)).toBe(0);
    ch.muted = false;
    expect(gainOf(ch)).toBe(0.5);
    expect(ch.audible).toBe(true);
  });

  it("restoring a muted channel keeps its volume (was: needed a special restoreOnUnmute flag)", () => {
    const ch = new Channel(new AudioContext());
    ch.fromJSON({ volume: 0.7, muted: true, pan: -0.5 });
    expect(ch.toJSON()).toEqual({ volume: 0.7, pan: -0.5, muted: true });
    ch.muted = false;
    expect(gainOf(ch)).toBe(0.7);
  });

  it("FX can be inserted and swapped", () => {
    const ctx = new AudioContext();
    const ch = new Channel(ctx);
    const fx = new FxChain(ctx);
    expect(() => ch.setFx(fx)).not.toThrow();
    expect(ch.fx).toBe(fx);
    expect(() => ch.setFx(null)).not.toThrow();
    expect(ch.fx).toBeNull();
  });
});

describe("gainFaderState (single gain node, e.g. master bus)", () => {
  it("applies the same derived rule to one node", () => {
    const node = { gain: { value: 1 } };
    const f = gainFaderState(() => node, 0.9);
    f.muted = true;
    f.volume = 0.4;
    expect(node.gain.value).toBe(0);
    f.muted = false;
    expect(node.gain.value).toBe(0.4);
    f.soloSuppressed = true;
    expect(node.gain.value).toBe(0);
  });
});

describe("Controls render a Channel", () => {
  afterEach(() => (document.body.innerHTML = ""));

  it("a muted instrument saves and restores its real volume and mute state", () => {
    const t = mountTrack(trackState());
    t.ctrl.setVolume(0.42);
    t.ctrl.toggleMute();
    const saved = t.ctrl.toJSON();
    expect(saved.params.volume).toBeCloseTo(0.42);
    expect(saved.muted).toBe(true);

    const u = mountTrack(trackState());
    u.ctrl.fromJSON(saved);
    expect(u.ctrl.muted).toBe(true);
    expect(u.ctrl.volume).toBeCloseTo(0.42);
    expect(u.ctrl._channel.fader.gain.value).toBe(0);
    u.ctrl.toggleMute();
    expect(u.ctrl._channel.fader.gain.value).toBeCloseTo(0.42);
  });

  it("the volume knob moves the channel volume even while muted", () => {
    const t = mountTrack(trackState());
    t.ctrl.toggleMute();
    t.ctrl.setVolume(0.6);
    expect(t.ctrl.volume).toBeCloseTo(0.6);
    t.ctrl.toggleMute();
    expect(t.ctrl._channel.fader.gain.value).toBeCloseTo(0.6);
  });
});
