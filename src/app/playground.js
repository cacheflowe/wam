import WebAudioSequencer from "../web-audio/global/sequencer.js";

// Import all instrument modules (registers custom elements as a side-effect)
import "../web-audio/instruments/perc-kick.js";
import "../web-audio/instruments/perc-hihat.js";
import "../web-audio/instruments/perc-snare.js";
import "../web-audio/instruments/synth-acid.js";
import "../web-audio/instruments/synth-808.js";
import "../web-audio/instruments/synth-fm.js";
import "../web-audio/instruments/synth-mono.js";
import "../web-audio/instruments/synth-pad.js";
import "../web-audio/instruments/synth-blipfx.js";
import "../web-audio/instruments/sample-looper.js";
import "../web-audio/instruments/sample-player.js";
import "../web-audio/ui/transport.js";

import WebAudioPercKick from "../web-audio/instruments/perc-kick.js";
import WebAudioPercHihat from "../web-audio/instruments/perc-hihat.js";
import WebAudioPercSnare from "../web-audio/instruments/perc-snare.js";
import WebAudioSynthAcid from "../web-audio/instruments/synth-acid.js";
import WebAudioSynth808 from "../web-audio/instruments/synth-808.js";
import WebAudioSynthFM from "../web-audio/instruments/synth-fm.js";
import WebAudioSynthMono from "../web-audio/instruments/synth-mono.js";
import WebAudioSynthPad from "../web-audio/instruments/synth-pad.js";
import WebAudioSynthBlipFX from "../web-audio/instruments/synth-blipfx.js";
import WebAudioLoopPlayer from "../web-audio/instruments/sample-looper.js";
import WebAudioSamplePlayer from "../web-audio/instruments/sample-player.js";
import { tryGlobKeys, resolveSamples } from "../web-audio/global/sample-utils.js";

const samplesConfig = {
  breaks: {
    glob: tryGlobKeys(() => import.meta.glob("/_assets/samples/09-breaks/*.wav")),
    servedAt: "_assets/samples/09-breaks/",
    fallbackDir: "public/audio/samples/breaks/",
    fallbackFiles: [
      "funky-drummer-loop-8.wav",
      "shack-up-loop-16.wav",
      "think-bad-sister-loop-4.wav",
      "hot-pants-loop-4.wav",
    ],
  },
  percloops: {
    glob: tryGlobKeys(() => import.meta.glob("/_assets/samples/10-perc-loops/*.wav")),
    servedAt: "_assets/samples/10-perc-loops/",
    fallbackDir: "public/audio/samples/perc-loops/",
    fallbackFiles: ["FX_Loops_058_loop_4_.wav", "FX_Loops_068_loop_4_.wav"],
  },
  kicks: {
    glob: tryGlobKeys(() => import.meta.glob("/_assets/samples/01-kick/*.wav")),
    servedAt: "_assets/samples/01-kick/",
    fallbackDir: "public/audio/samples/kicks/",
    fallbackFiles: ["B.DRUM_14.wav", "B.DRUM_17.wav", "B.DRUM_23.wav", "B.DRUM_27.wav"],
  },
  snares: {
    glob: tryGlobKeys(() => import.meta.glob("/_assets/samples/02-snare/*.wav")),
    servedAt: "_assets/samples/02-snare/",
    fallbackDir: "public/audio/samples/snares/",
    fallbackFiles: ["CLAP_5.wav", "SNARE_5.wav", "SNARE_7.wav", "SNARE_14.wav"],
  },
  hits: {
    glob: tryGlobKeys(() => import.meta.glob("/_assets/samples/04-perc/*.wav")),
    servedAt: "_assets/samples/04-perc/",
    fallbackDir: "public/audio/samples/hits/",
    fallbackFiles: [
      "AMINDDR11.wav",
      "BATA_HI.wav",
      "BLOCK_1.wav",
      "BONGO_1.wav",
      "BOTTLE_1.wav",
      "COWBELL_1.wav",
      "ZAP_4.wav",
    ],
  },
};

