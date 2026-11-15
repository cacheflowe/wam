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
