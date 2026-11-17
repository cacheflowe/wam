/**
 * AutoMap — "device follows focus": when an instrument is focused, bind the
 * Launch Control XL's 24 knobs to that instrument's parameters so it's
 * immediately playable. Ephemeral and non-persistent — manual MIDI-learn
 * bindings always win, and the map clears when focus moves.
 *
 * Layout is ROLE-BASED (see param-schema.js ROLES), so the same physical knob
 * does the same kind of thing on every instrument:
 *
 *   Row 1 (Send A)     tone:      cutoff · resonance · envAmt · drive · wave · tone · noise · keytrack
 *   Row 2 (Send B)     envelope:  attack · decay · sustain · release · gate · fAttack · fDecay · fRelease
 *   Row 3 (Pan/Device) movement:  detune · unison · lfoRate · lfoDepth · glide · pitch · pitchAmt · pitchDecay
 *
 * A param claims its role's fixed knob; params without a fixed slot fill the
 * empty knobs of their group's home row, then any empty knob. Whatever doesn't
 * fit spills onto further pages (← / → on the device). Choice params (enums with
 * a registered <select>, e.g. waveforms, filter type) map too: the knob's travel
 * is split into one zone per option. Faders are NOT used —
 * they're the mixer (see performance-surface.js); channel buttons belong to
 * the performance surface too.
 */
import { CONTROLS, bindingFor, findControl } from "./launch-control-xl.js";
import { ledFeedback } from "./led-feedback.js";
import { paramPosition } from "../ui/input-learn.js";

const KNOB_ROWS = [1, 2, 3].map((r) =>
  CONTROLS.filter((c) => c.group === `knobsRow${r}`).map((c) => c.id),
);
const KNOBS_PER_PAGE = KNOB_ROWS.flat().length; // 24

/** Fixed role → [row, col] slots. */
export const ROLE_SLOTS = (() => {
  const rows = [
    ["cutoff", "resonance", "envAmt", "drive", "wave", "tone", "noise", "keytrack"],
    ["attack", "decay", "sustain", "release", "gate", "filterAttack", "filterDecay", "filterRelease"],
    ["detune", "unison", "lfoRate", "lfoDepth", "glide", "pitch", "pitchAmt", "pitchDecay"],
  ];
  const map = {};
  rows.forEach((roles, r) => roles.forEach((role, c) => (map[role] = [r, c])));
  return map;
})();

/** Which row a param without a fixed slot prefers, by group. */
const HOME_ROW = {
  filter: 0, osc: 0, character: 0, body: 0,
  "amp-env": 1, "filter-env": 1,
  mod: 2, pitch: 2, seq: 2, fx: 2,
};

/** Knobs reserved for global performance controls (never auto-mapped). See performance-surface.js. */
export const RESERVED_KNOBS = Object.freeze({ knobC8: "Energy" });

/** Params never put on knobs (strip controls, not sound params). */
const EXCLUDED = new Set(["volume", "pan"]);

/**
 * Pure layout: assign params to knob positions, page by page.
 * @param {object[]} defs  numeric param defs in priority/schema order
 * @param {Set<number>} [blocked]  knob indices (0–23) taken by manual bindings, on every page
 * @returns {Array<Array<string|null>>} pages → 24 slots (row-major) → param or null
 */
export function layoutKnobs(defs, blocked = new Set()) {
  const BLOCKED = false; // sentinel: occupied by a manual binding
  const pages = [];
  let remaining = [...defs];
  while (remaining.length) {
    const slots = Array.from({ length: KNOBS_PER_PAGE }, (_, i) => (blocked.has(i) ? BLOCKED : null));
    const leftover = [];
    // 1) Fixed role slots (first claimant wins; later same-role params fall through).
    for (const def of remaining) {
      const pos = def.role && ROLE_SLOTS[def.role];
      const i = pos ? pos[0] * 8 + pos[1] : -1;
      if (i >= 0 && slots[i] == null) slots[i] = def.param;
      else leftover.push(def);
    }
    // 2) Empty knobs in the param's home row, then 3) any empty knob.
    const rest = [];
    for (const def of leftover) {
      const row = HOME_ROW[def.group];
      let i = -1;
      if (row != null) {
        for (let c = 0; c < 8 && i < 0; c++) if (slots[row * 8 + c] == null) i = row * 8 + c;
      }
      if (i < 0) i = slots.indexOf(null);
      if (i >= 0) slots[i] = def.param;
      else rest.push(def);
    }
    pages.push(slots.map((v) => (v === BLOCKED ? null : v)));
    if (rest.length === remaining.length) break; // every knob blocked — nothing more can be placed
    remaining = rest;
  }
  return pages.length ? pages : [new Array(KNOBS_PER_PAGE).fill(null)];
}

