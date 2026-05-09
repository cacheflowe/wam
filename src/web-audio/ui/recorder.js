import { createCtrl, createSection } from "./slider.js";

/**
 * <wam-recorder> — Web Component for recording master audio (WAV) and
 * optionally the browser tab as video (WebM).
 *
 * Features:
 *   - Audio-only WAV capture via MediaStreamDestination + MediaRecorder
 *   - Video+audio tab capture via getDisplayMedia()
 *   - Perfect loop mode: auto-stop after N sequencer loops (1/2/4/8)
 *   - Bar-aligned start/stop when a sequencer is provided
 *   - Elapsed time display
 *
 * Usage:
 *   const rec = document.createElement("wam-recorder");
 *   rec.init(ctx);
 *   rec.connectFrom(fxUnit);
 *   rec.seq = sequencer;
 *   jamGroup.appendChild(rec);
 */
export default class WebAudioRecorderControls extends HTMLElement {
  constructor() {
    super();
    this._ctx = null;
    this._dest = null;

    // Audio recording state
    this._recorder = null;
    this._chunks = [];
    this._recording = false;
    this._startTime = 0;
    this._rafId = null;
    this._pendingBarStart = null;
    this._pendingBarStop = null;

    // Video recording state
    this._videoRecorder = null;
    this._videoChunks = [];
    this._videoStream = null;
    this._videoRecording = false;

    // Loop count state
    this._loopTarget = 0; // 0 = free record, N = stop after N loops
    this._loopCount = 0;
    this._loopStepCb = null;

    /** Optional sequencer for bar-aligned and loop-count recording. */
    this.seq = null;

    // DOM refs
    this._audioBtn = null;
    this._videoBtn = null;
    this._loopSelect = null;
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
    try {
      (node.output ?? node).disconnect(this._dest);
    } catch (_) {
      /* already disconnected */
    }
    return this;
  }

  get recording() {
    return this._recording;
  }
  get videoRecording() {
    return this._videoRecording;
  }

  /** Elapsed recording time in seconds (audio or video, whichever is active). */
  get elapsed() {
    if (!this._recording && !this._videoRecording) return 0;
    return (performance.now() - this._startTime) / 1000;
  }

  // ---- DOM ----

  _build() {
    const { el, controls } = createSection("Record");

    // Loop count selector
    const loopWrap = createCtrl("Bars", { tooltip: "Auto-stop after N loops. ∞ = free record." });
    this._loopSelect = document.createElement("select");
    this._loopSelect.className = "wam-select wam-rec-loop-select";
    for (const [label, val] of [
      ["∞", 0],
      ["1", 1],
      ["2", 2],
      ["4", 4],
      ["8", 8],
    ]) {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = label;
      this._loopSelect.appendChild(opt);
    }
    this._loopSelect.addEventListener("change", () => {
      this._loopTarget = parseInt(this._loopSelect.value);
    });
    loopWrap.appendChild(this._loopSelect);
    controls.appendChild(loopWrap);

    // Audio record button
    const audioWrap = createCtrl("Audio", { tooltip: "Record master audio output as WAV." });
    this._audioBtn = document.createElement("button");
    this._audioBtn.className = "wam-rec-btn";
    this._audioBtn.textContent = "⏺ Rec";
    this._audioBtn.addEventListener("click", () => this._toggleAudio());
    audioWrap.appendChild(this._audioBtn);
    controls.appendChild(audioWrap);

    // Video record button
    const videoWrap = createCtrl("Video", { tooltip: "Record browser tab as video + audio (WebM)." });
    this._videoBtn = document.createElement("button");
    this._videoBtn.className = "wam-rec-btn wam-rec-video-btn";
    this._videoBtn.textContent = "🎬 Rec";
    this._videoBtn.addEventListener("click", () => this._toggleVideo());
    videoWrap.appendChild(this._videoBtn);
    controls.appendChild(videoWrap);

    // Elapsed timer
    this._timer = document.createElement("span");
    this._timer.className = "wam-rec-timer";
    controls.appendChild(this._timer);

    const wrapper = document.createElement("div");
    wrapper.className = "wam-controls";
    wrapper.appendChild(el);
    this.appendChild(wrapper);
  }

