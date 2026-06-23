import "../web-audio/ui/midi-input-picker.js";
import {
  CONTROLS,
  LED,
  LED_RAMP,
  allLedsOnMessage,
  bindingFor,
  findControl,
  ledColorByPercent,
  resetMessage,
  templateChannel,
  templateFromChannel,
} from "../web-audio/midi/launch-control-xl.js";
import MidiOutput from "../web-audio/midi/midi-output.js";

const GROUPS = [
  { id: "knobsRow1", label: "Send A" },
  { id: "knobsRow2", label: "Send B" },
  { id: "knobsRow3", label: "Pan / Device" },
  { id: "sliders", label: "Faders" },
  { id: "buttonsRow1", label: "Track Focus" },
  { id: "buttonsRow2", label: "Track Control" },
];

class LaunchControlXlApp extends HTMLElement {
  connectedCallback() {
    this._midiOut = new MidiOutput(); // batched, port-safe LED output
    this._midiAccess = null;
    this._elById = new Map(); // control id → on-screen element
    this._clearTimers = new Map();

    this.buildUI();
    this.addCSS();

    this._onMidi = (e) => this._handleMidi(e.detail);
    document.addEventListener("wam-midi-message", this._onMidi);
  }

  disconnectedCallback() {
    document.removeEventListener("wam-midi-message", this._onMidi);
    if (this._midiAccess && this._onStateChange) {
      this._midiAccess.removeEventListener("statechange", this._onStateChange);
    }
    this._midiOut.dispose();
    for (const t of this._clearTimers.values()) clearTimeout(t);
  }

  // ---- Incoming MIDI → highlight the matching control ----

  _handleMidi(message) {
    // The channel a control transmits on tells us which template the device is
    // currently displaying. LEDs only appear on the displayed template, so
    // follow the device instead of hardcoding one (see templateFromChannel).
    const detected = templateFromChannel(message.channel);
    if (detected != null) this._setTemplate(detected, true);

    const control = findControl(message.binding);
    this._lastEl.textContent = control
      ? `${control.id}  ·  ${message.type === "cc" ? `CC ${message.controller} = ${message.value}` : `note ${message.note} vel ${message.velocity}`}  ·  ch ${message.channel}`
      : `unmapped: ${JSON.stringify(message.binding)}`;
    if (!control) return;
    const el = this._elById.get(control.id);
    if (!el) return;

    const value = message.type === "cc" ? message.value : message.velocity;
    const norm = value / 127;
    el.classList.add("lc-hit");
    el.style.setProperty("--lc-fill", `${Math.round(norm * 100)}%`);
    const valEl = el.querySelector(".lc-val");
    if (valEl) valEl.textContent = value;

    clearTimeout(this._clearTimers.get(control.id));
    this._clearTimers.set(
      control.id,
      setTimeout(() => el.classList.remove("lc-hit"), 180),
    );

    // Echo to the device LED so the controller lights up as you move it.
    // MidiOutput handles dedupe + per-frame batching so a knob sweep can't
    // flood the port (see docs/RELIABILITY.md #7).
    if (control.ledIndex != null) this._midiOut.queueControlLed(control.id, ledColorByPercent(norm));
  }

  get _template() {
    return this._midiOut.template;
  }

  _setTemplate(template, fromDevice = false) {
    if (template === this._midiOut.template) return;
    this._midiOut.setTemplate(template);
    if (this._templateEl) {
      this._templateEl.textContent = `${template} (ch ${templateChannel(template)})${fromDevice ? " · auto-detected" : ""}`;
    }
    if (this._templateSelect && this._templateSelect.value !== String(template)) {
      this._templateSelect.value = String(template);
    }
  }

  // ---- Outgoing MIDI (LED feedback) — commands route through MidiOutput ----

  _ledTest() {
    this._withOutput(() => {
      if (this._midiOut.send(allLedsOnMessage(3, this._template))) this._setOutStatus("LED test → all on.");
    });
  }

  _reset() {
    this._withOutput(() => {
      if (this._midiOut.send(resetMessage(this._template))) {
        this._midiOut.invalidate(); // device cleared its LEDs; allow full repaint
        this._setOutStatus("Reset → all LEDs off.");
      }
    });
  }

