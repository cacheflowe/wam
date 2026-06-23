import { describe, expect, it, vi } from "vitest";
import "../src/web-audio/ui/step-seq.js";

function makeSeq(steps) {
  // createElement (not appended) skips connectedCallback's ResizeObserver;
  // init() renders the cells, which is all toggleStep needs.
  const seq = document.createElement("wam-step-seq");
  seq.init({ steps, noteOptions: [["C", 60], ["D", 62]] });
  return seq;
}

describe("wam-step-seq toggleStep", () => {
  it("flips a step's active state and dispatches step-change", () => {
    const seq = makeSeq([{ active: false, note: 60 }, { active: true, note: 62 }]);
    const handler = vi.fn();
    seq.addEventListener("step-change", handler);

    seq.toggleStep(0);
    expect(seq.steps[0].active).toBe(true);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].detail.index).toBe(0);

    seq.toggleStep(1);
    expect(seq.steps[1].active).toBe(false);
  });

  it("updates the on-button UI to match the toggled state", () => {
    const seq = makeSeq([{ active: false, note: 60 }]);
    seq.toggleStep(0);
    expect(seq._onBtns[0].classList.contains("on")).toBe(true);
    expect(seq._onBtns[0].textContent).toBe("●");
    seq.toggleStep(0);
    expect(seq._onBtns[0].classList.contains("on")).toBe(false);
    expect(seq._onBtns[0].textContent).toBe("○");
  });

  it("ignores out-of-range indices", () => {
    const seq = makeSeq([{ active: false, note: 60 }]);
    const handler = vi.fn();
    seq.addEventListener("step-change", handler);
    seq.toggleStep(5);
    expect(handler).not.toHaveBeenCalled();
  });

  it("keeps the on-button in sync after rotate()", () => {
    const seq = makeSeq([
      { active: true, note: 60 },
      { active: false, note: 62 },
    ]);
    seq.rotate(1); // step 1 (inactive) moves to index 0
    expect(seq._onBtns[0].classList.contains("on")).toBe(false);
    expect(seq._onBtns[1].classList.contains("on")).toBe(true);
  });
});