const LOOP_FILES_BREAKS = resolveSamples(samplesConfig.breaks);
const LOOP_FILES_PERCL = resolveSamples(samplesConfig.percloops);
const SAMPLE_FILES_KICKS = resolveSamples(samplesConfig.kicks);
const SAMPLE_FILES_SNARES = resolveSamples(samplesConfig.snares);
const SAMPLE_FILES_HITS = resolveSamples(samplesConfig.hits);

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
    tag: "wam-perc-kick-controls",
    bindOpts: (bpm) => ({ color: "#f44", fx: { bpm } }),
    step: (ctrl, step, time, dur) => ctrl.step(step, time, dur),
  },
  {
    id: "hihat",
    label: "Hi-Hat",
    color: "#ff0",
    make: (ctx) => new WebAudioPercHihat(ctx),
    tag: "wam-perc-hihat-controls",
    bindOpts: (bpm) => ({ color: "#ff0", fx: { bpm } }),
    step: (ctrl, step, time, dur) => ctrl.step(step, time, dur),
  },
  {
    id: "snare",
    label: "Snare",
    color: "#f80",
    make: (ctx) => new WebAudioPercSnare(ctx),
    tag: "wam-perc-snare-controls",
    bindOpts: (bpm) => ({ color: "#f80", fx: { bpm } }),
    step: (ctrl, step, time, dur) => ctrl.step(step, time, dur),
  },
  {
    id: "acid",
    label: "Acid",
    color: "#8f0",
    make: (ctx) => new WebAudioSynthAcid(ctx),
    tag: "wam-synth-acid-controls",
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
    tag: "wam-synth-808-controls",
    bindOpts: (bpm) => ({ color: "#f04", fx: { bpm } }),
    step: (ctrl, step, time, dur) => ctrl.step(step, time, dur),
  },
  {
    id: "fm",
    label: "FM Synth",
    color: "#4df",
    make: (ctx) => new WebAudioSynthFM(ctx),
    tag: "wam-synth-fm-controls",
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
    tag: "wam-synth-mono-controls",
    bindOpts: (bpm) => ({ color: "#6df", fx: { bpm } }),
    step: (ctrl, step, time, dur) => ctrl.step(step, time, dur),
  },
  {
    id: "pad",
    label: "Pad",
    color: "#a8f",
    make: (ctx) => new WebAudioSynthPad(ctx),
    tag: "wam-synth-pad-controls",
    bindOpts: (bpm) => ({ color: "#a8f", fx: { bpm, reverbWet: 0.3, delayMix: 0.1 } }),
    step: (ctrl, step, time, dur) => ctrl.step(step, time, dur),
  },
  {
    id: "blipfx",
    label: "BlipFX",
    color: "#fa8",
    make: (ctx) => new WebAudioSynthBlipFX(ctx, { volume: 0.5 }),
    tag: "wam-synth-blipfx-controls",
    bindOpts: (bpm) => ({ color: "#fa8", fx: { bpm } }),
    step: (ctrl, step, time, dur) => ctrl.step(step, time, dur),
  },
  {
    id: "loop-breaks",
    label: "Loop Player (Breaks)",
    color: "#8fa",
    make: (ctx) =>
      new WebAudioLoopPlayer(ctx, {
        speedMultiplier: 1,
        subdivision: 4,
        returnSteps: 1,
        randomChance: 0.1,
        reverseChance: 0.04,
        volume: 0.8,
        useTimeStretch: true,
      }),
    tag: "wam-sample-looper-controls",
    bindOpts: (bpm) => ({ color: "#8fa", files: LOOP_FILES_BREAKS, basePath: "", fx: { bpm } }),
    // Loop player uses (globalStep, bpm, time) — owner tracks globalStep externally
    step: null,
  },
  {
    id: "loop-perc",
    label: "Loop Player (Perc)",
    color: "#8df",
    make: (ctx) =>
      new WebAudioLoopPlayer(ctx, {
        speedMultiplier: 1,
        subdivision: 4,
        returnSteps: 1,
        randomChance: 0.1,
        reverseChance: 0.04,
        volume: 0.8,
        useTimeStretch: true,
      }),
    tag: "wam-sample-looper-controls",
    bindOpts: (bpm) => ({ color: "#8df", files: LOOP_FILES_PERCL, basePath: "", fx: { bpm } }),
    // Loop player uses (globalStep, bpm, time) — owner tracks globalStep externally
    step: null,
  },
  {
    id: "sampler-kicks",
    label: "Sampler (Kicks)",
    color: "#f8a",
    make: (ctx) => new WebAudioSamplePlayer(ctx),
    tag: "wam-sample-player-controls",
    bindOpts: (bpm) => ({ color: "#f8a", files: SAMPLE_FILES_KICKS, basePath: "", fx: { bpm } }),
    step: (ctrl, step, time, dur) => ctrl.step(step, time, dur),
  },
  {
    id: "sampler-snares",
    label: "Sampler (Snares)",
    color: "#fa8",
    make: (ctx) => new WebAudioSamplePlayer(ctx),
    tag: "wam-sample-player-controls",
    bindOpts: (bpm) => ({ color: "#fa8", files: SAMPLE_FILES_SNARES, basePath: "", fx: { bpm } }),
    step: (ctrl, step, time, dur) => ctrl.step(step, time, dur),
  },
  {
    id: "sampler-hits",
    label: "Sampler (Hits)",
    color: "#8af",
    make: (ctx) => new WebAudioSamplePlayer(ctx),
    tag: "wam-sample-player-controls",
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
    // Instruments waiting for the next bar boundary before joining the active list
    this._pendingInstruments = [];

    this._buildUI();
  }

  disconnectedCallback() {}

  // ---- UI ----

  _buildUI() {
    const main = document.createElement("main");
    main.className = "container";
    main.style.cssText = "padding-bottom:4rem;";
    this.appendChild(main);

    // Transport row
    const transportRow = document.createElement("section");
    transportRow.style.cssText = "margin-bottom:1.5rem;";
    this._transportEl = document.createElement("wam-transport");
    transportRow.appendChild(this._transportEl);
    main.appendChild(transportRow);

    // Add-instrument palette
    const palette = document.createElement("section");
    palette.style.cssText = "margin-bottom:1.5rem;display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;";

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
      // Flush any pending instruments — everything resets on play anyway
      for (const entry of this._pendingInstruments) this._instruments.push(entry);
      this._pendingInstruments = [];
      for (const entry of this._instruments) {
        entry.ctrl.resetSequencer?.();
        entry.instrument.reset?.();
      }
    });

    this._transportEl.addEventListener("transport-stop", () => {
      // Pending instruments never played; move them to active so stop/reset hits them too
      for (const entry of this._pendingInstruments) this._instruments.push(entry);
      this._pendingInstruments = [];
      for (const entry of this._instruments) {
        entry.ctrl.setActiveStep?.(-1);
        entry.ctrl.resetSequencer?.();
        if (!entry.def.step) entry.instrument.stop?.();
      }
    });

    this._seq.onStep((step, time) => {
      // Activate pending instruments on bar boundary so they start in phase
      if (step === 0 && this._pendingInstruments.length > 0) {
        for (const entry of this._pendingInstruments) {
          entry.ctrl.resetSequencer?.();
          entry.instrument.reset?.();
          this._instruments.push(entry);
        }
        this._pendingInstruments = [];
      }

      const dur = this._seq.stepDurationSec();
      for (const entry of this._instruments) {
        if (entry.def.step) {
          entry.def.step(entry.ctrl, step, time, dur);
        } else {
          // Loop player
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
    // If the transport is running, hold until the next bar so the pattern starts in phase
    if (this._transportEl.playing) {
      this._pendingInstruments.push(entry);
    } else {
      this._instruments.push(entry);
    }

    // Wrapper row
    const row = document.createElement("div");
    row.style.cssText = "position:relative;border:1px solid #ffffff18;border-radius:6px;padding:0 0 .5rem;";

    const removeBtn = document.createElement("button");
    removeBtn.textContent = "✕ Remove";
    removeBtn.style.cssText =
      "position:absolute;top:-.5rem;right:-.5rem;background:#ff334422;border:1px solid #ff334466;color:#f88;padding:.2rem .5rem;border-radius:4px;cursor:pointer;font-size:.75rem;z-index:1;";
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
    this._pendingInstruments = this._pendingInstruments.filter((e) => e !== entry);
    if (this._instruments.length === 0) {
      this._emptyMsg.style.display = "";
    }
  }
}

customElements.define("playground-app", PlaygroundApp);
