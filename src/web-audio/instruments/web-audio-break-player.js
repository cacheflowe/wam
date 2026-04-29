import "../web-audio-slider.js";
import "../fx/web-audio-fx-unit.js";
import "../web-audio-waveform.js";
import "../fx/web-audio-pitch-shift.js";
import "../fx/web-audio-time-stretch.js";
import WebAudioInstrumentBase from "../web-audio-instrument-base.js";
import { WebAudioControlsBase, createSection } from "../web-audio-controls-base.js";

/**
 * WebAudioBreakPlayer — loads a drum loop, time-stretches it to the target
 * BPM, and plays it continuously with optional random playhead jumps that
 * snap to musical subdivisions and automatically return to the nominal
 * (on-track) position after a set number of steps.
 *
 * Architecture:
 *
 *   BufferSourceNode handles ALL transport. Its start(atTime, offset) method
 *   provides sample-accurate scheduling, which is essential for beat-synced
 *   loops with random jumps and reverses. Forward playback uses loop=true so
 *   the Web Audio engine wraps at sample precision — no stop/start glitch.
 *
 *   When useTimeStretch is enabled, a WebAudioPitchShift AudioWorklet EFFECT
 *   is inserted in the audio chain (not as a source — see pitch-shift.js for
 *   why). This gives independent control over speed and pitch:
 *
 *     - stretchRatio (×0.5/×1/×2) multiplies the BufferSourceNode playbackRate,
 *       which changes BOTH speed and pitch of the raw audio.
 *     - The pitch-shift effect then compensates to remove the unwanted pitch
 *       change: totalShift = userPitchShift - 12 * log2(stretchRatio)
 *     - Net result: speed changes independently of pitch, plus separate pitch control.
 *
 *   Signal chain:
 *     BufferSourceNode → [PitchShiftNode] → GainNode(_out) → ...
 *     (PitchShiftNode is only present when useTimeStretch is enabled)
 *
 * Playback rate formula:
 *   effectiveRate = (targetBpm / originalBpm) * speedMultiplier * stretchRatio
 *
 * Loop position tracking:
 *   loopSteps = round(bars * 16 / (speedMultiplier * stretchRatio))
 *   nominalOffset = (globalStep % loopSteps) / loopSteps * bufferDuration
 *
 * Usage:
 *   const brk = new WebAudioBreakPlayer(ctx, { subdivision: 8, returnSteps: 4 });
 *   await brk.load('../data/audio/breaks/0034-break-think.badsister_loop_4_.wav');
 *   brk.connect(ctx.destination);
 *
 *   // In sequencer onStep — call on every step:
 *   brk.trigger(globalStep, bpm, time);
 */
export default class WebAudioBreakPlayer extends WebAudioInstrumentBase {
  /**
   * @param {AudioContext} ctx
   * @param {object} [options]
   * @param {number} [options.speedMultiplier=1]  Cycles N× faster; pitch shifts accordingly
   * @param {number} [options.subdivision=8]      On-beat jump slots (4, 8, or 16)
   * @param {number} [options.returnSteps=4]      Steps after a jump before returning to nominal
   * @param {number} [options.randomChance=0.1]   0–1 probability of a forward jump per step
   * @param {number} [options.reverseChance=0.04] 0–1 probability of a reverse-playback event per step
   * @param {number} [options.volume=0.8]
   */
  constructor(ctx, options = {}) {
    super(ctx, null); // no presets — skip applyPreset

    this.speedMultiplier = options.speedMultiplier ?? 1;
    this.subdivision = options.subdivision ?? 8;
    this.returnSteps = options.returnSteps ?? 4;
    this.randomChance = options.randomChance ?? 0.1;
    this.reverseChance = options.reverseChance ?? 0.04;

    this._buffer = null;
    this._reverseBuffer = null;
    this._bars = 4;
    this._originalBpm = 120;

    this._source = null;
    this._sourcePlaybackRate = -1;
    this._returnAtStep = -1;

    // Pitch-shift effect (inserted in audio chain when useTimeStretch is enabled)
    this._useTimeStretch = options.useTimeStretch ?? false;
    this._pitchShift = 0;
    this._stretchRatio = 1; // ×0.5 / ×1 / ×2 — loop tempo multiplier (independent of Speed)
    this._grainStyle = "clean"; // "clean" (512 samples) or "vintage" (2048 samples)
    this._pitchShiftNode = null;

    this._out.gain.value = options.volume ?? 0.8;
  }

