/**
 * SongPlayer — plays a playground song JSON with no UI (architecture-refactor
 * Phase 1). For client projects, generative apps and tests.
 *
 *   const player = new SongPlayer(ctx);
 *   const { tracks, skipped } = await player.load(songJson);
 *   player.play();   // … player.stop();
 *
 * Built from the same pieces the playground uses, so it sounds the same:
 *   registry instrument → Channel (FxChain → volume/mute/solo → pan) → master gain → master FxChain → destination
 *   → MasterLimiter (song's `transport.limiter`, default on)
 *   (master volume is applied BEFORE the master FX — same order as <wam-transport>)
 *   PatternTrack per instrument, all driven by one Clock (global/clock.js).
 *
 * v1 scope: step-sequenced synths and drum synths. Types that load audio files
 * or need live input through their UI (loop players, samplers, vocoder) are
 * reported in `skipped`. Sidechain ducking (compSourceId) isn't routed yet.
 */
import { Clock } from "./clock.js";
import { PatternTrack } from "./pattern-track.js";
import { Channel, gainFaderState } from "./channel.js";
import { FxChain } from "../fx/fx-chain.js";
import { MasterLimiter } from "../fx/fx-limiter.js";
import { instrumentDef, createInstrument } from "../instruments/registry.js";

/** Instrument types the headless player can't run yet (need files / live input via their UI). */
const UNSUPPORTED = (def) => !def.sequenced || !!def.samples || def.id === "vocoder";

export class SongPlayer {
  /**
   * @param {AudioContext} ctx
   * @param {{ destination?: AudioNode }} [o]
   */
  constructor(ctx, { destination = ctx.destination } = {}) {
    this.ctx = ctx;
    this.destination = destination;
    this.clock = new Clock(ctx, { bpm: 120 });
    this.clock.onTick((pos) => this._advance(pos));
    this.master = null;
    this.tracks = [];
  }

  /**
   * Load a song (the playground's `{ transport, instruments: [{ id, state }] }`).
   * Replaces anything loaded before.
   * @returns {{ tracks: object[], skipped: Array<{ id: string, reason: string }> }}
   */
  async load(song) {
    this.dispose();
    this.clock.rewind();
    const t = song.transport ?? {};
    const ctx = this.ctx;

    // Master bus, same order as <wam-transport>: gain (volume/mute) → master FX → out.
    this.masterGain = ctx.createGain();
    this.masterFx = new FxChain(ctx, { bpm: t.bpm ?? 120 });
    this.masterFx.fromJSON(t.fx);
    this.masterGain.connect(this.masterFx.input);
    this.limiter = new MasterLimiter(ctx, { enabled: t.limiter ?? true });
    this.masterFx.connect(this.limiter.input);
    this.limiter.connect(this.destination);
    /** { volume, muted } for the master (derived gain, see channel.js) */
    this.master = gainFaderState(() => this.masterGain, t.masterVolume ?? 1);
    this.master.muted = !!t.muted;
    this.bpm = t.bpm ?? 120;

    const skipped = [];
    for (const inst of song.instruments ?? []) {
      const def = instrumentDef(inst.id);
      if (!def) {
        skipped.push({ id: inst.id, reason: "unknown instrument type" });
        continue;
      }
      if (UNSUPPORTED(def)) {
        skipped.push({ id: inst.id, reason: "needs its UI (audio files / live input) — not supported headless yet" });
        continue;
      }
      try {
        this.tracks.push(this._buildTrack(def, inst.state ?? {}, t));
      } catch (err) {
        skipped.push({ id: inst.id, reason: String(err?.message ?? err) });
      }
    }

    // Solo: any soloed track silences the others.
    const anySolo = this.tracks.some((tr) => tr.soloed);
    for (const tr of this.tracks) tr.channel.soloSuppressed = anySolo && !tr.soloed;

    return { tracks: this.tracks, skipped };
  }

  _buildTrack(def, state, transport) {
    const ctx = this.ctx;
    const instrument = createInstrument(def, ctx);

    // Sound params (instrument properties); `volume` is the channel fader.
    for (const [key, value] of Object.entries(state.params ?? {})) {
      if (key === "volume" || value == null) continue;
      if (key in instrument) instrument[key] = value;
    }
    instrument._rebake?.();
    instrument.setScale(transport.root ?? null, transport.scale ?? null);
    if (state.chordSize != null) instrument.chordSize = state.chordSize;
    if (state.melodicMode != null && "melodicMode" in instrument) instrument.melodicMode = state.melodicMode;
    instrument.bpm = transport.bpm ?? 120;

    const fx = def.noFx ? null : new FxChain(ctx, { bpm: transport.bpm ?? 120, ...(def.fx ?? {}) });
    fx?.fromJSON(state.fx);
    const channel = new Channel(ctx, { volume: state.params?.volume ?? 1, pan: state.pan ?? 0, fx });
    channel.muted = !!state.muted;
    channel.attach(instrument);
    channel.connect(this.masterGain);

    const patterns = state.patterns ?? (state.steps ? { A: { steps: state.steps } } : { A: { steps: [] } });
    const track = new PatternTrack({
      patterns,
      chain: Array.isArray(state.chain) && state.chain.length ? [...state.chain] : [0],
      params: state.patternParams ?? {},
      speed: state.speedMultiplier ?? 1,
    });
    return { id: def.id, def, instrument, channel, fx, track, soloed: !!state.soloed };
  }

  get bpm() {
    return this.clock.bpm;
  }

  set bpm(v) {
    this.clock.bpm = v;
    for (const tr of this.tracks) {
      tr.instrument.bpm = v;
      if (tr.fx) tr.fx.bpm = v;
    }
    if (this.masterFx) this.masterFx.bpm = v;
  }

  get playing() {
    return this.clock.running;
  }

  /** Start from the top of every chain. */
  play() {
    if (this.ctx.state === "suspended") this.ctx.resume();
    for (const tr of this.tracks) tr.track.reset();
    this.clock.start(); // tick 0
  }

  stop() {
    this.clock.stop();
  }

  /**
   * Emit the next clock tick at `time` (offline rendering / tests). In
   * real time, play() lets the clock drive this. `step` is ignored — the
   * clock derives it from the tick count.
   */
  tick(_step, time) {
    return this.clock.advance(time);
  }

  /** Back to the top without starting (before an offline render). */
  rewind() {
    this.clock.rewind();
    for (const tr of this.tracks) tr.track.reset();
  }

  /** Advance every track to this clock position and trigger what fires. */
  _advance({ tick, step, time, dur }) {
    for (const tr of this.tracks) {
      tr.instrument.onTick(step);
      const r = tr.track.tick(tick, time, dur);
      for (const slot of r.slots) {
        if (slot.fires) tr.instrument.triggerSequenceStep(slot.index, slot.step, slot.time, slot.dur);
      }
    }
  }

  /** Stop and disconnect everything. */
  dispose() {
    this.stop();
    for (const tr of this.tracks) {
      tr.channel.disconnect();
      tr.fx?.destroy();
    }
    this.masterGain?.disconnect();
    this.masterFx?.disconnect();
    this.masterFx?.destroy();
    this.limiter?.disconnect();
    this.tracks = [];
    this.master = this.masterGain = this.masterFx = null;
  }
}

export default SongPlayer;
