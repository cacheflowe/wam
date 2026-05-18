/**
 * WamAnalysisBus — aggregates audio analysis data from master + per-instrument
 * analysers and trigger events into a single snapshot for visualization.
 *
 * Usage:
 *   const bus = new WamAnalysisBus();
 *   bus.setMaster(masterAnalyser);
 *   bus.addInstrument("kick", ctrl);
 *   // Each frame:
 *   const data = bus.snapshot();
 */
export default class WamAnalysisBus {
  constructor() {
    this._masterAnalyser = null;
    this._masterFft = null;
    this._masterWaveform = null;
    this._masterTimeBuf = null;
    this._instruments = new Map(); // name → { analyser, fft, waveform, timeBuf, meterAnalyser, meterBuf, snap }
    this._triggers = []; // rolling buffer of recent triggers
    this._maxTriggers = 64;
    this._step = 0;
    this._bar = 0;
    this._bpm = 120;
    this._stepTime = 0; // audioContext.currentTime when step last fired
    this._stepDuration = 0.125; // seconds per step
    this._ctx = null; // AudioContext reference for output latency

    // Pre-allocated snapshot — mutated in place each frame
    this._snapshot = {
      master: { fft: null, waveform: null, rms: 0 },
      instruments: {},
      beat: { step: 0, bar: 0, phase: 0, bpm: 120, stepDuration: 0 },
      triggers: this._triggers,
    };
  }

  /** Set the AudioContext (needed for output latency compensation). */
  setContext(ctx) {
    this._ctx = ctx;
  }

  /** Set the master output analyser (from transport). */
  setMaster(analyser) {
    this._masterAnalyser = analyser;
    if (analyser) {
      analyser.fftSize = 2048;
      this._masterFft = new Uint8Array(analyser.frequencyBinCount);
      this._masterWaveform = new Uint8Array(analyser.fftSize);
      this._masterTimeBuf = new Float32Array(analyser.fftSize);
      this._snapshot.master.fft = this._masterFft;
      this._snapshot.master.waveform = this._masterWaveform;
    }
  }

  /** Register an instrument's controls for per-instrument analysis. */
  addInstrument(name, ctrl) {
    // Access the analyser nodes created in _setupRouting
    const analyser = ctrl._analyser;
    const meterAnalyser = ctrl._meterAnalyser;
    if (!analyser) return;
    analyser.fftSize = 2048;
    const entry = {
      ctrl,
      analyser,
      fft: new Uint8Array(analyser.frequencyBinCount),
      waveform: new Uint8Array(analyser.fftSize),
      meterAnalyser,
      meterBuf: meterAnalyser ? new Float32Array(meterAnalyser.fftSize) : null,
      lastTrigger: null, // { velocity, age }
      // Pre-allocated per-instrument snapshot object
      snap: { fft: null, waveform: null, rms: 0, trigger: null, steps: null, color: null },
    };
    entry.snap.fft = entry.fft;
    entry.snap.waveform = entry.waveform;
    // Color is static per instrument
    entry.snap.color = ctrl.style.getPropertyValue("--slider-accent") || null;
    this._instruments.set(name, entry);
    this._snapshot.instruments[name] = entry.snap;
  }

  /** Remove an instrument from tracking. */
  removeInstrument(name) {
    this._instruments.delete(name);
    delete this._snapshot.instruments[name];
  }

  /** Record a trigger event (called from instrument step/jam). */
  trigger(instrument, velocity = 1, step = this._step) {
    // Use the scheduled audio time so visuals sync with perceived sound
    const scheduledTime = this._stepTime || 0;
    // Reuse oldest slot if at capacity, otherwise push
    if (this._triggers.length >= this._maxTriggers) {
      const recycled = this._triggers.pop();
      recycled.instrument = instrument;
      recycled.velocity = velocity;
      recycled.step = step;
      recycled.age = -1; // not yet arrived
      recycled.scheduledTime = scheduledTime;
      this._triggers.unshift(recycled);
    } else {
      this._triggers.unshift({ instrument, velocity, step, age: -1, scheduledTime });
    }
    // Update per-instrument last trigger
    const entry = this._instruments.get(instrument);
    if (entry) {
      if (!entry.lastTrigger) entry.lastTrigger = { velocity: 0, age: -1, scheduledTime: 0 };
      entry.lastTrigger.velocity = velocity;
      entry.lastTrigger.age = -1;
      entry.lastTrigger.scheduledTime = scheduledTime;
    }
  }

