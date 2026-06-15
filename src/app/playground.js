import WebAudioSequencer from "../web-audio/global/sequencer.js";
import WamAnalysisBus from "../web-audio/ui/analysis-bus.js";
import "../web-audio/ui/visualizer.js";

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
import WebAudioVocoderFx from "../web-audio/fx/fx-vocoder.js";
import WebAudioSidechainFx from "../web-audio/fx/fx-sidechain.js";
import { tryGlobKeys, tryGlobModules, resolveSamples, resolveSongs } from "../web-audio/global/sample-utils.js";
import "../web-audio/ui/arrangement-library.js";
import { focusManager } from "../web-audio/ui/focus-manager.js";
import { sequencerHardware } from "../web-audio/midi/sequencer-hardware.js";
import { ledFeedback } from "../web-audio/midi/led-feedback.js";
import { autoMap } from "../web-audio/midi/auto-map.js";
import { StoreKeys } from "../web-audio/global/store-keys.js";
import "../web-audio/ui/drawer.js";
import "../web-audio/ui/midi-monitor.js";
import "../web-audio/ui/midi-input-picker.js";

import electroBreakState from "../data/songs/electro-break.json" with { type: "json" };
import letsGoState from "../data/songs/lets-go.json" with { type: "json" };
import client04State from "../data/songs/client-04.json" with { type: "json" };
const SAMPLE_SONGS = resolveSongs(
  tryGlobModules(() => import.meta.glob("../data/songs/*.json", { eager: true })),
  [
    { name: "Electro Break", state: electroBreakState },
    { name: "Lets Go", state: letsGoState },
    { name: "Client 04", state: client04State },
  ],
);

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
  vocals: {
    glob: tryGlobKeys(() => import.meta.glob("/_assets/samples/11-vocals/*.wav")),
    servedAt: "_assets/samples/11-vocals/",
    fallbackDir: "public/audio/samples/vocals/",
    fallbackFiles: ["eek-a-mouse-loop-8.wav"],
  },
};

const LOOP_FILES_BREAKS = resolveSamples(samplesConfig.breaks);
const LOOP_FILES_PERCL = resolveSamples(samplesConfig.percloops);
const SAMPLE_FILES_KICKS = resolveSamples(samplesConfig.kicks);
const SAMPLE_FILES_SNARES = resolveSamples(samplesConfig.snares);
const SAMPLE_FILES_HITS = resolveSamples(samplesConfig.hits);
const LOOP_FILES_VOCALS = resolveSamples(samplesConfig.vocals);
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
  {
    id: "vocoder",
    label: "Vocoder",
    color: "#4fd",
    make: (ctx) => new WebAudioVocoderFx(ctx),
    tag: "wam-vocoder-fx-controls",
    bindOpts: () => ({ color: "#4fd" }),
    step: null,
  },
  {
    id: "sidechain",
    label: "Sidechain Comp",
    color: "#f4a",
    make: (ctx) => new WebAudioSidechainFx(ctx),
    tag: "wam-sidechain-controls",
    bindOpts: () => ({ color: "#f4a" }),
    step: null,
  },
  {
    id: "loop-vocals",
    label: "Loop Player (Vocals)",
    color: "rgb(192, 157, 68)",
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
    bindOpts: (bpm) => ({ color: "rgb(192, 157, 68)", files: LOOP_FILES_VOCALS, basePath: "", fx: { bpm } }),
    // Loop player uses (globalStep, bpm, time) — owner tracks globalStep externally
    step: null,
  },
];

export default class PlaygroundApp extends HTMLElement {
  static STORAGE_KEY = "wam_playground_settings";

