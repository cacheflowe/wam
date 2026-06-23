import { describe, expect, it } from "vitest";
import { midiBindingsEqual, parseMidiMessage } from "../src/web-audio/ui/midi-input-picker.js";
import {
  BUTTONS_ARROWS,
  BUTTONS_ROW_1,
  BUTTONS_SIDE,
  CONTROLS,
  DEFAULT_TEMPLATE,
  KNOBS_ROW_1,
  LED,
  LED_RAMP,
  allLedsOnMessage,
  bindingFor,
  buttonLedChannelMessage,
  doubleBufferMessage,
  findControl,
  fullMidiMap,
  getControl,
  ledColorByPercent,
  ledVelocity,
  resetMessage,
  selectTemplateMessage,
  setLedMessage,
  setLedsMessage,
  setTogglesMessage,
  templateChannel,
} from "../src/web-audio/midi/launch-control-xl.js";

describe("Launch Control XL control map", () => {
  it("covers all 56 physical controls with unique ids", () => {
    expect(CONTROLS).toHaveLength(56);
    expect(new Set(CONTROLS.map((c) => c.id)).size).toBe(56);
    expect(CONTROLS.filter((c) => c.kind === "knob")).toHaveLength(24);
    expect(CONTROLS.filter((c) => c.kind === "fader")).toHaveLength(8);
    expect(CONTROLS.filter((c) => c.kind === "button")).toHaveLength(24);
  });

  it("matches the factory template assignments", () => {
    expect(KNOBS_ROW_1).toEqual([13, 14, 15, 16, 17, 18, 19, 20]);
    expect(BUTTONS_ROW_1).toEqual([41, 42, 43, 44, 57, 58, 59, 60]);
    expect(BUTTONS_SIDE).toEqual([105, 106, 107, 108]);
    expect(BUTTONS_ARROWS).toEqual([104, 105, 106, 107]);
    expect(getControl("fader1").number).toBe(77);
    expect(getControl("fader8").number).toBe(84);
  });

  it("has no CC/note collisions within a message type", () => {
    for (const type of ["cc", "note"]) {
      const numbers = CONTROLS.filter((c) => c.midiType === type).map((c) => c.number);
      expect(new Set(numbers).size).toBe(numbers.length);
    }
  });

  it("assigns sysex LED indices 0-47 to every control except faders", () => {
    const indices = CONTROLS.filter((c) => c.ledIndex != null).map((c) => c.ledIndex);
    expect(indices.sort((a, b) => a - b)).toEqual(Array.from({ length: 48 }, (_, i) => i));
    expect(CONTROLS.filter((c) => c.kind === "fader").every((c) => c.ledIndex == null)).toBe(true);
    expect(getControl("device").ledIndex).toBe(40);
    expect(getControl("right").ledIndex).toBe(47);
  });

  it("assigns toggle indices 0-23 to the 24 buttons", () => {
    const indices = CONTROLS.filter((c) => c.toggleIndex != null).map((c) => c.toggleIndex);
    expect(indices.sort((a, b) => a - b)).toEqual(Array.from({ length: 24 }, (_, i) => i));
    expect(getControl("up").toggleIndex).toBe(20);
  });
});

describe("bindings interop with the app's MIDI message format", () => {
  it("uses factory template 5 (channel 13) by default", () => {
    expect(DEFAULT_TEMPLATE).toBe(12);
    expect(templateChannel()).toBe(13);
    expect(bindingFor("knobA1")).toEqual({ source: "midi", type: "cc", channel: 13, controller: 13 });
    expect(bindingFor("focus1")).toEqual({ source: "midi", type: "note", channel: 13, note: 41 });
  });

  it("matches bindings produced by parseMidiMessage", () => {
    // CC from knobA1 on channel 13 (status 0xB0 + 12)
    const ccMessage = parseMidiMessage([0xbc, 13, 100]);
    expect(midiBindingsEqual(ccMessage.binding, bindingFor("knobA1"))).toBe(true);
    // Note-on from the Device button
    const noteMessage = parseMidiMessage([0x9c, 105, 127]);
    expect(midiBindingsEqual(noteMessage.binding, bindingFor("device"))).toBe(true);
  });

  it("reverse-looks-up controls from incoming bindings", () => {
    expect(findControl({ type: "cc", channel: 13, controller: 84 }).id).toBe("fader8");
    expect(findControl({ type: "note", channel: 13, note: 105 }).id).toBe("device");
    // Same number, different type: CC 105 is the Down arrow, note 105 is Device
    expect(findControl({ type: "cc", channel: 13, controller: 105 }).id).toBe("down");
    // Wrong channel for an explicit template
    expect(findControl({ type: "cc", channel: 1, controller: 13 }, { template: 12 })).toBeNull();
    expect(findControl({ type: "cc", channel: 13, controller: 1 })).toBeNull();
  });

  it("builds a full map keyed by control id", () => {
    const map = fullMidiMap(0); // user template 1 → channel 1
    expect(Object.keys(map)).toHaveLength(56);
    expect(map.knobC3).toEqual({ source: "midi", type: "cc", channel: 1, controller: 51 });
  });
});

