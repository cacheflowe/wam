/**
 * Pattern generation — rhythm generators, note schemes, step decorators and
 * pattern operations (architecture-refactor Phase 1b). No DOM.
 *
 * Builds on Interphase's ISequencerPattern family (interval / sine / noise /
 * random / techno + PatternUtil ops) and goes further:
 *
 *   1. RHYTHM generators → boolean[16]
 *      interval, sine, noise, random, techno (Interphase) +
 *      euclid, weighted (metric), backbeat, offbeat, clave, broken
 *   2. NOTE schemes → MIDI per step, from the current scale
 *      byStep (Interphase notesByStep) + walk, rootFifth, arp, motif, pedal, random
 *   3. DECORATORS (wam's richer steps) → accents, ghost notes (probability),
 *      ratchets, trig conditions, open hats
 *   4. OPS on existing patterns (for Evolve) → rotate, nudge, morph, flip,
 *      thin, thicken, fill, reverse, invert, transpose, shuffleNotes, …
 *
 * Instruments declare a ROLE (static PATTERN_ROLE) and a note range
 * (static NOTE_RANGE); a role's RECIPE weights which generators / schemes /
 * decorators it draws from. Everything takes an `rng` so results are
 * reproducible (seededRng for tests).
 */
import { STEP_WEIGHTS, scaleNotesInRange } from "./scales.js";

export const STEPS = 16;

// ───────────────────────────── utilities ─────────────────────────────

/** Deterministic PRNG (mulberry32). */
export function seededRng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const randInt = (rng, min, max) => min + Math.floor(rng() * (max - min + 1));
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
/** Pick from [[item, weight], …]. */
export function pickWeighted(rng, entries) {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [item, w] of entries) if ((r -= w) < 0) return item;
  return entries[entries.length - 1][0];
}

export const countActive = (hits) => hits.filter(Boolean).length;

/** Interphase PatternUtil.ensureOneStepActive. */
export function ensureOneActive(hits, rng, prefer = 0) {
  if (!hits.some(Boolean)) hits[prefer ?? randInt(rng, 0, STEPS - 1)] = true;
  return hits;
}

/** Interphase PatternUtil.limitToMaxSteps — drops the metrically weakest hits first. */
export function limitToMax(hits, max) {
  const on = hits.map((h, i) => (h ? i : -1)).filter((i) => i >= 0);
  if (on.length <= max) return hits;
  on.sort((a, b) => STEP_WEIGHTS[a] - STEP_WEIGHTS[b]);
  for (const i of on.slice(0, on.length - max)) hits[i] = false;
  return hits;
}

/** Smooth 1-D value noise in [0,1] (stand-in for Processing's noise()). */
function makeNoise(rng) {
  const lattice = Array.from({ length: 64 }, () => rng());
  return (x) => {
    const i = Math.floor(x);
    const f = x - i;
    const a = lattice[((i % 64) + 64) % 64];
    const b = lattice[(((i + 1) % 64) + 64) % 64];
    const s = f * f * (3 - 2 * f);
    return a + (b - a) * s;
  };
}

// ───────────────────────────── 1. rhythm ─────────────────────────────

/**
 * Rhythm generators. Each: (opts, rng) → boolean[16]. Missing opts are
 * randomized within musical ranges, and the resolved opts are returned in
 * `meta` by generateRhythm() so a pattern can be described / re-made.
 */
