/**
 * <wam-knob> — compact rotary knob control for audio parameters.
 *
 * SVG-based, flat/minimal design. 270° arc from lower-left (135°) to
 * lower-right (405°). Drag vertically or horizontally to adjust — no
 * atan() center-point calculation, just linear delta mapping.
 *
 * API mirrors <wam-slider>:
 *   <wam-knob label="Cutoff" param="cutoff"
 *     min="50" max="10000" step="1" value="600"></wam-knob>
 *
 * Logarithmic scale:
 *   <wam-knob label="LPF" param="lpFreq"
 *     min="80" max="20000" step="1" scale="log" value="20000"></wam-knob>
 *
 * Events:
 *   knob-input  { param: string, value: number }  — bubbles, user-only
 */
export default class WebAudioKnob extends HTMLElement {
  static #cssInjected = false;

  // Arc geometry constants
  static ARC_START = 135; // degrees, lower-left
  static ARC_END = 405; // degrees, lower-right (135 + 270)
  static ARC_RANGE = 270; // degrees total sweep
  static DRAG_PIXELS = 200; // pixels of drag for full range

  constructor() {
    super();
    this._built = false;
    this._svgArc = null;
    this._svgDot = null;
    this._valEl = null;
    this._dragging = false;
    this._dragStartY = 0;
    this._dragStartX = 0;
    this._dragStartValue = 0;

    // Log scale state
    this._isLog = false;
    this._logMin = 0;
    this._logMax = 1;

    // Bound handlers for cleanup
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
  }

  connectedCallback() {
    WebAudioKnob._injectCSS();
    if (!this._built) this._build();
  }

  disconnectedCallback() {
    if (this._dragging) {
      document.removeEventListener("pointermove", this._onPointerMove);
      document.removeEventListener("pointerup", this._onPointerUp);
      this._dragging = false;
    }
  }

  // ---- Observed attributes ----

  static get observedAttributes() {
    return ["label", "param", "min", "max", "step", "value", "color", "scale", "size"];
  }

  attributeChangedCallback(name, _old, val) {
    if (!this._built) return;
    if (name === "value") {
      const num = parseFloat(val);
      this._setDisplayValue(num);
      this._renderArc(this._valueToNorm(num));
    } else if (name === "label") {
      const lbl = this.querySelector(".wam-knob-label-text");
      if (lbl) lbl.textContent = val;
    } else if (name === "color") {
      this.style.setProperty("--slider-accent", val);
    }
  }

  // ---- Value property ----

  get value() {
    return this._isLog
      ? this._fromSlider(this._valueToNorm(parseFloat(this.getAttribute("value") || 0)))
      : parseFloat(this.getAttribute("value") || 0);
  }

  set value(v) {
    const num = typeof v === "number" ? v : parseFloat(v);
    this.setAttribute("value", num);
    if (!this._built) return;
    this._setDisplayValue(num);
    this._renderArc(this._valueToNorm(num));
  }

  // ---- Build ----