  /** Update beat position (called from sequencer onStep). */
  setBeat(step, bar, bpm, stepDuration, audioTime) {
    this._step = step;
    this._bar = bar;
    this._bpm = bpm;
    this._stepDuration = stepDuration;
    this._stepTime = audioTime;
  }

  /**
   * Read all analysers and update the retained snapshot for the current frame.
   * Call once per draw() in p5.
   * @param {number} now — AudioContext.currentTime (for beat phase calculation)
   * @returns {object} The same snapshot reference each frame (mutated in place).
   */
  snapshot(now) {
    // Account for speaker output latency so visuals sync with perceived sound
    const latency = this._ctx?.outputLatency ?? 0;

    // Age triggers only once their scheduled audio time + output latency has arrived
    for (const t of this._triggers) {
      if (t.age >= 0) {
        t.age++;
      } else if (now >= t.scheduledTime + latency) {
        t.age = 1; // just arrived this frame
      }
    }
    for (const [, entry] of this._instruments) {
      if (entry.lastTrigger) {
        if (entry.lastTrigger.age >= 0) {
          entry.lastTrigger.age++;
        } else if (now >= entry.lastTrigger.scheduledTime + latency) {
          entry.lastTrigger.age = 1;
        }
      }
    }

    // Master
    if (this._masterAnalyser) {
      this._masterAnalyser.getByteFrequencyData(this._masterFft);
      this._masterAnalyser.getByteTimeDomainData(this._masterWaveform);
      this._masterAnalyser.getFloatTimeDomainData(this._masterTimeBuf);
      let sum = 0;
      for (let i = 0; i < this._masterTimeBuf.length; i++) sum += this._masterTimeBuf[i] ** 2;
      this._snapshot.master.rms = Math.min(1, Math.sqrt(sum / this._masterTimeBuf.length) * 3.5);
    }

    // Per-instrument
    for (const [, entry] of this._instruments) {
      entry.analyser.getByteFrequencyData(entry.fft);
      entry.analyser.getByteTimeDomainData(entry.waveform);
      let rms = 0;
      if (entry.meterAnalyser && entry.meterBuf) {
        entry.meterAnalyser.getFloatTimeDomainData(entry.meterBuf);
        let sum = 0;
        for (let i = 0; i < entry.meterBuf.length; i++) sum += entry.meterBuf[i] ** 2;
        rms = Math.min(1, Math.sqrt(sum / entry.meterBuf.length) * 3.5);
      }
      entry.snap.rms = rms;
      entry.snap.trigger = entry.lastTrigger;
      // Read steps live — the _seq element may be created after bind()
      entry.snap.steps = entry.ctrl._seq?._steps ?? null;
      entry.snap.muted = entry.ctrl._muteHandle?.isMuted() ?? false;
    }

    // Beat phase (0–1 progress through current step)
    // Compensate: sound arrives at _stepTime + outputLatency
    const arrivedAt = this._stepTime + latency;
    const elapsed = (now || 0) - arrivedAt;
    const beat = this._snapshot.beat;
    if (elapsed < 0) {
      // The current step hasn't been heard yet — show previous step
      beat.step = (this._step - 1 + 16) % 16;
      beat.bar = this._bar;
      beat.phase = this._stepDuration > 0 ? Math.min(1, Math.max(0, 1 + elapsed / this._stepDuration)) : 1;
    } else {
      beat.step = this._step;
      beat.bar = this._bar;
      beat.phase = this._stepDuration > 0 ? Math.min(1, Math.max(0, elapsed / this._stepDuration)) : 0;
    }
    beat.bpm = this._bpm;
    beat.stepDuration = this._stepDuration;

    return this._snapshot;
  }
}
