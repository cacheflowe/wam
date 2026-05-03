import WebAudioSequencer from "../web-audio/global/web-audio-sequencer.js";

// Import all instrument modules (registers custom elements as a side-effect)
import "../web-audio/instruments/web-audio-perc-kick.js";
import "../web-audio/instruments/web-audio-perc-hihat.js";
import "../web-audio/instruments/web-audio-perc-snare.js";
import "../web-audio/instruments/web-audio-synth-acid.js";
import "../web-audio/instruments/web-audio-synth-808.js";
import "../web-audio/instruments/web-audio-synth-fm.js";
import "../web-audio/instruments/web-audio-synth-mono.js";
import "../web-audio/instruments/web-audio-synth-pad.js";
import "../web-audio/instruments/web-audio-synth-blipfx.js";
import "../web-audio/instruments/web-audio-break-player.js";
import "../web-audio/instruments/web-audio-sample-player.js";
import "../web-audio/ui/web-audio-transport.js";

import WebAudioPercKick from "../web-audio/instruments/web-audio-perc-kick.js";
import WebAudioPercHihat from "../web-audio/instruments/web-audio-perc-hihat.js";
import WebAudioPercSnare from "../web-audio/instruments/web-audio-perc-snare.js";
import WebAudioSynthAcid from "../web-audio/instruments/web-audio-synth-acid.js";
import WebAudioSynth808 from "../web-audio/instruments/web-audio-synth-808.js";
import WebAudioSynthFM from "../web-audio/instruments/web-audio-synth-fm.js";
import WebAudioSynthMono from "../web-audio/instruments/web-audio-synth-mono.js";
import WebAudioSynthPad from "../web-audio/instruments/web-audio-synth-pad.js";
import WebAudioSynthBlipFX from "../web-audio/instruments/web-audio-synth-blipfx.js";
import WebAudioBreakPlayer from "../web-audio/instruments/web-audio-break-player.js";
import WebAudioSamplePlayer from "../web-audio/instruments/web-audio-sample-player.js";

const BASE_PATH = "/audio/breaks/";
const BREAK_FILES = [
  { label: "FunkyDrum (8 bars)", file: "0032-break-FUNKYDRUM_loop_8_.wav" },
  { label: "Shackup (16 bars)", file: "0033-break-shackup_loop_16_.wav" },
  { label: "Think (4 bars)", file: "0034-break-think.badsister_loop_4_.wav" },
  { label: "Hotpants (4 bars)", file: "0037_SamplepackHotpants_loop_4_.wav" },
];

// Auto-discover sample files via Vite glob.
// Uses { eager: false } on src-relative paths and extracts only the keys (paths).
// Since files live in public/, Vite serves them at the root — we just strip the prefix.
function globSamples(paths) {
  return paths.map((path) => {
    const file = path.split("/").pop();
    const label = file.replace(/\.(wav|mp3|ogg|flac)$/i, "").replace(/[-_]/g, " ");
    // Convert /public/audio/... → /audio/... (Vite serves public/ at root)
    const url = path.replace(/^\/public/, "");
    return { label, file: url };
  });
}

// Extract just the path keys — we never actually import these files (they're in public/)
const SAMPLE_FILES_KICKS = globSamples(
  Object.keys(import.meta.glob("/public/audio/samples/kicks/*.wav")),
);
const SAMPLE_FILES_SNARES = globSamples(
  Object.keys(import.meta.glob("/public/audio/samples/snares/*.wav")),
);
const SAMPLE_FILES_HITS = globSamples(
  Object.keys(import.meta.glob("/public/audio/samples/hits/*.wav")),
);

/**
 * Registry of available instrument types.
 * Each entry describes how to instantiate a headless instrument, create its
 * controls element, and call `step()` with the right arguments.
 */