  _rainbow() {
    this._withOutput(() => {
      const pairs = CONTROLS.filter((c) => c.ledIndex != null).map((c, i) => [
        c.ledIndex,
        LED_RAMP[i % LED_RAMP.length],
      ]);
      if (this._midiOut.setLedsNow(pairs)) this._setOutStatus(`Rainbow → ${pairs.length} LEDs.`);
    });
  }

  _setOutStatus(text) {
    if (this._outStatus) this._outStatus.textContent = text;
  }

  // Reuse the single sysex-enabled MIDIAccess owned by the input picker rather
  // than requesting our own. Two MIDIAccess objects over the same ports breaks
  // input on Windows (output keeps working, input goes dead).
  async _ensureAccess() {
    if (this._midiAccess) return this._midiAccess;
    if (!this._picker) {
      this._setOutStatus("MIDI picker not ready.");
      return null;
    }
    this._setOutStatus("Requesting MIDI (sysex) permission…");
    const access = await this._picker.requestAccess();
    if (!access) {
      this._setOutStatus("MIDI access was blocked. Sysex permission is required to light LEDs.");
      return null;
    }
    this._adoptAccess(access);
    return access;
  }

  _adoptAccess(access) {
    if (this._midiAccess === access) return;
    this._midiAccess = access;
    // addEventListener (not onstatechange=) so we don't clobber the picker's
    // own statechange handler on this shared access.
    this._onStateChange = () => this._refreshOutputs();
    access.addEventListener("statechange", this._onStateChange);
    const outNames = [...access.outputs.values()].map((o) => o.name);
    console.debug(`[LCXL] Using picker MIDI access. sysexEnabled=${access.sysexEnabled}. Outputs:`, outNames);
    this._refreshOutputs();
  }

  _refreshOutputs() {
    if (!this._midiAccess) return;
    const outputs = [...this._midiAccess.outputs.values()];
    const current = this._midiOut.output?.id ?? "";
    this._outSelect.disabled = false;
    this._outSelect.innerHTML = `<option value="">No LED output</option>`;
    for (const out of outputs) {
      const opt = document.createElement("option");
      opt.value = out.id;
      opt.textContent = out.name || out.id;
      this._outSelect.appendChild(opt);
    }
    // Auto-select a Launch Control output. On Windows the LED port is usually
    // the secondary "MIDIOUT2 (Launch Control XL)" port, so prefer a numbered
    // one when several Launch Control ports exist.
    const lc = outputs.filter((o) => /launch control/i.test(o.name || ""));
    const auto = lc.find((o) => /\b(2|4|MIDIOUT)\b/i.test(o.name || "")) || lc[0];
    const wanted = current || auto?.id || "";
    this._outSelect.value = wanted;
    this._midiOut.setOutput(wanted ? this._midiAccess.outputs.get(wanted) : null);
    this._setOutStatus(
      outputs.length
        ? `${outputs.length} output${outputs.length > 1 ? "s" : ""}: ${outputs.map((o) => o.name).join(", ")} · LEDs → ${this._midiOut.output?.name || "none selected"}`
        : "No MIDI outputs found. Is the device connected?",
    );
  }

  // Make sure we have access (and an output) before sending an LED command.
  async _withOutput(action) {
    await this._ensureAccess();
    if (!this._midiOut.output) {
      this._setOutStatus("Select a MIDI output to light LEDs.");
      return;
    }
    action();
  }

  // ---- UI ----

