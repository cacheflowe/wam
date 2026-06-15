import { describe, expect, it, beforeEach } from "vitest";
import "../src/web-audio/ui/step-seq.js";
import { SequencerHardware } from "../src/web-audio/midi/sequencer-hardware.js";
import MidiOutput from "../src/web-audio/midi/midi-output.js";
import { bindingFor, getControl, LED } from "../src/web-audio/midi/launch-control-xl.js";

// jsdom lacks ResizeObserver, which wam-step-seq uses in connectedCallback.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

function fakePort() {
  return { sent: [], send(b) { this.sent.push(b); } };
}

// Extract [index, velocity] pairs from a Set-LEDs sysex (header is 7 bytes + template).
function pairsOf(msg) {
  const out = [];
  for (let i = 8; i < msg.length - 1; i += 2) out.push([msg[i], msg[i + 1]]);
  return out;
}
function sentPair(port, index, velocity) {
  return port.sent.some((m) => pairsOf(m).some(([i, v]) => i === index && v === velocity));
}

function makeSeq() {
  const seq = document.createElement("wam-step-seq");
  seq.init({
    steps: Array.from({ length: 16 }, () => ({ active: false, note: 60 })),
    noteOptions: [["C", 60]],
  });
  document.body.appendChild(seq); // so step-change/step-active bubble to document
  return seq;
}

describe("SequencerHardware", () => {
  let out, port, sh, seq;

  beforeEach(() => {
    port = fakePort();
    out = new MidiOutput().setOutput(port);
    sh = new SequencerHardware(out, document);
    sh.start();
    seq = makeSeq();
    sh.setSequencer(seq);
    out.flush();
    port.sent.length = 0; // ignore the initial clear/paint
  });

  it("toggles the focused sequencer's step when a button is pressed", () => {
    document.dispatchEvent(
      new CustomEvent("wam-control-input", {
        detail: { binding: bindingFor("focus1"), kind: "trigger", pressed: true },
      }),
    );
    expect(seq.steps[0].active).toBe(true);

    // ...and the bottom row maps to steps 8–15
    document.dispatchEvent(
      new CustomEvent("wam-control-input", {
        detail: { binding: bindingFor("control1"), kind: "trigger", pressed: true },
      }),
    );
    expect(seq.steps[8].active).toBe(true);

    sh.stop();
  });

  it("ignores button releases and non-button controls", () => {
    document.dispatchEvent(
      new CustomEvent("wam-control-input", {
        detail: { binding: bindingFor("focus1"), kind: "trigger", pressed: false },
      }),
    );
    document.dispatchEvent(
      new CustomEvent("wam-control-input", {
        detail: { binding: bindingFor("knobA1"), kind: "absolute", value: 1 },
      }),
    );
    expect(seq.steps[0].active).toBe(false);
    sh.stop();
  });

  it("paints active steps when the pattern changes", () => {
    document.dispatchEvent(
      new CustomEvent("wam-control-input", {
        detail: { binding: bindingFor("focus1"), kind: "trigger", pressed: true },
      }),
    );
    out.flush();
    // step 0 active → focus1 LED (index 24) lit dim green
    expect(sentPair(port, getControl("focus1").ledIndex, LED.GREEN_LOW)).toBe(true);
    sh.stop();
  });

  it("lights a playhead that follows setActiveStep", () => {
    seq.setActiveStep(2); // bubbles to document → playhead on step 2 (focus3)
    out.flush();
    expect(sentPair(port, getControl("focus3").ledIndex, LED.RED_LOW)).toBe(true); // empty step playhead
    sh.stop();
  });

  it("clears the buttons when focus is released", () => {
    document.dispatchEvent(
      new CustomEvent("wam-control-input", {
        detail: { binding: bindingFor("focus1"), kind: "trigger", pressed: true },
      }),
    );
    out.flush();
    port.sent.length = 0;
    sh.setSequencer(null);
    out.flush();
    expect(sentPair(port, getControl("focus1").ledIndex, LED.OFF)).toBe(true);
    sh.stop();
  });
});
