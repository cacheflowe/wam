import WebAudioSequencer from "../web-audio/global/wam-sequencer.js";
import WebAudioSynthAcid from "../web-audio/instruments/wam-synth-acid.js";
import WebAudioSynth808 from "../web-audio/instruments/wam-synth-808.js";
import WebAudioSynthBlipFX from "../web-audio/instruments/wam-synth-blipfx.js";
import WebAudioBreakPlayer from "../web-audio/instruments/wam-break-player.js";
import WebAudioSynthFM from "../web-audio/instruments/wam-synth-fm.js";
import WebAudioPercKick from "../web-audio/instruments/wam-perc-kick.js";
import WebAudioPercHihat from "../web-audio/instruments/wam-perc-hihat.js";
import WebAudioPercSnare from "../web-audio/instruments/wam-perc-snare.js";
import "../web-audio/ui/wam-transport.js";

const BASE_PATH = "/audio/breaks/";
const BREAK_FILES = [
  { label: "FunkyDrum (8 bars)", file: "0032-break-FUNKYDRUM_loop_8_.wav" },
  { label: "Shackup (16 bars)", file: "0033-break-shackup_loop_16_.wav" },
  { label: "Think (4 bars)", file: "0034-break-think.badsister_loop_4_.wav" },
  { label: "Hotpants (4 bars)", file: "0037_SamplepackHotpants_loop_4_.wav" },
];

class WebAudioAcid extends HTMLElement {
  static STORAGE_KEY = "acid-breaks-state";

  connectedCallback() {
    this._ctx = null;
    this._transport = null;
    this._acid = null;
    this._808 = null;
    this._break = null;
    this._blipfx = null;
    this._fmSynth = null;
    this._kick = null;
    this._hihat = null;
    this._snare = null;
    this._seq = null;
    this._globalStep = 0;
    this._saveTimer = null;

    // Controls components (created in buildUI, bound in _initAudio)
    this._acidControls = null;
    this._808Controls = null;
    this._fmControls = null;
    this._blipfxControls = null;
    this._breakControls = null;
    this._kickControls = null;
    this._hihatControls = null;
    this._snareControls = null;

    this.buildUI();
    this.addCSS();
    this._initAudio();
    this._setupKeyboardJam();
  }

  // ---- Audio ----

