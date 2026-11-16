import { describe, expect, it, beforeEach } from "vitest";
import { PerformanceSurface, MODES } from "../src/web-audio/midi/performance-surface.js";
import { SequencerHardware } from "../src/web-audio/midi/sequencer-hardware.js";
import { AutoMap } from "../src/web-audio/midi/auto-map.js";
import { bindingFor, COMMANDS, LED, ledColorByPercent } from "../src/web-audio/midi/launch-control-xl.js";
import { Conductor } from "../src/web-audio/global/evolver.js";

/** Records the latest LED value per control id. */
function fakeOutput() {
  return { leds: {}, queueControlLed(id, v) { this.leds[id] = v; } };
}

/** Controls stand-in implementing the public performance API. */
function fakeCtrl(name) {
  const c = new EventTarget();
  Object.assign(c, {
    name,
    volume: 0.5,
    muted: false,
    calls: [],
    _paramBindings: {},
    _learnRegistry: {},
    _instrument: { constructor: {} },
    patternNames: ["A", "B", "C", "D"],
    playingPattern: "A",
    queuedPattern: null,
    patternHasSteps: (p) => p === "A",
    setVolume(v) { this.volume = v; this.calls.push(["setVolume", v]); },
    toggleMute() { this.muted = !this.muted; this.calls.push(["toggleMute"]); },
    launchPattern(p) { this.calls.push(["launch", p]); },
    stepPreset(d) { this.calls.push(["preset", d]); },
    mutate(a) { this.calls.push(["mutate", a]); },
    undoSound() { this.calls.push(["undo"]); },
    redoSound() { this.calls.push(["redo"]); },
    _randomizeAllParams() { this.calls.push(["rand"]); },
    jam() { this.calls.push(["jam"]); },
    evolveNow(e) { this.calls.push(["evolve", e]); },
    keepVariation() { this.calls.push(["keep"]); },
    returnHome() { this.calls.push(["home"]); },
    setAutoBindings() {},
    clearAutoBindings() {},
    _defaultTitle: () => name,
  });
  return c;
}

const midi = (controlId, value, kind = "absolute") => ({
  binding: bindingFor(controlId),
  value,
  kind,
  pressed: kind === "trigger" ? value > 0 : undefined,
});

