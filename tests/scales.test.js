import { describe, it, expect } from "vitest";
import {
  SCALES,
  SCALES_ORDERED,
  NOTE_NAMES,
  STEP_WEIGHTS,
  scaleNotesInRange,
  scaleNoteOptions,
  buildChordFromScale,
  LEAD_OSC_TYPES,
} from "../src/web-audio/global/scales.js";

describe("SCALES", () => {
  it("has 8 scales", () => {
    expect(Object.keys(SCALES)).toHaveLength(8);
  });

  it("every scale starts on 0", () => {
    for (const [name, intervals] of Object.entries(SCALES)) {
      expect(intervals[0], `${name} should start on 0`).toBe(0);
    }
  });

  it("every interval is in range 0–11", () => {
    for (const [name, intervals] of Object.entries(SCALES)) {
      for (const iv of intervals) {
        expect(iv, `${name} has interval ${iv} out of range`).toBeGreaterThanOrEqual(0);
        expect(iv).toBeLessThan(12);
      }
    }
  });

  it("all intervals within a scale are unique", () => {
    for (const [name, intervals] of Object.entries(SCALES)) {
      expect(new Set(intervals).size, `${name} has duplicate intervals`).toBe(intervals.length);
    }
  });
});

describe("SCALES_ORDERED", () => {
  it("has same length as SCALES", () => {
    expect(SCALES_ORDERED).toHaveLength(Object.keys(SCALES).length);
  });

  it("entries are [name, intervals] pairs matching SCALES", () => {
    for (const [name, intervals] of SCALES_ORDERED) {
      expect(intervals).toEqual(SCALES[name]);
    }
  });
});

describe("NOTE_NAMES", () => {
  it("has 12 entries", () => {
    expect(NOTE_NAMES).toHaveLength(12);
  });

  it("starts with C", () => {
    expect(NOTE_NAMES[0]).toBe("C");
  });

  it("has A at index 9", () => {
    expect(NOTE_NAMES[9]).toBe("A");
  });
});

describe("STEP_WEIGHTS", () => {
  it("has 16 steps", () => {
    expect(STEP_WEIGHTS).toHaveLength(16);
  });

  it("all weights are 0–1", () => {
    for (const w of STEP_WEIGHTS) {
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(1);
    }
  });

  it("downbeat (step 0) has highest weight", () => {
    const max = Math.max(...STEP_WEIGHTS);
    expect(STEP_WEIGHTS[0]).toBe(max);
  });
});

describe("scaleNotesInRange", () => {
  it("returns only notes within [min, max]", () => {
    const notes = scaleNotesInRange(60, "Major", 60, 72);
    for (const n of notes) {
      expect(n).toBeGreaterThanOrEqual(60);
      expect(n).toBeLessThanOrEqual(72);
    }
  });

  it("C Major from C4 (60) to C5 (72) has 8 notes", () => {
    // C D E F G A B C = 8 notes (60,62,64,65,67,69,71,72)
    const notes = scaleNotesInRange(60, "Major", 60, 72);
    expect(notes).toHaveLength(8);
  });

  it("C Major notes match expected semitone offsets", () => {
    const notes = scaleNotesInRange(60, "Major", 60, 72);
    expect(notes).toEqual([60, 62, 64, 65, 67, 69, 71, 72]);
  });

  it("handles root not at start of range", () => {
    // Root = 60 (C4), range starts at 62 — C should not appear
    const notes = scaleNotesInRange(60, "Major", 62, 72);
    expect(notes).not.toContain(60);
    expect(notes[0]).toBe(62);
  });

  it("works with non-zero root (F = 65)", () => {
    const notes = scaleNotesInRange(65, "Major", 65, 77);
    const offsets = notes.map((n) => ((n - 65) % 12 + 12) % 12);
    for (const off of offsets) {
      expect(SCALES["Major"]).toContain(off);
    }
  });

  it("Pentatonic_Minor has fewer notes than Major in same range", () => {
    const pent = scaleNotesInRange(60, "Pent_Minor", 60, 72);
    const major = scaleNotesInRange(60, "Major", 60, 72);
    expect(pent.length).toBeLessThan(major.length);
  });

  it("returns empty array when range is empty", () => {
    const notes = scaleNotesInRange(60, "Major", 65, 60);
    expect(notes).toEqual([]);
  });
});

describe("scaleNoteOptions", () => {
  it("returns [label, midi] pairs", () => {
    const opts = scaleNoteOptions(60, "Major", 60, 72);
    for (const [label, midi] of opts) {
      expect(typeof label).toBe("string");
      expect(typeof midi).toBe("number");
    }
  });

  it("label for MIDI 60 is C4", () => {
    const opts = scaleNoteOptions(60, "Major", 60, 60);
    expect(opts[0][0]).toBe("C4");
    expect(opts[0][1]).toBe(60);
  });

  it("label for MIDI 69 is A4", () => {
    const opts = scaleNoteOptions(60, "Major", 69, 69);
    expect(opts[0][0]).toBe("A4");
  });

  it("same count as scaleNotesInRange", () => {
    const notes = scaleNotesInRange(60, "Major", 60, 72);
    const opts = scaleNoteOptions(60, "Major", 60, 72);
    expect(opts).toHaveLength(notes.length);
  });
});

describe("buildChordFromScale", () => {
  it("returns requested number of voices", () => {
    const chord = buildChordFromScale(60, "Major", 3);
    expect(chord).toHaveLength(3);
  });

  it("root is first note", () => {
    const chord = buildChordFromScale(60, "Major", 3);
    expect(chord[0]).toBe(60);
  });

  it("C Major triad is C-E-G (60-64-67)", () => {
    const chord = buildChordFromScale(60, "Major", 3);
    expect(chord).toEqual([60, 64, 67]);
  });

  it("chord notes are ascending", () => {
    const chord = buildChordFromScale(60, "Major", 4);
    for (let i = 1; i < chord.length; i++) {
      expect(chord[i]).toBeGreaterThan(chord[i - 1]);
    }
  });

  it("size 1 returns just the root", () => {
    const chord = buildChordFromScale(60, "Minor", 1);
    expect(chord).toEqual([60]);
  });
});

describe("LEAD_OSC_TYPES", () => {
  it("has 8 entries matching SCALES_ORDERED length", () => {
    expect(LEAD_OSC_TYPES).toHaveLength(SCALES_ORDERED.length);
  });

  it("all entries are valid oscillator types", () => {
    const valid = new Set(["sine", "square", "sawtooth", "triangle"]);
    for (const t of LEAD_OSC_TYPES) {
      expect(valid.has(t), `"${t}" is not a valid oscillator type`).toBe(true);
    }
  });
});
