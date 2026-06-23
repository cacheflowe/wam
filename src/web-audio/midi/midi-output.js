/**
 * MidiOutput — safe LED/sysex output to a Launch Control XL.
 *
 * Encapsulates the reliability rules learned the hard way (see
 * docs/RELIABILITY.md #7): never send a sysex per input event. LED changes are
 * queued, deduped per LED index, and flushed at most once per animation frame
 * as a single multi-pair sysex. Sending bursts of tiny sysex messages stalls
 * the device's MIDI input on Windows until a physical replug.
 *
 * UI-agnostic (no DOM): callers own port selection + access; this just sends.
 */
import { setLedsMessage, getControl, DEFAULT_TEMPLATE } from "./launch-control-xl.js";

const hasRAF = typeof requestAnimationFrame === "function";

export default class MidiOutput {
  constructor() {
    this._output = null;
    this._template = DEFAULT_TEMPLATE;
    this._pending = new Map(); // ledIndex → velocity queued for the next flush
    this._lastSent = new Map(); // ledIndex → last velocity actually sent (dedupe)
    this._flushHandle = null;
  }

  /** Set the destination MIDIOutput port (or null to silence sends). */
  setOutput(port) {
    this._output = port ?? null;
    return this;
  }

  get output() {
    return this._output;
  }

  get template() {
    return this._template;
  }

  /**
   * Set the active template. LEDs only display on the template the device is
   * showing, so changing it drops the dedupe cache to allow a fresh repaint.
   */
  setTemplate(template) {
    if (template === this._template) return;
    this._template = template;
    this._pending.clear();
    this._lastSent.clear();
  }

  /** Queue an LED change by sysex index. Coalesced + deduped, flushed per frame. */
  queueLed(ledIndex, velocity) {
    if (ledIndex == null) return;
    if (this._lastSent.get(ledIndex) === velocity) return; // unchanged → skip
    this._pending.set(ledIndex, velocity);
    this._scheduleFlush();
  }

  /** Queue an LED change by control id (no-op if the control has no LED). */
  queueControlLed(controlId, velocity) {
    const control = getControl(controlId);
    if (control?.ledIndex != null) this.queueLed(control.ledIndex, velocity);
  }

  _scheduleFlush() {
    if (this._flushHandle != null) return;
    if (hasRAF) {
      this._flushHandle = requestAnimationFrame(() => {
        this._flushHandle = null;
        this.flush();
      });
    } else {
      this.flush(); // no rAF (e.g. Node/tests): send straight away
    }
  }

  /** Flush all queued LED changes as one sysex. Safe to call manually. */
  flush() {
    if (this._flushHandle != null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this._flushHandle);
    }
    this._flushHandle = null;
    if (this._pending.size === 0) return;
    const pairs = [...this._pending.entries()];
    this._pending.clear();
    if (!this._output) return;
    for (const [idx, vel] of pairs) this._lastSent.set(idx, vel);
    try {
      this._output.send(setLedsMessage(pairs, this._template));
    } catch {
      /* ignore transient send errors during rapid input */
    }
  }

  /** Set LEDs immediately as one sysex (for one-shot full updates). */
  setLedsNow(pairs) {
    if (!pairs?.length || !this._output) return false;
    for (const [idx, vel] of pairs) this._lastSent.set(idx, vel);
    return this.send(setLedsMessage(pairs, this._template));
  }

  /** Send raw bytes immediately (channel messages: reset, LED test, …). */
  send(bytes) {
    if (!bytes || !this._output) return false;
    try {
      this._output.send(bytes);
      return true;
    } catch {
      return false;
    }
  }

  /** Forget what we believe is lit (e.g. after a device reset), forcing repaint. */
  invalidate() {
    this._lastSent.clear();
  }

  /** Cancel any pending flush. Call on teardown. */
  dispose() {
    if (this._flushHandle != null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this._flushHandle);
    }
    this._flushHandle = null;
    this._pending.clear();
  }
}
