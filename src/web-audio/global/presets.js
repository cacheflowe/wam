/**
 * Preset data helpers. Presets live in JSON files under src/web-audio/presets/
 * (one per instrument) and are imported by each instrument module, so
 * "import one file, get presets" still holds:
 *
 *   import presetData from "../presets/synth-acid.json" with { type: "json" };
 *   static PRESET_DATA = presetData;
 *   static PRESETS = presetMap(presetData);   // { name: params } — legacy shape
 *
 * File shape:
 *   { "instrument": "synth-acid",
 *     "presets": [ { "name": "Squelch", "tags": ["bass"], "params": { … } } ] }
 *
 * In dev, the Vite plugin in vite-plugins/wam-preset-store.js writes new or
 * deleted presets straight back to these files (see savePresetToRepo).
 */

/** Roles/groups that describe the *part*, not the sound. Presets don't reset them. */
const PART_ROLES = new Set(["octave", "octaveJump", "gate", "voices"]);

/** Is this param part-level (octave, gate, voice limit…) rather than timbre? */
export function isPartParam(def) {
  return def.group === "seq" || PART_ROLES.has(def.role);
}

/** The schema params a complete preset must define (sound params only). */
export function presetParamDefs(params) {
  return params.filter((d) => !isPartParam(d));
}

/** `{ name: params }` map from a preset data file (the legacy PRESETS shape). */
export function presetMap(data) {
  const map = {};
  for (const p of data?.presets ?? []) map[p.name] = p.params;
  return map;
}

/** Tags for a named preset (empty array if none). */
export function presetTags(data, name) {
  return data?.presets?.find((p) => p.name === name)?.tags ?? [];
}

/**
 * Insert or replace a preset in a data object (in memory) and keep the
 * legacy PRESETS map in sync. Returns the stored entry.
 */
export function upsertPreset(Cls, { name, tags = [], params }) {
  const data = Cls.PRESET_DATA;
  const entry = { name, tags, params };
  const i = data.presets.findIndex((p) => p.name === name);
  if (i >= 0) data.presets[i] = entry;
  else data.presets.push(entry);
  Cls.PRESETS[name] = params;
  return entry;
}

/** Remove a preset from a data object (in memory) and the PRESETS map. */
export function removePreset(Cls, name) {
  const data = Cls.PRESET_DATA;
  data.presets = data.presets.filter((p) => p.name !== name);
  delete Cls.PRESETS[name];
}

/** True when running under the Vite dev server (preset files are writable). */
export function canWritePresets() {
  try {
    return !!import.meta.env?.DEV;
  } catch {
    return false;
  }
}

const ENDPOINT = "/__wam/presets";

/** Dev only: write a preset into the instrument's JSON file in the repo. */
export async function savePresetToRepo(instrumentId, entry) {
  const res = await fetch(`${ENDPOINT}/${encodeURIComponent(instrumentId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  });
  if (!res.ok) throw new Error(`[WAM] preset save failed: ${res.status} ${await res.text()}`);
}

/** Dev only: delete a preset from the instrument's JSON file in the repo. */
export async function deletePresetFromRepo(instrumentId, name) {
  const res = await fetch(`${ENDPOINT}/${encodeURIComponent(instrumentId)}/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`[WAM] preset delete failed: ${res.status} ${await res.text()}`);
}