  _initAudio() {
    if (this._ctx) return;
    this._ctx = new AudioContext();

    // Sequencer must exist before transport init so it can be passed in
    this._seq = new WebAudioSequencer(this._ctx, {
      bpm: 128,
      steps: 16,
      subdivision: 16,
    });

    this._transport.init(this._ctx, {
      bpm: 128,
      seq: this._seq,
      color: "#fff",
      showScales: true,
    });
    this._transport.connect(this._ctx.destination);
    this._transport.shareSlot.appendChild(this._shareBtn);

    // Transport events — resume AudioContext on play, clean up on stop
    this._transport.addEventListener("transport-play", () => {
      if (this._ctx.state === "suspended") this._ctx.resume();
      this._globalStep = 0;
      this._acid.reset();
      this._acidControls?.resetSequencer();
      this._808Controls?.resetSequencer();
      this._fmControls?.resetSequencer();
      this._blipfxControls?.resetSequencer();
      this._kickControls?.resetSequencer();
      this._hihatControls?.resetSequencer();
      this._snareControls?.resetSequencer();
    });
    this._transport.addEventListener("transport-stop", () => {
      this._break?.stop();
      this._acidControls?.setActiveStep(-1);
      this._808Controls?.setActiveStep(-1);
      this._fmControls?.setActiveStep(-1);
      this._blipfxControls?.setActiveStep(-1);
      this._breakControls?.setActiveStep(-1);
      this._kickControls?.setActiveStep(-1);
      this._hihatControls?.setActiveStep(-1);
      this._snareControls?.setActiveStep(-1);
      this._acidControls?.resetSequencer();
      this._808Controls?.resetSequencer();
      this._fmControls?.resetSequencer();
      this._blipfxControls?.resetSequencer();
      this._kickControls?.resetSequencer();
      this._hihatControls?.resetSequencer();
      this._snareControls?.resetSequencer();
    });

    // TB-303 acid
    this._acid = new WebAudioSynthAcid(this._ctx);
    this._acidControls.bind(this._acid, this._ctx, {
      fx: { bpm: 128, reverbWet: 0.15, delayInterval: 0.75, delayFeedback: 0.35, delayMix: 0 },
    });
    this._acidControls.connect(this._transport.masterGain);

    // 808 bass
    this._808 = new WebAudioSynth808(this._ctx);
    this._808Controls.bind(this._808, this._ctx, { fx: { bpm: 128 } });
    this._808Controls.connect(this._transport.masterGain);

    // Break player
    this._break = new WebAudioBreakPlayer(this._ctx, {
      speedMultiplier: 4,
      subdivision: 4,
      returnSteps: 1,
      randomChance: 0.1,
      reverseChance: 0.04,
      volume: 0.8,
      useTimeStretch: true,
    });
    this._breakControls.bind(this._break, this._ctx, {
      files: BREAK_FILES,
      basePath: BASE_PATH,
      fx: { bpm: 128 },
    });
    this._breakControls.connect(this._transport.masterGain);

    // BlipFX
    this._blipfx = new WebAudioSynthBlipFX(this._ctx, { volume: 0.5 });
    this._blipfxControls.bind(this._blipfx, this._ctx, { fx: { bpm: 128 } });
    this._blipfxControls.connect(this._transport.masterGain);

    // FM Chord Synth
    this._fmSynth = new WebAudioSynthFM(this._ctx);
    this._fmControls.bind(this._fmSynth, this._ctx, {
      fx: { bpm: 128, reverbWet: 0.2, delayInterval: 0.5, delayFeedback: 0.4, delayMix: 0.1 },
    });
    this._fmControls.connect(this._transport.masterGain);

    // Kick
    this._kick = new WebAudioPercKick(this._ctx);
    this._kickControls.bind(this._kick, this._ctx, { color: "#f44", fx: { bpm: 128 } });
    this._kickControls.connect(this._transport.masterGain);

    // Hi-Hat
    this._hihat = new WebAudioPercHihat(this._ctx);
    this._hihatControls.bind(this._hihat, this._ctx, { color: "#ff0", fx: { bpm: 128 } });
    this._hihatControls.connect(this._transport.masterGain);

    // Snare
    this._snare = new WebAudioPercSnare(this._ctx);
    this._snareControls.bind(this._snare, this._ctx, { color: "#f80", fx: { bpm: 128 } });
    this._snareControls.connect(this._transport.masterGain);

    // Register instruments for BPM + scale broadcast
    this._transport.registerInstrument(this._acidControls);
    this._transport.registerInstrument(this._808Controls);
    this._transport.registerInstrument(this._fmControls);
    this._transport.registerInstrument(this._blipfxControls);
    this._transport.registerInstrument(this._breakControls);
    this._transport.registerInstrument(this._kickControls);
    this._transport.registerInstrument(this._hihatControls);
    this._transport.registerInstrument(this._snareControls);

    // Push initial scale to all instruments
    this._transport.broadcastScale();

    // Load saved state (URL hash takes priority over localStorage)
    const pendingState = this._loadFromURL() || this._loadFromLocalStorage();
    if (pendingState) this._loadState(pendingState);

    // Auto-save on any controls change (debounced)
    this.addEventListener("controls-change", () => this._debouncedSave());

    // Sequencer step callback
    this._seq.onStep((step, time) => {
      const dur = this._seq.stepDurationSec();
      this._acidControls.step(step, time, dur);
      this._808Controls.step(step, time, dur);
      this._fmControls.step(step, time, dur);
      this._blipfxControls.step(step, time, dur);
      this._kickControls.step(step, time, dur);
      this._hihatControls.step(step, time, dur);
      this._snareControls.step(step, time, dur);
      this._breakControls.step(this._globalStep, this._transport.bpm, time);

      const uiDelay = Math.max(0, (time - this._ctx.currentTime) * 1000);
      setTimeout(() => {
        this._acidControls.setActiveStep(step);
        this._808Controls.setActiveStep(step);
        this._fmControls.setActiveStep(step);
        this._blipfxControls.setActiveStep(step);
        this._kickControls.setActiveStep(step);
        this._hihatControls.setActiveStep(step);
        this._snareControls.setActiveStep(step);
      }, uiDelay);
      this._globalStep++;
    });
  }

