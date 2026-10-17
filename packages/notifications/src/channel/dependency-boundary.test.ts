import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * [[ADR-011]] guardrail 7, as an executable rule: the email library is imported
 * by ONE file.
 *
 * A boundary that lives only in a document is a boundary that erodes on the next
 * Story, so this asserts it the way `apps/api/src/fiscal/fiscal-boundary.test.ts`
 * asserts the Fiscal one.
 */
const PACKAGE_SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const EMAIL_ADAPTER = join(PACKAGE_SRC, "channel", "email.channel.ts");
/**
 * This file's own fixtures name the package, so it is not its own subject. Every
 * OTHER file is, tests included: a test that imports the library directly would
 * be a second importer.
 */
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

/** The package, or any deep path into it (`nodemailer/lib/...`). */
function isNodemailerImport(specifier: string): boolean {
  return specifier === "nodemailer" || specifier.startsWith("nodemailer/");
}

/** The concrete adapter factories a deployable must reach through the module. */
const CONCRETE_ADAPTER_FACTORIES = [
  "createFakeNotificationChannel",
  "createSmtpEmailChannel",
  "createWhatsAppCloudChannel",
] as const;

describe("the concrete adapters stay behind the module", () => {
  it("are never constructed by a deployable, which reaches them through the port", () => {
    // [[NOTIF-002]]: "no caller imports a concrete adapter, and a repository
    // search proves it." A factory is only reachable here by name, so the search
    // is for the names rather than for a path.
    const appsRoot = join(PACKAGE_SRC, "..", "..", "..", "apps");
    const files = walkSourceFiles(join(appsRoot, "api")).concat(
      walkSourceFiles(join(appsRoot, "worker"))
    );
    expect(files.length, "the app walk must find files").toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const factory of CONCRETE_ADAPTER_FACTORIES) {
        if (source.includes(factory)) violations.push(`${file}: ${factory}`);
      }
    }
    expect(violations, `scanned ${files.length} app files`).toEqual([]);
  });
});

describe("notification channel dependency boundary", () => {
  const files = walkSourceFiles(PACKAGE_SRC);

  it("walks this package's source files", () => {
    // A walk that found nothing would make the assertions below pass vacuously.
    expect(files.length, "source walk must find notification package files").toBeGreaterThan(0);
    expect(files).toContain(EMAIL_ADAPTER);
  });

  it("recognises the import forms a bypass would use", () => {
    for (const source of [
      `import { createTransport } from "nodemailer";`,
      `import "nodemailer";`,
      `await import("nodemailer");`,
      `require("nodemailer");`,
      `import { x } from "nodemailer/lib/smtp-transport";`,
    ]) {
      expect(importSpecifiers(source).filter(isNodemailerImport), source).toHaveLength(1);
    }
  });

  it("imports nodemailer from the EMAIL adapter and nowhere else", () => {
    const violations: string[] = [];
    for (const file of files) {
      if (file === EMAIL_ADAPTER || file === THIS_FILE) continue;
      for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
        if (isNodemailerImport(specifier)) violations.push(`${file}: ${specifier}`);
      }
    }
    expect(
      violations,
      `scanned ${files.length} source files; only channel/email.channel.ts may import nodemailer`
    ).toEqual([]);
  });

  it("proves the adapter really is the importer, so the rule is not vacuous", () => {
    const specifiers = importSpecifiers(readFileSync(EMAIL_ADAPTER, "utf8"));
    expect(specifiers.filter(isNodemailerImport)).toEqual(["nodemailer"]);
  });
});
