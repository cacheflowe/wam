# Novation Launch Control XL — MIDI Map

Reference for [`src/web-audio/midi/launch-control-xl.js`](../../src/web-audio/midi/launch-control-xl.js), a zero-dependency ES module with the full control map plus LED/sysex message builders. Sources: Novation's *Launch Control XL Programmer's Reference* (LED + sysex protocol) and the standard factory template assignments.

## Templates & channels

The device has 16 template slots: **0–7 user**, **8–15 factory**. Every template uses the same control layout; the only difference is the MIDI channel, which is `slot + 1` (1-indexed). The module defaults to **factory template 5** (slot 12, channel 13) — select it on the device by holding *Factory* and pressing channel button 5. This avoids channel-1 collisions with other gear and is consistent across devices.

## Control map (all templates)

| Control | Type | Numbers (left → right) |
|---|---|---|
| Knobs row 1 (Send A) | CC | 13, 14, 15, 16, 17, 18, 19, 20 |
| Knobs row 2 (Send B) | CC | 29, 30, 31, 32, 33, 34, 35, 36 |
| Knobs row 3 (Pan/Device) | CC | 49, 50, 51, 52, 53, 54, 55, 56 |
| Faders 1–8 | CC | 77, 78, 79, 80, 81, 82, 83, 84 |
| Buttons row 1 (Track Focus) | Note | 41, 42, 43, 44, 57, 58, 59, 60 |
| Buttons row 2 (Track Control) | Note | 73, 74, 75, 76, 89, 90, 91, 92 |
| Device / Mute / Solo / Record Arm | Note | 105, 106, 107, 108 |
| Up / Down / Left / Right | CC | 104, 105, 106, 107 |

Buttons send velocity 127 on press, 0 on release. Note the type disambiguation: CC 105 is the Down arrow while note 105 is the Device button.

**App command defaults:** the **Device** button drives `play-stop`, and the **↑ / ↓** arrows step `prev` / `next-instrument` (see `DEFAULT_COMMAND_CONTROLS` in `launch-control-xl.js` and the [command layer](../FRONTEND.md#commands)). These fire on press only — the value-0 release is ignored. The computer keyboard mirrors them: **Space** = play/stop, **↑ / ↓** = prev/next instrument.

## LED control

Faders have no LEDs. Knobs and channel buttons mix red + green (→ amber); Device/Mute/Solo/Record Arm are yellow-only; arrows are red-only.

**Velocity byte** packs both colors: `16 * green + red + flags`, where red/green are brightness 0–3 and flags are 12 (normal), 8 (flash, when flashing mode is on), or 0 (double-buffering). Precomputed values: off 12, red 13/15, amber 29/63, yellow 62, green 28/60; flashing full-brightness: red 11, amber 59, yellow 58, green 56.

**Sysex set-LED** (works on any template, even unselected):

```
F0 00 20 29 02 11 78 <template> [<index> <velocity>]... F7
```

LED indices: 0–7 / 8–15 / 16–23 knob rows top→bottom; 24–31 top channel buttons; 32–39 bottom channel buttons; 40–43 Device/Mute/Solo/Record Arm; 44–47 Up/Down/Left/Right.

> **Gotcha — match the template the device is displaying.** Sysex LED messages are addressed by template byte, not channel, but the device only *shows* LEDs for the template it is currently on. Writing LEDs to any other template succeeds silently and displays nothing. Since each template transmits on `channel = slot + 1`, read the incoming channel and target that template (`templateFromChannel(message.channel)`) rather than assuming a fixed slot. On Windows the LED output is usually the secondary **"MIDIOUT2 (Launch Control XL)"** port, not the plain "Launch Control XL".

Other messages (`t` = template slot):

| Purpose | Bytes |
|---|---|
| Set toggle-button states | `F0 00 20 29 02 11 7B t [<index> <0|127>]... F7` (toggle indices 0–15 channel buttons, 16–19 side, 20–23 arrows) |
| Select template | `F0 00 20 29 02 11 77 t F7` (also sent *by* the device on template change) |
| Reset template LEDs | `B(t) 00 00` |
| LED test all-on | `B(t) 00 7D–7F` |
| Auto-flash on | `B(t) 00 28` |
| Double-buffer control | `B(t) 00 20–3D` (see programmer's reference appendix) |

## Usage in wam

```js
import {
  bindingFor, findControl, setLedMessage, LED,
} from "../web-audio/midi/launch-control-xl.js";

// Pre-bind a param instead of MIDI-learning it:
controls._paramBindings.cutoff = bindingFor("knobA1"); // { source: "midi", type: "cc", channel: 13, controller: 13 }

// Identify hardware from the app's normalized messages:
document.addEventListener("wam-midi-message", (e) => {
  const control = findControl(e.detail.binding);
  if (control?.id === "device") console.log("Device button:", e.detail.velocity);
});

// Light an LED. Sending sysex needs a sysex-enabled MIDIAccess + MIDIOutput.
// Add the `sysex` attribute to <wam-midi-input-picker> to get one, then reuse
// its `.midiAccess` for output (see "Reliability" — do NOT open a second access).
output.send(setLedMessage("focus1", LED.GREEN_FULL));
```

All message helpers return plain byte arrays, so the module also works outside this app (Node, Max, etc.).

## Reliability — hard-won lessons (Windows especially)

These three rules came out of debugging a live device. Ignore any of them and the **device's MIDI input goes dead while output keeps working**, and it stays dead across page reloads — only physically **unplugging and replugging the device** clears it (the stall is in the OS/driver layer, not the page).

1. **Rate-limit and batch LED output — never send a sysex per input event.** A knob sweep emits a stream of CC messages; echoing a separate sysex for each one floods the port. Bursts of tiny `F0…F7` messages stall the device's input callback on Windows (a long-standing Chromium behavior). Instead, **queue LED changes and flush at most once per animation frame as a single multi-pair sysex** (`setLedsMessage` accepts many `[index, velocity]` pairs). Also dedupe on the quantized color so an unchanged LED never re-sends. See `_scheduleLedFlush` in [src/app/launch-control-xl.js](../../src/app/launch-control-xl.js).

2. **Use exactly one `MIDIAccess` for the whole page.** Two `MIDIAccess` objects contending for the same device ports also breaks input on Windows. The input picker owns the single access; consumers that need to send LEDs should reuse `picker.midiAccess` rather than calling `navigator.requestMIDIAccess()` themselves. Sending sysex requires that access to be sysex-enabled, so set the `sysex` attribute on the picker (it's opt-in; other apps are unaffected).

3. **Sysex permission is a separate browser grant.** Plain MIDI access no longer prompts, but `{ sysex: true }` does — and once granted to an origin, Chrome won't re-prompt (so "no permission dialog appeared" usually means it was already granted, not that it failed). Check `access.sysexEnabled` to confirm.

**Recovery:** if input is already wedged, code changes won't fix it — unplug and replug the device (or restart the browser) to reset the stuck OS port handle.

**Templates and LEDs:** LEDs only display on the template the device is *currently showing*. Derive the target template from the incoming channel (`templateFromChannel`) rather than assuming a fixed slot, and re-send LED state after a template switch.
