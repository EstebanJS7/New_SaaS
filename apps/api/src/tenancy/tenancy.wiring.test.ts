import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appModuleSource = readFileSync(new URL("../app.module.ts", import.meta.url), "utf8");
const tenancyModuleSource = readFileSync(new URL("./tenancy.module.ts", import.meta.url), "utf8");
const guardSource = readFileSync(new URL("./tenant-active.guard.ts", import.meta.url), "utf8");

/**
 * The D3 wire order (AuthGuard → TenantActiveGuard) is production behavior,
 * not an implementation detail: APP_GUARD enhancers execute in module
 * composition order, so TenantActiveGuard only sees an authentication-enriched
 * context when AppModule composes AuthModule BEFORE TenancyModule. This scan
 * pins that order; the runtime discrimination (403 on private routes vs
 * reachable /auth/* for the same membership-less session) lives in the
 * cross-tenant isolation suite.
 */
describe("tenancy guard wiring (design D3 order)", () => {
  it("composes TenancyModule AFTER AuthModule in AppModule", () => {
    const authIndex = appModuleSource.indexOf("AuthModule");
    const tenancyIndex = appModuleSource.indexOf("TenancyModule");
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
});
