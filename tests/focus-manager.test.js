import { describe, expect, it, vi } from "vitest";
import { FocusManager } from "../src/web-audio/ui/focus-manager.js";

function panel() {
  const el = document.createElement("div");
  el.className = "wam-panel";
  return el;
}

describe("FocusManager", () => {
  it("tracks one focused panel and marks it", () => {
    const target = new EventTarget();
    const fm = new FocusManager(target);
    fm.start();
    const a = panel();
    const b = panel();

    target.dispatchEvent(new CustomEvent("wam-instrument-focus", { detail: { controls: a } }));
    expect(fm.focused).toBe(a);
    expect(a.classList.contains("wam-focused")).toBe(true);

    target.dispatchEvent(new CustomEvent("wam-instrument-focus", { detail: { controls: b } }));
    expect(fm.focused).toBe(b);
    expect(a.classList.contains("wam-focused")).toBe(false);
    expect(b.classList.contains("wam-focused")).toBe(true);
  });

  it("re-broadcasts focus changes", () => {
    const target = new EventTarget();
    const fm = new FocusManager(target);
    fm.start();
    const handler = vi.fn();
    target.addEventListener("wam-instrument-focus-change", handler);
    const a = panel();
    target.dispatchEvent(new CustomEvent("wam-instrument-focus", { detail: { controls: a } }));
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].detail.controls).toBe(a);
  });

  it("clears focus when focused with null", () => {
    const target = new EventTarget();
    const fm = new FocusManager(target);
    fm.start();
    const a = panel();
    fm.focus(a);
    fm.focus(null);
    expect(fm.focused).toBeNull();
    expect(a.classList.contains("wam-focused")).toBe(false);
  });
});