  connectedCallback() {
    this._ctx = null;
    this._transport = null;
    this._seq = null;
    this._globalStep = 0;

    // Live instrument entries: [{ def, ctrl, instrument, instanceId, row, tapNode? }]
    this._instruments = [];
    // Instruments waiting for the next bar boundary before joining the active list
    this._pendingInstruments = [];
    // Bus of tappable instrument outputs: instanceId → { label, tapNode }
    this._instrumentBus = new Map();

    this._instanceCounter = 0;
    this._isLoadingState = false;
    this._analysisBus = new WamAnalysisBus();

    this._buildUI();
    this._loadInitialState();

    // Hardware control: track the focused instrument and let the Launch Control
    // XL's 16 buttons drive its sequencer. Guarantee a jam binding on focus.
    focusManager.start();
    sequencerHardware.start();
    autoMap.start();
    this._onInstrumentFocus = (e) => {
      const ctrl = e.detail?.controls;
      const idx = ctrl ? this._instruments.findIndex((en) => en.ctrl === ctrl) : -1;
      // Publish the focused instrument's serializable id (not the element).
      window._store?.set(StoreKeys.FOCUS_INSTRUMENT_ID, idx >= 0 ? this._instruments[idx].instanceId : null);
      if (!ctrl?.ensureJamBinding) return;
      ctrl.ensureJamBinding(idx >= 0 && idx < 9 ? String(idx + 1) : null);
    };
    document.addEventListener("wam-instrument-focus-change", this._onInstrumentFocus);
  }

  disconnectedCallback() {
    this.removeEventListener("controls-change", this._onControlsChange);
    document.removeEventListener("wam-instrument-focus-change", this._onInstrumentFocus);
    sequencerHardware.stop();
    autoMap.stop();
    focusManager.stop();
  }

  // ---- UI ----

  _buildUI() {
    const main = document.createElement("main");
    main.className = "container";
    main.style.cssText = "padding-bottom:4rem;";
    this.appendChild(main);

    // Shared tool drawer (panels registered below).
    this._drawer = document.createElement("wam-drawer");
    this.appendChild(this._drawer);

    // ---- Sticky top bar: transport + tool launcher toolbar ----
    const topBar = document.createElement("section");
    topBar.style.cssText =
      "position:sticky;top:0;z-index:50;background:#0d0d14;padding:0.5rem 0 0.6rem;margin-bottom:1.25rem;border-bottom:1px solid #24243a;";

    this._transportEl = document.createElement("wam-transport");
    topBar.appendChild(this._transportEl);

    const toolbar = document.createElement("div");
    toolbar.style.cssText = "display:flex;gap:0.4rem;margin-top:0.5rem;flex-wrap:wrap;align-items:center;";
    const mkLauncher = (id, label) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.dataset.drawerLauncher = id;
      b.style.cssText =
        "background:#1a1a2e;border:1px solid #3a3a5a;color:#cfcff0;padding:.35rem .75rem;border-radius:4px;cursor:pointer;font-size:.8rem;";
      b.addEventListener("click", () => this._drawer.toggle(id));
      toolbar.appendChild(b);
      return b;
    };
    mkLauncher("add", "+ Add Instrument");
    mkLauncher("songs", "♪ Songs");
    mkLauncher("midi", "🎛 MIDI");

    this._currentSongLabel = document.createElement("span");
    this._currentSongLabel.style.cssText = "opacity:0.85;margin-left:0.5rem;font-size:0.8rem;color:#4f8;";
    toolbar.appendChild(this._currentSongLabel);

    topBar.appendChild(toolbar);
    main.appendChild(topBar);

    // Highlight the launcher whose panel is open.
    this._drawer.addEventListener("drawer-toggle", (e) => {
      toolbar.querySelectorAll("[data-drawer-launcher]").forEach((b) => {
        const active = e.detail.open && b.dataset.drawerLauncher === e.detail.id;
        b.style.background = active ? "#2a2060" : "#1a1a2e";
        b.style.borderColor = active ? "#9b8dff" : "#3a3a5a";
      });
      window._store?.set(StoreKeys.DRAWER_OPEN_ID, e.detail.open ? e.detail.id : null);
    });

