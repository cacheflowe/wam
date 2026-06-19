import { describe, expect, it, vi } from "vitest";
import {
  bindingsEqual,
  formatBinding,
  CONTROL_INPUT_EVENT,
  COMMAND_EVENT,
  registerCommandBinding,
} from "../src/web-audio/input/input-bindings.js";
import KeyboardInputSource from "../src/web-audio/input/keyboard-source.js";

function keyEvent(type, key, extra = {}) {
  return new KeyboardEvent(type, { key, ...extra });
}

describe("KeyboardInputSource", () => {
  it("registers the 'keyboard' binding type", () => {
    expect(bindingsEqual({ source: "keyboard", key: "b" }, { source: "keyboard", key: "b" })).toBe(true);
    expect(bindingsEqual({ source: "keyboard", key: "b" }, { source: "keyboard", key: "v" })).toBe(false);
    expect(formatBinding({ source: "keyboard", key: "b" })).toBe("B");
    expect(formatBinding({ source: "keyboard", key: " " })).toBe("Space");
  });

  it("emits press and release trigger events", () => {
    const target = new EventTarget();
    const src = new KeyboardInputSource(target).start();
    const events = [];
    target.addEventListener(CONTROL_INPUT_EVENT, (e) => events.push(e.detail));

    target.dispatchEvent(keyEvent("keydown", "B"));
    target.dispatchEvent(keyEvent("keyup", "B"));

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ binding: { source: "keyboard", key: "b" }, kind: "trigger", pressed: true, value: 1 });
    expect(events[1]).toMatchObject({ pressed: false, value: 0 });
    src.stop();
  });

  it("ignores auto-repeat and unmatched key-ups", () => {
    const target = new EventTarget();
    const src = new KeyboardInputSource(target).start();
    const handler = vi.fn();
    target.addEventListener(CONTROL_INPUT_EVENT, handler);

    target.dispatchEvent(keyEvent("keydown", "a"));
    target.dispatchEvent(keyEvent("keydown", "a", { repeat: true })); // auto-repeat: ignored
    target.dispatchEvent(keyEvent("keyup", "z")); // never pressed: ignored

    expect(handler).toHaveBeenCalledOnce();
    src.stop();
  });

  it("stops emitting after stop()", () => {
    const target = new EventTarget();
    const src = new KeyboardInputSource(target).start();
    const handler = vi.fn();
    target.addEventListener(CONTROL_INPUT_EVENT, handler);
    src.stop();
    target.dispatchEvent(keyEvent("keydown", "b"));
    expect(handler).not.toHaveBeenCalled();
  });

  it("dispatches a command (not control-input) for a bound key, on press only", () => {
    registerCommandBinding({ source: "keyboard", key: "arrowup" }, "prev-instrument");

    const target = new EventTarget();
    const src = new KeyboardInputSource(target).start();
    const onCommand = vi.fn();
    const onControlInput = vi.fn();
    target.addEventListener(COMMAND_EVENT, onCommand);
    target.addEventListener(CONTROL_INPUT_EVENT, onControlInput);

    target.dispatchEvent(keyEvent("keydown", "ArrowUp"));
    target.dispatchEvent(keyEvent("keyup", "ArrowUp")); // release: no event

    expect(onCommand).toHaveBeenCalledOnce();
    expect(onCommand.mock.calls[0][0].detail.command).toBe("prev-instrument");
    expect(onControlInput).not.toHaveBeenCalled();
    src.stop();
  });
});
