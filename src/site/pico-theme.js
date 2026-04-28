/**
 * Pico CSS Theme Generator
 *
 * Generates all --pico-* color variables from seed colors using CSS color-mix().
 * Injects a <style> element that handles light, dark (auto), and dark (forced) selectors.
 *
 * The 3 standard Pico groups (primary, secondary, contrast) use Pico-specific
 * derivation recipes. Additional custom color groups use a general-purpose recipe
 * and get the same variable suffix pattern (e.g., --pico-admin-background).
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

/**
 * Derivation recipes per color group.
 * Each entry: [varSuffix, lightValue, darkValue]
 * BASE is the seed color placeholder, replaced at generation time.
 */
const primaryRecipes = (b) => [
  ["", mix(b, 70, "black"), mix(b, 90, "white")],
  ["-background", b, b],
  ["-border", `var(--pico-primary-background)`, `var(--pico-primary-background)`],
  ["-underline", mix(b, 50, "transparent", "srgb"), mix(b, 50, "transparent", "srgb")],
  ["-hover", mix(b, 28, "black"), mix(b, 88, "white")],
  ["-hover-background", mix(b, 86, "white"), mix(b, 40, "white")],
  ["-hover-border", `var(--pico-primary-hover-background)`, `var(--pico-primary-hover-background)`],
  ["-hover-underline", mix(b, 28, "transparent", "srgb"), mix(b, 50, "transparent", "srgb")],
  ["-focus", mix(b, 28, "transparent", "srgb"), mix(b, 32, "transparent", "srgb")],
  ["-inverse", "white", "white"],
];

const secondaryRecipes = (b) => [
  ["", b, mix(b, 12, "white")],
  ["-background", mix(b, 12, "white"), b],
  ["-border", mix(b, 20, "white"), mix(b, 90, "white")],
  ["-underline", mix(b, 50, "transparent", "srgb"), mix(b, 50, "transparent", "srgb")],
  ["-hover", mix(b, 45, "black"), "white"],
  ["-hover-background", `var(--pico-secondary-border)`, `var(--pico-secondary-border)`],
  ["-hover-border", mix(b, 24, "white"), mix(b, 80, "white")],
  ["-hover-underline", mix(b, 45, "transparent", "srgb"), mix(b, 50, "transparent", "srgb")],
  ["-focus", mix(b, 16, "transparent", "srgb"), mix(b, 16, "transparent", "srgb")],
  ["-inverse", "white", "white"],
];

const contrastRecipes = (b) => [
  ["", "white", b],
  ["-background", b, mix(b, 3, "white")],
  ["-border", b, `var(--pico-contrast-background)`],
  ["-underline", mix(b, 50, "transparent", "srgb"), mix(b, 50, "transparent", "srgb")],
  ["-hover", "white", "black"],
  ["-hover-background", mix(b, 75, "black"), "white"],
  ["-hover-border", `var(--pico-contrast-hover-background)`, "white"],
  ["-hover-underline", mix(b, 50, "transparent", "srgb"), mix(b, 50, "transparent", "srgb")],
  ["-focus", mix(b, 18, "transparent", "srgb"), mix(b, 20, "transparent", "srgb")],
  ["-inverse", "white", b],
];

/**
 * Generic recipe for custom color groups (admin, brand, success, etc.).
 * Follows the primary-style pattern: seed is the hero color, variants are
 * derived for both light and dark schemes.
 * @param {string} b - seed color
 * @param {string} name - group name (for var() self-references)
 */
const genericRecipes = (b, name) => [
  ["", mix(b, 70, "black"), mix(b, 90, "white")],
  ["-background", b, b],
  ["-border", `var(--pico-${name}-background)`, `var(--pico-${name}-background)`],
  ["-underline", mix(b, 50, "transparent", "srgb"), mix(b, 50, "transparent", "srgb")],
  ["-hover", mix(b, 28, "black"), mix(b, 88, "white")],
  ["-hover-background", mix(b, 86, "white"), mix(b, 40, "white")],
  ["-hover-border", `var(--pico-${name}-hover-background)`, `var(--pico-${name}-hover-background)`],
  ["-hover-underline", mix(b, 28, "transparent", "srgb"), mix(b, 50, "transparent", "srgb")],
  ["-focus", mix(b, 28, "transparent", "srgb"), mix(b, 32, "transparent", "srgb")],
  ["-inverse", "white", "white"],
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
  // text-selection from primary
  if (groups.find(([g]) => g === "primary")) {
    const [, primaryRecipes] = groups.find(([g]) => g === "primary");
    const base =
      schemeIndex === 0
        ? primaryRecipes[0][1] // light primary text color
        : primaryRecipes[0][2]; // dark primary text color
    lines.push(`  --pico-text-selection-color: color-mix(in srgb, ${base} 25%, transparent);`);
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
   * @returns {string} CSS text
   */
  static css({ primary, secondary, contrast, extras = {} } = {}) {
    // Skip groups that aren't provided — Pico's built-in defaults apply
    const groups = [];
    if (primary) groups.push(["primary", primaryRecipes(primary)]);
    if (secondary) groups.push(["secondary", secondaryRecipes(secondary)]);
    if (contrast) groups.push(["contrast", contrastRecipes(contrast)]);

    for (const [name, color] of Object.entries(extras)) {
      groups.push([name, genericRecipes(color, name)]);
    }

    const lightVars = buildSchemeBlock(groups, 0);
    const darkVars = buildSchemeBlock(groups, 1);

    let css = /*css*/ `
/* Pico theme — generated from seed colors */
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
