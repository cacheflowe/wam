/**
 * <wam-sync-panel> — Sync drawer UI: Oversite server connection + what this
 * client shares over it. Drives syncManager (src/site/sync-manager.js);
 * stream switches take effect immediately via sync-bridge.js.
 */
import { syncManager, ROLES } from "./sync-manager.js";

const CSS = /* css */ `
  wam-sync-panel {
    display: flex; flex-direction: column; gap: .9rem; font-size: .82rem; color: #c8c8e0;
    /* Compact Pico form controls (Pico sizes inputs from these vars). */
    --pico-form-element-spacing-vertical: .3rem;
    --pico-form-element-spacing-horizontal: .5rem;
    --pico-spacing: .5rem;
  }
  wam-sync-panel fieldset { margin: 0; padding: .6rem .75rem .75rem; border: 1px solid #2a2a3a; border-radius: 6px; }
  wam-sync-panel legend { padding: 0 .3rem; font-size: .72rem; text-transform: uppercase; letter-spacing: .05em; opacity: .7; }
  wam-sync-panel label { display: flex; flex-direction: column; gap: .2rem; margin: 0; font-size: .75rem; }
  wam-sync-panel label.wam-sync-check { flex-direction: row; align-items: center; gap: .45rem; }
  wam-sync-panel input, wam-sync-panel select { margin: 0; font-size: .8rem; }
  wam-sync-panel input[type=checkbox] { flex: none; margin: 0; }
  .wam-sync-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: .5rem .75rem; }
  .wam-sync-grid .wam-sync-wide { grid-column: 1 / -1; }
  .wam-sync-status { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
  .wam-sync-dot { width: .65rem; height: .65rem; border-radius: 50%; background: #555; flex: none; }
  .wam-sync-dot[data-status=connected] { background: #3c9a4b; box-shadow: 0 0 6px #3c9a4b; }
  .wam-sync-dot[data-status=connecting] { background: #c9952a; animation: wam-sync-pulse 1s infinite alternate; }
  @keyframes wam-sync-pulse { to { opacity: .35; } }
  .wam-sync-muted { opacity: .6; font-size: .72rem; }
  .wam-sync-warn { color: #e6a23c; font-size: .75rem; margin: .25rem 0 0; }
  .wam-sync-row { display: flex; gap: .5rem; flex-wrap: wrap; align-items: center; margin-top: .6rem; }
  .wam-sync-row button { margin: 0; padding: .3rem .7rem; font-size: .78rem; width: auto; }
  wam-sync-panel code { font-size: .72rem; }
`;

let cssInjected = false;

export class WamSyncPanel extends HTMLElement {
  connectedCallback() {
    if (!cssInjected) {
      const style = document.createElement("style");
      style.textContent = CSS;
      document.head.appendChild(style);
      cssInjected = true;
    }
    this._build();
    this._onChange = () => this._refreshStatus();
    syncManager.addEventListener("change", this._onChange);
    this._refreshStatus();
  }

  disconnectedCallback() {
    syncManager.removeEventListener("change", this._onChange);
  }

