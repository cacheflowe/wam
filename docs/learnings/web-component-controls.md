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
