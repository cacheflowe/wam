/**
 * Clock — the ONE musical clock (architecture-refactor Phase 1).
 *
 * Wraps the lookahead WebAudioSequencer and owns the tick count since Play.
 * Every consumer (pattern tracks, loop players, the performance stream, the
 * visualizer, the song player) reads its position from here instead of
 * keeping its own counter — the Interphase model: one clock, everything
 * derives from it.
 *
 *   const clock = new Clock(ctx, { bpm: 120 });
 *   const off = clock.onTick(({ tick, step, bar, beat, downbeat, time, dur, bpm }) => { … });
 *   clock.start();          // tick 0 = top of the song
 *   clock.advance(time);    // emit the next tick manually (tests / offline rendering)
 *
 * Also exposes the sequencer-like surface (bpm, start, stop, running,
 * stepDurationSec) so existing consumers (transport, recorder) accept it.
 */
import WebAudioSequencer from "./sequencer.js";

export const STEPS_PER_BAR = 16;

/** Musical position of a tick. Pure. */
export function positionAt(tick) {
  const step = tick % STEPS_PER_BAR;
  return { tick, step, bar: Math.floor(tick / STEPS_PER_BAR), beat: step >> 2, downbeat: step === 0 };
}

export class Clock {
  /**
   * @param {AudioContext|OfflineAudioContext} ctx
   * @param {{ bpm?: number }} [o]
   */
  constructor(ctx, { bpm = 120 } = {}) {
    this.ctx = ctx;
    this.sequencer = new WebAudioSequencer(ctx, { bpm });
    this.sequencer.onStep((_step, time) => this.advance(time));
    this._listeners = new Set();
    this._next = 0;
    /** Position of the most recent tick ({ tick, step, bar, beat, downbeat, time, dur, bpm }), or null before the first. */
    this.current = null;
  }

  /** Subscribe to ticks. Returns an unsubscribe function. */
  onTick(cb) {
    this._listeners.add(cb);
    return () => this._listeners.delete(cb);
  }

  /** Emit the next tick at `time` (called by the sequencer; callable directly for offline work). */
  advance(time) {
    const pos = { ...positionAt(this._next++), time, dur: this.stepDurationSec(), bpm: this.bpm };
    this.current = pos;
    for (const cb of this._listeners) cb(pos);
    return pos;
  }

  /** Back to tick 0 without starting (e.g. offline rendering). */
  rewind() {
    this._next = 0;
    this.current = null;
  }

  // ---- sequencer-like surface ----

  get bpm() {
    return this.sequencer.bpm;
  }

  set bpm(v) {
    this.sequencer.bpm = v;
  }

  stepDurationSec() {
    return this.sequencer.stepDurationSec();
  }

  /** Start from the top (tick 0). */
  start() {
    this.rewind();
    this.sequencer.start();
    return this;
  }

  stop() {
    this.sequencer.stop();
    return this;
  }

  get running() {
    return this.sequencer.running;
  }

  /** Compatibility with code that registers sequencer callbacks: cb(step, time). */
  onStep(cb) {
    this.onTick((p) => cb(p.step, p.time));
    return this;
  }
}

export default Clock;
