# Learnings — Web Component Controls

## Toggle registered twice flips state twice per click (FM Unison)

**Symptom** — The FM synth's Unison button appeared dead: clicking it never left `instrument.unison` true, no matter how many times you clicked.

**Root cause** — Two `click` listeners on the same button both wrote to the same state:

1. A bespoke `uniToggle.addEventListener("click", ...)` that flipped `this._instrument.unison` directly and set the button's `data-active` attribute.
2. The base-class listener added by `_registerToggle("unison", uniToggle)` (controls-base.js), which reads `!this._instrument[param]` **after** listener 1 has already mutated it, then dispatches the inverted value as a `knob-input` event that the instrument writes back.

Per click: custom listener sets `unison = true` → base listener computes `!true = false` → writes `false` back. The double flip cancels on every click, so the toggle could never latch on.

**Fix** — One state path per control. Remove the bespoke click listener entirely; keep only `_registerToggle` (knob-input event → `handleInput` → `_onSliderInput` → instrument). Sync the visual in `_onSliderInput` and `_syncExtraControls` instead — the acid-synth pattern:

```js
// in _onSliderInput(param, value):
if (param === "unison") {
  if (value) this._unisonToggle.setAttribute("data-active", "");
  else this._unisonToggle.removeAttribute("data-active");
}
```

Rule of thumb: a control element may have exactly one source of truth for its state. If the base class already wires a control (`_registerSelect`, `_registerToggle`, slider defs), never add a second listener that also writes instrument state — add visual sync hooks instead.

## `setAttribute(name, null)` stores the literal string `"null"`

**Symptom** — The FM Unison button rendered with the "active" style while unison was off; the DOM showed `data-active="null"`.

**Root cause** — `setAttribute` coerces its value with `String()`, so `setAttribute("data-active", null)` produces the attribute value `"null"`. The CSS rule is an **attribute-presence** selector (`.wam-toggle-btn[data-active]`), which matches any value — including `"null"` — so the button looked active.

**Fix** — Toggle presence, not value:

```js
if (active) el.setAttribute("data-active", "");
else el.removeAttribute("data-active");
```

(`toggleAttribute(name, boolean)` is equally safe.) Any code that "clears" an attribute with `setAttribute(name, null)` will silently keep it present.


## Playground: work lost on refresh (multi-tab clobbering, swallowed errors, broken share links)

**Symptom:** an unsaved song in the playground didn't survive a refresh.

**Root causes (any of):**
- All tabs autosaved to ONE localStorage key — a second playground tab (common with MIDI controllers, which deliver input to every tab, or with Sync test tabs) overwrote the song whenever it saved.
- `_saveToLocalStorage` caught *every* error ("quota or private mode — ignore"), so a throwing `toJSON()` silently disabled saving.
- `_applyState` had no per-instrument error handling: one throwing `fromJSON()` aborted the restore and left `_isLoadingState = true`, so no later edit was ever saved.
- Share links were `#s=…`, which the hash router treats as an element name (`createElement("s=…")` throws) — they never opened the playground.

**Fix:** `src/app/playground-autosave.js` (per-tab keys via sessionStorage, flush on pagehide, visible errors, backups, recovery list), `_applyState` try/finally + per-instrument isolation, share links as `#playground-app&s=…` (router maps legacy `#s=`).

**Testing gotcha:** when checking that a step toggle persisted, compare against the value *after* toggling — default patterns already have steps active, so a toggle can turn a step OFF.
