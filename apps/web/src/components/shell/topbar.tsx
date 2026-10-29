"use client";
import { usePathname } from "next/navigation";
import type { DefaultAppearance } from "@newsaas/ui/branding";
import { Button } from "@newsaas/ui/components/ui/button";
import { Icon } from "@newsaas/ui/components/ui/icon";
import { AppearanceToggle } from "./appearance-toggle";
import { NAV_LINKS } from "./nav-sidebar";

export function Topbar({
  productName,
  productLogoUrl,
  defaultAppearance,
  onOpenMenu,
  menuOpen = false,
}: {
  productName: string;
  productLogoUrl?: string;
  defaultAppearance?: DefaultAppearance;
  onOpenMenu?: () => void;
  menuOpen?: boolean;
}) {
  const pathname = usePathname() ?? "/app";
  const current =
    NAV_LINKS.find(
      (link) =>
        link.href !== "/app" && (pathname === link.href || pathname.startsWith(link.href + "/"))
    )?.label ?? "Inicio";
  return (
    <header
      data-testid="topbar"
      className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-card/95 px-4 backdrop-blur-md sm:px-8"
    >
      <div className="flex min-w-0 items-center gap-3">
        {onOpenMenu ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onOpenMenu}
            aria-label="Abrir navegación"
            aria-expanded={menuOpen}
            aria-controls="mobile-navigation"
            className="lg:hidden"
          >
            <Icon name="menu" />
          </Button>
        ) : null}
        {productLogoUrl ? (
          <img
            src={productLogoUrl}
            alt={productName}
            width={96}
            height={32}
            className="h-8 w-auto max-w-28 object-contain"
            data-testid="topbar-logo"
          />
        ) : null}
        <span
          className="truncate text-xs font-medium text-muted-foreground"
          data-testid="topbar-product-name"
        >
          {productName}
        </span>
        <Icon name="chevron" className="hidden size-3 text-muted-foreground/60 sm:block" />
        <span className="hidden text-sm font-semibold sm:block">{current}</span>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="hidden items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-[10px] font-medium text-muted-foreground md:inline-flex">
          <Icon name="shield" className="size-3" />
          Espacio del equipo
        </span>
        <AppearanceToggle defaultAppearance={defaultAppearance} />
      </div>
    </header>
  );
}
