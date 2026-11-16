/**
 * <wam-hardware-map> — on-screen mirror of the Launch Control XL, laid out
 * one-to-one with the device:
 *
 *   knobs row 1 (Send A)        8 knobs   │ ▲ ▼   (instrument)
 *   knobs row 2 (Send B)        8 knobs   │ ◀ ▶   (knob page)
 *   knobs row 3 (Pan/Device)    8 knobs   │
 *   faders                      8 faders  │ Device (play) · Mute (Steps)
 *   buttons row 1 (Track Focus) 8 buttons │ Solo (Mixer)
 *   buttons row 2 (Track Ctrl)  8 buttons │ Record Arm (Perform)
 *
 * Renders PerformanceSurface state (`wam-hardware-state` events): the focused
 * instrument's knob assignments for the current page with live values (dial +
 * value, moving as you turn the hardware or the on-screen control), fader →
 * instrument slots (with soft-takeover status), what each of the 16 buttons
 * does in the current mode (lit like the LEDs; in Steps mode the pattern +
 * playhead), and the side buttons. Everything is clickable through the same
 * code paths as the hardware. Below the device: an Evolve strip (Energy +
 * recent events).
 *
 * Placement attributes (the drawing is the same in all of them):
 *   docked          — fixed to the bottom of the viewport.
 *   layout="column" — fixed right-hand column.
 *
 * Usage: el.surface = performanceSurface;  (required for interaction)
 */
import { MODES } from "../midi/performance-surface.js";
import { COMMANDS, CONTROLS } from "../midi/launch-control-xl.js";
import { dispatchCommand } from "../input/input-bindings.js";

const KNOB_ROWS = [1, 2, 3].map((r) => CONTROLS.filter((c) => c.group === `knobsRow${r}`).map((c) => c.id));

