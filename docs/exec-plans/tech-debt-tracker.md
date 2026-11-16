# Tech Debt Tracker

Owner: Justin Gitlin
Last reviewed: 2026-04-27

## Active Debt Items

| # | Item | Impact | Priority | Owner | Target Date |
|---|---|---|---|---|---|
| 1 | No test suite | High — regressions are only caught manually | High | TODO | — |
| 2 | No accessibility / ARIA on controls | Medium — keyboard-only and screen-reader users cannot use the UI | Medium | TODO | — |
| 3 | AudioWorklet error recovery not implemented | Medium — pitch-shift / time-stretch fail silently | Medium | TODO | — |
| 4 | `src/site/app.js` not yet created | High — no runnable demo | High | Justin Gitlin | Near-term |
| 5 | Delay BPM-change click | Low — audible click when BPM changes while delay is active | Low | TODO | — |
| 6 | No JSDoc on effects classes | Low — instruments have JSDoc, effects mostly don't | Low | TODO | — |
| 8 | User presets + autosaved songs live in localStorage (~5 MB per origin) — move to IndexedDB | Low now — grows with saved presets/songs; a full store makes saves fail | Low | TODO | — |
| 9 | oversite ≤ 1.0.11 `AppStoreDistributed.set()` labels object/array values `"type": "number"` (upstream bug). wam sends `trigger` / `transport.beat` / `instruments.list` through `set()` regardless (API-only rule) | Low — JSON-parsing receivers read `value` fine; strongly-typed receivers (Java/Arduino) mis-type these keys | Low | Justin (oversite) | — |
| 10 | oversite: `AppStoreDistributed` has no `dispose()`/`close()`. Changing server/channel in the Sync drawer calls `SolidSocket.dispose()` on the old store, which stops reconnects but leaves its WebSocket open until page unload (a ghost client on the old server) | Low — idle connection, no messages sent | Low | Justin (oversite) | — |

## Resolved Debt

| # | Item | Resolved | Notes |
|---|---|---|---|
| — | No initial docs | 2026-04-27 | Harness engineering doc system established |
| 7 | Loop player load error not surfaced | 2026-05-04 | Controls now dispatch `controls-error` on failed loop file load; build/runtime failure mode is visible |

## Adding Items

When you introduce a known shortcut or limitation, add it here. Include:
- **Impact**: what breaks or degrades if this isn't fixed
- **Priority**: High / Medium / Low
- **Owner**: who is responsible (or "TODO" if unassigned)
- **Target date**: deadline or "—" if none

Move to Resolved when the item is addressed with a PR.