export const RHYTHMS = {
  /** Interphase PatternInterval: every N steps from a start. */
  interval(o, rng) {
    const every = o.every ?? (o.choices ? pick(rng, o.choices) : (() => { let n = randInt(rng, o.min ?? 2, o.max ?? 8); if (n % 2 && rng() < 0.5) n++; return n; })());
    const start = o.start ?? randInt(rng, 0, every - 1);
    o.every = every;
    o.start = start;
    return Array.from({ length: STEPS }, (_, i) => i >= start && (i - start) % every === 0);
  },

  /** Interphase PatternSine: threshold a sine across the bar. */
  sine(o, rng) {
    const speed = o.speed ?? (rng() < 0.5 ? 1 + rng() * 4 : 7 + rng() * 5);
    const phase = o.phase ?? rng() * Math.PI * 2;
    const thresh = o.thresh ?? 0.6;
    Object.assign(o, { speed, phase, thresh });
    const hits = Array.from({ length: STEPS }, (_, i) => 0.5 + 0.5 * Math.sin(phase + speed * (i / STEPS) * Math.PI) > thresh);
    return ensureOneActive(limitToMax(hits, o.maxSteps ?? 8), rng);
  },

  /** Interphase PatternNoise: threshold smooth noise. */
  noise(o, rng) {
    const zoom = o.zoom ?? 0.1 + rng() * 1.9;
    const thresh = o.thresh ?? 0.6;
    const noise = makeNoise(rng);
    const start = rng() * 40;
    Object.assign(o, { zoom, thresh });
    const hits = Array.from({ length: STEPS }, (_, i) => noise(start + i * zoom) > thresh);
    return ensureOneActive(limitToMax(hits, o.maxSteps ?? 8), rng);
  },

  /** Interphase PatternRandom: independent coin flips. */
  random(o, rng) {
    const weight = o.weight ?? 0.3;
    o.weight = weight;
    const hits = Array.from({ length: STEPS }, () => rng() < weight);
    return ensureOneActive(limitToMax(hits, o.maxSteps ?? 8), rng);
  },

  /** Interphase PatternTechno: four on the floor (or every 2 / 8). */
  techno(o) {
    const every = o.every ?? 4;
    o.every = every;
    return Array.from({ length: STEPS }, (_, i) => i % every === 0);
  },

  /** Euclidean rhythm E(k, n=16) rotated — evenly spread hits (tresillo, cinquillo, …). */
  euclid(o, rng) {
    const k = o.k ?? randInt(rng, o.minK ?? 3, o.maxK ?? 7);
    const rotation = o.rotation ?? (rng() < 0.5 ? 0 : randInt(rng, 0, STEPS - 1));
    Object.assign(o, { k, rotation });
    const base = Array.from({ length: STEPS }, (_, i) => Math.floor((i * k) / STEPS) !== Math.floor(((i - 1) * k) / STEPS) || i === 0);
    if (k === 0) base.fill(false);
    return Array.from({ length: STEPS }, (_, i) => base[(i - rotation + STEPS) % STEPS]);
  },

  /** wam's original: coin flip against metric weights (downbeats likelier). */
  weighted(o, rng) {
    const density = o.density ?? 0.5;
    o.density = density;
    return Array.from({ length: STEPS }, (_, i) => rng() < STEP_WEIGHTS[i] * density * 1.4);
  },

  /** Snare backbeat (2 & 4), sometimes with a pickup or a skipped hit. */
  backbeat(o, rng) {
    const hits = Array.from({ length: STEPS }, (_, i) => i === 4 || i === 12);
    const variant = o.variant ?? pickWeighted(rng, [["plain", 4], ["pickup", 2], ["late", 1], ["double", 1]]);
    o.variant = variant;
    if (variant === "pickup") {
      o.pickupStep = o.pickupStep ?? (randInt(rng, 0, 1) ? 15 : 7);
      hits[o.pickupStep] = true;
    }
    if (variant === "late") hits[14] = true;
    if (variant === "double") hits[13] = true;
    return hits;
  },

  /** Off-beat 8ths (hats), optionally with 16th pickups. */
  offbeat(o, rng) {
    const pickups = o.pickups ?? (rng() < 0.4 ? randInt(rng, 1, 3) : 0);
    o.pickups = pickups;
    o.pickupSteps = o.pickupSteps ?? Array.from({ length: pickups }, () => pick(rng, [3, 7, 11, 15]));
    const hits = Array.from({ length: STEPS }, (_, i) => i % 4 === 2);
    for (const i of o.pickupSteps) hits[i] = true;
    return hits;
  },

  /** Son clave 3-2 / 2-3 and rumba variants. */
  clave(o, rng) {
    const TYPES = { son32: [0, 3, 6, 10, 12], son23: [2, 4, 8, 11, 14], rumba32: [0, 3, 7, 10, 12], tresillo: [0, 3, 6, 8, 11, 14] };
    const type = o.type ?? pick(rng, Object.keys(TYPES));
    o.type = type;
    const set = new Set(TYPES[type]);
    return Array.from({ length: STEPS }, (_, i) => set.has(i));
  },

  /** Four on the floor with anticipations / a dropped beat — broken / garage feel. */
  broken(o, rng) {
    const hits = Array.from({ length: STEPS }, (_, i) => i % 4 === 0);
    const moves = o.moves ?? randInt(rng, 1, 3);
    o.moves = moves;
    for (let n = 0; n < moves; n++) {
      const beat = pick(rng, [4, 8, 12]);
      hits[beat] = rng() < 0.4 ? false : hits[beat];
      hits[beat - 1 + (rng() < 0.5 ? 0 : 2)] = true; // anticipate or delay by a 16th
    }
    hits[0] = true;
    return hits;
  },
};

