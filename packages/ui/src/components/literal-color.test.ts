import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Literal-color guard for reusable UI primitives (brand-tokens-and-presets
 * spec: semantic token completeness).
 *
 * Scans every source file under src/components/** and rejects raw hex/HSL
 * color values and Tailwind palette utilities (e.g. bg-emerald-500). Shared
 * components must style exclusively with semantic CSS variables / token
 * utilities such as bg-primary or text-muted-foreground.
 */

const COMPONENTS_DIR = join(import.meta.dirname);

const HEX_LITERAL = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/;
const HSL_LITERAL = /\bh(?:sl)?a?\(\s*\d/;
const PALETTE_UTILITY = /-?(?:bg|text|border|ring)-[a-z]+-\d{2,3}/;

function listComponentFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) return listComponentFiles(fullPath);
    if (!/\.(ts|tsx|css)$/.test(entry.name)) return [];
    if (/\.test\.(ts|tsx)$/.test(entry.name)) return [];
    return [fullPath];
  });
}

describe("shared component literal-color scan", () => {
  it("finds zero literal colors under src/components/**", () => {
    const violations: string[] = [];

    for (const filePath of listComponentFiles(COMPONENTS_DIR)) {
      const lines = readFileSync(filePath, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (HEX_LITERAL.test(line)) {
          violations.push(`${filePath}:${index + 1} hex literal`);
        }
        if (HSL_LITERAL.test(line)) {
          violations.push(`${filePath}:${index + 1} HSL literal`);
        }
        if (PALETTE_UTILITY.test(line)) {
          violations.push(`${filePath}:${index + 1} palette utility class`);
        }
      });
    }

    expect(violations, "literal brand colors are forbidden in shared components").toEqual([]);
  });

  it("scan actually covers component files", () => {
    // Guard against the scanner silently passing on an empty tree.
    const scanned = listComponentFiles(COMPONENTS_DIR);
    expect(
      scanned.some((filePath) => filePath.endsWith(".tsx")),
      "expected at least one primitive under src/components/ui to scan"
    ).toBe(true);
  });
});
