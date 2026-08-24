import type { JSX, ReactNode } from "react";
import { activeProductPreset } from "@newsaas/ui/branding";
import { NavSidebar } from "@/components/shell/nav-sidebar";
import { Topbar } from "@/components/shell/topbar";

/**
 * Staff shell layout for the `/app` route group.
 *
 * Plain `<aside>` + `<header>` + `<main>` composition per design D8. Every
 * route inside the group — including deep links — renders within this chrome.
 * `<main data-shell-content>` is the bounded content region that hosts
 * self-contained sample cards inheriting the resolved brand tokens.
 */
export default function AppShellLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <NavSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Identity resolved here on the server; components stay preset-agnostic. */}
        <Topbar productName={activeProductPreset.productName} />
        <main data-shell-content className="min-w-0 flex-1 p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
