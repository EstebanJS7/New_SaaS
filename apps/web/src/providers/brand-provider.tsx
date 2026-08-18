"use client";

import type { JSX, ReactNode } from "react";
import { coreDesignDefaults } from "@newsaas/ui/branding";

/**
 * BrandProvider resolves the active brand theme.
 *
 * In EPIC-00 it only applies the neutral CoreDesignDefaults via CSS variables.
 * Product presets and tenant overrides are wired in EPIC-03.
 */
export function BrandProvider({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div
      style={{
        // Forward-compatible: future versions will inject resolved CSS variables here.
        ["--radius" as string]: coreDesignDefaults.radius,
      }}
    >
      {children}
    </div>
  );
}
