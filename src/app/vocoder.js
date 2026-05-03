import WebAudioVocoder from "../web-audio/instruments/wam-vocoder.js";
import WebAudioSynthFM from "../web-audio/instruments/wam-synth-fm.js";
import WebAudioSynthMono from "../web-audio/instruments/wam-synth-mono.js";
import "../web-audio/ui/wam-waveform.js";
import "../web-audio/ui/wam-level-meter.js";

// QWERTY piano — two rows covering C3 to E4
const KEY_NOTE_MAP = {
  a: 48,
  w: 49,
  s: 50,
  e: 51,
  d: 52,
  f: 53,
  t: 54,
  g: 55,
  y: 56,
  h: 57,
  u: 58,
  j: 59,
  k: 60,
  o: 61,
  l: 62,
  p: 63,
  ";": 64,
};

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
function midiToName(midi) {
  return NOTE_NAMES[midi % 12] + Math.floor(midi / 12 - 1);
}

class VocoderApp extends HTMLElement {
  connectedCallback() {
    this._ctx = null;
    this._vocoder = null;
    this._activeKeys = new Set();
    this._micAnalyser = null;

    // Carrier mode: "builtin" | "fm" | "mono"
    this._carrierMode = "builtin";
    this._builtinCarrierType = "sawtooth";
    this._fmCarrier = null;
    this._monoCarrier = null;
    this._fmControls = null;
    this._monoControls = null;
    this._externalCarrierNode = null;

    this.buildUI();
    this.addCSS();
    this._setupKeyboard();
  }

  // ---- Audio ----

  _initAudio() {
    if (this._vocoder) return;
    if (!this._ctx) this._ctx = new AudioContext({ latencyHint: "interactive" });
    this._vocoder = new WebAudioVocoder(this._ctx);
    this._vocoder.connect(this._ctx.destination);

    const analyser = this._ctx.createAnalyser();
    analyser.fftSize = 2048;
    this._vocoder._out.connect(analyser);
    this._waveform.init(analyser, "#7c6cff");
  }

  async _toggleMic() {
    this._initAudio();
    if (!this._vocoder) return;
    if (this._vocoder.micActive) {
      this._vocoder.stopMic();
      this._micBtn.textContent = "🎤 Connect Mic";
      this._micBtn.classList.remove("vc-active");
      this._micStatus.textContent = "Mic off";
      this._micStatus.classList.remove("vc-mic-on");
    } else {
      this._micBtn.textContent = "Connecting…";
      this._micBtn.disabled = true;
      try {
        await this._vocoder.startMic();
        this._micBtn.textContent = "🎤 Disconnect Mic";
        this._micBtn.classList.add("vc-active");
        this._micStatus.textContent = "Mic active";
        this._micStatus.classList.add("vc-mic-on");
        this._connectMicMeter();
      } catch (err) {
        this._micBtn.textContent = "🎤 Connect Mic";
        this._micStatus.textContent = `Mic error: ${err.message}`;
      }
      this._micBtn.disabled = false;
    }
  }

  _connectMicMeter() {
    if (this._micAnalyser) return;
    this._micAnalyser = this._ctx.createAnalyser();
    this._micAnalyser.fftSize = 1024;
    this._vocoder._inputGain.connect(this._micAnalyser);
    this.querySelector("#micMeter").setAnalyser(this._micAnalyser);
  }

  _togglePlay() {
    this._initAudio();
    if (!this._vocoder) return;
    if (this._vocoder.playing) {
      this._vocoder.stop();
      this._playBtn.textContent = "▶ Play";
      this._playBtn.classList.remove("vc-active");
    } else {
      if (this._ctx.state === "suspended") this._ctx.resume();
      this._vocoder.play();
      this._playBtn.textContent = "◼ Stop";
      this._playBtn.classList.add("vc-active");
    }
  }

  // ---- Carrier mode ----

