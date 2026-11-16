import { describe, it, expect, afterEach } from "vitest";
import {
  RHYTHMS, NOTE_SCHEMES, RECIPES, OPS, generateRhythm, generatePattern, describePattern, seededRng, notePool, countActive,
} from "../src/web-audio/global/pattern-gen.js";
import { INSTRUMENTS } from "../src/web-audio/instruments/registry.js";
import { mountTrack } from "./helpers/track-harness.js";

const on = (hits) => hits.map((h, i) => (h ? i : -1)).filter((i) => i >= 0);
const steps = (active, notes) => Array.from({ length: 16 }, (_, i) => ({ active: active.includes(i), note: notes ? notes[i % notes.length] : undefined, probability: 1, ratchet: 1, conditions: "off" }));

describe("rhythm generators", () => {
  it("euclid spreads k hits evenly (tresillo, four-on-floor) and rotates", () => {
    expect(on(generateRhythm("euclid", { k: 4, rotation: 0 }).hits)).toEqual([0, 4, 8, 12]);
    expect(on(generateRhythm("euclid", { k: 3, rotation: 0 }).hits)).toEqual([0, 6, 11]);
    expect(on(generateRhythm("euclid", { k: 4, rotation: 2 }).hits)).toEqual([2, 6, 10, 14]);
    for (let k = 0; k <= 16; k++) expect(countActive(generateRhythm("euclid", { k, rotation: 0 }).hits), `k=${k}`).toBe(k);
  });

  it("interval / techno / backbeat / offbeat / clave produce their defining shapes", () => {
    expect(on(generateRhythm("interval", { every: 3, start: 1 }).hits)).toEqual([1, 4, 7, 10, 13]);
    expect(on(generateRhythm("techno").hits)).toEqual([0, 4, 8, 12]);
    expect(on(generateRhythm("backbeat", { variant: "plain" }).hits)).toEqual([4, 12]);
    expect(on(generateRhythm("offbeat", { pickups: 0 }).hits)).toEqual([2, 6, 10, 14]);
    expect(on(generateRhythm("clave", { type: "son32" }).hits)).toEqual([0, 3, 6, 10, 12]);
  });

  it("threshold generators respect maxSteps and never return an empty bar", () => {
    const rng = seededRng(3);
    for (const name of ["sine", "noise", "random"]) {
      for (let n = 0; n < 50; n++) {
        const { hits } = generateRhythm(name, { maxSteps: 5 }, rng);
        expect(countActive(hits), name).toBeGreaterThanOrEqual(1);
        expect(countActive(hits), name).toBeLessThanOrEqual(5);
      }
    }
  });

  it("every generator returns 16 booleans and its resolved options (reproducible from meta)", () => {
    for (const name of Object.keys(RHYTHMS)) {
      const a = generateRhythm(name, {}, seededRng(9));
      expect(a.hits).toHaveLength(16);
      expect(a.meta.rhythm).toBe(name);
      const { rhythm, ...opts } = a.meta;
      if (!["noise", "random", "weighted", "broken"].includes(name)) {
        // deterministic generators re-create the same rhythm from their meta alone
        expect(generateRhythm(name, opts, seededRng(1)).hits, name).toEqual(a.hits);
      }
    }
  });
});

describe("note schemes", () => {
  const notes = notePool(36, "Minor", [24, 60]);
  const hits = generateRhythm("euclid", { k: 7, rotation: 0 }).hits;

  it("every scheme stays in the scale pool", () => {
    for (const name of Object.keys(NOTE_SCHEMES)) {
      const out = NOTE_SCHEMES[name](hits, { notes, root: 36 }, {}, seededRng(5));
      expect(out).toHaveLength(16);
      for (const n of out) expect(notes, name).toContain(n);
    }
  });

  it("walk moves mostly stepwise; rootFifth starts on the root; arp follows chord tones", () => {
    const w = NOTE_SCHEMES.walk(hits, { notes, root: 36 }, { leap: 0 }, seededRng(2));
    const playing = on(hits).map((i) => w[i]);
    for (let i = 1; i < playing.length; i++) expect(Math.abs(notes.indexOf(playing[i]) - notes.indexOf(playing[i - 1]))).toBeLessThanOrEqual(2);
    expect(NOTE_SCHEMES.rootFifth(hits, { notes, root: 36 }, {}, seededRng(2))[0]).toBe(36);
    const arp = NOTE_SCHEMES.arp(hits, { notes, root: 36 }, { dir: "up", span: 3 }, seededRng(2));
    expect(on(hits).slice(0, 3).map((i) => arp[i])).toEqual([36, notes[notes.indexOf(36) + 2], notes[notes.indexOf(36) + 4]]);
  });
});

