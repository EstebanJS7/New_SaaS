/**
 * @vitest-environment node
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * SURFACE INTEGRITY (the fence that would have caught the missing login page).
 *
 * [[SHELL-001]] found that the app had **no page that established a session** — and no test reported
 * it, because every layer was internally consistent: the API authenticated, the shell rendered, the
 * BFFs proxied. The gap was a page nobody had, and the way it was found was *looking at the product*.
 *
 * This file makes two of those looks mechanical, over the app's own route tree:
 *
 * 1. **Every page is reachable from some link** — an orphan page is a page a user cannot get to, and
 *    that is what "there is no login page" amounts to one level up.
 * 2. **Every link resolves to a page** — a link with nothing behind it is the same gap from the other
 *    side, and it is what the portal's recovery link would have been before [[PORTAL-002]].
 *
 * It reads SOURCE, not a running server, so it runs in CI with no infrastructure. That is also its
 * limit, stated rather than implied: it proves reachability in the code, not that a page renders or
 * that a form submits.
 */
const APP_DIR = fileURLToPath(new URL(".", import.meta.url));

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      walk(path, found);
    } else if (entry.endsWith(".tsx") || entry.endsWith(".ts")) {
      found.push(path);
    }
  }
  return found;
}

/** The route a `page.tsx` serves: route groups are dropped and dynamic segments become `:id`. */
function routeOf(file: string): string | null {
  if (!file.endsWith(`${sep}page.tsx`)) return null;
  const segments = relative(APP_DIR, file)
    .split(sep)
    .slice(0, -1)
    // A route group like `(app)` or `(protected)` is not part of the URL.
    .filter((segment) => !segment.startsWith("("))
    .map((segment) => (segment.startsWith("[") ? ":id" : segment));
  return `/${segments.join("/")}`.replace(/\/$/, "") || "/";
}

/**
 * Every `href` a source file writes, static or as a template's static prefix.
 *
 * BOTH spellings matter and the first version of this file only caught one: a JSX attribute
 * (`href="/x"`) and an object literal in a link table (`{ href: "/x" }`). The nav is a link table, so
 * missing the second form reported five reachable pages as orphans — which is the fence crying wolf,
 * and worth the note because a fence nobody trusts is a fence nobody reads.
 */
function linksIn(files: readonly string[]): Set<string> {
  const links = new Set<string>();
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/href[=:]\s*(?:"|'|{`)([^"'`]*)/g)) {
      const value = match[1] ?? "";
      // A template's `${...}` is a value, not a path: keep the part before it.
      const staticPart = value.split("${")[0] ?? "";
      if (staticPart.startsWith("/")) links.add(staticPart.replace(/\/$/, "") || "/");
    }
  }
  return links;
}

/**
 * Pages that are entry points rather than destinations, each with the reason it needs no link.
 *
 * This list is the assertion's escape hatch, and every entry is a decision: a page added here without
 * a reason is exactly the orphan this file exists to catch.
 */
const ENTRY_POINTS: Readonly<Record<string, string>> = {
  "/": "the root, which the middleware and the layouts resolve",
  "/app": "where signing in lands — reached by a redirect, not a link",
  "/:id": "the portal's tenant landing, reached by a URL a customer is given",
  "/:id/login": "the portal's sign-in, reached by a URL rather than a link",
  "/reset-password": "where a recovery LINK lands; the mail carries the URL, not a page",
  // The portal's nav builds its hrefs from the tenant base (`${base}/pets`), so the static prefix a
  // source scan can see is empty. These four are that nav's destinations, and the assertion below
  // proves the nav EXISTS; what it cannot prove is the value of `base`.
  "/:id/pets": "reached through the portal nav, which builds hrefs from the tenant base",
  "/:id/appointments": "reached through the portal nav, which builds hrefs from the tenant base",
  "/:id/profile": "reached through the portal nav, which builds hrefs from the tenant base",
  "/:id/pets/:id": "reached from the pets list, which links each row",
  "/:id/pets/:id/book": "reached from the pet detail page",
  "/:id/forgot-password": "reached from the portal sign-in form, whose href is a template",
  "/:id/reset-password": "where a recovery LINK lands for the portal; the mail carries the URL",
};

const SOURCE_FILES = walk(APP_DIR).filter((file) => !file.includes(".test."));
const PAGES = SOURCE_FILES.map(routeOf)
  .filter((route): route is string => route !== null)
  .sort();
const LINKS = linksIn([
  ...SOURCE_FILES,
  // The shells' link tables live outside the route tree.
  ...walk(fileURLToPath(new URL("../components/", import.meta.url))),
]);

describe("surface integrity", () => {
  it("finds the route tree it is asserting over", () => {
    // A fence that silently walks nothing would pass everything.
    expect(PAGES.length).toBeGreaterThan(20);
    expect(LINKS.size).toBeGreaterThan(10);
  });

  it("reaches every page from a link, or documents why it is an entry point", () => {
    const orphans = PAGES.filter((route) => {
      if (route in ENTRY_POINTS) return false;
      // A dynamic route is reached through its parent's list, so its `:id` form is what a link names.
      return ![...LINKS].some(
        (link) => link === route || route.startsWith(`${link}/:id`) || link.startsWith(`${route}/`)
      );
    });
    expect(orphans).toEqual([]);
  });

  it("resolves every internal link to a page, or a documented non-page route", () => {
    const dead = [...LINKS].filter((link) => {
      // Not a page: the BFF proxies, anchors, and the branding asset endpoint.
      if (link.startsWith("/api/") || link.startsWith("/branding")) return false;
      if (link in ENTRY_POINTS) return false;
      return !PAGES.some(
        (route) =>
          route === link ||
          // A link to a concrete id matches the dynamic route it belongs to.
          route.replace(":id", "x") === link.replace(/\/[0-9a-f-]{36}/g, "x") ||
          route.startsWith(`${link}/:id`)
      );
    });
    expect(dead).toEqual([]);
  });

  it("keeps the entry-point list honest: every entry is a real page", () => {
    const missing = Object.keys(ENTRY_POINTS).filter(
      (route) => route !== "/" && !PAGES.includes(route)
    );
    expect(missing).toEqual([]);
  });
});