  _build() {
    this._built = true;
    this.innerHTML = "";

    const label = this.getAttribute("label") || "";
    const param = this.getAttribute("param") || "";
    const min = parseFloat(this.getAttribute("min") || "0");
    const max = parseFloat(this.getAttribute("max") || "1");
    const step = parseFloat(this.getAttribute("step") || "0.01");
    const value = parseFloat(this.getAttribute("value") || min);
    const color = this.getAttribute("color");
    const size = this.getAttribute("size"); // "sm" | "lg" | null
    this._isLog = this.getAttribute("scale") === "log";
    this._logMin = min;
    this._logMax = max;

    if (color) this.style.setProperty("--slider-accent", color);
    if (size) this.setAttribute("data-size", size);

    // Label
    const labelEl = document.createElement("label");
    labelEl.className = "wam-knob-label";
    const labelText = document.createElement("span");
    labelText.className = "wam-knob-label-text";
    labelText.textContent = label;
    const tooltip = this.getAttribute("data-tooltip");
    if (tooltip) {
      labelText.setAttribute("data-tooltip", tooltip);
      this.removeAttribute("data-tooltip");
    }
    labelEl.appendChild(labelText);
    this.appendChild(labelEl);

    // SVG knob
    const svgSize = 40;
    const cx = svgSize / 2;
    const cy = svgSize / 2;
    const r = 16; // radius for the arc
    const strokeWidth = 3;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${svgSize} ${svgSize}`);
    svg.setAttribute("class", "wam-knob-svg");

    // Track arc (full 270° background)
    const track = document.createElementNS("http://www.w3.org/2000/svg", "path");
    track.setAttribute("class", "wam-knob-track");
    track.setAttribute("d", this._describeArc(cx, cy, r, WebAudioKnob.ARC_START, WebAudioKnob.ARC_END));
    track.setAttribute("fill", "none");
    track.setAttribute("stroke-width", strokeWidth);
    track.setAttribute("stroke-linecap", "round");
    svg.appendChild(track);

    // Value arc (filled portion)
    this._svgArc = document.createElementNS("http://www.w3.org/2000/svg", "path");
    this._svgArc.setAttribute("class", "wam-knob-fill");
    this._svgArc.setAttribute("fill", "none");
    this._svgArc.setAttribute("stroke-width", strokeWidth);
    this._svgArc.setAttribute("stroke-linecap", "round");
    svg.appendChild(this._svgArc);

    // Position dot
    this._svgDot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    this._svgDot.setAttribute("class", "wam-knob-dot");
    this._svgDot.setAttribute("r", "2.5");
    svg.appendChild(this._svgDot);

    this.appendChild(svg);

    // Value display
    this._valEl = document.createElement("span");
    this._valEl.className = "wam-knob-value";
    this.appendChild(this._valEl);

    // Initial render
    const norm = this._valueToNorm(value);
    this._renderArc(norm);
    this._setDisplayValue(value);

    // ---- Interaction ----

    svg.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this._dragging = true;
      this._dragStartY = e.clientY;
      this._dragStartX = e.clientX;
      this._dragStartValue = this._valueToNorm(parseFloat(this.getAttribute("value") || min));
      svg.setPointerCapture(e.pointerId);
      document.addEventListener("pointermove", this._onPointerMove);
      document.addEventListener("pointerup", this._onPointerUp);
      this.classList.add("wam-knob-active");
    });

    // Double-click reset
    const defaultAttr = this.getAttribute("default");
    if (defaultAttr !== null) {
      svg.addEventListener("dblclick", () => {
        const def = parseFloat(defaultAttr);
        this.value = def;
        this.dispatchEvent(
          new CustomEvent("knob-input", {
            bubbles: true,
            detail: { param, value: def },
          }),
        );
      });
    }

    // Mouse wheel
    svg.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const currentVal = parseFloat(this.getAttribute("value") || min);
        const range = max - min;
        const delta = (e.deltaY > 0 ? -1 : 1) * (range / 100);
        const stepped = this._snapToStep(Math.max(min, Math.min(max, currentVal + delta)), step, min);
        this.value = stepped;
        this.dispatchEvent(
          new CustomEvent("knob-input", {
            bubbles: true,
            detail: { param, value: stepped },
          }),
        );
      },
      { passive: false },
    );
  }

  // ---- Drag handlers ----

  _onPointerMove(e) {
    if (!this._dragging) return;

    const min = parseFloat(this.getAttribute("min") || "0");
    const max = parseFloat(this.getAttribute("max") || "1");
    const step = parseFloat(this.getAttribute("step") || "0.01");
    const param = this.getAttribute("param") || "";

    const dy = this._dragStartY - e.clientY; // up = positive
    const dx = e.clientX - this._dragStartX; // right = positive
    // Use whichever axis has more movement
    const delta = Math.abs(dy) >= Math.abs(dx) ? dy : dx;
    const normDelta = delta / WebAudioKnob.DRAG_PIXELS;

    let newNorm = Math.max(0, Math.min(1, this._dragStartValue + normDelta));
    let newValue;

    if (this._isLog) {
      newValue = this._fromSlider(newNorm);
      newValue = this._snapToStep(newValue, step, min);
    } else {
      newValue = min + newNorm * (max - min);
      newValue = this._snapToStep(newValue, step, min);
    }

    newValue = Math.max(min, Math.min(max, newValue));
    this.setAttribute("value", newValue);
    this._setDisplayValue(newValue);
    this._renderArc(this._valueToNorm(newValue));

    this.dispatchEvent(
      new CustomEvent("knob-input", {
        bubbles: true,
        detail: { param, value: newValue },
      }),
    );
  }

  _onPointerUp() {
    this._dragging = false;
    this.classList.remove("wam-knob-active");
    document.removeEventListener("pointermove", this._onPointerMove);
    document.removeEventListener("pointerup", this._onPointerUp);
  }

  // ---- Value mapping ----

  _valueToNorm(value) {
    if (this._isLog) return this._toSlider(value);
    const min = parseFloat(this.getAttribute("min") || "0");
    const max = parseFloat(this.getAttribute("max") || "1");
    if (max === min) return 0;
    return (value - min) / (max - min);
  }

  _snapToStep(value, step, min) {
    return Math.round((value - min) / step) * step + min;
  }

  // Log scale helpers (same math as wam-slider)
  _toSlider(realValue) {
    const lo = Math.max(this._logMin, 1e-6);
    const hi = this._logMax;
    return Math.log(realValue / lo) / Math.log(hi / lo);
  }

  _fromSlider(position) {
    const lo = Math.max(this._logMin, 1e-6);
    const hi = this._logMax;
    const step = parseFloat(this.getAttribute("step") || "1");
    const raw = lo * Math.pow(hi / lo, position);
    return Math.round(raw / step) * step;
  }

  // ---- SVG arc rendering ----

  _renderArc(norm) {
    const svgSize = 40;
    const cx = svgSize / 2;
    const cy = svgSize / 2;
    const r = 16;

    const endAngle = WebAudioKnob.ARC_START + norm * WebAudioKnob.ARC_RANGE;

    // Value arc — only draw if there's meaningful fill
    if (norm > 0.005) {
      this._svgArc.setAttribute("d", this._describeArc(cx, cy, r, WebAudioKnob.ARC_START, endAngle));
      this._svgArc.style.display = "";
    } else {
      this._svgArc.style.display = "none";
    }

    // Position dot
    const dotAngle = endAngle;
    const rad = (dotAngle * Math.PI) / 180;
    this._svgDot.setAttribute("cx", cx + r * Math.cos(rad));
    this._svgDot.setAttribute("cy", cy + r * Math.sin(rad));
  }

  _describeArc(cx, cy, r, startAngle, endAngle) {
    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;
    const x1 = cx + r * Math.cos(startRad);
    const y1 = cy + r * Math.sin(startRad);
    const x2 = cx + r * Math.cos(endRad);
    const y2 = cy + r * Math.sin(endRad);
    const largeArc = endAngle - startAngle > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
  }

  // ---- Display formatting ----

  _setDisplayValue(v) {
    if (!this._valEl) return;
    const step = parseFloat(this.getAttribute("step") || "0.01");
    if (step < 0.01) this._valEl.textContent = v.toFixed(3);
    else if (step < 1) this._valEl.textContent = v.toFixed(2);
    else this._valEl.textContent = Math.round(v);
  }

  // ---- CSS (injected once) ----

  static _injectCSS() {
    if (WebAudioKnob.#cssInjected) return;
    WebAudioKnob.#cssInjected = true;
    const s = document.createElement("style");
    s.textContent = `
      wam-knob {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        min-width: 48px;
        font-family: monospace;
        user-select: none;
        cursor: grab;
      }
      wam-knob.wam-knob-active {
        cursor: grabbing;
      }
      wam-knob[data-size="sm"] { min-width: 36px; }
      wam-knob[data-size="sm"] .wam-knob-svg { width: 32px; height: 32px; }
      wam-knob[data-size="lg"] { min-width: 64px; }
      wam-knob[data-size="lg"] .wam-knob-svg { width: 56px; height: 56px; }
      .wam-knob-label {
        font-size: 0.7em;
        color: #555;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        text-align: center;
        white-space: nowrap;
      }
      .wam-knob-label-text[data-tooltip] {
        cursor: help;
        border-bottom: 0;
      }
      .wam-knob-label-text[data-tooltip]::before {
        white-space: normal;
        max-width: 240px;
        font-size: 0.5rem;
        font-family: monospace;
        text-align: left;
        line-height: 1;
        overflow: visible;
      }
      .wam-knob-svg {
        width: 40px;
        height: 40px;
        touch-action: none;
      }
      .wam-knob-track {
        stroke: #222;
      }
      .wam-knob-fill {
        stroke: var(--slider-accent, #0f0);
      }
      .wam-knob-dot {
        fill: var(--slider-accent, #0f0);
      }
      .wam-knob-value {
        font-size: 0.65em;
        color: var(--slider-accent, #0f0);
        font-family: monospace;
        text-align: center;
      }
    `;
    document.head.appendChild(s);
  }
}

customElements.define("wam-knob", WebAudioKnob);