  _setCarrierMode(mode) {
    if (this._carrierMode === mode) return;
    this._initAudio();
    if (!this._vocoder) return;

    // Disconnect previous external carrier from vocoder
    if (this._externalCarrierNode) {
      try {
        this._externalCarrierNode.disconnect(this._vocoder.carrierInput);
      } catch (_) {}
      this._externalCarrierNode = null;
    }

    this._carrierMode = mode;

    const builtinControls = this.querySelector("#builtinControls");
    const extPanel = this.querySelector("#extCarrierPanel");

    if (mode === "builtin") {
      this._vocoder.carrierType = this._builtinCarrierType;
      builtinControls.style.display = "";
      extPanel.style.display = "none";
    } else {
      this._vocoder.carrierType = "external";
      builtinControls.style.display = "none";
      extPanel.style.display = "";
      this._activateExternalCarrier(mode);
    }

    // Update source button states
    this.querySelectorAll(".vc-src-btn").forEach((b) => b.classList.toggle("vc-src-active", b.dataset.source === mode));
  }

  _activateExternalCarrier(mode) {
    const panel = this.querySelector("#extCarrierPanel");

    if (mode === "fm") {
      if (!this._fmCarrier) {
        this._fmCarrier = new WebAudioSynthFM(this._ctx);
        this._fmControls = document.createElement("wam-synth-fm-controls");
        panel.innerHTML = `<div class="vc-ext-label">FM Synth Carrier</div>`;
        panel.appendChild(this._fmControls);
        this._fmControls.bind(this._fmCarrier, this._ctx, { color: "#4df", fx: { bpm: 120 } });
      }
      this._fmCarrier._out.connect(this._vocoder.carrierInput);
      this._externalCarrierNode = this._fmCarrier._out;
    } else if (mode === "mono") {
      if (!this._monoCarrier) {
        this._monoCarrier = new WebAudioSynthMono(this._ctx);
        this._monoControls = document.createElement("wam-synth-mono-controls");
        panel.innerHTML = `<div class="vc-ext-label">Mono Synth Carrier</div>`;
        panel.appendChild(this._monoControls);
        this._monoControls.bind(this._monoCarrier, this._ctx, { color: "#6df", fx: { bpm: 120 } });
      }
      this._monoCarrier._out.connect(this._vocoder.carrierInput);
      this._externalCarrierNode = this._monoCarrier._out;
    }
  }

  // ---- Carrier note trigger ----

  _triggerCarrierNote(midi) {
    if (!this._vocoder) return;
    if (this._ctx.state === "suspended") this._ctx.resume();
    if (!this._vocoder.playing) {
      this._vocoder.play();
      this._playBtn.textContent = "◼ Stop";
      this._playBtn.classList.add("vc-active");
    }
    const now = this._ctx.currentTime;
    if (this._carrierMode === "builtin") {
      const hz = midiToFreq(midi);
      this._vocoder.carrierFreq = hz;
      this._syncPitchFromFreq(hz);
    } else if (this._carrierMode === "fm" && this._fmCarrier) {
      this._fmCarrier.trigger([midi], 4.0, now);
    } else if (this._carrierMode === "mono" && this._monoCarrier) {
      this._monoCarrier.trigger(midi, 4.0, 0.8, now);
    }
    const name = midiToName(midi);
    const hz = Math.round(midiToFreq(midi));
    this.querySelector("#noteDisplay").textContent = `${name} · ${hz} Hz`;
  }

  // ---- Keyboard jam ----

  _setupKeyboard() {
    document.addEventListener("keydown", (e) => {
      if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
      if (e.repeat) return;
      const key = e.key.toLowerCase();
      if (key === " ") {
        e.preventDefault();
        this._togglePlay();
        return;
      }
      const midi = KEY_NOTE_MAP[key];
      if (midi == null) return;
      this._initAudio();
      this._activeKeys.add(key);
      this._triggerCarrierNote(midi);
      this._highlightKey(key, true);
    });

    document.addEventListener("keyup", (e) => {
      const key = e.key.toLowerCase();
      this._activeKeys.delete(key);
      this._highlightKey(key, false);
    });
  }