/** Knob-mappable defs for a controls instance, in priority then schema order. */
function mappableDefs(controls) {
  const registry = controls._learnRegistry ?? {};
  const selects = controls._selects ?? {};
  const schema = controls._instrument?.constructor.PARAMS;
  const inRegistry = (p) => !!registry[p] && !EXCLUDED.has(p);
  const knobbable = (d) => {
    const type = d.type ?? "number";
    if (type === "number") return inRegistry(d.param);
    return type === "enum" && !!selects[d.param]?.el; // choice → stepped knob
  };
  if (schema) {
    return schema
      .map((d, i) => ({ d, i }))
      .filter(({ d }) => knobbable(d))
      .sort((a, b) => (a.d.priority ?? 2) - (b.d.priority ?? 2) || a.i - b.i)
      .map(({ d }) => d);
  }
  // Legacy instruments (no schema): registry order, no roles.
  return Object.keys(registry).filter(inRegistry).map((param) => ({ param }));
}

export class AutoMap {
  constructor(target = document) {
    this._target = target;
    this._enabled = true;
    this._current = null; // controls instance currently auto-mapped
    this._page = 0;
    this._pages = [];
    this._started = false;
    this._onFocus = (e) => this.focus(e.detail?.controls ?? null);
  }

  start() {
    if (this._started) return;
    this._started = true;
    this._target.addEventListener("wam-instrument-focus-change", this._onFocus);
  }

  stop() {
    this._target.removeEventListener("wam-instrument-focus-change", this._onFocus);
    this._clearCurrent();
    this._started = false;
  }

  setEnabled(on) {
    this._enabled = !!on;
    if (!this._enabled) this._clearCurrent();
    else if (this._focused) this.focus(this._focused);
  }

  get enabled() {
    return this._enabled;
  }

  get page() {
    return this._page;
  }

  get pageCount() {
    return this._pages.length || 1;
  }

  /** The focused controls instance (even when auto-map is disabled). */
  get focused() {
    return this._focused ?? null;
  }

  focus(controls) {
    this._focused = controls;
    this._page = 0;
    this._apply();
  }

  /** Move to another knob page (wraps). */
  setPage(page) {
    if (!this._current) return;
    const n = this.pageCount;
    this._page = ((page % n) + n) % n;
    this._apply();
  }

  stepPage(dir) {
    this.setPage(this._page + dir);
  }

  /**
   * Current knob → param assignment for display: { controlId: { param, label } }.
   * Only knobs actually bound on this page are included.
   */
  get assignments() {
    const out = {};
    const controls = this._current;
    const registry = controls?._learnRegistry ?? {};
    const schema = controls?._instrument?.constructor.PARAMS ?? [];
    const map = this._map ?? {};
    for (const [param, binding] of Object.entries(map)) {
      const control = findControl(binding);
      if (!control) continue;
      const def = schema.find((d) => d.param === param);
      // Schema labels stand alone ("L1 Rate"); panel labels may rely on their section ("Rate").
      const label = def?.label ?? registry[param]?.getAttribute?.("label") ?? param;
      const pos = paramPosition(controls, param);
      out[control.id] = { param, label, ...(pos ?? {}), ...(def?.type === "enum" ? { choice: true } : {}) };
    }
    return out;
  }

  _apply() {
    this._clearCurrent();
    const controls = this._focused;
    if (!this._enabled || typeof controls?.setAutoBindings !== "function") {
      this._emit();
      return;
    }
    this._pages = this._layout(controls);
    if (this._page >= this._pages.length) this._page = 0;
    this._map = this.computeMap(controls);
    controls.setAutoBindings(this._map);
    this._current = controls;
    this._emit();
  }

  _clearCurrent() {
    this._current?.clearAutoBindings?.();
    this._current = null;
    this._map = null;
  }

  _emit() {
    this._target.dispatchEvent(
      new CustomEvent("wam-automap-change", {
        detail: { controls: this._current, page: this._page, pageCount: this.pageCount, assignments: this.assignments },
      }),
    );
  }

  /** Knob indices (0–23) occupied by manual bindings — removed from the layout. */
  _blockedKnobs(controls) {
    const knobIds = KNOB_ROWS.flat();
    const blocked = new Set(Object.keys(RESERVED_KNOBS).map((id) => knobIds.indexOf(id)));
    for (const binding of Object.values(controls._paramBindings ?? {})) {
      const i = knobIds.indexOf(findControl(binding)?.id);
      if (i >= 0) blocked.add(i);
    }
    return blocked;
  }

  _layout(controls) {
    return layoutKnobs(this._layoutDefs(controls), this._blockedKnobs(controls));
  }

  _layoutDefs(controls) {
    const manual = controls._paramBindings ?? {};
    return mappableDefs(controls).filter((d) => !manual[d.param]);
  }

  /** param → LCXL binding for the current page (manual-bound knobs are never used). */
  computeMap(controls) {
    if (this._current !== controls || !this._pages.length) this._pages = this._layout(controls);
    const template = ledFeedback.output?.template;
    const slots = this._pages[this._page] ?? [];
    const knobIds = KNOB_ROWS.flat();
    const map = {};
    slots.forEach((param, i) => {
      if (param) map[param] = bindingFor(knobIds[i], template);
    });
    return map;
  }
}

/** Shared singleton. Call start() (e.g. from the playground) to activate. */
export const autoMap = new AutoMap();
