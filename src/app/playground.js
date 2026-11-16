import { Clock } from "../web-audio/global/clock.js";
import { Conductor } from "../web-audio/global/evolver.js";
import WamAnalysisBus from "../web-audio/ui/analysis-bus.js";
import "../web-audio/ui/visualizer.js";

// Import all instrument modules (registers custom elements as a side-effect)
import "../web-audio/ui/transport.js";

import { tryGlobKeys, tryGlobModules, resolveSamples, resolveSongs } from "../web-audio/global/sample-utils.js";
import { INSTRUMENTS, createInstrument, controlsOptions } from "../web-audio/instruments/registry.js";
import "../web-audio/ui/arrangement-library.js";
import { focusManager } from "../web-audio/ui/focus-manager.js";
import { sequencerHardware } from "../web-audio/midi/sequencer-hardware.js";
import { ledFeedback } from "../web-audio/midi/led-feedback.js";
import { autoMap } from "../web-audio/midi/auto-map.js";
import { performanceSurface } from "../web-audio/midi/performance-surface.js";
import { performanceStream } from "../web-audio/global/performance-stream.js";
import "../site/sync-panel.js";
import { startSyncBridge } from "../site/sync-bridge.js";
import { PlaygroundAutosave } from "./playground-autosave.js";
import "../web-audio/ui/hardware-map.js";
import {
  bindingFor,
  COMMANDS,
  DEFAULT_COMMAND_CONTROLS,
  DEFAULT_TEMPLATE,
} from "../web-audio/midi/launch-control-xl.js";
import { registerCommandBinding } from "../web-audio/input/input-bindings.js";
import { ensureMidiInputSource } from "../web-audio/input/midi-source.js";
import { ensureKeyboardInputSource } from "../web-audio/input/keyboard-source.js";
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
    fallbackDir: "audio/samples/breaks/",
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
    fallbackDir: "audio/samples/perc-loops/",
    fallbackFiles: ["FX_Loops_058_loop_4_.wav", "FX_Loops_068_loop_4_.wav"],
  },
  kicks: {
    glob: tryGlobKeys(() => import.meta.glob("/_assets/samples/01-kick/*.wav")),
    servedAt: "_assets/samples/01-kick/",
    fallbackDir: "audio/samples/kicks/",
    fallbackFiles: ["B.DRUM_14.wav", "B.DRUM_17.wav", "B.DRUM_23.wav", "B.DRUM_27.wav"],
  },
  snares: {
    glob: tryGlobKeys(() => import.meta.glob("/_assets/samples/02-snare/*.wav")),
    servedAt: "_assets/samples/02-snare/",
    fallbackDir: "audio/samples/snares/",
    fallbackFiles: ["CLAP_5.wav", "SNARE_5.wav", "SNARE_7.wav", "SNARE_14.wav"],
  },
  hits: {
    glob: tryGlobKeys(() => import.meta.glob("/_assets/samples/04-perc/*.wav")),
    servedAt: "_assets/samples/04-perc/",
    fallbackDir: "audio/samples/hits/",
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
    fallbackDir: "audio/samples/vocals/",
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
 * Instrument types for this app: the library registry
 * (web-audio/instruments/registry.js) + this app's sample folders.
 * Each entry: { id, label, color, make(ctx), tag, bindOpts(bpm), step|null }.
 */
const SAMPLE_SETS = {
  breaks: LOOP_FILES_BREAKS,
  percloops: LOOP_FILES_PERCL,
  kicks: SAMPLE_FILES_KICKS,
  snares: SAMPLE_FILES_SNARES,
  hits: SAMPLE_FILES_HITS,
  vocals: LOOP_FILES_VOCALS,
};
const stepSequenced = (ctrl, step, time, dur) => ctrl.step(step, time, dur);
const INSTRUMENT_TYPES = INSTRUMENTS.map((def) => ({
  id: def.id,
  label: def.label,
  color: def.color,
  make: (ctx) => createInstrument(def, ctx),
  tag: def.controlsTag,
  bindOpts: (bpm) => controlsOptions(def, { bpm, files: SAMPLE_SETS[def.samples] }),
  // Step-less types (loop players) own their timing: step(globalStep, bpm, time).
  step: def.sequenced ? stepSequenced : null,
}));

export default class PlaygroundApp extends HTMLElement {
  static STORAGE_KEY = "wam_playground_settings";

  connectedCallback() {
    this._ctx = null;
    this._transport = null;
    this._seq = null; // the Clock (sequencer-compatible) — see _initAudio
    this._clock = null;

    // Live instrument entries: [{ def, ctrl, instrument, instanceId, row, tapNode? }]
    this._instruments = [];
    // Instruments waiting for the next bar boundary before joining the active list
    this._pendingInstruments = [];
    // Bus of tappable instrument outputs: instanceId → { label, tapNode }
    this._instrumentBus = new Map();

    this._instanceCounter = 0;
    this._isLoadingState = false;
    this._analysisBus = new WamAnalysisBus();

    // Evolve: schedules pattern variations across instruments (global/evolver.js).
    this._conductor = new Conductor({
      tracks: () =>
        this._slotEntries().map((e) => {
          const ev = e.ctrl.evolver;
          if (ev) ev.label = e.def.label;
          return ev;
        }),
    });
    this._conductor.addEventListener("change", () => this._debouncedSave?.());

    this._autosave = new PlaygroundAutosave({
      getState: () => this._getState(),
      onStatus: (status) => this._showSaveStatus(status),
    });

    this._addCSS();
    this._buildUI();
    this._loadInitialState();

    // Hardware control: track the focused instrument and let the Launch Control
    // XL's 16 buttons drive its sequencer. Guarantee a jam binding on focus.
    focusManager.start();
    sequencerHardware.start();
    autoMap.start();
    // Launch Control XL performance layer: fader mixer (slots in row order),
    // Steps/Mixer/Perform button modes, knob paging, LED state.
    performanceSurface.setInstrumentsProvider(() => [...this._instruments, ...this._pendingInstruments].map((e) => e.ctrl));
    performanceSurface.setConductor(this._conductor);
    performanceSurface.start();

    // Make sure raw MIDI and keyboard are translated into normalized
    // control-input/command events even before learn mode is engaged, then
    // register the default command bindings (transport + instrument nav) for
    // both the Launch Control XL and the computer keyboard.
    ensureMidiInputSource();
    ensureKeyboardInputSource();
    for (const [controlId, command] of Object.entries(DEFAULT_COMMAND_CONTROLS)) {
      const binding = bindingFor(controlId, DEFAULT_TEMPLATE);
      if (binding) registerCommandBinding(binding, command);
    }
    // Keyboard mirrors the XL: ↑/↓ step instruments, space toggles transport.
    registerCommandBinding({ source: "keyboard", key: "arrowup" }, COMMANDS.PREV_INSTRUMENT);
    registerCommandBinding({ source: "keyboard", key: "arrowdown" }, COMMANDS.NEXT_INSTRUMENT);
    registerCommandBinding({ source: "keyboard", key: " " }, COMMANDS.PLAY_STOP);
    registerCommandBinding({ source: "keyboard", key: "arrowleft" }, COMMANDS.PAGE_PREV);
    registerCommandBinding({ source: "keyboard", key: "arrowright" }, COMMANDS.PAGE_NEXT);

    this._onInstrumentFocus = (e) => {
      const ctrl = e.detail?.controls;
      // Newly-added instruments become the focused/hardware-target instrument
      // like any other focus, but shouldn't auto-expand — they should appear
      // collapsed until the user opens them.
      const keepCollapsed = !!e.detail?.keepCollapsed;
      const idx = ctrl ? this._instruments.findIndex((en) => en.ctrl === ctrl) : -1;
      // Publish the focused instrument's serializable id (not the element).
      window._store?.set(StoreKeys.FOCUS_INSTRUMENT_ID, idx >= 0 ? this._instruments[idx].instanceId : null);

      // Highlight the focused instrument: expand all three of its panels and
      // collapse every other instrument's, then scroll it near the top.
      // Drive BOTH layers together — section visibility (setAllPanels) and the
      // channel-strip collapse (collapsed) — so they never drift out of sync
      // and the strip-click toggle stays predictable.
      for (const entry of this._instruments) {
        const isFocused = entry.ctrl === ctrl;
        const expand = isFocused && !keepCollapsed;
        entry.ctrl.setAllPanels?.(expand);
        if (entry.ctrl) entry.ctrl.collapsed = !expand;
      }
      if (idx >= 0) this._scrollInstrumentIntoView(this._instruments[idx].row);

      if (!ctrl?.ensureJamBinding) return;
      ctrl.ensureJamBinding(idx >= 0 && idx < 9 ? String(idx + 1) : null);
    };
    document.addEventListener("wam-instrument-focus-change", this._onInstrumentFocus);
    this._onCommand = (e) => this._handleCommand(e);
    document.addEventListener("wam-command", this._onCommand);
  }

  _handleCommand(e) {
    const { command } = e.detail;
    switch (command) {
      case "play-stop":
        if (!this._transportEl) break;
        this._transportEl.playing ? this._transportEl.stop() : this._transportEl.play();
        break;
      case "next-instrument":
        this._stepInstrument(1);
        break;
      case "prev-instrument":
        this._stepInstrument(-1);
        break;
    }
  }

  _stepInstrument(dir) {
    if (this._instruments.length === 0) return;
    const currentId = window._store?.get(StoreKeys.FOCUS_INSTRUMENT_ID);
    const idx = this._instruments.findIndex((inst) => inst.instanceId === currentId);
    let nextIdx = idx + dir;
    if (nextIdx < 0) nextIdx = this._instruments.length - 1;
    if (nextIdx >= this._instruments.length) nextIdx = 0;

    const nextInst = this._instruments[nextIdx];
    // Focus it
    const ctrl = nextInst.ctrl;
    ctrl.dispatchEvent(
      new CustomEvent("wam-instrument-focus", {
        bubbles: true,
        detail: { controls: ctrl },
      }),
    );
  }

  // ---- Performance stream (notes / beats / instrument table for external visualizers) ----

  /** Instruments in row order (active + pending) — the same slots the faders use. */
  _slotEntries() {
    return [...this._instruments, ...this._pendingInstruments];
  }

  _streamNote(entry, note) {
    const slot = this._slotEntries().indexOf(entry) + 1;
    const payload = {
      id: entry.instanceId,
      slot,
      instrument: entry.def.id,
      name: entry.def.label,
      color: entry.def.color,
      notes: note.notes,
      note: note.notes[0] ?? null,
      velocity: Math.round(note.velocity * 1000) / 1000,
      accent: note.accent,
      duration: note.duration == null ? null : Math.round(note.duration * 1000) / 1000,
      step: this._streamPos?.step ?? null,
      bar: this._streamPos?.bar ?? null,
    };
    if ("open" in note) payload.open = note.open;
    performanceStream.note(payload, note.time);
  }

  /** Publish slot → instrument (debounced; persisted so late-joining visualizers get it). */
  _publishInstrumentList() {
    clearTimeout(this._instrumentListTimer);
    this._instrumentListTimer = setTimeout(() => {
      performanceStream.instruments(
        this._slotEntries().map((e, i) => ({ slot: i + 1, id: e.instanceId, instrument: e.def.id, name: e.def.label, color: e.def.color })),
      );
    }, 50);
  }

  /** Scroll an instrument row into view. */
  _scrollInstrumentIntoView(row) {
    if (!row) return;
    const y = row.getBoundingClientRect().top + window.scrollY - 12;
    window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
  }

  disconnectedCallback() {
    this.removeEventListener("controls-change", this._onControlsChange);
    document.removeEventListener("wam-instrument-focus-change", this._onInstrumentFocus);
    document.removeEventListener("wam-command", this._onCommand);
    performanceSurface.stop();
    this._stopSyncBridge?.();
    sequencerHardware.stop();
    autoMap.stop();
    focusManager.stop();
    this._teardownHardwareMap?.();
  }

  // ---- UI ----

  _addCSS() {
    const style = document.createElement("style");
    style.textContent = /* css */ `
      body {
        background: #0d0d14;
        color: #cfcff0;
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.9rem;
        line-height: 1.4rem;
      }
      main {
        margin: 0 auto;
        padding: 2rem;
      }

      @media (max-width: 600px) {
        main {
          padding: 1rem;
        }
      }
      /* Room for the hardware-map column (see the MIDI drawer placement setting). */
      body.wam-hw-column-open main {
        margin-right: var(--wam-hw-column-width, 380px);
      }
    `;
    this.appendChild(style);
  }

  _buildUI() {
    const main = document.createElement("main");
    this.appendChild(main);

    // Shared tool drawer (panels registered below).
    this._drawer = document.createElement("wam-drawer");
    this.appendChild(this._drawer);

    // ---- Sticky top bar: transport + tool launcher toolbar ----
    const topBar = document.createElement("section");
    this._topBar = topBar;
    topBar.style.cssText =
      "position:relative;z-index:50;background:#0d0d14;padding:0.5rem 0 0.6rem;margin-bottom:1.25rem;border-bottom:1px solid #24243a;";

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
    mkLauncher("sync", "⇄ Sync");
    mkLauncher("evolve", "∿ Evolve");
    mkLauncher("record", "⏺ Record");
    mkLauncher("viz", "◎ Viz");

    this._currentSongLabel = document.createElement("span");
    this._currentSongLabel.style.cssText = "opacity:0.85;margin-left:0.5rem;font-size:0.8rem;color:#4f8;";
    toolbar.appendChild(this._currentSongLabel);

    // Autosave problems are shown here (hidden while saving works).
    this._saveStatusEl = document.createElement("span");
    this._saveStatusEl.className = "wam-save-status";
    this._saveStatusEl.hidden = true;
    this._saveStatusEl.style.cssText = "margin-left:0.75rem;font-size:0.78rem;color:#ff7a59;cursor:help;";
    toolbar.appendChild(this._saveStatusEl);

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
    const songsPanel = document.createElement("div");
    songsPanel.style.cssText = "display:flex;flex-direction:column;gap:1rem;";
    songsPanel.appendChild(this._libraryEl);
    songsPanel.appendChild(this._buildRecoverPanel());
    this._drawer.addPanel("songs", songsPanel, "Songs & Saves");

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
    autoMapLabel.append(autoMapToggle, "Auto-map knobs to focused instrument");
    this._midiPanelEl.appendChild(autoMapLabel);

    // On-screen map of the Launch Control XL layout (clickable). Placement:
    //   auto    — right column while an LCXL is connected, else in this drawer
    //   column  — always the right column     bottom — docked to the bottom
    //   drawer  — only in this drawer
    // A column falls back to the bottom dock on narrow screens.
    this._hardwareMap = document.createElement("wam-hardware-map");
    this._hardwareMap.surface = performanceSurface;
    const placeLabel = document.createElement("label");
    placeLabel.style.cssText = autoMapLabel.style.cssText;
    const placeSelect = document.createElement("select");
    placeSelect.className = "wam-select";
    placeSelect.style.cssText = "margin:0;width:auto;font-size:0.8rem;padding:0.15rem 0.4rem;";
    for (const [v, t] of [["auto", "Auto (right column when an LCXL is connected)"], ["column", "Right column"], ["bottom", "Bottom of the page"], ["drawer", "In this drawer only"]]) {
      placeSelect.add(new Option(t, v));
    }
    placeLabel.append("Hardware map:", placeSelect);
    this._midiPanelEl.appendChild(placeLabel);
    const placeKey = "wam_hardware_map_place";
    let place = "auto";
    try {
      place = localStorage.getItem(placeKey) ?? (localStorage.getItem("wam_hardware_map_docked") === "1" ? "bottom" : "auto");
    } catch {}
    placeSelect.value = place;
    const narrow = window.matchMedia?.("(max-width: 1100px)");
    const applyPlace = () => {
      let where = place === "auto" ? (ledFeedback.connected ? "column" : "drawer") : place;
      if (where === "column" && narrow?.matches) where = "bottom";
      const map = this._hardwareMap;
      map.toggleAttribute("docked", where === "bottom");
      if (where === "column") map.setAttribute("layout", "column");
      else map.removeAttribute("layout");
      if (where === "drawer") this._midiPanelEl.insertBefore(map, placeLabel.nextSibling);
      else if (map.parentNode !== document.body) document.body.appendChild(map);
      document.body.classList.toggle("wam-hw-column-open", where === "column");
    };
    placeSelect.addEventListener("change", () => {
      place = placeSelect.value;
      try { localStorage.setItem(placeKey, place); } catch {}
      applyPlace();
    });
    document.addEventListener("wam-lcxl-connection", applyPlace);
    narrow?.addEventListener?.("change", applyPlace);
    applyPlace();
    this._teardownHardwareMap = () => {
      document.removeEventListener("wam-lcxl-connection", applyPlace);
      narrow?.removeEventListener?.("change", applyPlace);
      document.body.classList.remove("wam-hw-column-open");
      if (this._hardwareMap.parentNode === document.body) this._hardwareMap.remove();
    };

    this._midiPanelEl.appendChild(document.createElement("wam-midi-monitor"));
    this._drawer.addPanel("midi", this._midiPanelEl, "MIDI");

    // ---- Evolve panel (drawer) ----
    this._drawer.addPanel("evolve", this._buildEvolvePanel(), "Evolve");

    // ---- Sync panel (drawer): Oversite server connection + what's shared ----
    this._drawer.addPanel("sync", document.createElement("wam-sync-panel"), "Sync");
    // Transport sync + performance-stream switches follow the Sync settings.
    this._stopSyncBridge = startSyncBridge(this._transportEl);

    // ---- Record panel (drawer): populated after transport init ----
    this._recordPanelEl = document.createElement("div");
    this._recordPanelEl.style.cssText = "display:flex;flex-direction:column;gap:0.75rem;";
    const recordHint = document.createElement("p");
    recordHint.textContent = "Recorder appears here once audio is initialized.";
    recordHint.style.cssText = "margin:0;opacity:0.7;font-size:0.85rem;";
    this._recordPanelEl.appendChild(recordHint);
    this._drawer.addPanel("record", this._recordPanelEl, "Record");

    // ---- Viz panel (drawer) ----
    const vizPanelEl = document.createElement("div");
    vizPanelEl.style.cssText = "display:flex;flex-direction:column;gap:0.75rem;";

    // Sketch selector
    const vizSketchRow = document.createElement("div");
    vizSketchRow.style.cssText = "display:flex;align-items:center;gap:0.5rem;";
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
    vizSketchRow.appendChild(sketchLabel);
    vizSketchRow.appendChild(this._sketchSelect);
    vizPanelEl.appendChild(vizSketchRow);

    // Position toggle
    const vizPosRow = document.createElement("div");
    vizPosRow.style.cssText = "display:flex;align-items:center;gap:0.5rem;";
    const vizPosLabel = document.createElement("label");
    vizPosLabel.textContent = "Position:";
    vizPosLabel.style.cssText = "font-size:0.8rem;opacity:0.7;";
    const mkVizPosBtn = (label, mode) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.dataset.vizMode = mode;
      b.style.cssText =
        "font-size:0.8rem;padding:0.25rem 0.6rem;border-radius:4px;cursor:pointer;background:#1a1a2e;border:1px solid #3a3a5a;color:#cfcff0;";
      b.addEventListener("click", () => {
        this._setVizMode(mode);
        vizPosRow.querySelectorAll("[data-viz-mode]").forEach((btn) => {
          btn.style.background = btn.dataset.vizMode === mode ? "#2a2060" : "#1a1a2e";
          btn.style.borderColor = btn.dataset.vizMode === mode ? "#9b8dff" : "#3a3a5a";
        });
      });
      return b;
    };
    const noneBtn = mkVizPosBtn("None", "none");
    const bgBtn = mkVizPosBtn("Fullscreen", "background");
    const cornerBtn = mkVizPosBtn("Corner", "corner");
    noneBtn.style.background = "#2a2060";
    noneBtn.style.borderColor = "#9b8dff";
    vizPosRow.appendChild(vizPosLabel);
    vizPosRow.appendChild(noneBtn);
    vizPosRow.appendChild(bgBtn);
    vizPosRow.appendChild(cornerBtn);
    vizPanelEl.appendChild(vizPosRow);

    this._drawer.addPanel("viz", vizPanelEl, "Visualizer");

    // Visualizer element — fixed in the background, outside normal layout flow.
    this._vizEl = document.createElement("wam-visualizer");
    this._vizEl.setAttribute("mode", "none");
    document.body.appendChild(this._vizEl);

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
      btn.addEventListener("click", () => {
        this._addInstrument(def);
        this._drawer.close();
      });
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
      if (entry && e.detail.note) this._streamNote(entry, e.detail.note);
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
    performanceStream.setContext(this._ctx);

    // The one musical clock: every panel, loop player, the visualizer and the
    // performance stream read their position from it (global/clock.js).
    this._clock = new Clock(this._ctx, { bpm: 128 });
    this._seq = this._clock; // transport/recorder use its sequencer-like surface

    this._transportEl.init(this._ctx, {
      bpm: 128,
      seq: this._seq,
      color: "#6366f1",
      showScales: true,
      showRecorder: false,
    });
    this._transportEl.connect(this._ctx.destination);

    // Move recorder controls into the shared side drawer instead of the transport strip area.
    if (this._recordPanelEl && this._transportEl.recorder) {
      this._recordPanelEl.innerHTML = "";
      this._recordPanelEl.appendChild(this._transportEl.recorder);
    }

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

    this._clock.onTick((pos) => {
      const { step, time, bar, dur } = pos;
      // Evolve runs at each bar start, before that bar's steps are scheduled.
      if (pos.downbeat) this._conductor.onBar(bar, pos.tick);
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

      // Performance stream: remember where we are for note payloads, and tick the beat.
      this._streamPos = { step, bar };
      performanceStream.beat({ step, bar, beat: pos.beat, downbeat: pos.downbeat, bpm: pos.bpm }, time);
      this._analysisBus.setBeat(step, bar, this._transportEl.bpm, dur, time);
      for (const entry of this._instruments) {
        if (entry.def.step) {
          entry.def.step(entry.ctrl, step, time, dur);
        } else {
          // Loop player (and any other step-less instrument that implements step())
          entry.ctrl.step?.(pos.tick, this._transportEl.bpm, time);
        }
      }
      const uiDelay = Math.max(0, (time - this._ctx.currentTime) * 1000);
      setTimeout(() => {
        for (const entry of this._instruments) {
          entry.ctrl.setActiveStep?.(step);
        }
      }, uiDelay);
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
    ctrl.clock = this._clock; // pattern position comes from the global clock
    ctrl.connect(this._transportEl.masterGain);
    this._transportEl.registerInstrument(ctrl);
    this._transportEl.broadcastScale();

    const instanceId = this._instanceCounter++;
    const analysisKey = `${def.label} ${instanceId}`;
    this._analysisBus.addInstrument(analysisKey, ctrl);

    const entry = { def, ctrl, instrument, instanceId, analysisKey };

    // Tell this track's FX sidechain picker its own id so it can't sidechain off itself.
    ctrl.setSidechainHostId?.(instanceId);

    // Tap node for cross-instrument routing (vocoder carrier, sidechain key, etc.)
    // Routing instruments (vocoder) produce no useful audio output, so skip them.
    const isBusSource = def.id !== "vocoder";
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
    performanceSurface.requestRefresh();
    this._publishInstrumentList();

    // Wrapper row
    const row = document.createElement("div");
    row.style.cssText = "position:relative;border:1px solid #ffffff18;border-radius:6px;";

    const removeBtn = document.createElement("button");
    removeBtn.textContent = "✕ Remove";
    removeBtn.style.cssText =
      "position:absolute;top:-.5rem;right:-.5rem;background:#ff334422;border:1px solid #ff334466;color:#f88;padding:.2rem .5rem;border-radius:4px;cursor:pointer;font-size:.75rem;z-index:1;";
    removeBtn.addEventListener("click", () => {
      if (!confirm(`Remove ${def.label}?`)) return;
      this._removeInstrument(entry, row);
    });

    row.appendChild(removeBtn);
    row.appendChild(ctrl);
    this._instrumentList.appendChild(row);
    entry.row = row;

    // A freshly-added instrument becomes the focused/hardware-target instrument
    // (same as clicking its title), but stays collapsed instead of auto-expanding.
    // Skip this while restoring a saved song (triggerSave === false) — loading
    // shouldn't steal focus onto whichever instrument happens to load last.
    if (triggerSave) {
      ctrl.dispatchEvent(
        new CustomEvent("wam-instrument-focus", { bubbles: true, detail: { controls: ctrl, keepCollapsed: true } }),
      );
    }

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
    performanceSurface.requestRefresh();
    this._publishInstrumentList();
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

  /**
   * Replace the session with `state`. Autosaves the result unless `save` is
   * false (startup restore: the state already IS the save — re-saving it would
   * make an unchanged refresh look like the newest work across tabs).
   */
  async _applyState(state, { save = true } = {}) {
    this._isLoadingState = true;
    this._autosave.suspended = true;
    const failures = [];
    try {

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
    if (state.evolve) this._conductor.fromJSON(state.evolve);

    // 3. Load instruments — one bad instrument must not abort the rest.
    if (state.instruments && Array.isArray(state.instruments)) {
      for (const instDef of state.instruments) {
        const typeDef = INSTRUMENT_TYPES.find((t) => t.id === instDef.id);
        if (!typeDef) {
          failures.push(`${instDef.id}: unknown instrument type`);
          continue;
        }
        try {
          const entry = this._addInstrument(typeDef, false);
          if (entry && instDef.state) entry.ctrl.fromJSON(instDef.state);
        } catch (err) {
          console.error(`[playground] Failed to restore "${instDef.id}":`, err);
          failures.push(`${instDef.id}: ${err?.message ?? err}`);
        }
      }
    }

    if (this._instruments.length === 0 && this._pendingInstruments.length === 0) {
      this._emptyMsg.style.display = "";
    }
    } finally {
      this._isLoadingState = false;
      this._autosave.suspended = false;
    }

    if (failures.length) {
      // Keep the original intact (backup) and tell the user; don't overwrite their save with a partial load.
      this._showSaveStatus({ ok: false, label: "⚠ Restore problem", error: `Some instruments couldn't be restored (${failures.join("; ")}). The full saved state is kept as a backup — see Songs → Recover.` });
      return failures;
    }
    if (save) this._debouncedSave();
    return failures;
  }

  _getState() {
    const state = {
      v: 1,
      songName: this._currentSongName || null,
      transport: this._transportEl.toJSON(),
      evolve: this._conductor.toJSON(),
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

  /** Request an autosave (debounced; flushed on page hide/unload). See playground-autosave.js. */
  _debouncedSave() {
    this._autosave?.schedule();
  }

  _showSaveStatus(status) {
    const el = this._saveStatusEl;
    if (!el) return;
    if (status.ok) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.textContent = status.label ?? "⚠ Not saving";
    el.title = status.error ?? "Autosave failed — see the console";
  }

  /**
   * Evolve drawer panel: auto-variations, Energy, Drift, phrase length, which
   * instruments take part, and a log of what changed. Energy is also knob C8
   * on the Launch Control XL.
   */
  _buildEvolvePanel() {
    const c = this._conductor;
    const el = document.createElement("div");
    el.className = "wam-evolve-panel";
    el.style.cssText = "display:flex;flex-direction:column;gap:.8rem;font-size:.82rem;color:#c8c8e0;--pico-form-element-spacing-vertical:.25rem;--pico-form-element-spacing-horizontal:.5rem;";
    el.innerHTML = `
      <p style="margin:0;opacity:.75;font-size:.76rem">Patterns vary around their <b>home</b> and snap back (gravity). <b>Drift</b> lets good variations stick, so the song keeps moving. Per instrument: Perform mode → Evolve / Keep / Return.</p>
      <label style="display:flex;gap:.5rem;align-items:center;margin:0"><input type="checkbox" name="auto" style="margin:0"> Auto-vary on phrase boundaries</label>
      <label style="margin:0">Energy <span class="ev-val" data-for="energy"></span> <small style="opacity:.6">(knob C8)</small>
        <input type="range" name="energy" min="0" max="1" step="0.01" style="margin:0"></label>
      <label style="margin:0">Drift <span class="ev-val" data-for="drift"></span> <small style="opacity:.6">0 = always return home</small>
        <input type="range" name="drift" min="0" max="1" step="0.01" style="margin:0"></label>
      <label style="margin:0">Phrase <select name="phrase" style="margin:0;width:auto"><option value="2">2 bars</option><option value="4">4 bars</option><option value="8">8 bars</option><option value="16">16 bars</option></select></label>
      <fieldset style="margin:0;padding:.5rem .7rem;border:1px solid #2a2a3a;border-radius:6px"><legend style="font-size:.72rem;opacity:.7">Taking part</legend><div class="ev-tracks" style="display:flex;flex-wrap:wrap;gap:.3rem .9rem"></div></fieldset>
      <div><div style="font-size:.72rem;opacity:.7;margin-bottom:.25rem">Recent</div><ol class="ev-log" style="margin:0;padding-left:1.2rem;font-size:.75rem;opacity:.85"></ol></div>`;
    const f = (n) => el.querySelector(`[name="${n}"]`);
    const sync = () => {
      f("auto").checked = c.auto;
      f("energy").value = c.energy;
      f("drift").value = c.drift;
      f("phrase").value = String(c.phrase);
      el.querySelector('[data-for="energy"]').textContent = `${Math.round(c.energy * 100)}%`;
      el.querySelector('[data-for="drift"]').textContent = `${Math.round(c.drift * 100)}%`;
    };
    const renderTracks = () => {
      const box = el.querySelector(".ev-tracks");
      box.replaceChildren();
      for (const e of this._slotEntries()) {
        const ev = e.ctrl.evolver;
        if (!ev) continue;
        const lab = document.createElement("label");
        lab.style.cssText = "display:flex;gap:.3rem;align-items:center;margin:0;font-size:.78rem";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.style.margin = "0";
        cb.checked = ev.enabled;
        cb.addEventListener("change", () => {
          ev.enabled = cb.checked;
          this._debouncedSave();
        });
        lab.append(cb, e.def.label);
        box.appendChild(lab);
      }
      if (!box.children.length) box.textContent = "No pattern instruments yet.";
    };
    const renderLog = () => {
      el.querySelector(".ev-log").innerHTML = c.log.map((x) => `<li>bar ${x.bar + 1} · ${x.label}: ${x.what}</li>`).join("") || "<li style=\"list-style:none;opacity:.6\">Nothing yet.</li>";
    };
    f("auto").addEventListener("change", () => (c.auto = f("auto").checked));
    f("energy").addEventListener("input", () => (c.energy = f("energy").value));
    f("drift").addEventListener("input", () => (c.drift = f("drift").value));
    f("phrase").addEventListener("change", () => (c.phrase = f("phrase").value));
    c.addEventListener("change", sync);
    c.addEventListener("event", renderLog);
    this._drawer.addEventListener("drawer-toggle", (e) => {
      if (e.detail.open && e.detail.id === "evolve") renderTracks();
    });
    sync();
    renderLog();
    return el;
  }

  /** "Recover" list: recent autosaves from any tab + the pre-load backup. */
  _buildRecoverPanel() {
    const wrap = document.createElement("details");
    wrap.className = "wam-recover";
    wrap.innerHTML = `<summary style="cursor:pointer;font-size:.85rem;opacity:.85">Recover an autosave</summary>
      <p style="font-size:.75rem;opacity:.7;margin:.4rem 0">Each tab autosaves separately. Recent sessions (newest first) — loading one replaces the current song (it's backed up first).</p>
      <div class="wam-recover-list" style="display:flex;flex-direction:column;gap:.35rem"></div>`;
    const list = wrap.querySelector(".wam-recover-list");
    const render = () => {
      list.replaceChildren();
      const items = this._autosave.recent();
      const backup = this._autosave.loadBackup();
      if (backup?.state) items.push({ backup: true, savedAt: backup.savedAt, instruments: backup.state.instruments?.length ?? 0, songName: backup.state.songName, state: backup.state });
      if (!items.length) list.textContent = "No autosaves yet.";
      for (const it of items) {
        const row = document.createElement("div");
        row.style.cssText = "display:flex;gap:.5rem;align-items:center;font-size:.78rem";
        const when = new Date(it.savedAt).toLocaleString();
        const what = `${it.songName ?? "Untitled"} · ${it.instruments} instrument${it.instruments === 1 ? "" : "s"}`;
        const tag = it.backup ? "backup (before last load)" : it.thisTab ? "this tab" : "other tab";
        const btn = document.createElement("button");
        btn.textContent = "Load";
        btn.className = "secondary outline";
        btn.style.cssText = "margin:0;padding:.15rem .6rem;font-size:.75rem;width:auto";
        btn.addEventListener("click", async () => {
          if (!confirm(`Replace the current song with the autosave from ${when}?`)) return;
          this._autosave.backup(this._getState(), "before-recover");
          await this._applyState(it.state);
          render();
        });
        const label = document.createElement("span");
        label.textContent = `${when} — ${what} (${tag})`;
        row.append(btn, label);
        list.appendChild(row);
      }
    };
    wrap.addEventListener("toggle", () => wrap.open && render());
    return wrap;
  }

  /** Share-link state from the URL: "#playground-app&s=<b64>" (or legacy "#s=<b64>"). */
  _loadFromURL() {
    try {
      const part = location.hash.slice(1).split("&").find((p) => p.startsWith("s="));
      if (!part) return null;
      const json = atob(part.slice(2).replace(/-/g, "+").replace(/_/g, "/"));
      return JSON.parse(json);
    } catch (e) {
      console.warn("[playground] Couldn't read the share link:", e);
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

  _setVizMode(mode) {
    this._vizEl?.setMode(mode);
  }

  _shareURL() {
    const json = JSON.stringify(this._getState());
    const b64 = btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const url = `${location.origin}${location.pathname}#playground-app&s=${b64}`;
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

    // A share link loads once; then drop it from the URL so a refresh restores
    // the autosave (your edits) instead of reloading the shared song.
    let pendingState = this._loadFromURL();
    const fromURL = !!pendingState;
    if (pendingState) {
      history.replaceState(null, "", `${location.pathname}${location.search}#playground-app`);
    } else {
      pendingState = this._autosave.load()?.state ?? null;
    }
    if (!pendingState) return;

    this._autosave.backup(pendingState, "startup");
    try {
      await this._applyState(pendingState, { save: fromURL });
      this._autosave.afterStartup();
    } catch (e) {
      console.error("[playground] Failed to load saved configuration", e);
      this._showSaveStatus({ ok: false, label: "⚠ Restore problem", error: `Couldn't restore the saved song: ${e?.message ?? e}. It's kept as a backup — see Songs → Recover.` });
    }
  }
}

customElements.define("playground-app", PlaygroundApp);
