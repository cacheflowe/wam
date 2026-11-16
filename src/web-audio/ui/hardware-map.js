/**
 * <wam-hardware-map> — on-screen mirror of the Launch Control XL layout.
 *
 * Renders PerformanceSurface state (`wam-hardware-state` events): current
 * button mode, the focused instrument's knob assignments for the current
 * page, fader → instrument slots (with soft-takeover status), and what each
 * of the 16 channel buttons does right now. Knobs show live values (a dial +
 * the value, moving as you turn the hardware or the on-screen control) and in
 * STEPS mode the buttons mirror the focused pattern + playhead like the LEDs.
 * It's interactive too — mode
 * chips, page arrows and the 16 buttons go through the same code paths as
 * the hardware, so PERFORM actions work without a device.
 *
 * Attributes:
 *   docked          — fixed to the bottom of the viewport, compact.
 *   layout="column" — fixed right-hand column: the device turned 90° (one row
 *                     per channel: knobs A/B/C + fader), buttons below, then
 *                     an Evolve strip (Energy + recent events).
 *
 * Usage: el.surface = performanceSurface;  (required for interaction)
 */
import { MODES } from "../midi/performance-surface.js";
import { COMMANDS, CONTROLS } from "../midi/launch-control-xl.js";
import { dispatchCommand } from "../input/input-bindings.js";

const KNOB_ROWS = [1, 2, 3].map((r) => CONTROLS.filter((c) => c.group === `knobsRow${r}`).map((c) => c.id));
const ROW_NAMES = ["Tone", "Envelope", "Movement"];
const MODE_INFO = [
  [MODES.STEPS, "Steps", "Mute", COMMANDS.MODE_STEPS],
  [MODES.MIXER, "Mixer", "Solo", COMMANDS.MODE_MIXER],
  [MODES.PERFORM, "Perform", "Rec Arm", COMMANDS.MODE_PERFORM],
];

