import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appModuleSource = readFileSync(new URL("../app.module.ts", import.meta.url), "utf8");
const tenancyModuleSource = readFileSync(new URL("./tenancy.module.ts", import.meta.url), "utf8");
const guardSource = readFileSync(new URL("./tenant-active.guard.ts", import.meta.url), "utf8");
const rbacModuleSource = readFileSync(new URL("../rbac/rbac.module.ts", import.meta.url), "utf8");

/**
 * The D3 wire order (AuthGuard → TenantActiveGuard) is production behavior,
 * not an implementation detail: APP_GUARD enhancers execute in module
 * composition order, so TenantActiveGuard only sees an authentication-enriched
 * context when AppModule composes AuthModule BEFORE TenancyModule. This scan
 * pins that order; the runtime discrimination (403 on private routes vs
 * reachable /auth/* for the same membership-less session) lives in the
 * cross-tenant isolation suite.
 *
 * EPIC-02 extends the pin to the full three-link chain (design D1):
 * Auth < Tenancy < Rbac — the PermissionGuard must never evaluate a context
 * that tenant resolution has not already enriched.
 */
/**
 * Extracts the AppModule `imports: [...]` composition array — the ONLY place
 * where APP_GUARD registration order is decided. Plain-text indexOf over the
 * whole file would false-positive on ES import statements, which follow lint
 * sorting instead of runtime composition order.
 */
function appImportsArray(): string {
  const anchor = appModuleSource.indexOf("imports:");
  expect(anchor).toBeGreaterThan(-1);
  const openBracket = appModuleSource.indexOf("[", anchor);
  const closeBracket = appModuleSource.indexOf("]", openBracket);
  expect(openBracket).toBeGreaterThan(-1);
  expect(closeBracket).toBeGreaterThan(openBracket);
  return appModuleSource.slice(openBracket, closeBracket);
}

describe("tenancy guard wiring (design D3 order)", () => {
  it("composes TenancyModule AFTER AuthModule in AppModule", () => {
    const imports = appImportsArray();
    const authIndex = imports.indexOf("AuthModule");
    const tenancyIndex = imports.indexOf("TenancyModule");
    expect(authIndex).toBeGreaterThan(-1);
    expect(tenancyIndex).toBeGreaterThan(authIndex);
  });

  it("registers TenantActiveGuard as a global APP_GUARD", () => {
    expect(tenancyModuleSource).toContain("APP_GUARD");
    expect(tenancyModuleSource).toContain("TenantActiveGuard");
  });

  it("keeps both D3 skip rules in the guard surface", () => {
    // @Public parity with AuthGuard...
    expect(guardSource).toContain("IS_PUBLIC_ROUTE_KEY");
    // ...and the /auth/* opt-out for membership-less sessions.
    expect(guardSource).toMatch(/AUTH_ROUTE_SEGMENT/);
  });

  it("pins the EPIC-02 three-link order: Auth < Tenancy < Rbac", () => {
    const imports = appImportsArray();
    const authIndex = imports.indexOf("AuthModule");
    const tenancyIndex = imports.indexOf("TenancyModule");
    const rbacIndex = imports.indexOf("RbacModule");
    expect(rbacIndex).toBeGreaterThan(-1);
    expect(rbacIndex).toBeGreaterThan(tenancyIndex);
    expect(tenancyIndex).toBeGreaterThan(authIndex);
  });

  it("registers PermissionGuard as a global APP_GUARD after the tenancy link", () => {
    expect(rbacModuleSource).toContain("APP_GUARD");
    expect(rbacModuleSource).toContain("PermissionGuard");
  });
});