    // ---- Add-instrument palette (drawer panel) ----
    const palette = document.createElement("div");
    palette.style.cssText = "display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;";

    // ---- Arrangement library (drawer panel) ----
    this._libraryEl = document.createElement("wam-arrangement-library");
    this._libraryEl.addEventListener("arrangement-save", (e) => {
      this._setCurrentSongName(e.detail.name);
      e.detail.callback(this._getState());
    });
    this._libraryEl.addEventListener("arrangement-load", (e) => {
      if (this._transportEl.playing) {
        this._queuedState = e.detail.state;
        this._queuedSongName = e.detail.name;
        this._setCurrentSongName(this._currentSongName + ` (Next: ${e.detail.name})`);
      } else {
        this._setCurrentSongName(e.detail.name);
        this._applyState(e.detail.state);
      }
    });
    this._libraryEl.addEventListener("arrangement-export", (e) => {
      e.detail.callback(this._getState());
    });
    this._libraryEl.setSampleSongs(SAMPLE_SONGS);
    this._drawer.addPanel("songs", this._libraryEl, "Songs & Saves");

    // ---- MIDI panel (drawer): input picker + debug monitor ----
    this._midiPanelEl = document.createElement("div");
    this._midiPanelEl.style.cssText = "display:flex;flex-direction:column;gap:1rem;";

    this._midiPicker = document.createElement("wam-midi-input-picker");
    this._midiPicker.setAttribute("sysex", ""); // sysex access enables LED feedback output
    // Share the single MIDIAccess with the LED-feedback sink (auto-selects the
    // Launch Control output, lights mapped controls + sequencer buttons).
    this._midiPicker.addEventListener("midi-access-ready", (e) => ledFeedback.adoptAccess(e.detail.access));
    // Publish device selection to the shared store (device follows the app, not
    // a song — not part of arrangement state).
    this._midiPicker.addEventListener("midi-input-change", () =>
      window._store?.set(StoreKeys.MIDI_INPUT_ID, this._midiPicker.value),
    );
    this._midiPanelEl.appendChild(this._midiPicker);

    // Auto-map ("device follows focus") opt-out.
    const autoMapLabel = document.createElement("label");
    autoMapLabel.style.cssText = "display:flex;align-items:center;gap:0.5rem;font-size:0.8rem;color:#c8c8e0;";
    const autoMapToggle = document.createElement("input");
    autoMapToggle.type = "checkbox";
    autoMapToggle.checked = autoMap.enabled;
    autoMapToggle.addEventListener("change", () => autoMap.setEnabled(autoMapToggle.checked));
    autoMapLabel.append(autoMapToggle, "Auto-map device to focused instrument");
    this._midiPanelEl.appendChild(autoMapLabel);

    this._midiPanelEl.appendChild(document.createElement("wam-midi-monitor"));
    this._drawer.addPanel("midi", this._midiPanelEl, "MIDI");

    // Visualizer panel
    const vizRow = document.createElement("section");
    vizRow.style.cssText = "margin-bottom:1.5rem;";
    const vizDetails = document.createElement("details");
    vizDetails.open = true;
    const vizSummary = document.createElement("summary");
    vizSummary.textContent = "Visualizer";
    vizDetails.appendChild(vizSummary);