  // ---- Loading ----

  async load(url, bars) {
    this.stop();
    this._buffer = null;
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    this._buffer = await this.ctx.decodeAudioData(arrayBuffer);
    this._bars = bars ?? this._parseBars(url);
    this._originalBpm = (this._bars * 4 * 60) / this._buffer.duration;
    this._reverseBuffer = this._buildReverseBuffer(this._buffer);
    this._returnAtStep = -1;

    // Initialize pitch-shift effect node (lazy — only on first load when enabled)
    if (this._useTimeStretch && !this._pitchShiftNode) {
      const { default: WebAudioPitchShift } = await import("../fx/web-audio-pitch-shift.js");
      this._pitchShiftNode = new WebAudioPitchShift(this.ctx);
      await this._pitchShiftNode.ready;
      this._pitchShiftNode.connect(this._out);
    }

    return this;
  }

  _parseBars(url) {
    const m = url.match(/_loop_(\d+)_/i);
    return m ? parseInt(m[1]) : 4;
  }

  _buildReverseBuffer(buffer) {
    const reversed = this.ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const src = buffer.getChannelData(ch);
      const dst = reversed.getChannelData(ch);
      for (let i = 0; i < src.length; i++) dst[i] = src[src.length - 1 - i];
    }
    return reversed;
  }

  get loaded() {
    return this._buffer !== null;
  }

  // ---- Properties ----

  get pitchShift() {
    return this._pitchShift;
  }

  set pitchShift(v) {
    this._pitchShift = v;
    this._updatePitchShift();
  }

  get stretchRatio() {
    return this._stretchRatio;
  }

  set stretchRatio(v) {
    this._stretchRatio = v;
    this._updatePitchShift();
    // Force restart on next trigger to apply new playbackRate
    this._sourcePlaybackRate = -1;
  }

  get grainStyle() {
    return this._grainStyle;
  }

  set grainStyle(v) {
    this._grainStyle = v;
    if (this._pitchShiftNode) {
      this._pitchShiftNode.grainSize = v === "vintage" ? 2048 : 512;
    }
  }

  /** Recalculate pitch-shift effect: user pitch + compensation for stretchRatio. */
  _updatePitchShift() {
    if (!this._pitchShiftNode) return;
    const compensation = this._stretchRatio !== 1 ? -12 * Math.log2(this._stretchRatio) : 0;
    this._pitchShiftNode.pitchShift = this._pitchShift + compensation;
  }

  // ---- Playback ----

  /**
   * Call on every sequencer step. The looping source runs continuously;
   * this only intervenes for initial start, BPM changes, jumps, and returns.
   *
   * @param {number} globalStep  Absolute step count (resets to 0 on play).
   * @param {number} bpm         Current tempo in BPM.
   * @param {number} atTime      AudioContext scheduled time for this step.
   */
  trigger(globalStep, bpm, atTime) {
    if (!this._buffer) return;

    const playbackRate = (bpm / this._originalBpm) * this.speedMultiplier;
    const effectiveRate = playbackRate * this._stretchRatio;
    const effectiveMultiplier = this.speedMultiplier * this._stretchRatio;
    const loopSteps = Math.max(1, Math.round((this._bars * 16) / effectiveMultiplier));
    const nominalOffset = ((globalStep % loopSteps) / loopSteps) * this._buffer.duration;

    // Initial start or reverse event ended naturally — start looping from nominal
    if (!this._source) {
      this._startSource(nominalOffset, atTime, effectiveRate, false);
      this._returnAtStep = -1;
      return;
    }

    // BPM or stretchRatio changed — resync to nominal position with new rate
    if (Math.abs(this._sourcePlaybackRate - effectiveRate) > 0.0001) {
      this._startSource(nominalOffset, atTime, effectiveRate, false);
      this._returnAtStep = -1;
      return;
    }

    // Return from jump or reverse — back to nominal (forward)
    if (this._returnAtStep >= 0 && globalStep >= this._returnAtStep) {
      this._startSource(nominalOffset, atTime, effectiveRate, false);
      this._returnAtStep = -1;
      return;
    }

    // Random events — only when not already mid-jump
    if (this._returnAtStep < 0) {
      // Reverse playback (lower probability, checked first)
      if (Math.random() < this.reverseChance) {
        const slot = Math.floor(Math.random() * this.subdivision);
        const jumpOffset = (slot / this.subdivision) * this._buffer.duration;
        this._startSource(jumpOffset, atTime, effectiveRate, true);
        this._returnAtStep = globalStep + this.returnSteps;
        return;
      }
      // Forward jump
      if (Math.random() < this.randomChance) {
        const slot = Math.floor(Math.random() * this.subdivision);
        const jumpOffset = (slot / this.subdivision) * this._buffer.duration;
        this._startSource(jumpOffset, atTime, effectiveRate, false);
        this._returnAtStep = globalStep + this.returnSteps;
      }
    }
  }

  _startSource(offset, atTime, playbackRate, reverse) {
    // Always use BufferSourceNode for sample-accurate transport
    if (this._source) {
      try {
        this._source.stop(atTime);
      } catch (e) {
        // already ended
      }
      this._source = null;
    }

    const buf = reverse ? this._reverseBuffer : this._buffer;
    const source = this.ctx.createBufferSource();
    source.buffer = buf;
    source.playbackRate.value = playbackRate;

    // Forward sources loop seamlessly at the sample level — no stop/start glitch
    // Reverse sources play once; trigger() handles the return when they end
    if (!reverse) {
      source.loop = true;
      source.loopStart = 0;
      source.loopEnd = buf.duration;
    }

    // Route through pitch-shift effect if available, otherwise direct to output
    source.connect(this._pitchShiftNode?.input ?? this._out);
    source.start(atTime, offset);
    this._source = source;
    this._sourcePlaybackRate = playbackRate;
    source.onended = () => {
      if (this._source === source) this._source = null;
      source.disconnect();
    };
  }

  /**
   * Jump immediately to a fixed segment of the buffer (e.g. kick / hat / snare positions).
   * Cancels any pending return-from-jump so the loop continues from this new position.
   *
   * @param {number} segIndex    0-based segment index (0 = start, 1 = 1/3, 2 = 2/3 for numSegments=3)
   * @param {number} numSegments Number of equal segments to divide the buffer into
   * @param {number} bpm         Current tempo
   * @param {number} atTime      Scheduled AudioContext time
   */
  jumpToSegment(segIndex, numSegments, bpm, atTime) {
    if (!this._buffer) return;
    const playbackRate = (bpm / this._originalBpm) * this.speedMultiplier * this._stretchRatio;
    const offset = (segIndex / numSegments) * this._buffer.duration;
    this._startSource(offset, atTime, playbackRate, false);
    this._returnAtStep = -1;
  }

  stop(atTime) {
    if (this._source) {
      try {
        this._source.stop(atTime ?? this.ctx.currentTime);
      } catch (e) {
        // already ended
      }
      this._source = null;
    }
    this._returnAtStep = -1;
  }

  reset() {
    this._returnAtStep = -1;
    this.stop();
  }
}

