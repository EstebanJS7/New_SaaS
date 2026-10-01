import type { JSX } from "react";
import Link from "next/link";
import { Button } from "@newsaas/ui/components/ui/button";

/**
 * One staff navigation entry. `requiredFeature` names the tenant capability the
 * destination is gated on, when it has one; an entry without it is always shown.
 */
export interface NavLink {
  readonly href: string;
  readonly label: string;
  readonly requiredFeature?: string;
}

/**
 * Real staff destinations shipped so far. Business entries land with their
 * epics (Customers in EPIC-04, Patients in EPIC-05, Agenda in EPIC-07, Catalog
 * in EPIC-09, Suppliers and Purchases in EPIC-11, the POS in EPIC-12, Cash in
 * EPIC-13); the placeholder labels below remain chrome-only until a later epic
 * supplies a real surface.
 *
 * The POS and Cash are the entries with a capability requirement: DEC-026 gates
 * the sale surface on the seeded `sales` feature code and DEC-037 gates the Cash
 * workspace on the seeded `cash` feature code, so each entry declares its
 * requirement and the shell hides it when it knows the tenant lacks the
 * capability.
 */
export const NAV_LINKS: readonly NavLink[] = [
  { href: "/app/customers", label: "Customers" },
  { href: "/app/patients", label: "Patients" },
  { href: "/app/catalog", label: "Catalog" },
  { href: "/app/suppliers", label: "Suppliers" },
  { href: "/app/purchases", label: "Purchases" },
  { href: "/app/sales", label: "POS", requiredFeature: "sales" },
  { href: "/app/cash", label: "Cash", requiredFeature: "cash" },
  { href: "/app/agenda", label: "Agenda" },
];

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
 * The entries the shell may show for a set of entitled feature codes.
 *
 * This is a UX gate only (PRD §9, DEC-026): it decides which link the browser
 * renders, never what the backend authorizes. When the entitled set is unknown —
 * `undefined`, which is the shell's state today because no staff entitlement read
 * is exposed to the browser — every entry is returned unchanged, so a working
 * surface is never hidden by a guess. The backend still answers `403` on its own.
 */
export function visibleNavLinks(
  links: readonly NavLink[],
  entitlements?: readonly string[]
): readonly NavLink[] {
  if (entitlements === undefined) {
    return links;
  }
  const granted = new Set(entitlements);
  return links.filter(
    (link) => link.requiredFeature === undefined || granted.has(link.requiredFeature)
  );
}

interface NavSidebarProps {
  /**
   * The tenant's entitled feature codes, when the shell knows them. Optional and
   * UX-only: see {@link visibleNavLinks}.
   */
  readonly entitlements?: readonly string[];
}

/**
 * Staff-shell sidebar.
 *
 * Plain `<aside>` composition per design D8; entries are semantic links or
 * inert buttons styled exclusively with semantic tokens. Customers (EPIC-04),
 * Patients (EPIC-05), Catalog (EPIC-09), Suppliers and Purchases (EPIC-11), the
 * POS (EPIC-12), Cash (EPIC-13) and Agenda (EPIC-07) are real `next/link`
 * destinations declared with no client-side permission gate, because the API is
 * the only authorization authority and answers `403` on its own. The POS and
 * Cash entries additionally declare their `sales`/`cash` capability so the shell
 * can hide them when it knows the tenant lacks them.
 */
export function NavSidebar({ entitlements }: NavSidebarProps = {}): JSX.Element {
  return (
    <aside data-testid="nav-sidebar" className="flex w-60 shrink-0 flex-col border-r bg-card">
      <nav aria-label="Primary" className="flex flex-col gap-1 p-3">
        {visibleNavLinks(NAV_LINKS, entitlements).map((link) => (
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