  _setupKeyboardJam() {
    document.addEventListener("keydown", (e) => {
      if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
      const key = e.key.toLowerCase();
      switch (key) {
        case " ":
          e.preventDefault();
          this._transport.playing ? this._transport.stop() : this._transport.play();
          break;
        case "k":
          this._breakControls?.jumpToSegment(0);
          break;
        case "h":
          this._breakControls?.jumpToSegment(1);
          break;
        case "s":
          this._breakControls?.jumpToSegment(2);
          break;
        case "v":
          if (this._ctx.state === "suspended") this._ctx.resume();
          this._blipfxControls?.triggerNow();
          break;
        case "b":
          this._acidControls?.queueRandomNote();
          break;
        case "n":
          if (this._ctx.state === "suspended") this._ctx.resume();
          this._fmControls?.triggerJamChord();
          break;
      }
    });
  }

  // ---- Persistence ----

  _getState() {
    const t = this._transport?.toJSON();
    return {
      v: 1,
      bpm: t?.bpm ?? 128,
      masterVolume: t?.masterVolume ?? 1,
      root: t?.root ?? null,
      scale: t?.scale ?? null,
      acid: this._acidControls?.toJSON(),
      bass808: this._808Controls?.toJSON(),
      fm: this._fmControls?.toJSON(),
      blipfx: this._blipfxControls?.toJSON(),
      break: this._breakControls?.toJSON(),
      kick: this._kickControls?.toJSON(),
      hihat: this._hihatControls?.toJSON(),
      snare: this._snareControls?.toJSON(),
      masterFx: t?.fx,
    };
  }

  _loadState(state) {
    if (!state || state.v !== 1) return;
    this._transport?.fromJSON({
      bpm: state.bpm,
      masterVolume: state.masterVolume,
      muted: state.muted ?? false,
      root: state.root,
      scale: state.scale,
      fx: state.masterFx,
    });
    if (state.acid) this._acidControls?.fromJSON(state.acid);
    if (state.bass808) this._808Controls?.fromJSON(state.bass808);
    if (state.fm) this._fmControls?.fromJSON(state.fm);
    if (state.blipfx || state.zzfx) this._blipfxControls?.fromJSON(state.blipfx ?? state.zzfx);
    if (state.break) this._breakControls?.fromJSON(state.break);
    if (state.kick) this._kickControls?.fromJSON(state.kick);
    if (state.hihat) this._hihatControls?.fromJSON(state.hihat);
    if (state.snare) this._snareControls?.fromJSON(state.snare);
  }

