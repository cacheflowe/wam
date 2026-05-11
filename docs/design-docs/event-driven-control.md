# Event-Driven Bidirectional Control

Status: Active
Owner: Justin Gitlin
Last Reviewed: 2026-05-11

## Decision

All parameter changes — whether from user interaction, automation (LFOs, envelopes), or external sources (MIDI, presets) — flow through the same UI event path. The control element is the single source of truth for parameter updates.

## Pattern

```
[Source] → knob.value = v → knob dispatches "knob-input" → controls-base handleInput → instrument.param = v
```

1. **Any source** that wants to change a parameter sets the knob/slider `.value` and dispatches its standard event (`knob-input` or `slider-input`).
2. **The delegated event listener** in `controls-base` catches the event and applies the value to the instrument.
3. **The instrument** never receives direct property writes from automation code.

## Consequences

- **One code path**: User drags, LFO ticks, preset loads, and future MIDI CC all use the same event flow. No parallel "back door" writes to instrument properties.
- **UI always reflects state**: Because the knob is updated first, the visual is always accurate. No sync bugs between UI and engine.
- **Decoupled automation**: An LFO module only needs a reference to the knob element, not the instrument. It doesn't import or know about the audio engine.
- **Composable**: Multiple automations could target different knobs independently. A future modulation matrix just maps sources to knob elements.
- **Event listeners work**: Any code listening for `knob-input` (e.g. `param-display` overlay) sees automation changes too.

## Rules

1. **Never set instrument properties directly from automation code.** Always go through the control element + event.
2. **Knob/slider `.value` setter must not dispatch events.** Only explicit `.dispatchEvent()` calls fire events, preventing infinite loops.
3. **Use `requestAnimationFrame` for continuous automation.** This rate-limits UI updates to display refresh and avoids flooding the event system.
4. **The control element is the authority.** If a knob says the cutoff is 800 Hz, the instrument's cutoff is 800 Hz.

## Applies To

- Filter LFO on acid synth (first implementation, 2026-05-11)
- Future: any parameter automation, MIDI CC mapping, envelope followers, modulation matrix, preset interpolation

## Related

- [controls-companion-pattern.md](controls-companion-pattern.md) — the controls/instrument split this builds on
- [instrument-architecture.md](instrument-architecture.md) — why instruments are plain classes
