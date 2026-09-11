import type { JSX } from "react";
import Link from "next/link";
import { Button } from "@newsaas/ui/components/ui/button";

/**
 * Real staff destinations shipped so far. Business entries land with their
 * epics (Customers in EPIC-04, Patients in EPIC-05); the placeholder labels
 * below remain chrome-only until a later epic supplies a real surface.
 */
const NAV_LINKS = [
  { href: "/app/customers", label: "Customers" },
  { href: "/app/patients", label: "Patients" },
] as const;

/**
 * Phase A navigation labels.
 *
 * Deliberately neutral structural placeholders: real destinations belong to
 * later epics and must never ship hidden features behind this chrome
 * (chrome-only gate).
 */
const NAV_ENTRIES = ["Section one", "Section two", "Section three"] as const;

const navLinkClassName =
  "inline-flex h-10 items-center justify-start whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium text-card-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/**
 * Staff-shell sidebar.
 *
 * Plain `<aside>` composition per design D8; entries are semantic links or
 * inert buttons styled exclusively with semantic tokens. Customers (EPIC-04)
 * and Patients (EPIC-05) are real `next/link` destinations.
 */
export function NavSidebar(): JSX.Element {
  return (
    <aside data-testid="nav-sidebar" className="flex w-60 shrink-0 flex-col border-r bg-card">
      <nav aria-label="Primary" className="flex flex-col gap-1 p-3">
        {NAV_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={navLinkClassName}
            data-testid="nav-entry"
          >
            {link.label}
          </Link>
        ))}
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
