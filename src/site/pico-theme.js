/**
 * Pico CSS Theme Generator
 *
 * Generates all --pico-* color variables from seed colors using CSS color-mix().
 * Injects a <style> element that handles light, dark (auto), and dark (forced) selectors.
 *
 * All color groups (primary, secondary, contrast, extras) use the same unified
 * recipe: seed as background, auto-contrast inverse text, and mode-adjusted
 * on-page text. Additional groups get the same variable suffix pattern (e.g., --pico-admin-background).
 *
 * Usage:
 *   import PicoTheme from "./pico-theme.js";
 *
 *   // Standard 3 Pico colors — applies to document.body
 *   PicoTheme.apply({ primary: "#d6bb66", secondary: "#1f2937", contrast: "#111827" });
 *
 *   // With custom color groups
 *   PicoTheme.apply({
 *     primary: "#d6bb66",
 *     extras: { admin: "#e74c3c", brand: "#8b5cf6" }
 *   });
 *
 *   // Apply to a specific container instead of body
 *   PicoTheme.apply({ primary: "#d6bb66" }, document.querySelector("#sidebar"));
 */

const LIGHT_SELECTOR = `[data-theme="light"],
:root:not([data-theme="dark"]),
:host:not([data-theme="dark"])`;

const DARK_AUTO_OPEN = `@media only screen and (prefers-color-scheme: dark) {
  :root:not([data-theme]),
  :host:not([data-theme])`;

const DARK_FORCED_SELECTOR = `[data-theme="dark"]`;

// color-mix shorthand: mix(base, 70, "black") → color-mix(in oklab, base 70%, black)
const mix = (base, pct, to, space = "oklab") => `color-mix(in ${space}, ${base} ${pct}%, ${to})`;

// Transparent alpha variant: oklch relative-color preserves hue/chroma/lightness, only adjusts opacity.
// Avoids color-mix(…, transparent) which mixes toward rgba(0,0,0,0) and shifts colors toward black.
const alpha = (base, pct) => `oklch(from ${base} l c h / ${pct / 100})`;

// Auto-contrast inverse: white text on dark/medium seeds, black text on very light seeds.
// Threshold 0.82 covers saturated mid-lights like gold (oklch L ≈ 0.80) — tune if needed.
const autoInverse = (b) => `oklch(from ${b} clamp(0, (l - 0.82) * -9999, 1) 0 0)`;

/**
 * Unified recipe for all color groups (primary, secondary, contrast, extras).
 * Each entry: [varSuffix, lightValue, darkValue]
 *
 * Background is the seed in both modes — color identity is stable across themes.
 * On-page text (links, outline borders) darkens in light mode and lightens in dark
 * mode so it reads against the page background, not the button background.
 * Text on the seed background (--*-inverse) auto-selects black or white via
 * oklch lightness so the recipe works for any seed without hardcoding "white".
 */
const colorRecipes = (b, name) => [
  ["", b, b],
  ["-background", b, b],
  ["-border", `var(--pico-${name}-background)`, `var(--pico-${name}-background)`],
  ["-underline", alpha(b, 50), alpha(b, 50)],
  ["-hover", mix(b, 28, "black"), mix(b, 88, "white")],
  ["-hover-background", mix(b, 86, "white"), mix(b, 40, "white")],
  ["-hover-border", `var(--pico-${name}-hover-background)`, `var(--pico-${name}-hover-background)`],
  ["-hover-underline", alpha(b, 28), alpha(b, 50)],
  ["-focus", alpha(b, 28), alpha(b, 32)],
  ["-inverse", autoInverse(b), autoInverse(b)],
];

function buildVars(recipes, group, schemeIndex) {
  return recipes
    .map(([suffix, light, dark]) => `  --pico-${group}${suffix}: ${schemeIndex === 0 ? light : dark};`)
    .join("\n");
}

function buildSchemeBlock(groups, schemeIndex) {
  const lines = [];
  for (const [group, recipes] of groups) {
    lines.push(`  /* ${group} */`);
    lines.push(buildVars(recipes, group, schemeIndex));
  }
  // global overrides that Pico defaults to secondary instead of primary
  const primaryGroup = groups.find(([g]) => g === "primary");
  if (primaryGroup) {
    const [, recipes] = primaryGroup;
    const base = schemeIndex === 0 ? recipes[0][1] : recipes[0][2];
    const bg = `var(--pico-primary-background)`;
    lines.push(`  --pico-range-thumb-color: ${bg};`);
    lines.push(`  --pico-range-thumb-active-color: ${bg};`);
    lines.push(`  --pico-progress-color: ${bg};`);
    lines.push(`  --pico-text-selection-color: ${alpha(base, 25)};`);
  }
  return lines.join("\n");
}

/**
 * Pico CSS Theme Generator.
 * Builds all --pico-* color variables from seed colors and injects them as a <style> element.
 */