const CSS = /* css */ `
  wam-hardware-map { display: block; font-size: 0.72rem; line-height: 1.3; color: #c8c8e0; }
  wam-hardware-map[docked] {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 50;
    background: rgba(13, 13, 20, 0.96); border-top: 1px solid #2a2a3a;
    padding: 6px 12px 8px; max-height: 45vh; overflow: auto;
  }
  .wam-hw-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; margin-bottom: 6px; }
  .wam-hw-title { font-weight: 600; color: #fff; }
  .wam-hw-chip {
    all: unset; cursor: pointer; padding: 1px 8px; border-radius: 10px;
    border: 1px solid #3a3a4a; color: #aaa; white-space: nowrap;
  }
  .wam-hw-chip[data-on] { background: #e6c229; border-color: #e6c229; color: #111; }
  .wam-hw-chip small { opacity: 0.6; margin-left: 4px; }
  .wam-hw-grid { display: grid; grid-template-columns: 64px repeat(8, minmax(0, 1fr)); gap: 3px; align-items: stretch; }
  .wam-hw-rowname { opacity: 0.55; align-self: center; text-transform: uppercase; font-size: 0.62rem; letter-spacing: .04em; }
  .wam-hw-cell {
    border: 1px solid #2a2a3a; border-radius: 4px; padding: 2px 4px; min-height: 1.5em;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: rgba(255,255,255,.02);
  }
  .wam-hw-cell[data-empty] { opacity: 0.3; }
  .wam-hw-knob { border-radius: 6px; display: flex; flex-direction: column; gap: 1px; padding: 2px 4px 3px; }
  .wam-hw-ktop { display: flex; align-items: center; gap: 4px; min-width: 0; }
  .wam-hw-klabel { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .wam-hw-kval { opacity: 0.7; font-size: 0.64rem; font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .wam-hw-dial { flex: none; width: 12px; height: 12px; border-radius: 50%;
    background: conic-gradient(from 225deg, var(--wam-hw-dial, #e6c229) calc(var(--v) * 270deg), #333 0 270deg, transparent 0); }
  .wam-hw-knob[data-choice] .wam-hw-dial { --wam-hw-dial: #6cf; }
  .wam-hw-btn { all: unset; cursor: pointer; border: 1px solid #2a2a3a; border-radius: 4px; padding: 2px 4px;
    min-height: 1.5em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center; }
  .wam-hw-btn:hover { border-color: #666; }
  .wam-hw-btn[data-empty] { opacity: 0.25; cursor: default; }
  .wam-hw-btn[data-lit="green"] { background: #1f5f2a; border-color: #3c9a4b; color: #fff; }
  .wam-hw-btn[data-lit="amber"] { background: #6a4d10; border-color: #c9952a; color: #fff; }
  .wam-hw-btn[data-lit="red"] { background: #5f1f1f; border-color: #a33; color: #fff; }
  .wam-hw-btn[data-lit="green-full"] { background: #3cb54f; border-color: #8f8; color: #111; }
  .wam-hw-btn[data-lit="red-low"] { background: #3a1818; border-color: #a33; color: #fff; }
  .wam-hw-fader { display: flex; flex-direction: column; gap: 2px; }
  .wam-hw-bar { height: 4px; background: #222; border-radius: 2px; overflow: hidden; }
  .wam-hw-bar > i { display: block; height: 100%; background: #6c8; }
  .wam-hw-fader[data-muted] .wam-hw-bar > i { background: #a44; }
  .wam-hw-fader[data-focused] { border-color: #c9952a; }
  .wam-hw-pickup { opacity: 0.55; font-size: 0.6rem; }
  .wam-hw-sep { height: 4px; }

  /* ---- layout="column": fixed right column, device turned 90° ---- */
  wam-hardware-map[layout="column"] {
    position: fixed; top: 0; right: 0; bottom: 0; z-index: 40;
    width: var(--wam-hw-column-width, 380px); box-sizing: border-box;
    background: rgba(13, 13, 20, 0.98); border-left: 1px solid #2a2a3a;
    padding: 10px 10px 16px; overflow-y: auto;
  }
  wam-hardware-map[layout="column"] .wam-hw-head { gap: 4px 6px; }
  wam-hardware-map[layout="column"] .wam-hw-chip small { display: none; }
  wam-hardware-map[layout="column"] .wam-hw-chip { padding: 1px 6px; }
  wam-hardware-map[layout="column"] .wam-hw-cell { padding: 2px 3px; }
  wam-hardware-map[layout="column"] .wam-hw-btn { padding: 2px 3px; font-size: 0.68rem; }
  .wam-hw-colgrid { display: grid; grid-template-columns: 16px repeat(4, minmax(0, 1fr)); gap: 3px; }
  .wam-hw-colhead { opacity: 0.55; text-transform: uppercase; font-size: 0.6rem; letter-spacing: .04em; text-align: center; }
  .wam-hw-chan { opacity: 0.5; align-self: center; text-align: center; font-size: 0.65rem; }
  .wam-hw-colbtns { display: grid; grid-template-columns: 16px repeat(2, minmax(0, 1fr)); gap: 3px; margin-top: 8px; }
  .wam-hw-section { margin-top: 10px; padding-top: 8px; border-top: 1px solid #2a2a3a; }
  .wam-hw-section h4 { all: unset; display: block; font-size: 0.62rem; text-transform: uppercase; letter-spacing: .05em; opacity: .55; margin-bottom: 4px; }
  .wam-hw-energy { display: flex; align-items: center; gap: 6px; }
  .wam-hw-energy .wam-hw-bar { flex: 1; height: 6px; }
  .wam-hw-energy .wam-hw-bar > i { background: linear-gradient(90deg, #3c9a4b, #e6c229 60%, #e05a2a); }
  .wam-hw-log { margin: 4px 0 0; padding-left: 1.1rem; opacity: .8; font-size: 0.66rem; line-height: 1.3; }
`;

let cssInjected = false;

export class WamHardwareMap extends HTMLElement {
  constructor() {
    super();
    this.surface = null;
    this._state = null;
    this._onState = (e) => this.render(e.detail);
  }