const INSTRUMENT_TYPES = [
  {
    id: "kick",
    label: "Kick",
    color: "#f44",
    make: (ctx) => new WebAudioPercKick(ctx),
    tag: "web-audio-perc-kick-controls",
    bindOpts: (bpm) => ({ color: "#f44", fx: { bpm } }),
    step: (ctrl, step, time, dur) => ctrl.step(step, time, dur),
  },
  {
    id: "hihat",
    label: "Hi-Hat",
    color: "#ff0",
    make: (ctx) => new WebAudioPercHihat(ctx),
    tag: "web-audio-perc-hihat-controls",
    bindOpts: (bpm) => ({ color: "#ff0", fx: { bpm } }),
    step: (ctrl, step, time, dur) => ctrl.step(step, time, dur),
  },
  {
    id: "snare",
    label: "Snare",
    color: "#f80",
    make: (ctx) => new WebAudioPercSnare(ctx),
    tag: "web-audio-perc-snare-controls",
    bindOpts: (bpm) => ({ color: "#f80", fx: { bpm } }),
    step: (ctrl, step, time, dur) => ctrl.step(step, time, dur),
  },
  {
    id: "acid",
    label: "Acid",
    color: "#8f0",
    make: (ctx) => new WebAudioSynthAcid(ctx),
    tag: "web-audio-synth-acid-controls",
    bindOpts: (bpm) => ({
      color: "#8f0",
      fx: { bpm, reverbWet: 0.15, delayInterval: 0.75, delayFeedback: 0.35, delayMix: 0 },
    }),
    step: (ctrl, step, time, dur) => ctrl.step(step, time, dur),
  },
  {
    id: "bass808",
    label: "808 Bass",
    color: "#f04",
    make: (ctx) => new WebAudioSynth808(ctx),
    tag: "web-audio-synth-808-controls",
    bindOpts: (bpm) => ({ color: "#f04", fx: { bpm } }),
    step: (ctrl, step, time, dur) => ctrl.step(step, time, dur),
  },
  {
    id: "fm",
    label: "FM Synth",
    color: "#4df",
    make: (ctx) => new WebAudioSynthFM(ctx),
    tag: "web-audio-synth-fm-controls",
    bindOpts: (bpm) => ({
      color: "#4df",
      fx: { bpm, reverbWet: 0.2, delayInterval: 0.5, delayFeedback: 0.4, delayMix: 0.1 },
    }),
    step: (ctrl, step, time, dur) => ctrl.step(step, time, dur),
  },
  {
    id: "mono",
    label: "Mono Synth",
    color: "#6df",
    make: (ctx) => new WebAudioSynthMono(ctx),
    tag: "web-audio-synth-mono-controls",
    bindOpts: (bpm) => ({ color: "#6df", fx: { bpm } }),
    step: (ctrl, step, time, dur) => ctrl.step(step, time, dur),
  },
  {
    id: "pad",
    label: "Pad",
    color: "#a8f",
    make: (ctx) => new WebAudioSynthPad(ctx),
    tag: "web-audio-synth-pad-controls",
    bindOpts: (bpm) => ({ color: "#a8f", fx: { bpm, reverbWet: 0.3, delayMix: 0.1 } }),
    step: (ctrl, step, time, dur) => ctrl.step(step, time, dur),
  },
  {
    id: "blipfx",
    label: "BlipFX",
    color: "#fa8",
    make: (ctx) => new WebAudioSynthBlipFX(ctx, { volume: 0.5 }),
    tag: "web-audio-synth-blipfx-controls",
    bindOpts: (bpm) => ({ color: "#fa8", fx: { bpm } }),
    step: (ctrl, step, time, dur) => ctrl.step(step, time, dur),
  },
  {
    id: "break",
    label: "Break Player",
    color: "#8fa",
    make: (ctx) =>
      new WebAudioBreakPlayer(ctx, {
        speedMultiplier: 4,
        subdivision: 4,
        returnSteps: 1,
        randomChance: 0.1,
        reverseChance: 0.04,
        volume: 0.8,
        useTimeStretch: true,
      }),
    tag: "web-audio-break-player-controls",
    bindOpts: (bpm) => ({ color: "#8fa", files: BREAK_FILES, basePath: BASE_PATH, fx: { bpm } }),
    // Break player uses (globalStep, bpm, time) — owner tracks globalStep externally
    step: null,
  },
  {
    id: "sampler-kicks",
    label: "Sampler (Kicks)",
    color: "#f8a",
    make: (ctx) => new WebAudioSamplePlayer(ctx),
    tag: "web-audio-sample-player-controls",
    bindOpts: (bpm) => ({ color: "#f8a", files: SAMPLE_FILES_KICKS, basePath: "", fx: { bpm } }),
    step: (ctrl, step, time, dur) => ctrl.step(step, time, dur),
  },
  {
    id: "sampler-snares",
    label: "Sampler (Snares)",
    color: "#fa8",
    make: (ctx) => new WebAudioSamplePlayer(ctx),
    tag: "web-audio-sample-player-controls",
    bindOpts: (bpm) => ({ color: "#fa8", files: SAMPLE_FILES_SNARES, basePath: "", fx: { bpm } }),
    step: (ctrl, step, time, dur) => ctrl.step(step, time, dur),
  },
  {
    id: "sampler-hits",
    label: "Sampler (Hits)",
    color: "#8af",
    make: (ctx) => new WebAudioSamplePlayer(ctx),
    tag: "web-audio-sample-player-controls",
    bindOpts: (bpm) => ({ color: "#8af", files: SAMPLE_FILES_HITS, basePath: "", fx: { bpm } }),
    step: (ctrl, step, time, dur) => ctrl.step(step, time, dur),
  },
];

