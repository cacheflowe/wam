# Manual Testing — MIDI Input, Learn, Jam & LED Feedback

A follow-along checklist to verify the input-abstraction + playground UI work on real hardware. Covers the source-agnostic input layer, MIDI/keyboard learn, the unified jam binding, Launch Control XL LED feedback, sequencer button mapping, and the playground UI/UX (drawer + sticky transport + shared store).

**Legend:** ☐ = do this and check the result. 🎹 = needs a MIDI controller. 🎛 = needs a Launch Control XL specifically. 💻 = no hardware needed.

## Features to test (overview)

Each maps to a numbered section below.

| # | Feature | Needs |
|---|---|---|
| 1 | MIDI input reaches the app (device → normalized events) | 🎹 |
| 2 | MIDI learn → map a controller knob/CC to a parameter | 🎹 |
| 3 | Unified jam binding — trigger from keyboard **or** MIDI, one binding | 🎹/💻 |
| 4 | LED feedback — bound indicator + live value mirror on mapped controls | 🎛 |
| 5 | Launch Control XL tester page (`#launch-control-xl-app`) | 🎛 |
| 5b | Sequencer button mapping — 16 buttons drive the focused instrument's steps + playhead | 🎛 |
| 5c | Auto-map ("device follows focus") — knobs/faders auto-bind to the focused instrument | 🎛 |
| 6 | Reliability — input survives heavy LED output (no port wedge) | 🎛 |
| 7 | Saved-song compatibility — legacy `jamKey`/`jamMidi` migrate; bindings persist | 💻 |
| 8 | Regression — instruments, QWERTY notes, loop-player keys still work | 💻 |
| 9 | Playground UI/UX — sticky transport, shared slide-out drawer (Add / Songs / MIDI), one-at-a-time panels | 💻 (MIDI panel 🎹) |

> Most of the no-hardware (💻) items can be run immediately; the 🎹/🎛 items need a controller / Launch Control XL.

---

## 0. Setup