  connectedCallback() {
    if (!cssInjected) {
      const style = document.createElement("style");
      style.textContent = CSS;
      document.head.appendChild(style);
      cssInjected = true;
    }
    document.addEventListener("wam-hardware-state", this._onState);
    // pointerdown, not click: the map re-renders as the playhead moves, which
    // can swap the element between press and release and swallow a click.
    this.addEventListener("pointerdown", (e) => this._handleClick(e));
    this.render(this.surface?.state ?? null);
  }

  static get observedAttributes() {
    return ["layout"];
  }

  attributeChangedCallback() {
    this._lastKey = null;
    if (this.isConnected) this.render(this._state ?? this.surface?.state ?? null);
  }

  disconnectedCallback() {
    document.removeEventListener("wam-hardware-state", this._onState);
  }

  _handleClick(e) {
    const el = e.target.closest("[data-cmd],[data-press]");
    if (!el || !this.contains(el)) return;
    if (el.dataset.cmd) dispatchCommand(el.dataset.cmd);
    else if (el.dataset.press && this.surface) {
      const [row, i] = el.dataset.press.split(":");
      this.surface.pressButton(row, Number(i));
    }
  }

  render(state) {
    const key = state ? JSON.stringify(state) : "";
    if (key === this._lastKey) return; // nothing visible changed
    this._lastKey = key;
    this._state = state;
    if (!state) {
      this.textContent = "Hardware map appears once the playground starts.";
      return;
    }
    const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    const column = this.getAttribute("layout") === "column";
    const head = [
      `<span class="wam-hw-title" title="Novation Launch Control XL">${column ? "LCXL" : "Launch Control XL"}</span>`,
      ...MODE_INFO.map(
        ([mode, label, hw, cmd]) =>
          `<button class="wam-hw-chip" data-cmd="${cmd}" ${state.mode === mode ? "data-on" : ""} title="Device: ${hw} button">${label}<small>${hw}</small></button>`,
      ),
      `<span>Knobs → <b>${esc(state.focusedTitle ?? "no instrument focused")}</b></span>`,
      state.pageCount > 1
        ? `<button class="wam-hw-chip" data-cmd="${COMMANDS.PAGE_PREV}" title="Device: ◀">◀</button><span>page ${state.page + 1}/${state.pageCount}</span><button class="wam-hw-chip" data-cmd="${COMMANDS.PAGE_NEXT}" title="Device: ▶">▶</button>`
        : "",
    ].join("");

    const knobCell = (id) => {
      const a = state.knobs[id];
      if (!a) return `<span class="wam-hw-cell wam-hw-knob" data-empty><span class="wam-hw-klabel">—</span></span>`;
      const dial = a.value != null ? `<i class="wam-hw-dial" style="--v:${a.value.toFixed(3)}"></i>` : "";
      return `<span class="wam-hw-cell wam-hw-knob" ${a.choice ? "data-choice" : ""} title="${esc(a.label)} (${esc(a.param)})${a.choice ? " — turn to step through the options" : ""}">
          <span class="wam-hw-ktop">${dial}<span class="wam-hw-klabel">${esc(a.label)}</span></span>
          ${a.display != null ? `<span class="wam-hw-kval">${esc(a.display)}</span>` : ""}
        </span>`;
    };

    const faderCell = (f, i) =>
      !f
        ? `<span class="wam-hw-cell" data-empty>${column ? "" : i + 1}</span>`
        : `<span class="wam-hw-cell wam-hw-fader" ${f.muted ? "data-muted" : ""} ${f.focused ? "data-focused" : ""} title="${esc(f.title)}${f.picked ? "" : " — move the fader through the current level to pick it up"}">
             <span class="wam-hw-klabel">${column ? "" : `${i + 1} `}${esc(f.title)}</span>
             <span class="wam-hw-bar"><i style="width:${Math.round((f.volume ?? 0) * 100)}%"></i></span>
             ${f.picked ? "" : `<span class="wam-hw-pickup">↕ pick up</span>`}
           </span>`;

    const lit = (row, i) => this._lit(state, row, i);
    const btnCell = (row, i) => {
      const label = state.buttons[row][i];
      return label
        ? `<button class="wam-hw-btn" data-press="${row}:${i}" ${lit(row, i) ? `data-lit="${lit(row, i)}"` : ""}>${esc(label)}</button>`
        : `<span class="wam-hw-btn" data-empty>—</span>`;
    };

    if (column) {
      this.innerHTML = this._columnHTML(state, { head, knobCell, faderCell, btnCell, esc });
      return;
    }

    const knobRows = KNOB_ROWS.map((ids, r) => `<span class="wam-hw-rowname">${ROW_NAMES[r]}</span>` + ids.map(knobCell).join("")).join("");
    const faders = `<span class="wam-hw-rowname">Faders</span>` + state.faders.map(faderCell).join("");
    const buttons = ["top", "bottom"]
      .map((row) => `<span class="wam-hw-rowname">${row === "top" ? "Buttons ▲" : "Buttons ▼"}</span>` + state.buttons[row].map((_, i) => btnCell(row, i)).join(""))
      .join("");

    this.innerHTML = `<div class="wam-hw-head">${head}</div>
      <div class="wam-hw-grid">${knobRows}<span class="wam-hw-sep"></span>${"<span></span>".repeat(8)}${faders}<span class="wam-hw-sep"></span>${"<span></span>".repeat(8)}${buttons}</div>`;
  }

