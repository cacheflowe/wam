// Register the sibling control elements as a side effect so a bare
// `import "./controls-factory.js"` still pulls in the full basic-control family.
import "./level-meter.js";
import "./knob.js";
import "./param-display.js";

// Set to false to start all channel strips expanded by default.
export const CHANNEL_STRIP_COLLAPSED_DEFAULT = true;

/**
 * Inject shared CSS for `<wam-*-controls>` components.
 * Call from any controls component's bind() — only injects once.
 */
export function injectControlsCSS() {
  if (_controlsCSSInjected) return;
  _controlsCSSInjected = true;
  const s = document.createElement("style");
  s.textContent = /* css */ `
    .wam-panel {
      display: block;
      background: #141414;
      border: 1px solid #222;
      border-radius: 6px;
      font-family: monospace;
    }
    /* ---- Transport strip groups ---- */
    .wam-strip-bpm-group {
      display: flex;
      align-items: center;
      flex: 2 1 120px;
      min-width: 100px;
    }
    .wam-strip-scale-group {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 0 0 auto;
    }
    .wam-strip-scale-group .wam-select { max-width: 90px; }
    /* ---- Nav group label ---- */
    .wam-title {
      font-size: 0.7em;
      color: var(--slider-accent, #555);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      padding: 10px 14px 0;
    }
    .wam-controls {
      display: flex;
      flex-direction: column;
      gap: 0;
      padding: 6px 14px 10px;
    }
    .wam-section-ctrl > .wam-controls {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 8px;
      padding: 8px 14px 10px;
    }
    .wam-section {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 8px;
      border: 1px solid #2a2a2a;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.02);
    }
    .wam-section .wam-title { padding: 0; }
    .wam-section-controls {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(56px, 1fr));
      align-items: start;
      gap: 8px 6px;
    }
    .wam-wave-row {
      display: flex;
      gap: 6px;
      width: 100%;
    }
    /* ---- Shared control foundation ---- */
    /* All interactive controls share the same height, font, and box model.
       <input> elements need the element+class selector (input.wam-num-input) to reach
       specificity (0,1,1) — matching PicoCSS's input:not(...) rules — and win by
       source order since this style tag is injected after PicoCSS loads. */
    .wam-select,
    input.wam-num-input,
    .wam-wave-btn,
    .wam-toggle-btn,
    .wam-mute-btn,
    .wam-solo-btn,
    .wam-action-btn,
    .wam-jam-btn,
    .wam-play-btn {
      font-family: monospace;
      font-size: 0.8em;
      height: 22px;
      min-height: 22px;
      line-height: 1;
      box-sizing: border-box;
      border-radius: 3px;
      cursor: pointer;
    }
    /* ---- Passive inputs (select, number, wave) ---- */
    .wam-select,
    input.wam-num-input,
    .wam-wave-btn {
      background: #1a1a1a;
      color: #888;
      border: 1px solid #333;
    }
    .wam-select { 
      padding: 0 5px; 
      min-width:100px; 
      max-width: 160px; 
    }
    input.wam-num-input {
      padding: 0 5px;
      width: 52px;
      -moz-appearance: textfield;
    }
    input.wam-num-input::-webkit-inner-spin-button,
    input.wam-num-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
    .wam-wave-btn { padding: 0 10px; }
    .wam-wave-btn.wam-wave-active {
      color: var(--slider-accent, #0f0);
      border-color: var(--slider-accent, #0f0);
    }
    /* ---- Neutral toggle buttons (Ctrl / Seq / FX / Mute / Solo) ---- */
    .wam-toggle-btn,
    .wam-mute-btn,
    .wam-solo-btn {
      padding: 0 10px;
      background: transparent;
      color: #555;
      border: 1px solid #333;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .wam-toggle-btn[data-active] {
      background: color-mix(in srgb, var(--slider-accent, #0f0) 15%, transparent);
      color: var(--slider-accent, #0f0);
      border-color: var(--slider-accent, #0f0);
    }
    .wam-toggle-btn:hover { color: #888; border-color: #555; }
    .wam-toggle-btn[data-active]:hover {
      background: color-mix(in srgb, var(--slider-accent, #0f0) 25%, transparent);
    }
    .wam-mute-btn.wam-muted { background: #a00; color: #fff; border-color: #a00; }
    .wam-solo-btn.wam-soloed { background: #c90; color: #fff; border-color: #c90; }
    /* ---- Accent buttons (action, jam, play) ---- */
    .wam-action-btn,
    .wam-jam-btn,
    .wam-play-btn {
      background: color-mix(in srgb, var(--slider-accent, #0f0) 10%, #111);
      color: var(--slider-accent, #0f0);
      border: 1px solid var(--slider-accent, #0f0);
      white-space: nowrap;
    }
    .wam-action-btn { padding: 0 12px; }
    .wam-jam-btn    { padding: 0 10px; text-transform: uppercase; letter-spacing: 0.05em; }
    .wam-play-btn   { padding: 0 14px; letter-spacing: 0.04em; }
    .wam-action-btn:hover,
    .wam-jam-btn:hover,
    .wam-play-btn:hover { background: var(--slider-accent, #0f0); color: #000; }
    .wam-jam-btn.wam-jam-learning {
      background: var(--slider-accent, #0f0);
      color: #000;
      animation: wam-jam-pulse 0.6s ease-in-out infinite alternate;
    }
    @keyframes wam-jam-pulse {
      from { opacity: 1; }
      to   { opacity: 0.5; }
    }
    .wam-play-btn.wam-playing {
      background: color-mix(in srgb, var(--slider-accent, #0f0) 20%, #111);
    }
    /* ---- Record button ---- */
    .wam-rec-btn {
      font-family: monospace;
      font-size: 0.8em;
      height: 22px;
      min-height: 22px;
      line-height: 1;
      box-sizing: border-box;
      border-radius: 3px;
      cursor: pointer;
      padding: 0 10px;
      background: color-mix(in srgb, #c00 10%, #111);
      color: #c00;
      border: 1px solid #c00;
      white-space: nowrap;
    }
    .wam-rec-btn:hover { background: #c00; color: #fff; }
    .wam-rec-btn.wam-recording {
      background: #c00;
      color: #fff;
      animation: wam-rec-pulse 1s ease-in-out infinite;
    }
    @keyframes wam-rec-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.6; }
    }
    .wam-rec-timer {
      font-family: monospace;
      font-size: 0.75em;
      color: #c00;
      min-width: 2.5em;
    }
    .wam-rec-video-btn:not(.wam-recording) {
      background: color-mix(in srgb, #c80 10%, #111);
      color: #c80;
      border-color: #c80;
    }
    .wam-rec-video-btn:not(.wam-recording):hover { background: #c80; color: #000; }
    .wam-rec-loop-select {
      width: 100px;
      min-width: 100px;
      padding: 0 2px;
      text-align: center;
    }
    /* ---- Labeled control wrapper ---- */
    .wam-ctrl {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
      grid-column: span 2;
    }
    .wam-ctrl-wide { grid-column: span 4; }
    .wam-ctrl label {
      font-size: 0.7em;
      color: #555;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .wam-ctrl > :nth-child(2) {
      margin-bottom: var(--pico-spacing);
    }
    /* ---- Action row ---- */
    .wam-action-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 14px;
      border-top: 1px solid #1e1e1e;
    }
    /* ---- Section visibility ---- */
    [data-hidden] { display: none !important; }
    .wam-section-seq { border-top: 1px solid #1d1d1d; }
    .wam-section-fx  { border-top: 1px solid #1d1d1d; }
    .wam-section-ctrl[data-hidden] + .wam-section-seq { border-top: none; }
    /* ---- Channel strip ---- */
    .wam-channel-strip {
      display: flex;
      align-items: center;
      gap: 6px 10px;
      flex-wrap: wrap;
      padding: 6px 12px;
      border-bottom: 1px solid #1d1d1d;
      border-radius: 5px 5px 0 0;
      overflow: visible;
    }
    .wam-strip-name-group {
      display: flex;
      align-items: center;
      gap: 5px;
      flex: 0 1 88px;
      min-width: 56px;
      overflow: hidden;
    }
    .wam-strip-name {
      font-size: 0.7em;
      color: var(--slider-accent, #0f0);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      opacity: 0.75;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .wam-strip-chevron {
      font-size: 1.1rem;
      color: #555;
      transition: transform 0.15s ease;
      line-height: 1;
      flex-shrink: 0;
    }
    [data-collapsed] > .wam-channel-strip .wam-strip-chevron { transform: rotate(-90deg); }
    .wam-strip-viz-group {
      display: flex;
      align-items: center;
      gap: 5px;
      flex: 1 1 90px;
      max-width: 180px;
      min-width: 70px;
    }
    .wam-strip-viz-group wam-level-meter { flex-shrink: 0; }
    .wam-strip-viz-group wam-waveform {
      flex: 1;
      height: 30px;
      min-width: 40px;
      background: #080808;
      border-radius: 2px;
    }
    .wam-strip-jam-group {
      display: flex;
      align-items: center;
      gap: 4px;
      flex: 0 0 auto;
    }
    .wam-strip-jam-group:empty { display: none; }
    .wam-strip-mix-group {
      display: flex;
      align-items: flex-end;
      gap: 6px;
      flex: 2 1 180px;
      min-width: 140px;
    }
    .wam-strip-mix-group wam-knob             { flex: 0 0 auto; }
    .wam-strip-mix-group wam-knob[param="pan"] { flex: 0 0 auto; }
    .wam-strip-nav-group {
      display: flex;
      align-items: flex-end;
      gap: 4px;
      flex: 0 0 auto;
      margin-left: auto;
    }
    .wam-strip-nav-group .wam-ctrl { min-width: auto; }
    .wam-strip-nav-group:empty { display: none; }
    @media (max-width: 520px) {
      .wam-strip-name-group { flex: 0 0 100%; overflow: visible; padding-bottom: 2px; }
      .wam-strip-nav-group  { margin-left: 0; }
    }
    /* ---- Expanded / collapsed ---- */
    [data-collapsed] > .wam-expanded { display: none; }
    [data-no-sequencer] wam-step-seq,
    [data-no-sequencer] .wam-action-row { display: none; }
    /* ---- PicoCSS tooltip overrides for slider label ---- */
    .wam-label-text[data-tooltip],
    .wam-ctrl label[data-tooltip] {
      cursor: help;
      border-bottom: 0;
    }
    .wam-label-text[data-tooltip]::before,
    .wam-ctrl label[data-tooltip]::before {
      white-space: normal;
      overflow: visible;
      min-width: 130px;
      width: 130px;
      text-align: left;
      line-height: 1;
      font-family: monospace;
      font-size: 0.5rem;
    }
  `;
  document.head.appendChild(s);
}