class PlaygroundApp extends HTMLElement {
  connectedCallback() {
    this._ctx = null;
    this._transport = null;
    this._seq = null;
    this._globalStep = 0;

    // Live instrument entries: [{ def, ctrl, instrument }]
    this._instruments = [];

    this._buildUI();

    this._onKeyDown = (e) => {
      if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
      if (e.repeat) return;
      if (e.key === " ") {
        e.preventDefault();
        this._transportEl.playing ? this._transportEl.stop() : this._transportEl.play();
      }
    };
    document.addEventListener("keydown", this._onKeyDown);
  }

  disconnectedCallback() {
    if (this._onKeyDown) document.removeEventListener("keydown", this._onKeyDown);
  }

  // ---- UI ----

  _buildUI() {
    this.innerHTML = "";
    this.style.cssText =
      "display:block;min-height:100vh;background:#0d0d16;color:#e0e0f0;font-family:system-ui,sans-serif;";

    // Header
    const header = document.createElement("header");
    header.className = "container";
    header.innerHTML = `<h1 style="margin:0;padding:1rem 0;font-size:1.4rem;letter-spacing:.05em;">🎛 Instrument Playground</h1>`;
    this.appendChild(header);

    const main = document.createElement("main");
    main.className = "container";
    main.style.cssText = "padding-bottom:4rem;";
    this.appendChild(main);

    // Transport row
    const transportRow = document.createElement("section");
    transportRow.style.cssText = "margin-bottom:1.5rem;";
    this._transportEl = document.createElement("web-audio-transport");
    transportRow.appendChild(this._transportEl);
    main.appendChild(transportRow);

    // Add-instrument palette
    const palette = document.createElement("section");
    palette.style.cssText = "margin-bottom:1.5rem;display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;";
    const paletteLabel = document.createElement("span");
    paletteLabel.textContent = "Add: ";
    paletteLabel.style.cssText = "font-size:.85rem;opacity:.6;margin-right:.25rem;";
    palette.appendChild(paletteLabel);

    for (const def of INSTRUMENT_TYPES) {
      const btn = document.createElement("button");
      btn.textContent = `+ ${def.label}`;
      btn.style.cssText = `background:${def.color}22;border:1px solid ${def.color}66;color:${def.color};padding:.35rem .75rem;border-radius:4px;cursor:pointer;font-size:.8rem;`;
      btn.addEventListener("mouseover", () => {
        btn.style.background = `${def.color}44`;
      });
      btn.addEventListener("mouseout", () => {
        btn.style.background = `${def.color}22`;
      });
      btn.addEventListener("click", () => this._addInstrument(def));
      palette.appendChild(btn);
    }
    main.appendChild(palette);

    // Instruments list
    this._instrumentList = document.createElement("div");
    this._instrumentList.style.cssText = "display:flex;flex-direction:column;gap:1rem;";
    main.appendChild(this._instrumentList);

    // Empty state
    this._emptyMsg = document.createElement("p");
    this._emptyMsg.textContent = "No instruments added yet. Click a button above to add one.";
    this._emptyMsg.style.cssText = "opacity:.4;font-style:italic;";
    this._instrumentList.appendChild(this._emptyMsg);

    // Init audio (lazy on first add, but create transport now)
    this._initAudio();
  }