// ---- Controls companion component ----

const SPEED_MULTIPLIERS = [
  { label: "×0.5", value: 0.5 },
  { label: "×1", value: 1 },
  { label: "×2", value: 2 },
  { label: "×4", value: 4 },
];

/**
 * WebAudioBreakPlayerControls — portable control panel for WebAudioBreakPlayer.
 *
 * Builds file select, speed/subdivision/return selects, sliders (randomChance,
 * reverseChance, volume), jam buttons (K/H/S), FX unit, and waveform.
 *
 * Audio routing: instrument → analyser → fxUnit → controls._out
 *
 * Usage:
 *   const controls = document.createElement("web-audio-break-player-controls");
 *   parent.appendChild(controls);
 *   controls.bind(breakPlayer, ctx, {
 *     files: [{ label: "Think (4)", file: "0034-break-think.badsister_loop_4_.wav" }],
 *     basePath: "../data/audio/breaks/",
 *     fx: { bpm: 128 },
 *   });
 *   controls.connect(masterGain);
 *   // On each sequencer tick:
 *   controls.step(globalStep, bpm, time);
 */
export class WebAudioBreakPlayerControls extends WebAudioControlsBase {
  static SLIDER_DEFS = [
    { param: "volume",        label: "Vol",        min: 0, max: 1,    step: 0.01 },
    { param: "randomChance",  label: "Rand Chance",min: 0, max: 1,    step: 0.01, tooltip: "Probability of jumping to a random segment instead of playing in sequence." },
    { param: "reverseChance", label: "Reverse",    min: 0, max: 0.25, step: 0.01, tooltip: "Probability of reversing a segment on each hit." },
  ];