  _syncPitchFromFreq(hz) {
    if (this._pitchSlider) this._pitchSlider.value = Math.log2(hz / 20) / Math.log2(20000 / 20);
    if (this._pitchLabel) this._pitchLabel.textContent = `${Math.round(hz)} Hz`;
  }

  _highlightKey(key, on) {
    const el = this.querySelector(`[data-key="${key}"]`);
    if (el) el.classList.toggle("vc-key-active", on);
  }

  // ---- UI ----

  buildUI() {
    this.innerHTML = /* html */ `
      <div class="vc-layout">

        <header class="vc-header">
          <h2>🎙 Vocoder</h2>
          <div class="vc-transport">
            <button class="vc-btn vc-mic-btn" id="micBtn">🎤 Connect Mic</button>
            <wam-level-meter id="micMeter"></wam-level-meter>
            <span class="vc-mic-status" id="micStatus">Mic off</span>
            <button class="vc-btn vc-play-btn" id="playBtn">▶ Play</button>
          </div>
        </header>

        <div class="vc-columns">

          <!-- Left: carrier + pitch -->
          <section class="vc-section">
            <div class="vc-section-title">Carrier</div>

            <div class="vc-source-row" id="sourceRow">
              <button class="vc-src-btn vc-src-active" data-source="builtin">BUILT-IN</button>
              <button class="vc-src-btn" data-source="fm">FM SYNTH</button>
              <button class="vc-src-btn" data-source="mono">MONO SYNTH</button>
            </div>

            <div id="builtinControls">
              <div class="vc-carrier-row" id="carrierRow">
                <button class="vc-wave-btn vc-wave-active" data-type="sawtooth">SAW</button>
                <button class="vc-wave-btn" data-type="square">SQR</button>
                <button class="vc-wave-btn" data-type="triangle">TRI</button>
                <button class="vc-wave-btn" data-type="sine">SIN</button>
                <button class="vc-wave-btn" data-type="noise">NOI</button>
              </div>

              <label class="vc-label">
                <span>Pitch</span>
                <span class="vc-val" id="pitchLabel">220 Hz</span>
              </label>
              <input type="range" class="vc-range" id="pitchSlider"
                min="0" max="1" step="0.001" value="0.317">
            </div>

            <label class="vc-label">
              <span>Formant</span>
              <span class="vc-val" id="formantLabel">0 st</span>
            </label>
            <input type="range" class="vc-range" id="formantSlider"
              min="-12" max="12" step="0.5" value="0">
          </section>

          <!-- Middle: analysis params -->
          <section class="vc-section">
            <div class="vc-section-title">Analysis</div>

            <label class="vc-label">
              <span>Sensitivity</span>
              <span class="vc-val" id="sensitivityLabel">10</span>
            </label>
            <input type="range" class="vc-range" id="sensitivitySlider"
              min="1" max="200" step="1" value="10">

            <label class="vc-label">
              <span>Gate</span>
              <span class="vc-val" id="gateLabel">0.05</span>
            </label>
            <input type="range" class="vc-range" id="gateSlider"
              min="0" max="0.3" step="0.005" value="0.05">

            <label class="vc-label">
              <span>Env Speed</span>
              <span class="vc-val" id="envSpeedLabel">20 Hz</span>
            </label>
            <input type="range" class="vc-range" id="envSpeedSlider"
              min="1" max="100" step="1" value="20">

            <label class="vc-label">
              <span>Band Q</span>
              <span class="vc-val" id="filterQLabel">3.5</span>
            </label>
            <input type="range" class="vc-range" id="filterQSlider"
              min="0.5" max="12" step="0.1" value="3.5">

            <label class="vc-label">
              <span>Volume</span>
              <span class="vc-val" id="volumeLabel">0.8</span>
            </label>
            <input type="range" class="vc-range" id="volumeSlider"
              min="0" max="1" step="0.01" value="0.8">
          </section>

          <!-- Right: keyboard -->
          <section class="vc-section vc-kb-section">
            <div class="vc-section-title">Keyboard <span class="vc-hint">(triggers carrier)</span></div>
            <div class="vc-keyboard" id="keyboard"></div>
            <div class="vc-note-display" id="noteDisplay">A3 · 220 Hz</div>
          </section>

        </div>

        <!-- External carrier instrument controls (shown when FM / MONO selected) -->
        <div id="extCarrierPanel" style="display:none"></div>

        <wam-waveform id="waveform" class="vc-waveform"></wam-waveform>
      </div>
    `;

    this._micBtn = this.querySelector("#micBtn");
    this._micStatus = this.querySelector("#micStatus");
    this._playBtn = this.querySelector("#playBtn");
    this._waveform = this.querySelector("#waveform");
    this._pitchSlider = this.querySelector("#pitchSlider");
    this._pitchLabel = this.querySelector("#pitchLabel");

    this._micBtn.addEventListener("click", () => this._toggleMic());
    this._playBtn.addEventListener("click", () => this._togglePlay());

    this._buildKeyboard();
    this._wireSliders();
    this._wireCarrierButtons();
    this._wireSourceButtons();
  }