class PicoTheme {
  /**
   * Generate the full CSS string for a Pico theme.
   * @param {object} [opts]
   * @param {string} [opts.primary]   - Primary seed color (hex). Omit to keep Pico default.
   * @param {string} [opts.secondary] - Secondary seed color. Omit to keep Pico default.
   * @param {string} [opts.contrast]  - Contrast seed color. Omit to keep Pico default.
   * @param {Object<string, string>} [opts.extras] - Additional named color groups
   * @param {string} [opts.accentColor] - Global brand accent color (applies to HTML accent-color elements)
   * @param {string} [opts.borderRadius] - Overrides --pico-border-radius
   * @param {string} [opts.fontFamily] - Overrides --pico-font-family
   * @param {string} [opts.spacing] - Overrides --pico-spacing
   * @param {string} [opts.transition] - Overrides --pico-transition
   * @param {string} [opts.borderWidth] - Overrides --pico-border-width
   * @param {string} [opts.outlineWidth] - Overrides --pico-outline-width
   * @returns {string} CSS text
   */
  static css({ primary, secondary, contrast, extras = {}, accentColor, ...rest } = {}) {
    // Skip groups that aren't provided — Pico's built-in defaults apply
    const groups = [];
    if (primary) groups.push(["primary", colorRecipes(primary, "primary")]);
    if (secondary) groups.push(["secondary", colorRecipes(secondary, "secondary")]);
    if (contrast) groups.push(["contrast", colorRecipes(contrast, "contrast")]);

    for (const [name, color] of Object.entries(extras)) {
      groups.push([name, colorRecipes(color, name)]);
    }

    const lightVars = buildSchemeBlock(groups, 0);
    const darkVars = buildSchemeBlock(groups, 1);

    const styleMap = {
      fontFamily: "--pico-font-family",
      fontFamilyEmoji: "--pico-font-family-emoji",
      fontFamilySansSerif: "--pico-font-family-sans-serif",
      fontFamilyMonospace: "--pico-font-family-monospace",
      lineHeight: "--pico-line-height",
      fontWeight: "--pico-font-weight",
      fontSize: "--pico-font-size",
      fontSizeScale: "--font-size-scale", // Used to relative-scale fonts adaptively instead of clobbering responsive media queries
      borderRadius: "--pico-border-radius",
      borderWidth: "--pico-border-width",
      outlineWidth: "--pico-outline-width",
      transition: "--pico-transition",
      spacing: "--pico-spacing",
      typographySpacingVertical: "--pico-typography-spacing-vertical",
      blockSpacingVertical: "--pico-block-spacing-vertical",
      blockSpacingHorizontal: "--pico-block-spacing-horizontal",
      gridColumnGap: "--pico-grid-column-gap",
      gridRowGap: "--pico-grid-row-gap",
      formElementSpacingVertical: "--pico-form-element-spacing-vertical",
      formElementSpacingHorizontal: "--pico-form-element-spacing-horizontal",
    };

    const rootVars = [];
    let hasFontSizeScale = false;
    for (const [key, val] of Object.entries(rest)) {
      if (val !== undefined && val !== null) {
        if (styleMap[key]) {
          rootVars.push(`  ${styleMap[key]}: ${val};`);
          if (key === "fontSizeScale") {
            hasFontSizeScale = true;
          }
        } else if (key.startsWith("--")) {
          rootVars.push(`  ${key}: ${val};`);
        }
      }
    }

    let css = "/* Pico theme — generated from seed colors */\n";

    if (rootVars.length > 0) {
      css += /*css*/ `:root, :host {
${rootVars.join("\n")}
}

`;
      if (hasFontSizeScale) {
        // Redefine standard html/root font-size dynamically usingcalc on the default ratio percentage variable
        css += /*css*/ `:root {
  font-size: calc(var(--pico-font-size) * var(--font-size-scale));
}

`;
      }
    }

    css += /*css*/ `
${LIGHT_SELECTOR} {
${lightVars}
}

${DARK_AUTO_OPEN} {
${darkVars}
  }
}

${DARK_FORCED_SELECTOR} {
${darkVars}
}`;

    if (accentColor) {
      css += /*css*/ `

progress,
[type=checkbox],
[type=radio],
[type=range] {
  accent-color: ${accentColor};
}`;
    }

    // Generate [data-color="name"] scoping rules for each extra group.
    // These remap --pico-primary-* (and form element vars) so that any
    // container with data-color="name" recolors its Pico children.
    for (const name of Object.keys(extras)) {
      const v = (suffix) => `var(--pico-${name}${suffix})`;
      css += /*css*/ `

/* Scoped color: ${name} */
[data-color="${name}"] {
  --pico-primary: ${v("")};
  --pico-primary-background: ${v("-background")};
  --pico-primary-border: ${v("-border")};
  --pico-primary-underline: ${v("-underline")};
  --pico-primary-hover: ${v("-hover")};
  --pico-primary-hover-background: ${v("-hover-background")};
  --pico-primary-hover-border: ${v("-hover-border")};
  --pico-primary-hover-underline: ${v("-hover-underline")};
  --pico-primary-focus: ${v("-focus")};
  --pico-primary-inverse: ${v("-inverse")};
  --pico-form-element-active-border-color: ${v("-background")};
  --pico-form-element-focus-color: ${v("-focus")};
  --pico-switch-checked-background-color: ${v("-background")};
  --pico-range-thumb-color: ${v("-background")};
  --pico-range-thumb-active-color: ${v("-background")};
  --pico-progress-color: ${v("-background")};
  --pico-text-selection-color: ${v("-focus")};
}`;
    }

    return css;
  }

  /**
   * Inject a Pico theme as a <style> element into a container.
   * Replaces any previously injected theme in that container.
   * @param {object} [opts] - Same as PicoTheme.css()
   * @param {HTMLElement} [container=document.body] - Element to append the <style> to
   */
  static apply(opts, container = document.body) {
    const id = "pico-theme-overrides";
    let el = container.querySelector(`#${id}`);
    if (!el) {
      el = document.createElement("style");
      el.id = id;
      container.appendChild(el);
    }
    el.textContent = PicoTheme.css(opts);
  }

  /**
   * Remove a previously injected Pico theme <style> element.
   * @param {HTMLElement} [container=document.body] - Container to remove from
   */
  static remove(container = document.body) {
    const el = container.querySelector("#pico-theme-overrides");
    if (el) el.remove();
  }
}

export default PicoTheme;
