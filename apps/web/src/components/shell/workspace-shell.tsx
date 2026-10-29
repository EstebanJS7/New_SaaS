"use client";

import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import type { DefaultAppearance } from "@newsaas/ui/branding";
import { Button } from "@newsaas/ui/components/ui/button";
import { Icon } from "@newsaas/ui/components/ui/icon";
import { NavSidebar } from "./nav-sidebar";
import { Topbar } from "./topbar";
import { RouteFeedback } from "./route-feedback";

export function WorkspaceShell({
  children,
  productName,
  productLogoUrl,
  defaultAppearance,
}: {
  children: ReactNode;
  productName: string;
  productLogoUrl?: string;
  defaultAppearance?: DefaultAppearance;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setMenuOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);
  useEffect(() => {
    if (menuOpen && !dialog.current?.open) dialog.current?.showModal();
    else if (!menuOpen && dialog.current?.open) dialog.current.close();
  }, [menuOpen]);
  return (
    <div lang="es-PY" className="flex min-h-dvh bg-background text-foreground">
      <a href="#workspace-content" className="skip-link">
        Ir al contenido
      </a>
      <NavSidebar productName={productName} />
      <dialog
        ref={dialog}
        id="mobile-navigation"
        aria-label="Navegación del espacio de trabajo"
        className="mobile-navigation lg:hidden"
        onClose={() => setMenuOpen(false)}
        onCancel={() => setMenuOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setMenuOpen(false);
        }}
      >
        <div className="relative h-full">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Cerrar navegación"
            onClick={() => setMenuOpen(false)}
            className="absolute right-2 top-2 z-10 text-sidebar-foreground hover:bg-sidebar-foreground/10"
          >
            <Icon name="close" />
          </Button>
          {menuOpen ? (
            <NavSidebar mobile productName={productName} onNavigate={() => setMenuOpen(false)} />
          ) : null}
        </div>
      </dialog>
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          productName={productName}
          productLogoUrl={productLogoUrl}
          defaultAppearance={defaultAppearance}
          onOpenMenu={() => setMenuOpen(true)}
          menuOpen={menuOpen}
        />
        <main
          id="workspace-content"
          tabIndex={-1}
          data-shell-content
          className="workspace-content min-w-0 flex-1 px-4 py-6 outline-none sm:px-8 sm:py-8 lg:px-10"
        >
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </div>
      <Suspense fallback={null}>
        <RouteFeedback />
      </Suspense>
    </div>
  );
}
