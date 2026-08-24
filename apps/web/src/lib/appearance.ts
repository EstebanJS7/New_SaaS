/**
 * Appearance persistence contract (design D6).
 *
 * Phase A keeps theming client-local: a `dark` class on `<html>` plus a
 * `localStorage` entry, applied pre-paint by a parser-blocking bootstrap
 * script and toggled by the shell appearance control. No React state drives
 * theme values — the CSS cascade does.
 *
 * `"system"` is schema-valid but intentionally inert in Phase A: with no
 * stored entry (or an unreadable/corrupted one) the app mounts light.
 */

export const APPEARANCE_STORAGE_KEY = "newsaas.appearance";
export const DARK_CLASS = "dark";

// The bootstrap ships as raw parser-blocking JS, so it cannot import this
// module; the key is embedded from the constant to keep a single source.
const STORAGE_KEY_JSON = JSON.stringify(APPEARANCE_STORAGE_KEY);
const DARK_CLASS_JSON = JSON.stringify(DARK_CLASS);

/**
 * Self-contained IIFE source for the inline `<script>` rendered as the first
 * body child of the root layout. It runs before first paint: stored `"dark"`
 * is applied immediately; any storage failure (private mode, disabled
 * storage) or other value silently falls back to light.
 */
export const appearanceBootstrapScript = `(function(){try{if(window.localStorage.getItem(${STORAGE_KEY_JSON})===${DARK_CLASS_JSON}){document.documentElement.classList.add(${DARK_CLASS_JSON});}}catch(e){}})();`;