let _controlsCSSInjected = false;

/**
 * Create a labeled control wrapper for use inside `.wam-section-controls`.
 * Append the returned element to a section controls row; add your input as a child.
 *
 * @param {string}  labelText
 * @param {object}  [opts]
 * @param {boolean} [opts.wide=false]  Use min-width: 220px instead of 110px
 * @returns {HTMLElement}
 */
export function createCtrl(labelText, { wide = false, tooltip = null } = {}) {
  const el = document.createElement("div");
  el.className = wide ? "wam-ctrl wam-ctrl-wide" : "wam-ctrl";
  const lbl = document.createElement("label");
  lbl.textContent = labelText;
  if (tooltip) lbl.setAttribute("data-tooltip", tooltip);
  el.appendChild(lbl);
  return el;
}

/**
 * Create a labeled section group for use inside `.wam-controls`.
 * Append the returned `el` to the controls container; add children to `controls`.
 *
 * @param {string} label  Section heading text
 * @returns {{ el: HTMLElement, controls: HTMLElement }}
 */
export function createSection(label) {
  const el = document.createElement("div");
  el.className = "wam-section";
  const lbl = document.createElement("div");
  lbl.className = "wam-title";
  lbl.textContent = label;
  el.appendChild(lbl);
  const controls = document.createElement("div");
  controls.className = "wam-section-controls";
  el.appendChild(controls);
  return { el, controls };
}