  constructor() {
    super();
    this._fileSelect = null;
    this._speedSelect = null;
    this._subdivSelect = null;
    this._returnSelect = null;
    this._tsControls = null;
    this._basePath = "";
    this._pendingSegment = -1;
    this._globalStep = 0;
  }

  // ---- Override points ----

  _defaultColor() { return "#0cc"; }
  _defaultTitle() { return "Break Player"; }
  _fxTitle() { return "Break FX"; }

  // ---- Build controls ----

  _buildControls(controls, expanded, mkSlider, ctx, options) {
    this._basePath = options.basePath || "";

    const mkSelect = (labelText, appendTo) => {
      const wrap = document.createElement("div");
      wrap.className = "wac-ctrl";
      wrap.appendChild(Object.assign(document.createElement("label"), { textContent: labelText }));
      const sel = document.createElement("select");
      sel.className = "wac-select";
      wrap.appendChild(sel);
      appendTo.appendChild(wrap);
      return sel;
    };

    // ---- Loop section ----
    const { el: loopEl, controls: loopCtrl } = createSection("Loop");

    if (options.files?.length) {
      const fileWrap = document.createElement("div");
      fileWrap.className = "wac-ctrl wac-ctrl-wide";
      fileWrap.appendChild(Object.assign(document.createElement("label"), { textContent: "Sample" }));
      this._fileSelect = document.createElement("select");
      this._fileSelect.className = "wac-select";
      const noneOpt = document.createElement("option");
      noneOpt.value = "";
      noneOpt.textContent = "— None —";
      this._fileSelect.appendChild(noneOpt);
      for (const { label, file } of options.files) {
        const opt = document.createElement("option");
        opt.value = file;
        opt.textContent = label;
        this._fileSelect.appendChild(opt);
      }
      this._fileSelect.addEventListener("change", () => {
        this._loadFile();
        this._emitChange();
      });
      fileWrap.appendChild(this._fileSelect);
      loopCtrl.appendChild(fileWrap);
    }

    this._speedSelect = mkSelect("Speed", loopCtrl);
    for (const { label, value } of SPEED_MULTIPLIERS) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      if (value === this._instrument.speedMultiplier) opt.selected = true;
      this._speedSelect.appendChild(opt);
    }
    this._speedSelect.addEventListener("change", () => {
      this._instrument.speedMultiplier = parseFloat(this._speedSelect.value);
      this._emitChange();
    });

