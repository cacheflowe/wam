/**
 * Step trig conditions — "gate by bar cycle".
 *
 * A step with condition `X:Y` only fires on pass X of every Y loops of the
 * pattern (1-indexed X). For example `2:4` fires only on the 2nd bar of each
 * 4-bar cycle. `off` always fires. This is the Elektron-style conditional trig.
 *
 * Single source of truth for both the sequencer UI (the per-step dropdown) and
 * the playback evaluator used by every instrument's `step()` loop.
 */

/** Grouped option metadata for the per-step dropdown (built into <optgroup>s). */
export const CONDITION_GROUPS = [
  { label: null, options: ["off"] },
  { label: "Every 2 bars", options: ["1:2", "2:2"] },
  { label: "Every 3 bars", options: ["1:3", "2:3", "3:3"] },
  { label: "Every 4 bars", options: ["1:4", "2:4", "3:4", "4:4"] },
  { label: "Every 8 bars", options: ["1:8", "2:8", "3:8", "4:8", "5:8", "6:8", "7:8", "8:8"] },
];

/** Display text for a condition value. */
export function conditionLabel(value) {
  return value === "off" ? "—" : value;
}

/**
 * Normalize a stored condition value. Upgrades the legacy `"fill"` alias
 * (last of every 4 bars) to its explicit `"4:4"` form.
 * @param {string|undefined} value
 * @returns {string}
 */
export function normalizeCondition(value) {
  if (value === "fill") return "4:4";
  return value ?? "off";
}

/**
 * Whether a step with the given condition fires on the given (global) bar index.
 *
 * `X:Y` → fires when `barIndex mod Y === X-1`. `off`/empty always fires.
 * The legacy `"fill"` value is treated as `4:4`.
 *
 * @param {string} condition
 * @param {number} barIndex  Global bar count since transport start (0-based).
 * @returns {boolean}
 */
export function meetsBarCondition(condition, barIndex) {
  if (!condition || condition === "off") return true;
  if (condition === "fill") return barIndex % 4 === 3; // legacy alias for 4:4
  const m = /^(\d+):(\d+)$/.exec(condition);
  if (!m) return true;
  const x = parseInt(m[1], 10);
  const y = parseInt(m[2], 10);
  if (y <= 0) return true;
  return barIndex % y === (x - 1) % y;
}