- ☐ 🛠 `npm run dev`, open the app (https://localhost:8005).
- ☐ Open the browser **DevTools console** (some checks rely on `[LCXL]` / debug logs).
- ☐ 🎛 Connect the Launch Control XL. **Hold Factory + press channel button 5** to put it on factory template 5 (channel 13) — the app's default. (Other templates work too; the app auto-detects from the incoming channel.)
- ☐ 💻 Run the automated suite once for a baseline: `npm run test`. Expect **all green except one pre-existing failure** (`WebAudioSynthMono/Raygun every preset has volume` — unrelated to this work).

---

## 1. MIDI input reaches the app 🎹

Use the playground (`#playground-app`) or any instrument panel.

- ☐ Open the **🎛 MIDI** drawer (the input picker lives here now, not in the transport — available immediately). Select your controller from the input dropdown. Accept the **sysex** permission prompt if it appears (needed for LED output; input works regardless).
- ☐ Move a knob/fader. The little **activity dot** next to the dropdown should flash, and the "last message" line should update.
- ☐ Console: no errors. (If input ever goes dead, see §6.)

## 2. MIDI learn → parameter 🎹

- ☐ On an instrument, **hold (press and hold) a knob** in the UI and **move a controller knob/CC**. Release. The UI knob should now show the "bound" outline.
- ☐ Move that controller knob — the bound UI parameter should track it (full range 0→max).
- ☐ **Right-click** the bound UI knob to re-learn; **Shift+right-click** to clear. Confirm the binding clears (outline gone).
- ☐ Start a learn (hold knob), then press **Escape** — learn cancels and nothing is bound.
- ☐ Bind several different controller knobs to several different parameters across **two instruments**; confirm each only drives its own mapped parameter (no cross-talk).

## 3. Unified jam binding (keyboard OR MIDI) 🎹 / 💻

The jam button now takes a single binding from *any* source.

- ☐ 💻 Each instrument's **Jam** button shows its default key (e.g. "Jam B"). Press that key → the instrument triggers on the next step. (Click in the page first; avoid typing in a text field.)
- ☐ 🎹 **Hold the Jam button** and press a **MIDI note/pad** (or move a CC). Release. The button label updates to the MIDI binding (e.g. "CC13" / "M41").
- ☐ 🎹 Trigger that MIDI control → instrument jams. The old keyboard key no longer triggers it (one binding at a time).
- ☐ 💻 Hold Jam, press a **keyboard key** → rebinds to that key. Hold Jam, press **Escape** → binding cleared (button shows plain "Jam").
- ☐ 💻 While focus is in a text input (e.g. a number field), keys should **not** trigger jam.

## 4. LED feedback 🎛

> **Hardware caveat:** on the Launch Control XL the **16 channel buttons + side + arrow buttons have LEDs**; the **knobs and faders may not** light physically (the protocol accepts LED commands for them, but your unit may show nothing). So test value-mirror with a binding to a **button** if knobs don't light. The sysex is harmless either way.

- ☐ Confirm the transport MIDI input is selected and sysex was granted (console: `Using picker MIDI access. sysexEnabled=true`).
- ☐ **Bind a control** (hold UI knob, move a controller control that has an LED, e.g. a channel button). On bind, that control's LED should light **dim red** (the "mapped" indicator).
- ☐ Move/trigger that mapped control — its LED should track the value along the **off→red→amber→green** ramp.
- ☐ **Clear the binding** (Shift+right-click) — its LED turns **off**.
- ☐ Bind controls on a **different template**: switch the device template, confirm LEDs follow the displayed template (auto-detected from the incoming channel).

## 5. Launch Control XL tester demo 🎛

Open `#launch-control-xl-app`.

- ☐ Move every control; confirm each lights the matching on-screen control and the decoded message (id, CC/note, channel) is correct.
- ☐ Click **Enable LED output**, accept sysex. Status lists outputs and the selected LED port. (On Windows it should auto-pick **"MIDIOUT2 (Launch Control XL)"**.)
- ☐ **LED test** lights all LEDs; **Rainbow** shows the color ramp; **Reset** clears them.
- ☐ Move a knob/fader quickly and confirm its LED echo keeps up (no lag, no freeze).

## 5b. Sequencer button mapping 🎛 (Phase 3)

In the playground with the LCXL connected + MIDI input selected.

- ☐ **Click an instrument panel** — it gets a focus outline (`.wam-focused`). Click another — focus moves; only one is outlined.
- ☐ On focusing, the instrument gets a **jam binding** if it had none (its default key, else its slot number 1–9). The Jam button label reflects it.
- ☐ With an instrument focused, the **16 channel buttons** light to mirror its pattern (active steps = dim green, empty = off).
- ☐ **Press a channel button** → the matching step toggles on/off in the UI *and* on the device LED. Top row = steps 1–8, bottom row = steps 9–16.
- ☐ **Play the transport** → a brighter **playhead** LED runs across the 16 buttons in time, following the focused instrument's pattern position.
- ☐ **Switch focus** to another instrument → the 16 buttons immediately repaint to the new instrument's pattern.
- ☐ Edit the pattern on screen (click steps) → the button LEDs update to match.
- ☐ Sweep knobs hard while the playhead runs (combines §6) → input stays alive; LEDs keep up.

## 5c. Auto-map — "device follows focus" 🎛 (Phase 4)

The knobs/faders auto-bind to whichever instrument is focused. Manual learn still wins and persists.

- ☐ Open **🎛 MIDI** → confirm **"Auto-map device to focused instrument"** is checked (default on).
- ☐ **Click an instrument** → its knobs/faders auto-bind: the LCXL **knob LEDs light amber** (auto) for the mapped params. Turn a knob → the matching parameter moves (no manual learn needed).
- ☐ **Click another instrument** → the previous auto-map clears and the new instrument's params take over the knobs (LEDs repaint).
- ☐ **Manual still wins:** MIDI-learn one knob to a specific param (it lights **red**). Refocus the instrument — that knob stays on your manual binding (red), and auto-map fills the *other* knobs around it (amber), never double-driving the manual one.
- ☐ **Uncheck** the auto-map toggle → auto-bindings clear; only manual bindings remain active.
- ☐ Faders auto-map too (they have no LEDs, so no light — but moving a mapped fader should still drive its parameter).

## 6. Reliability — no port wedge 🎛

This is the bug class that previously required unplugging the device.

- ☐ With LED output enabled, **sweep several knobs fast and simultaneously for 10–20 seconds.**
- ☐ Input must **stay responsive** the whole time (UI keeps updating). LEDs keep tracking.
- ☐ If input ever dies (LEDs still work but knobs stop registering): that's the wedge. Recovery = **unplug/replug the device**. Report it — output should be batched (≤ one sysex/frame) so this should *not* happen now.

## 7. Saved-song compatibility 💻

Back-compat is only guaranteed for saved-song JSON.

- ☐ Load the bundled **`houz.json`** song (via the song/arrangement library). It loads without console errors.
- ☐ Instruments that had a `jamKey` in the song (e.g. "n", "b", "v") still jam on those keys (legacy `jamKey`/`jamMidi` migrate into the unified binding).
- ☐ Save the arrangement, reload it — jam bindings and any MIDI param bindings persist (`jamBinding` + `midiParamBindings` round-trip).

## 8. Regression — nothing else broke 💻

- ☐ Add each instrument in the playground; play the transport; confirm audio + sequencer still work.
- ☐ Keyboard QWERTY note input / existing shortcuts still work.
- ☐ `sample-looper` segment keys (z/x by default) still jump segments (its multi-key path was left intact).

## 9. Playground UI/UX — drawer + sticky transport 💻

The playground (`#playground-app`) was restructured: the transport is a sticky top bar with a launcher toolbar, and the instrument palette, song library, and MIDI debug view now live in one shared slide-out drawer.

**Sticky transport**
- ☐ The transport sits at the top; **scroll the instrument list** — the transport stays pinned at the top of the window.
- ☐ Nothing in the canvas hides *behind* the transport bar while scrolling.

**Launcher toolbar + drawer behavior**
- ☐ Below the transport: three buttons — **+ Add Instrument**, **♪ Songs**, **🎛 MIDI** — plus the current-song label.
- ☐ Click **+ Add Instrument** → drawer slides in from the right with the instrument palette; the button highlights as active.
- ☐ Click **♪ Songs** → drawer **swaps** to the arrangement library (Add panel hides); only one panel is open at a time; the active highlight moves to Songs.
- ☐ Click **🎛 MIDI** → drawer swaps to the MIDI panel: the **input picker** (now owned here, not the transport) above the **debug monitor**.
- ☐ Clicking the **same** launcher again **closes** the drawer (toggle).
- ☐ Close the drawer three ways and confirm each works: the **× button**, **clicking the dimmed backdrop**, and **Escape**.
- ☐ Re-open a panel after closing — its state is intact (e.g. the song list / scroll position is preserved; panels are kept mounted).

**The tools still work inside the drawer**
- ☐ **Add Instrument**: click an instrument in the palette → it's added to the canvas. (Drawer stays open so you can add several.)
- ☐ **Songs**: save the current arrangement, then load a saved/sample song — both work from the drawer; the current-song label in the top bar updates.
- ☐ **MIDI** 🎹: with a controller selected, open the MIDI panel and move controls → events stream in the monitor (source:label + kind + value); the "Focused" line shows the clicked instrument.

**Sanity**
- ☐ No console errors opening/closing the drawer or switching panels.
- ☐ Resize the window narrow — note any layout issues (responsive polish is a known follow-up, so just record what looks off).

---

## What to report back

For anything that fails, note: which step, what you saw vs. expected, the console output, and (for MIDI) which controller + template/channel. The most valuable signals: (a) does input stay alive under heavy LED output (§6), and (b) which physical controls actually light on your LCXL (§4 caveat).
