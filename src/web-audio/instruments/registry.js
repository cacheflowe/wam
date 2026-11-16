/**
 * Instrument registry — the library's catalog of playable instrument types
 * (architecture-refactor Phase 1). One entry per type the playground (and,
 * later, the headless song player and generative apps) can create.
 *
 *   id            stable type id stored in songs (`instruments[].id`)
 *   label, color  display name + UI/visual color (also sent with the performance stream)
 *   Instrument    instrument class
 *   controlsTag   companion Controls custom element
 *   options       constructor options (2nd arg) — omit for the class default
 *   fx            default FX settings for the controls' FX unit (bpm is added at bind)
 *   sequenced     true → driven by Controls.step() (pattern tracks); false → owns its timing
 *   samples       name of an app-provided sample set (sample-based types only)
 *
 * Importing this module registers every instrument's Controls element.
 */
import WebAudioPercKick from "./perc-kick.js";
import WebAudioPercHihat from "./perc-hihat.js";
import WebAudioPercSnare from "./perc-snare.js";
import WebAudioSynthAcid from "./synth-acid.js";
import WebAudioSynth808 from "./synth-808.js";
import WebAudioSynthFM from "./synth-fm.js";
import WebAudioSynthMono from "./synth-mono.js";
import WebAudioSynthPad from "./synth-pad.js";
import WebAudioSynthPoly from "./synth-poly.js";
import WebAudioSynthBlipFX from "./synth-blipfx.js";
import WebAudioLoopPlayer from "./sample-looper.js";
import WebAudioSamplePlayer from "./sample-player.js";
import WebAudioVocoderFx from "../fx/fx-vocoder.js";

const LOOP_OPTIONS = Object.freeze({
  speedMultiplier: 1,
  subdivision: 4,
  returnSteps: 1,
  randomChance: 0.1,
  reverseChance: 0.04,
  volume: 0.8,
  useTimeStretch: true,
});

/** @type {ReadonlyArray<object>} in palette order */
export const INSTRUMENTS = Object.freeze([
  { id: "kick", label: "Kick", color: "#f44", Instrument: WebAudioPercKick, controlsTag: "wam-perc-kick-controls", sequenced: true },
  { id: "hihat", label: "Hi-Hat", color: "#ff0", Instrument: WebAudioPercHihat, controlsTag: "wam-perc-hihat-controls", sequenced: true },
  { id: "snare", label: "Snare", color: "#f80", Instrument: WebAudioPercSnare, controlsTag: "wam-perc-snare-controls", sequenced: true },
  {
    id: "acid", label: "Acid", color: "#8f0", Instrument: WebAudioSynthAcid, controlsTag: "wam-synth-acid-controls", sequenced: true,
    fx: { reverbWet: 0.15, delayInterval: 0.75, delayFeedback: 0.35, delayMix: 0 },
  },
  {
    id: "bass808", label: "808 Bass", color: "#f04", Instrument: WebAudioSynth808, controlsTag: "wam-synth-808-controls", sequenced: true,
  },
  {
    id: "fm", label: "FM Synth", color: "#4df", Instrument: WebAudioSynthFM, controlsTag: "wam-synth-fm-controls", sequenced: true,
    fx: { reverbWet: 0.2, delayInterval: 0.5, delayFeedback: 0.4, delayMix: 0.1 },
  },
  { id: "mono", label: "Mono Synth", color: "#6df", Instrument: WebAudioSynthMono, controlsTag: "wam-synth-mono-controls", sequenced: true },
  {
    id: "pad", label: "Pad", color: "#a8f", Instrument: WebAudioSynthPad, controlsTag: "wam-synth-pad-controls", sequenced: true,
    fx: { reverbWet: 0.3, delayMix: 0.1 },
  },
  {
    id: "poly", label: "Poly Synth", color: "#7cf", Instrument: WebAudioSynthPoly, controlsTag: "wam-synth-poly-controls", sequenced: true,
    fx: { reverbWet: 0.15, delayMix: 0 },
  },
  {
    id: "blipfx", label: "BlipFX", color: "#fa8", Instrument: WebAudioSynthBlipFX, controlsTag: "wam-synth-blipfx-controls", sequenced: true,
    options: { volume: 0.5 },
  },
  {
    id: "loop-breaks", label: "Loop Player (Breaks)", color: "#8fa", Instrument: WebAudioLoopPlayer, controlsTag: "wam-sample-looper-controls",
    sequenced: false, options: LOOP_OPTIONS, samples: "breaks",
  },
  {
    id: "loop-perc", label: "Loop Player (Perc)", color: "#8df", Instrument: WebAudioLoopPlayer, controlsTag: "wam-sample-looper-controls",
    sequenced: false, options: LOOP_OPTIONS, samples: "percloops",
  },
  {
    id: "sampler-kicks", label: "Sampler (Kicks)", color: "#f8a", Instrument: WebAudioSamplePlayer, controlsTag: "wam-sample-player-controls",
    sequenced: true, samples: "kicks",
  },
  {
    id: "sampler-snares", label: "Sampler (Snares)", color: "#fa8", Instrument: WebAudioSamplePlayer, controlsTag: "wam-sample-player-controls",
    sequenced: true, samples: "snares",
  },
  {
    id: "sampler-hits", label: "Sampler (Hits)", color: "#8af", Instrument: WebAudioSamplePlayer, controlsTag: "wam-sample-player-controls",
    sequenced: true, samples: "hits",
  },
  {
    id: "vocoder", label: "Vocoder", color: "#4fd", Instrument: WebAudioVocoderFx, controlsTag: "wam-vocoder-fx-controls",
    sequenced: false, noFx: true,
  },
  {
    id: "loop-vocals", label: "Loop Player (Vocals)", color: "rgb(192, 157, 68)", Instrument: WebAudioLoopPlayer, controlsTag: "wam-sample-looper-controls",
    sequenced: false, options: LOOP_OPTIONS, samples: "vocals",
  },
]);

const byId = new Map(INSTRUMENTS.map((d) => [d.id, d]));

/** Registry entry for a type id, or null. */
export function instrumentDef(id) {
  return byId.get(id) ?? null;
}

/** Create the audio instrument for a type. */
export function createInstrument(idOrDef, ctx) {
  const def = typeof idOrDef === "string" ? instrumentDef(idOrDef) : idOrDef;
  if (!def) throw new Error(`[WAM] Unknown instrument type "${idOrDef}"`);
  // Spread so instruments can't mutate the shared frozen options.
  return def.options ? new def.Instrument(ctx, { ...def.options }) : new def.Instrument(ctx);
}

/**
 * Options for `controls.bind(instrument, ctx, options)`.
 * @param {object} def
 * @param {{ bpm?: number, files?: string[] }} [o]  files: the app's sample list for `def.samples`
 */
export function controlsOptions(def, { bpm, files } = {}) {
  const opts = { color: def.color };
  if (!def.noFx) opts.fx = { bpm, ...(def.fx ?? {}) };
  if (def.samples) {
    opts.files = files ?? [];
    opts.basePath = "";
  }
  return opts;
}
