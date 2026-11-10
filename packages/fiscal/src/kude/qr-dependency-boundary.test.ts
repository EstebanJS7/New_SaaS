import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * [[DEC-098]] as an executable rule: `qrcode-generator` is imported by ONE file,
 * `kude/kude.qr.ts`, the same way the notifications package pins nodemailer to
 * its email adapter. Every other file reaches the QR through that helper.
 */
const PACKAGE_SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const QR_HELPER = join(PACKAGE_SRC, "kude", "kude.qr.ts");
/** This file's fixtures name the package, so it is not its own subject. */
const THIS_FILE = fileURLToPath(import.meta.url);

function walkSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkSourceFiles(full));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) files.push(full);
  }
  return files;
}

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(/\bfrom\s+["']([^"']+)["']/g))
    specifiers.push(match[1] ?? "");
  for (const match of source.matchAll(/\bimport\s+["']([^"']+)["']/g))
    specifiers.push(match[1] ?? "");
  for (const match of source.matchAll(/\b(?:import|require)\(\s*["']([^"']+)["']\s*\)/g)) {
    specifiers.push(match[1] ?? "");
  }
  return specifiers;
}

function isQrLibraryImport(specifier: string): boolean {
  return specifier === "qrcode-generator" || specifier.startsWith("qrcode-generator/");
}

describe("QR library dependency boundary", () => {
  const files = walkSourceFiles(PACKAGE_SRC);

  it("walks this package's source files", () => {
    expect(existsSync(join(PACKAGE_SRC, "index.ts"))).toBe(true);
    expect(files).toContain(QR_HELPER);
  });

  it("recognises the import forms a bypass would use", () => {
    for (const source of [
      `import qrcode from "qrcode-generator";`,
      `import "qrcode-generator";`,
      `await import("qrcode-generator");`,
      `require("qrcode-generator");`,
      `import x from "qrcode-generator/dist/qrcode.mjs";`,
    ]) {
      expect(importSpecifiers(source).filter(isQrLibraryImport), source).toHaveLength(1);
    }
  });

  it("imports qrcode-generator from the QR helper and nowhere else", () => {
    const violations: string[] = [];
    for (const file of files) {
      if (file === QR_HELPER || file === THIS_FILE) continue;
      for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
        if (isQrLibraryImport(specifier)) violations.push(`${file}: ${specifier}`);
      }
    }
    expect(violations, `scanned ${files.length} files; only kude/kude.qr.ts may import it`).toEqual(
      []
    );
  });

  it("proves the helper really is the importer, so the rule is not vacuous", () => {
    const specifiers = importSpecifiers(readFileSync(QR_HELPER, "utf8"));
    expect(specifiers.filter(isQrLibraryImport)).toEqual(["qrcode-generator"]);
  });
});
