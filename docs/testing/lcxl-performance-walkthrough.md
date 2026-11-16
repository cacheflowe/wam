# Walkthrough — Launch Control XL Performance Layout

A guided hands-on session for the playground's Launch Control XL layout (jammable-playground Phase 4). Work top to bottom; each step says what to **do**, what you should **see**, and has room for notes. About 20–30 minutes.

Everything here was verified in a browser with *simulated* MIDI on channel 13. This session is the first time it meets the real device, so expect to find things.

Layout reference: [launch-control-xl.md → Playground performance layout](../references/launch-control-xl.md#playground-performance-layout).

Result key: ✅ works · ⚠️ works but feels off (note why) · ❌ broken

---

## 0. Setup

| # | Do | Expect | Result / notes |
|---|---|---|---|
| 0.1 | Plug in the XL. Hold **Factory** + press channel button **5** (factory template 5). | Template 5 selected. | |
| 0.2 | `npm run dev`, open `https://localhost:8005/#playground-app` in Chrome. | Playground loads. | |
| 0.3 | Open the **MIDI** drawer. Pick the Launch Control XL as input; allow MIDI + sysex. | MIDI monitor shows messages when you touch the device. | |
| 0.4 | Tick **Dock hardware map at the bottom of the page**. | The on-screen map docks to the bottom and stays there while you scroll. | |
| 0.5 | Add **Acid**, **Poly Synth**, **Kick** (+ Add Instrument), in that order. | Three rows. The map's fader row reads 1 TB-303 Acid · 2 Poly Synth · 3 Kick. | |
| 0.6 | Press **Device** (top side button). | Transport plays. Press again → stops. Leave it playing. | |

## 1. Modes — side buttons

| # | Do | Expect | Result / notes |
|---|---|---|---|
| 1.1 | Look at the Mute / Solo / Rec Arm side buttons. | **Mute** is lit (Steps mode). The map's "Steps" chip is highlighted. | |
| 1.2 | Press **Solo**. | Solo lit, Mute dark. Map shows "Mixer". | |
| 1.3 | Press **Rec Arm**. | Rec Arm lit. Map shows "Perform". | |
| 1.4 | Press **Mute**. | Back to Steps. | |
| 1.5 | ⚠ **Key unknown:** if nothing in 1.1–1.4 responds, the side buttons may not send notes 105–108 on template 5. Check the MIDI monitor for what they actually send. | Note what the monitor shows. | |

## 2. Knobs — role-based layout

| # | Do | Expect | Result / notes |
|---|---|---|---|
| 2.1 | Press **↑ / ↓** until **Acid** is focused (its panel expands). | Knob LEDs go amber for mapped knobs. Map header: "Knobs → TB-303 Acid". | |
| 2.2 | Turn knob **A1** (top-left). | Acid **cutoff** moves; A1's LED follows the value. | |
| 2.3 | Turn **A2**, **A3**. | Resonance, then Env Mod. | |
| 2.4 | Turn **B1**, **B2** (second row). | Attack, Decay. | |
| 2.5 | Focus **Poly Synth**. Turn **A1, A2, B1–B4**. | Same *kinds* of controls as Acid: cutoff, resonance, attack/decay/sustain/release. **This is the muscle-memory test: does it feel consistent?** | |
| 2.6 | With Poly focused, look at **← / →**. | Both lit (Poly has 2 knob pages). Map says "page 1/2". | |
| 2.7 | Press **→**. Turn a few knobs. | Map says "page 2/2"; knobs now drive other Poly params (osc A level/detune, LFO 2…). | |
| 2.8 | Press **→** again. | Wraps to page 1. | |
| 2.9 | Focus **Kick**. | ← / → go dark (one page). Knob labels on the map: Click, Drive, Decay, and End/Start/Sweep on row 3. | |
| 2.10 | **Feel check:** knob layout on Kick vs. synths. | Note anything you'd want on different knobs. | |

## 3. Faders — mixer with pickup

| # | Do | Expect | Result / notes |
|---|---|---|---|
| 3.1 | Look at the map's fader row. | Each slot shows a volume bar; slots you haven't touched show "↕ pick up". | |
| 3.2 | Move **fader 1** all the way **up**, then slowly **down**. | Acid's volume doesn't change until the fader passes Acid's current level (~25% for a new instrument), then follows. "pick up" disappears. | |
| 3.3 | Move **fader 2**, then **fader 3**. | Poly and Kick volumes, same pickup behavior. Works whichever instrument is focused. | |
| 3.4 | Change **Acid's volume on screen** (the Vol knob in its strip). Then move fader 1. | Fader needs to pick up again (no jump). | |
| 3.5 | Switch to **Perform** mode (Rec Arm) and move faders. | Still the mixer, in every mode. | |
| 3.6 | **Feel check:** is pickup helpful or annoying live? | | |

## 4. Mixer mode (Solo)

| # | Do | Expect | Result / notes |
|---|---|---|---|
| 4.1 | Press **Solo**. Look at the 16 buttons. | Top row: buttons 1–3 **green** (unmuted), 4–8 dark. Bottom row: focused instrument **bright amber**, others dim green. | |
| 4.2 | Press top button **1**. | Acid mutes (its Mute button lights on screen); button 1 turns **red**. Press again → unmutes, green. | |
| 4.3 | While playing, press bottom button **3**. | Kick's **jam** hit plays on the next step. Focus does **not** move. | |
| 4.4 | Drum on bottom buttons 1–3 in rhythm. | Each press lands on the grid; feels playable? | |
| 4.5 | Press **↓** / **↑**. | Focus moves between instruments (bottom-row amber follows). | |

## 5. Perform mode (Rec Arm) — on the focused instrument

Focus **Acid** first (↑/↓, or click its panel).

| # | Do | Expect | Result / notes |
|---|---|---|---|
| 5.1 | Press **Rec Arm**. Look at the buttons. | Top 1 (**Pattern A**) bright green (playing). Top 2–4 red-ish if empty / green if they have steps. Top 5–7 dim amber. Bottom row lit (mutate/randomize); Undo/Redo dark until there's history. | |
| 5.2 | Bottom **1** (Mutate subtle), several times. | Acid's sound drifts slightly each press; knobs on screen move. **Undo** (bottom 5) lights. | |
| 5.3 | Bottom **3** (Mutate wild). | Bigger change. | |
| 5.4 | Bottom **5** (Undo) ×2, then bottom **6** (Redo). | Steps back through the sound, then forward. | |
| 5.5 | Bottom **4** (Randomize sound). | Whole new acid sound within sensible ranges. | |
| 5.6 | Top **6** (Next preset), top **5** (Prev preset). | Preset dropdown steps; sound changes. | |
| 5.7 | Top **7** (Random pattern). | New step pattern. | |
| 5.8 | While playing, press top **2** (Pattern B) **mid-bar**. | Button turns **amber** (queued), then **green** exactly on the next downbeat; the pattern changes on the bar. Pattern A goes dark green/off. | |
| 5.9 | Press top **1** (Pattern A). | Switches back on the next bar. | |
| 5.10 | Focus **Kick**, repeat 5.2 and 5.8. | Same behavior on a drum. | |
| 5.11 | While playing, top **8** (Evolve) a few times. | The playing pattern changes a little each press (every 4th press: a fresh pattern). Bottom **8** turns **red** (away from home). | |
| 5.12 | Bottom **8** (Return home). | Back to the original pattern; LED off. | |
| 5.13 | Open **∿ Evolve** in the drawer, turn on **Auto**. Turn knob **C8** (Energy) low, then high. | Energy slider + C8 LED follow. Low: thinner variations, kick drops; high: fills, ratchets, thicker. Variations last 1–2 bars and snap back. The "Recent" list shows each one. | |
| 5.14 | While a variation plays (bottom **7** lit amber), press bottom **7** (Keep). | The variation stays as the new home. | |
| 5.15 | Set **Drift** to ~50%. Let it run for a few minutes. | Some variations stick and the song slowly moves; Drift 0 always comes home. | |

## 6. Back to Steps

| # | Do | Expect | Result / notes |
|---|---|---|---|
| 6.1 | Press **Mute** (Steps mode). | The 16 buttons repaint the focused pattern (active steps green) with a moving playhead — on the device **and** in the on-screen map. | |
| 6.2 | Press a few buttons. | Steps toggle on screen and in the sound. | |
| 6.3 | Switch Mixer → Steps → Perform → Steps quickly. | LEDs always match the mode; no stale lights. | |

## 7. Manual MIDI-learn still wins

| # | Do | Expect | Result / notes |
|---|---|---|---|
| 7.1 | On Acid, MIDI-learn **Distortion** to knob **C7**. | C7 LED **red**; it drives Distortion. Other knobs stay amber auto-map. | |
| 7.2 | Focus another instrument, then Acid again. | C7 still yours (red); auto-map fills the rest around it. | |
| 7.3 | MIDI-learn some param to **fader 8**. | Fader 8 drives that param and no longer acts as slot 8's volume. | |

## 8. Stress / reliability

| # | Do | Expect | Result / notes |
|---|---|---|---|
| 8.1 | For ~1 minute: hammer buttons, sweep knobs and faders, switch modes, in all three modes, while playing. | Device input never goes dead; LEDs keep up. (If input dies, only a replug fixes it. Note exactly what you were doing — see [RELIABILITY.md](../RELIABILITY.md) / the LCXL reliability notes.) | |
| 8.2 | Unplug and replug the XL mid-session. | Re-select it in the MIDI drawer; LEDs repaint after the next action. | |

## 9. On-screen map without the device

| # | Do | Expect | Result / notes |
|---|---|---|---|
| 9.1 | Click the **Mixer / Perform / Steps** chips on the map. | Mode changes (device LEDs follow if connected). | |
| 9.2 | In Perform mode, click **Mutate medium** / **Undo sound** on the map. | Same as the hardware buttons. | |
| 9.3 | With the XL plugged in and MIDI drawer → Hardware map = **Auto**, reload. | The map opens as a **right column** (one row per channel: Tone / Envelope / Movement knobs + fader, then the 16 buttons, then Evolve). Unplug → it moves back into the drawer; replug → column again. | |
| 9.4 | Turn knobs on the device and on screen; sweep a **Wave** knob. | Dials and values in the column move live; the Wave knob steps Saw → Square → Tri → Sine (blue dial). | |
| 9.5 | Press **→** for knob page 2. | Column shows page 2 (filter type, LFO shapes/destinations, …); turning those knobs changes them. | |
| 9.6 | Narrow the browser below ~1100px. | Column drops to the bottom dock; widen again → column. | |

---

## Wrap-up questions

- Which knob assignments felt wrong or missing? (e.g. "want FX sends on row 3", "drive should be on A2 for drums")
- Is pickup the right fader behavior, or would you rather faders jump?
- Anything you reached for that isn't on the device?
- Which Perform buttons would you swap? (Top 8 and bottom 7–8 are still free.)
