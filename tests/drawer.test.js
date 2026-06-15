import { describe, expect, it, vi, beforeEach } from "vitest";
import "../src/web-audio/ui/drawer.js";

function makeDrawer() {
  const d = document.createElement("wam-drawer");
  document.body.appendChild(d);
  return d;
}
function panel(text) {
  const el = document.createElement("div");
  el.textContent = text;
  return el;
}

describe("wam-drawer", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("opens a registered panel and hides the others", () => {
    const d = makeDrawer();
    const a = panel("A");
    const b = panel("B");
    d.addPanel("a", a, "Panel A");
    d.addPanel("b", b, "Panel B");

    d.open("a");
    expect(d.openId).toBe("a");
    expect(d.hasAttribute("data-open")).toBe(true);
    expect(a.hidden).toBe(false);
    expect(b.hidden).toBe(true);
    expect(d.querySelector(".wam-drawer-title").textContent).toBe("Panel A");
  });

  it("swaps content when opening a different panel (only one open)", () => {
    const d = makeDrawer();
    const a = panel("A");
    const b = panel("B");
    d.addPanel("a", a, "Panel A");
    d.addPanel("b", b, "Panel B");
    d.open("a");
    d.open("b");
    expect(d.openId).toBe("b");
    expect(a.hidden).toBe(true);
    expect(b.hidden).toBe(false);
  });

  it("toggle() closes when the same panel is already open", () => {
    const d = makeDrawer();
    d.addPanel("a", panel("A"), "A");
    d.toggle("a");
    expect(d.openId).toBe("a");
    d.toggle("a");
    expect(d.openId).toBeNull();
    expect(d.hasAttribute("data-open")).toBe(false);
  });

  it("keeps panels mounted across open/close (state survives)", () => {
    const d = makeDrawer();
    const a = panel("A");
    d.addPanel("a", a, "A");
    d.open("a");
    d.close();
    expect(d.querySelector('[data-drawer-panel="a"]')).toBe(a); // still mounted in the drawer
    expect(d.openId).toBeNull();
  });

  it("Escape and backdrop click close the drawer", () => {
    const d = makeDrawer();
    d.addPanel("a", panel("A"), "A");
    d.open("a");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(d.openId).toBeNull();

    d.open("a");
    d.querySelector(".wam-drawer-backdrop").click();
    expect(d.openId).toBeNull();
  });

  it("emits drawer-toggle on open and close", () => {
    const d = makeDrawer();
    d.addPanel("a", panel("A"), "A");
    const handler = vi.fn();
    d.addEventListener("drawer-toggle", handler);
    d.open("a");
    d.close();
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler.mock.calls[0][0].detail).toEqual({ id: "a", open: true });
    expect(handler.mock.calls[1][0].detail).toEqual({ id: "a", open: false });
  });

  it("ignores opening an unregistered id", () => {
    const d = makeDrawer();
    d.open("ghost");
    expect(d.openId).toBeNull();
  });
});
