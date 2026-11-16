# Learnings — Testing

## Vitest: every suite fails with "0 tests" on Windows

**Symptom:** `npm test` reports all files failed, `Tests no tests`, with
`TypeError: Cannot read properties of undefined (reading 'config')` at the first
`describe(...)`, or `Vitest failed to find the runner`. Even pure-logic tests
(e.g. `scales.test.js`) fail, with `--environment node` too.

**Root cause:** The shell's working directory uses a lowercase drive letter
(`d:\workspace\wam`, which VS Code terminals and Git Bash often produce). Vitest
resolves its own modules under both `d:/` and `D:/`, so it loads two copies of
the runner, and the copy the test file imports never gets initialized.

**Fix:** Run from an uppercase drive path:

```powershell
Set-Location D:\workspace\wam; npm test
```

Still present in vitest 5.1.0 (checked 2026-11-16).

## Vite dev: `"./compile" is not exported … from package …\zod` after updating libs

**Symptom:** after `npm run update-libs`, `npm run dev` starts, then dies on first page load with
`Error during dependency optimization … "./compile" is not exported under the conditions … from package node_modules\zod`.

**Root cause:** p5 2.4.0 imports `zod/compile`, which only exists in zod ≥ 4.5.0, but p5 declares `zod: ^4.2.1`.
`npm update` / `npm-check-updates` bump direct deps (p5) and can leave the transitive zod pinned at an older
4.x in the lockfile (we had 4.4.3) — it satisfies p5's range on paper but lacks the export.

**Fix:** bump the transitive dep within range: `npm update zod` (→ 4.6.x). Check with `npm ls zod`.

**Related noise (harmless):** p5 2.4.0 fetches `cdn.jsdelivr.net/npm/p5@2.4.0/translations/<lang>/extracted.json`
at load for friendly-error translations; that file doesn't exist for 2.4.0, so the console shows a 404. p5
catches it and continues without translations — nothing to fix on our side.
