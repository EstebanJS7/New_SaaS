import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Token-layer guards for EPIC-03 Phase A (brand-tokens-and-presets spec).
 *
 * These are source scans, not rendering tests:
 * 1. `globals.css` must declare the full semantic set in `:root`.
 * 2. `.dark` must mirror every custom property declared in `:root` (parity).
 * 3. App component sources must not hardcode brand colors — they consume
 *    semantic tokens exclusively.
 */

const CSS_PATH = join(import.meta.dirname, "..", "app", "globals.css");
const APP_SRC_DIR = join(import.meta.dirname, "..");

const REQUIRED_TOKENS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "destructive-foreground",
  "status-success",
  "status-error",
  "border",
  "input",
  "ring",
  "radius",
  "font-sans",
  "font-mono",
] as const;

function extractSelectorBlock(css: string, selector: string): string {
  const match = new RegExp(`${selector}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match) {
    throw new Error(`Selector ${selector} not found in ${CSS_PATH}`);
  }
  return match[1] ?? "";
}

function extractCustomPropertyNames(block: string): Set<string> {
  const names = new Set<string>();
  for (const match of block.matchAll(/--([A-Za-z0-9-]+)\s*:/g)) {
    names.add(match[1] ?? "");
  }
  return names;
}

function extractCustomPropertyValue(
  css: string,
  selector: string,
  name: string
): string | undefined {
  const block = extractSelectorBlock(css, selector);
  return new RegExp(`--${name}\\s*:\\s*([^;]+);`).exec(block)?.[1]?.trim();
}

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(fullPath);
    if (!/\.(ts|tsx)$/.test(entry.name)) return [];
    if (/\.test\.(ts|tsx)$/.test(entry.name)) return [];
    return [fullPath];
  });
}

describe("globals.css token layer", () => {
  const css = readFileSync(CSS_PATH, "utf8");
  const rootVars = extractCustomPropertyNames(extractSelectorBlock(css, ":root"));
  const darkVars = extractCustomPropertyNames(extractSelectorBlock(css, ".dark"));

  it("declares the full shadcn semantic set plus status/radius/font tokens in :root", () => {
    const missing = REQUIRED_TOKENS.filter((token) => !rootVars.has(token));
    expect(missing, "missing tokens in :root").toEqual([]);
  });

  it("keeps :root and .dark in exact parity", () => {
    const missingInDark = [...rootVars].filter((token) => !darkVars.has(token));
    const extraInDark = [...darkVars].filter((token) => !rootVars.has(token));
    expect(missingInDark, "light tokens without a dark counterpart").toEqual([]);
    expect(extraInDark, "dark tokens absent from :root").toEqual([]);
  });

  it("actually switches values under .dark for appearance-relevant tokens", () => {
    for (const token of ["background", "foreground", "primary", "border"]) {
      const light = extractCustomPropertyValue(css, ":root", token);
      const dark = extractCustomPropertyValue(css, ".dark", token);
      expect(dark, `--${token} must be defined in .dark`).toBeDefined();
      expect(dark, `--${token} should differ between light and dark`).not.toBe(light);
    }
  });
});

describe("app source literal-color scan", () => {
  it("contains no literal hex/HSL colors or palette utility classes", () => {
    const violations: string[] = [];

    for (const filePath of listSourceFiles(APP_SRC_DIR)) {
      const lines = readFileSync(filePath, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (/#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/.test(line)) {
          violations.push(`${filePath}:${index + 1} hex literal`);
        }
        if (/\bh(?:sl)?a?\(\s*\d/.test(line)) {
          violations.push(`${filePath}:${index + 1} HSL literal`);
        }
        if (/-?(?:bg|text|border|ring)-[a-z]+-\d{2,3}/.test(line)) {
          violations.push(`${filePath}:${index + 1} palette utility class`);
        }
      });
    }

    expect(violations, "literal brand colors found").toEqual([]);
  });
});
