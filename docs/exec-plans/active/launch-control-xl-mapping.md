# Plan: Launch Control XL — Knob & Sequencer Mapping

Status: Not started
Owner: Justin Gitlin
Created: 2026-06-13

## Goal

Use the [Launch Control XL MIDI map](../../references/launch-control-xl.md) alongside the existing MIDI-learn system so the hardware becomes a first-class controller: map knobs/faders to any instrument param **with live LED value feedback**, and map the **16 channel buttons to the 16 sequencer steps** of a click-focused instrument, with the buttons lit to mirror the pattern and playhead.

## Context

- MIDI-learn already exists and **already persists** bindings. `MidiParamLearnMixin` ([midi-param-learn.js](../../../src/web-audio/ui/midi-param-learn.js)) is mixed into both `WebAudioControlsBase` and `WebAudioTransportControls`. Knob → param mapping works today; what's missing is hardware LED feedback and any sequencer-step mapping.
- The learn system is fully **device-agnostic** and does not reference the LCXL map. We keep that separation: generic learn stays generic; LCXL specifics live in an optional feedback layer.
- The reliability-critical batched LED output (`_scheduleLedFlush`), the `LED_CSS` mirror, and template-from-channel tracking currently live **only** in the demo app ([app/launch-control-xl.js](../../../src/app/launch-control-xl.js)). They must be promoted to a shared module — see [RELIABILITY.md #7](../../RELIABILITY.md) (never send sysex per input event; one MIDIAccess per page).

## Decisions (locked 2026-06-13)

| Decision | Choice | Rationale |
|---|---|---|
| Sequencer focus | **Click panel to focus** | Discoverable; consumes no hardware buttons. One instrument's seq owns the 16 buttons at a time. |
| Knob LED feedback | **Live value mirror** | LED color tracks value (off→red→amber→green). Uses batched output so it can't wedge the port. |
| Work order | **Refactor first, then features** | Build features on a consolidated base; less rework. |
| Input abstraction | **Source-agnostic input layer; MIDI is one adapter** | `controls-base`/`transport` must not assume MIDI. A normalized `wam-control-input` event + binding registry lets a gamepad/OSC/keyboard source swap in with no component changes. |

## Tech debt to resolve first (Phase 1)

1. **Duplicated learn plumbing.** `controls-base.js` ([65-68](../../../src/web-audio/ui/controls-base.js#L65-L68), [192-194](../../../src/web-audio/ui/controls-base.js#L192-L194), [458-478](../../../src/web-audio/ui/controls-base.js#L458-L478)) and `transport.js` ([79-82](../../../src/web-audio/ui/transport.js#L79-L82), [287-289](../../../src/web-audio/ui/transport.js#L287-L289), [392-404](../../../src/web-audio/ui/transport.js#L392-L404)) hand-roll the same constructor fields, document listener, `_handleMidiMessage`, and `_midiRegistry` getter.
2. **Batched LED output trapped in the demo.** Promote to a shared `MidiOutput`.
3. **Learn only drives knobs/sliders.** `_applyMidiParamMessage`/`_setControlValueFromMidi` ignore selects/toggles ([midi-param-learn.js 112-150](../../../src/web-audio/ui/midi-param-learn.js#L112-L150)).
4. **`wam-step-seq` step-cell update copied 3×** (click handler [309-314](../../../src/web-audio/ui/step-seq.js#L309-L314), `set steps` [538-554](../../../src/web-audio/ui/step-seq.js#L538-L554), `rotate` [629-645](../../../src/web-audio/ui/step-seq.js#L629-L645)). No programmatic `toggleStep`.
5. **Jam has parallel keyboard + MIDI paths.** `_jamKey` and `_jamMidi` are learned, stored, formatted, and matched separately ([controls-base.js 309-396](../../../src/web-audio/ui/controls-base.js#L309-L396), [458-474](../../../src/web-audio/ui/controls-base.js#L458-L474)). The input abstraction collapses these into one `_jamBinding` (a `trigger` from any source).
6. **MIDI assumptions leak into the components.** `controls-base`/`transport` consume `wam-midi-message` directly and `_setControlValueFromMidi` hardcodes `/127` + `note`/`cc` ([midi-param-learn.js 123-150](../../../src/web-audio/ui/midi-param-learn.js#L123-L150)). The components should see normalized, source-agnostic events.

## Architecture (layered)

- **L0 — input-source abstraction** (the new foundation). A normalized `wam-control-input` document event: `{ binding, value (0..1), kind: "absolute"|"trigger", pressed }`. `binding` is `{ source, ...identity }`. A **binding registry** (`input-bindings.js`) holds `{ equals, format }` per `source`, so `bindingsEqual`/`formatBinding` are polymorphic. Each device is an **adapter** that connects and emits the normalized event:
  - `MidiInputSource` — subscribes to the picker's raw `wam-midi-message`, normalizes value (`/127`), sets `kind` (cc→absolute, note→trigger), tags `binding.source = "midi"`. Registers the `"midi"` binding type (reusing `midiBindingsEqual`/`formatMidiBinding`).
  - `KeyboardInputSource` — keydown/up → `trigger` bindings `{ source:"keyboard", code }`.
  - Future `GamepadInputSource` / `OscInputSource` drop in with **zero component changes**.
  - Raw `wam-midi-message` is **kept** — LED feedback + the tester need MIDI specifics. No info is lost: the binding stays MIDI-tagged, so `findControl()` still resolves it for LEDs.
- **L1 — source-agnostic learn** (the consolidated mixin). Listens to `wam-control-input`, compares via `bindingsEqual`, applies the `0..1` value to the control's range. No MIDI assumptions. Jam collapses to a single `_jamBinding` (`trigger` from any source).
- **L2 — `MidiOutput` singleton** keyed off `picker.midiAccess`: batched/rate-limited sends, `setControlLed(id, vel)`, `setLeds(pairs)`, `clearAll()`, template-from-channel tracking. The home for the reliability rules.
- **L3 — LCXL feedback glue**: `findControl(binding)` (when `binding.source === "midi"`) → if it's an LCXL control with an `ledIndex`, mirror value via `ledColorByPercent`; no-op for other sources/gear.
- **L4 — sequencer mapping**: a single "input focus" (click a panel). Button `trigger` → `toggleStep`; active steps + playhead → button LEDs (steps 0–15 = LED index 24–39, contiguous in the map). Source-agnostic — steps can be toggled from keyboard too.

## Testing

Manual QA checklist: [docs/testing/midi-input-and-led-testing.md](../../testing/midi-input-and-led-testing.md) — covers input/learn, the unified jam, LED feedback, reliability (no port wedge), and saved-song compatibility.

## Phases

### Phase 1 — Input abstraction + refactor (no behavior change)
- [x] Add `src/web-audio/input/input-bindings.js`: binding registry (`registerBindingType`, `bindingsEqual`, `formatBinding`, `migrateLegacyBinding`) + the `wam-control-input` event contract.
- [x] Add `src/web-audio/input/midi-source.js` (`MidiInputSource` + `ensureMidiInputSource` singleton): subscribe to `wam-midi-message`, normalize, register the `"midi"` binding type (reuses `midiBindingsEqual`/`formatMidiBinding`).
- [x] Add `src/web-audio/input/keyboard-source.js` (`KeyboardInputSource`): keydown/up → `trigger` events, registers `"keyboard"` binding type. *(Built + tested; not yet wired into the app — see jam collapse below.)*
- [x] Rework the learn mixin → `InputLearnMixin` (`ui/input-learn.js`): consumes `wam-control-input`, uses `bindingsEqual`/`formatBinding`, applies normalized `0..1`. State init + listener wiring + default handler now live in the mixin; `controls-base` overrides `_handleControlInput`/`_onInputExtra` for jam only. `controls-base` + `transport` de-duplicated. JSON key `midiParamBindings` kept; legacy bindings migrated on load.
- [x] Collapse `_jamKey` + `_jamMidi` → one `_jamBinding` (any source); wire `KeyboardInputSource` (`ensureKeyboardInputSource` in `_attachInputLearn`); jam learn/match/Escape-cancel now run through `wam-control-input`. `toJSON` writes `jamBinding`; `fromJSON` migrates legacy `jamMidi`/`jamKey`. Fixed a mixin-apply clobber (added `applyInputLearnMixin` so class overrides survive). `sample-looper`'s multi-key `_bindJamKey` path left intact.
- [x] Extract `src/web-audio/midi/midi-output.js` (`MidiOutput`): batches via rAF, dedupes per LED index, tracks template, `queueLed`/`queueControlLed`/`flush`/`setLedsNow`/`send`/`invalidate`/`dispose`. Demo re-pointed to it (private copy + dead `LED_CSS` removed).
- [x] `wam-step-seq`: extracted `toggleStep(i)` + `_syncStepCell(i)`; click handler, `set steps`, and `rotate` all use them (removed 3× duplication).
- [ ] (Optional, deferred) Generalize the control registry so selects/toggles are mappable; apply dispatches the right event per control type.
- [x] Tests green: binding registry (+`migrateLegacyBinding`), `MidiInputSource`, `KeyboardInputSource`, `MidiOutput` batching/dedupe, `wam-step-seq` toggle, unified jam, rewritten `controls-midi` end-to-end. 186/187 (1 pre-existing unrelated failure).

**Phase 1 complete.** Foundation ready for Phase 2 (knob LED value mirror) + Phase 3 (sequencer button mapping).

### Phase 2 — Knob LED value mirror ✅
- [x] Learn layer emits source-agnostic `wam-binding-feedback` intents (`bound`/`unbound`/`value`) — keeps `controls-base`/`transport` device-free. (input-bindings.js + input-learn.js)
- [x] `LedFeedback` sink (`midi/led-feedback.js`) consumes intents, resolves via `findControl`, and drives LEDs through the batched `MidiOutput`: dim "bound" color on bind, `ledColorByPercent` on value, off on unbind. No-ops for non-LCXL bindings / no output.
- [x] Transport picker is now `sysex`-enabled and shares its `MIDIAccess` with `LedFeedback` (auto-selects the LCXL output, auto-tracks template from incoming channel).
- [x] `bindingFor()` now returns source-tagged (`source:"midi"`) bindings for consistency with the adapter-produced ones.
- [x] Tests: `led-feedback.test.js` (bound/value/unbound, non-LCXL no-op, template tracking, no-output). Batching/dedupe inherited from `MidiOutput`.
- [ ] **Hardware caveat to verify:** LCXL *knobs/faders* may have no physical LEDs (only buttons certainly do). The sysex is harmless either way; confirm on-device which controls actually light. See testing doc.

### Phase 3 — Sequencer button mapping ✅
- [x] **Jam-on-activate:** `controls-base.ensureJamBinding(fallback)`; playground assigns it on focus (instrument's default key, else its 1-based slot digit).
- [x] **Focus** (generic): panels dispatch `wam-instrument-focus` on pointerdown; `ui/focus-manager.js` tracks one focused panel, marks it `.wam-focused`, re-broadcasts `wam-instrument-focus-change`. `controls-base` exposes `get sequencer()`.
- [x] Map the 16 button notes → steps 0–15 (`midi/sequencer-hardware.js`); button press toggles the focused seq's step via `toggleStep`.
- [x] Mirror the focused pattern to button LEDs (active = dim green, inactive = off) with a bright playhead following `step-active` (new event from `wam-step-seq.setActiveStep`).
- [x] On focus change, repaint for the newly focused instrument; clear when none. Shares LedFeedback's single `MidiOutput` (one batched/deduped port).
- [x] Tests: `sequencer-hardware.test.js` (toggle, row mapping, releases/non-buttons ignored, pattern paint, playhead, clear-on-release) + `focus-manager.test.js`.

**Phase 3 complete.** All three feature phases done; remaining items are the deferred optional select/toggle learn and on-device verification.

### Phase 4 — Auto-map on activate ("device follows focus") ✅
When an instrument is focused, the LCXL knobs/faders auto-bind to its parameters so it's immediately tweakable. Manual MIDI learn stays persistent and wins; auto-map is the ephemeral convenience layer.

- [x] **Ephemeral binding layer.** `_autoBindings` in `InputLearnMixin`, separate from `_paramBindings`, applied on focus and cleared on blur; never serialized. `_applyInput` checks manual first, then auto (manual wins per param).
- [x] **Mapping strategy** (`midi/auto-map.js`): learnable params (registry order) → 24 knobs then 8 faders, skipping params already manually bound **and** controls already used by a manual binding (no double-driving). Uses the live template so channels match.
- [x] **On focus change**, clears the previous instrument's auto-map and applies the new one; auto-mapped controls light a **distinct color** (amber) vs. manual (red) via `LedFeedback`.
- [x] **Coexists with the sequencer buttons** — auto-map uses knobs/faders only; the 16 channel buttons stay with the sequencer mapping.
- [x] **Global toggle** — "Auto-map device to focused instrument" checkbox in the MIDI drawer panel (`autoMap.setEnabled`).
- [x] Tests: `auto-map.test.js` (order, skip manual params, skip used controls, overflow cap, focus lifecycle, disabled).

**Resolved:** distinct LED color (amber=auto, red=manual) instead of a screen badge; positional fill (not fixed fader roles) for v1.

**Phase 4 complete.** All planned LCXL phases done.

### Phase 5 — Polish
- [ ] Persist MIDI focus + per-instrument seq-button-enabled flag in `toJSON/fromJSON`.
- [ ] Handle template switches mid-session (LEDs re-paint on the now-displayed template).
- [ ] Update the LCXL tester demo to exercise both flows, or add a short how-to.

## Open questions / risks

- **One focus vs. per-row split** — could later split the two button rows (8 + 8) across two instruments. Out of scope for v1.
- **Channel/template scoping of bindings** — current bindings are channel-scoped; the focused-seq listener must match the focused template's channel. Confirm against the device's actual per-template channel.
- **Non-LCXL controllers** — all LED/feedback paths must no-op gracefully so the app still works with any class-compliant controller.

## Out of scope

- Two-way sync for arbitrary third-party controllers (LED feedback is LCXL-specific).
- Splitting button rows across instruments; pots-as-buttons; motorized/endless-encoder modes.

## Follow-ups after completion

- Move this plan to `exec-plans/completed/`; update [roadmap.md](../roadmap.md) and [tech-debt-tracker.md](../tech-debt-tracker.md).
- Note the consolidated mixin + `MidiOutput` in [ARCHITECTURE.md](../../ARCHITECTURE.md) and [FRONTEND.md](../../FRONTEND.md).