  buildUI() {
    this.innerHTML = /* html */ `
      <div class="lc-layout">
        <header class="lc-header">
          <h2>🎛 Launch Control XL — MIDI Map Tester</h2>
          <div class="lc-toolbar">
            <wam-midi-input-picker sysex data-log="off"></wam-midi-input-picker>
            <button class="lc-btn" id="enableOut">Enable LED output</button>
            <label class="lc-out">
              <span>LED out</span>
              <select id="outSelect" class="lc-select" disabled><option value="">Not enabled</option></select>
            </label>
            <label class="lc-out">
              <span>Template</span>
              <select id="templateSelect" class="lc-select">
                ${Array.from({ length: 16 }, (_, t) => `<option value="${t}"${t === this._template ? " selected" : ""}>${t < 8 ? `User ${t + 1}` : `Factory ${t - 7}`} (ch ${t + 1})</option>`).join("")}
              </select>
            </label>
            <button class="lc-btn" id="ledTest">LED test</button>
            <button class="lc-btn" id="rainbow">Rainbow</button>
            <button class="lc-btn" id="reset">Reset</button>
          </div>
          <div class="lc-out-status" id="outStatus">LED output not enabled — click “Enable LED output” (asks for sysex permission).</div>
        </header>

        <p class="lc-status">
          Template <strong id="templateNow">${this._template} (ch ${templateChannel(this._template)})</strong>.
          LEDs only show on the template the device is <em>currently displaying</em> — move any control and this auto-syncs to it.
          <span class="lc-last" id="lastMsg">Waiting for MIDI…</span>
        </p>

        <div class="lc-device" id="device"></div>
      </div>
    `;

    this._lastEl = this.querySelector("#lastMsg");
    this._outSelect = this.querySelector("#outSelect");
    this._outStatus = this.querySelector("#outStatus");
    this._templateEl = this.querySelector("#templateNow");
    this._templateSelect = this.querySelector("#templateSelect");
    this._picker = this.querySelector("wam-midi-input-picker");

    // The picker owns the single MIDIAccess; adopt it whenever it's granted
    // (whether the user enabled input or clicked "Enable LED output").
    this.addEventListener("midi-access-ready", (e) => this._adoptAccess(e.detail.access));
    if (this._picker.midiAccess) this._adoptAccess(this._picker.midiAccess);

    this.querySelector("#enableOut").addEventListener("click", () => this._ensureAccess());
    this._templateSelect.addEventListener("change", () => this._setTemplate(parseInt(this._templateSelect.value, 10), false));
    this._outSelect.addEventListener("change", () => {
      this._midiOut.setOutput(this._outSelect.value ? this._midiAccess?.outputs.get(this._outSelect.value) : null);
      this._setOutStatus(`LEDs → ${this._midiOut.output?.name || "none selected"}`);
    });
    this.querySelector("#ledTest").addEventListener("click", () => this._ledTest());
    this.querySelector("#rainbow").addEventListener("click", () => this._rainbow());
    this.querySelector("#reset").addEventListener("click", () => this._reset());

    this._buildDevice();
  }

  _buildDevice() {
    const device = this.querySelector("#device");
    for (const group of GROUPS) {
      const controls = CONTROLS.filter((c) => c.group === group.id);
      const row = document.createElement("div");
      row.className = `lc-row lc-row-${controls[0].kind}`;
      row.innerHTML = `<div class="lc-row-label">${group.label}</div>`;
      const grid = document.createElement("div");
      grid.className = "lc-grid";
      for (const control of controls) grid.appendChild(this._buildControl(control));
      row.appendChild(grid);
      device.appendChild(row);
    }

    // Side + arrow buttons in their own footer row.
    const extras = CONTROLS.filter((c) => c.group === "buttonsSide" || c.group === "buttonsArrows");
    const row = document.createElement("div");
    row.className = "lc-row lc-row-extra";
    row.innerHTML = `<div class="lc-row-label">Side / Arrows</div>`;
    const grid = document.createElement("div");
    grid.className = "lc-grid lc-grid-extra";
    for (const control of extras) grid.appendChild(this._buildControl(control));
    row.appendChild(grid);
    device.appendChild(row);
  }

  _buildControl(control) {
    const el = document.createElement("div");
    el.className = `lc-ctrl lc-${control.kind}`;
    const binding = bindingFor(control, this._template);
    const tag = binding.type === "cc" ? `CC${binding.controller}` : `N${binding.note}`;
    el.title = `${control.id} · ${tag} · ch${binding.channel}`;
    el.innerHTML = /* html */ `
      <div class="lc-cap"></div>
      <div class="lc-meta">
        <span class="lc-id">${control.id}</span>
        <span class="lc-tag">${tag}</span>
        <span class="lc-val">–</span>
      </div>
    `;
    // Clicking an on-screen button lights its LED on the device (manual test).
    if (control.kind === "button" && control.ledIndex != null) {
      el.addEventListener("click", () => this._midiOut.queueControlLed(control.id, LED.GREEN_FULL));
    }
    this._elById.set(control.id, el);
    return el;
  }