  _buildKeyboard() {
    const kb = this.querySelector("#keyboard");
    const layout = [
      { key: "a", midi: 48, black: false },
      { key: "w", midi: 49, black: true },
      { key: "s", midi: 50, black: false },
      { key: "e", midi: 51, black: true },
      { key: "d", midi: 52, black: false },
      { key: "f", midi: 53, black: false },
      { key: "t", midi: 54, black: true },
      { key: "g", midi: 55, black: false },
      { key: "y", midi: 56, black: true },
      { key: "h", midi: 57, black: false },
      { key: "u", midi: 58, black: true },
      { key: "j", midi: 59, black: false },
      { key: "k", midi: 60, black: false },
      { key: "o", midi: 61, black: true },
      { key: "l", midi: 62, black: false },
      { key: "p", midi: 63, black: true },
      { key: ";", midi: 64, black: false },
    ];

    layout.forEach(({ key, midi, black }) => {
      const btn = document.createElement("button");
      btn.className = `vc-key ${black ? "vc-key-black" : "vc-key-white"}`;
      btn.dataset.key = key;
      btn.title = `${midiToName(midi)} (${key.toUpperCase()})`;
      btn.innerHTML = `<span class="vc-key-label">${key.toUpperCase()}</span>`;

      btn.addEventListener("mousedown", () => {
        this._initAudio();
        this._activeKeys.add(key);
        this._triggerCarrierNote(midi);
        btn.classList.add("vc-key-active");
      });
      btn.addEventListener("mouseup", () => {
        this._activeKeys.delete(key);
        btn.classList.remove("vc-key-active");
      });
      btn.addEventListener("mouseleave", () => {
        this._activeKeys.delete(key);
        btn.classList.remove("vc-key-active");
      });

      kb.appendChild(btn);
    });
  }