    // Sketch selector
    const vizToolbar = document.createElement("div");
    vizToolbar.style.cssText = "display:flex;align-items:center;gap:0.5rem;margin-top:0.5rem;";
    const sketchLabel = document.createElement("label");
    sketchLabel.textContent = "Sketch:";
    sketchLabel.style.cssText = "font-size:0.8rem;opacity:0.7;";
    this._sketchSelect = document.createElement("select");
    this._sketchSelect.style.cssText =
      "font-size:0.8rem;padding:0.2rem 0.4rem;border-radius:4px;background:#1a1a2e;color:#eee;border:1px solid #444;";
    const sketchModules = import.meta.glob("../web-audio/ui/sketches/*.js");
    const sketches = [
      { label: "Pulse Shapes", path: "../web-audio/ui/sketches/pulse-shapes.js" },
      { label: "Reactive Geometry", path: "../web-audio/ui/sketches/reactive-geometry.js" },
      { label: "Sequence Grid", path: "../web-audio/ui/sketches/sequence-grid.js" },
    ];
    for (const sk of sketches) {
      const opt = document.createElement("option");
      opt.value = sk.path;
      opt.textContent = sk.label;
      this._sketchSelect.appendChild(opt);
    }
    this._sketchSelect.addEventListener("change", () => {
      this._loadSketchByPath(this._sketchSelect.value, sketchModules);
    });
    this._sketchModules = sketchModules;
    vizToolbar.appendChild(sketchLabel);
    vizToolbar.appendChild(this._sketchSelect);
    vizDetails.appendChild(vizToolbar);

    this._vizEl = document.createElement("wam-visualizer");
    this._vizEl.style.cssText =
      "display:block;width:100%;height:300px;border:1px solid #333;border-radius:6px;overflow:hidden;margin-top:0.5rem;";
    vizDetails.appendChild(this._vizEl);
    vizRow.appendChild(vizDetails);
    main.appendChild(vizRow);

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
    this._drawer.addPanel("add", palette, "Add Instrument");

    // Instruments list
    this._instrumentList = document.createElement("div");
    this._instrumentList.style.cssText = "display:flex;flex-direction:column;gap:1rem;";
    main.appendChild(this._instrumentList);

    // Route instrument trigger events to the analysis bus
    this._instrumentList.addEventListener("wam-trigger", (e) => {
      const ctrl = e.target;
      const entry =
        this._instruments.find((ent) => ent.ctrl === ctrl) || this._pendingInstruments.find((ent) => ent.ctrl === ctrl);
      if (entry) this._analysisBus.trigger(entry.analysisKey, e.detail.velocity);
    });

    // Empty state
    this._emptyMsg = document.createElement("p");
    this._emptyMsg.textContent = "No instruments added yet. Click a button above to add one.";
    this._emptyMsg.style.cssText = "opacity:.4;font-style:italic;";
    this._instrumentList.appendChild(this._emptyMsg);

    // Save/load listeners
    this._onControlsChange = () => {
      if (!this._isLoadingState) {
        // Clear song association once user makes manual edits
        if (this._currentSongName) this._setCurrentSongName(null);
        this._debouncedSave();
      }
    };
    this.addEventListener("controls-change", this._onControlsChange);
    this._transportEl.addEventListener("transport-change", this._onControlsChange);
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
    // Insert a dedicated gain node after the master so sidechain can modulate it
    this._sidechainGain = this._ctx.createGain();
    this._sidechainGain.gain.value = 1.0;
    this._transportEl.connect(this._sidechainGain);
    this._sidechainGain.connect(this._ctx.destination);

    // Wire visualizer analysis bus
    this._analysisBus.setContext(this._ctx);
    this._analysisBus.setMaster(this._transportEl.masterAnalyser);
    this._vizEl.init(this._analysisBus, this._ctx);
    this._loadSketchByPath(this._sketchSelect.value, this._sketchModules);

