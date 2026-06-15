import { describe, expect, it } from "vitest";
import MidiOutput from "../src/web-audio/midi/midi-output.js";
import { setLedsMessage, LED } from "../src/web-audio/midi/launch-control-xl.js";

function fakePort() {
  return { sent: [], send(bytes) { this.sent.push(bytes); } };
}

describe("MidiOutput", () => {
  it("coalesces queued LEDs into a single sysex on flush", () => {
    const port = fakePort();
    const mo = new MidiOutput().setOutput(port);
    mo.queueLed(24, LED.RED_FULL);
    mo.queueLed(25, LED.GREEN_FULL);
    expect(port.sent).toHaveLength(0); // nothing sent until flush
    mo.flush();
    expect(port.sent).toHaveLength(1);
    expect(port.sent[0]).toEqual(setLedsMessage([[24, LED.RED_FULL], [25, LED.GREEN_FULL]], mo.template));
  });

  it("dedupes unchanged LED values across flushes", () => {
    const port = fakePort();
    const mo = new MidiOutput().setOutput(port);
    mo.queueLed(0, LED.AMBER_FULL);
    mo.flush();
    mo.queueLed(0, LED.AMBER_FULL); // same value → no-op
    mo.flush();
    expect(port.sent).toHaveLength(1);

    mo.queueLed(0, LED.OFF); // changed → sends
    mo.flush();
    expect(port.sent).toHaveLength(2);
  });

  it("re-sends after a template change (LEDs are per-template)", () => {
    const port = fakePort();
    const mo = new MidiOutput().setOutput(port);
    mo.queueLed(0, LED.GREEN_FULL);
    mo.flush();
    mo.setTemplate(8); // clears dedupe cache + pending
    mo.queueLed(0, LED.GREEN_FULL); // same value, new template → must send
    mo.flush();
    expect(port.sent).toHaveLength(2);
    expect(port.sent[1]).toEqual(setLedsMessage([[0, LED.GREEN_FULL]], 8));
  });

  it("resolves control ids to LED indices and skips LED-less controls", () => {
    const port = fakePort();
    const mo = new MidiOutput().setOutput(port);
    mo.queueControlLed("focus1", LED.GREEN_FULL); // ledIndex 24
    mo.queueControlLed("fader1", LED.GREEN_FULL); // no LED → ignored
    mo.flush();
    expect(port.sent[0]).toEqual(setLedsMessage([[24, LED.GREEN_FULL]], mo.template));
  });

  it("never sends with no output port", () => {
    const mo = new MidiOutput();
    mo.queueLed(0, LED.RED_FULL);
    mo.flush();
    expect(mo.send([0xb0, 0, 0])).toBe(false);
  });

  it("invalidate() forces a repaint of previously-sent LEDs", () => {
    const port = fakePort();
    const mo = new MidiOutput().setOutput(port);
    mo.queueLed(0, LED.RED_FULL);
    mo.flush();
    mo.invalidate();
    mo.queueLed(0, LED.RED_FULL); // same value but cache cleared → sends
    mo.flush();
    expect(port.sent).toHaveLength(2);
  });
});
