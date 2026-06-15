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
 */

export const CONTROL_INPUT_EVENT = "wam-control-input";

/**
 * Feedback intent event: the learn layer announces binding changes/values so a
 * device-feedback sink (e.g. LCXL LEDs) can react, without the learn layer
 * knowing anything about the device. detail = { kind, binding, value? } where
 * kind is "bound" | "unbound" | "value".
 */
export const BINDING_FEEDBACK_EVENT = "wam-binding-feedback";

export function dispatchBindingFeedback(detail, target = document) {
  target.dispatchEvent(new CustomEvent(BINDING_FEEDBACK_EVENT, { detail }));
}

/** source string → { equals(a, b) => bool, format(binding) => string } */
const registry = new Map();

/**
 * Register equality + formatting for a binding source. Called once per adapter
 * (typically at module load). Re-registering replaces the prior entry.
 */
export function registerBindingType(source, { equals, format } = {}) {
  registry.set(source, {
    equals: typeof equals === "function" ? equals : () => false,
    format: typeof format === "function" ? format : () => "",
  });
}

/** True if two bindings refer to the same control. Dispatches on binding.source. */
export function bindingsEqual(a, b) {
  if (!a || !b || a.source !== b.source) return false;
  return registry.get(a.source)?.equals(a, b) ?? false;
}

/** Human-readable label for a binding (e.g. "CC7", "Key A"). "" if unknown. */
export function formatBinding(binding) {
  if (!binding) return "";
  return registry.get(binding.source)?.format(binding) ?? "";
}

/** True if a source has been registered (useful for guarding / tests). */
export function hasBindingType(source) {
  return registry.has(source);
}

/**
 * Tag a legacy (untagged) binding as MIDI. Before the input abstraction,
 * bindings had no `source` field and were always MIDI; saved state restored
 * from that era must be migrated so it matches the now source-tagged events.
 */
export function migrateLegacyBinding(binding) {
  if (!binding || typeof binding !== "object") return binding;
  return binding.source ? binding : { source: "midi", ...binding };
}

/**
 * Dispatch a normalized control-input event. Adapters call this; consumers
 * listen for CONTROL_INPUT_EVENT. `target` defaults to document so the event
 * is global, matching how `wam-midi-message` is broadcast today.
 */
export function dispatchControlInput(detail, target = document) {
  target.dispatchEvent(new CustomEvent(CONTROL_INPUT_EVENT, { detail }));
}