/** Generate a rhythm by name. @returns {{ hits: boolean[], meta: {rhythm, ...opts} }} */
export function generateRhythm(name, opts = {}, rng = Math.random) {
  const o = { ...opts };
  const fn = RHYTHMS[name];
  if (!fn) throw new Error(`[WAM] Unknown rhythm "${name}"`);
  const hits = fn(o, rng);
  return { hits, meta: { rhythm: name, ...o } };
}

// ───────────────────────────── 2. notes ─────────────────────────────

/**
 * Note schemes: (hits, ctx, o, rng) → MIDI per step (inactive steps still get
 * a note, so toggling a step on in the grid plays something sensible).
 * ctx = { notes: ascending scale notes in range, root }
 */
const nearestIndex = (notes, midi) => notes.reduce((best, n, i) => (Math.abs(n - midi) < Math.abs(notes[best] - midi) ? i : best), 0);

export const NOTE_SCHEMES = {
  /** Interphase notesByStep: cycle up the scale from an offset as the bar advances. */
  byStep(hits, { notes, root }, o, rng) {
    const offset = o.offset ?? randInt(rng, 0, 7);
    o.offset = offset;
    const base = nearestIndex(notes, root);
    return hits.map((_, i) => notes[(base + offset + i) % notes.length]);
  },

  /** Mostly stepwise motion with occasional leaps; starts on the root. */
  walk(hits, { notes, root }, o, rng) {
    const leap = o.leap ?? 0.15;
    o.leap = leap;
    let idx = nearestIndex(notes, root);
    return hits.map((on, i) => {
      if (i > 0 && on) {
        const step = rng() < leap ? pick(rng, [-4, -3, 3, 4]) : pick(rng, [-2, -1, -1, 0, 1, 1, 2]);
        idx = Math.max(0, Math.min(notes.length - 1, idx + step));
      }
      return notes[idx];
    });
  },

  /** Bass: root-heavy with fifths and octaves. */
  rootFifth(hits, { notes, root }, o, rng) {
    const fifth = notes[nearestIndex(notes, root + 7)];
    const octave = notes[nearestIndex(notes, root + 12)];
    const low = notes[nearestIndex(notes, root - 5)];
    return hits.map((_, i) => (i === 0 ? root : pickWeighted(rng, [[root, 6], [fifth, 3], [octave, 2], [low, 1]])));
  },

  /** Arpeggio over scale thirds (chord tones): up / down / up-down. */
  arp(hits, { notes, root }, o, rng) {
    const dir = o.dir ?? pick(rng, ["up", "down", "updown"]);
    const span = o.span ?? randInt(rng, 3, 5);
    Object.assign(o, { dir, span });
    const base = nearestIndex(notes, root);
    const chord = Array.from({ length: span }, (_, k) => notes[Math.min(notes.length - 1, base + k * 2)]);
    const seq = dir === "up" ? chord : dir === "down" ? [...chord].reverse() : [...chord, ...chord.slice(1, -1).reverse()];
    let n = 0;
    return hits.map((on) => (on ? seq[n++ % seq.length] : seq[n % seq.length]));
  },

  /** A 2–4 note motif repeated through the bar, varied on its last repeat. */
  motif(hits, { notes, root }, o, rng) {
    const len = o.len ?? randInt(rng, 2, 4);
    o.len = len;
    const base = nearestIndex(notes, root);
    const motif = Array.from({ length: len }, (_, k) => notes[Math.max(0, Math.min(notes.length - 1, base + (k === 0 ? 0 : randInt(rng, -2, 4))))]);
    const answer = motif.map((m) => notes[Math.max(0, Math.min(notes.length - 1, nearestIndex(notes, m) + pick(rng, [-1, 1, 2])))]);
    let n = 0;
    const onCount = countActive(hits);
    return hits.map((on) => {
      const k = n;
      if (on) n++;
      const late = onCount > len * 2 && k >= onCount - len; // last repetition = answer phrase
      return (late ? answer : motif)[k % len];
    });
  },

  /** One note held (pedal), with occasional octave or fifth. */
  pedal(hits, { notes, root }, o, rng) {
    const up = notes[nearestIndex(notes, root + 12)];
    const fifth = notes[nearestIndex(notes, root + 7)];
    return hits.map(() => pickWeighted(rng, [[root, 8], [up, 1], [fifth, 1]]));
  },

  /** Uniform in scale (wam's original). */
  random(hits, { notes }, o, rng) {
    return hits.map(() => pick(rng, notes));
  },
};

