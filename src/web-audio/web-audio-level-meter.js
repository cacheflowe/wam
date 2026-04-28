/**
 * <web-audio-level-meter> — compact vertical VU meter driven by an AnalyserNode.
 *
 * Usage:
 *   const meter = document.createElement("web-audio-level-meter");
 *   container.appendChild(meter);
 *   meter.setAnalyser(ctx.createAnalyser());
 */
export default class WebAudioLevelMeter extends HTMLElement {
  static #cssInjected = false;

  constructor() {
    super();
    this._analyser = null;
    this._buffer = null;
    this._rafId = null;
    this._canvas = null;
    this._peak = 0;
    this._peakHold = 0;
  }

  connectedCallback() {
    WebAudioLevelMeter.#injectCSS();
    if (!this._canvas) {
      this._canvas = document.createElement("canvas");
      this._canvas.width = 10;
      this._canvas.height = 36;
      this.appendChild(this._canvas);
    }
    if (this._analyser) this._start();
  }

  disconnectedCallback() {
    this._stop();
  }

  setAnalyser(analyser) {
    this._analyser = analyser;
    this._buffer = new Float32Array(analyser.fftSize);
    if (this.isConnected) this._start();
  }

  _start() {
    if (this._rafId) return;
    const tick = () => {
      this._rafId = requestAnimationFrame(tick);
      this._draw();
    };
    tick();
  }

  _stop() {
    cancelAnimationFrame(this._rafId);
    this._rafId = null;
  }

  _draw() {
    if (!this._analyser || !this._canvas) return;
    this._analyser.getFloatTimeDomainData(this._buffer);

    let sum = 0;
    for (let i = 0; i < this._buffer.length; i++) sum += this._buffer[i] ** 2;
    const rms = Math.sqrt(sum / this._buffer.length);
    const level = Math.min(1, rms * 3.5);

    if (level > this._peak) {
      this._peak = level;
      this._peakHold = 50;
    } else if (this._peakHold > 0) {
      this._peakHold--;
    } else {
      this._peak = Math.max(0, this._peak - 0.008);
    }

    const ctx = this._canvas.getContext("2d");
    const w = this._canvas.width;
    const h = this._canvas.height;

    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, w, h);

    const barH = Math.round(level * h);
    if (barH > 0) {
      const grad = ctx.createLinearGradient(0, h, 0, 0);
      grad.addColorStop(0, "#0f0");
      grad.addColorStop(0.65, "#cf0");
      grad.addColorStop(0.85, "#f80");
      grad.addColorStop(1, "#f00");
      ctx.fillStyle = grad;
      ctx.fillRect(0, h - barH, w, barH);
    }

    if (this._peak > 0.01) {
      const py = Math.max(0, Math.round((1 - this._peak) * h));
      ctx.fillStyle = this._peak > 0.88 ? "#f44" : "#aaa";
      ctx.fillRect(0, py, w, 2);
    }
  }

  static #injectCSS() {
    if (WebAudioLevelMeter.#cssInjected) return;
    WebAudioLevelMeter.#cssInjected = true;
    const s = document.createElement("style");
    s.textContent = `
      web-audio-level-meter {
        display: flex;
        align-items: stretch;
        flex-shrink: 0;
      }
      web-audio-level-meter canvas {
        display: block;
        border-radius: 2px;
      }
    `;
    document.head.appendChild(s);
  }
}

customElements.define("web-audio-level-meter", WebAudioLevelMeter);
