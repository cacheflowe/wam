/**
 * SyncManager — owns the global AppStore (window._store) and its optional
 * connection to an Oversite server (AppStoreDistributed over WebSocket).
 *
 * - Settings persist in localStorage; `?sync=<ws-url>&channel=&role=&name=`
 *   URL params override them for the current session (handy for test tabs).
 * - connect()/disconnect() HOT-SWAP the store: every listener, named-key
 *   listener and state value moves to the new store, so components that
 *   subscribed at startup (transport bridge, performance-stream consumers,
 *   in-page sketches) keep working and the music never stops.
 * - Uses only AppStoreDistributed's public API (constructor, set/getData,
 *   isConnected, the appstore_connected/disconnected keys). Bridges tell remote
 *   updates from local ones with `isRemote(key)` (getData() holds the sender).
 *
 * Site-level (depends on oversite); the web-audio library never imports this.
 */
import AppStore from "oversite/src/app-store/app-store-.mjs";
import AppStoreDistributed from "oversite/src/app-store/app-store-distributed.mjs";

const STORAGE_KEY = "wam_sync_settings";

export const ROLES = Object.freeze({
  host: "Host — plays the audio, publishes notes/beats",
  control: "Control — remote control of a host",
  jam: "Jam — plays its own audio in sync with the session",
  observer: "Observer — listens only",
});

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: false,
  url: "ws://localhost:3003/ws",
  channel: "wam",
  role: "host",
  name: "wam",
  authKey: "",
  // What this client shares over the connection.
  syncTransport: false, // play/stop + BPM, both ways
  streamNotes: true, // `trigger`
  streamBeats: true, // `transport.beat`
  streamInstruments: true, // `instruments.list`
  offsetMs: 0, // visual timing nudge for the performance stream
});

const CONNECTION_KEYS = ["enabled", "url", "channel", "role", "name", "authKey"];

export class SyncManager extends EventTarget {
  constructor() {
    super();
    this.settings = { ...DEFAULT_SETTINGS };
    this._sessionOverride = false;
    this._seenData = {}; // key → last getData() object seen by isRemote()
  }

  /** Load settings (localStorage, then URL params) and create the store. Call once at startup. */
  init() {
    try {
      Object.assign(this.settings, JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"));
    } catch {}
    const params = new URLSearchParams(location.search);
    if (params.get("sync")) {
      this._sessionOverride = true;
      Object.assign(this.settings, {
        enabled: true,
        url: params.get("sync"),
        channel: params.get("channel") || this.settings.channel,
        role: params.get("role") || this.settings.role,
        name: params.get("name") || this.settings.name,
      });
    }
    this._apply();
    // Connection status via AppStoreDistributed's own keys. Registered once;
    // store swaps carry named listeners over.
    window._store.addListener(this, AppStoreDistributed.CONNECTED);
    window._store.addListener(this, AppStoreDistributed.DISCONNECTED);
    return this;
  }

  appstore_connected() {
    this._changed();
  }

  appstore_disconnected() {
    this._changed();
  }

  /** True when URL params (not saved settings) are in charge this session. */
  get sessionOverride() {
    return this._sessionOverride;
  }

  get store() {
    return window._store ?? null;
  }

  get role() {
    return this.settings.enabled ? this.settings.role : "host";
  }

  get senderId() {
    return this.store?.senderId ?? null;
  }

  get isDistributed() {
    return typeof this.store?.isConnected === "function";
  }

  /** "off" | "connecting" | "connected" */
  get status() {
    if (!this.isDistributed) return "off";
    return this.store.isConnected() ? "connected" : "connecting";
  }

  /**
   * Did the latest update of `key` arrive from another client over the socket?
   * AppStoreDistributed records every inbound message (with its sender) in
   * getData(key) before notifying listeners; local set()s don't touch it. Call
   * from inside a store listener. Our own echoes count as not remote.
   */
  isRemote(key) {
    const store = this.store;
    const data = typeof store?.getData === "function" ? store.getData(key) : null;
    if (!data || data === this._seenData[key]) return false; // no new inbound message → local set
    this._seenData[key] = data;
    return data.sender !== store.senderId;
  }

  /** Problems that will stop the connection before it starts (shown in the UI). */
  get warnings() {
    const out = [];
    let u = null;
    try {
      u = new URL(this.settings.url);
    } catch {
      return ["Server URL isn't a valid URL (e.g. ws://localhost:3003/ws)."];
    }
    if (!/^wss?:$/.test(u.protocol)) out.push("Server URL should start with ws:// or wss://.");
    const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname);
    if (location.protocol === "https:" && u.protocol === "ws:" && !local) {
      out.push("This page is https, so the browser will block an insecure ws:// connection to another host — use wss://.");
    }
    return out;
  }

  /** Merge + save settings; reconnect only if connection settings changed. */
  update(patch, { save = true } = {}) {
    const before = { ...this.settings };
    Object.assign(this.settings, patch);
    if (save) this.save();
    if (CONNECTION_KEYS.some((k) => before[k] !== this.settings[k])) this._apply();
    else this._changed();
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {}
  }

  /** Force a reconnect with the current settings. */
  reconnect() {
    this._apply();
  }

  /** A link that opens this page with the current connection settings (for another tab/machine). */
  shareLink(role = this.settings.role) {
    const u = new URL(location.href);
    u.searchParams.set("sync", this.settings.url);
    u.searchParams.set("channel", this.settings.channel);
    u.searchParams.set("role", role);
    return u.toString();
  }

  // ---- Store swap ----

  _apply() {
    const old = window._store ?? null;
    const s = this.settings;
    window._syncRole = this.role;
    let next;
    if (s.enabled && s.url) {
      const name = (s.name || "wam").replace(/[^\w-]/g, "_");
      const senderId = `${name}_${s.role}_${Math.random().toString(36).slice(2, 6)}`;
      next = new AppStoreDistributed(s.url, senderId, s.channel || "default", s.authKey || null);
    } else {
      next = new AppStore();
    }
    if (old) {
      // Carry subscriptions + state over to the new store.
      next.listeners.push(...old.listeners);
      for (const [key, objs] of Object.entries(old.methods)) (next.methods[key] ??= []).push(...objs);
      Object.assign(next.state, old.state);
      this._dispose(old);
    }
    window._store = next; // (the constructors also set this; be explicit)
    this._seenData = {};
    this._changed();
  }

  /**
   * Retire a replaced store. AppStoreDistributed has no dispose()/close() yet
   * (oversite gap — see tech-debt tracker); SolidSocket.dispose() stops its
   * reconnect loop and message handling, but the underlying WebSocket stays
   * open until the page unloads.
   */
  _dispose(store) {
    store?.solidSocket?.dispose?.();
  }

  _changed() {
    window._syncRole = this.role;
    this.dispatchEvent(new CustomEvent("change", { detail: { settings: { ...this.settings }, status: this.status } }));
  }
}

export const syncManager = new SyncManager();
