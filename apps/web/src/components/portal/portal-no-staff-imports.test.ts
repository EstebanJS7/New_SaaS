import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Portal staff-chrome guard.
 *
 * The portal-management spec requires the portal UI to render NO staff
 * navigation, and until this test nothing enforced it. This is a source scan,
 * not a rendering test: it walks every shipped portal source and fails when one
 * imports the staff shell, a staff-only shell component, or anything from the
 * staff `(app)` route group.
 *
 * Scanned roots:
 * - `apps/web/src/app/(portal)` — the portal route group (layout + pages)
 * - `apps/web/src/components/portal` — the portal component module
 *
 * Test files are skipped (as in `tokens.test.ts`) so this guard's own forbidden
 * substrings are not matched against itself. A staff `NavSidebar`/`Topbar`/
 * `AppearanceToggle` belongs to the staff surface only; the portal has its own
 * `PortalNav`.
 */
const PORTAL_COMPONENTS_DIR = join(import.meta.dirname);
const PORTAL_APP_DIR = join(import.meta.dirname, "..", "..", "app", "(portal)");

interface ForbiddenImport {
  readonly label: string;
  readonly pattern: RegExp;
}

const FORBIDDEN_IMPORTS: readonly ForbiddenImport[] = [
  // @/components/shell, ../shell/nav-sidebar, etc.
  { label: "staff shell module", pattern: /(?:^|\/)shell(?:\/|$)/ },
  // Direct imports of staff-only shell components by file name.
  {
    label: "staff shell component",
    pattern: /(?:^|\/)(?:nav-sidebar|topbar|appearance-toggle)(?:\.|$|\/)/,
  },
  // The staff route group at all (importing a staff page/source is also wrong).
  { label: "staff route group", pattern: /\(app\)/ },
];

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(fullPath);
    if (!/\.(ts|tsx)$/.test(entry.name)) return [];
    if (/\.test\.(ts|tsx)$/.test(entry.name)) return [];
    return [fullPath];
  });
}

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  // `import x from "spec"`, `export {x} from "spec"`
  for (const match of source.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
    specifiers.push(match[1] ?? "");
  }
  // `import "spec"` — a side-effect import carries no `from` and would
  // otherwise slip through the guard entirely.
  for (const match of source.matchAll(/\bimport\s+["']([^"']+)["']/g)) {
    specifiers.push(match[1] ?? "");
  }
  // `import("spec")` and `require("spec")` — the CommonJS form is still valid
  // in this toolchain, so it must be checked too.
  for (const match of source.matchAll(/\b(?:import|require)\(\s*["']([^"']+)["']\s*\)/g)) {
    specifiers.push(match[1] ?? "");
  }
  return specifiers;
}

/** Every staff-chrome specifier a source declares, for the guard's own tests. */
function forbiddenSpecifiersIn(source: string): string[] {
  return importSpecifiers(source).filter((specifier) =>
    FORBIDDEN_IMPORTS.some((rule) => rule.pattern.test(specifier))
  );
}

describe("portal surface staff-chrome guard", () => {
  const files = [...listSourceFiles(PORTAL_APP_DIR), ...listSourceFiles(PORTAL_COMPONENTS_DIR)];

  it("scans the shipped portal sources", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("recognises every import form a violation could arrive in", () => {
    // Guards fail silently when their extractor only understands one syntax, so
    // the extractor is itself tested against the forms the language allows.
    expect(forbiddenSpecifiersIn('import x from "@/components/shell/nav-sidebar";')).toEqual([
      "@/components/shell/nav-sidebar",
    ]);
    expect(forbiddenSpecifiersIn('import "@/components/shell/topbar";')).toEqual([
      "@/components/shell/topbar",
    ]);
    expect(forbiddenSpecifiersIn('const bar = require("@/components/shell/topbar");')).toEqual([
      "@/components/shell/topbar",
    ]);
    expect(
      forbiddenSpecifiersIn('export { x } from "@/components/shell/appearance-toggle";')
    ).toEqual(["@/components/shell/appearance-toggle"]);
    expect(forbiddenSpecifiersIn('await import("../../app/(app)/layout");')).toEqual([
      "../../app/(app)/layout",
    ]);
    // The portal's own navigation is legitimate and must not be flagged.
    expect(
      forbiddenSpecifiersIn('import { PortalNav } from "@/components/portal/portal-nav";')
    ).toEqual([]);
  });

  it("imports no staff navigation, staff shell component, or staff route group", () => {
    const violations: string[] = [];

    for (const filePath of files) {
      const source = readFileSync(filePath, "utf8");
      for (const specifier of importSpecifiers(source)) {
        for (const rule of FORBIDDEN_IMPORTS) {
          if (rule.pattern.test(specifier)) {
            violations.push(`${filePath}: ${rule.label} -> ${specifier}`);
          }
        }
      }
    }

    expect(violations, "portal sources must not import staff chrome").toEqual([]);
  });
});