describe("generatePattern (recipes)", () => {
  it("every role makes 16 complete steps; melodic roles stay in key and range", () => {
    const pool = notePool(29, "Phrygian", [24, 60]);
    for (const role of Object.keys(RECIPES)) {
      for (let seed = 1; seed <= 30; seed++) {
        const { steps: s, meta } = generatePattern(role, { root: 29, scale: "Phrygian", range: [24, 60], rng: seededRng(seed) });
        expect(s, role).toHaveLength(16);
        expect(countActive(s.map((x) => x.active)), role).toBeGreaterThanOrEqual(1);
        for (const st of s) {
          expect(st).toMatchObject({ probability: expect.any(Number), ratchet: expect.any(Number), conditions: expect.any(String) });
          if (RECIPES[role].notes) expect(pool, `${role} note`).toContain(st.note);
        }
        if (RECIPES[role].keepFirst) expect(s[0].active, `${role} keeps step 0`).toBe(true);
        expect(describePattern(meta)).toBeTruthy();
      }
    }
  });

  it("is reproducible with a seed and can force a generator", () => {
    const a = generatePattern("bass", { rng: seededRng(42) });
    const b = generatePattern("bass", { rng: seededRng(42) });
    expect(a).toEqual(b);
    expect(generatePattern("kick", { rhythm: "euclid", rng: seededRng(1) }).meta.rhythm).toBe("euclid");
  });

  it("accent-capable instruments get downbeat accents", () => {
    let accented = 0;
    for (let seed = 1; seed < 40; seed++) {
      const { steps: s } = generatePattern("bass", { accent: true, rng: seededRng(seed) });
      accented += s.filter((x) => x.accent).length;
      expect(s.every((x, i) => !x.accent || i % 4 === 0)).toBe(true);
    }
    expect(accented).toBeGreaterThan(0);
  });
});

describe("ops (for Evolve)", () => {
  const base = steps([0, 3, 6, 10, 12], [36, 39, 41, 43, 46]);
  const pool = notePool(36, "Minor", [24, 60]);

  it("rotate / nudge / reverse / invert behave and don't mutate the input", () => {
    const copy = JSON.stringify(base);
    expect(on(OPS.rotate(base, 1).map((s) => s.active))).toEqual([1, 4, 7, 11, 13]);
    expect(on(OPS.nudge(base).map((s) => s.active))).toEqual([1, 4, 7, 11, 13]);
    expect(OPS.reverse(OPS.reverse(base))).toEqual(base);
    expect(countActive(OPS.invert(base).map((s) => s.active))).toBe(11);
    expect(JSON.stringify(base)).toBe(copy);
  });

  it("morph keeps the hit count; thin/thicken change it by k; keepFirst protects step 0", () => {
    const rng = seededRng(7);
    for (let n = 0; n < 30; n++) {
      const m = OPS.morph(base, rng, { keepFirst: true });
      expect(countActive(m.map((s) => s.active))).toBe(5);
      expect(m[0].active).toBe(true);
    }
    expect(countActive(OPS.thin(base, 2, { keepFirst: true }).map((s) => s.active))).toBe(3);
    expect(OPS.thin(base, 4, { keepFirst: true })[0].active).toBe(true);
    expect(countActive(OPS.thicken(base, 3).map((s) => s.active))).toBe(8);
  });

  it("transpose stays in the scale; shuffleNotes keeps the same notes", () => {
    const up = OPS.transpose(base, 2, pool);
    for (const s of up) if (s.note != null) expect(pool).toContain(s.note);
    expect(up[0].note).toBe(pool[pool.indexOf(36) + 2]);
    const sh = OPS.shuffleNotes(base, seededRng(3));
    const notesOf = (x) => x.filter((s) => s.active).map((s) => s.note).sort();
    expect(notesOf(sh)).toEqual(notesOf(base));
  });

  it("fill adds a ratcheted hit in the last beat", () => {
    const f = OPS.fill(steps([0]), seededRng(2));
    expect(f.slice(13).some((s) => s.active && s.ratchet > 1)).toBe(true);
  });
});

describe("instrument integration", () => {
  afterEach(() => (document.body.innerHTML = ""));

  it("every registry instrument with a role declares a known recipe", () => {
    for (const d of INSTRUMENTS) {
      const role = d.Instrument.PATTERN_ROLE;
      if (role) expect(RECIPES, d.id).toHaveProperty(role);
    }
  });

  it("the panel's Rand makes complete steps and tooltips the generator", () => {
    const t = mountTrack(null);
    const meta = t.ctrl.randomize({ rng: seededRng(4) });
    expect(meta.role).toBe("kick");
    const s = t.ctrl.toJSON().patterns.A.steps;
    expect(s[0].active).toBe(true);
    expect(s.every((x) => "probability" in x && "ratchet" in x && "conditions" in x)).toBe(true);
    expect(t.ctrl._seqRandBtn.title).toMatch(/Last:/);
  });
});
