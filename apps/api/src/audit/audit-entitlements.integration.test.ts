import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import { AuditWriter } from "../audit/audit-writer.service.js";
import { EntitlementsService } from "../entitlements/entitlements.service.js";

const TENANT_A_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_B_ID = "22222222-2222-4222-8222-222222222222";

/**
 * Slice S6 integration proof through the REAL production composition
 * (bootTestApp boots AppModule + the real adapter factory): both boundaries
 * are DI-reachable exactly as they ship, and their delegate contracts behave
 * against the shared in-memory boundary. Request-correlated audit emission
 * over live HTTP is proven separately by the auth-flow integration suite.
 */
describe("audit + entitlements wiring (real AppModule)", () => {
  let booted: BootedTestApp;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    booted = await bootTestApp();
    app = booted.app;
  });

  afterAll(async () => {
    await booted.close();
  });

  it("AuditWriter is reachable from the container and persists append-only rows", async () => {
    const writer = app.get(AuditWriter);

    const appended = await writer.append({
      action: "integration.probe",
      tenantId: TENANT_A_ID,
      metadata: { source: "suite" },
    });

    expect(appended.actorType).toBe("SYSTEM"); // no actor attribution given
    const stored = booted.db.prisma.auditLog.findFirst({
      where: { action: "integration.probe" },
    });
    expect(stored).not.toBeNull();
    expect(stored?.metadata).toEqual({ source: "suite" });
    // Outside any request scope the writer still fills a generated UUID so
    // rows stay traceable (RequestContextService fallback contract).
    expect(typeof stored?.requestId).toBe("string");
    expect((stored?.requestId ?? "").length).toBeGreaterThan(0);
    expect(booted.db.tables.audits.size).toBe(1);
  });

  it("EntitlementsService resolves grants with plan≠grant precedence and per-tenant scoping", async () => {
    const service = app.get(EntitlementsService);

    const branding = booted.db.prisma.featureCode.create({ data: { code: "custom_branding" } });
    booted.db.prisma.featureCode.create({ data: { code: "portal" } });

    // Catalog present but NO grants yet: mapping alone never grants (D8).
    await expect(service.has(TENANT_A_ID, "custom_branding")).resolves.toBe(false);
    await expect(service.has(TENANT_A_ID, "portal")).resolves.toBe(false);

    booted.db.prisma.tenantEntitlement.create({
      data: { tenantId: TENANT_A_ID, featureCodeId: branding.id },
    });

    await expect(service.has(TENANT_A_ID, "custom_branding")).resolves.toBe(true);
    await expect(service.has(TENANT_A_ID, "portal")).resolves.toBe(false);
    // Tenant B holds no grants even though tenant A now does.
    await expect(service.has(TENANT_B_ID, "custom_branding")).resolves.toBe(false);
  });
});
