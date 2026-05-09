/**
 * <wam-recorder> — Web Component that captures master audio output as WAV.
 *
 * Renders a Record button + elapsed timer. Uses MediaStreamDestination to
 * tap the audio graph, records as webm/opus, then converts to WAV on stop
 * for a clean browser download.
 *
 * Transport-aware: can defer start/stop to the next bar boundary when a
 * sequencer reference is set, so exports loop cleanly.
 *
 * Usage:
 *   const rec = document.createElement("wam-recorder");
 *   rec.init(ctx);
 *   rec.connectFrom(fxUnit);        // tap the post-FX output
 *   rec.seq = sequencer;            // optional: bar-aligned start/stop
 *   jamGroup.appendChild(rec);
 */
export default class WebAudioRecorderControls extends HTMLElement {
  constructor() {
    super();
    this._ctx = null;
    this._dest = null;
    this._recorder = null;
    this._chunks = [];
    this._recording = false;
    this._startTime = 0;
    this._rafId = null;
    this._pendingBarStart = null;
    this._pendingBarStop = null;

    /** Optional sequencer for bar-aligned recording. */
    this.seq = null;

    this._btn = null;
    this._timer = null;
  }

  /**
   * @param {AudioContext} ctx
   */
  init(ctx) {
    this._ctx = ctx;
    this._dest = ctx.createMediaStreamDestination();
    this._build();
  }

  /** Connect an audio node's output into the recorder tap. */
  connectFrom(node) {
    (node.output ?? node).connect(this._dest);
    return this;
  }

  /** Disconnect the recorder tap. */
  disconnectFrom(node) {
    try { (node.output ?? node).disconnect(this._dest); } catch (_) { /* already disconnected */ }
    return this;
  }

  get recording() { return this._recording; }

  /** Elapsed recording time in seconds. */
  get elapsed() {
    if (!this._recording) return 0;
    return (performance.now() - this._startTime) / 1000;
  }

  // ---- DOM ----

  _build() {
    this.style.display = "contents";

    this._btn = document.createElement("button");
    this._btn.className = "wam-rec-btn";
    this._btn.textContent = "⏺ Rec";
    this._btn.title = "Record master output as WAV";
    this._btn.addEventListener("click", () => this._toggle());
    this.appendChild(this._btn);

    this._timer = document.createElement("span");
    this._timer.className = "wam-rec-timer";
    this.appendChild(this._timer);
  }

  // ---- Toggle ----

  _toggle() {
    if (this._ctx?.state === "suspended") this._ctx.resume();
    if (this._recording) {
      if (this.seq?.running) {
        this._btn.textContent = "⏳ …";
        this._stopOnBar();
      } else {
        this.stop();
      }
    } else {
      if (this.seq?.running) {
        this._btn.textContent = "⏳ …";
        this._startOnBar();
      } else {
        this.start();
      }
    }
  }

  // ---- Immediate start/stop ----

  start() {
    if (this._recording) return;

    this._chunks = [];
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";

    this._recorder = new MediaRecorder(this._dest.stream, { mimeType });
    this._recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this._chunks.push(e.data);
    };
    this._recorder.start(100);
    this._recording = true;
    this._startTime = performance.now();
    this._tickLoop();

    this._btn.classList.add("wam-recording");
    this._btn.textContent = "◼ Stop";
  }

  /**
   * Stop recording and trigger a WAV download.
   * @returns {Promise<Blob>} WAV audio blob
   */
  stop() {
    return new Promise((resolve) => {
      if (!this._recording || !this._recorder) {
        resolve(null);
        return;
      }

      this._cancelPending();
      this._recording = false;
      this._stopTickLoop();

      this._recorder.onstop = async () => {
        const webmBlob = new Blob(this._chunks, { type: this._recorder.mimeType });
        const wavBlob = await this._convertToWav(webmBlob);

        this._btn.classList.remove("wam-recording");
        this._btn.textContent = "⏺ Rec";
        this._timer.textContent = "";

        if (wavBlob) {
          const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
          WebAudioRecorderControls.download(wavBlob, `wam-${timestamp}.wav`);
        }

        resolve(wavBlob);
      };
      this._recorder.stop();
    });
  }

  // ---- Bar-aligned start/stop ----

  _startOnBar() {
    if (this._recording) return;
    if (!this.seq?.running) { this.start(); return; }
    this._pendingBarStart = (step) => {
      if (step === 0) {
        this._pendingBarStart = null;
        this.start();
      }
    };
    this.seq.onStep(this._pendingBarStart);
  }

  _stopOnBar() {
    if (!this._recording) return;
    if (!this.seq?.running) { this.stop(); return; }
    this._pendingBarStop = (step) => {
      if (step === 0) {
        this._pendingBarStop = null;
        this.stop();
      }
    };
    this.seq.onStep(this._pendingBarStop);
  }

  // ---- Elapsed time tick ----

  _tickLoop() {
    if (!this._recording) return;
    const m = Math.floor(this.elapsed / 60);
    const s = Math.floor(this.elapsed % 60);
    this._timer.textContent = `${m}:${s.toString().padStart(2, "0")}`;
    this._rafId = requestAnimationFrame(() => this._tickLoop());
  }

  _stopTickLoop() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  _cancelPending() {
    this._pendingBarStart = null;
    this._pendingBarStop = null;
  }

  // ---- WebM → WAV conversion ----

  async _convertToWav(webmBlob) {
    const arrayBuffer = await webmBlob.arrayBuffer();
    const audioBuffer = await this._ctx.decodeAudioData(arrayBuffer);
    return this._encodeWav(audioBuffer);
  }

  _encodeWav(audioBuffer) {
    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const length = audioBuffer.length;
    const bytesPerSample = 2;
    const dataSize = length * numChannels * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    this._writeString(view, 0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    this._writeString(view, 8, "WAVE");

    this._writeString(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
    view.setUint16(32, numChannels * bytesPerSample, true);
    view.setUint16(34, bytesPerSample * 8, true);

    this._writeString(view, 36, "data");
    view.setUint32(40, dataSize, true);

    const channels = [];
    for (let ch = 0; ch < numChannels; ch++) {
      channels.push(audioBuffer.getChannelData(ch));
    }

    let offset = 44;
    for (let i = 0; i < length; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = Math.max(-1, Math.min(1, channels[ch][i]));
        const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        view.setInt16(offset, int16, true);
        offset += 2;
      }
    }

    return new Blob([buffer], { type: "audio/wav" });
  }

  _writeString(view, offset, str) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  // ---- Download helper ----

  static download(blob, filename = "recording.wav") {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
}

customElements.define("wam-recorder", WebAudioRecorderControls);