// ─────────────────────────── 3. decorators ───────────────────────────

/** Apply step decorators in place. Weak = metrically weak position (STEP_WEIGHTS < 0.5). */
export function decorate(steps, d = {}, rng = Math.random) {
  steps.forEach((s, i) => {
    if (!s.active) return;
    const weak = STEP_WEIGHTS[i] < 0.5;
    if (d.accents === "downbeat") s.accent = i % 4 === 0 && rng() < 0.7;
    else if (d.accents === "random") s.accent = rng() < 0.25;
    if (d.ghosts && weak && rng() < d.ghosts) s.probability = pick(rng, [0.5, 0.6, 0.7, 0.8]);
    if (d.ratchets && rng() < d.ratchets) s.ratchet = pick(rng, [2, 2, 3, 4]);
    if (d.conditions && i !== 0 && rng() < d.conditions) s.conditions = pick(rng, ["1:2", "2:2", "1:4", "3:4"]);
    if (d.open && i % 4 === 2 && rng() < d.open) s.open = true;
  });
  return steps;
}

// ───────────────────────────── recipes ─────────────────────────────

/**
 * Role recipes: weighted rhythm configs, note schemes, decorators.
 * `keepFirst` forces a hit on step 0 (kicks, basses).
 */
export const RECIPES = {
  kick: {
    rhythms: [[["techno", {}], 4], [["euclid", { minK: 3, maxK: 5, rotation: 0 }], 2], [["broken", {}], 2], [["weighted", { density: 0.35 }], 1], [["interval", { min: 3, max: 8, start: 0 }], 1]],
    decorators: { ghosts: 0.15, ratchets: 0.03 },
    keepFirst: true,
  },
  snare: {
    rhythms: [[["backbeat", {}], 5], [["euclid", { minK: 2, maxK: 3, rotation: 4 }], 1], [["sine", { maxSteps: 4 }], 1], [["noise", { maxSteps: 4 }], 1]],
    decorators: { ghosts: 0.35, ratchets: 0.05, conditions: 0.08 },
  },
  hat: {
    rhythms: [[["interval", { min: 1, max: 2, start: 0 }], 3], [["offbeat", {}], 3], [["euclid", { minK: 5, maxK: 11 }], 2], [["random", { weight: 0.5, maxSteps: 12 }], 1], [["sine", { maxSteps: 12, thresh: 0.45 }], 1]],
    decorators: { ghosts: 0.3, ratchets: 0.08, open: 0.25 },
  },
  bass: {
    rhythms: [[["euclid", { minK: 4, maxK: 7 }], 3], [["weighted", { density: 0.55 }], 2], [["clave", {}], 1], [["sine", {}], 1], [["noise", {}], 1], [["interval", { min: 2, max: 3, start: 0 }], 1]],
    notes: [["walk", 3], ["rootFifth", 3], ["motif", 2], ["byStep", 1]],
    decorators: { ghosts: 0.1, ratchets: 0.05, conditions: 0.05 },
    keepFirst: true,
  },
  keys: {
    rhythms: [[["euclid", { minK: 2, maxK: 5 }], 3], [["interval", { min: 3, max: 8 }], 2], [["clave", {}], 1], [["sine", { maxSteps: 5 }], 1], [["random", { weight: 0.2, maxSteps: 5 }], 1]],
    notes: [["motif", 3], ["arp", 2], ["byStep", 1], ["walk", 1]],
    decorators: { ghosts: 0.1, conditions: 0.08 },
  },
  lead: {
    rhythms: [[["euclid", { minK: 5, maxK: 9 }], 2], [["noise", { maxSteps: 10, thresh: 0.5 }], 2], [["weighted", { density: 0.6 }], 1], [["sine", { maxSteps: 10, thresh: 0.5 }], 1]],
    notes: [["walk", 3], ["motif", 2], ["arp", 2], ["byStep", 1]],
    decorators: { ghosts: 0.15, ratchets: 0.06 },
  },
  pad: {
    rhythms: [[["interval", { choices: [4, 8, 8, 16], start: 0 }], 3], [["euclid", { minK: 1, maxK: 3, rotation: 0 }], 2]],
    notes: [["walk", 2], ["pedal", 2], ["random", 1]],
    decorators: {},
    keepFirst: true,
  },
  fx: {
    rhythms: [[["random", { weight: 0.15, maxSteps: 3 }], 2], [["euclid", { minK: 1, maxK: 3 }], 1]],
    decorators: { conditions: 0.2, ratchets: 0.15 },
  },
};

