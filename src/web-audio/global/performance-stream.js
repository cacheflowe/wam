/**
 * PerformanceStream — broadcasts what the music is doing, for external
 * visualizers (TouchDesigner, p5.js, a second browser…) over AppStore.
 *
 * Keys (see docs/references/performance-stream.md for the wire contract):
 *   trigger           one message per played note         (high rate, not echoed)
 *   transport.beat    one message per 16th-note tick      (high rate, not echoed)
 *   instruments.list  slot → instrument / name / color    (low rate, persisted)
 *
 * Timing: the sequencer schedules audio ~100ms ahead. Notes are held until
 * their AudioContext time (plus the device's output latency) so visuals land
 * with the sound, not before it. Chrome doesn't throttle timers in a tab that
 * is playing audio, so this holds up even when the wam tab is in the background.
 *
 * Works with any AppStore on the page (window._store by default), using only
 * its public API: local AppStore → set(); AppStoreDistributed →
 * set(key, value, true, null, sendOnly). High-rate keys are sendOnly (the server
 * relays them to everyone except us) and are also set() locally so in-page
 * listeners see them.
 *
 * No DOM and no oversite import — the store is duck-typed.
 */

import { StoreKeys } from "./store-keys.js";

export const STREAM_KEYS = Object.freeze({
  TRIGGER: StoreKeys.TRIGGER,
  BEAT: StoreKeys.TRANSPORT_BEAT,
  INSTRUMENTS: StoreKeys.INSTRUMENTS_LIST,
});

export class PerformanceStream {
  /**
   * @param {object} [o]
   * @param {() => object|null} [o.getStore]     defaults to window._store
   * @param {() => boolean} [o.canPublish]       e.g. only the "host" role publishes
   * @param {(fn: Function, ms: number) => any} [o.setTimer]
   */
  constructor({
    getStore = () => globalThis._store ?? null,
    canPublish = () => true,
    setTimer = (fn, ms) => setTimeout(fn, ms),
  } = {}) {
    this._getStore = getStore;
    this._canPublish = canPublish;
    this._setTimer = setTimer;
    this._ctx = null;
    this.enabled = true;
    /** Keys switched off individually (e.g. from the Sync drawer). */
    this.disabledKeys = new Set();
    /** Extra visual delay (ms), + or −, to line visuals up with what you hear. */
    this.offsetMs = 0;
  }

  /** AudioContext used to convert scheduled audio times into wall-clock delays. */
  setContext(ctx) {
    this._ctx = ctx;
  }

  /** ms from now until `audioTime` is audible. 0 when unknown or already past. */
  delayFor(audioTime) {
    const ctx = this._ctx;
    if (!ctx || typeof audioTime !== "number") return Math.max(0, this.offsetMs);
    const latency = (ctx.outputLatency || ctx.baseLatency || 0) * 1000;
    return Math.max(0, (audioTime - ctx.currentTime) * 1000 + latency + this.offsetMs);
  }

  /** Turn one stream key on/off. */
  setKeyEnabled(key, on) {
    if (on) this.disabledKeys.delete(key);
    else this.disabledKeys.add(key);
  }

  /** Publish a note at the moment it's heard. */
  note(payload, audioTime) {
    if (this.disabledKeys.has(STREAM_KEYS.TRIGGER)) return;
    this._at(audioTime, () => this.publish(STREAM_KEYS.TRIGGER, payload, { sendOnly: true }));
  }

  /** Publish a 16th-note tick at the moment it's heard. */
  beat(payload, audioTime) {
    if (this.disabledKeys.has(STREAM_KEYS.BEAT)) return;
    this._at(audioTime, () => this.publish(STREAM_KEYS.BEAT, payload, { sendOnly: true }));
  }

  /** Publish the slot → instrument table (persisted, so late joiners get it). */
  instruments(list) {
    if (this.disabledKeys.has(STREAM_KEYS.INSTRUMENTS)) return;
    this.publish(STREAM_KEYS.INSTRUMENTS, list, { sendOnly: false });
  }

  _at(audioTime, fn) {
    if (!this.enabled || !this._canPublish()) return;
    const ms = this.delayFor(audioTime);
    if (ms <= 1) fn();
    else this._setTimer(fn, ms);
  }

  /**
   * Send one key through the store's own API.
   * - Local AppStore: set(key, value) — in-page listeners get it.
   * - AppStoreDistributed: set(key, value, true, null, sendOnly). High-rate keys
   *   are sendOnly (relayed to everyone but us), so we also set() them locally
   *   for in-page listeners; persisted keys come back to us via the echo.
   */
  publish(key, value, { sendOnly = false } = {}) {
    const store = this._getStore();
    if (!store || !this.enabled || !this._canPublish()) return;
    const distributed = typeof store.isConnected === "function";
    if (!distributed) {
      store.set(key, value);
      return;
    }
    store.set(key, value, true, null, sendOnly);
    if (sendOnly) store.set(key, value); // broadcast=false → local listeners only
  }
}

/** Shared singleton for the app. */
export const performanceStream = new PerformanceStream({
  // Only the host (default role) publishes; control/jam/observer clients would duplicate notes.
  canPublish: () => (globalThis._syncRole ?? "host") === "host",
});
