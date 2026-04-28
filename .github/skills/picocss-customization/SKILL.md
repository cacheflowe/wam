---
name: picocss-customization
description: Guide for customizing Pico CSS variables and color schemes. Use this when updating theme variables or styling the web UI.
---

# Pico CSS Color Customization

How to customize colors in a site that uses Pico CSS via CSS custom properties (variables).

## Documentation Reference

- **Pico CSS Variables**: https://picocss.com/docs/css-variables
- **Pico SASS Customization**: https://picocss.com/docs/sass

## Key Concepts

- All Pico CSS variables are prefixed with `--pico-` to avoid collisions.
- Override variables on `:root` for global changes, or on specific selectors for local changes.
- Color variables are **scheme-dependent** — they must be defined separately for light and dark modes.
- Style variables (font, spacing, border-radius, etc.) are scheme-independent and go on `:root, :host`.

## Recommended: Seed Color + `color-mix()` Approach

Instead of hardcoding every Pico color variant, define **seed colors** and derive all variants using CSS `color-mix()`. The JS theme generator (`src/util/pico-theme.js`) is the preferred method — it handles all derivation and selector duplication automatically. See the [JavaScript Theme Generator](#javascript-theme-generator-recommended-for-deployments) section below.

For reference, the underlying CSS `color-mix()` patterns are documented here in case you need pure-CSS overrides without the JS generator.

### Why `color-mix()`?

- **Single source of truth** — change one seed color and all variants update automatically
- **Perceptually uniform** — `oklab` color space produces better-looking mixes than `srgb` for opaque blends
- **No build step** — works natively in CSS, no SASS/preprocessor needed
- **Per-deployment theming** — swap 3 values to retheme an entire installation

### Light Theme Derivation

```css
[data-theme="light"],
:root:not([data-theme="dark"]),
:host:not([data-theme="dark"]) {
  /* Primary — seed is used directly for bg/border; darken for text, lighten for hover-bg */
  --pico-primary: color-mix(in oklab, var(--primary-base) 70%, black);
  --pico-primary-background: var(--primary-base);
  --pico-primary-border: var(--primary-base);
  --pico-primary-underline: color-mix(in srgb, var(--primary-base) 50%, transparent);
  --pico-primary-hover: color-mix(in oklab, var(--primary-base) 28%, black);
  --pico-primary-hover-background: color-mix(in oklab, var(--primary-base) 86%, white);
  --pico-primary-hover-border: color-mix(in oklab, var(--primary-base) 86%, white);
  --pico-primary-focus: color-mix(in srgb, var(--primary-base) 28%, transparent);
  --pico-primary-inverse: color-mix(in oklab, var(--primary-base) 18%, black);

  /* Secondary — lighter bg, darker text */
  --pico-secondary: var(--secondary-base);
  --pico-secondary-background: color-mix(in oklab, var(--secondary-base) 12%, white);
  --pico-secondary-border: color-mix(in oklab, var(--secondary-base) 20%, white);
  --pico-secondary-underline: color-mix(in srgb, var(--secondary-base) 50%, transparent);
  --pico-secondary-hover: color-mix(in oklab, var(--secondary-base) 45%, black);
  --pico-secondary-hover-background: var(--pico-secondary-border);
  --pico-secondary-hover-border: color-mix(in oklab, var(--secondary-base) 24%, white);
  --pico-secondary-focus: color-mix(in srgb, var(--secondary-base) 16%, transparent);
  --pico-secondary-inverse: white;

  /* Contrast — near-black bg, white text */
  --pico-contrast: white;
  --pico-contrast-background: var(--contrast-base);
  --pico-contrast-border: var(--contrast-base);
  --pico-contrast-hover: white;
  --pico-contrast-hover-background: color-mix(in oklab, var(--contrast-base) 75%, black);
  --pico-contrast-hover-border: color-mix(in oklab, var(--contrast-base) 75%, black);
  --pico-contrast-focus: color-mix(in srgb, var(--contrast-base) 18%, transparent);
  --pico-contrast-inverse: white;
}
```

### Dark Theme Derivation

```css
/* Dark mode (Auto) */
@media only screen and (prefers-color-scheme: dark) {
  :root:not([data-theme]),
  :host:not([data-theme]) {
    /* Primary — lighten for hover, keep seed for bg */
    --pico-primary: color-mix(in oklab, var(--primary-base) 90%, white);
    --pico-primary-background: var(--primary-base);
    --pico-primary-border: var(--primary-base);
    --pico-primary-underline: color-mix(in srgb, var(--primary-base) 50%, transparent);
    --pico-primary-hover: color-mix(in oklab, var(--primary-base) 88%, white);
    --pico-primary-hover-background: color-mix(in oklab, var(--primary-base) 40%, white);
    --pico-primary-hover-border: color-mix(in oklab, var(--primary-base) 90%, white);
    --pico-primary-focus: color-mix(in srgb, var(--primary-base) 32%, transparent);
    --pico-primary-inverse: color-mix(in oklab, var(--primary-base) 18%, black);

    /* Secondary — flip: dark bg, light text/borders */
    --pico-secondary: color-mix(in oklab, var(--secondary-base) 12%, white);
    --pico-secondary-background: var(--secondary-base);
    --pico-secondary-border: color-mix(in oklab, var(--secondary-base) 90%, white);
    --pico-secondary-underline: color-mix(in srgb, var(--secondary-base) 50%, transparent);
    --pico-secondary-hover: white;
    --pico-secondary-hover-background: var(--pico-secondary-border);
    --pico-secondary-hover-border: color-mix(in oklab, var(--secondary-base) 80%, white);
    --pico-secondary-focus: color-mix(in srgb, var(--secondary-base) 16%, transparent);
    --pico-secondary-inverse: white;

    /* Contrast — invert: light bg, dark text */
    --pico-contrast: var(--contrast-base);
    --pico-contrast-background: color-mix(in oklab, var(--contrast-base) 3%, white);
    --pico-contrast-border: var(--pico-contrast-background);
    --pico-contrast-hover: black;
    --pico-contrast-hover-background: white;
    --pico-contrast-hover-border: white;
    --pico-contrast-focus: color-mix(in srgb, var(--contrast-base) 20%, transparent);
    --pico-contrast-inverse: var(--contrast-base);
  }
}

/* Dark mode (Forced) — duplicate the same overrides */
[data-theme="dark"] {
  /* ... same variables as the @media block above ... */
}
```

### `color-mix()` Recipes

| Intent | Recipe | Color Space |
|--------|--------|-------------|
| Darken for text | `color-mix(in oklab, var(--base) 70%, black)` | oklab |
| Lighten for hover bg | `color-mix(in oklab, var(--base) 86%, white)` | oklab |
| Strong darken | `color-mix(in oklab, var(--base) 28%, black)` | oklab |
| Near-white tint | `color-mix(in oklab, var(--base) 12%, white)` | oklab |
| Focus ring (transparent) | `color-mix(in srgb, var(--base) 28%, transparent)` | srgb |
| Underline (transparent) | `color-mix(in srgb, var(--base) 50%, transparent)` | srgb |

> **Note:** Use `oklab` for opaque blends (perceptually uniform). Use `srgb` when mixing toward `transparent` (oklab + transparent can produce unexpected mid-tones).

### Alternative Approaches

If `color-mix()` browser support is a concern (unlikely for Oversite's target environments), alternatives include:

- **Pico's built-in themes** — pick a preset from https://picocss.com/docs/css-variables and use it as-is
- **Pico SASS customization** — override SASS variables at build time (but Oversite avoids build steps)
- **Manual hardcoding** — specify every hex value by hand (works, but tedious and error-prone to update)

The seed + `color-mix()` approach is recommended because it aligns with Oversite's no-build-step constraint while keeping theming maintainable.

## JavaScript Theme Generator (Recommended for Deployments)

For even less code, use `src/util/pico-theme.js` — a utility that generates all Pico color variables from seed colors programmatically. It handles all 3 selector patterns (light, dark auto, dark forced) from compact recipe tables.

### Basic Usage

```js
import PicoTheme from "./src/util/pico-theme.js";

// Apply with explicit hex colors (injects <style> into document.body)
PicoTheme.apply({
  primary: "#d6bb66",
  secondary: "#1f2937",
  contrast: "#111827",
});

// Apply to a specific container instead of body
PicoTheme.apply({ primary: "#d6bb66" }, document.querySelector("#sidebar"));
```

### Custom Color Groups

Pass additional named colors via `extras` to generate `--pico-{name}-*` variables that follow the same suffix pattern as the built-in groups:

```js
PicoTheme.apply({
  primary: "#d6bb66",
  secondary: "#1f2937",
  contrast: "#111827",
  extras: {
    admin: "#e74c3c",    // generates --pico-admin, --pico-admin-background, etc.
    brand: "#8b5cf6",    // generates --pico-brand, --pico-brand-background, etc.
    success: "#22c55e",  // generates --pico-success, --pico-success-background, etc.
  }
});
```

Each custom group gets the full set of derived variables:

| Variable | Example for `admin: "#e74c3c"` |
|---|---|
| `--pico-admin` | Text/link color (darkened in light, lightened in dark) |
| `--pico-admin-background` | Seed color directly |
| `--pico-admin-border` | Points to `-background` |
| `--pico-admin-underline` | Semi-transparent seed |
| `--pico-admin-hover` | Darkened/lightened for scheme |
| `--pico-admin-hover-background` | Lighter/brighter variant |
| `--pico-admin-hover-border` | Points to `-hover-background` |
| `--pico-admin-focus` | Semi-transparent focus ring |
| `--pico-admin-inverse` | Text color on the background |

### Scoped Colors with `data-color`

Each extra also generates a `[data-color="{name}"]` CSS rule that remaps all relevant Pico primary/form variables. Add the attribute to any container element to recolor everything inside — no manual CSS needed:

```html
<!-- All buttons inside become amber -->
<nav data-color="warm">
  <app-store-button key="state" value="go">Go</app-store-button>
  <app-store-button key="state" value="stop">Stop</app-store-button>
</nav>

<!-- All inputs inside get cyan focus/active states -->
<div data-color="cool">
  <app-store-textfield key="name" value=""></app-store-textfield>
  <app-store-slider key="volume" value="0" max="1"></app-store-slider>
  <app-store-checkbox key="enabled" toggle>Enabled</app-store-checkbox>
</div>
```

The generated scoping rule remaps these Pico variables:
- `--pico-primary-*` (all 9 suffixes) — buttons, links
- `--pico-form-element-active-border-color` — input focus border
- `--pico-form-element-focus-color` — input focus ring
- `--pico-switch-checked-background-color` — toggle switches
- `--pico-range-thumb-color` — range sliders
- `--pico-text-selection-color` — text highlight

### Partial Overrides

Only pass the groups you want to customize — omitted groups keep Pico's built-in defaults:

```js
// Only override primary; secondary and contrast stay as Pico defaults
PicoTheme.apply({ primary: "#d6bb66" });

// Only add extras, no base color changes
PicoTheme.apply({ extras: { admin: "#e74c3c" } });
```

### Getting CSS Without Injecting

```js
import PicoTheme from "./src/util/pico-theme.js";

// Returns full CSS text: theme variables + [data-color] scoping rules
const css = PicoTheme.css({ primary: "#d6bb66", extras: { warm: "#f59e0b" } });
console.log(css);
```

### Removing an Injected Theme

```js
// Remove from document.body (default)
PicoTheme.remove();

// Remove from a specific container
PicoTheme.remove(document.querySelector("#sidebar"));
```

### Why JS Over Pure CSS?

| | Pure CSS | JS Generator |
|---|---|---|
| Lines of code | ~90 (3 groups × 2 schemes + forced dark) | ~3 (one function call) |
| Forced `[data-theme="dark"]` duplication | Manual copy-paste | Handled automatically |
| Runtime theming | No — seed must be in CSS | Yes — pass any color at runtime |
| Deployment customization | Edit stylesheet | Pass config object |
| Custom color groups | 20+ lines each, manually written | One entry in `extras` map |
| Scoped coloring | Manual `[data-color]` CSS rules | Auto-generated per extra |

### Improvements Over the CSS-Only Approach

The JS generator incorporates these fixes based on Pico's actual variable patterns:

1. **`-border` and `-hover-border` use `var()` references** — Pico natively points these to `-background` and `-hover-background`. The generator does the same instead of redundant `color-mix()` calls.
2. **`--pico-text-selection-color` is auto-derived** from the primary color.
3. **`--pico-primary` text color** is included for light mode (darkened from seed).
4. **`--pico-*-underline` variables** are generated for all groups.
5. **Unlimited custom color groups** via `extras` — each gets the full variable set with proper light/dark derivation.
6. **Auto-generated `[data-color]` scoping** — each extra emits a CSS rule that remaps Pico's primary and form variables, so `<div data-color="admin">` just works with no manual CSS.

## Color Scheme Selectors

When overriding color variables, use the correct selector pattern for each scheme. Both light and dark overrides are required for full theme support.

### Light Mode

```css
/* Light color scheme (Default) */
/* Can be forced with data-theme="light" */
[data-theme="light"],
:root:not([data-theme="dark"]),
:host:not([data-theme="dark"]) {
  /* your light color overrides here */
}
```

### Dark Mode

Dark mode requires **two** declarations:

1. An `@media` query for users with OS-level dark mode (auto-detection).
2. A `[data-theme="dark"]` block for forced/manual dark mode.

```css
/* Dark color scheme (Auto) */
/* Automatically enabled if user has dark mode enabled in OS */
@media only screen and (prefers-color-scheme: dark) {
  :root:not([data-theme]),
  :host:not([data-theme]) {
    /* your dark color overrides here */
  }
}

/* Dark color scheme (Forced) */
/* Enabled when manually set with data-theme="dark" */
[data-theme="dark"] {
  /* same dark color overrides here (duplicated) */
}
```

## Primary Color Variables (Manual Override)

If you need to override only the primary color without the full seed system, override all related variables together:

| Variable | Purpose |
|----------|---------|
| `--pico-primary` | Main text/link color for primary elements |
| `--pico-primary-background` | Background of primary buttons, switches, progress bars |
| `--pico-primary-border` | Border of primary buttons (usually matches background) |
| `--pico-primary-underline` | Underline color on primary links |
| `--pico-primary-hover` | Text/link color on hover |
| `--pico-primary-hover-background` | Button background on hover |
| `--pico-primary-hover-border` | Button border on hover |
| `--pico-primary-focus` | Focus ring color (use semi-transparent) |
| `--pico-primary-inverse` | Text color on primary background (usually `#fff`) |
| `--pico-text-selection-color` | Text highlight color (use semi-transparent) |

### Example: Orange Primary Color

```css
/* Light mode */
[data-theme=light],
:root:not([data-theme=dark]),
:host:not([data-theme=dark]) {
  --pico-text-selection-color: rgba(244, 93, 44, 0.25);
  --pico-primary: #bd3c13;
  --pico-primary-background: #d24317;
  --pico-primary-underline: rgba(189, 60, 19, 0.5);
  --pico-primary-hover: #942d0d;
  --pico-primary-hover-background: #bd3c13;
  --pico-primary-focus: rgba(244, 93, 44, 0.5);
  --pico-primary-inverse: #fff;
}

/* Dark mode (Auto) */
@media only screen and (prefers-color-scheme: dark) {
  :root:not([data-theme]),
  :host:not([data-theme]) {
    --pico-text-selection-color: rgba(245, 107, 61, 0.1875);
    --pico-primary: #f56b3d;
    --pico-primary-background: #d24317;
    --pico-primary-underline: rgba(245, 107, 61, 0.5);
    --pico-primary-hover: #f8a283;
    --pico-primary-hover-background: #e74b1a;
    --pico-primary-focus: rgba(245, 107, 61, 0.375);
    --pico-primary-inverse: #fff;
  }
}

/* Dark mode (Forced) */
[data-theme=dark] {
  --pico-text-selection-color: rgba(245, 107, 61, 0.1875);
  --pico-primary: #f56b3d;
  --pico-primary-background: #d24317;
  --pico-primary-underline: rgba(245, 107, 61, 0.5);
  --pico-primary-hover: #f8a283;
  --pico-primary-hover-background: #e74b1a;
  --pico-primary-focus: rgba(245, 107, 61, 0.375);
  --pico-primary-inverse: #fff;
}
```

## Secondary & Contrast Color Variables

The same pattern applies to secondary and contrast colors:

| Color Group | Prefix | Purpose |
|-------------|--------|---------|
| **Secondary** | `--pico-secondary-*` | Secondary buttons, links with `.secondary` class |
| **Contrast** | `--pico-contrast-*` | High-contrast elements, links with `.contrast` class |

Each group has the same set of sub-variables as primary: base, `-background`, `-border`, `-underline`, `-hover`, `-hover-background`, `-hover-border`, `-focus`, `-inverse`.

## Surface & Background Colors

| Variable | Purpose |
|----------|---------|
| `--pico-background-color` | Page background |
| `--pico-color` | Default text color |
| `--pico-muted-color` | Subdued text (placeholders, captions) |
| `--pico-muted-border-color` | Light borders, separators |
| `--pico-card-background-color` | Card backgrounds |
| `--pico-card-border-color` | Card borders |
| `--pico-card-sectioning-background-color` | Card header/footer backgrounds |
| `--pico-code-background-color` | Code block backgrounds |
| `--pico-code-color` | Code text color |
| `--pico-dropdown-background-color` | Dropdown menu backgrounds |
| `--pico-dropdown-border-color` | Dropdown borders |
| `--pico-dropdown-hover-background-color` | Dropdown item hover |
| `--pico-modal-overlay-background-color` | Modal backdrop overlay |

## Heading Colors

Each heading level has its own color variable, creating a subtle hierarchy:

| Variable | Default (Light) | Default (Dark) |
|----------|-----------------|----------------|
| `--pico-h1-color` | `#2d3138` | `#f0f1f3` |
| `--pico-h2-color` | `#373c44` | `#e0e3e7` |
| `--pico-h3-color` | `#424751` | `#c2c7d0` |
| `--pico-h4-color` | `#4d535e` | `#b3b9c5` |
| `--pico-h5-color` | `#5c6370` | `#a4acba` |
| `--pico-h6-color` | `#646b79` | `#8891a4` |

## Form Element Colors

| Variable | Purpose |
|----------|---------|
| `--pico-form-element-background-color` | Input/select/textarea background |
| `--pico-form-element-border-color` | Input border |
| `--pico-form-element-color` | Input text color |
| `--pico-form-element-placeholder-color` | Placeholder text |
| `--pico-form-element-active-background-color` | Focused input background |
| `--pico-form-element-active-border-color` | Focused input border |
| `--pico-form-element-focus-color` | Focus ring |
| `--pico-form-element-valid-border-color` | Valid input border |
| `--pico-form-element-invalid-border-color` | Invalid input border |
| `--pico-switch-background-color` | Toggle switch track (off) |
| `--pico-switch-checked-background-color` | Toggle switch track (on) |
| `--pico-range-thumb-color` | Range slider thumb |

## Miscellaneous Colors

| Variable | Purpose |
|----------|---------|
| `--pico-mark-background-color` | `<mark>` highlight background |
| `--pico-mark-color` | `<mark>` text color |
| `--pico-ins-color` | `<ins>` inserted text color |
| `--pico-del-color` | `<del>` deleted text color |
| `--pico-blockquote-border-color` | Blockquote left border |
| `--pico-table-border-color` | Table borders |
| `--pico-table-row-stripped-background-color` | Striped table row background |
| `--pico-progress-background-color` | Progress bar track |
| `--pico-progress-color` | Progress bar fill |
| `--pico-tooltip-background-color` | Tooltip background |
| `--pico-tooltip-color` | Tooltip text |
| `--pico-box-shadow` | Default box shadow (cards, dropdowns) |
| `--pico-loading-spinner-opacity` | Loading spinner opacity |

## Style Variables (Scheme-Independent)

These go on `:root, :host` without color scheme selectors:

```css
:root, :host {
  --pico-font-family: system-ui, sans-serif;
  --pico-font-size: 100%;          /* responsive, scales up at breakpoints */
  --pico-line-height: 1.5;
  --pico-font-weight: 400;
  --pico-border-radius: 0.25rem;
  --pico-border-width: 0.0625rem;
  --pico-outline-width: 0.125rem;
  --pico-transition: 0.2s ease-in-out;
  --pico-spacing: 1rem;            /* base for padding/margin/gaps */
  --pico-block-spacing-vertical: var(--pico-spacing);
  --pico-block-spacing-horizontal: var(--pico-spacing);
  --pico-form-element-spacing-vertical: 0.75rem;
  --pico-form-element-spacing-horizontal: 1rem;
}
```

## Best Practices

- **Always override both light and dark** color schemes to avoid mismatched themes.
- **Dark mode values must appear twice**: once in `@media (prefers-color-scheme: dark)` and once in `[data-theme=dark]`.
- Use **semi-transparent rgba values** for focus, selection, and underline colors.
- In dark mode, make primary colors **lighter** than in light mode for adequate contrast.
- The `-border` variables typically reference `-background` via `var()` — only override them if you want distinct borders.
- To customize the prefix or do deeper modifications, recompile with SASS: https://picocss.com/docs/sass

## Global Button Overrides

Override the appearance of **every** Pico button variant (including submit, reset, role-based, and file inputs) with a single rule. Pico's actual button selector is:

```
button, [type=button], [type=submit], [type=reset], [role=button], [type=file]::file-selector-button
```

### Using Pico Variables (Preferred)

Override Pico's own variables on the button selector. These cascade correctly to all states and outlines:

```css
:is(button, [type="button"], [type="submit"], [type="reset"], [role="button"]),
[type="file"]::file-selector-button {
  --pico-border-radius: 999px;
  --pico-font-weight: 700;
  --pico-form-element-spacing-horizontal: 1.1rem;
  --pico-form-element-spacing-vertical: 0.8rem;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
```

### Using Direct Properties

For one-off overrides where you don't need variable cascade:

```css
:is(button, [type="button"], [type="submit"], [type="reset"], [role="button"]),
[type="file"]::file-selector-button {
  border-radius: 999px;
  font-size: 0.7rem;
  letter-spacing: 0.02em;
}
```

> **Note:** `[type="file"]::file-selector-button` is a pseudo-element and **cannot** be inside `:is()` — it must be a separate selector in the list. Pico handles this the same way.
