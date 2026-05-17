/**
 * <wam-visualizer> — p5.js-based artistic audio visualizer.
 *
 * Hosts a p5 instance-mode canvas driven by a WamAnalysisBus.
 * Sketches are hot-loadable modules (dynamic import).
 *
 * Attributes:
 *   sketch — path to the sketch module (relative or absolute)
 *   mode   — "panel" | "background" | "corner" (default: "panel")
 *
 * Usage:
 *   const viz = document.createElement("wam-visualizer");
 *   viz.init(analysisBus, audioContext);
 *   viz.loadSketch("./sketches/reactive-geometry.js");
 *   container.appendChild(viz);
 */
import p5 from "p5";

export default class WamVisualizer extends HTMLElement {
  constructor() {
    super();
    this._bus = null;
    this._ctx = null;
    this._p5 = null;
    this._sketchModule = null;
    this._mode = "panel";
  }

  connectedCallback() {
    this._mode = this.getAttribute("mode") || "panel";
    this._applyMode();
    const sketchPath = this.getAttribute("sketch");
    if (sketchPath && this._bus) this.loadSketch(sketchPath);
  }

  disconnectedCallback() {
    if (this._p5) {
      this._p5.remove();
      this._p5 = null;
    }
  }

  /** Initialize with analysis bus and audio context. */
  init(bus, audioContext) {
    this._bus = bus;
    this._ctx = audioContext;
  }

  /** Load a sketch module by path. Module must export a default function(p, bus). */
  async loadSketch(path) {
    if (this._p5) {
      this._p5.remove();
      this._p5 = null;
    }
    try {
      const mod = await import(/* @vite-ignore */ path);
      this._sketchModule = mod.default;
      this._startSketch();
    } catch (e) {
      console.error("[wam-visualizer] Failed to load sketch:", path, e);
    }
  }

  /** Load a sketch from an already-imported module default export. */
  loadSketchModule(sketchFn) {
    if (this._p5) {
      this._p5.remove();
      this._p5 = null;
    }
    this._sketchModule = sketchFn;
    this._startSketch();
  }

  /** Set display mode: "panel", "background", or "corner". */
  setMode(mode) {
    this._mode = mode;
    this.setAttribute("mode", mode);
    this._applyMode();
  }

  _applyMode() {
    this.className = `wam-viz wam-viz-${this._mode}`;
  }

  _startSketch() {
    if (!this._sketchModule || !this._bus) return;
    const bus = this._bus;
    const ctx = this._ctx;
    const container = this;
    const sketchFn = this._sketchModule;

    this._p5 = new p5((p) => {
      sketchFn(p, bus, ctx, container);
    }, this);
  }
}

customElements.define("wam-visualizer", WamVisualizer);
