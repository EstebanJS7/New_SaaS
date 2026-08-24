import type { JSX } from "react";
import { Button } from "@newsaas/ui/components/ui/button";

/**
 * Phase A navigation labels.
 *
 * Deliberately neutral structural placeholders: real destinations belong to
 * later epics and must never ship hidden features behind this chrome
 * (chrome-only gate).
 */
const NAV_ENTRIES = ["Section one", "Section two", "Section three"] as const;

/**
 * Staff-shell sidebar.
 *
 * Plain `<aside>` composition per design D8; entries are inert buttons (no
 * `href`, no handlers) styled exclusively with semantic tokens via the shared
 * Button primitive. The appearance toggle joins the topbar in Unit 5.
 */
export function NavSidebar(): JSX.Element {
  return (
    <aside data-testid="nav-sidebar" className="flex w-60 shrink-0 flex-col border-r bg-card">
      <nav aria-label="Primary" className="flex flex-col gap-1 p-3">
        {NAV_ENTRIES.map((label) => (
          <Button
            key={label}
            type="button"
            variant="ghost"
            className="justify-start"
            data-testid="nav-entry"
          >
            {label}
          </Button>
        ))}
      </nav>
    </aside>
  );
}