describe("LED velocities and messages", () => {
  it("packs red/green brightness with the normal-use flags", () => {
    expect(ledVelocity(0, 0)).toBe(LED.OFF);
    expect(ledVelocity(3, 0)).toBe(LED.RED_FULL);
    expect(ledVelocity(3, 3)).toBe(LED.AMBER_FULL);
    expect(ledVelocity(0, 3)).toBe(LED.GREEN_FULL);
    expect(ledVelocity(3, 0, { flash: true })).toBe(LED.FLASH_RED);
    expect(ledVelocity(3, 3, { doubleBuffer: true })).toBe(0x33);
  });

  it("ramps 0..1 onto the color scale", () => {
    expect(ledColorByPercent(0)).toBe(LED.OFF);
    expect(ledColorByPercent(1)).toBe(LED.GREEN_FULL);
    expect(ledColorByPercent(0.5)).toBe(LED_RAMP[4]);
  });

  it("builds sysex set-LED messages per the programmer's reference", () => {
    expect(setLedMessage("knobA1", LED.GREEN_FULL)).toEqual([
      0xf0, 0x00, 0x20, 0x29, 0x02, 0x11, 0x78, 12, 0, 60, 0xf7,
    ]);
    expect(setLedsMessage([[24, 15], [25, 63]], 8)).toEqual([
      0xf0, 0x00, 0x20, 0x29, 0x02, 0x11, 0x78, 8, 24, 15, 25, 63, 0xf7,
    ]);
    expect(setLedMessage("fader1", 60)).toBeNull();
  });

  it("builds toggle, template, and channel-mode messages", () => {
    expect(setTogglesMessage([[0, 127]])).toEqual([0xf0, 0x00, 0x20, 0x29, 0x02, 0x11, 0x7b, 12, 0, 127, 0xf7]);
    expect(selectTemplateMessage(8)).toEqual([0xf0, 0x00, 0x20, 0x29, 0x02, 0x11, 0x77, 8, 0xf7]);
    expect(buttonLedChannelMessage("focus1", LED.AMBER_FULL)).toEqual([0x9c, 41, 63]);
    expect(buttonLedChannelMessage("up", LED.RED_FULL)).toEqual([0xbc, 104, 15]);
    expect(buttonLedChannelMessage("knobA1", 15)).toBeNull();
  });

  it("builds reset, LED-test, and double-buffer messages", () => {
    expect(resetMessage(12)).toEqual([0xbc, 0x00, 0x00]);
    expect(allLedsOnMessage(3, 12)).toEqual([0xbc, 0x00, 0x7f]);
    expect(allLedsOnMessage(1, 8)).toEqual([0xb8, 0x00, 0x7d]);
    // Appendix sequence: display buffer 1, update buffer 0, copy → 0x31
    expect(doubleBufferMessage({ display: 1, update: 0, copy: true }, 12)).toEqual([0xbc, 0x00, 0x31]);
    expect(doubleBufferMessage({ display: 0, update: 1, copy: true }, 12)).toEqual([0xbc, 0x00, 0x34]);
    expect(doubleBufferMessage({ flash: true }, 12)).toEqual([0xbc, 0x00, 0x28]);
    expect(doubleBufferMessage({}, 12)).toEqual([0xbc, 0x00, 0x20]);
    // Appendix "turn double-buffering off": copy back to a single buffer → 0x30
    expect(doubleBufferMessage({ copy: true }, 12)).toEqual([0xbc, 0x00, 0x30]);
  });
});