  // ================================================================
  //  AUDIO RECORDING
  // ================================================================

  _toggleAudio() {
    if (this._ctx?.state === "suspended") this._ctx.resume();
    if (this._recording) {
      if (this.seq?.running) {
        this._audioBtn.textContent = "⏳ …";
        this._stopOnBar();
      } else {
        this.stop();
      }
    } else {
      if (this.seq?.running) {
        this._audioBtn.textContent = "⏳ …";
        this._startOnBar();
      } else {
        this.start();
      }
    }
  }

  start() {
    if (this._recording) return;

    this._chunks = [];
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";

    this._recorder = new MediaRecorder(this._dest.stream, { mimeType });
    this._recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this._chunks.push(e.data);
    };
    this._recorder.start(100);
    this._recording = true;
    this._startTime = performance.now();
    this._startLoopCounter();
    this._tickLoop();

    this._audioBtn.classList.add("wam-recording");
    this._audioBtn.textContent = "◼ Stop";
  }

  /**
   * Stop audio recording and trigger a WAV download.
   * @returns {Promise<Blob>} WAV audio blob
   */
  stop() {
    return new Promise((resolve) => {
      if (!this._recording || !this._recorder) {
        this._resetAudioUI();
        resolve(null);
        return;
      }

      this._cancelPending();
      this._stopLoopCounter();
      this._recording = false;
      this._stopTickLoop();

      const recorder = this._recorder;
      this._recorder = null;

      recorder.onstop = async () => {
        let wavBlob = null;
        try {
          const webmBlob = new Blob(this._chunks, { type: recorder.mimeType });
          if (webmBlob.size > 0) {
            wavBlob = await this._convertToWav(webmBlob);
          }
        } catch (err) {
          console.warn("[wam-recorder] WAV conversion failed:", err);
        }

        this._resetAudioUI();

        if (wavBlob) {
          const loops = this._loopTarget > 0 ? `${this._loopTarget}loops-` : "";
          const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
          WebAudioRecorderControls.download(wavBlob, `wam-${loops}${timestamp}.wav`);
        }

        resolve(wavBlob);
      };

      try {
        if (recorder.state !== "inactive") recorder.stop();
        else recorder.onstop();
      } catch (_) {
        this._resetAudioUI();
        resolve(null);
      }
    });
  }

  _resetAudioUI() {
    this._audioBtn.classList.remove("wam-recording");
    this._audioBtn.textContent = "⏺ Rec";
    this._timer.textContent = "";
  }

  // ---- Bar-aligned start/stop ----

  _startOnBar() {
    if (this._recording) return;
    if (!this.seq?.running) {
      this.start();
      return;
    }
    const cb = (step) => {
      if (this._pendingBarStart !== cb) return; // stale callback
      if (step === 0) {
        this._pendingBarStart = null;
        this.start();
      }
    };
    this._pendingBarStart = cb;
    this.seq.onStep(cb);
  }

  _stopOnBar() {
    if (!this._recording) return;
    if (!this.seq?.running) {
      this.stop();
      return;
    }
    const cb = (step) => {
      if (this._pendingBarStop !== cb) return; // stale callback
      if (step === 0) {
        this._pendingBarStop = null;
        this.stop();
      }
    };
    this._pendingBarStop = cb;
    this.seq.onStep(cb);
  }

  // ---- Perfect loop counter ----

  _startLoopCounter() {
    this._loopCount = 0;
    if (this._loopTarget <= 0 || !this.seq) return;

    let started = false;
    const cb = (step) => {
      // Guard: stop firing if this callback is stale or recording already stopped
      if (this._loopStepCb !== cb || !this._recording) return;
      if (step !== 0) return;
      if (!started) {
        // Skip the first step-0 — that's the start of recording, not a completed loop
        started = true;
        return;
      }
      this._loopCount++;
      this._updateLoopDisplay();
      if (this._loopCount >= this._loopTarget) {
        this.stop();
      }
    };
    this._loopStepCb = cb;
    this.seq.onStep(this._loopStepCb);
  }

  _stopLoopCounter() {
    this._loopStepCb = null;
    this._loopCount = 0;
  }

  _updateLoopDisplay() {
    if (this._loopTarget > 0 && this._timer) {
      const remaining = this._loopTarget - this._loopCount;
      this._timer.setAttribute("data-loops", `${this._loopCount}/${this._loopTarget}`);
    }
  }

  // ================================================================
  //  VIDEO RECORDING (tab capture via getDisplayMedia)
  // ================================================================

  async _toggleVideo() {
    if (this._videoRecording) {
      this._stopVideo();
    } else {
      await this._startVideo();
    }
  }

  async _startVideo() {
    if (this._videoRecording) return;

    try {
      // Request tab capture — browser will show a permission dialog
      this._videoStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: "browser",
          width: { ideal: 4096 },
          height: { ideal: 2160 },
          frameRate: { ideal: 60 },
        },
        audio: false, // we mix in our own high-quality audio below
        preferCurrentTab: true,
      });
    } catch (_) {
      // User cancelled the permission dialog
      return;
    }

    // Combine video track from screen capture + audio track from our tap
    const combined = new MediaStream([...this._videoStream.getVideoTracks(), ...this._dest.stream.getAudioTracks()]);

    this._videoChunks = [];
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus"
      : "video/webm";

    this._videoRecorder = new MediaRecorder(combined, {
      mimeType,
      videoBitsPerSecond: 20_000_000, // 20 Mbps for high-quality output
    });
    this._videoRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this._videoChunks.push(e.data);
    };

    // Auto-stop if the user stops sharing via the browser's built-in UI
    this._videoStream.getVideoTracks()[0].addEventListener("ended", () => {
      if (this._videoRecording) this._stopVideo();
    });

    this._videoRecorder.start(100);
    this._videoRecording = true;
    this._startTime = performance.now();
    this._tickLoop();

    this._videoBtn.classList.add("wam-recording");
    this._videoBtn.textContent = "◼ Stop";
  }

  _stopVideo() {
    if (!this._videoRecording || !this._videoRecorder) {
      this._resetVideoUI();
      return;
    }

    this._videoRecording = false;
    this._stopTickLoop();

    const recorder = this._videoRecorder;
    this._videoRecorder = null;

    recorder.onstop = () => {
      let blob = null;
      try {
        blob = new Blob(this._videoChunks, { type: recorder.mimeType });
      } catch (err) {
        console.warn("[wam-recorder] Video blob creation failed:", err);
      }

      this._resetVideoUI();

      if (blob?.size > 0) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        WebAudioRecorderControls.download(blob, `wam-video-${timestamp}.webm`);
      }
    };

    try {
      if (recorder.state !== "inactive") recorder.stop();
      else recorder.onstop();
    } catch (_) {
      this._resetVideoUI();
    }
  }

  _resetVideoUI() {
    this._videoBtn.classList.remove("wam-recording");
    this._videoBtn.textContent = "🎬 Rec";
    this._timer.textContent = "";
    this._videoStream?.getTracks().forEach((t) => t.stop());
    this._videoStream = null;
  }

  // ================================================================
  //  SHARED UTILITIES
  // ================================================================

  // ---- Elapsed time tick ----

  _tickLoop() {
    if (!this._recording && !this._videoRecording) return;
    const m = Math.floor(this.elapsed / 60);
    const s = Math.floor(this.elapsed % 60);
    let display = `${m}:${s.toString().padStart(2, "0")}`;
    if (this._recording && this._loopTarget > 0) {
      display += ` (${this._loopCount}/${this._loopTarget})`;
    }
    this._timer.textContent = display;
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
        const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
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
