import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const API_SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..");

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
  for (const match of source.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
    specifiers.push(match[1] ?? "");
  }
  for (const match of source.matchAll(/\bimport\s+["']([^"']+)["']/g)) {
    specifiers.push(match[1] ?? "");
  }
  for (const match of source.matchAll(/\b(?:import|require)\(\s*["']([^"']+)["']\s*\)/g)) {
    specifiers.push(match[1] ?? "");
  }
  return specifiers;
}

function concreteProviderImports(source: string): string[] {
  return importSpecifiers(source).filter((specifier) =>
    /(?:^|\/)fake-fiscal\.provider(?:\.js)?$/.test(specifier)
  );
}

function packageFiscalImports(source: string): string[] {
  return importSpecifiers(source).filter((specifier) => specifier === "@newsaas/fiscal");
}

describe("Fiscal source boundary", () => {
  const files = walkSourceFiles(API_SRC);

  it("extracts every supported import form", () => {
    // The realistic bypass this rule guards is a deep path INTO the package,
    // since the barrel only exports the port, the module and the dev/test fake.
    const target = "../../../packages/fiscal/src/fake-fiscal.provider.js";
    expect(concreteProviderImports(`import { x } from "${target}";`)).toEqual([target]);
    expect(concreteProviderImports(`import "${target}";`)).toEqual([target]);
    expect(concreteProviderImports(`await import("${target}");`)).toEqual([target]);
    expect(concreteProviderImports(`require("${target}");`)).toEqual([target]);
  });

  it("walks API source files", () => {
    expect(files.length, "source walk must find API files").toBeGreaterThan(0);
  });

  it("keeps the concrete fake provider inside apps/api/src/fiscal/", () => {
    const violations: string[] = [];
    for (const file of files) {
      if (file.startsWith(join(API_SRC, "fiscal"))) continue;
      for (const specifier of concreteProviderImports(readFileSync(file, "utf8"))) {
        violations.push(`${file}: ${specifier}`);
      }
    }
    expect(
      violations,
      `scanned ${files.length} source files; concrete provider imports must stay in fiscal/`
    ).toEqual([]);
  });

  it("keeps API imports of the shared package inside the Fiscal composition area", () => {
    const violations: string[] = [];
    for (const file of files) {
      if (file.startsWith(join(API_SRC, "fiscal"))) continue;
      for (const specifier of packageFiscalImports(readFileSync(file, "utf8"))) {
        violations.push(`${file}: ${specifier}`);
      }
    }
    expect(
      violations,
      `scanned ${files.length} API source files; @newsaas/fiscal imports must stay in fiscal/`
    ).toEqual([]);
  });

  it("keeps Billing free of the Fiscal package", () => {
    // DEC-047 makes Fiscal the owner of the issue command; Billing imports nothing from this boundary.
    const billingDir = join(API_SRC, "billing");
    const billingFiles = walkSourceFiles(billingDir);
    const violations: string[] = [];
    for (const file of billingFiles) {
      for (const specifier of packageFiscalImports(readFileSync(file, "utf8"))) {
        violations.push(`${file}: ${specifier}`);
      }
    }
    expect(
      violations,
      `scanned ${files.length} API source files; Billing must not import @newsaas/fiscal`
    ).toEqual([]);
  });
});
