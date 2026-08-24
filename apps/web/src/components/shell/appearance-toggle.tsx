"use client";

import { useEffect, type JSX } from "react";
import { Button } from "@newsaas/ui/components/ui/button";
import { APPEARANCE_STORAGE_KEY, DARK_CLASS } from "@/lib/appearance";

/**
 * Reads the stored appearance, tolerating unavailable storage (private mode,
 * disabled storage APIs return/throw inconsistently across browsers).
 */
function readStoredAppearance(): string | null {
  try {
    return window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Persists the appearance, ignoring failures: an unwritable store only costs
 * persistence across visits — the toggle still works for this session.
 */
function persistAppearance(value: string): void {
  try {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, value);
  } catch {
    // Storage failure tolerated by design (D6).
  }
}

/**
 * Shell appearance control (staff-shell spec, design D6).
 *
 * Click flips the `dark` class on `<html>` and persists the explicit
 * `"light" | "dark"` choice — no navigation, no reload, no React state for
 * theming (the CSS cascade swaps token values). On mount it re-syncs from
 * storage so a stored dark preference survives fresh sessions; absent or
 * unreadable entries resolve to light.
 */
export function AppearanceToggle(): JSX.Element {
  useEffect(() => {
    document.documentElement.classList.toggle(DARK_CLASS, readStoredAppearance() === "dark");
  }, []);

  function toggleAppearance(): void {
    const isDark = document.documentElement.classList.toggle(DARK_CLASS);
    persistAppearance(isDark ? "dark" : "light");
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={toggleAppearance}
      data-testid="appearance-toggle"
      aria-label="Toggle dark appearance"
    >
      Appearance
    </Button>
  );
}