  _debouncedSave() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._saveToLocalStorage(), 500);
  }

  _saveToLocalStorage() {
    try {
      localStorage.setItem(WebAudioAcid.STORAGE_KEY, JSON.stringify(this._getState()));
    } catch (e) {
      /* quota exceeded or private mode — ignore */
    }
  }

  _loadFromLocalStorage() {
    try {
      const raw = localStorage.getItem(WebAudioAcid.STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  _loadFromURL() {
    try {
      const hash = location.hash;
      if (!hash.startsWith("#s=")) return null;
      const json = atob(hash.slice(3).replace(/-/g, "+").replace(/_/g, "/"));
      return JSON.parse(json);
    } catch (e) {
      return null;
    }
  }

  _shareURL() {
    const json = JSON.stringify(this._getState());
    const b64 = btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const url = `${location.origin}${location.pathname}#s=${b64}`;
    navigator.clipboard?.writeText(url).then(
      () => {
        this._shareBtn.textContent = "Copied!";
        setTimeout(() => { this._shareBtn.textContent = "Share URL"; }, 1500);
      },
      () => { prompt("Copy this URL:", url); },
    );
  }

  // ---- UI ----

  buildUI() {
    // ---- Transport panel ----
    const transportGroup = document.createElement("div");
    transportGroup.className = "instrument-group transport-group";
    this.appendChild(transportGroup);

    this._transport = document.createElement("wam-transport");
    transportGroup.appendChild(this._transport);

    // Share button — appended to transport's share slot after init()
    this._shareBtn = document.createElement("button");
    this._shareBtn.textContent = "Share URL";
    this._shareBtn.className = "wam-play-btn";
    this._shareBtn.addEventListener("click", () => this._shareURL());

    // ---- Break group ----
    const breakGroup = document.createElement("div");
    breakGroup.className = "instrument-group break-group";
    this.appendChild(breakGroup);
    this._breakControls = document.createElement("wam-break-player-controls");
    breakGroup.appendChild(this._breakControls);

    // ---- Kick group ----
    const kickGroup = document.createElement("div");
    kickGroup.className = "instrument-group kick-group";
    this.appendChild(kickGroup);
    this._kickControls = document.createElement("wam-perc-kick-controls");
    kickGroup.appendChild(this._kickControls);

    // ---- Snare group ----
    const snareGroup = document.createElement("div");
    snareGroup.className = "instrument-group snare-group";
    this.appendChild(snareGroup);
    this._snareControls = document.createElement("wam-perc-snare-controls");
    snareGroup.appendChild(this._snareControls);

    // ---- Hi-Hat group ----
    const hihatGroup = document.createElement("div");
    hihatGroup.className = "instrument-group hihat-group";
    this.appendChild(hihatGroup);
    this._hihatControls = document.createElement("wam-perc-hihat-controls");
    hihatGroup.appendChild(this._hihatControls);

    // ---- 808 group ----
    const g808 = document.createElement("div");
    g808.className = "instrument-group bass808-group";
    this.appendChild(g808);
    this._808Controls = document.createElement("wam-synth-808-controls");
    g808.appendChild(this._808Controls);

    // ---- FM Chord group ----
    const fmGroup = document.createElement("div");
    fmGroup.className = "instrument-group chord-fm-group";
    this.appendChild(fmGroup);
    this._fmControls = document.createElement("wam-synth-fm-controls");
    fmGroup.appendChild(this._fmControls);

    // ---- BlipFX group ----
    const blipfxGroup = document.createElement("div");
    blipfxGroup.className = "instrument-group blipfx-group";
    this.appendChild(blipfxGroup);
    this._blipfxControls = document.createElement("wam-synth-blipfx-controls");
    blipfxGroup.appendChild(this._blipfxControls);

    // ---- Acid / TB-303 group ----
    const acidGroup = document.createElement("div");
    acidGroup.className = "instrument-group acid-group";
    this.appendChild(acidGroup);
    this._acidControls = document.createElement("wam-synth-acid-controls");
    acidGroup.appendChild(this._acidControls);
  }

  addCSS() {
    const styleEl = document.createElement("style");
    styleEl.textContent = /* css */ `
      * { touch-action: manipulation; }

      acid-breaks {
        display: block;
        font-family: monospace;
        background: #111;
        color: #ccc;
        padding: 1rem;
        border-radius: 6px;
      }

      .instrument-group {
        border: 1px solid #222;
        border-radius: 6px;
        overflow: hidden;
        margin-bottom: 12px;
      }

      /* Per-instrument accent colors */
      .break-group    { --fx-accent: #0cc; }
      .kick-group     { --fx-accent: #f44; }
      .snare-group    { --fx-accent: #f80; }
      .hihat-group    { --fx-accent: #ff0; }
      .bass808-group  { --fx-accent: #fa0; }
      .chord-fm-group { --fx-accent: #4af; }
      .blipfx-group   { --fx-accent: #c0f; }
      .acid-group     { --fx-accent: #0f0; }
      .transport-group { --fx-accent: #aaa; --slider-accent: #aaa; }

      wam-waveform {
        height: 44px;
        background: #060606;
        border-top: 1px solid #151515;
      }
      .break-group    wam-waveform { border-color: #002020; }
      .bass808-group  wam-waveform { border-color: #1a0f00; }
      .chord-fm-group wam-waveform { border-color: #001a2a; }
      .blipfx-group   wam-waveform { border-color: #100020; }
      .acid-group     wam-waveform { border-color: #001500; }
    `;
    document.head.appendChild(styleEl);
  }

  disconnectedCallback() {
    this._transport?.stop();
    this._ctx?.close();
  }
}

customElements.define("acid-breaks", WebAudioAcid);