  // ---- Audio ----

  _initAudio() {
    if (this._ctx) return;
    this._ctx = new AudioContext();

    this._seq = new WebAudioSequencer(this._ctx, {
      bpm: 128,
      steps: 16,
      subdivision: 16,
    });

    this._transportEl.init(this._ctx, {
      bpm: 128,
      seq: this._seq,
      color: "#6366f1",
      showScales: true,
    });
    this._transportEl.connect(this._ctx.destination);

    this._transportEl.addEventListener("transport-play", () => {
      if (this._ctx.state === "suspended") this._ctx.resume();
      this._globalStep = 0;
      for (const entry of this._instruments) {
        entry.ctrl.resetSequencer?.();
        entry.instrument.reset?.();
      }
    });

    this._transportEl.addEventListener("transport-stop", () => {
      for (const entry of this._instruments) {
        entry.ctrl.setActiveStep?.(-1);
        entry.ctrl.resetSequencer?.();
        if (entry.def.id === "break") entry.instrument.stop?.();
      }
    });

    this._seq.onStep((step, time) => {
      const dur = this._seq.stepDurationSec();
      for (const entry of this._instruments) {
        if (entry.def.step) {
          entry.def.step(entry.ctrl, step, time, dur);
        } else {
          // Break player
          entry.ctrl.step(this._globalStep, this._transportEl.bpm, time);
        }
      }
      const uiDelay = Math.max(0, (time - this._ctx.currentTime) * 1000);
      setTimeout(() => {
        for (const entry of this._instruments) {
          entry.ctrl.setActiveStep?.(step);
        }
      }, uiDelay);
      this._globalStep++;
    });

    this._transportEl.broadcastScale();
  }

  // ---- Add / Remove ----

  _addInstrument(def) {
    if (!this._ctx) this._initAudio();
    if (this._ctx.state === "suspended") this._ctx.resume();

    const bpm = this._transportEl.bpm ?? 128;
    const instrument = def.make(this._ctx);
    const ctrl = document.createElement(def.tag);

    ctrl.bind(instrument, this._ctx, def.bindOpts(bpm));
    ctrl.connect(this._transportEl.masterGain);
    this._transportEl.registerInstrument(ctrl);
    this._transportEl.broadcastScale();

    const entry = { def, ctrl, instrument };
    this._instruments.push(entry);

    // Wrapper row
    const row = document.createElement("div");
    row.style.cssText = "position:relative;border:1px solid #ffffff18;border-radius:6px;padding:0 0 .5rem;";

    const removeBtn = document.createElement("button");
    removeBtn.textContent = "✕ Remove";
    removeBtn.style.cssText =
      "position:absolute;top:.5rem;right:.5rem;background:#ff334422;border:1px solid #ff334466;color:#f88;padding:.2rem .5rem;border-radius:4px;cursor:pointer;font-size:.75rem;z-index:1;";
    removeBtn.addEventListener("click", () => this._removeInstrument(entry, row));

    row.appendChild(removeBtn);
    row.appendChild(ctrl);
    this._instrumentList.appendChild(row);
    entry.row = row;

    this._emptyMsg.style.display = "none";
  }

  _removeInstrument(entry, row) {
    this._transportEl.unregisterInstrument(entry.ctrl);
    entry.ctrl.disconnect();
    this._instrumentList.removeChild(row);
    this._instruments = this._instruments.filter((e) => e !== entry);
    if (this._instruments.length === 0) {
      this._emptyMsg.style.display = "";
    }
  }
}

customElements.define("playground-app", PlaygroundApp);
