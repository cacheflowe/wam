/**
 * Evolve — patterns that change over time (architecture-refactor Phase 1b).
 * No DOM. Builds on Interphase's evolvePattern() and goes further.
 *
 * Three layers per track:
 *
 *     original  →  home  →  variation
 *     (the song)   (drifts)  (temporary, snaps back)
 *
 * - VARIATION: a temporary change on top of home (fill, dropped kick, thinned
 *   hats, re-rolled ghosts…). It plays for a bar or two, then gravity pulls it
 *   back to home.
 * - HOME drifts only when you ask (Keep, Evolve) or when the Conductor's DRIFT
 *   is > 0 (a variation sometimes sticks and becomes the new home), so a song
 *   can evolve indefinitely while always being anchored. Return snaps home back
 *   to the original. Every home change is kept in a history.
 * - ENERGY (0..1) biases which operations are chosen: low → thin, ghosts, drop;
 *   high → thicken, fills, ratchets.
 *
 * The Conductor schedules automatic variations musically: on phrase
 * boundaries, staggered round-robin across tracks (Interphase-style, so one
 * track changes at a time), with drum fills in the bar before a phrase.
 *
 * Tracks are reached through a small adapter (see TrackEvolver) so the same
 * logic drives UI panels or the headless song player.
 */
import { OPS, RECIPES, generatePattern, countActive } from "./pattern-gen.js";

const DRUMS = new Set(["kick", "snare", "hat"]);
const MELODIC = new Set(["bass", "lead", "keys", "pad"]);

const clone = (steps) => steps.map((s) => ({ ...s }));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Variation operations, weighted by energy band [low, mid, high].
 * `when(role)` filters by instrument role.
 */
export const VARIATIONS = [
  { name: "thin", w: [3, 1, 0], apply: (s, c) => OPS.thin(s, 1 + Math.floor(c.rng() * 2), c) },
  { name: "drop", w: [2, 0, 0], when: (r) => r === "kick" || r === "bass", apply: (s, c) => s.map((x, i) => ({ ...x, active: i === 0 && x.active })) },
  { name: "ghosts", w: [3, 1, 0], apply: (s, c) => OPS.redecorate(s, { ...c.decorators, ghosts: 0.7 }, c.rng) },
  { name: "morph", w: [1, 3, 1], apply: (s, c) => OPS.morph(s, c.rng, c) },
  { name: "nudge", w: [1, 2, 1], when: (r, c) => !c.keepFirst, apply: (s) => OPS.nudge(s) },
  { name: "shuffle notes", w: [1, 2, 1], when: (r) => MELODIC.has(r), apply: (s, c) => OPS.shuffleNotes(s, c.rng) },
  { name: "transpose", w: [1, 2, 2], when: (r) => MELODIC.has(r), apply: (s, c) => OPS.transpose(s, c.rng() < 0.5 ? -2 : 2, c.notes()) },
  { name: "thicken", w: [0, 1, 3], apply: (s, c) => OPS.thicken(s, 1 + Math.floor(c.rng() * 2)) },
  { name: "ratchets", w: [0, 1, 3], apply: (s, c) => OPS.redecorate(s, { ...c.decorators, ratchets: 0.3 }, c.rng) },
  { name: "fill", w: [0, 1, 4], when: (r) => DRUMS.has(r), apply: (s, c) => OPS.fill(s, c.rng) },
];

/** Pick a variation for a role at an energy level. */
export function chooseVariation(role, energy, ctx, rng = Math.random) {
  const band = energy < 0.34 ? 0 : energy < 0.67 ? 1 : 2;
  const options = VARIATIONS.filter((v) => (!v.when || v.when(role, ctx)) && v.w[band] > 0);
  const total = options.reduce((n, v) => n + v.w[band], 0);
  let r = rng() * total;
  for (const v of options) if ((r -= v.w[band]) < 0) return v;
  return options[options.length - 1];
}

/**
 * Per-track evolve state.
 *
 * adapter: {
 *   role: string,
 *   get(name) → steps[]            current steps of pattern `name`
 *   set(name, steps)               write steps (UI + playback)
 *   playing(tick?) → name          pattern name sounding (at tick)
 *   notes() → number[]             scale pool for melodic ops
 *   regenerate() → steps[]         a fresh pattern for this role
 *   onChange?(kind, info)          notify (e.g. persist on permanent changes)
 * }
 */
