import { describe, expect, it } from "vitest";
import { LedFeedback } from "../src/web-audio/midi/led-feedback.js";
import { dispatchBindingFeedback } from "../src/web-audio/input/input-bindings.js";
import { bindingFor, getControl, setLedsMessage, LED, ledColorByPercent } from "../src/web-audio/midi/launch-control-xl.js";

function fakeAccessWith(outputName) {
  const port = { id: "out", name: outputName, sent: [], send(b) { this.sent.push(b); } };
  return {
    access: { outputs: new Map([[port.id, port]]), addEventListener() {}, removeEventListener() {} },
    port,
  };
}

describe("LedFeedback", () => {
  it("lights a bound LCXL control with the bound indicator color", () => {
    const target = new EventTarget();
    const { access, port } = fakeAccessWith("MIDIOUT2 (Launch Control XL)");
    const fb = new LedFeedback(target);
    fb.adoptAccess(access);

    dispatchBindingFeedback({ kind: "bound", binding: bindingFor("knobA1") }, target);
    fb.output.flush();

    const ledIndex = getControl("knobA1").ledIndex;
    expect(port.sent[0]).toEqual(setLedsMessage([[ledIndex, LED.RED_LOW]], fb.output.template));
  });

  it("mirrors a value as a ramp color", () => {
    const target = new EventTarget();
    const { access, port } = fakeAccessWith("MIDIOUT2 (Launch Control XL)");
    const fb = new LedFeedback(target);
    fb.adoptAccess(access);

    dispatchBindingFeedback({ kind: "value", binding: bindingFor("knobA1"), value: 1 }, target);
    fb.output.flush();

    const ledIndex = getControl("knobA1").ledIndex;
    expect(port.sent[0]).toEqual(setLedsMessage([[ledIndex, ledColorByPercent(1)]], fb.output.template));
  });

  it("turns an LED off when unbound", () => {
    const target = new EventTarget();
    const { access, port } = fakeAccessWith("Launch Control XL");
    const fb = new LedFeedback(target);
    fb.adoptAccess(access);

    dispatchBindingFeedback({ kind: "bound", binding: bindingFor("focus1") }, target);
    fb.output.flush();
    dispatchBindingFeedback({ kind: "unbound", binding: bindingFor("focus1") }, target);
    fb.output.flush();

    const ledIndex = getControl("focus1").ledIndex;
    expect(port.sent[1]).toEqual(setLedsMessage([[ledIndex, LED.OFF]], fb.output.template));
  });

  it("ignores non-LCXL bindings and LED-less controls", () => {
    const target = new EventTarget();
    const { access, port } = fakeAccessWith("MIDIOUT2 (Launch Control XL)");
    const fb = new LedFeedback(target);
    fb.adoptAccess(access);

    dispatchBindingFeedback({ kind: "value", binding: { source: "keyboard", key: "b" }, value: 1 }, target);
    dispatchBindingFeedback({ kind: "value", binding: bindingFor("fader1"), value: 1 }, target); // faders have no LED
    fb.output.flush();
    expect(port.sent).toHaveLength(0);
  });

  it("tracks the template from incoming MIDI channel", () => {
    const target = new EventTarget();
    const { access, port } = fakeAccessWith("MIDIOUT2 (Launch Control XL)");
    const fb = new LedFeedback(target);
    fb.adoptAccess(access);

    // Device transmitting on channel 9 → template slot 8.
    target.dispatchEvent(new CustomEvent("wam-midi-message", { detail: { type: "cc", channel: 9, controller: 13, value: 1 } }));
    dispatchBindingFeedback({ kind: "value", binding: bindingFor("knobA1"), value: 1 }, target);
    fb.output.flush();

    const ledIndex = getControl("knobA1").ledIndex;
    expect(port.sent[0]).toEqual(setLedsMessage([[ledIndex, ledColorByPercent(1)]], 8));
  });

  it("does nothing without an output port", () => {
    const target = new EventTarget();
    const fb = new LedFeedback(target);
    fb.start();
    dispatchBindingFeedback({ kind: "bound", binding: bindingFor("knobA1") }, target);
    fb.output.flush();
    expect(fb.output.output).toBeNull();
  });
});