/**
 * Create a channel strip row for an instrument controls panel.
 * Includes instrument name (collapse toggle), level meter, vol slider, pan slider, mute button.
 * Applies CHANNEL_STRIP_COLLAPSED_DEFAULT to parentEl immediately.
 *
 * @param {HTMLElement} parentEl
 * @param {object} opts
 * @param {string}   opts.title
 * @param {function} opts.getOutGain   Getter returning the controls output GainNode
 * @param {number}   [opts.initialVol=1]
 * @param {number}   [opts.initialPan=0]
 * @param {boolean}  [opts.pan=true]   Set false to omit the pan slider (e.g. master bus)
 * @returns {{ volSlider, panSlider, meter, isMuted, setMuted }}
 */
export function createChannelStrip(
  parentEl,
  { title, getOutGain, initialVol = 1, initialPan = 0, pan = true, noCollapse = false, showMuteSolo = true },
) {
  if (!noCollapse && CHANNEL_STRIP_COLLAPSED_DEFAULT) parentEl.setAttribute("data-collapsed", "");

  const strip = document.createElement("div");
  strip.className = "wam-channel-strip";

  // Group 1: Name (+ optional collapse chevron)
  const nameGroup = document.createElement("div");
  nameGroup.className = "wam-strip-name-group";
  const nameEl = document.createElement("span");
  nameEl.className = "wam-strip-name";
  nameEl.textContent = title;
  nameGroup.appendChild(nameEl);
  if (!noCollapse) {
    const chevron = document.createElement("span");
    chevron.className = "wam-strip-chevron";
    chevron.textContent = "▾";
    nameGroup.appendChild(chevron);
    nameGroup.style.cssText += "cursor:pointer;user-select:none;";
    nameGroup.addEventListener("click", () => parentEl.toggleAttribute("data-collapsed"));
  }
  strip.appendChild(nameGroup);

  // Group 2: Visualizers — meter here; waveform added later by bind()
  const vizGroup = document.createElement("div");
  vizGroup.className = "wam-strip-viz-group";
  const meter = document.createElement("wam-level-meter");
  vizGroup.appendChild(meter);
  strip.appendChild(vizGroup);

  // Group 3: Jam/trigger buttons — filled by _buildStripActions in bind()
  const jamGroup = document.createElement("div");
  jamGroup.className = "wam-strip-jam-group";
  strip.appendChild(jamGroup);

  // Group 4: Mix — volume, pan, mute
  const mixGroup = document.createElement("div");
  mixGroup.className = "wam-strip-mix-group";

  const volSlider = document.createElement("wam-knob");
  volSlider.setAttribute("param", "volume");
  volSlider.setAttribute("label", "Vol");
  volSlider.setAttribute("min", "0");
  volSlider.setAttribute("max", "1");
  volSlider.setAttribute("step", "0.01");
  volSlider.value = initialVol;
  mixGroup.appendChild(volSlider);

  let panSlider = null;
  if (pan) {
    panSlider = document.createElement("wam-knob");
    panSlider.setAttribute("param", "pan");
    panSlider.setAttribute("label", "Pan");
    panSlider.setAttribute("min", "-1");
    panSlider.setAttribute("max", "1");
    panSlider.setAttribute("step", "0.01");
    panSlider.setAttribute("default", "0");
    panSlider.value = initialPan;
    mixGroup.appendChild(panSlider);
  }

  const muteBtn = showMuteSolo ? document.createElement("button") : null;
  if (muteBtn) {
    muteBtn.className = "wam-mute-btn";
    muteBtn.textContent = "Mute";
    const muteWrap = createCtrl("Mute", { tooltip: "Mute/unmute this channel." });
    muteWrap.appendChild(muteBtn);
    mixGroup.appendChild(muteWrap);
  }

  const soloBtn = showMuteSolo ? document.createElement("button") : null;
  if (soloBtn) {
    soloBtn.className = "wam-solo-btn";
    soloBtn.textContent = "Solo";
    const soloWrap = createCtrl("Solo", { tooltip: "Solo this channel — mute all others." });
    soloWrap.appendChild(soloBtn);
    mixGroup.appendChild(soloWrap);
  }

  strip.appendChild(mixGroup);

  // Group 5: Section nav toggles (Ctrl/Seq/FX) — filled by bind()
  const navGroup = document.createElement("div");
  navGroup.className = "wam-strip-nav-group";
  strip.appendChild(navGroup);

  parentEl.appendChild(strip);

  let muted = false;
  let soloed = false;
  let soloSuppressed = false;
  let preMuteVolume = 1;
  let preSoloVolume = 1;

  const syncMuteButton = () => {
    if (!muteBtn) return;
    muteBtn.classList.toggle("wam-muted", muted);
    muteBtn.textContent = "Mute";
  };

  const syncSoloButton = () => {
    if (!soloBtn) return;
    soloBtn.classList.toggle("wam-soloed", soloed);
    soloBtn.textContent = "Solo";
  };

  const applyMuteState = (nextMuted, { restoreOnUnmute = true } = {}) => {
    muted = !!nextMuted;
    const out = getOutGain();
    if (muted) {
      // Capture the real volume — use preSoloVolume if currently suppressed
      if (!soloSuppressed) preMuteVolume = out?.gain.value ?? 1;
      else preMuteVolume = preSoloVolume;
      if (out) out.gain.value = 0;
    } else if (restoreOnUnmute && !soloSuppressed) {
      if (out) out.gain.value = preMuteVolume;
    }
    syncMuteButton();
  };

  muteBtn?.addEventListener("click", () => {
    applyMuteState(!muted, { restoreOnUnmute: true });
    parentEl.dispatchEvent(new CustomEvent("controls-change", { bubbles: true }));
  });

  soloBtn?.addEventListener("click", () => {
    soloed = !soloed;
    syncSoloButton();
    parentEl.dispatchEvent(new CustomEvent("solo-change", { bubbles: true, detail: { soloed } }));
    parentEl.dispatchEvent(new CustomEvent("controls-change", { bubbles: true }));
  });

  return {
    strip,
    vizGroup,
    jamGroup,
    mixGroup,
    navGroup,
    volSlider,
    panSlider,
    meter,
    isMuted: () => muted,
    isSoloed: () => soloed,
    getVolume: () => {
      if (muted) return preMuteVolume;
      if (soloSuppressed) return preSoloVolume;
      return getOutGain()?.gain.value ?? 1;
    },
    setPreMuteVolume: (v) => {
      preMuteVolume = v;
    },
    setMuted: (v) => {
      // Keep existing behavior for state restore: unmuting does not overwrite restored volume.
      applyMuteState(v, { restoreOnUnmute: false });
    },
    setSoloed: (v) => {
      soloed = !!v;
      syncSoloButton();
    },
    /** Suppress/restore gain for solo coordination (does not affect mute state). */
    applySoloSuppress: (suppressed) => {
      const out = getOutGain();
      if (suppressed && !soloSuppressed && !muted) {
        // Entering suppression — capture the real current gain
        preSoloVolume = out?.gain.value ?? 1;
        if (out) out.gain.value = 0;
      } else if (!suppressed && soloSuppressed && !muted) {
        // Leaving suppression — restore the captured gain
        if (out) out.gain.value = preSoloVolume;
      }
      soloSuppressed = suppressed;
    },
  };
}