  addCSS() {
    if (document.getElementById("lc-xl-style")) return;
    const s = document.createElement("style");
    s.id = "lc-xl-style";
    s.textContent = /* css */ `
      launch-control-xl-app {
        display: block;
        font-family: ui-monospace, Menlo, Consolas, monospace;
        background: #0a0a12;
        color: #c8c8e0;
        min-height: 100vh;
        padding: 1rem;
        text-align: left;
      }
      .lc-layout { max-width: 1000px; margin: 0 auto; }
      .lc-header {
        display: flex; flex-wrap: wrap; align-items: center; gap: 1rem;
        border-bottom: 1px solid #1e1e2e; padding-bottom: 0.75rem; margin-bottom: 0.75rem;
      }
      .lc-header h2 { margin: 0; font-size: 1.2rem; color: #9b8dff; flex: 1 1 100%; }
      .lc-toolbar { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
      .lc-out { display: flex; flex-direction: column; font-size: 0.6rem; color: #777; gap: 2px; }
      .lc-out-status { flex: 1 1 100%; font-size: 0.68rem; color: #c89b6c; margin-top: 4px; }
      .lc-select, .lc-btn {
        font-family: inherit; font-size: 0.75rem; padding: 5px 10px;
        border: 1px solid #333; border-radius: 4px; background: #111122; color: #c8c8e0; cursor: pointer;
      }
      .lc-btn:hover { background: #1e1e3a; border-color: #9b8dff; }
      .lc-status { font-size: 0.75rem; color: #888; margin: 0 0 1rem; }
      .lc-status strong { color: #9b8dff; }
      .lc-last { display: block; margin-top: 4px; color: #6cf; }

      .lc-device {
        display: flex; flex-direction: column; gap: 0.6rem;
        background: #0d0d1a; border: 1px solid #1e1e2e; border-radius: 8px; padding: 1rem;
      }
      .lc-row { display: grid; grid-template-columns: 90px 1fr; align-items: center; gap: 0.75rem; }
      .lc-row-label {
        font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.08em; color: #666; text-align: right;
      }
      .lc-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 0.5rem; }
      .lc-grid-extra { grid-template-columns: repeat(8, 1fr); }

      .lc-ctrl {
        --lc-fill: 0%;
        background: #12121e; border: 1px solid #24243a; border-radius: 5px;
        padding: 5px; display: flex; flex-direction: column; align-items: center; gap: 3px;
        transition: border-color 0.12s, box-shadow 0.12s;
      }
      .lc-ctrl.lc-hit { border-color: #9b8dff; box-shadow: 0 0 10px rgba(155, 141, 255, 0.6); }

      .lc-cap { width: 100%; border-radius: 3px; position: relative; overflow: hidden; background: #07070f; }
      .lc-knob .lc-cap { height: 30px; border-radius: 50%; width: 30px; align-self: center; }
      .lc-fader .lc-cap { height: 46px; }
      .lc-button .lc-cap { height: 16px; }
      .lc-cap::after {
        content: ""; position: absolute; left: 0; right: 0; bottom: 0;
        height: var(--lc-fill); background: linear-gradient(0deg, #6cf, #9b8dff);
        transition: height 0.08s;
      }
      .lc-knob .lc-cap::after { border-radius: 0; }

      .lc-meta { display: flex; flex-direction: column; align-items: center; line-height: 1.2; }
      .lc-id { font-size: 0.6rem; color: #aaa; }
      .lc-tag { font-size: 0.55rem; color: #5a5a7a; }
      .lc-val { font-size: 0.65rem; color: #6cf; min-height: 0.8em; }

      wam-midi-input-picker { min-width: 150px; }

      @media (max-width: 720px) {
        .lc-row { grid-template-columns: 1fr; }
        .lc-row-label { text-align: left; }
      }
    `;
    document.head.appendChild(s);
  }
}

customElements.define("launch-control-xl-app", LaunchControlXlApp);