  _wireSliders() {
    const pitchEl = this.querySelector("#pitchSlider");
    const pitchLbl = this.querySelector("#pitchLabel");
    const sliderToHz = (v) => 20 * Math.pow(20000 / 20, parseFloat(v));
    pitchEl.addEventListener("input", () => {
      const hz = sliderToHz(pitchEl.value);
      pitchLbl.textContent = `${Math.round(hz)} Hz`;
      this.querySelector("#noteDisplay").textContent = `${Math.round(hz)} Hz`;
      if (this._vocoder && this._carrierMode === "builtin") this._vocoder.carrierFreq = hz;
    });

    const formantEl = this.querySelector("#formantSlider");
    const formantLbl = this.querySelector("#formantLabel");
    formantEl.addEventListener("input", () => {
      const v = parseFloat(formantEl.value);
      formantLbl.textContent = `${v > 0 ? "+" : ""}${v} st`;
      if (this._vocoder) this._vocoder.formantShift = v;
    });

    const sensEl = this.querySelector("#sensitivitySlider");
    const sensLbl = this.querySelector("#sensitivityLabel");
    sensEl.addEventListener("input", () => {
      const v = parseFloat(sensEl.value);
      sensLbl.textContent = v.toFixed(1);
      if (this._vocoder) this._vocoder.sensitivity = v;
    });

    const gateEl = this.querySelector("#gateSlider");
    const gateLbl = this.querySelector("#gateLabel");
    gateEl.addEventListener("input", () => {
      const v = parseFloat(gateEl.value);
      gateLbl.textContent = v.toFixed(3);
      if (this._vocoder) this._vocoder.gate = v;
    });

    const envEl = this.querySelector("#envSpeedSlider");
    const envLbl = this.querySelector("#envSpeedLabel");
    envEl.addEventListener("input", () => {
      const v = parseFloat(envEl.value);
      envLbl.textContent = `${Math.round(v)} Hz`;
      if (this._vocoder) this._vocoder.envSpeed = v;
    });

    const qEl = this.querySelector("#filterQSlider");
    const qLbl = this.querySelector("#filterQLabel");
    qEl.addEventListener("input", () => {
      const v = parseFloat(qEl.value);
      qLbl.textContent = v.toFixed(1);
      if (this._vocoder) this._vocoder.filterQ = v;
    });

    const volEl = this.querySelector("#volumeSlider");
    const volLbl = this.querySelector("#volumeLabel");
    volEl.addEventListener("input", () => {
      const v = parseFloat(volEl.value);
      volLbl.textContent = v.toFixed(2);
      if (this._vocoder) this._vocoder.volume = v;
    });
  }

