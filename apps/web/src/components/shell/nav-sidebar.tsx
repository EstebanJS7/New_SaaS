"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Button } from "@newsaas/ui/components/ui/button";
import { Icon, type IconName } from "@newsaas/ui/components/ui/icon";
import { cn } from "@newsaas/ui/lib/utils";

export interface NavLink {
  readonly href: string;
  readonly label: string;
  readonly requiredFeature?: string;
  readonly section?: string;
  readonly icon?: IconName;
}

export const NAV_LINKS: readonly NavLink[] = [
  { href: "/app", label: "Inicio", section: "Espacio de trabajo", icon: "dashboard" },
  { href: "/app/agenda", label: "Agenda", section: "Espacio de trabajo", icon: "calendar" },
  { href: "/app/customers", label: "Clientes", section: "Espacio de trabajo", icon: "users" },
  { href: "/app/patients", label: "Pacientes", section: "Espacio de trabajo", icon: "activity" },
  { href: "/app/catalog", label: "Catálogo", section: "Comercio", icon: "box" },
  { href: "/app/suppliers", label: "Proveedores", section: "Comercio", icon: "truck" },
  { href: "/app/purchases", label: "Compras", section: "Comercio", icon: "bag" },
  {
    href: "/app/sales",
    label: "POS",
    section: "Comercio",
    icon: "receipt",
    requiredFeature: "sales",
  },
  {
    href: "/app/cash",
    label: "Caja",
    section: "Finanzas",
    icon: "wallet",
    requiredFeature: "cash",
  },
  {
    href: "/app/billing",
    label: "Facturación",
    section: "Finanzas",
    icon: "receipt",
    requiredFeature: "billing",
  },
  {
    href: "/app/fiscal",
    label: "Fiscal",
    section: "Finanzas",
    icon: "shield",
    requiredFeature: "fiscal",
  },
  { href: "/app/reports", label: "Informes", section: "Gestión", icon: "chart" },
  { href: "/app/notifications", label: "Notificaciones", section: "Gestión", icon: "bell" },
  { href: "/app/imports", label: "Importaciones", section: "Gestión", icon: "upload" },
  { href: "/app/settings/branding", label: "Marca", section: "Configuración", icon: "settings" },
];

// UX only: unknown entitlements never hide a working destination.
// The backend remains the authority for all permissions and tenant ownership.
export function visibleNavLinks(
  links: readonly NavLink[],
  entitlements?: readonly string[]
): readonly NavLink[] {
  if (entitlements === undefined) return links;
  const granted = new Set(entitlements);
  return links.filter(
    (link) => link.requiredFeature === undefined || granted.has(link.requiredFeature)
  );
}

export function NavSidebar({
  entitlements,
  productName = "Espacio de trabajo",
  onNavigate,
  mobile = false,
}: {
  entitlements?: readonly string[];
  productName?: string;
  onNavigate?: () => void;
  mobile?: boolean;
} = {}) {
  const pathname = usePathname() ?? "/app";
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  const links = visibleNavLinks(NAV_LINKS, entitlements);
  const sections = [...new Set(links.map((link) => link.section ?? "Espacio de trabajo"))];
  async function signOut() {
    setSigningOut(true);
    setSignOutError(false);
    try {
      const response = await fetch("/api/session/logout", { method: "POST" });
      if (!response.ok && response.status !== 401) throw new Error("Logout failed");
      window.location.assign("/login");
    } catch {
      setSigningOut(false);
      setSignOutError(true);
    }
  }
  return (
    <aside
      data-testid="nav-sidebar"
      aria-label="Navegación principal"
      className={cn(
        "workspace-sidebar flex-col",
        mobile ? "flex h-full w-full" : "sticky top-0 hidden h-dvh w-64 shrink-0 lg:flex"
      )}
    >
      <div className="flex min-h-20 shrink-0 items-center gap-3 px-6">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Icon name="activity" className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight">{productName}</p>
          <p className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-sidebar-muted">
            Espacio del equipo
          </p>
        </div>
      </div>
      <nav
        aria-label="Principal"
        className="min-h-0 flex-1 space-y-6 overflow-y-auto px-3 pb-6 pt-3"
      >
        {sections.map((section) => (
          <div key={section}>
            <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-muted">
              {section}
            </p>
            <ul className="space-y-1">
              {links
                .filter((link) => (link.section ?? "Espacio de trabajo") === section)
                .map((link) => {
                  const active =
                    link.href === "/app"
                      ? pathname === link.href
                      : pathname === link.href || pathname.startsWith(link.href + "/");
                  return (
                    <li key={link.href}>
                      <Link
                        data-testid="nav-entry"
                        href={link.href}
                        aria-current={active ? "page" : undefined}
                        onClick={onNavigate}
                        className={cn(
                          "group flex min-h-10 items-center gap-3 rounded-md px-3 py-2 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          active
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "text-sidebar-foreground/75 hover:bg-sidebar-foreground/5 hover:text-sidebar-foreground"
                        )}
                      >
                        <Icon
                          name={link.icon ?? "dashboard"}
                          className={active ? "opacity-100" : "opacity-65"}
                        />
                        <span>{link.label}</span>
                        {active ? (
                          <span className="ml-auto size-1.5 rounded-full bg-current" />
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="shrink-0 border-t border-sidebar-foreground/10 p-4">
        {signOutError ? (
          <p role="alert" className="mb-3 text-xs text-sidebar-foreground">
            No se pudo cerrar la sesión. Intentá de nuevo.
          </p>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          loading={signingOut}
          onClick={() => {
            void signOut();
          }}
          className="w-full justify-start text-sidebar-foreground/70 hover:bg-sidebar-foreground/5 hover:text-sidebar-foreground"
        >
          {!signingOut ? <Icon name="logout" /> : null}
          {signingOut ? "Cerrando sesión…" : "Cerrar sesión"}
        </Button>
      </div>
    </aside>
  );
}