describe("PerformanceSurface", () => {
  let target, out, seqHw, autoMap, surface, a, b;

  beforeEach(() => {
    target = new EventTarget();
    out = fakeOutput();
    seqHw = new SequencerHardware(out, target);
    autoMap = new AutoMap(target);
    surface = new PerformanceSurface({ output: out, sequencerHardware: seqHw, autoMap, target });
    a = fakeCtrl("Acid");
    b = fakeCtrl("Pad");
    surface.setInstrumentsProvider(() => [a, b]);
    surface.start();
    autoMap.focus(a);
  });

  const send = (detail) => target.dispatchEvent(new CustomEvent("wam-control-input", { detail }));
  const command = (c) => target.dispatchEvent(new CustomEvent("wam-command", { detail: { command: c } }));

  it("side-button commands switch modes, light the mode LED, and hand buttons to/from the sequencer", () => {
    expect(surface.mode).toBe(MODES.STEPS);
    expect(seqHw.enabled).toBe(true);
    command(COMMANDS.MODE_MIXER);
    expect(surface.mode).toBe(MODES.MIXER);
    expect(seqHw.enabled).toBe(false);
    expect(out.leds.solo).toBe(LED.YELLOW_FULL);
    expect(out.leds.mute).toBe(LED.OFF);
    command(COMMANDS.MODE_STEPS);
    expect(seqHw.enabled).toBe(true);
  });

  describe("fader mixer (soft takeover)", () => {
    it("ignores a fader far from the current level until it passes through it", () => {
      send(midi("fader1", 0.9));
      expect(a.volume).toBe(0.5); // not picked up yet
      send(midi("fader1", 0.4)); // crossed 0.5 → picks up
      expect(a.volume).toBe(0.4);
      send(midi("fader1", 0.7));
      expect(a.volume).toBe(0.7);
    });

    it("picks up immediately when close to the current level", () => {
      send(midi("fader2", 0.52));
      expect(b.volume).toBe(0.52);
    });

    it("re-arms pickup when the volume is changed elsewhere", () => {
      send(midi("fader1", 0.5));
      expect(surface.faderPicked(0)).toBe(true);
      a.volume = 0.1; // UI / song load moved it
      send(midi("fader1", 0.6));
      expect(a.volume).toBe(0.1);
    });

    it("works in every mode and ignores empty slots", () => {
      command(COMMANDS.MODE_PERFORM);
      send(midi("fader1", 0.5));
      send(midi("fader1", 0.8));
      expect(a.volume).toBe(0.8);
      expect(() => send(midi("fader8", 0.5))).not.toThrow();
    });

    it("a fader manually MIDI-learned to a param is left alone", () => {
      b._paramBindings = { cutoff: bindingFor("fader1") };
      send(midi("fader1", 0.5));
      expect(a.calls).toEqual([]);
    });
  });

  describe("MIXER mode buttons", () => {
    beforeEach(() => command(COMMANDS.MODE_MIXER));

    it("top row toggles mute; bottom row jams the slot", () => {
      send(midi("focus2", 1, "trigger"));
      expect(b.muted).toBe(true);
      send(midi("control2", 1, "trigger"));
      expect(b.calls).toEqual([["toggleMute"], ["jam"]]);
      expect(a.calls).toEqual([]);
      expect(surface.state.buttons.bottom[0]).toBe("Jam 1");
    });

    it("button releases are ignored", () => {
      send(midi("focus1", 0, "trigger"));
      expect(a.muted).toBe(false);
    });

    it("LEDs show mute state and focus", () => {
      a.muted = true;
      surface.refresh();
      expect(out.leds.focus1).toBe(LED.RED_FULL);
      expect(out.leds.focus2).toBe(LED.GREEN_LOW);
      expect(out.leds.focus3).toBe(LED.OFF); // empty slot
      expect(out.leds.control1).toBe(LED.AMBER_FULL); // focused
      expect(out.leds.control2).toBe(LED.GREEN_LOW);
    });
  });

  describe("PERFORM mode buttons act on the focused instrument", () => {
    beforeEach(() => command(COMMANDS.MODE_PERFORM));

    it("maps the 16 buttons to pattern launch, presets, mutate, randomize, undo/redo", () => {
      const press = (id) => send(midi(id, 1, "trigger"));
      ["focus2", "focus5", "focus6", "control1", "control2", "control3", "control4", "control5", "control6"].forEach(press);
      expect(a.calls).toEqual([
        ["launch", "B"],
        ["preset", -1],
        ["preset", 1],
        ["mutate", 0.1],
        ["mutate", 0.25],
        ["mutate", 0.5],
        ["rand"],
        ["undo"],
        ["redo"],
      ]);
      expect(b.calls).toEqual([]);
    });

    it("pattern LEDs: playing = green full, has steps = green low, empty = red low", () => {
      surface.refresh();
      expect(out.leds.focus1).toBe(LED.GREEN_FULL);
      expect(out.leds.focus2).toBe(LED.RED_LOW);
    });

    it("Evolve / Keep / Return buttons; Evolve uses the conductor's energy", () => {
      const conductor = new Conductor({ tracks: () => [] });
      conductor.energy = 0.8;
      surface.setConductor(conductor);
      ["focus8", "control7", "control8"].forEach((id) => send(midi(id, 1, "trigger")));
      expect(a.calls).toEqual([["evolve", 0.8], ["keep"], ["home"]]);
    });

    it("pressButton() (on-screen map) uses the same path", () => {
      surface.pressButton("bottom", 4);
      expect(a.calls).toEqual([["undo"]]);
    });
  });

  it("knob C8 sets the conductor's energy, lights its LED and shows in the map", () => {
    const conductor = new Conductor({ tracks: () => [] });
    surface.setConductor(conductor);
    send(midi("knobC8", 0.9));
    expect(conductor.energy).toBeCloseTo(0.9);
    surface.refresh();
    expect(out.leds.knobC8).toBe(ledColorByPercent(0.9));
    expect(surface.state.knobs.knobC8).toMatchObject({ label: "Energy", display: "90%" });
  });

  it("state mirrors the focused pattern and playhead (for the on-screen step buttons)", () => {
    const seq = new EventTarget();
    seq.steps = Array.from({ length: 16 }, (_, i) => ({ active: i % 4 === 0 }));
    seq.activeStep = 4;
    a.sequencer = seq;
    const st = surface.state.steps;
    expect(st).toHaveLength(16);
    expect(st[0]).toEqual({ active: true, playing: false });
    expect(st[4]).toEqual({ active: true, playing: true });
    expect(st[5]).toEqual({ active: false, playing: false });
  });

  it("STEPS mode leaves the buttons to the sequencer mapping", () => {
    send(midi("control1", 1, "trigger"));
    expect(a.calls).toEqual([]);
  });

  it("state snapshot drives the on-screen map", () => {
    const s = surface.state;
    expect(s.mode).toBe(MODES.STEPS);
    expect(s.focusedTitle).toBe("Acid");
    expect(s.faders[0]).toMatchObject({ title: "Acid", focused: true });
    expect(s.faders[2]).toBeNull();
    expect(s.buttons.top[0]).toBe("Step 1");
  });
});

describe("SequencerHardware.setEnabled", () => {
  it("ignores presses and leaves LEDs alone while disabled; repaints on enable", () => {
    const target = new EventTarget();
    const out = fakeOutput();
    const hw = new SequencerHardware(out, target);
    hw.start();
    const toggled = [];
    const seq = new EventTarget();
    seq.steps = Array.from({ length: 16 }, (_, i) => ({ active: i === 0 }));
    seq.toggleStep = (i) => toggled.push(i);
    hw.setSequencer(seq);
    hw.setEnabled(false);
    out.leds = {};
    target.dispatchEvent(new CustomEvent("wam-control-input", { detail: midi("focus1", 1, "trigger") }));
    expect(toggled).toEqual([]);
    expect(out.leds).toEqual({});
    hw.setEnabled(true);
    expect(out.leds.focus1).toBe(LED.GREEN_LOW);
  });
});
