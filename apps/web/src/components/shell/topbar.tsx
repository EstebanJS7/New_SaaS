import type { JSX } from "react";
import type { DefaultAppearance } from "@newsaas/ui/branding";
import { Button } from "@newsaas/ui/components/ui/button";
import { AppearanceToggle } from "./appearance-toggle";

/**
 * Staff-shell topbar.
 *
 * Receives the product identity as a prop from the server-resolved shell
 * layout (design D4: resolution happens in RSC layouts; components never
 * import raw presets). Inert placeholder entry plus the client appearance
 * toggle (EPIC-03 Unit 5). Token-only styling per D8.
 */
export function Topbar({
  productName,
  productLogoUrl,
  defaultAppearance,
}: {
  productName: string;
  productLogoUrl?: string;
  defaultAppearance?: DefaultAppearance;
}): JSX.Element {
  return (
    <header
      data-testid="topbar"
      className="flex h-14 shrink-0 items-center justify-between border-b bg-card px-4"
    >
      <div className="flex items-center gap-3">
        {productLogoUrl ? (
          <img
            src={productLogoUrl}
            alt={productName}
            width={96}
            height={32}
            className="h-8 w-auto object-contain"
            data-testid="topbar-logo"
          />
        ) : null}
        <span className="text-sm font-semibold text-foreground" data-testid="topbar-product-name">
          {productName}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <AppearanceToggle defaultAppearance={defaultAppearance} />
        <Button type="button" variant="ghost" size="sm" data-testid="topbar-entry">
          Account
        </Button>
      </div>
    </header>
  );
}
