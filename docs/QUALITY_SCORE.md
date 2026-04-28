# Quality Score

Owner: Justin Gitlin
Last reviewed: 2026-04-27

## Rubric

| Dimension | Score | Notes |
|---|---|---|
| **Architecture clarity** | ✅ High | Clear 4-layer model; single routing protocol throughout |
| **API consistency** | ✅ High | All instruments and effects share `connect()` / `input` / `trigger()` / `applyPreset()` |
| **State management** | ✅ High | Every Controls component has `toJSON()` / `fromJSON()` |
| **Audio quality** | ✅ High | Instruments tuned with musical presets; proper envelope scheduling |
| **Test coverage** | ❌ None | No test runner configured; no unit or integration tests |
| **TypeScript / JSDoc** | 🟡 Partial | Constructor params documented with JSDoc in most instruments; no full type coverage |
| **Bundle size** | ✅ Excellent | Zero runtime dependencies; only Vite dev tooling |
| **Documentation** | 🟡 Being established | WEB-AUDIO-LIBRARY.md exists; harness-engineering doc system in progress |
| **Error handling** | 🟡 Partial | AudioContext resume handled; AudioWorklet failure not gracefully caught |
| **Browser compatibility** | 🟡 Modern only | Requires Web Audio API Level 2, AudioWorklet, Web Components — Chrome/Firefox/Safari current |
| **Accessibility** | ❌ Minimal | No ARIA labels on sliders or step buttons; keyboard navigation not implemented |
| **Performance profiling** | 🟡 Untested | No formal profiling; fire-and-forget voice creation is the main risk at very high BPMs |

## Gaps and Owners

| Gap | Priority | Owner | Target |
|---|---|---|---|
| No test suite | High | TODO | See [tech-debt-tracker.md](exec-plans/tech-debt-tracker.md) |
| No accessibility / ARIA | Medium | TODO | — |
| AudioWorklet error recovery | Medium | TODO | — |
| Full JSDoc coverage | Low | TODO | — |

## Definition of Done (for a new instrument)

- [ ] Audio class with `trigger()`, `connect()`, `get input()`, `applyPreset()`, `static PRESETS`
- [ ] At least 3 presets, all musically useful
- [ ] `static SLIDER_DEFS` array covering all tweakable parameters
- [ ] Controls Web Component with `bind()`, `toJSON()`, `fromJSON()`, `step()`, `bpm` setter
- [ ] BPM propagated to FxUnit
- [ ] Waveform display connected to analyser
- [ ] Accent color passed through `--slider-accent` / `--fx-accent`
- [ ] Added to instrument inventory in [docs/BACKEND.md](BACKEND.md) and [ARCHITECTURE.md](../ARCHITECTURE.md)
- [ ] Feature spec created in [docs/product-specs/](product-specs/)
