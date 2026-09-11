import type { DefaultAppearance } from "@newsaas/ui/branding";

/**
 * Appearance persistence contract (design D6).
 *
 * Theming is client-local: a `dark` class on `<html>` plus a `localStorage`
 * entry, applied pre-paint by a parser-blocking bootstrap script and toggled
 * by the shell appearance control. No React state drives theme values — the
 * CSS cascade does.
 *
 * `"system"` defers to the tenant `defaultAppearance`, then to the OS
 * `prefers-color-scheme` value, then to the Core default (`light`).
 */

export const APPEARANCE_STORAGE_KEY = "newsaas.appearance";
export const DARK_CLASS = "dark";
export const SYSTEM_VALUE = "system";

// The bootstrap ships as raw parser-blocking JS, so it cannot import this
// module; the key is embedded from the constant to keep a single source.
const STORAGE_KEY_JSON = JSON.stringify(APPEARANCE_STORAGE_KEY);
const DARK_CLASS_JSON = JSON.stringify(DARK_CLASS);
const DARK_VALUE_JSON = JSON.stringify("dark");
const LIGHT_VALUE_JSON = JSON.stringify("light");

/**
 * Self-contained IIFE source for the inline `<script>` rendered as the first
 * body child of the root layout. It runs before first paint: stored `"dark"`
 * is applied immediately; any storage failure (private mode, disabled
 * storage) or other value silently falls back to light.
 */
export const appearanceBootstrapScript = `(function(){try{if(window.localStorage.getItem(${STORAGE_KEY_JSON})===${DARK_CLASS_JSON}){document.documentElement.classList.add(${DARK_CLASS_JSON});}}catch(e){}})();`;

/**
 * Tenant-aware parser-blocking bootstrap (design D8).
 *
 * Effective appearance resolves in this order:
 *
 *   explicit local `"light"` / `"dark"`
 *   > tenant `defaultAppearance`
 *   > OS `prefers-color-scheme: dark`
 *   > Core default (`light`)
 *
 * `defaultAppearance` is the tenant layer only. When it is `undefined` or
 * `"system"`, the script defers to the OS preference. The `localStorage` read
 * is isolated in its own `try` so inaccessible storage still falls through to
 * the tenant/OS fallback instead of aborting resolution.
 */
export function appearanceBootstrapScriptWithTenantDefault(
  defaultAppearance?: DefaultAppearance
): string {
  const tenantDefaultJson =
    defaultAppearance === undefined ? "undefined" : JSON.stringify(defaultAppearance);

  return `(function(){var s=null;try{s=window.localStorage.getItem(${STORAGE_KEY_JSON});}catch(e){}if(s===${DARK_VALUE_JSON}){document.documentElement.classList.add(${DARK_CLASS_JSON});return;}if(s===${LIGHT_VALUE_JSON}){return;}var td=${tenantDefaultJson};if(td===${DARK_VALUE_JSON}){document.documentElement.classList.add(${DARK_CLASS_JSON});return;}if(td===${LIGHT_VALUE_JSON}){return;}try{if(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches){document.documentElement.classList.add(${DARK_CLASS_JSON});}}catch(e){}})();`;
}