const CSS = /* css */ `
  wam-hardware-map { display: block; font-size: 0.68rem; line-height: 1.25; color: #c8c8e0; }
  wam-hardware-map[docked] {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 50;
    background: rgba(13, 13, 20, 0.97); border-top: 1px solid #2a2a3a;
    padding: 6px 12px 8px; max-height: 60vh; overflow: auto;
  }
  wam-hardware-map[docked] .wam-hw-wrap { max-width: 820px; margin: 0 auto; }
  wam-hardware-map[layout="column"] {
    position: fixed; top: 0; right: 0; bottom: 0; z-index: 40;
    width: var(--wam-hw-column-width, 540px); box-sizing: border-box;
    background: rgba(13, 13, 20, 0.98); border-left: 1px solid #2a2a3a;
    padding: 10px 10px 16px; overflow-y: auto;
  }

  .wam-hw-head { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; margin-bottom: 6px; }
  .wam-hw-title { font-weight: 600; color: #fff; }
  .wam-hw-mode { padding: 0 6px; border-radius: 8px; background: #e6c229; color: #111; }

  /* The device body: 8 channel strips + the side column. */
  .wam-hw-device {
    display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)) 52px; gap: 4px 3px;
    background: #15151d; border: 1px solid #2a2a3a; border-radius: 8px; padding: 8px 6px;
  }
  .wam-hw-side { display: flex; flex-direction: column; gap: 3px; justify-content: center; }
  .wam-hw-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 3px; }

  /* Knob: dial, label, value — stacked like a knob with its legend. */
  .wam-hw-knob { display: flex; flex-direction: column; align-items: center; gap: 1px; min-width: 0; text-align: center; }
  .wam-hw-dial {
    width: 26px; height: 26px; border-radius: 50%; position: relative;
    background: conic-gradient(from 225deg, var(--wam-hw-dial, #e6c229) calc(var(--v, 0) * 270deg), #34343f 0 270deg, transparent 0);
  }
  .wam-hw-dial::after { content: ""; position: absolute; inset: 4px; border-radius: 50%; background: #1d1d27; }
  .wam-hw-knob[data-choice] .wam-hw-dial { --wam-hw-dial: #6cf; }
  .wam-hw-knob[data-empty] .wam-hw-dial { opacity: 0.35; }
  .wam-hw-klabel, .wam-hw-kval { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .wam-hw-kval { opacity: 0.65; font-size: 0.6rem; font-variant-numeric: tabular-nums; min-height: 1.25em; }
  .wam-hw-knob[data-empty] .wam-hw-klabel { opacity: 0.3; }

  /* Fader: vertical track filled from the bottom, slot name under it. */
  .wam-hw-fader { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 0; margin-top: 4px; }
  .wam-hw-track { width: 10px; height: 64px; border-radius: 3px; background: #2a2a35; position: relative; overflow: hidden; }
  .wam-hw-track > i { position: absolute; left: 0; right: 0; bottom: 0; background: #6c8; }
  .wam-hw-fader[data-muted] .wam-hw-track > i { background: #a44; }
  .wam-hw-fader[data-focused] .wam-hw-flabel { color: #e6c229; }
  .wam-hw-fader[data-empty] { opacity: 0.3; }
  .wam-hw-flabel { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .wam-hw-pickup { opacity: 0.55; font-size: 0.56rem; }

  /* Buttons: square-ish pads like the hardware. */
  .wam-hw-btn {
    all: unset; box-sizing: border-box; cursor: pointer; min-height: 30px; padding: 2px;
    display: flex; align-items: center; justify-content: center; text-align: center;
    border: 1px solid #33333f; border-radius: 4px; background: #1d1d27;
    font-size: 0.6rem; line-height: 1.1; overflow: hidden; word-break: break-word;
  }
  .wam-hw-btn:hover { border-color: #777; }
  .wam-hw-btn[data-empty] { opacity: 0.3; cursor: default; }
  .wam-hw-btn[data-lit="green"] { background: #1f5f2a; border-color: #3c9a4b; color: #fff; }
  .wam-hw-btn[data-lit="green-full"] { background: #3cb54f; border-color: #8f8; color: #111; }
  .wam-hw-btn[data-lit="amber"] { background: #6a4d10; border-color: #c9952a; color: #fff; }
  .wam-hw-btn[data-lit="yellow"] { background: #e6c229; border-color: #e6c229; color: #111; }
  .wam-hw-btn[data-lit="red"] { background: #5f1f1f; border-color: #a33; color: #fff; }
  .wam-hw-btn[data-lit="red-low"] { background: #3a1818; border-color: #a33; color: #fff; }
  .wam-hw-side .wam-hw-btn { min-height: 26px; font-size: 0.56rem; }

  .wam-hw-evolve { margin-top: 8px; display: flex; flex-direction: column; gap: 3px; }
  .wam-hw-energy { display: flex; align-items: center; gap: 6px; }
  .wam-hw-ebar { flex: 1; height: 6px; border-radius: 3px; background: #2a2a35; overflow: hidden; }
  .wam-hw-ebar > i { display: block; height: 100%; background: linear-gradient(90deg, #3c9a4b, #e6c229 60%, #e05a2a); }
  .wam-hw-log { margin: 0; padding-left: 1.1rem; opacity: .8; font-size: 0.62rem; }
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
    if (!this._listening) {
      // pointerdown, not click: the map re-renders as the playhead moves, which
      // can swap the element between press and release and swallow a click.
      this.addEventListener("pointerdown", (e) => this._handlePress(e));
      this._listening = true;
    }
    this._lastKey = null;
    this.render(this.surface?.state ?? this._state ?? null);
  }

  disconnectedCallback() {
    document.removeEventListener("wam-hardware-state", this._onState);
  }

  _handlePress(e) {
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
    const modeName = { [MODES.STEPS]: "Steps", [MODES.MIXER]: "Mixer", [MODES.PERFORM]: "Perform" }[state.mode] ?? state.mode;

    const head = `<span class="wam-hw-title">Launch Control XL</span>
      <span class="wam-hw-mode">${modeName}</span>
      <span>Knobs → <b>${esc(state.focusedTitle ?? "no instrument focused")}</b>${state.pageCount > 1 ? ` · page ${state.page + 1}/${state.pageCount}` : ""}</span>`;

    const knob = (id) => {
      const a = state.knobs[id];
      if (!a) return `<div class="wam-hw-knob" data-empty><i class="wam-hw-dial"></i><span class="wam-hw-klabel">—</span><span class="wam-hw-kval"></span></div>`;
      const v = a.value != null ? `style="--v:${a.value.toFixed(3)}"` : "";
      const tip = `${a.label} (${a.param})${a.choice ? " — turn to step through the options" : ""}`;
      return `<div class="wam-hw-knob" ${a.choice ? "data-choice" : ""} title="${esc(tip)}">
          <i class="wam-hw-dial" ${v}></i>
          <span class="wam-hw-klabel">${esc(a.label)}</span>
          <span class="wam-hw-kval">${esc(a.display ?? "")}</span>
        </div>`;
    };

    const fader = (f, i) =>
      !f
        ? `<div class="wam-hw-fader" data-empty><span class="wam-hw-track"></span><span class="wam-hw-flabel">${i + 1}</span></div>`
        : `<div class="wam-hw-fader" ${f.muted ? "data-muted" : ""} ${f.focused ? "data-focused" : ""} title="${esc(f.title)} volume${f.picked ? "" : " — move the fader through the current level to pick it up"}">
            <span class="wam-hw-track"><i style="height:${Math.round((f.volume ?? 0) * 100)}%"></i></span>
            <span class="wam-hw-flabel">${esc(f.title)}</span>
            ${f.picked ? "" : `<span class="wam-hw-pickup">↕ pick</span>`}
          </div>`;

    const btn = (row, i) => {
      const label = state.buttons[row][i];
      const lit = this._lit(state, row, i);
      return label
        ? `<button class="wam-hw-btn" data-press="${row}:${i}" ${lit ? `data-lit="${lit}"` : ""} title="${esc(label)}">${esc(label)}</button>`
        : `<span class="wam-hw-btn" data-empty></span>`;
    };

    const side = (cmd, label, title, lit) =>
      `<button class="wam-hw-btn" data-cmd="${cmd}" ${lit ? `data-lit="${lit}"` : ""} title="${esc(title)}">${label}</button>`;
    const pages = state.pageCount > 1;
    const sideCells = [
      `<div class="wam-hw-side"><div class="wam-hw-pair">${side(COMMANDS.PREV_INSTRUMENT, "▲", "Previous instrument")}${side(COMMANDS.NEXT_INSTRUMENT, "▼", "Next instrument")}</div></div>`,
      `<div class="wam-hw-side"><div class="wam-hw-pair">${side(COMMANDS.PAGE_PREV, "◀", "Previous knob page", pages ? "red-low" : null)}${side(COMMANDS.PAGE_NEXT, "▶", "Next knob page", pages ? "red-low" : null)}</div></div>`,
      `<div class="wam-hw-side"></div>`,
      `<div class="wam-hw-side">${side(COMMANDS.PLAY_STOP, "Device<br>▶ ■", "Device: play / stop")}${side(COMMANDS.MODE_STEPS, "Mute<br>Steps", "Mute: Steps mode", state.mode === MODES.STEPS ? "yellow" : null)}</div>`,
      `<div class="wam-hw-side">${side(COMMANDS.MODE_MIXER, "Solo<br>Mixer", "Solo: Mixer mode", state.mode === MODES.MIXER ? "yellow" : null)}</div>`,
      `<div class="wam-hw-side">${side(COMMANDS.MODE_PERFORM, "Rec<br>Perform", "Record Arm: Perform mode", state.mode === MODES.PERFORM ? "yellow" : null)}</div>`,
    ];

    const rows = [
      ...KNOB_ROWS.map((ids) => ids.map(knob).join("")),
      state.faders.map(fader).join(""),
      state.buttons.top.map((_, i) => btn("top", i)).join(""),
      state.buttons.bottom.map((_, i) => btn("bottom", i)).join(""),
    ];
    const device = rows.map((cells, r) => cells + sideCells[r]).join("");

    const ev = state.evolve;
    const evolve = ev
      ? `<div class="wam-hw-evolve">
          <div class="wam-hw-energy" title="Energy = knob C8 (bottom-right knob)">∿ Evolve ${ev.auto ? "auto" : "manual"}${ev.drift ? ` · drift ${Math.round(ev.drift * 100)}%` : ""} · Energy
            <span class="wam-hw-ebar"><i style="width:${Math.round(ev.energy * 100)}%"></i></span>${Math.round(ev.energy * 100)}%</div>
          ${ev.log.length ? `<ol class="wam-hw-log">${ev.log.map((x) => `<li>bar ${x.bar + 1} · ${esc(x.label)}: ${esc(x.what)}</li>`).join("")}</ol>` : ""}
        </div>`
      : "";

    this.innerHTML = `<div class="wam-hw-wrap"><div class="wam-hw-head">${head}</div><div class="wam-hw-device">${device}</div>${evolve}</div>`;
  }

  /** Approximate the device LED for a channel button (display only). */
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
