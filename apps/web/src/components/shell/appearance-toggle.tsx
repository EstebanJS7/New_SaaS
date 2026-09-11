"use client";

import { useEffect, useState, type JSX } from "react";
import { Button } from "@newsaas/ui/components/ui/button";
import type { DefaultAppearance } from "@newsaas/ui/branding";
import { APPEARANCE_STORAGE_KEY, DARK_CLASS, SYSTEM_VALUE } from "@/lib/appearance";

function isValidAppearance(value: string | null): value is DefaultAppearance {
  return value === "light" || value === "dark" || value === SYSTEM_VALUE;
}

/**
 * Reads the stored appearance, tolerating unavailable storage (private mode,
 * disabled storage APIs return/throw inconsistently across browsers).
 */
function readStoredAppearance(): DefaultAppearance | null {
  try {
    const value = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
    return isValidAppearance(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Persists the appearance, ignoring failures: an unwritable store only costs
 * persistence across visits — the toggle still works for this session.
 */
function persistAppearance(value: DefaultAppearance): void {
  try {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, value);
  } catch {
    // Storage failure tolerated by design (D6).
  }
}

/**
 * Computes the effective dark state for the current mode and tenant default.
 *
 * Precedence: explicit `"light"` / `"dark"` > tenant default > OS preference
 * > Core light.
 */
function effectiveIsDark(mode: DefaultAppearance, tenantDefault?: DefaultAppearance): boolean {
  if (mode === "dark") return true;
  if (mode === "light") return false;

  // mode === "system": tenant default fixes the appearance if it is explicit.
  if (tenantDefault === "dark") return true;
  if (tenantDefault === "light") return false;

  // Tenant default is "system" or absent — defer to the OS.
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  return false;
}

/**
 * Shell appearance control (staff-shell spec, design D8).
 *
 * Three-state selector (Light / Dark / System). The persisted value is always
 * one of `"light"`, `"dark"`, or `"system"`. The runtime `matchMedia` listener
 * is attached only while the local mode is `"system"` and the tenant default
 * does not already fix the effective appearance.
 */
export function AppearanceToggle({
  defaultAppearance,
}: {
  defaultAppearance?: DefaultAppearance;
}): JSX.Element {
  // No stored preference means "defer to tenant/OS", never an explicit light;
  // defaulting to `system` keeps the toggle from overriding the pre-paint
  // bootstrap resolution.
  const [mode, setMode] = useState<DefaultAppearance>(SYSTEM_VALUE);

  useEffect(() => {
    setMode(readStoredAppearance() ?? SYSTEM_VALUE);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle(DARK_CLASS, effectiveIsDark(mode, defaultAppearance));
  }, [mode, defaultAppearance]);

  useEffect(() => {
    // Listener is only needed when system mode is active and the tenant does
    // not provide an explicit light/dark default.
    if (mode !== "system" || defaultAppearance === "light" || defaultAppearance === "dark") {
      return;
    }
    // Environments without matchMedia (e.g. render tests) simply have no OS
    // signal to follow; the pre-paint bootstrap already resolved a fallback.
    if (typeof window.matchMedia !== "function") {
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (event: MediaQueryListEvent): void => {
      document.documentElement.classList.toggle(DARK_CLASS, event.matches);
    };
    media.addEventListener("change", handler);
    return (): void => {
      media.removeEventListener("change", handler);
    };
  }, [mode, defaultAppearance]);

  function cycleAppearance(): void {
    const next: DefaultAppearance =
      mode === "light" ? "dark" : mode === "dark" ? "system" : "light";
    setMode(next);
    persistAppearance(next);
  }

  const label = mode === "light" ? "Light" : mode === "dark" ? "Dark" : "System";

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={cycleAppearance}
      data-testid="appearance-toggle"
      aria-label={`Appearance: ${label}`}
    >
      {label}
    </Button>
  );
}
