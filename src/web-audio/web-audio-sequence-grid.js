/**
 * WebAudioSequenceGrid — minimal step-sequence grid with live playhead.
 *
 * Renders a grid of rows (one per instrument), 16 columns wide.
 * Active steps are white-filled rectangles; the playhead is a 1px white line.
 * No colors, no gradients — white on black only.
 *
 * Usage:
 *   const grid = document.createElement("web-audio-sequence-grid");
 *   container.appendChild(grid);
 *   grid.setPatterns([
 *     { label: "K", steps: [true,false,...] },  // 16 booleans
 *     { label: "H", steps: [false,true,...] },
 *   ]);
 *   grid.setStep(0); // advance playhead each 16th note
 */
export default class WebAudioSequenceGrid extends HTMLElement {
  connectedCallback() {
    this.style.cssText = "display:block;";
    this._rows = [];
    this._step = -1;

    this._canvas = document.createElement("canvas");
    this._canvas.style.cssText = "display:block;width:100%;height:100%;";
    this.appendChild(this._canvas);

    this._ro = new ResizeObserver(() => this._layout());
    this._ro.observe(this);
  }

  disconnectedCallback() {
    this._ro?.disconnect();
  }

  _layout() {
    this._canvas.width  = this.clientWidth  || 300;
    this._canvas.height = this.clientHeight || 80;
    this._draw();
  }

  /** @param {{ label: string, steps: boolean[] }[]} rows  — each steps array must be length 16 */
  setPatterns(rows) {
    this._rows = rows;
    this._draw();
  }

  /** @param {number} step  0–15 */
  setStep(step) {
    this._step = step;
    this._draw();
  }

  _draw() {
    const canvas = this._canvas;
    const ctx    = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);

    if (!this._rows.length) return;

    const nCols  = 16;
    const nRows  = this._rows.length;
    const labelW = 13;
    const padX   = 5;
    const padY   = 4;
    const gridX  = padX + labelW;
    const gridW  = W - gridX - padX;
    const gridH  = H - padY * 2;
    const rowH   = gridH / nRows;
    const colW   = gridW / nCols;
    const gap    = 1.5;

    const fontSize = Math.max(6, Math.min(9, rowH * 0.42));
    ctx.font          = `${fontSize}px monospace`;
    ctx.textBaseline  = "middle";
    ctx.textAlign     = "left";

    // Faint downbeat tick marks along top edge
    ctx.fillStyle = "#181818";
    for (let c = 0; c < nCols; c += 4) {
      ctx.fillRect(gridX + c * colW, 0, 1, padY);
    }

    // Rows
    for (let r = 0; r < nRows; r++) {
      const { label, steps } = this._rows[r];
      const rowY = padY + r * rowH;

      // Row label
      ctx.fillStyle = "#282828";
      ctx.fillText(label, padX, rowY + rowH * 0.5);

      // Active step cells
      ctx.fillStyle = "#fff";
      for (let c = 0; c < nCols; c++) {
        if (!steps?.[c]) continue;
        ctx.fillRect(
          gridX + c * colW + gap,
          rowY  + gap,
          colW  - gap * 2,
          rowH  - gap * 2,
        );
      }
    }

    // Playhead — 1px white vertical line centred on current step
    if (this._step >= 0 && this._step < nCols) {
      const x = gridX + (this._step + 0.5) * colW;
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(x, padY);
      ctx.lineTo(x, H - padY);
      ctx.stroke();
    }
  }
}

customElements.define("web-audio-sequence-grid", WebAudioSequenceGrid);
