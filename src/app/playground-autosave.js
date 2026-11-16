/**
 * Playground autosave — keeps unsaved work safe across reloads.
 *
 * - PER-TAB saves: each tab writes `<prefix>:tab:<tabId>`; the tab id lives in
 *   sessionStorage, which survives a refresh. A refresh restores THAT tab's
 *   work, so another open tab (e.g. one receiving the same MIDI or sync
 *   messages) can never overwrite it. A new tab starts from the newest save.
 * - Flushes immediately when the page is hidden/unloaded (pagehide,
 *   visibilitychange) — no lost edits inside the debounce window.
 * - Never fails silently: serialization/storage errors are logged and
 *   reported via onStatus. On a full store, prunes old tab saves and retries.
 * - backup(): copy of the state about to be loaded, so a failed load can't
 *   destroy it.
 * - recent(): recent autosaves from any tab, for a "Recover" list.
 *
 * Migrates the legacy single-key save (`wam_playground_settings`) on first load.
 */

const LEGACY_KEY = "wam_playground_settings";
const KEEP_TABS = 6;

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

export class PlaygroundAutosave {
  /**
   * @param {object} o
   * @param {() => object} o.getState
   * @param {string} [o.prefix]
   * @param {number} [o.debounceMs]
   * @param {(status: {ok: boolean, savedAt?: number, error?: string}) => void} [o.onStatus]
   * @param {Storage} [o.storage]          localStorage (injectable for tests)
   * @param {Storage} [o.session]          sessionStorage
   * @param {EventTarget} [o.win]          window (pagehide/visibilitychange)
   */
  constructor({ getState, prefix = "wam_playground", debounceMs = 400, onStatus = () => {}, storage = globalThis.localStorage, session = globalThis.sessionStorage, win = globalThis.window } = {}) {
    this._getState = getState;
    this._prefix = prefix;
    this._debounceMs = debounceMs;
    this._onStatus = onStatus;
    this._ls = storage;
    this._ss = session;
    this._timer = null;
    this._pending = false;
    this.suspended = false; // true while a state is being applied — edits during load aren't saved
    this.tabId = this._initTabId();
    this._flush = () => this.flush();
    this._onVis = () => {
      if (globalThis.document?.visibilityState === "hidden") this.flush();
    };
    win?.addEventListener?.("pagehide", this._flush);
    win?.addEventListener?.("beforeunload", this._flush);
    globalThis.document?.addEventListener?.("visibilitychange", this._onVis);
  }

  _initTabId() {
    const key = `${this._prefix}:tabId`;
    try {
      let id = this._ss?.getItem(key);
      if (!id) {
        id = makeId();
        this._ss?.setItem(key, id);
      }
      return id;
    } catch {
      return makeId();
    }
  }

  get _key() {
    return `${this._prefix}:tab:${this.tabId}`;
  }

  /** Request a save (debounced). */
  schedule() {
    if (this.suspended) return;
    this._pending = true;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.save(), this._debounceMs);
  }

  /** Save now if a save is pending. */
  flush() {
    if (this._pending) this.save();
  }

  /** Serialize + write now. Returns true on success. */
  save() {
    clearTimeout(this._timer);
    this._pending = false;
    let json;
    try {
      json = JSON.stringify({ savedAt: Date.now(), tabId: this.tabId, state: this._getState() });
    } catch (err) {
      return this._fail("Couldn't serialize the song", err);
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        this._ls.setItem(this._key, json);
        this._onStatus({ ok: true, savedAt: Date.now() });
        return true;
      } catch (err) {
        if (attempt === 0 && this._isQuota(err)) {
          this._prune(1); // make room: drop all but the newest other-tab save, then retry
          continue;
        }
        return this._fail("Couldn't write to browser storage", err);
      }
    }
    return false;
  }

  _isQuota(err) {
    return err?.name === "QuotaExceededError" || err?.code === 22 || /quota/i.test(err?.message ?? "");
  }

  _fail(what, err) {
    console.error(`[WAM autosave] ${what}:`, err);
    this._onStatus({ ok: false, error: `${what}: ${err?.message ?? err}` });
    return false;
  }

  /** All tab saves, newest first: [{ key, tabId, savedAt, state }]. Skips unreadable entries. */
  _all() {
    const out = [];
    const prefix = `${this._prefix}:tab:`;
    for (let i = 0; i < (this._ls?.length ?? 0); i++) {
      const key = this._ls.key(i);
      if (!key?.startsWith(prefix)) continue;
      try {
        const rec = JSON.parse(this._ls.getItem(key));
        if (rec?.state) out.push({ key, tabId: rec.tabId ?? key.slice(prefix.length), savedAt: rec.savedAt ?? 0, state: rec.state });
      } catch {}
    }
    return out.sort((a, b) => b.savedAt - a.savedAt);
  }

  /** Keep this tab's save plus the newest `keep` others. */
  _prune(keep = KEEP_TABS) {
    const others = this._all().filter((r) => r.tabId !== this.tabId);
    for (const r of others.slice(keep)) {
      try {
        this._ls.removeItem(r.key);
      } catch {}
    }
  }

  /**
   * State to restore on startup: this tab's own save (refresh), else the
   * newest save from any tab (new tab), else the legacy single-key save.
   * @returns {{ state: object, source: "tab"|"newest"|"legacy" } | null}
   */
  load() {
    const all = this._all();
    const own = all.find((r) => r.tabId === this.tabId);
    if (own) return { state: own.state, source: "tab" };
    if (all.length) return { state: all[0].state, source: "newest" };
    try {
      const raw = this._ls.getItem(LEGACY_KEY);
      if (raw) return { state: JSON.parse(raw), source: "legacy" };
    } catch {}
    return null;
  }

  /** Recent autosaves (any tab), newest first, for a recovery list. */
  recent(limit = KEEP_TABS) {
    return this._all()
      .slice(0, limit)
      .map(({ tabId, savedAt, state }) => ({
        tabId,
        savedAt,
        thisTab: tabId === this.tabId,
        instruments: state.instruments?.length ?? 0,
        songName: state.songName ?? null,
        state,
      }));
  }

  /** Keep a copy of a state we're about to load, so a failed load can't lose it. */
  backup(state, label = "before-load") {
    try {
      this._ls.setItem(`${this._prefix}:backup`, JSON.stringify({ savedAt: Date.now(), label, state }));
    } catch (err) {
      console.warn("[WAM autosave] backup failed:", err);
    }
  }

  /** The last backup, if any. */
  loadBackup() {
    try {
      return JSON.parse(this._ls.getItem(`${this._prefix}:backup`) ?? "null");
    } catch {
      return null;
    }
  }

  /** Housekeeping after a successful startup load. */
  afterStartup() {
    this._prune();
  }
}
