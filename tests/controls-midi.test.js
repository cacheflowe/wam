import { beforeEach, describe, expect, it } from "vitest";
import WamMidiInputPicker, {
  formatMidiBytes,
  formatMidiMessage,
  midiBindingsEqual,
  parseMidiMessage,
} from "../src/web-audio/ui/midi-input-picker.js";
import { WebAudioControlsBase } from "../src/web-audio/ui/controls-base.js";
import { WebAudioTransportControls } from "../src/web-audio/ui/transport.js";

const TEST_CONTROLS_TAG = "wam-midi-test-controls";
if (!customElements.get(TEST_CONTROLS_TAG)) {
  customElements.define(TEST_CONTROLS_TAG, class extends WebAudioControlsBase {});
}

function createTestControls() {
  return document.createElement(TEST_CONTROLS_TAG);
}

beforeEach(() => {
  localStorage.clear();
  delete navigator.requestMIDIAccess;
});

describe("WamMidiInputPicker MIDI parsing", () => {
  it("learns note-on messages and ignores note-off velocity", () => {
    expect(parseMidiMessage([0x90, 60, 100])?.binding).toEqual({ type: "note", channel: 1, note: 60 });
    expect(parseMidiMessage([0x91, 64, 127])?.binding).toEqual({ type: "note", channel: 2, note: 64 });
    expect(parseMidiMessage([0x90, 60, 0])).toBeNull();
  });

  it("learns control-change messages", () => {
    expect(parseMidiMessage([0xb2, 7, 96])?.binding).toEqual({ type: "cc", channel: 3, controller: 7 });
  });

  it("formats messages for the debug log", () => {
    expect(formatMidiMessage(parseMidiMessage([0x90, 60, 100]))).toBe("ch1 note 60 vel 100");
    expect(formatMidiMessage(parseMidiMessage([0xb2, 7, 96]))).toBe("ch3 cc 7 val 96");
    expect(formatMidiBytes([0xf8])).toBe("f8");
  });

  it("matches by message type, channel, and controller identity", () => {
    expect(
      midiBindingsEqual(
        { type: "cc", channel: 1, controller: 7 },
        { type: "cc", channel: 1, controller: 7 },
      ),
    ).toBe(true);
    expect(
      midiBindingsEqual(
        { type: "cc", channel: 1, controller: 7 },
        { type: "note", channel: 1, note: 7 },
      ),
    ).toBe(false);
  });

  it("dispatches normalized document messages from the selected input", async () => {
    const input = { id: "input-1", name: "Controller", state: "connected", onmidimessage: null };
    navigator.requestMIDIAccess = () =>
      Promise.resolve({
        inputs: new Map([[input.id, input]]),
        onstatechange: null,
      });

    const picker = new WamMidiInputPicker();
    document.body.appendChild(picker);
    await picker._requestAccess();

    const received = new Promise((resolve) => {
      document.addEventListener("wam-midi-message", (e) => resolve(e.detail), { once: true });
    });
    input.onmidimessage({ data: [0x90, 60, 100] });
    expect(await received).toMatchObject({ type: "note", note: 60, binding: { type: "note", note: 60 } });
    expect(localStorage.getItem(WamMidiInputPicker.STORAGE_KEY)).toBe("input-1");

    picker.remove();
  });

  it("auto-connects a saved input without clicking the dropdown", async () => {
    const input = { id: "saved-input", name: "Controller", state: "connected", onmidimessage: null };
    localStorage.setItem(WamMidiInputPicker.STORAGE_KEY, "saved-input");
    navigator.requestMIDIAccess = () =>
      Promise.resolve({
        inputs: new Map([[input.id, input]]),
        onstatechange: null,
      });

    const picker = new WamMidiInputPicker();
    document.body.appendChild(picker);
    await Promise.resolve();
    await picker._requestPromise;

    expect(picker.value).toBe("saved-input");
    expect(picker.querySelector("select").value).toBe("saved-input");
    expect([...picker.querySelectorAll("option")].map((opt) => opt.value)).toContain("saved-input");
    expect(input.onmidimessage).toBeTypeOf("function");

    picker.remove();
  });

  it("auto-connects a restored input value without clicking the dropdown", async () => {
    const input = { id: "restored-input", name: "Controller", state: "connected", onmidimessage: null };
    navigator.requestMIDIAccess = () =>
      Promise.resolve({
        inputs: new Map([[input.id, input]]),
        onstatechange: null,
      });

    const picker = new WamMidiInputPicker();
    document.body.appendChild(picker);
    picker.value = "restored-input";
    await Promise.resolve();
    await picker._requestPromise;

    expect(picker.value).toBe("restored-input");
    expect(input.onmidimessage).toBeTypeOf("function");

    picker.remove();
  });

  it("renders a bounded rolling debug log", async () => {
    const input = { id: "input-1", name: "Controller", state: "connected", onmidimessage: null };
    navigator.requestMIDIAccess = () =>
      Promise.resolve({
        inputs: new Map([[input.id, input]]),
        onstatechange: null,
      });

    const picker = new WamMidiInputPicker();
    document.body.appendChild(picker);
    await picker._requestAccess();

    input.onmidimessage({ data: [0x90, 60, 100] });
    input.onmidimessage({ data: [0xb0, 1, 10] });
    input.onmidimessage({ data: [0xb0, 2, 20] });
    input.onmidimessage({ data: [0xb0, 3, 30] });
    input.onmidimessage({ data: [0xb0, 4, 40] });

    const lines = [...picker.querySelectorAll(".wam-midi-log-line")].map((el) => el.textContent);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe("ch1 cc 4 val 40");
    expect(lines).not.toContain("ch1 note 60 vel 100");

    picker.remove();
  });

  it("shows raw unsupported MIDI activity", async () => {
    const input = { id: "input-1", name: "Controller", state: "connected", onmidimessage: null };
    navigator.requestMIDIAccess = () =>
      Promise.resolve({
        inputs: new Map([[input.id, input]]),
        onstatechange: null,
      });

    const picker = new WamMidiInputPicker();
    document.body.appendChild(picker);
    await picker._requestAccess();

    input.onmidimessage({ data: [0xf8] });

    expect(picker.hasAttribute("data-midi-active")).toBe(true);
    expect(picker.querySelector(".wam-midi-last").textContent).toBe("raw f8");
    expect(picker.querySelector(".wam-midi-log-line").textContent).toBe("raw f8");

    picker.remove();
  });
});

