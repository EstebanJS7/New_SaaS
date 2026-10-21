import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createCustomerBody, createCustomerContactBody } from "@newsaas/customers";
import { resolveCustomerColumns } from "./customer-columns.js";
import type { CustomerColumnLayout } from "./customer-columns.js";
import { CUSTOMER_ROW_REJECTION_CODES, toCustomerRow } from "./customer-row.js";

function layoutOf(headers: readonly string[]): CustomerColumnLayout {
  const resolved = resolveCustomerColumns(headers);
  if (!resolved.ok) {
    throw new Error(resolved.message);
  }
  return resolved.layout;
}

const ALL_COLUMNS = [
  "display_name",
  "kind",
  "first_name",
  "last_name",
  "document_number",
  "legal_name",
  "tax_id",
  "phone",
  "email",
];

/**
 * One row's verdict ([[IMP-002]]). The rules are `@newsaas/customers`' rules, so
 * where a case is about a boundary the assertion compares against the SHARED
 * schema's own message instead of a copy of it.
 */
describe("toCustomerRow", () => {
  it("accepts a valid individual and creates no contact when there are none", () => {
    const result = toCustomerRow(["Ana Pérez"], layoutOf(["display_name"]));

    expect(result).toEqual({
      ok: true,
      input: { kind: "INDIVIDUAL", displayName: "Ana Pérez" },
      contacts: [],
    });
  });

  it("accepts a valid company declared by the kind column", () => {
    const result = toCustomerRow(
      ["Vet Co SA", "COMPANY", "Vet Co SA", "80012345-6"],
      layoutOf(["display_name", "kind", "legal_name", "tax_id"])
    );

    expect(result).toEqual({
      ok: true,
      input: {
        kind: "COMPANY",
        displayName: "Vet Co SA",
        legalName: "Vet Co SA",
        taxId: "80012345-6",
      },
      contacts: [],
    });
  });

  it("turns empty and whitespace-only cells into absent fields, never empty strings", () => {
    const result = toCustomerRow(
      ["  Ana  ", " ", "", "", "", "", "", "", ""],
      layoutOf(ALL_COLUMNS)
    );

    // Exact equality is the assertion: a `firstName: ""` or a
    // `legalName: undefined` key would both fail it.
    expect(result).toEqual({
      ok: true,
      input: { kind: "INDIVIDUAL", displayName: "Ana" },
      contacts: [],
    });
  });

  it("refuses a row that carries a company's legal name while its kind is absent", () => {
    const result = toCustomerRow(
      ["Vet Co SA", "", "", "", "", "Vet Co SA", "", "", ""],
      layoutOf(ALL_COLUMNS)
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(CUSTOMER_ROW_REJECTION_CODES.KIND_CONFLICT);
    expect(result.message).toContain("absent");
    expect(result.message).toContain("legal_name");
    expect(result.message).toContain("COMPANY");
  });

  it("refuses a row that carries a tax id while its kind is INDIVIDUAL", () => {
    const result = toCustomerRow(
      ["Ana", "INDIVIDUAL", "", "", "", "", "80012345-6", "", ""],
      layoutOf(ALL_COLUMNS)
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(CUSTOMER_ROW_REJECTION_CODES.KIND_CONFLICT);
    expect(result.message).toContain("INDIVIDUAL");
    expect(result.message).toContain("tax_id");
  });

  it("refuses a row the create contract rejects, with the contract's own message and path", () => {
    const displayName = "x".repeat(201);
    const contract = createCustomerBody.safeParse({ kind: "INDIVIDUAL", displayName });

    expect(contract.success).toBe(false);
    if (contract.success) return;

    const result = toCustomerRow([displayName], layoutOf(["display_name"]));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(CUSTOMER_ROW_REJECTION_CODES.CREATE_CONTRACT);
    expect(result.message).toContain("displayName");
    expect(result.message).toContain(contract.error.issues[0].message);
  });

  it("applies the create contract's boundary rather than a local guess", () => {
    expect(toCustomerRow(["x".repeat(200)], layoutOf(["display_name"])).ok).toBe(true);

    const refused = toCustomerRow(["x".repeat(201)], layoutOf(["display_name"]));
    expect(refused.ok).toBe(false);
  });

  it("does not case-fold the kind column: the contract's enum decides", () => {
    const contract = createCustomerBody.safeParse({ kind: "individual", displayName: "Ana" });

    expect(contract.success).toBe(false);
    if (contract.success) return;

    const result = toCustomerRow(["Ana", "individual"], layoutOf(["display_name", "kind"]));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(CUSTOMER_ROW_REJECTION_CODES.CREATE_CONTRACT);
    expect(result.message).toContain(contract.error.issues[0].message);
  });

  it("lets the create contract refuse a COMPANY row that carries individual fields", () => {
    const contract = createCustomerBody.safeParse({
      kind: "COMPANY",
      displayName: "Vet Co SA",
      legalName: "Vet Co SA",
      taxId: "80012345-6",
      firstName: "Ana",
    });

    expect(contract.success).toBe(false);
    if (contract.success) return;

    const result = toCustomerRow(
      ["Vet Co SA", "COMPANY", "Ana", "", "", "Vet Co SA", "80012345-6", "", ""],
      layoutOf(ALL_COLUMNS)
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(CUSTOMER_ROW_REJECTION_CODES.CREATE_CONTRACT);
    expect(result.message).toContain("firstName");
    expect(result.message).toContain(contract.error.issues[0].message);
  });

  it("creates a primary phone and a primary e-mail from the same row", () => {
    const result = toCustomerRow(
      ["Ana", "0981123456", "ana@example.com"],
      layoutOf(["display_name", "phone", "email"])
    );

    expect(result).toEqual({
      ok: true,
      input: { kind: "INDIVIDUAL", displayName: "Ana" },
      contacts: [
        { kind: "PHONE", value: "0981123456", isPrimary: true },
        { kind: "EMAIL", value: "ana@example.com", isPrimary: true },
      ],
    });
  });

  it("refuses a malformed phone with the contact contract's own message, naming the column", () => {
    const value = "0".repeat(256);
    const contract = createCustomerContactBody.safeParse({ kind: "PHONE", value, isPrimary: true });

    expect(contract.success).toBe(false);
    if (contract.success) return;

    const result = toCustomerRow(["Ana", value], layoutOf(["display_name", "phone"]));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(CUSTOMER_ROW_REJECTION_CODES.INVALID_PHONE);
    expect(result.message).toContain('"phone"');
    expect(result.message).toContain(contract.error.issues[0].message);
  });

  it("refuses a malformed e-mail with the contact contract's own message, naming the column", () => {
    const value = "x".repeat(256);
    const contract = createCustomerContactBody.safeParse({ kind: "EMAIL", value, isPrimary: true });

    expect(contract.success).toBe(false);
    if (contract.success) return;

    const result = toCustomerRow(["Ana", value], layoutOf(["display_name", "email"]));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(CUSTOMER_ROW_REJECTION_CODES.INVALID_EMAIL);
    expect(result.message).toContain('"email"');
    expect(result.message).toContain(contract.error.issues[0].message);
  });
});

describe("the row carries no second copy of a rule", () => {
  it("validates through the shared create contracts instead of declaring them", async () => {
    const [rowSource, packageJson] = await Promise.all([
      readFile(new URL("./customer-row.ts", import.meta.url), "utf8"),
      readFile(new URL("../package.json", import.meta.url), "utf8"),
    ]);

    expect(rowSource).toContain('from "@newsaas/customers"');
    expect(rowSource).toContain("createCustomerBody.safeParse");
    expect(rowSource).toContain("createCustomerContactBody.safeParse");
    expect(rowSource).not.toMatch(/z\.(object|string|enum|discriminatedUnion)/);
    expect(rowSource).not.toMatch(/\.max\(\s*\d+\s*\)/);

    const manifest = JSON.parse(packageJson) as { dependencies?: Record<string, string> };
    expect(manifest.dependencies?.zod).toBeUndefined();
  });
});