  _build() {
    const s = syncManager.settings;
    const roleOptions = Object.entries(ROLES)
      .map(([v, label]) => `<option value="${v}" ${s.role === v ? "selected" : ""}>${label}</option>`)
      .join("");
    this.innerHTML = `
      <div class="wam-sync-status">
        <span class="wam-sync-dot"></span><b class="wam-sync-status-text"></b>
        <span class="wam-sync-muted wam-sync-sender"></span>
      </div>

      <fieldset>
        <legend>Oversite server</legend>
        <div class="wam-sync-grid">
          <label class="wam-sync-wide">Server URL <input name="url" type="text" spellcheck="false" placeholder="ws://localhost:3003/ws"></label>
          <label>Channel <input name="channel" type="text" spellcheck="false" placeholder="wam"></label>
          <label>This client's name <input name="name" type="text" spellcheck="false" placeholder="wam"></label>
          <label class="wam-sync-wide">Role <select name="role">${roleOptions}</select></label>
          <label class="wam-sync-wide">Auth key <span class="wam-sync-muted">(optional — if the server requires one)</span>
            <input name="authKey" type="password" autocomplete="off"></label>
        </div>
        <p class="wam-sync-warn" hidden></p>
        <div class="wam-sync-row">
          <button type="button" data-action="connect">Connect / Apply</button>
          <button type="button" data-action="disconnect" class="secondary">Disconnect</button>
          <button type="button" data-action="copy" class="secondary outline" title="Copy a link that opens the playground connected to this server/channel">Copy link for another client</button>
        </div>
        <p class="wam-sync-muted wam-sync-override" hidden>This tab was opened with <code>?sync=</code> URL params; changes you apply here are saved for future visits.</p>
      </fieldset>

      <fieldset>
        <legend>Share over the connection</legend>
        <label class="wam-sync-check"><input type="checkbox" name="syncTransport"> Transport — play/stop + BPM, both ways</label>
        <label class="wam-sync-check"><input type="checkbox" name="streamNotes"> Notes <code>trigger</code></label>
        <label class="wam-sync-check"><input type="checkbox" name="streamBeats"> Beats <code>transport.beat</code></label>
        <label class="wam-sync-check"><input type="checkbox" name="streamInstruments"> Instrument slots <code>instruments.list</code></label>
        <div class="wam-sync-grid" style="margin-top:.5rem">
          <label>Visual offset (ms) <input name="offsetMs" type="number" step="5"></label>
        </div>
        <p class="wam-sync-muted">Notes, beats and slots are published by the <b>Host</b> role only, timed to when the sound is heard.
          Wire format: <code>docs/references/performance-stream.md</code>.</p>
      </fieldset>`;

    const field = (n) => this.querySelector(`[name="${n}"]`);
    for (const n of ["url", "channel", "name", "authKey", "role"]) field(n).value = s[n] ?? "";
    for (const n of ["syncTransport", "streamNotes", "streamBeats", "streamInstruments"]) field(n).checked = !!s[n];
    field("offsetMs").value = s.offsetMs ?? 0;

    // Sharing options apply immediately.
    for (const n of ["syncTransport", "streamNotes", "streamBeats", "streamInstruments"]) {
      field(n).addEventListener("change", () => syncManager.update({ [n]: field(n).checked }));
    }
    field("offsetMs").addEventListener("change", () => syncManager.update({ offsetMs: Number(field("offsetMs").value) || 0 }));

    // Connection fields apply on Connect (avoid reconnecting per keystroke); warn as you type.
    const connPatch = () => ({
      url: field("url").value.trim(),
      channel: field("channel").value.trim() || "wam",
      name: field("name").value.trim() || "wam",
      role: field("role").value,
      authKey: field("authKey").value,
    });
    for (const n of ["url"]) field(n).addEventListener("input", () => this._showWarnings(connPatch().url));
    this.addEventListener("click", async (e) => {
      const action = e.target.closest("[data-action]")?.dataset.action;
      if (action === "connect") {
        const patch = { ...connPatch(), enabled: true };
        const unchanged = Object.entries(patch).every(([k, v]) => syncManager.settings[k] === v);
        if (unchanged) syncManager.reconnect(); // same settings → force a fresh attempt
        else syncManager.update(patch);
      } else if (action === "disconnect") {
        syncManager.update({ enabled: false });
      } else if (action === "copy") {
        const link = syncManager.shareLink(syncManager.settings.role === "host" ? "control" : syncManager.settings.role);
        try {
          await navigator.clipboard.writeText(link);
          e.target.textContent = "Copied ✓";
        } catch {
          prompt("Copy this link:", link);
        }
        setTimeout(() => (e.target.textContent = "Copy link for another client"), 1500);
      }
    });
    this.querySelector(".wam-sync-override").hidden = !syncManager.sessionOverride;
    this._showWarnings(s.url);
  }

  _showWarnings(url) {
    const prev = syncManager.settings.url;
    syncManager.settings.url = url; // evaluate warnings for the typed URL without applying it
    const warnings = syncManager.warnings;
    syncManager.settings.url = prev;
    const el = this.querySelector(".wam-sync-warn");
    el.hidden = !warnings.length;
    el.textContent = warnings.join(" ");
  }

  _refreshStatus() {
    const status = syncManager.status;
    const s = syncManager.settings;
    this.querySelector(".wam-sync-dot").dataset.status = status;
    this.querySelector(".wam-sync-status-text").textContent =
      status === "connected"
        ? `Connected — ${s.url} · channel “${s.channel}” · ${s.role}`
        : status === "connecting"
          ? `Connecting to ${s.url}… (retries every 5 s)`
          : "Not connected — local only";
    this.querySelector(".wam-sync-sender").textContent = syncManager.senderId ? `as ${syncManager.senderId}` : "";
  }
}

customElements.define("wam-sync-panel", WamSyncPanel);