// A normalized control-input detail (what adapters emit). MIDI CC 127 → value 1.
function ccInput(channel, controller, value = 1) {
  return { binding: { source: "midi", type: "cc", channel, controller }, value, kind: "absolute" };
}

describe("WebAudioControlsBase input param mapping", () => {
  it("maps a normalized value into a control range and dispatches existing input events", () => {
    const controls = createTestControls();
    document.body.appendChild(controls);

    const knob = document.createElement("wam-knob");
    knob.setAttribute("param", "cutoff");
    knob.setAttribute("label", "Cutoff");
    knob.setAttribute("min", "0");
    knob.setAttribute("max", "100");
    knob.setAttribute("step", "1");
    knob.value = 0;
    controls.appendChild(knob);
    controls._sliders.cutoff = knob;
    controls._paramBindings.cutoff = { source: "midi", type: "cc", channel: 1, controller: 7 };

    const received = new Promise((resolve) => {
      controls.addEventListener("knob-input", (e) => resolve(e.detail), { once: true });
    });

    controls._handleControlInput(ccInput(1, 7, 1));

    expect(knob.value).toBe(100);
    return expect(received).resolves.toMatchObject({ param: "cutoff", value: 100 });
  });

  it("learns and serializes per-param bindings", () => {
    const controls = createTestControls();
    const slider = document.createElement("wam-slider");
    slider.setAttribute("param", "gain");
    slider.setAttribute("min", "0");
    slider.setAttribute("max", "1");
    slider.setAttribute("step", "0.01");
    controls._sliders.gain = slider;

    controls._startInputLearn("gain");
    controls._handleControlInput(ccInput(2, 12, 0.5));

    expect(controls._paramBindings.gain).toEqual({ source: "midi", type: "cc", channel: 2, controller: 12 });
    expect(controls._learnParam).toBeNull();
  });

  it("clears a learned binding with Escape while learning", () => {
    const controls = createTestControls();
    const slider = document.createElement("wam-slider");
    controls._sliders.gain = slider;
    controls._paramBindings.gain = { source: "midi", type: "cc", channel: 2, controller: 12 };

    controls._startInputLearn("gain");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(controls._paramBindings.gain).toBeUndefined();
    expect(controls._learnParam).toBeNull();
    expect(slider.classList.contains("wam-input-learning")).toBe(false);
  });
});

