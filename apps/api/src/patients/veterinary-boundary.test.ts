import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PERMISSION_SEEDS } from "@newsaas/database";
import { PATIENT_PERMISSIONS } from "./patients.permissions.js";

const API_SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..");

function walkSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkSourceFiles(full));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(full);
    }
  }
  return files;
}

/** Matches an ES import/export or a CommonJS require that targets `/patients/`. */
const PATIENTS_IMPORT = /(?:from|require\()\s*\(?["'][^"']*\/patients\//;

describe("Veterinary Patients boundary", () => {
  it("is imported by no Core module (Veterinary is a leaf)", () => {
    const violations: string[] = [];
    for (const file of walkSourceFiles(API_SRC)) {
      if (file.includes(`${join("src", "patients")}`)) continue;
      const content = readFileSync(file, "utf-8");
      if (PATIENTS_IMPORT.test(content)) {
        violations.push(file);
      }
    }
    expect(violations).toEqual([]);
  });

  it("declares only permission keys present in the seed-owned catalog", () => {
    const seeded = new Set(PERMISSION_SEEDS.map((permission) => permission.key));
    for (const key of Object.values(PATIENT_PERMISSIONS)) {
      expect(seeded.has(key)).toBe(true);
    }
  });
});
