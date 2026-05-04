/**
 * Shared sample-loading utilities for sample-based instruments.
 *
 * Usage:
 *   import {
 *     loadSample,
 *     buildReverseBuffer,
 *     tryGlobKeys,
 *     globSamples,
 *     buildFallbackSamples,
 *     resolveSamples,
 *   } from "../global/sample-utils.js";
 *   const buffer = await loadSample(ctx, "/audio/samples/kicks/kick-808.wav");
 *   const reversed = buildReverseBuffer(ctx, buffer);
 */

const AUDIO_EXT_RE = /\.(wav|mp3|ogg|flac)$/i;

/**
 * Build a human-friendly label from an audio filename.
 * @param {string} file
 * @returns {string}
 */
export function sampleLabelFromFile(file) {
  return file.replace(AUDIO_EXT_RE, "").replace(/[-_]/g, " ");
}

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

/**
 * Convert globbed paths into [{ label, file }] entries for control dropdowns.
 * @param {string[]} paths
 * @param {string} servedAt
 * @returns {{label: string, file: string}[]}
 */
export function globSamples(paths, servedAt) {
  return paths
    .map((path) => path.split("/").pop())
    .filter(Boolean)
    .map((file) => ({
      label: sampleLabelFromFile(file),
      file: servedAt + file,
    }));
}

/**
 * Build committed fallback sample entries for non-glob environments.
 * @param {string} dir
 * @param {string[]} files
 * @returns {{label: string, file: string}[]}
 */
export function buildFallbackSamples(dir, files) {
  return files.map((file) => ({
    label: sampleLabelFromFile(file),
    file: `${dir}${file}`,
  }));
}

/**
 * Safe wrapper for import.meta.glob lookups (returns [] outside compatible envs).
 * @param {() => Record<string, unknown>} fn
 * @returns {string[]}
 */
export function tryGlobKeys(fn) {
  try {
    return Object.keys(fn());
  } catch (e) {
    return [];
  }
}

/**
 * Use glob result if non-empty, otherwise use the committed fallback list.
 * Supports either positional args or a config object:
 *   resolveSamples(globPaths, servedAt, fallback)
 *   resolveSamples({ glob, servedAt, fallbackDir, fallbackFiles })
 * @param {string[] | {glob: string[], servedAt: string, fallbackDir: string, fallbackFiles: string[]}} globPathsOrConfig
 * @param {string} [servedAt]
 * @param {{label: string, file: string}[]} [fallback]
 * @returns {{label: string, file: string}[]}
 */
export function resolveSamples(globPathsOrConfig, servedAt, fallback) {
  if (typeof globPathsOrConfig === "object" && globPathsOrConfig !== null && !Array.isArray(globPathsOrConfig)) {
    const config = globPathsOrConfig;
    const resolvedFallback = buildFallbackSamples(config.fallbackDir, config.fallbackFiles);
    return config.glob.length > 0 ? globSamples(config.glob, config.servedAt) : resolvedFallback;
  }

  const globPaths = globPathsOrConfig;
  return globPaths.length > 0 ? globSamples(globPaths, servedAt) : fallback;
}
