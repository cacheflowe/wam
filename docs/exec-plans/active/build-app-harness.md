# Plan: Build App Harness (src/site/app.js)

Status: Not started
Owner: Justin Gitlin
Created: 2026-04-27

## Goal

Create `src/site/app.js` — the demo entry point that wires all instruments into a playable, interactive page. This is the first real "consumer" of the library.

## Context

All instruments and effects exist in `src/web-audio/` but there is no app layer yet. The `index.html` references `src/site/app.js` but the file does not exist.

## Scope

- AudioContext creation with user-gesture resume
- Master gain + global BPM control
- At minimum: Acid bass, 808, FM synth, kick, hihat instruments wired up
- Each instrument in its own panel with Controls Web Component
- Single shared WebAudioSequencer driving all instruments
- BPM slider propagated to all controls
- State save/restore via localStorage
- PicoCSS layout, dark mode

## Out of Scope

- MIDI input
- URL hash sharing (can be added later)
- Mobile-optimized layout (responsive layout is sufficient)

## Decision Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-04-27 | Start with a fixed set of instruments, not a dynamic "add instrument" UI | Simplest path to a working demo; dynamic instrument loading is a roadmap item |

## Follow-ups After Completion

- Move this plan to `exec-plans/completed/`
- Update [roadmap.md](../roadmap.md) to reflect completion
- Add the app layer to [ARCHITECTURE.md](../../../ARCHITECTURE.md)