export class TrackEvolver {
  constructor(adapter, { rng = Math.random } = {}) {
    this.a = adapter;
    this.rng = rng;
    this.enabled = true; // takes part in Conductor auto-evolve
    this._original = {}; // name → steps (first seen this session)
    this._home = {}; // name → steps
    this.history = []; // [{ name, steps, reason }]
    this.variation = null; // { name, until, op }
    this._evolveCount = 0;
  }

  get role() {
    return this.a.role;
  }

  _ctx() {
    const recipe = RECIPES[this.a.role] ?? {};
    return { rng: this.rng, keepFirst: !!recipe.keepFirst, decorators: recipe.decorators ?? {}, notes: () => this.a.notes?.() ?? [] };
  }

  /** Home of a pattern (initialized from what's playing the first time we touch it). */
  home(name) {
    if (!this._home[name]) {
      const steps = clone(this.a.get(name) ?? []);
      this._home[name] = steps;
      this._original[name] ??= clone(steps);
    }
    return this._home[name];
  }

  original(name) {
    this.home(name);
    return this._original[name];
  }

  /** Steps that should be SAVED for a pattern: home while a variation plays. */
  savedSteps(name) {
    return this.variation?.name === name ? clone(this._home[name]) : null;
  }

  isAway(name = this.a.playing()) {
    return !!this._home[name] && !same(this._home[name], this._original[name]);
  }

  /**
   * Temporary variation of the playing pattern for `bars` bars.
   * @returns {string|null} op name
   */
  vary({ energy = 0.5, bars = 1, bar = 0, op = null, tick } = {}) {
    const name = this.a.playing(tick);
    if (this.variation) this.restore();
    const home = this.home(name);
    const ctx = this._ctx();
    const v = op ? VARIATIONS.find((x) => x.name === op) : chooseVariation(this.a.role, energy, ctx, this.rng);
    if (!v) return null;
    let steps = v.apply(clone(home), ctx);
    if (!countActive(steps.map((s) => s.active))) steps = clone(home); // never silence the track entirely
    this.variation = { name, until: bar + bars, op: v.name };
    this.a.set(name, steps);
    this.a.onChange?.("vary", { name, op: v.name });
    return v.name;
  }

  /** End the current variation: back to home (or keep it, see Conductor drift). */
  restore() {
    if (!this.variation) return;
    const { name } = this.variation;
    this.variation = null;
    this.a.set(name, clone(this.home(name)));
    this.a.onChange?.("restore", { name });
  }

  /** Adopt what's playing as the new home ("I like that one"). */
  keep(reason = "keep") {
    const name = this.variation?.name ?? this.a.playing();
    const steps = clone(this.a.get(name));
    this.variation = null;
    this._setHome(name, steps, reason);
  }

  /** Snap home back to the original. */
  returnHome() {
    const name = this.variation?.name ?? this.a.playing();
    this.variation = null;
    this._setHome(name, clone(this.original(name)), "return");
    this.a.set(name, clone(this._home[name]));
  }

  /**
   * Permanent evolution step (Interphase evolvePattern): every 4th call a big
   * change (fresh pattern for the role), otherwise a small one.
   */
  evolve({ energy = 0.5, tick } = {}) {
    const name = this.variation?.name ?? this.a.playing(tick);
    if (this.variation) this.restore();
    const home = this.home(name);
    let steps;
    let op;
    if (this._evolveCount++ % 4 === 3 && this.a.regenerate) {
      steps = this.a.regenerate();
      op = "new pattern";
    } else {
      const ctx = this._ctx();
      const v = chooseVariation(this.a.role, energy, ctx, this.rng);
      steps = v.apply(clone(home), ctx);
      op = v.name;
    }
    if (!countActive(steps.map((s) => s.active))) steps = clone(home);
    this._setHome(name, steps, `evolve: ${op}`);
    this.a.set(name, clone(steps));
    return op;
  }

  /** Step back to the previous home. */
  undo() {
    const last = this.history.pop();
    if (!last) return false;
    this.variation = null;
    this._home[last.name] = clone(last.steps);
    this.a.set(last.name, clone(last.steps));
    this.a.onChange?.("home", { name: last.name, reason: "undo" });
    return true;
  }

  _setHome(name, steps, reason) {
    const prev = this.home(name);
    if (same(prev, steps)) return;
    this.history.push({ name, steps: clone(prev), reason });
    if (this.history.length > 50) this.history.shift();
    this._home[name] = clone(steps);
    this.a.onChange?.("home", { name, reason });
  }

