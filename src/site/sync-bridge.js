/**
 * Sync bridge — connects playground behavior to the shared store according to
 * the Sync drawer settings (see sync-manager.js).
 *
 * - Transport sync (opt-in): play/stop + BPM, both ways. Local changes are
 *   broadcast; remote changes are applied to <wam-transport>. Echoes of our
 *   own messages and re-broadcasts of applied remote values are suppressed,
 *   so clients never ping-pong. Observers only listen.
 * - Performance stream switches: which keys (notes / beats / instrument list)
 *   are published, and the visual timing offset.
 *
 * Registered once as a store listener; SyncManager carries it across reconnects.
 */
import { StoreKeys } from "../web-audio/global/store-keys.js";
import { performanceStream, STREAM_KEYS } from "../web-audio/global/performance-stream.js";
import { syncManager } from "./sync-manager.js";

const TRANSPORT_KEYS = new Set([StoreKeys.TRANSPORT_PLAYING, StoreKeys.TRANSPORT_BPM]);

export class TransportSync {
  constructor(transport, manager = syncManager) {
    this._transport = transport;
    this._m = manager;
    this._applying = false;
    this._last = {}; // last value sent or applied per key — never re-send it
  }

  get active() {
    const s = this._m.settings;
    return s.enabled && s.syncTransport;
  }

  /** AppStore general listener. */
  storeUpdated(key, value) {
    if (!TRANSPORT_KEYS.has(key) || !this.active) return;
    const m = this._m;
    // Remote = a new inbound message from another client (our own echoes aren't).
    if (m.isRemote(key)) {
      this._last[key] = value;
      this._applying = true;
      try {
        this._applyRemote(key, value);
      } finally {
        this._applying = false;
      }
      return;
    }
    // A local change (the transport always set()s its keys locally), or the echo
    // of our own broadcast — `_last` makes the echo a no-op.
    if (this._applying || m.role === "observer" || this._last[key] === value) return;
    this._last[key] = value;
    window._store?.set(key, value, true);
  }

  _applyRemote(key, value) {
    const t = this._transport;
    if (!t) return;
    if (key === StoreKeys.TRANSPORT_PLAYING) {
      if (!!value !== !!t.playing) value ? t.play() : t.stop();
    } else if (key === StoreKeys.TRANSPORT_BPM) {
      const bpm = Number(value);
      if (Number.isFinite(bpm) && Math.abs(bpm - t.bpm) > 1e-3) t.bpm = bpm;
    }
  }
}

/** Push the Sync drawer's stream settings into the performance stream. */
export function applyStreamSettings(settings = syncManager.settings) {
  performanceStream.setKeyEnabled(STREAM_KEYS.TRIGGER, settings.streamNotes);
  performanceStream.setKeyEnabled(STREAM_KEYS.BEAT, settings.streamBeats);
  performanceStream.setKeyEnabled(STREAM_KEYS.INSTRUMENTS, settings.streamInstruments);
  performanceStream.offsetMs = Number(settings.offsetMs) || 0;
}

/**
 * Start the bridge for a playground transport. Returns a stop() function.
 * @param {HTMLElement} transport  <wam-transport>
 */
export function startSyncBridge(transport) {
  const transportSync = new TransportSync(transport);
  window._store?.addListener(transportSync);
  applyStreamSettings();
  const onChange = () => applyStreamSettings();
  syncManager.addEventListener("change", onChange);
  return () => {
    window._store?.removeListener(transportSync);
    syncManager.removeEventListener("change", onChange);
  };
}
