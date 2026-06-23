/**
 * <wam-midi-input-picker> - Web MIDI input selector and message normalizer.
 *
 * Owns MIDIAccess, keeps a device dropdown in sync, and dispatches normalized
 * MIDI messages at the document level so instrument controls can subscribe
 * without knowing about Web MIDI device plumbing.
 *
 * Events:
 *   midi-input-change  { inputId, inputName }  bubbles
 *   wam-midi-message   { type, channel, note/controller, velocity/value, binding } on document
 */
export function parseMidiMessage(data) {
  if (!data || data.length < 3) return null;
  const [status, data1, data2] = data;
  const command = status & 0xf0;
  const channel = (status & 0x0f) + 1;
  if (command === 0x90 && data2 > 0) {
    return { type: "note", channel, note: data1, velocity: data2, binding: { type: "note", channel, note: data1 } };
  }
  if (command === 0xb0) {
    return {
      type: "cc",
      channel,
      controller: data1,
      value: data2,
      binding: { type: "cc", channel, controller: data1 },
    };
  }
  return null;
}

export function midiBindingsEqual(a, b) {
  if (!a || !b || a.type !== b.type || a.channel !== b.channel) return false;
  if (a.type === "note") return a.note === b.note;
  if (a.type === "cc") return a.controller === b.controller;
  return false;
}

export function formatMidiBinding(binding) {
  if (!binding) return "";
  if (binding.type === "note") return `M${binding.note}`;
  if (binding.type === "cc") return `CC${binding.controller}`;
  return "";
}

export function formatMidiMessage(message) {
  if (!message) return "";
  if (message.type === "note") return `ch${message.channel} note ${message.note} vel ${message.velocity}`;
  if (message.type === "cc") return `ch${message.channel} cc ${message.controller} val ${message.value}`;
  return "";
}

export function formatMidiBytes(data) {
  if (!data) return "";
  return [...data].map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
}