  _wireCarrierButtons() {
    const row = this.querySelector("#carrierRow");
    row.querySelectorAll(".vc-wave-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        row.querySelectorAll(".vc-wave-btn").forEach((b) => b.classList.remove("vc-wave-active"));
        btn.classList.add("vc-wave-active");
        this._builtinCarrierType = btn.dataset.type;
        this._initAudio();
        if (this._vocoder && this._carrierMode === "builtin") {
          this._vocoder.carrierType = btn.dataset.type;
        }
      });
    });
  }

  _wireSourceButtons() {
    this.querySelector("#sourceRow")
      .querySelectorAll(".vc-src-btn")
      .forEach((btn) => {
        btn.addEventListener("click", () => this._setCarrierMode(btn.dataset.source));
      });
  }

  disconnectedCallback() {
    this._vocoder?.destroy();
    this._ctx?.close();
  }

  addCSS() {
    const s = document.createElement("style");
    s.textContent = /* css */ `
      vocoder-app {
        display: block;
        font-family: monospace;
        background: #0a0a12;
        color: #c8c8e0;
        min-height: 100vh;
        padding: 1rem;
      }

      .vc-layout { max-width: 960px; margin: 0 auto; }

      .vc-header {
        display: flex;
        align-items: center;
        gap: 1.5rem;
        padding-bottom: 1rem;
        border-bottom: 1px solid #1e1e2e;
        margin-bottom: 1rem;
      }
      .vc-header h2 { margin: 0; color: #9b8dff; font-size: 1.4rem; }

      .vc-transport { display: flex; align-items: center; gap: 0.75rem; }
      .vc-transport wam-level-meter { height: 28px; }

      .vc-btn {
        font-family: monospace;
        font-size: 0.85rem;
        padding: 6px 14px;
        border-radius: 4px;
        cursor: pointer;
        border: 1px solid #444;
        background: #111122;
        color: #c8c8e0;
        transition: background 0.15s, color 0.15s;
      }
      .vc-btn:hover { background: #1e1e3a; }
      .vc-btn:disabled { opacity: 0.5; cursor: default; }
      .vc-btn.vc-active { background: #2a2060; border-color: #9b8dff; color: #c8b8ff; }
      .vc-mic-btn.vc-active { background: #1a3020; border-color: #4caf50; color: #80e090; }
      .vc-play-btn.vc-active { background: #3a1020; border-color: #f44; color: #ff9999; }

      .vc-mic-status {
        font-size: 0.75rem;
        color: #555;
        min-width: 80px;
      }
      .vc-mic-status.vc-mic-on { color: #4caf50; }

      .vc-columns {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 1rem;
        margin-bottom: 1rem;
      }

      .vc-section {
        background: #0d0d1a;
        border: 1px solid #1e1e2e;
        border-radius: 6px;
        padding: 0.75rem;
      }

      .vc-section-title {
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: #666;
        margin-bottom: 0.6rem;
      }

      .vc-hint { font-size: 0.65rem; color: #444; text-transform: none; letter-spacing: 0; }

      .vc-label {
        display: flex;
        justify-content: space-between;
        font-size: 0.75rem;
        color: #888;
        margin-top: 0.5rem;
        margin-bottom: 2px;
      }
      .vc-val { color: #9b8dff; }

      .vc-range {
        width: 100%;
        accent-color: #7c6cff;
        margin-bottom: 0.2rem;
      }

      /* Source selector */
      .vc-source-row {
        display: flex;
        gap: 4px;
        margin-bottom: 0.6rem;
      }
      .vc-src-btn {
        font-family: monospace;
        font-size: 0.65rem;
        padding: 3px 6px;
        border: 1px solid #333;
        border-radius: 3px;
        background: #111;
        color: #666;
        cursor: pointer;
        flex: 1;
        white-space: nowrap;
      }
      .vc-src-btn:hover { border-color: #9b8dff; color: #bbb; }
      .vc-src-btn.vc-src-active { background: #1e1844; border-color: #9b8dff; color: #c8b8ff; }

      .vc-carrier-row {
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
        margin-bottom: 0.5rem;
      }
      .vc-wave-btn {
        font-family: monospace;
        font-size: 0.7rem;
        padding: 3px 7px;
        border: 1px solid #333;
        border-radius: 3px;
        background: #111;
        color: #888;
        cursor: pointer;
        flex: 1;
      }
      .vc-wave-btn:hover { border-color: #7c6cff; color: #bbb; }
      .vc-wave-btn.vc-wave-active { background: #1e1844; border-color: #7c6cff; color: #c8b8ff; }

      /* External carrier panel */
      #extCarrierPanel {
        margin-bottom: 1rem;
        border: 1px solid #2a2040;
        border-radius: 6px;
        padding: 0.5rem;
        background: #0a0a16;
      }
      .vc-ext-label {
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: #9b8dff;
        margin-bottom: 0.5rem;
      }

      /* ---- Keyboard ---- */
      .vc-kb-section { overflow: hidden; }

      .vc-keyboard {
        position: relative;
        display: flex;
        height: 80px;
        gap: 2px;
        margin-bottom: 0.5rem;
        user-select: none;
      }

      .vc-key {
        cursor: pointer;
        border-radius: 0 0 3px 3px;
        display: flex;
        align-items: flex-end;
        justify-content: center;
        padding-bottom: 4px;
        font-size: 0.55rem;
        font-family: monospace;
        border: none;
        transition: background 0.05s;
      }
      .vc-key-label { color: inherit; pointer-events: none; }

      .vc-key-white {
        flex: 1;
        background: #e8e0ff;
        color: #8870cc;
        min-width: 18px;
      }
      .vc-key-black {
        flex: 0.6;
        background: #1a1428;
        color: #7c6cff;
        height: 55px;
        align-self: flex-start;
        border: 1px solid #3a2c60;
        min-width: 12px;
      }
      .vc-key-white:hover { background: #d8d0ff; }
      .vc-key-black:hover { background: #251c40; }
      .vc-key-white.vc-key-active { background: #9b8dff; color: #fff; }
      .vc-key-black.vc-key-active { background: #4c3ca8; color: #fff; }

      .vc-note-display {
        font-size: 0.8rem;
        color: #7c6cff;
        text-align: center;
        padding: 4px;
        background: #060610;
        border-radius: 3px;
      }

      wam-waveform.vc-waveform {
        display: block;
        height: 60px;
        background: #060610;
        border-radius: 4px;
        border: 1px solid #1e1e2e;
      }

      @media (max-width: 620px) {
        .vc-columns { grid-template-columns: 1fr; }
      }
    `;
    document.head.appendChild(s);
  }
}

customElements.define("vocoder-app", VocoderApp);
