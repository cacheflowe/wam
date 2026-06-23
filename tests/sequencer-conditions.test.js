import { describe, it, expect } from "vitest";
import {
  meetsBarCondition,
  normalizeCondition,
  CONDITION_GROUPS,
} from "../src/web-audio/global/sequencer-conditions.js";

/** Collect the bar indices (0..count-1) on which a condition fires. */
function firesOn(condition, count) {
  return Array.from({ length: count }, (_, i) => i).filter((i) => meetsBarCondition(condition, i));
}

describe("meetsBarCondition", () => {
  it("off / empty always fires", () => {
    expect(meetsBarCondition("off", 0)).toBe(true);
    expect(meetsBarCondition("off", 7)).toBe(true);
    expect(meetsBarCondition("", 3)).toBe(true);
    expect(meetsBarCondition(undefined, 3)).toBe(true);
  });

  it("preserves the legacy 2/3/4-cycle behavior", () => {
    // X:Y fires when barIndex % Y === X-1 — matches the old per-synth switch.
    expect(firesOn("1:2", 4)).toEqual([0, 2]);
    expect(firesOn("1:3", 6)).toEqual([0, 3]);
    expect(firesOn("1:4", 8)).toEqual([0, 4]);
    expect(firesOn("2:4", 8)).toEqual([1, 5]);
    expect(firesOn("3:4", 8)).toEqual([2, 6]);
  });

  it("adds the new full 2 and 4 cycle slots", () => {
    expect(firesOn("2:2", 4)).toEqual([1, 3]);
    expect(firesOn("4:4", 8)).toEqual([3, 7]);
    expect(firesOn("2:3", 6)).toEqual([1, 4]);
    expect(firesOn("3:3", 6)).toEqual([2, 5]);
  });

  it("supports 8-bar cycles", () => {
    expect(firesOn("1:8", 16)).toEqual([0, 8]);
    expect(firesOn("5:8", 16)).toEqual([4, 12]);
    expect(firesOn("8:8", 16)).toEqual([7, 15]);
  });

  it("treats legacy 'fill' as 4:4", () => {
    for (let bar = 0; bar < 16; bar++) {
      expect(meetsBarCondition("fill", bar)).toBe(meetsBarCondition("4:4", bar));
    }
  });
});

describe("normalizeCondition", () => {
  it("upgrades fill to 4:4 and defaults to off", () => {
    expect(normalizeCondition("fill")).toBe("4:4");
    expect(normalizeCondition(undefined)).toBe("off");
    expect(normalizeCondition("2:4")).toBe("2:4");
  });
});

describe("CONDITION_GROUPS", () => {
  it("every listed option is evaluable and unique", () => {
    const values = CONDITION_GROUPS.flatMap((g) => g.options);
    expect(new Set(values).size).toBe(values.length);
    for (const v of values) {
      expect(() => meetsBarCondition(v, 0)).not.toThrow();
    }
  });
});