    this._transportEl.addEventListener("transport-share-click", () => {
      this._shareURL();
    });

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
      // Clear any queued song so we don't accidentally load it on next play
      if (this._queuedState) {
        this._queuedState = null;
        this._setCurrentSongName(this._queuedSongName); // Restore intended next name
        this._queuedSongName = null;
      }

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
      // Process DJ style arrangement chaining over measure boundary
      if (step === 0 && this._queuedState) {
        this._applyState(this._queuedState);
        this._setCurrentSongName(this._queuedSongName);
        this._queuedState = null;
        this._queuedSongName = null;
      }

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
      const bar = Math.floor(this._globalStep / 16);
      this._analysisBus.setBeat(step, bar, this._transportEl.bpm, dur, time);
      for (const entry of this._instruments) {
        if (entry.def.step) {
          entry.def.step(entry.ctrl, step, time, dur);
        } else {
          // Loop player (and any other step-less instrument that implements step())
          entry.ctrl.step?.(this._globalStep, this._transportEl.bpm, time);
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

  // ---- Instrument Bus ----

  /** Read-only map of tappable instrument outputs: instanceId → { label, tapNode }. */
  get instrumentBus() {
    return this._instrumentBus;
  }

  _dispatchBusUpdate() {
    this.dispatchEvent(
      new CustomEvent("instrument-bus-update", {
        bubbles: true,
        detail: { bus: this._instrumentBus },
      }),
    );
  }

  // ---- Add / Remove ----

  _addInstrument(def, triggerSave = true) {
    if (!this._ctx) this._initAudio();
    if (this._ctx.state === "suspended") this._ctx.resume();

    const bpm = this._transportEl.bpm ?? 128;
    const instrument = def.make(this._ctx);

    // Apply a sensible default volume to prevent a wall of max-gain sound when adding new instruments.
    // If we're loading state (triggerSave === false), the `ctrl.fromJSON()` later will overwrite this anyway.
    if (triggerSave) {
      instrument.volume = 0.25;
    }

    const ctrl = document.createElement(def.tag);

    ctrl.bind(instrument, this._ctx, def.bindOpts(bpm));
    ctrl.connect(this._transportEl.masterGain);
    this._transportEl.registerInstrument(ctrl);
    this._transportEl.broadcastScale();

    const instanceId = this._instanceCounter++;
    const analysisKey = `${def.label} ${instanceId}`;
    this._analysisBus.addInstrument(analysisKey, ctrl);

    const entry = { def, ctrl, instrument, instanceId, analysisKey };

    // Tap node for cross-instrument routing (vocoder carrier, sidechain trigger, etc.)
    // Routing instruments (vocoder, sidechain) produce no useful audio output, so skip them.
    const isBusSource = def.id !== "vocoder" && def.id !== "sidechain";
    if (isBusSource) {
      const tapNode = this._ctx.createGain();
      ctrl.preFaderOutput.connect(tapNode); // pre-fader tap: post-FX, bypasses mute/volume
      entry.tapNode = tapNode;
      this._instrumentBus.set(instanceId, { label: `${def.label} (${instanceId + 1})`, tapNode });
      this._dispatchBusUpdate();
    }

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
    if (triggerSave && !this._isLoadingState) {
      if (this._currentSongName) this._setCurrentSongName(null);
      this._debouncedSave();
    }

    return entry;
  }

  _removeInstrument(entry, row) {
    this._analysisBus.removeInstrument(entry.analysisKey);
    this._transportEl.unregisterInstrument(entry.ctrl);
    entry.ctrl.disconnect();
    if (entry.tapNode) {
      entry.tapNode.disconnect();
      this._instrumentBus.delete(entry.instanceId);
      this._dispatchBusUpdate();
    }
    if (row && row.parentNode === this._instrumentList) {
      this._instrumentList.removeChild(row);
    }
    this._instruments = this._instruments.filter((e) => e !== entry);
    this._pendingInstruments = this._pendingInstruments.filter((e) => e !== entry);
    if (this._instruments.length === 0 && this._pendingInstruments.length === 0) {
      this._emptyMsg.style.display = "";
    }
    if (!this._isLoadingState) {
      if (this._currentSongName) this._setCurrentSongName(null);
      this._debouncedSave();
    }
  }

  // ---- State Serialization ----

  _setCurrentSongName(name) {
    this._currentSongName = name || null;
    window._store?.set(StoreKeys.SONG_NAME, this._currentSongName);
    if (this._currentSongLabel) {
      if (this._currentSongName) {
        this._currentSongLabel.textContent = `— Playing: ${this._currentSongName}`;
        // Sync the input in the library element so "Save Current" doesn't require retyping
        if (this._libraryEl && this._libraryEl._nameInput) {
          this._libraryEl._nameInput.value = this._currentSongName;
        }
      } else {
        this._currentSongLabel.textContent = "";
      }
    }
  }

  async _applyState(state) {
    this._isLoadingState = true;

    if (state.songName !== undefined) {
      this._setCurrentSongName(state.songName);
    }

    // 1. Clear existing
    for (const entry of [...this._instruments, ...this._pendingInstruments]) {
      this._analysisBus.removeInstrument(entry.analysisKey);
      this._transportEl.unregisterInstrument(entry.ctrl);
      entry.ctrl.disconnect();
      if (entry.tapNode) entry.tapNode.disconnect();
      if (entry.row && entry.row.parentNode === this._instrumentList) {
        this._instrumentList.removeChild(entry.row);
      }
    }
    this._instruments = [];
    this._pendingInstruments = [];
    this._instrumentBus.clear();
    this._dispatchBusUpdate();

    // 2. Load transport state
    if (state.transport) {
      this._transportEl.fromJSON(state.transport);
    }

    // 3. Load instruments
    if (state.instruments && Array.isArray(state.instruments)) {
      for (const instDef of state.instruments) {
        const typeDef = INSTRUMENT_TYPES.find((t) => t.id === instDef.id);
        if (typeDef) {
          const entry = this._addInstrument(typeDef, false);
          if (entry && instDef.state) {
            entry.ctrl.fromJSON(instDef.state);
          }
        }
      }
    }

    if (this._instruments.length === 0 && this._pendingInstruments.length === 0) {
      this._emptyMsg.style.display = "";
    }

    this._isLoadingState = false;
    this._debouncedSave();
  }

  _getState() {
    const state = {
      v: 1,
      songName: this._currentSongName || null,
      transport: this._transportEl.toJSON(),
      instruments: [],
    };
    // Save active and pending instruments
    for (const entry of this._instruments.concat(this._pendingInstruments)) {
      state.instruments.push({
        id: entry.def.id,
        instanceId: entry.instanceId,
        state: entry.ctrl.toJSON(),
      });
    }
    return state;
  }

  _debouncedSave() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._saveToLocalStorage(), 500);
  }

