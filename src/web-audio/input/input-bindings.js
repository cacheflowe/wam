/**
 * Source-agnostic input layer — the contract every controller adapter speaks.
 *
 * Components (instrument controls, transport, sequencer) never see raw device
 * data. Instead, each device adapter (MIDI, keyboard, gamepad, OSC, …) connects
 * to its hardware and emits a normalized `wam-control-input` event:
 *
 *   detail = {
 *     binding,   // { source, ...identity }  — opaque except via the registry
 *     value,     // 0..1 normalized          — for "absolute" controls
 *     kind,      // "absolute" (knob/fader/axis) | "trigger" (button/note/key)
 *     pressed,   // boolean                   — for "trigger" kind
 *     raw,       // optional source-specific payload (debug / device feedback)
 *   }
 *
 * `binding` is tagged with a `source` string. Equality and display are
 * polymorphic: each adapter registers `{ equals, format }` for its source, so
 * the learn system can compare and label bindings without knowing the device.
 * Adding a new controller means writing an adapter + one registerBindingType()
 * call — no component changes.
 *
 * `wam-control-input` is dispatched for parameter changes and interactions.
 * `wam-command` is dispatched for high-level actions (play, next instrument).
 */
export const CONTROL_INPUT_EVENT = "wam-control-input";
export const BINDING_FEEDBACK_EVENT = "wam-binding-feedback";

/**
 * Dispatch a normalized control-input event.
 * Adapters call this; consumers listen for CONTROL_INPUT_EVENT.
 * `target` defaults to document so the event is global, matching how `wam-midi-message` is broadcast today.
 */
export function dispatchControlInput(detail, target = document) {
  target.dispatchEvent(new CustomEvent(CONTROL_INPUT_EVENT, { detail }));
}

/** Command events are dispatched via `wam-command`. */
export const COMMAND_EVENT = "wam-command";

/** Dispatch a command event. */
export function dispatchCommand(command, extra = {}, target = document) {
  target.dispatchEvent(new CustomEvent(COMMAND_EVENT, {
    detail: { command, ...extra }
  }));
}

/**
 * Dispatch binding feedback. detail = { kind, binding, value? }
 */
export function dispatchBindingFeedback(detail, target = document) {
  target.dispatchEvent(new CustomEvent(BINDING_FEEDBACK_EVENT, { detail }));
}

/** registry for equality + formatting */
const registry = new Map();

/**
 * Register equality + formatting for a binding source.
 */
export function registerBindingType(source, { equals, format } = {}) {
  registry.set(source, {
    equals: typeof equals === "function" ? equals : () => false,
    format: typeof format === "function" ? format : () => "",
  });
}

export function bindingsEqual(a, b) {
  if (!a || !b || a.source !== b.source) return false;
  return registry.get(a.source)?.equals(a, b) ?? false;
}

export function formatBinding(binding) {
  if (!binding) return "";
  return registry.get(binding.source)?.format(binding) ?? "";
}

export function hasBindingType(source) {
  return registry.has(source);
}

export function migrateLegacyBinding(binding) {
  if (!binding || typeof binding !== "object") return binding;
  return binding.source ? binding : { source: "midi", ...binding };
}

/**
 * Produce a stable string key for a binding so equivalent bindings collapse to
 * one map entry regardless of property order. Source-agnostic: it serializes
 * whatever discriminating fields the binding carries (e.g. midi's
 * source/type/channel/note|controller) with sorted keys.
 */
function canonicalizeBinding(binding) {
  if (!binding || typeof binding !== "object") return String(binding);
  return JSON.stringify(
    Object.keys(binding)
      .sort()
      .reduce((acc, k) => {
        if (binding[k] !== undefined) acc[k] = binding[k];
        return acc;
      }, {}),
  );
}

/** Command bindings: maps a binding to an app-level command name. */
const commandBindings = new Map();

/**
 * Register a mapping between a binding and a command name.
 * @param {object} binding - The binding (e.g. { source: "midi", type: "note", channel: 1, note: 41 })
 * @param {string} command - The command name (e.g. "play-stop")
 */
export function registerCommandBinding(binding, command) {
  commandBindings.set(canonicalizeBinding(binding), command);
}

/**
 * Look up a command for a given binding.
 * @param {object} binding
 * @returns {string|null} The command name or null.
 */
export function commandForBinding(binding) {
  return commandBindings.get(canonicalizeBinding(binding)) ?? null;
}