/**
 * Make a full 16-step pattern for a role.
 * @param {string} role  RECIPES key
 * @param {object} [o]
 * @param {number} [o.root]       root MIDI (melodic roles)
 * @param {string} [o.scale]      scale name
 * @param {[number, number]} [o.range]  MIDI range for notes
 * @param {boolean} [o.accent]    instrument supports accents (acid)
 * @param {string} [o.rhythm]     force a rhythm generator (else recipe-weighted)
 * @param {string} [o.scheme]     force a note scheme
 * @param {() => number} [o.rng]
 * @returns {{ steps: object[], meta: { role, rhythm, scheme?, ... } }}
 */
export function generatePattern(role, { root = 36, scale = "Minor", range = [24, 60], accent = false, rhythm, scheme, rng = Math.random } = {}) {
  const recipe = RECIPES[role] ?? RECIPES.keys;
  const [rName, rOpts] = rhythm ? [rhythm, {}] : pickWeighted(rng, recipe.rhythms);
  const { hits, meta } = generateRhythm(rName, rOpts, rng);
  if (recipe.keepFirst) hits[0] = true;
  ensureOneActive(hits, rng, recipe.keepFirst ? 0 : undefined);

  let notes = null;
  if (recipe.notes) {
    const pool = scaleNotesInRange(root, scale, range[0], range[1]);
    const rootInRange = pool.length ? pool[nearestIndex(pool, root < range[0] ? root + 12 * Math.ceil((range[0] - root) / 12) : root)] : root;
    const sName = scheme ?? pickWeighted(rng, recipe.notes);
    const so = {};
    notes = pool.length ? NOTE_SCHEMES[sName](hits, { notes: pool, root: rootInRange }, so, rng) : hits.map(() => root);
    meta.scheme = sName;
    Object.assign(meta, Object.fromEntries(Object.entries(so).map(([k, v]) => [`n_${k}`, v])));
  }

  const steps = hits.map((active, i) => {
    const s = { active, probability: 1, ratchet: 1, conditions: "off" };
    if (notes) s.note = notes[i];
    if (accent) s.accent = false;
    return s;
  });
  decorate(steps, { ...recipe.decorators, accents: accent ? "downbeat" : undefined }, rng);
  meta.role = role;
  return { steps, meta };
}

/** Short human description of a pattern's meta, e.g. "euclid 5/16 · walk". */
export function describePattern(meta) {
  if (!meta) return "";
  const r = meta.rhythm === "euclid" ? `euclid ${meta.k}/16${meta.rotation ? ` ↻${meta.rotation}` : ""}`
    : meta.rhythm === "interval" ? `every ${meta.every}`
    : meta.rhythm === "clave" ? `clave ${meta.type}`
    : meta.rhythm === "backbeat" ? `backbeat${meta.variant !== "plain" ? ` (${meta.variant})` : ""}`
    : meta.rhythm;
  return meta.scheme ? `${r} · ${meta.scheme}` : r;
}

// ─────────────────────────────── 4. ops ───────────────────────────────

/**
 * Pattern operations on step arrays (return NEW arrays; inputs untouched).
 * Used by Evolve. Rhythm ops move whole steps (note + options travel with the hit).
 */