  _saveToLocalStorage() {
    try {
      localStorage.setItem(PlaygroundApp.STORAGE_KEY, JSON.stringify(this._getState()));
    } catch (e) {
      // quota exceeded or private mode — ignore
    }
  }

  _loadFromLocalStorage() {
    try {
      const raw = localStorage.getItem(PlaygroundApp.STORAGE_KEY);
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

  async _loadSketchByPath(relativePath, sketchModules) {
    const loader = sketchModules[relativePath];
    if (!loader) {
      console.error("[playground] No sketch module for path:", relativePath);
      return;
    }
    const mod = await loader();
    this._vizEl.loadSketchModule(mod.default);
  }

  _shareURL() {
    const json = JSON.stringify(this._getState());
    const b64 = btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const url = `${location.origin}${location.pathname}#s=${b64}`;
    navigator.clipboard?.writeText(url).then(
      () => {
        // Find existing share btn and update text if possible,
        // but transport 'share-click' handles its own text updates as well.
      },
      () => prompt("Copy this URL:", url),
    );
  }

  async _loadInitialState() {
    this._initAudio(); // Ensure transport is created

    const pendingState = this._loadFromURL() || this._loadFromLocalStorage();
    if (!pendingState) return;

    try {
      await this._applyState(pendingState);
    } catch (e) {
      console.warn("Failed to load saved configuration", e);
    }
  }
}

customElements.define("playground-app", PlaygroundApp);
