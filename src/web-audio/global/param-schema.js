/**
 * Param schema — the engine-level description of an instrument's parameters.
 *
 * Each instrument class declares `static PARAMS`: one entry per parameter, used
 * by the UI (sliders/selects), serialization, randomize/mutate, preset
 * validation, and hardware auto-mapping. Declaring params on the instrument
 * (not the Controls class) keeps "instruments first, UI second": everything
 * here works headless.
 *
 * Entry shape:
 *   {
 *     param: "cutoff",              // instrument property name
 *     label: "Cutoff",
 *     type: "number" | "enum" | "bool",   // default "number"
 *     min, max, step, scale: "log",       // number params
 *     options: [...],                     // enum params (values)
 *     group: "filter",                    // see GROUPS — UI section + lock unit
 *     role: "cutoff",                     // see ROLES — drives hardware layout
 *     priority: 1,                        // lower = more important (1–3)
 *     rand: { min, max } | { weights } | false,  // curated randomize range
 *     tooltip: "…",
 *   }
 */

/** Param groups: UI sections and the unit for randomize locks. */
export const GROUPS = Object.freeze([
  "osc", // waveform, unison, detune, noise
  "filter", // cutoff, resonance, env amount, filter LFO
  "amp-env", // amplitude ADSR + gate
  "filter-env", // filter ADSR
  "mod", // LFOs
  "pitch", // octave, glide, pitch envelopes
  "character", // drive, distortion, bitcrush
  "body", // percussion body/tone params
  "fx",
  "seq", // sequencing behavior (gate, octave jumps)
]);

/**
 * Shared role vocabulary. A role says what a param *does musically*, so the
 * same physical knob can do the same kind of thing on every instrument.
 */
export const ROLES = Object.freeze([
  // tone
  "cutoff", "resonance", "envAmt", "drive", "wave", "tone", "noise", "filterType", "keytrack",
  // envelopes
  "attack", "decay", "sustain", "release", "gate",
  "filterAttack", "filterDecay", "filterSustain", "filterRelease",
  // movement / pitch
  "detune", "unison", "lfoRate", "lfoDepth", "lfoShape", "lfoTarget", "lfoLow", "lfoHigh", "lfoPhase", "lfoOn",
  "glide", "octave", "octaveJump", "pitch", "pitchDecay", "pitchAmt",
  // fm / misc
  "ratio", "index", "feedback", "click", "snap", "body", "level", "voices",
]);

const ROLE_SET = new Set(ROLES);
const GROUP_SET = new Set(GROUPS);

/** Standard channel-strip volume def kept at the front of SLIDER_DEFS for compat. */
export const VOLUME_DEF = Object.freeze({ param: "volume", label: "Vol", min: 0, max: 1, step: 0.01 });

export const isNumeric = (def) => (def.type ?? "number") === "number";

/**
 * Derive a Controls class's legacy SLIDER_DEFS from an instrument's PARAMS:
 * the volume def followed by every numeric param.
 */
export function sliderDefs(params) {
  return [VOLUME_DEF, ...params.filter(isNumeric)];
}

/** Look up one param def by name. */
export function findParam(params, name) {
  return params.find((d) => d.param === name);
}

/** Map a value into 0..1 along the param's scale (log-aware). */
export function toNormalized(def, value) {
  const { min, max } = def;
  if (max === min) return 0;
  const v = Math.min(max, Math.max(min, value));
  if (def.scale === "log" && min > 0) return Math.log(v / min) / Math.log(max / min);
  return (v - min) / (max - min);
}

/** Map 0..1 back to a value along the param's scale, quantized to `step`. */
export function fromNormalized(def, n) {
  const { min, max } = def;
  const t = Math.min(1, Math.max(0, n));
  const raw = def.scale === "log" && min > 0 ? min * Math.pow(max / min, t) : min + (max - min) * t;
  return quantize(def, raw);
}

/** Snap a value to the param's step and clamp to its range. */
export function quantize(def, value) {
  const step = Number(def.step) || 0;
  let v = step > 0 ? Math.round(value / step) * step : value;
  // Kill float noise from step multiplication (e.g. 0.30000000000000004).
  if (step > 0) {
    const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1);
    v = Number(v.toFixed(decimals));
  }
  return Math.min(def.max, Math.max(def.min, v));
}

/**
 * The range randomize/mutate may use for a numeric param:
 * `rand.min/max` when curated, else the full param range; null when excluded.
 */
export function randRange(def) {
  if (def.rand === false) return null;
  return { min: def.rand?.min ?? def.min, max: def.rand?.max ?? def.max };
}

/**
 * Validate a PARAMS array. Returns a list of human-readable problems (empty if
 * valid). Used by tests; cheap enough to run in dev.
 */
export function validateParams(params, name = "PARAMS") {
  const problems = [];
  const seen = new Set();
  for (const def of params) {
    const where = `${name}.${def.param}`;
    if (!def.param) problems.push(`${name}: entry without a param name`);
    if (seen.has(def.param)) problems.push(`${where}: duplicate`);
    seen.add(def.param);
    if (def.group && !GROUP_SET.has(def.group)) problems.push(`${where}: unknown group "${def.group}"`);
    if (def.role && !ROLE_SET.has(def.role)) problems.push(`${where}: unknown role "${def.role}"`);
    const type = def.type ?? "number";
    if (type === "number") {
      if (!(def.min < def.max)) problems.push(`${where}: min must be < max`);
      if (def.scale === "log" && !(def.min > 0)) problems.push(`${where}: log scale needs min > 0`);
      const r = def.min < def.max ? randRange(def) : null;
      if (r && (r.min < def.min || r.max > def.max || r.min > r.max)) {
        problems.push(`${where}: rand range [${r.min}, ${r.max}] outside [${def.min}, ${def.max}]`);
      }
    } else if (type === "enum") {
      if (!Array.isArray(def.options) || def.options.length === 0) problems.push(`${where}: enum needs options`);
      if (def.rand?.weights && def.rand.weights.length !== def.options?.length) {
        problems.push(`${where}: rand.weights length must match options`);
      }
    } else if (type !== "bool") {
      problems.push(`${where}: unknown type "${type}"`);
    }
  }
  return problems;
}