  /** A user edited the pattern: during a variation that means "keep this". */
  userEdited(name) {
    if (this.variation?.name === name) this.keep("edit");
    else if (this._home[name]) this._home[name] = clone(this.a.get(name));
  }

  /** Forget session state (e.g. a new song was loaded). */
  reset() {
    this._original = {};
    this._home = {};
    this.history = [];
    this.variation = null;
    this._evolveCount = 0;
  }
}

/**
 * Conductor — schedules evolution musically across tracks.
 *
 *   conductor.energy = 0..1;  conductor.drift = 0..1;  conductor.auto = true;
 *   clock.onTick((pos) => { if (pos.downbeat) conductor.onBar(pos.bar, pos.tick); … });
 */
export class Conductor extends EventTarget {
  /**
   * Dispatches "change" (settings) and "event" (an evolution happened; detail = log entry).
   * @param {object} o
   * @param {() => TrackEvolver[]} o.tracks
   * @param {() => number} [o.rng]
   */
  constructor({ tracks, rng = Math.random } = {}) {
    super();
    this.tracks = tracks;
    this.rng = rng;
    this._s = { energy: 0.5, drift: 0, auto: false, phrase: 4 };
    this._rr = 0;
    this.log = []; // recent events for the UI: { bar, label, what }
  }

  /** 0..1 — low: thin / ghosts / drop; high: thicken / fills / ratchets; also how often auto-variations happen. */
  get energy() { return this._s.energy; }
  set energy(v) { this._set("energy", Math.max(0, Math.min(1, Number(v) || 0))); }
  /** 0..1 — chance a finished variation sticks (and of permanent auto-evolve steps). 0 = always return home. */
  get drift() { return this._s.drift; }
  set drift(v) { this._set("drift", Math.max(0, Math.min(1, Number(v) || 0))); }
  /** Automatic variations on phrase boundaries. */
  get auto() { return this._s.auto; }
  set auto(v) { this._set("auto", !!v); }
  /** Phrase length in bars. */
  get phrase() { return this._s.phrase; }
  set phrase(v) { this._set("phrase", Math.max(1, Math.round(Number(v) || 4))); }

  _set(k, v) {
    if (this._s[k] === v) return;
    this._s[k] = v;
    this.dispatchEvent(new CustomEvent("change", { detail: { key: k, value: v } }));
  }

  _note(bar, tr, what) {
    const entry = { bar, label: tr.label ?? tr.role, what };
    this.log.unshift(entry);
    if (this.log.length > 12) this.log.pop();
    this.dispatchEvent(new CustomEvent("event", { detail: entry }));
  }

  /** Call on every bar start (before the bar's steps play). */
  onBar(bar, tick) {
    const tracks = this.tracks().filter(Boolean);
    // 1. Expired variations: gravity back to home — or, with drift, sometimes stick.
    for (const tr of tracks) {
      if (tr.variation && bar >= tr.variation.until) {
        if (this.auto && this.rng() < this.drift) {
          this._note(bar, tr, `kept ${tr.variation.op}`);
          tr.keep("drift");
        } else tr.restore();
      }
    }
    if (!this.auto) return;
    const active = tracks.filter((t) => t.enabled);
    if (!active.length) return;
    const pos = bar % this.phrase;

    // 2. Last bar of a phrase: drum fills, likelier with energy.
    if (pos === this.phrase - 1) {
      for (const tr of active) {
        if (DRUMS.has(tr.role) && !tr.variation && this.rng() < this.energy * 0.8) {
          tr.vary({ op: tr.role === "kick" && this.energy < 0.5 ? "drop" : "fill", bars: 1, bar, tick });
          this._note(bar, tr, tr.variation?.op ?? "fill");
        }
      }
    }

    // 3. Phrase start: one track (round robin) gets a variation; with drift, sometimes a permanent step.
    if (pos === 0 && bar > 0) {
      const tr = active[this._rr++ % active.length];
      if (this.drift > 0 && this.rng() < this.drift * 0.5) {
        const op = tr.evolve({ energy: this.energy, tick });
        this._note(bar, tr, `evolved: ${op}`);
      } else if (this.rng() < 0.4 + 0.6 * this.energy) {
        const op = tr.vary({ energy: this.energy, bars: this.rng() < 0.5 ? 1 : 2, bar, tick });
        if (op) this._note(bar, tr, op);
      }
    }
  }

  toJSON() {
    return { ...this._s };
  }

  fromJSON(o) {
    if (!o) return;
    for (const k of ["energy", "drift", "auto", "phrase"]) if (o[k] != null) this[k] = o[k];
  }
}
