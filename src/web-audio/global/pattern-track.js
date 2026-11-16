/**
 * Pattern track — headless pattern playback (architecture-refactor Phase 1).
 *
 * Everything is DERIVED from the global clock tick (Interphase-style: one
 * clock, tracks compute their position from it) instead of accumulated in
 * per-track counters. That makes playback a pure function of
 * (tick, track data): seeking, restarting and reasoning about it are trivial,
 * and the old counter bugs (chain + density, rotation storms, Stop→Play
 * resuming mid-chain) can't happen.
 *
 * Units:
 *   tick    — global 16th-note clock tick since Play (16 per bar).
 *   cycle   — one pass through the 16-step pattern. Its length in ticks
 *             depends on speed: 16 at 1×, 8 at 2×, 32 at 0.5×.
 *   played  — cycles that actually play (density `playEvery`: every Nth cycle).
 * Chain position, rotation and trig conditions all count PLAYED cycles.
 * Rotation is an index offset applied at read time — stored patterns never move.
 *
 * No DOM. Controls (and later the headless song player) call tick().
 */
import { meetsBarCondition } from "./sequencer-conditions.js";

export const STEPS = 16;
export const PATTERN_NAMES = Object.freeze(["A", "B", "C", "D"]);

/** Ticks per pattern cycle for a speed multiplier. */
export function cycleLength(speed = 1) {
  return speed === 2 ? 8 : speed === 0.5 ? 32 : 16;
}

/**
 * Where a track is at `tick`. Pure.
 * @param {number} tick
 * @param {{speed?:number, playEvery?:number, rotationOffset?:number, rotationIntervalBars?:number, chainLength?:number}} p
 * @returns {{
 *   cycle:number, cycleTick:number, cycleStart:boolean, played:boolean, playedCount:number,
 *   chainIndex:number, rotation:number,
 *   slots: Array<{index:number, sub:number, of:number}>   // pattern positions that sound on this tick
 * }}
 */
export function trackPosition(tick, { speed = 1, playEvery = 1, rotationOffset = 0, rotationIntervalBars = 1, chainLength = 1 } = {}) {
  const len = cycleLength(speed);
  const cycle = Math.floor(tick / len);
  const cycleTick = tick - cycle * len;
  const every = Math.max(1, playEvery | 0);
  const played = cycle % every === 0;
  const playedCount = Math.floor(cycle / every); // played cycles before (and incl.) this one
  const chainIndex = chainLength > 0 ? playedCount % chainLength : 0;
  const interval = Math.max(1, rotationIntervalBars | 0);
  const rotation = (((Math.floor(playedCount / interval) * (rotationOffset | 0)) % STEPS) + STEPS) % STEPS;

  // Which pattern positions (0–15) sound on this tick.
  let slots = [];
  if (played) {
    if (speed === 2) slots = [{ index: cycleTick * 2, sub: 0, of: 2 }, { index: cycleTick * 2 + 1, sub: 1, of: 2 }];
    else if (speed === 0.5) slots = cycleTick % 2 === 0 ? [{ index: cycleTick / 2, sub: 0, of: 1 }] : [];
    else slots = [{ index: cycleTick, sub: 0, of: 1 }];
  }
  return { cycle, cycleTick, cycleStart: cycleTick === 0, played, playedCount, chainIndex, rotation, slots };
}

/** Source step for a playback position under rotation (rotation shifts the pattern LEFT). */
export function rotatedIndex(position, rotation) {
  return (position + rotation) % STEPS;
}

/**
 * Should this step fire? (active, probability, trig condition on played cycles)
 * @param {object} step
 * @param {number} playedCount
 * @param {() => number} [rng]
 */
export function stepFires(step, playedCount, rng = Math.random) {
  if (!step?.active) return false;
  if (!(rng() < (step.probability ?? 1))) return false;
  if (step.conditions && step.conditions !== "off" && !meetsBarCondition(step.conditions, playedCount)) return false;
  return true;
}

/**
 * Headless track: pattern data + playback rules. tick() returns what to play.
 *
 * Data is held by reference so a UI can keep editing the same arrays
 * (Controls owns them today; architecture-refactor Phase 3 moves ownership here).
 */
export class PatternTrack {
  /**
   * @param {object} [data]
   * @param {Object<string,{steps:object[]}>} [data.patterns]  A–D
   * @param {number[]} [data.chain]                           pattern indices (0=A)
   * @param {{playEvery?:number, rotationOffset?:number, rotationIntervalBars?:number}} [data.params]
   * @param {number} [data.speed]
   */
  constructor(data = {}) {
    this.patterns = data.patterns ?? { A: { steps: [] } };
    this.chain = data.chain ?? [0];
    this.params = data.params ?? {};
    this.speed = data.speed ?? 1;
    this.rng = Math.random;
    this._queued = null; // pattern index waiting for the next cycle start
    this._nextTick = 0;
  }

  /** The chain, never empty. */
  get activeChain() {
    return this.chain.length ? this.chain : [0];
  }

  position(tick) {
    return trackPosition(tick, { ...this.params, speed: this.speed, chainLength: this.activeChain.length });
  }

  /** Name of the pattern sounding at `tick`. */
  patternAt(tick) {
    const pos = this.position(tick);
    return PATTERN_NAMES[this.activeChain[pos.chainIndex]] ?? "A";
  }

  /** True when the next tick starts a new cycle (or playback hasn't advanced yet). */
  get atCycleBoundary() {
    return this._nextTick % cycleLength(this.speed) === 0;
  }

  /** Queue a pattern to loop alone (chain = [it]) from the next cycle start — immediately if on a boundary. */
  launch(name) {
    const idx = PATTERN_NAMES.indexOf(name);
    if (idx < 0) return false;
    this._queued = idx;
    if (this.atCycleBoundary) this._applyQueued();
    return true;
  }

  get queued() {
    return this._queued != null ? PATTERN_NAMES[this._queued] : null;
  }

  /** Launching replaces the chain IN PLACE with the launched pattern, so a UI sharing the array sees it. */
  _applyQueued() {
    this.chain.splice(0, this.chain.length, this._queued);
    this._queued = null;
  }

  /** Back to the top (Play). A pending launch applies immediately. */
  reset() {
    this._nextTick = 0;
    if (this._queued != null) this._applyQueued();
  }

  /**
   * Advance to `tick` and report what plays.
   * @param {number} tick       global tick since Play
   * @param {number} time       AudioContext time of the tick
   * @param {number} stepDur    tick duration (s)
   * @returns {{ patternName:string, launched:string|null, position:object,
   *             slots: Array<{ position:number, index:number, step:object, time:number, dur:number, fires:boolean }> }}
   */
  tick(tick, time, stepDur) {
    let launched = null;
    const len = cycleLength(this.speed);
    if (this._queued != null && tick % len === 0) {
      launched = PATTERN_NAMES[this._queued];
      this._applyQueued();
    }
    const pos = this.position(tick);
    const chain = this.activeChain;
    const patternName = PATTERN_NAMES[chain[pos.chainIndex]] ?? "A";
    const steps = this.patterns[patternName]?.steps ?? [];
    const slots = pos.slots.map(({ index: position, sub, of }) => {
      const index = rotatedIndex(position, pos.rotation);
      const step = steps[index];
      const dur = stepDur / of;
      return { position, index, step, time: time + sub * dur, dur, fires: stepFires(step, pos.playedCount, this.rng) };
    });
    this._nextTick = tick + 1;
    return { patternName, launched, position: pos, slots };
  }
}
