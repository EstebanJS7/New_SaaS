"use client";

import { createContext, useContext, type JSX, type ReactNode } from "react";
import type { ResolvedBrand } from "@newsaas/ui/branding";

const BrandContext = createContext<ResolvedBrand | null>(null);

/**
 * BrandProvider exposes the server-resolved brand to client components.
 *
 * The resolved brand is produced in the root layout (`resolveBrand` +
 * `<style>` bridge) and passed down as a prop; this context only distributes
 * it (e.g. the shell topbar reading `productName`). Styling itself flows
 * through CSS variables — never inline styles.
 */
export function BrandProvider({
  brand,
  children,
}: {
  brand: ResolvedBrand;
  children: ReactNode;
}): JSX.Element {
  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>;
}

/** Read the active resolved brand. Throws when used outside `BrandProvider`. */
export function useBrand(): ResolvedBrand {
  const brand = useContext(BrandContext);
  if (brand === null) {
    throw new Error("useBrand must be used within a BrandProvider");
  }
  return brand;
}
