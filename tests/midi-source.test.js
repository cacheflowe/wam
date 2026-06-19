import { describe, expect, it, vi } from "vitest";
import { parseMidiMessage } from "../src/web-audio/ui/midi-input-picker.js";
import {
  bindingsEqual,
  formatBinding,
  CONTROL_INPUT_EVENT,
  COMMAND_EVENT,
  registerCommandBinding,
} from "../src/web-audio/input/input-bindings.js";
import MidiInputSource, { midiMessageToControlInput } from "../src/web-audio/input/midi-source.js";

describe("MidiInputSource normalization", () => {
  it("maps CC to an absolute, 0..1-normalized control event", () => {
    const message = parseMidiMessage([0xbc, 13, 127]); // ch13 CC13 full
    const detail = midiMessageToControlInput(message);
    expect(detail).toEqual({
      binding: { source: "midi", type: "cc", channel: 13, controller: 13 },
      value: 1,
      kind: "absolute",
      raw: message,
    });
  });

  it("maps note-on to a trigger event", () => {
    const message = parseMidiMessage([0x9c, 41, 127]); // ch13 note 41
    const detail = midiMessageToControlInput(message);
    expect(detail.kind).toBe("trigger");
    expect(detail.pressed).toBe(true);
    expect(detail.value).toBe(1);
    expect(detail.binding).toEqual({ source: "midi", type: "note", channel: 13, note: 41 });
  });

  it("normalizes mid-range CC values", () => {
    expect(midiMessageToControlInput(parseMidiMessage([0xb0, 7, 64])).value).toBeCloseTo(64 / 127);
  });

  it("returns null for unmappable input", () => {
    expect(midiMessageToControlInput(null)).toBeNull();
    expect(midiMessageToControlInput({})).toBeNull();
  });

  it("registers the 'midi' binding type so the generic registry works", () => {
    const a = { source: "midi", type: "cc", channel: 13, controller: 13 };
    const b = { source: "midi", type: "cc", channel: 13, controller: 13 };
    expect(bindingsEqual(a, b)).toBe(true);
    expect(bindingsEqual(a, { source: "midi", type: "cc", channel: 13, controller: 14 })).toBe(false);
    expect(formatBinding(a)).toBe("CC13");
    expect(formatBinding({ source: "midi", type: "note", note: 60 })).toBe("M60");
  });

  it("translates wam-midi-message into wam-control-input while running", () => {
    const target = new EventTarget();
    const source = new MidiInputSource(target).start();
    const handler = vi.fn();
    target.addEventListener(CONTROL_INPUT_EVENT, handler);

    target.dispatchEvent(new CustomEvent("wam-midi-message", { detail: parseMidiMessage([0xbc, 13, 100]) }));
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].detail.binding.controller).toBe(13);
    expect(handler.mock.calls[0][0].detail.value).toBeCloseTo(100 / 127);

    source.stop();
    target.dispatchEvent(new CustomEvent("wam-midi-message", { detail: parseMidiMessage([0xbc, 13, 50]) }));
    expect(handler).toHaveBeenCalledOnce(); // no further events after stop()
  });

  describe("command bindings", () => {
    it("emits a CC command on press only, not on release", () => {
      // ch13 CC106 (left arrow) → a command. Press sends 127, release sends 0.
      registerCommandBinding({ source: "midi", type: "cc", channel: 13, controller: 106 }, "prev-instrument");

      const press = parseMidiMessage([0xbc, 106, 127]);
      const release = parseMidiMessage([0xbc, 106, 0]);
      expect(midiMessageToControlInput(press)).toEqual({ command: "prev-instrument", raw: press });
      expect(midiMessageToControlInput(release)).toBeNull();
    });

    it("dispatches wam-command (not wam-control-input) for a bound command", () => {
      registerCommandBinding({ source: "midi", type: "cc", channel: 13, controller: 107 }, "next-instrument");

      const target = new EventTarget();
      const source = new MidiInputSource(target).start();
      const onCommand = vi.fn();
      const onControlInput = vi.fn();
      target.addEventListener(COMMAND_EVENT, onCommand);
      target.addEventListener(CONTROL_INPUT_EVENT, onControlInput);

      target.dispatchEvent(new CustomEvent("wam-midi-message", { detail: parseMidiMessage([0xbc, 107, 127]) }));
      expect(onCommand).toHaveBeenCalledOnce();
      expect(onCommand.mock.calls[0][0].detail.command).toBe("next-instrument");
      expect(onControlInput).not.toHaveBeenCalled();

      // Release dispatches nothing.
      target.dispatchEvent(new CustomEvent("wam-midi-message", { detail: parseMidiMessage([0xbc, 107, 0]) }));
      expect(onCommand).toHaveBeenCalledOnce();
      source.stop();
    });
  });
});