    this._subdivSelect = mkSelect("Jump Grid", loopCtrl);
    for (const v of [4, 8, 16]) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = `÷${v}`;
      if (v === this._instrument.subdivision) opt.selected = true;
      this._subdivSelect.appendChild(opt);
    }
    this._subdivSelect.addEventListener("change", () => {
      this._instrument.subdivision = parseInt(this._subdivSelect.value);
      this._emitChange();
    });

    this._returnSelect = mkSelect("Return", loopCtrl);
    for (const [v, lbl] of [[1, "1 step"], [2, "2 steps"], [4, "4 steps"], [8, "8 steps"], [16, "16 steps"]]) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = lbl;
      if (v === this._instrument.returnSteps) opt.selected = true;
      this._returnSelect.appendChild(opt);
    }
    this._returnSelect.addEventListener("change", () => {
      this._instrument.returnSteps = parseInt(this._returnSelect.value);
      this._emitChange();
    });

    controls.appendChild(loopEl);

    // ---- Mix section ----
    const { el: mixEl, controls: mixCtrl } = createSection("Mix");
    mixCtrl.appendChild(mkSlider({ param: "randomChance",  label: "Random",  min: 0, max: 1,    step: 0.01 }));
    mixCtrl.appendChild(mkSlider({ param: "reverseChance", label: "Reverse", min: 0, max: 0.25, step: 0.01 }));
    controls.appendChild(mixEl);

    // ---- Time-stretch controls (only when enabled) ----
    this._tsControls = null;
    if (this._instrument._useTimeStretch) {
      this._tsControls = document.createElement("web-audio-time-stretch-controls");
      expanded.appendChild(this._tsControls);
      this._tsControls.init(this._instrument, { color: options.color || this._defaultColor() });
    }

    // ---- Jam buttons ----
    const actionRow = document.createElement("div");
    actionRow.className = "wac-action-row";
    for (const [label, seg, key] of [
      ["K", 0, "K"],
      ["H", 1, "H"],
      ["S", 2, "S"],
    ]) {
      const btn = document.createElement("button");
      btn.textContent = `${label} [${key}]`;
      btn.className = "wac-action-btn";
      btn.addEventListener("mousedown", () => {
        this._pendingSegment = seg;
      });
      actionRow.appendChild(btn);
    }
    expanded.appendChild(actionRow);
  }

  // ---- Slider handling ----

  _onSliderInput(param, value) {
    this._instrument[param] = value;
    this._emitChange();
  }

  // ---- File loading ----

  _loadFile() {
    if (!this._instrument || !this._fileSelect) return;
    const file = this._fileSelect.value;
    if (file) this._instrument.load(this._basePath + file);
    else this._instrument.stop();
  }

  /** Programmatically select a break file by filename. */
  selectFile(filename) {
    if (this._fileSelect) {
      this._fileSelect.value = filename;
      this._loadFile();
    }
  }

  // ---- Sequencer integration ----

  /**
   * Called by the host on each sequencer tick.
   * @param {number} globalStep  Absolute step count
   * @param {number} bpm         Current tempo
   * @param {number} time        AudioContext scheduled time
   */
  step(globalStep, bpm, time) {
    if (!this._instrument?.loaded) return;
    this._globalStep = globalStep;
    if (this._pendingSegment >= 0) {
      this._instrument.jumpToSegment(this._pendingSegment, 3, bpm, time);
      this._pendingSegment = -1;
    } else {
      this._instrument.trigger(globalStep, bpm, time);
    }
  }

  /** Queue a segment jump for the next step (for keyboard shortcuts). */
  jumpToSegment(seg) {
    this._pendingSegment = seg;
  }

  setActiveStep() {
    /* no-op — break player has no step grid */
  }
  setScale() {
    /* no-op — break player doesn't use notes */
  }

  // ---- Serialization ----

  _extendJSON(obj) {
    obj.file = this._fileSelect?.value || "";
    obj.speedMultiplier = this._instrument.speedMultiplier;
    obj.subdivision = this._instrument.subdivision;
    obj.returnSteps = this._instrument.returnSteps;
    obj.ts = this._tsControls?.toJSON();
  }

  _restoreExtra(obj) {
    if (obj.speedMultiplier != null) {
      this._instrument.speedMultiplier = obj.speedMultiplier;
      if (this._speedSelect) this._speedSelect.value = obj.speedMultiplier;
    }
    if (obj.subdivision != null) {
      this._instrument.subdivision = obj.subdivision;
      if (this._subdivSelect) this._subdivSelect.value = obj.subdivision;
    }
    if (obj.returnSteps != null) {
      this._instrument.returnSteps = obj.returnSteps;
      if (this._returnSelect) this._returnSelect.value = obj.returnSteps;
    }
    if (obj.file && this._fileSelect) {
      this._fileSelect.value = obj.file;
      this._loadFile();
    }
    // Backwards-compat: old format stored pitchShift in params and stretchRatio at top level
    if (!obj.ts && (obj.params?.pitchShift != null || obj.stretchRatio != null)) {
      const compat = { pitchShift: obj.params?.pitchShift ?? 0, stretchRatio: obj.stretchRatio ?? 1 };
      this._tsControls?.fromJSON(compat);
    }
    if (obj.ts) this._tsControls?.fromJSON(obj.ts);
  }
}

customElements.define("web-audio-break-player-controls", WebAudioBreakPlayerControls);
