/**
 * WebAudioFxCompressor — per-channel sidechain ducking compressor effect.
 *
 * Wraps an AudioWorkletNode (sidechain-compressor-processor) with two inputs:
 *   input 0 — the channel signal to be ducked  (connect via `get input()`)
 *   input 1 — the sidechain key                 (set via `setSidechainSource()`)
 *
 * Until a sidechain source is selected the envelope stays at 0 and audio passes
 * through unchanged — the effect is effectively disabled. Pick a source (e.g. a
 * kick) and this channel ducks in time with it.
 *
 * The worklet module loads asynchronously. Until it is ready, audio routes
 * through a dry bypass gain so the FX chain works synchronously; once loaded,
 * the worklet is spliced in transparently.
 *
 * Standard effect interface: `get input()`, `connect(node)`.
 *
 * Usage:
 *   const comp = new WebAudioFxCompressor(ctx, { amount: 0.8 });
 *   prevStage.connect(comp.input);
 *   comp.connect(ctx.destination);
 *   comp.setSidechainSource(kickTapNode);
 *   comp.attack = 0.005; // seconds
 */

export default class WebAudioFxCompressor {
  /**
   * @param {AudioContext} ctx
   * @param {object} [options]
   * @param {number} [options.amount=0.7]      Max gain reduction (0..1)
   * @param {number} [options.attack=0.01]     Attack time in seconds
   * @param {number} [options.release=0.2]     Release time in seconds
   * @param {number} [options.threshold=0.1]   Key level (0..1) at which ducking begins
   */
  constructor(ctx, options = {}) {
    this.ctx = ctx;
    this._in = ctx.createGain();
    this._out = ctx.createGain();

    // Dry bypass until the worklet module finishes loading.
    this._bypass = ctx.createGain();
    this._in.connect(this._bypass);
    this._bypass.connect(this._out);

    this._node = null;
    this._sidechainTap = null;
    this._reduction = 0;
    this._onReduction = null;
    this._params = {
      amount: options.amount ?? 0.7,
      attack: options.attack ?? 0.01,
      release: options.release ?? 0.2,
      threshold: options.threshold ?? 0.1,
    };

    this._initPromise = this._init();
  }

  async _init() {
    const url = new URL("./fx-compressor.worklet.js", import.meta.url);
    await this.ctx.audioWorklet.addModule(url);

    this._node = new AudioWorkletNode(this.ctx, "sidechain-compressor-processor", {
      numberOfInputs: 2,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });

    // Apply any params set before the worklet was ready.
    for (const [name, value] of Object.entries(this._params)) {
      const p = this._node.parameters.get(name);
      if (p) p.value = value;
    }

    // Gain-reduction metering messages from the worklet.
    this._node.port.onmessage = (e) => {
      this._reduction = e.data?.reduction ?? 0;
      if (this._onReduction) this._onReduction(this._reduction);
    };

    // Splice the worklet in: in → node(input 0) → out, drop the dry bypass.
    this._in.connect(this._node, 0, 0);
    this._node.connect(this._out);
    this._in.disconnect(this._bypass);
    this._bypass.disconnect(this._out);

    // Wire any sidechain source chosen before the worklet was ready.
    if (this._sidechainTap) this._sidechainTap.connect(this._node, 0, 1);
  }

  /** Resolves when the AudioWorklet module is loaded. */
  get ready() {
    return this._initPromise;
  }

  get input() {
    return this._in;
  }

  connect(node) {
    this._out.connect(node.input ?? node);
    return this;
  }

  /** Select the sidechain key source (a tap GainNode). Pass null to disable. */
  setSidechainSource(tapNode) {
    if (this._sidechainTap && this._node) {
      try {
        this._sidechainTap.disconnect(this._node, 0, 1);
      } catch {
        // already disconnected
      }
    }
    this._sidechainTap = tapNode;
    if (tapNode && this._node) tapNode.connect(this._node, 0, 1);
  }

  _setParam(name, v) {
    this._params[name] = v;
    const p = this._node?.parameters.get(name);
    if (p) p.setValueAtTime(v, this.ctx.currentTime);
  }

  get amount() { return this._params.amount; }
  set amount(v) { this._setParam("amount", v); }

  get attack() { return this._params.attack; }
  set attack(v) { this._setParam("attack", v); }

  get release() { return this._params.release; }
  set release(v) { this._setParam("release", v); }

  get threshold() { return this._params.threshold; }
  set threshold(v) { this._setParam("threshold", v); }

  /** Current gain reduction (0..1), updated ~30ms from the worklet. */
  get reduction() { return this._reduction; }

  /** Callback invoked with the latest gain reduction (0..1) for live metering. */
  set onReduction(fn) { this._onReduction = fn; }

  reset() {}

  destroy() {
    this.setSidechainSource(null);
    this._onReduction = null;
    if (this._node) this._node.port.onmessage = null;
    this._node?.disconnect();
    this._in.disconnect();
    this._out.disconnect();
  }
}
