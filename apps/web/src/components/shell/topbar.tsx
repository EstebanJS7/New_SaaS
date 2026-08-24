import type { JSX } from "react";
import { Button } from "@newsaas/ui/components/ui/button";

/**
 * Staff-shell topbar.
 *
 * Receives the product identity as a prop from the server-resolved shell
 * layout (design D4: resolution happens in RSC layouts; components never
 * import raw presets). Inert placeholder entry only — the appearance toggle
 * (EPIC-03 Unit 5) will be composed next to it. Token-only styling per D8.
 */
export function Topbar({ productName }: { productName: string }): JSX.Element {
  return (
    <header
      data-testid="topbar"
      className="flex h-14 shrink-0 items-center justify-between border-b bg-card px-4"
    >
      <span className="text-sm font-semibold text-foreground" data-testid="topbar-product-name">
        {productName}
      </span>
      <Button type="button" variant="ghost" size="sm" data-testid="topbar-entry">
        Account
      </Button>
    </header>
  );
}