  /** Column layout: one row per channel strip (knobs A/B/C + fader), then the buttons, then Evolve. */
  _columnHTML(state, { head, knobCell, faderCell, btnCell, esc }) {
    const rows = [`<span></span>${ROW_NAMES.map((n) => `<span class="wam-hw-colhead">${n}</span>`).join("")}<span class="wam-hw-colhead">Fader</span>`];
    for (let c = 0; c < 8; c++) {
      rows.push(`<span class="wam-hw-chan">${c + 1}</span>${KNOB_ROWS.map((ids) => knobCell(ids[c])).join("")}${faderCell(state.faders[c], c)}`);
    }
    const btnRows = [`<span></span><span class="wam-hw-colhead">Buttons ▲</span><span class="wam-hw-colhead">Buttons ▼</span>`];
    for (let c = 0; c < 8; c++) btnRows.push(`<span class="wam-hw-chan">${c + 1}</span>${btnCell("top", c)}${btnCell("bottom", c)}`);
    const ev = state.evolve;
    const evolve = ev
      ? `<div class="wam-hw-section"><h4>∿ Evolve · ${ev.auto ? "auto" : "manual"}${ev.drift ? ` · drift ${Math.round(ev.drift * 100)}%` : ""}</h4>
          <div class="wam-hw-energy" title="Knob C8"><span>Energy</span><span class="wam-hw-bar"><i style="width:${Math.round(ev.energy * 100)}%"></i></span><span>${Math.round(ev.energy * 100)}%</span></div>
          ${ev.log.length ? `<ol class="wam-hw-log">${ev.log.map((x) => `<li>bar ${x.bar + 1} · ${esc(x.label)}: ${esc(x.what)}</li>`).join("")}</ol>` : ""}
        </div>`
      : "";
    return `<div class="wam-hw-head">${head}</div>
      <div class="wam-hw-colgrid">${rows.join("")}</div>
      <div class="wam-hw-colbtns">${btnRows.join("")}</div>${evolve}`;
  }

  /** Approximate the device LED for a button cell (for display only). */
  _lit(state, row, i) {
    if (state.mode === MODES.STEPS) {
      const st = state.steps?.[row === "top" ? i : 8 + i];
      if (!st) return null;
      if (st.playing) return st.active ? "green-full" : "red-low";
      return st.active ? "green" : null;
    }
    if (state.mode === MODES.MIXER) {
      const f = state.faders[i];
      if (!f) return null;
      if (row === "top") return f.muted ? "red" : "green";
      return f.focused ? "amber" : "green";
    }
    if (state.mode === MODES.PERFORM && row === "top" && i < 4) {
      const p = state.patterns[i];
      if (!p) return null;
      return p.queued ? "amber" : p.playing ? "green" : null;
    }
    return null;
  }
}

customElements.define("wam-hardware-map", WamHardwareMap);
