# Core Beliefs

Status: Active | Owner: Justin Gitlin | Last reviewed: 2026-04-27

## Context

This library was created as a fresh-start migration of a growing web audio codebase. Before adding new instruments and apps, we needed to codify the non-negotiable constraints so future work stays coherent.

## Beliefs

### Zero runtime dependencies
**Decision**: The library must compile and run with no npm runtime packages. Vite (dev only) is acceptable; anything imported at runtime is not.

**Rationale**: Every dependency is a future compatibility problem, a bundle size tax, and a potential breaking change. The Web Audio API, Web Components, and standard DOM cover everything the library needs. External audio libraries (Tone.js, Howler.js) bring their own abstractions that fight ours.

**Consequences**: All synthesis, effects, and UI are hand-rolled. This takes more initial effort but produces code that's fully understandable and not subject to upstream API churn.

### Browser-native APIs over abstractions
**Decision**: Use `AudioContext`, `OscillatorNode`, `customElements.define`, etc. directly. Do not wrap them.

**Rationale**: Browser APIs are well-documented, stable, and accessible to any developer with Web Audio knowledge. A custom wrapper layer would need its own docs, its own bugs, and its own learning curve.

**Consequences**: Instrument code is verbose compared to Tone.js equivalents. The tradeoff is full transparency and zero magic.

### Vanilla JS, no TypeScript
**Decision**: All source files are `.js`. No TypeScript compilation step.

**Rationale**: The primary users are creative coders who may not have a TypeScript build setup. JSDoc comments provide parameter documentation. The codebase is small enough that type errors are caught quickly at runtime.

**Consequences**: No compile-time type checking. Instrument constructors and `trigger()` signatures are documented with JSDoc instead.

### Web Components without Shadow DOM
**Decision**: All components extend `HTMLElement` directly. Shadow DOM is not used unless a component already has it.

**Rationale**: CSS custom properties (`--slider-accent`, `--fx-accent`) cannot cross shadow DOM boundaries without explicit forwarding. Light DOM keeps the component tree inspectable in DevTools and allows parent CSS to theme child components naturally.

**Consequences**: Component CSS must use class-scoped selectors (`.wac-*`) rather than `:host` or scoped rules. CSS is injected once to `<head>` via the static-flag pattern to avoid duplication.
