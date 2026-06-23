/**
 * SidechainCompressorProcessor — per-channel sidechain ducking compressor.
 *
 * This is an AudioWorkletProcessor that ducks the channel signal in response
 * to an external "key" (sidechain) input — the classic electronic-music pump
 * where a track's volume dips on every kick. Web Audio's native
 * DynamicsCompressorNode has no external key input, so the gain reduction is
 * computed here from an envelope follower with independent attack and release.
 *
 * Inputs:
 *   inputs[0] — audio to be ducked (the channel signal)
 *   inputs[1] — sidechain key (the selected source instrument's tap)
 * Output:
 *   outputs[0] — the ducked audio (stereo)
 *
 * Algorithm (per sample):
 *   1. key = max(|keyL|, |keyR|)                       (full-wave, mono-summed peak)
 *   2. env  = one-pole follow toward key, using the attack coefficient when
 *             rising and the release coefficient when falling.
 *   3. above = clamp((env - threshold) / (1 - threshold), 0, 1)
 *   4. gain = 1 - amount * above
 *   5. out = audio * gain
 *
 * With no key connected (no source selected) the envelope decays to 0, so the
 * gain stays at 1 and audio passes through untouched — the effect is "off"
 * until a source is chosen. The multiply adds zero latency.
 *
 * Used by: WebAudioFxCompressor (main-thread wrapper) → WebAudioFxUnit
 *
 * AudioParams (all k-rate):
 *   amount     — max gain reduction, 0 (none) .. 1 (full duck to silence)
 *   attack     — seconds for the duck to engage (0.001 .. 0.5)
 *   release    — seconds for volume to return (0.01 .. 1.5)
 *   threshold  — key level (0..1) at which ducking begins
 */

class SidechainCompressorProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "amount", defaultValue: 0.7, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "attack", defaultValue: 0.01, minValue: 0.001, maxValue: 0.5, automationRate: "k-rate" },
      { name: "release", defaultValue: 0.2, minValue: 0.01, maxValue: 1.5, automationRate: "k-rate" },
      { name: "threshold", defaultValue: 0.1, minValue: 0, maxValue: 1, automationRate: "k-rate" },
    ];
  }

  constructor() {
    super();
    this._env = 0;
    // Gain-reduction metering — post the peak reduction roughly every 30ms.
    this._grMax = 0;
    this._sincePost = 0;
    this._postInterval = Math.max(128, Math.floor(sampleRate * 0.03));
  }

  _postMeter(blockSize) {
    this._sincePost += blockSize;
    if (this._sincePost >= this._postInterval) {
      this.port.postMessage({ reduction: this._grMax });
      this._grMax = 0;
      this._sincePost = 0;
    }
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    if (!output || !output[0]) return true;
    const outL = output[0];
    const outR = output.length > 1 ? output[1] : null;
    const blockSize = outL.length;

    const audio = inputs[0];
    const aL = audio && audio[0] ? audio[0] : null;
    const aR = audio && audio.length > 1 ? audio[1] : null;

    // Nothing to process — emit silence and let the envelope decay.
    if (!aL) {
      outL.fill(0);
      if (outR) outR.fill(0);
      this._env *= 0.5;
      this._postMeter(blockSize);
      return true;
    }

    const key = inputs[1];
    const kL = key && key[0] ? key[0] : null;
    const kR = key && key.length > 1 ? key[1] : null;

    const amount = parameters.amount[0];
    const attack = parameters.attack[0];
    const release = parameters.release[0];
    const threshold = parameters.threshold[0];

    // One-pole coefficients: coef = exp(-1 / (timeSec * sampleRate))
    const attackCoef = Math.exp(-1 / (Math.max(attack, 1e-4) * sampleRate));
    const releaseCoef = Math.exp(-1 / (Math.max(release, 1e-4) * sampleRate));
    const thRange = 1 - threshold;

    let env = this._env;
    for (let i = 0; i < blockSize; i++) {
      // Sidechain key level — full-wave rectified, mono-summed peak
      let k = 0;
      if (kL) {
        k = kL[i] < 0 ? -kL[i] : kL[i];
        if (kR) {
          const kr = kR[i] < 0 ? -kR[i] : kR[i];
          if (kr > k) k = kr;
        }
      }

      // Envelope follower: snap up at attack speed, fall at release speed
      const coef = k > env ? attackCoef : releaseCoef;
      env = k + coef * (env - k);

      // Gain reduction above threshold
      let above = thRange > 0 ? (env - threshold) / thRange : env > threshold ? 1 : 0;
      if (above < 0) above = 0;
      else if (above > 1) above = 1;
      const reduction = amount * above;
      if (reduction > this._grMax) this._grMax = reduction;
      const g = 1 - reduction;

      outL[i] = aL[i] * g;
      if (outR) outR[i] = (aR ? aR[i] : aL[i]) * g;
    }
    this._env = env;
    this._postMeter(blockSize);

    return true;
  }
}

registerProcessor("sidechain-compressor-processor", SidechainCompressorProcessor);
