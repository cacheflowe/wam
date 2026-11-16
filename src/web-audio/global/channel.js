/**
 * Channel — one mixer channel, audio only (no DOM).
 *
 *   instrument → input → [FxChain] → preFader ─→ fader → panner → out
 *                                        └─ bus taps (post-FX, pre-volume/mute)
 *
 * The fader's gain is DERIVED: volume × (muted ? 0 : 1) × (soloSuppressed ? 0 : 1).
 * Volume, mute and solo are independent state, so nothing has to remember a
 * "pre-mute volume" — changing the volume while muted, restoring a muted song,
 * or soloing/unsoloing can't lose the level.
 *
 * Controls render a Channel (strip knobs + mute/solo buttons); the headless
 * song player uses it directly (architecture-refactor Phase 1).
 */
export class Channel {
  /**
   * @param {AudioContext} ctx
   * @param {{ volume?: number, pan?: number, fx?: object|null }} [o]  fx: an FxChain (or anything with input/connect)
   */
  constructor(ctx, { volume = 1, pan = 0, fx = null } = {}) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.preFader = ctx.createGain();
    this.fader = ctx.createGain();
    this.panner = ctx.createStereoPanner();
    this.preFader.connect(this.fader);
    this.fader.connect(this.panner);
    this._volume = volume;
    this._muted = false;
    this._soloSuppressed = false;
    this.fx = null;
    this.setFx(fx);
    this.pan = pan;
    this._apply();
  }

  /** Insert (or remove, with null) the FX chain between input and preFader. */
  setFx(fx) {
    this.input.disconnect();
    if (this.fx) this.fx.disconnect?.();
    this.fx = fx;
    if (fx) {
      this.input.connect(fx.input);
      fx.connect(this.preFader);
    } else {
      this.input.connect(this.preFader);
    }
  }

  /** Feed a source (instrument) into the channel. */
  attach(source) {
    source.connect(this.input);
    return this;
  }

  /** Post-fader point (pre-pan) — where level meters / analysers tap. */
  get post() {
    return this.fader;
  }

  get volume() {
    return this._volume;
  }
  set volume(v) {
    this._volume = v;
    this._apply();
  }

  get muted() {
    return this._muted;
  }
  set muted(v) {
    this._muted = !!v;
    this._apply();
  }

  /** Set by the mixer when another channel is soloed. Independent of mute. */
  get soloSuppressed() {
    return this._soloSuppressed;
  }
  set soloSuppressed(v) {
    this._soloSuppressed = !!v;
    this._apply();
  }

  /** Is the channel actually audible right now? */
  get audible() {
    return !this._muted && !this._soloSuppressed && this._volume > 0;
  }

  get pan() {
    return this.panner.pan.value;
  }
  set pan(v) {
    this.panner.pan.value = v;
  }

  _apply() {
    this.fader.gain.value = this._muted || this._soloSuppressed ? 0 : this._volume;
  }

  connect(node) {
    this.panner.connect(node.input ?? node);
    return this;
  }

  disconnect() {
    this.panner.disconnect();
  }

  toJSON() {
    return { volume: this._volume, pan: this.pan, muted: this._muted };
  }

  fromJSON(o) {
    if (!o) return;
    if (o.volume != null) this.volume = o.volume;
    if (o.pan != null) this.pan = o.pan;
    if (o.muted != null) this.muted = o.muted;
  }
}

/**
 * Same derived-gain model over a single existing gain node (e.g. the master
 * bus). Implements the { volume, muted, soloSuppressed } "fader state" the
 * channel strip UI drives.
 * @param {() => GainNode|null} getGain  lazily resolved (the node may not exist yet)
 * @param {number} [volume]
 */
export function gainFaderState(getGain, volume = 1) {
  let muted = false;
  let soloSuppressed = false;
  const apply = () => {
    const g = getGain();
    if (g) g.gain.value = muted || soloSuppressed ? 0 : volume;
  };
  return {
    get volume() {
      return volume;
    },
    set volume(v) {
      volume = v;
      apply();
    },
    get muted() {
      return muted;
    },
    set muted(v) {
      muted = !!v;
      apply();
    },
    get soloSuppressed() {
      return soloSuppressed;
    },
    set soloSuppressed(v) {
      soloSuppressed = !!v;
      apply();
    },
  };
}

export default Channel;
