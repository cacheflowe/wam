/**
 * Shared sample-loading utilities for sample-based instruments.
 *
 * Usage:
 *   import { loadSample, buildReverseBuffer } from "../global/wam-sample-utils.js";
 *   const buffer = await loadSample(ctx, "/audio/samples/kicks/kick-808.wav");
 *   const reversed = buildReverseBuffer(ctx, buffer);
 */

/**
 * Fetch and decode a WAV/audio file into an AudioBuffer.
 * @param {AudioContext} ctx
 * @param {string} url
 * @returns {Promise<AudioBuffer>}
 */
export async function loadSample(ctx, url) {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  return ctx.decodeAudioData(arrayBuffer);
}

/**
 * Create a reversed copy of an AudioBuffer.
 * @param {AudioContext} ctx
 * @param {AudioBuffer} buffer
 * @returns {AudioBuffer}
 */
export function buildReverseBuffer(ctx, buffer) {
  const numChannels = buffer.numberOfChannels;
  const length = buffer.length;
  const reversed = ctx.createBuffer(numChannels, length, buffer.sampleRate);
  for (let ch = 0; ch < numChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = reversed.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      dst[i] = src[length - 1 - i];
    }
  }
  return reversed;
}
