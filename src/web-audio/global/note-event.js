/**
 * Note events — a uniform description of "an instrument just played a note",
 * built from each instrument's own trigger() arguments.
 *
 * Instruments have different trigger signatures (acid: midi, dur, accent,
 * time; kick: velocity, time; FM: notes, dur, time; …). Each instrument class
 * declares its layout once:
 *
 *   static TRIGGER_ARGS = { trigger: ["notes", "duration", "accent", "time"] };
 *
 * and describeTrigger() turns any call into the same shape. Used by the
 * Controls trigger wrapper (wam-trigger events) and the performance stream
 * that broadcasts notes to external visualizers.
 *
 * Arg names: notes (number | number[] | null), duration (s), velocity (0..1),
 * accent (bool), time (AudioContext s), open (bool, hi-hat). Unknown names are
 * ignored, so an instrument can skip args it doesn't want described.
 */

/** Velocity reported for accented / unaccented notes when the instrument has no velocity arg. */
const ACCENT_VELOCITY = 1;
const DEFAULT_VELOCITY = 0.8;

/**
 * @param {Function} Cls      instrument class (reads Cls.TRIGGER_ARGS)
 * @param {string} method     "trigger" | "triggerDrum" | …
 * @param {any[]} args        the call's arguments
 * @returns {{notes:number[], velocity:number, duration:number|null, accent:boolean, time:number|null, open?:boolean}|null}
 *   null when the instrument doesn't describe this method (no event is emitted).
 */
export function describeTrigger(Cls, method, args) {
  const layout = Cls?.TRIGGER_ARGS?.[method];
  if (!layout) return null;
  const raw = {};
  layout.forEach((name, i) => {
    if (name) raw[name] = args[i];
  });
  const notes = raw.notes == null ? [] : (Array.isArray(raw.notes) ? raw.notes : [raw.notes]).filter((n) => typeof n === "number");
  const accent = !!raw.accent;
  let velocity = typeof raw.velocity === "number" ? raw.velocity : accent ? ACCENT_VELOCITY : DEFAULT_VELOCITY;
  velocity = Math.max(0, Math.min(1, velocity));
  const event = {
    notes,
    velocity,
    duration: typeof raw.duration === "number" ? raw.duration : null,
    accent,
    time: typeof raw.time === "number" ? raw.time : null,
  };
  if ("open" in raw) event.open = !!raw.open;
  return event;
}
