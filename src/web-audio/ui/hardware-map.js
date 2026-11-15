/**
 * <wam-hardware-map> — on-screen mirror of the Launch Control XL layout.
 *
 * Renders PerformanceSurface state (`wam-hardware-state` events): current
 * button mode, the focused instrument's knob assignments for the current
 * page, fader → instrument slots (with soft-takeover status), and what each
 * of the 16 channel buttons does right now. It's interactive too — mode
 * chips, page arrows and the 16 buttons go through the same code paths as
 * the hardware, so PERFORM actions work without a device.
 *
 * Attributes:
 *   docked  — fixed to the bottom of the viewport, compact.
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
  wam-hardware-map { display: block; font-size: 0.72rem; color: #c8c8e0; }
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
  .wam-hw-knob { border-radius: 10px; text-align: center; }
  .wam-hw-btn { all: unset; cursor: pointer; border: 1px solid #2a2a3a; border-radius: 4px; padding: 2px 4px;
    min-height: 1.5em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center; }
  .wam-hw-btn:hover { border-color: #666; }
  .wam-hw-btn[data-empty] { opacity: 0.25; cursor: default; }
  .wam-hw-btn[data-lit="green"] { background: #1f5f2a; border-color: #3c9a4b; color: #fff; }
  .wam-hw-btn[data-lit="amber"] { background: #6a4d10; border-color: #c9952a; color: #fff; }
  .wam-hw-btn[data-lit="red"] { background: #5f1f1f; border-color: #a33; color: #fff; }
  .wam-hw-fader { display: flex; flex-direction: column; gap: 2px; }
  .wam-hw-bar { height: 4px; background: #222; border-radius: 2px; overflow: hidden; }
  .wam-hw-bar > i { display: block; height: 100%; background: #6c8; }
  .wam-hw-fader[data-muted] .wam-hw-bar > i { background: #a44; }
  .wam-hw-fader[data-focused] { border-color: #c9952a; }
  .wam-hw-pickup { opacity: 0.55; font-size: 0.6rem; }
  .wam-hw-sep { height: 4px; }
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
    this.addEventListener("click", (e) => this._handleClick(e));
    this.render(this.surface?.state ?? null);
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
    this._state = state;
    if (!state) {
      this.textContent = "Hardware map appears once the playground starts.";
      return;
    }
    const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    const head = [
      `<span class="wam-hw-title">Launch Control XL</span>`,
      ...MODE_INFO.map(
        ([mode, label, hw, cmd]) =>
          `<button class="wam-hw-chip" data-cmd="${cmd}" ${state.mode === mode ? "data-on" : ""} title="Device: ${hw} button">${label}<small>${hw}</small></button>`,
      ),
      `<span>Knobs → <b>${esc(state.focusedTitle ?? "no instrument focused")}</b></span>`,
      state.pageCount > 1
        ? `<button class="wam-hw-chip" data-cmd="${COMMANDS.PAGE_PREV}" title="Device: ◀">◀</button><span>page ${state.page + 1}/${state.pageCount}</span><button class="wam-hw-chip" data-cmd="${COMMANDS.PAGE_NEXT}" title="Device: ▶">▶</button>`
        : "",
    ].join("");

    const knobRows = KNOB_ROWS.map(
      (ids, r) =>
        `<span class="wam-hw-rowname">${ROW_NAMES[r]}</span>` +
        ids
          .map((id) => {
            const a = state.knobs[id];
            return `<span class="wam-hw-cell wam-hw-knob" ${a ? "" : "data-empty"} title="${esc(a?.param ?? "")}">${esc(a?.label ?? "—")}</span>`;
          })
          .join(""),
    ).join("");

    const faders =
      `<span class="wam-hw-rowname">Faders</span>` +
      state.faders
        .map((f, i) =>
          !f
            ? `<span class="wam-hw-cell" data-empty>${i + 1}</span>`
            : `<span class="wam-hw-cell wam-hw-fader" ${f.muted ? "data-muted" : ""} ${f.focused ? "data-focused" : ""} title="${esc(f.title)}${f.picked ? "" : " — move the fader through the current level to pick it up"}">
                 <span>${i + 1} ${esc(f.title)}</span>
                 <span class="wam-hw-bar"><i style="width:${Math.round((f.volume ?? 0) * 100)}%"></i></span>
                 ${f.picked ? "" : `<span class="wam-hw-pickup">↕ pick up</span>`}
               </span>`,
        )
        .join("");

    const lit = (row, i) => this._lit(state, row, i);
    const buttons = ["top", "bottom"]
      .map(
        (row) =>
          `<span class="wam-hw-rowname">${row === "top" ? "Buttons ▲" : "Buttons ▼"}</span>` +
          state.buttons[row]
            .map((label, i) =>
              label
                ? `<button class="wam-hw-btn" data-press="${row}:${i}" ${lit(row, i) ? `data-lit="${lit(row, i)}"` : ""}>${esc(label)}</button>`
                : `<span class="wam-hw-btn" data-empty>—</span>`,
            )
            .join(""),
      )
      .join("");

    this.innerHTML = `<div class="wam-hw-head">${head}</div>
      <div class="wam-hw-grid">${knobRows}<span class="wam-hw-sep"></span>${"<span></span>".repeat(8)}${faders}<span class="wam-hw-sep"></span>${"<span></span>".repeat(8)}${buttons}</div>`;
  }

  /** Approximate the device LED for a button cell (for display only). */
  _lit(state, row, i) {
    if (state.mode === MODES.MIXER) {
      const f = state.faders[i];
      if (!f) return null;
      if (row === "top") return f.muted ? "red" : "green";
      return f.focused ? "amber" : null;
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
