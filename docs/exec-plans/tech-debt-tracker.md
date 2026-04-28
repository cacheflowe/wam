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
| 7 | Break player load error not surfaced | Medium — fails silently if WAV fetch fails | Medium | TODO | — |

## Resolved Debt

| # | Item | Resolved | Notes |
|---|---|---|---|
| — | No initial docs | 2026-04-27 | Harness engineering doc system established |

## Adding Items

When you introduce a known shortcut or limitation, add it here. Include:
- **Impact**: what breaks or degrades if this isn't fixed
- **Priority**: High / Medium / Low
- **Owner**: who is responsible (or "TODO" if unassigned)
- **Target date**: deadline or "—" if none

Move to Resolved when the item is addressed with a PR.
