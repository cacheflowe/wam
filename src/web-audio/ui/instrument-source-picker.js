/**
 * <wam-instrument-source-picker> — dynamically-updating instrument bus dropdown.
 *
 * Listens for `instrument-bus-update` events dispatched by the playground and
 * keeps its <select> in sync with the current instrument list.
 *
 * Attributes:
 *   none-label  — Text for the "none / off" option (default: "— None —")
 *
 * Properties:
 *   value      — instanceId of the selected instrument, or null
 *   tapNode    — GainNode tap for the selected instrument, or null
 *   excludeId  — instanceId to hide from the list (e.g. the host track itself), or null
 *
 * Events:
 *   source-change  { instanceId: number|null, tapNode: GainNode|null }  bubbles
 */
export default class InstrumentSourcePicker extends HTMLElement {
  connectedCallback() {
    this._bus = null;
    this._onBusUpdate = (e) => this._updateOptions(e.detail.bus);
    document.addEventListener("instrument-bus-update", this._onBusUpdate);
    this._render();
    // Seed from current playground state if available
    const playground = this.closest("playground-app");
    if (playground?.instrumentBus) this._updateOptions(playground.instrumentBus);
  }

  disconnectedCallback() {
    document.removeEventListener("instrument-bus-update", this._onBusUpdate);
  }

  _render() {
    this.innerHTML = "";
    this._select = document.createElement("select");
    this._select.className = "wam-select";
    const none = document.createElement("option");
    none.value = "";
    none.textContent = this.getAttribute("none-label") ?? "— None —";
    this._select.appendChild(none);
    this._select.addEventListener("change", () => {
      this.dispatchEvent(
        new CustomEvent("source-change", {
          bubbles: true,
          detail: { instanceId: this.value, tapNode: this.tapNode },
        }),
      );
    });
    this.appendChild(this._select);
  }

  _updateOptions(bus) {
    this._bus = bus;
    if (!this._select) return;
    const prev = this._select.value;
    while (this._select.options.length > 1) this._select.remove(1);
    for (const [id, { label }] of bus) {
      if (this._excludeId != null && id === this._excludeId) continue;
      const opt = document.createElement("option");
      opt.value = String(id);
      opt.textContent = label;
      this._select.appendChild(opt);
    }
    this._select.value = prev;
    // If the previously-selected instrument was removed, reset and notify
    if (this._select.value !== prev && prev !== "") {
      this._select.value = "";
      this.dispatchEvent(
        new CustomEvent("source-change", {
          bubbles: true,
          detail: { instanceId: null, tapNode: null },
        }),
      );
    }
  }

  get value() {
    const v = this._select?.value;
    return v ? parseInt(v, 10) : null;
  }

  set value(instanceId) {
    if (this._select) this._select.value = instanceId == null ? "" : String(instanceId);
  }

  get tapNode() {
    const id = this.value;
    return id != null ? (this._bus?.get(id)?.tapNode ?? null) : null;
  }

  /** Hide a given instanceId from the list (e.g. the host track, to prevent self-feedback). */
  get excludeId() {
    return this._excludeId ?? null;
  }

  set excludeId(id) {
    this._excludeId = id == null ? null : typeof id === "string" ? parseInt(id, 10) : id;
    if (this._bus) this._updateOptions(this._bus);
  }
}

customElements.define("wam-instrument-source-picker", InstrumentSourcePicker);
