/**
 * Sound design engine — randomize, mutate, and undo for any instrument that
 * declares `static PARAMS` (see param-schema.js). No DOM: works headless, so
 * the generative apps and client projects can use it directly. The Controls UI
 * wraps it to sync knobs.
 *
 * The pure functions take (params, currentValues) and return a NEW values
 * object; applying it is up to the caller (UI event path, or applyValues()
 * for headless use).
 */
import { toNormalized, fromNormalized, randRange } from "./param-schema.js";

/** Mutation amounts used by the UI / hardware. */
export const MUTATE_AMOUNTS = Object.freeze({ subtle: 0.1, medium: 0.25, wild: 0.5 });

/** Standard normal sample (Box–Muller). */
function gaussian(rng) {
  const u = 1 - rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Is this param locked (by its own name or by its group)? */
function isLocked(def, locks) {
  return !!locks && (locks.has(def.param) || (def.group && locks.has(def.group)));
}

/** Can randomize/mutate touch this param at all? */
const isRandomizable = (def, locks) => def.rand !== false && !isLocked(def, locks);

/** Pick an enum option, honoring `rand.weights`. */
function pickOption(def, rng) {
  const opts = def.options;
  const weights = def.rand?.weights ?? opts.map(() => 1);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < opts.length; i++) {
    r -= weights[i];
    if (r < 0) return opts[i];
  }
  return opts[opts.length - 1];
}

/** Normalized [lo, hi] of a param's randomize range. */
function normRange(def) {
  const r = randRange(def);
  return [toNormalized(def, r.min), toNormalized(def, r.max)];
}

/**
 * Randomize every randomizable param inside its curated `rand` range.
 * `rand.bias` (> 0) skews the draw: >1 favors the low end, <1 the high end.
 * @param {object[]} params
 * @param {object} current          Current values (copied; locked params kept).
 * @param {object} [o]
 * @param {Set<string>} [o.locks]   Param names and/or group names to leave alone.
 * @param {() => number} [o.rng]
 * @param {(v: object) => object} [o.constrain]  Cross-param fix-ups.
 */
export function randomizeValues(params, current, { locks = null, rng = Math.random, constrain = null } = {}) {
  const next = { ...current };
  for (const def of params) {
    if (!isRandomizable(def, locks)) continue;
    const type = def.type ?? "number";
    if (type === "number") {
      const [lo, hi] = normRange(def);
      const u = def.rand?.bias ? Math.pow(rng(), def.rand.bias) : rng();
      next[def.param] = fromNormalized(def, lo + (hi - lo) * u);
    } else if (type === "enum") {
      next[def.param] = pickOption(def, rng);
    } else if (type === "bool") {
      next[def.param] = rng() < 0.5;
    }
  }
  return constrain ? constrain(next) : next;
}

/**
 * Nudge the current sound. Each numeric param moves by a gaussian step sized
 * to `amount` × its randomize range (in normalized, scale-aware space). A value
 * already outside the curated range may stay there but won't wander further.
 * Enums switch (weighted) with probability ∝ amount. amount 0 = identity.
 * @param {number} amount  0..1 — see MUTATE_AMOUNTS.
 */
export function mutateValues(params, current, amount, { locks = null, rng = Math.random, constrain = null } = {}) {
  const next = { ...current };
  if (!(amount > 0)) return next;
  for (const def of params) {
    if (!isRandomizable(def, locks)) continue;
    const type = def.type ?? "number";
    const value = current[def.param];
    if (type === "number") {
      if (typeof value !== "number") continue;
      const [lo, hi] = normRange(def);
      const n = toNormalized(def, value);
      const step = gaussian(rng) * amount * 0.5 * (hi - lo);
      const moved = Math.min(Math.max(n, hi), Math.max(Math.min(n, lo), n + step));
      next[def.param] = fromNormalized(def, moved);
    } else if (type === "enum") {
      if (rng() < amount * 0.5) next[def.param] = pickOption(def, rng);
    } else if (type === "bool") {
      if (rng() < amount * 0.25) next[def.param] = !value;
    }
  }
  return constrain ? constrain(next) : next;
}

/** Read every schema param's current value off an instrument. */
export function captureValues(instrument, params = instrument.constructor.PARAMS ?? []) {
  const values = {};
  for (const def of params) {
    const v = instrument[def.param];
    if (v !== undefined) values[def.param] = v;
  }
  return values;
}

/** Headless apply: write values straight onto the instrument. */
export function applyValues(instrument, values) {
  for (const [param, value] of Object.entries(values)) instrument[param] = value;
  instrument._rebake?.();
  instrument._markDirty?.();
}

/** Convenience: randomize an instrument in place (headless). Returns the values. */
export function randomizeInstrument(instrument, opts = {}) {
  const Cls = instrument.constructor;
  const values = randomizeValues(Cls.PARAMS, captureValues(instrument), {
    constrain: Cls.constrain?.bind(Cls),
    ...opts,
  });
  applyValues(instrument, values);
  return values;
}

/** Convenience: mutate an instrument in place (headless). Returns the values. */
export function mutateInstrument(instrument, amount = MUTATE_AMOUNTS.medium, opts = {}) {
  const Cls = instrument.constructor;
  const values = mutateValues(Cls.PARAMS, captureValues(instrument), amount, {
    constrain: Cls.constrain?.bind(Cls),
    ...opts,
  });
  applyValues(instrument, values);
  return values;
}

/** Shallow equality for value snapshots. */
function sameValues(a, b) {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

/**
 * Undo/redo stack of sound snapshots. Call `record(current)` *before* each
 * change (randomize, mutate, preset load); `undo(current)` / `redo(current)`
 * return the snapshot to apply (or null).
 */
export class SoundHistory {
  constructor(limit = 50) {
    this._limit = limit;
    this._undo = [];
    this._redo = [];
  }

  record(current) {
    const top = this._undo[this._undo.length - 1];
    if (!top || !sameValues(top, current)) {
      this._undo.push({ ...current });
      if (this._undo.length > this._limit) this._undo.shift();
    }
    this._redo.length = 0;
  }

  undo(current) {
    // Skip snapshots identical to the current sound (e.g. a no-op mutate).
    while (this._undo.length && sameValues(this._undo[this._undo.length - 1], current)) this._undo.pop();
    if (!this._undo.length) return null;
    this._redo.push({ ...current });
    return this._undo.pop();
  }

  redo(current) {
    if (!this._redo.length) return null;
    this._undo.push({ ...current });
    return this._redo.pop();
  }

  get canUndo() {
    return this._undo.length > 0;
  }

  get canRedo() {
    return this._redo.length > 0;
  }

  clear() {
    this._undo.length = 0;
    this._redo.length = 0;
  }
}
