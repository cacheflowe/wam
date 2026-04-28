/**
 * WebAudioPlantVisualizer — mandala/spirograph audio visualizer.
 *
 * Renders N-fold rotationally symmetric, bilaterally symmetric petal arms
 * per audio source, with trail fade and a beat-pulse ring.
 *
 * Usage:
 *   const vis = document.createElement("web-audio-plant-visualizer");
 *   container.appendChild(vis);
 *   vis.init([
 *     { analyser, color: "#4488ff", baseRadius: 100, radiusScale: 50, bins: 16, rotMult: 1.0, lineWidth: 2, alpha: 0.7 },
 *     { analyser, color: "#00ff88", baseRadius: 70,  radiusScale: 35, bins: 24, rotMult: 1.3, lineWidth: 1, alpha: 0.5 },
 *   ], { symmetry: 6 });
 *   vis.pulseBeat(); // call on kick hit
 */
export default class WebAudioPlantVisualizer extends HTMLElement {
  connectedCallback() {
    this.style.cssText = "display:block;";

    this._canvas = document.createElement("canvas");
    this._canvas.style.cssText = "display:block;width:100%;height:100%;";
    this.appendChild(this._canvas);

    this._ctx2d = this._canvas.getContext("2d");
    this._sources = [];
    this._symmetry = 6;
    this._rotation = 0;
    this._raf = null;
    this._pulses = []; // { r, alpha } — multiple simultaneous beat rings

    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(this);
    this._resize();
  }

  disconnectedCallback() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._ro?.disconnect();
    this._raf = null;
  }

  /**
   * @param {Array<{
   *   analyser: AnalyserNode,
   *   color: string,
   *   baseRadius: number,
   *   radiusScale: number,
   *   bins: number,
   *   rotMult: number,
   *   lineWidth: number,
   *   alpha: number
   * }>} sources
   * @param {{ symmetry?: number }} [opts]
   */
  init(sources, { symmetry = 6 } = {}) {
    this._symmetry = symmetry;
    this._sources = sources.map((src) => ({
      ...src,
      _fftData: new Uint8Array(src.analyser.frequencyBinCount),
    }));
    if (!this._raf) this._drawFrame();
  }

  /** Trigger an expanding beat-pulse ring from the center. */
  pulseBeat() {
    this._pulses.push({ r: 8, alpha: 0.9 });
  }

  // ---- Internal ----

  _resize() {
    const { width, height } = this.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this._canvas.width = Math.max(1, Math.round(width * dpr));
    this._canvas.height = Math.max(1, Math.round(height * dpr));
    this._ctx2d.scale(dpr, dpr);
    // Store CSS pixel size for drawing
    this._cssW = Math.max(1, width);
    this._cssH = Math.max(1, height);
  }

  _drawFrame() {
    const ctx = this._ctx2d;
    const w = this._cssW ?? this._canvas.width;
    const h = this._cssH ?? this._canvas.height;
    const cx = w / 2;
    const cy = h / 2;

    // Trail fade — controls how long the spirograph trails persist
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(4, 8, 5, 0.055)";
    ctx.fillRect(0, 0, w, h);

    // Slow global rotation — drives the spirograph look
    this._rotation += 0.00025;

    // ---- Beat pulse rings ----
    this._pulses = this._pulses.filter((p) => p.alpha > 0.015);
    for (const p of this._pulses) {
      ctx.save();
      ctx.strokeStyle = `rgba(200, 255, 220, ${p.alpha})`;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, p.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      p.r += 2.5;
      p.alpha *= 0.94;
    }

    // ---- Per-source mandala arms ----
    const symmetry = this._symmetry;
    const spread = Math.PI / symmetry; // half-angle of each petal

    // Accumulate average amplitude for center glow
    let totalAmp = 0;
    let srcCount = 0;

    for (const src of this._sources) {
      if (!src.analyser) continue;
      src.analyser.getByteFrequencyData(src._fftData);

      const bins = Math.min(src.bins ?? 32, src.analyser.frequencyBinCount);
      const binStep = Math.floor(src.analyser.frequencyBinCount / bins);
      const baseR = src.baseRadius ?? 80;
      const rScale = src.radiusScale ?? 40;
      const rotMult = src.rotMult ?? 1.0;
      const lw = src.lineWidth ?? 1;
      const alpha = src.alpha ?? 0.6;

      // Avg amplitude for glow
      let sum = 0;
      for (let j = 0; j < bins; j++) sum += src._fftData[j * binStep];
      totalAmp += sum / bins / 255;
      srcCount++;

      ctx.save();
      ctx.strokeStyle = src.color ?? "#0f0";
      ctx.lineWidth = lw;
      ctx.globalAlpha = alpha;

      for (let arm = 0; arm < symmetry; arm++) {
        // Each arm rotates at its own speed (rotMult) creating the spirograph overlap
        const armAngle = (arm / symmetry) * Math.PI * 2 + this._rotation * rotMult;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(armAngle);

        // Bilateral symmetry: draw curve for +side and -side of the arm axis
        for (const sign of [1, -1]) {
          ctx.beginPath();
          for (let j = 0; j < bins; j++) {
            const t = j / (bins - 1 || 1);
            const amp = src._fftData[j * binStep] / 255;
            const r = baseR + amp * rScale;
            // Angle sweeps from 0 (arm axis) outward to ±spread
            const angle = t * spread * sign;
            const x = Math.cos(angle) * r;
            const y = Math.sin(angle) * r;
            if (j === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }

        ctx.restore();
      }

      ctx.restore();
    }

    // ---- Center glow ----
    if (srcCount > 0) {
      const avgAmp = totalAmp / srcCount;
      if (avgAmp > 0.01) {
        const glowR = 8 + avgAmp * 35;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
        grad.addColorStop(0, `rgba(160, 255, 190, ${Math.min(0.9, avgAmp * 0.8)})`);
        grad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.save();
        ctx.globalAlpha = 1;
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    ctx.globalAlpha = 1;
    this._raf = requestAnimationFrame(() => this._drawFrame());
  }
}

customElements.define("web-audio-plant-visualizer", WebAudioPlantVisualizer);