export const OPS = {
  /** Rotate by n (positive = later). Interphase nudgePatternForward = rotate(1). */
  rotate: (steps, n = 1) => steps.map((_, i) => ({ ...steps[(i - n + STEPS * 4) % STEPS] })),
  nudge: (steps) => OPS.rotate(steps, 1),

  /** Interphase morphPattern: move one hit to an empty step. */
  morph(steps, rng = Math.random, { keepFirst = false } = {}) {
    const out = steps.map((s) => ({ ...s }));
    const on = out.map((s, i) => (s.active && !(keepFirst && i === 0) ? i : -1)).filter((i) => i >= 0);
    const off = out.map((s, i) => (!s.active ? i : -1)).filter((i) => i >= 0);
    if (!on.length || !off.length) return out;
    const from = pick(rng, on);
    const to = pick(rng, off);
    out[to] = { ...out[from], active: true };
    out[from] = { ...out[from], active: false };
    return out;
  },

  /** Toggle k random steps. */
  flip(steps, k = 1, rng = Math.random, { keepFirst = false } = {}) {
    const out = steps.map((s) => ({ ...s }));
    for (let n = 0; n < k; n++) {
      const i = randInt(rng, keepFirst ? 1 : 0, STEPS - 1);
      out[i].active = !out[i].active;
    }
    return out;
  },

  /** Remove the k metrically weakest hits (sparser). */
  thin(steps, k = 1, { keepFirst = false } = {}) {
    const out = steps.map((s) => ({ ...s }));
    const on = out.map((s, i) => (s.active && !(keepFirst && i === 0) ? i : -1)).filter((i) => i >= 0);
    on.sort((a, b) => STEP_WEIGHTS[a] - STEP_WEIGHTS[b]);
    for (const i of on.slice(0, Math.max(0, Math.min(k, on.length - 1)))) out[i].active = false;
    return out;
  },

  /** Add hits on the k strongest empty positions (busier). */
  thicken(steps, k = 1) {
    const out = steps.map((s) => ({ ...s }));
    const off = out.map((s, i) => (!s.active ? i : -1)).filter((i) => i >= 0);
    off.sort((a, b) => STEP_WEIGHTS[b] - STEP_WEIGHTS[a]);
    for (const i of off.slice(0, k)) out[i].active = true;
    return out;
  },

  /** Drum-fill flavor: busier last beat with a ratchet. */
  fill(steps, rng = Math.random) {
    const out = steps.map((s) => ({ ...s }));
    for (let i = 12; i < STEPS; i++) if (rng() < 0.6) out[i].active = true;
    const last = pick(rng, [13, 14, 15]);
    out[last] = { ...out[last], active: true, ratchet: pick(rng, [2, 3]) };
    return out;
  },

  /** Play the bar backwards. */
  reverse: (steps) => steps.map((_, i) => ({ ...steps[STEPS - 1 - i] })),

  /** Hits ↔ rests (keeps notes/options per position). */
  invert: (steps) => steps.map((s) => ({ ...s, active: !s.active })),

  /** Move every note by `degrees` scale steps (within `notes`, the scale pool). */
  transpose(steps, degrees, notes) {
    if (!notes?.length) return steps.map((s) => ({ ...s }));
    return steps.map((s) => (s.note == null ? { ...s } : { ...s, note: notes[Math.max(0, Math.min(notes.length - 1, nearestIndex(notes, s.note) + degrees))] }));
  },

  /** Shuffle which notes the hits play (same rhythm, new melody order). */
  shuffleNotes(steps, rng = Math.random) {
    const out = steps.map((s) => ({ ...s }));
    const idx = out.map((s, i) => (s.active && s.note != null ? i : -1)).filter((i) => i >= 0);
    const notes = idx.map((i) => out[i].note);
    for (let i = notes.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [notes[i], notes[j]] = [notes[j], notes[i]];
    }
    idx.forEach((i, n) => (out[i].note = notes[n]));
    return out;
  },

  /** Re-roll ghost/ratchet/condition decorations without touching the rhythm. */
  redecorate(steps, decorators, rng = Math.random) {
    const out = steps.map((s) => ({ ...s, probability: 1, ratchet: 1, conditions: "off" }));
    return decorate(out, decorators, rng);
  },
};

/** Scale note pool for transpose / note schemes. */
export function notePool(root, scale, range) {
  return scaleNotesInRange(root, scale, range[0], range[1]);
}