describe("WebAudioControlsBase unified jam binding", () => {
  it("queues a jam when a matching trigger arrives from any source", () => {
    const controls = createTestControls();
    controls._jamBinding = { source: "keyboard", key: "b" };
    controls._jamPending = false;

    controls._handleControlInput({ binding: { source: "keyboard", key: "v" }, pressed: true, kind: "trigger" });
    expect(controls._jamPending).toBe(false); // non-matching key

    controls._handleControlInput({ binding: { source: "keyboard", key: "b" }, pressed: true, kind: "trigger" });
    expect(controls._jamPending).toBe(true); // matching key
  });

  it("matches a MIDI note jam binding too (source-agnostic)", () => {
    const controls = createTestControls();
    controls._jamBinding = { source: "midi", type: "note", channel: 13, note: 41 };
    controls._handleControlInput({
      binding: { source: "midi", type: "note", channel: 13, note: 41 },
      pressed: true,
      kind: "trigger",
    });
    expect(controls._jamPending).toBe(true);
  });

  it("learns a jam binding from any source while learning", () => {
    const controls = createTestControls();
    controls._jamLearning = true;
    controls._stopJamLearn = () => {
      controls._jamLearning = false;
    };
    controls._handleControlInput({ binding: { source: "keyboard", key: "n" }, pressed: true, kind: "trigger" });
    expect(controls._jamBinding).toEqual({ source: "keyboard", key: "n" });
    expect(controls._jamLearning).toBe(false);
  });

  it("cancels jam learn on Escape without binding it", () => {
    const controls = createTestControls();
    controls._jamBinding = { source: "midi", type: "note", channel: 13, note: 41 };
    controls._jamLearning = true;
    controls._stopJamLearn = () => {
      controls._jamLearning = false;
    };
    controls._handleControlInput({ binding: { source: "keyboard", key: "escape" }, pressed: true, kind: "trigger" });
    expect(controls._jamBinding).toBeNull();
    expect(controls._jamLearning).toBe(false);
  });
});

describe("WebAudioTransportControls input param mapping", () => {
  it("maps normalized values into transport sliders", () => {
    const transport = new WebAudioTransportControls();
    document.body.appendChild(transport);

    const bpm = document.createElement("wam-slider");
    bpm.setAttribute("param", "bpm");
    bpm.setAttribute("label", "BPM");
    bpm.setAttribute("min", "40");
    bpm.setAttribute("max", "200");
    bpm.setAttribute("step", "1");
    bpm.value = 40;
    transport.appendChild(bpm);
    transport._midiControls.bpm = bpm;
    transport._paramBindings.bpm = { source: "midi", type: "cc", channel: 1, controller: 10 };

    const received = new Promise((resolve) => {
      transport.addEventListener("slider-input", (e) => resolve(e.detail), { once: true });
    });

    transport._handleControlInput(ccInput(1, 10, 1));

    expect(bpm.value).toBe(200);
    return expect(received).resolves.toMatchObject({ param: "bpm", value: 200 });
  });

  it("clears a transport binding with Escape while learning", () => {
    const transport = new WebAudioTransportControls();
    const bpm = document.createElement("wam-slider");
    transport._midiControls.bpm = bpm;
    transport._paramBindings.bpm = { source: "midi", type: "cc", channel: 1, controller: 10 };

    transport._startInputLearn("bpm");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(transport._paramBindings.bpm).toBeUndefined();
    expect(transport._learnParam).toBeNull();
    expect(bpm.classList.contains("wam-input-learning")).toBe(false);
  });

  it("routes a real wam-control-input event end to end", () => {
    const transport = new WebAudioTransportControls();
    document.body.appendChild(transport);
    const bpm = document.createElement("wam-slider");
    bpm.setAttribute("param", "bpm");
    bpm.setAttribute("min", "40");
    bpm.setAttribute("max", "200");
    bpm.setAttribute("step", "1");
    transport.appendChild(bpm);
    transport._midiControls.bpm = bpm;
    transport._paramBindings.bpm = { source: "midi", type: "cc", channel: 1, controller: 10 };
    transport._attachInputLearn();

    document.dispatchEvent(new CustomEvent("wam-control-input", { detail: ccInput(1, 10, 0.5) }));
    expect(bpm.value).toBe(120);
    transport.remove();
  });
});