let cssInjected = false;
function injectMidiPickerCSS() {
  if (cssInjected || typeof document === "undefined") return;
  cssInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    wam-midi-input-picker {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 116px;
    }
    wam-midi-input-picker .wam-midi-row {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    wam-midi-input-picker .wam-midi-row .wam-select {
      min-width: 0;
      flex: 1 1 auto;
    }
    wam-midi-input-picker .wam-midi-activity {
      width: 8px;
      height: 8px;
      flex: 0 0 8px;
      border-radius: 50%;
      background: #222;
      box-shadow: 0 0 0 1px #444 inset;
    }
    wam-midi-input-picker[data-midi-active] .wam-midi-activity {
      background: #6f6;
      box-shadow: 0 0 7px rgba(102, 255, 102, 0.95), 0 0 0 1px #9f9 inset;
    }
    wam-midi-input-picker .wam-midi-last {
      min-height: 11px;
      max-width: 150px;
      overflow: hidden;
      text-overflow: ellipsis;
      font: 10px/1.1 ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
      color: rgba(255, 255, 255, 0.85);
      white-space: nowrap;
    }
    wam-midi-input-picker .wam-midi-log {
      display: none;
      max-height: 48px;
      overflow: hidden;
      font: 10px/1.25 ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
      color: rgba(255, 255, 255, 0.75);
      white-space: nowrap;
      pointer-events: none;
    }
    wam-midi-input-picker[data-has-log] .wam-midi-log {
      display: block;
    }
    wam-midi-input-picker .wam-midi-log-line {
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `;
  document.head.appendChild(style);
}

export default class WamMidiInputPicker extends HTMLElement {
  static STORAGE_KEY = "wam:midi-input-id";

  connectedCallback() {
    injectMidiPickerCSS();
    this._access = null;
    this._input = null;
    this._activityTimer = null;
    this._logLines = [];
    this._requested = false;
    this._pendingValue = this._pendingValue ?? this._loadStoredValue();
    this._render();
    if (this._pendingValue) this._requestAccessSoon();
  }

  disconnectedCallback() {
    if (this._input) this._input.onmidimessage = null;
    if (this._access) this._access.onstatechange = null;
    if (this._activityTimer) clearTimeout(this._activityTimer);
  }

  _render() {
    this.innerHTML = "";
    const row = document.createElement("div");
    row.className = "wam-midi-row";
    this._select = document.createElement("select");
    this._select.className = "wam-select";
    this._select.title = "Select a MIDI input for jam learn.";
    this._select.addEventListener("pointerdown", () => this._requestAccess());
    this._select.addEventListener("focus", () => this._requestAccess());
    this._select.addEventListener("change", () => this._selectInput(this._select.value));
    row.appendChild(this._select);
    this._activityEl = document.createElement("span");
    this._activityEl.className = "wam-midi-activity";
    this._activityEl.title = "MIDI activity";
    row.appendChild(this._activityEl);
    this.appendChild(row);
    this._lastEl = document.createElement("div");
    this._lastEl.className = "wam-midi-last";
    this._lastEl.textContent = "No MIDI yet";
    this.appendChild(this._lastEl);
    this._logEl = document.createElement("div");
    this._logEl.className = "wam-midi-log";
    this._logEl.setAttribute("aria-live", "polite");
    this.appendChild(this._logEl);
    this._renderOptions();
    this._renderLog();
  }

  _renderOptions() {
    if (!this._select) return;
    this._select.innerHTML = "";

    const off = document.createElement("option");
    off.value = "";
    off.textContent = this._requested ? "MIDI Off" : "Enable MIDI";
    this._select.appendChild(off);

    if (typeof navigator === "undefined" || typeof navigator.requestMIDIAccess !== "function") {
      off.textContent = "MIDI Unavailable";
      this._select.disabled = true;
      return;
    }

    if (!this._access) {
      if (this._pendingValue) {
        const saved = document.createElement("option");
        saved.value = this._pendingValue;
        saved.textContent = `Saved: ${this._pendingValue}`;
        this._select.appendChild(saved);
      }
      this._select.value = "";
      if (this._pendingValue) this._select.value = this._pendingValue;
      return;
    }

    const inputs = [...this._access.inputs.values()].filter((input) => input.state !== "disconnected");
    for (const input of inputs) {
      const opt = document.createElement("option");
      opt.value = input.id;
      opt.textContent = input.name || input.id || "MIDI Input";
      this._select.appendChild(opt);
    }

    const nextValue = this._input?.id ?? this._pendingValue ?? inputs[0]?.id ?? "";
    this._select.value = [...this._select.options].some((opt) => opt.value === nextValue) ? nextValue : "";
    if (this._select.value && this._input?.id !== this._select.value) this._selectInput(this._select.value);
  }

  /** The active MIDIAccess once granted, or null. Lets consumers reuse this
   *  single access (e.g. to send to outputs) instead of requesting their own —
   *  two MIDIAccess objects fighting over the same ports breaks input on some
   *  platforms. Add a `sysex` attribute to request a sysex-enabled access. */
  get midiAccess() {
    return this._access;
  }

  /** Public trigger so consumers can prompt for access on a user gesture. */
  requestAccess() {
    return this._requestAccess();
  }

  _requestAccess() {
    if (this._access || this._requestPromise) return this._requestPromise;
    if (typeof navigator === "undefined" || typeof navigator.requestMIDIAccess !== "function") return null;
    this._requested = true;
    this._renderOptions();
    const options = this.hasAttribute("sysex") ? { sysex: true } : undefined;
    this._requestPromise = navigator
      .requestMIDIAccess(options)
      .then((access) => {
        this._access = access;
        this._access.onstatechange = () => this._renderOptions();
        this._renderOptions();
        this.dispatchEvent(new CustomEvent("midi-access-ready", { bubbles: true, detail: { access } }));
        return access;
      })
      .catch(() => {
        this._requested = false;
        this._requestPromise = null;
        this._renderOptions();
        return null;
      });
    return this._requestPromise;
  }

  _requestAccessSoon() {
    if (this._access || this._requestPromise) return;
    queueMicrotask(() => {
      if (!this.isConnected || this._access || this._requestPromise || !this._pendingValue) return;
      this._requestAccess();
    });
  }

  _selectInput(inputId) {
    this._pendingValue = inputId || null;
    this._storeValue(this._pendingValue);
    if (this._input) this._input.onmidimessage = null;
    this._input = inputId ? (this._access?.inputs.get(inputId) ?? null) : null;
    if (this._input) this._input.onmidimessage = (event) => this._handleMidiMessage(event);
    this.dispatchEvent(
      new CustomEvent("midi-input-change", {
        bubbles: true,
        detail: { inputId: this._input?.id ?? null, inputName: this._input?.name ?? null },
      }),
    );
  }

  _handleMidiMessage(event) {
    const message = parseMidiMessage(event.data);
    const label = message ? formatMidiMessage(message) : `raw ${formatMidiBytes(event.data)}`;
    this._showActivity(label);
    this._appendLog(label);
    if (message) document.dispatchEvent(new CustomEvent("wam-midi-message", { detail: message }));
  }

  _showActivity(label) {
    this.toggleAttribute("data-midi-active", true);
    if (this._lastEl) this._lastEl.textContent = label || "MIDI";
    if (this._activityTimer) clearTimeout(this._activityTimer);
    this._activityTimer = setTimeout(() => {
      this.toggleAttribute("data-midi-active", false);
      this._activityTimer = null;
    }, 140);
  }

  _appendLog(line) {
    if (this.getAttribute("data-log") === "off") return;
    this._logLines = [line, ...this._logLines].slice(0, 4);
    this._renderLog();
  }

  _renderLog() {
    if (!this._logEl) return;
    this.toggleAttribute("data-has-log", this._logLines.length > 0);
    this._logEl.innerHTML = "";
    for (const line of this._logLines) {
      const div = document.createElement("div");
      div.className = "wam-midi-log-line";
      div.textContent = line;
      this._logEl.appendChild(div);
    }
  }

  get value() {
    return this._input?.id ?? this._pendingValue ?? null;
  }

  set value(inputId) {
    this._pendingValue = inputId || null;
    this._storeValue(this._pendingValue);
    if (this._access) this._selectInput(this._pendingValue);
    if (this._select) this._select.value = inputId || "";
    if (this._pendingValue) this._requestAccessSoon();
  }

  _loadStoredValue() {
    try {
      return localStorage.getItem(WamMidiInputPicker.STORAGE_KEY) || null;
    } catch {
      return null;
    }
  }

  _storeValue(inputId) {
    try {
      if (inputId) localStorage.setItem(WamMidiInputPicker.STORAGE_KEY, inputId);
      else localStorage.removeItem(WamMidiInputPicker.STORAGE_KEY);
    } catch {
      // localStorage can be unavailable in private contexts.
    }
  }
}

customElements.define("wam-midi-input-picker", WamMidiInputPicker);
