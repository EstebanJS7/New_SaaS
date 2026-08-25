import { describe, expect, it } from "vitest";
import { DomainError } from "@newsaas/shared";
import { EntitlementsService, type TenantEntitlementDelegate } from "./entitlements.service.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "33333333-3333-4333-8333-333333333333";

/**
 * Structural fake reproducing the real delegate's contract: grants are rows
 * joined to a feature-code catalog; the relation filter resolves codes.
 */
function makeFakeDb(catalog: readonly string[]) {
  const featureIdByCode = new Map(catalog.map((code, index) => [code, `fc-${index}`]));
  const grants = new Set<string>(); // `${tenantId}:${code}`

  const delegate: TenantEntitlementDelegate & { grants: Set<string> } = {
    // Sync body (eslint require-await): awaiting a plain value keeps the
    // runtime contract identical to the real async delegate.
    findFirst: ({ where }) => {
      const code = where.featureCode.code;
      if (!featureIdByCode.has(code)) return Promise.resolve(null);
      return Promise.resolve(grants.has(`${where.tenantId}:${code}`) ? { id: "grant-row" } : null);
    },
    grants,
  };

  return delegate;
}

function makeService(delegate: TenantEntitlementDelegate): EntitlementsService {
  // DI is token-based (@Inject(PrismaService)), so the narrow fake plugs in
  // directly — no boundary cast needed.
  return new EntitlementsService({ tenantEntitlement: delegate });
}

describe("EntitlementsService.has truth table", () => {
  it("returns true for a granted known code", async () => {
    const db = makeFakeDb(["custom_branding"]);
    db.grants.add(`${TENANT}:custom_branding`);

    await expect(makeService(db).has(TENANT, "custom_branding")).resolves.toBe(true);
  });

  it("returns false for an ungranted known code", async () => {
    const db = makeFakeDb(["custom_branding"]);

    await expect(makeService(db).has(TENANT, "custom_branding")).resolves.toBe(false);
  });

  it("returns false WITHOUT throwing for an unknown feature code", async () => {
    const db = makeFakeDb(["veterinary"]);

    await expect(makeService(db).has(TENANT, "nonexistent_code")).resolves.toBe(false);
  });

  it("scopes grants per tenant — another tenant's grant does not leak", async () => {
    const db = makeFakeDb(["portal"]);
    db.grants.add(`${OTHER_TENANT}:portal`);

    await expect(makeService(db).has(TENANT, "portal")).resolves.toBe(false);
  });

  it("fails loud on malformed arguments (programmer error)", async () => {
    const service = makeService(makeFakeDb([]));

    await expect(service.has("not-a-uuid", "portal")).rejects.toBeInstanceOf(DomainError);
    await expect(service.has(TENANT, "UPPER_CASE")).rejects.toBeInstanceOf(DomainError);
  });
});

/**
 * OVERRIDE PRECEDENCE (design D8): the starter plan maps every seeded code
 * via plan_capability, yet mapping NEVER grants. Only explicit
 * tenant_entitlement rows decide — this is exactly what the fake encodes by
 * requiring a grant row even when the code exists in the catalog.
 */
describe("override precedence: plan mapping ≠ grant", () => {
  it("a fully plan-mapped catalog still answers false without an explicit grant", async () => {
    // All twelve PRD §10 codes exist (starter plan maps them all).
    const db = makeFakeDb([
      "veterinary",
      "inventory",
      "purchases",
      "sales",
      "cash",
      "billing",
      "fiscal",
      "portal",
      "whatsapp",
      "multi_branch",
      "advanced_reports",
      "custom_branding",
    ]);
    const service = makeService(db);

    for (const code of [
      "veterinary",
      "inventory",
      "purchases",
      "sales",
      "cash",
      "billing",
      "fiscal",
      "portal",
      "whatsapp",
      "multi_branch",
      "advanced_reports",
      "custom_branding",
    ]) {
      await expect(service.has(TENANT, code)).resolves.toBe(false);
    }
  });

  it("adding one explicit grant flips only that code to true", async () => {
    const db = makeFakeDb(["custom_branding", "portal"]);
    const service = makeService(db);

    await expect(service.has(TENANT, "custom_branding")).resolves.toBe(false);
    db.grants.add(`${TENANT}:custom_branding`);
    await expect(service.has(TENANT, "custom_branding")).resolves.toBe(true);
    await expect(service.has(TENANT, "portal")).resolves.toBe(false);
  });
});
