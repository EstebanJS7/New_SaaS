import type { JSX } from "react";
import Link from "next/link";

interface PortalNavProps {
  readonly slug: string;
}

const navLinkClassName =
  "inline-flex h-10 items-center whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium text-card-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/**
 * Portal-surface navigation.
 *
 * Renders ONLY the destinations that exist after this slice: home and pets.
 * There is deliberately no entry for appointments, profile or booking — linking
 * to a page that does not exist yet would 404 a holder. It is a distinct
 * component from the staff `NavSidebar` and must never import staff chrome.
 *
 * The tenant slug is preserved on every href so the holder stays in their own
 * tenant, and the entries are semantic links inside a labelled `<nav>`.
 */
export function PortalNav({ slug }: PortalNavProps): JSX.Element {
  const base = `/${encodeURIComponent(slug)}`;
  const entries = [
    { href: base, label: "Home" },
    { href: `${base}/pets`, label: "Pets" },
  ] as const;

  return (
    <nav
      aria-label="Portal"
      data-testid="portal-nav"
      className="flex flex-col gap-1 border-b bg-card p-3 sm:flex-row"
    >
      {entries.map((entry) => (
        <Link
          key={entry.href}
          href={entry.href}
          className={navLinkClassName}
          data-testid="portal-nav-entry"
        >
          {entry.label}
        </Link>
      ))}
    </nav>
  );
}
