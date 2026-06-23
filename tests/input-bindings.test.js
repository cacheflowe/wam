import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONTROL_INPUT_EVENT,
  bindingsEqual,
  dispatchControlInput,
  formatBinding,
  hasBindingType,
  migrateLegacyBinding,
  registerBindingType,
} from "../src/web-audio/input/input-bindings.js";

describe("input binding registry", () => {
  it("dispatches equality on binding.source", () => {
    registerBindingType("test", {
      equals: (a, b) => a.id === b.id,
      format: (b) => `T${b.id}`,
    });
    expect(bindingsEqual({ source: "test", id: 1 }, { source: "test", id: 1 })).toBe(true);
    expect(bindingsEqual({ source: "test", id: 1 }, { source: "test", id: 2 })).toBe(false);
  });

  it("never equates bindings from different sources", () => {
    registerBindingType("a", { equals: () => true, format: () => "a" });
    registerBindingType("b", { equals: () => true, format: () => "b" });
    expect(bindingsEqual({ source: "a" }, { source: "b" })).toBe(false);
  });

  it("returns false / empty for unknown or missing bindings", () => {
    expect(bindingsEqual(null, { source: "test" })).toBe(false);
    expect(bindingsEqual({ source: "nope", id: 1 }, { source: "nope", id: 1 })).toBe(false);
    expect(formatBinding(null)).toBe("");
    expect(formatBinding({ source: "nope" })).toBe("");
  });

  it("formats via the registered formatter", () => {
    registerBindingType("test", { equals: () => true, format: (b) => `T${b.id}` });
    expect(formatBinding({ source: "test", id: 9 })).toBe("T9");
    expect(hasBindingType("test")).toBe(true);
    expect(hasBindingType("ghost")).toBe(false);
  });

  it("tolerates a missing equals/format without throwing", () => {
    registerBindingType("bare", {});
    expect(bindingsEqual({ source: "bare" }, { source: "bare" })).toBe(false);
    expect(formatBinding({ source: "bare" })).toBe("");
  });

  it("migrates legacy source-less bindings to MIDI", () => {
    expect(migrateLegacyBinding({ type: "cc", channel: 1, controller: 7 })).toEqual({
      source: "midi",
      type: "cc",
      channel: 1,
      controller: 7,
    });
    // Already-tagged bindings pass through untouched
    const tagged = { source: "keyboard", key: "b" };
    expect(migrateLegacyBinding(tagged)).toBe(tagged);
    expect(migrateLegacyBinding(null)).toBeNull();
  });

  it("dispatches a CONTROL_INPUT_EVENT with the given detail", () => {
    const target = new EventTarget();
    const handler = vi.fn();
    target.addEventListener(CONTROL_INPUT_EVENT, handler);
    dispatchControlInput({ binding: { source: "test" }, value: 0.5, kind: "absolute" }, target);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].detail).toEqual({
      binding: { source: "test" },
      value: 0.5,
      kind: "absolute",
    });
  });
});
