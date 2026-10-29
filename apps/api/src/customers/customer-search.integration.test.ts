import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import supertest from "supertest";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import { seedTwoTenants, type TwoTenantFixture } from "../../test/support/seed-two-tenants.js";
import { seedRbacActor, seedRoleWithKeys } from "../../test/support/rbac-fixture.js";
import { seedPortalAccess } from "../../test/support/seed-portal.js";
import { CustomerSearchService } from "./customer-search.service.js";

describe("Customer search HTTP authorization and strict validation", () => {
  let app: BootedTestApp, fixture: TwoTenantFixture;
  let readerCookie: string;
  const read = vi.fn(() =>
    Promise.resolve({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 })
  );
  beforeAll(async () => {
    app = await bootTestApp();
    fixture = seedTwoTenants(app.db);
    const role = seedRoleWithKeys(app.db, `CUSTOMER_SEARCH_${randomUUID()}`, "Customer reader", [
      "customers.read",
    ]);
    readerCookie = seedRbacActor(app.db, {
      tenantId: fixture.tenants.a.id,
      roleId: role.role.id,
    }).cookie;
    vi.spyOn(app.app.get(CustomerSearchService), "search").mockImplementation(read);
  });
  beforeEach(() => read.mockClear());
  afterAll(async () => {
    vi.restoreAllMocks();
    await app.close();
  });
  function request(body: object, cookie?: string) {
    const call = supertest(app.app.getHttpServer()).post("/customers/search");
    if (cookie) call.set("Cookie", cookie);
    return call.send(body);
  }
  it("requires authentication before handling search", async () => {
    await request({}).expect(401);
    expect(read).not.toHaveBeenCalled();
  });
  it("requires customers.read even with another read permission", async () => {
    const role = seedRoleWithKeys(app.db, `NO_CUSTOMER_SEARCH_${randomUUID()}`, "Other reader", [
      "sales.read",
    ]);
    const actor = seedRbacActor(app.db, { tenantId: fixture.tenants.a.id, roleId: role.role.id });
    await request({}, actor.cookie).expect(403);
    expect(read).not.toHaveBeenCalled();
  });
  it("requires an active tenant membership", async () => {
    await request({}, fixture.actors.suspendedA.cookie).expect(403);
    await request({}, fixture.actors.noMembership.cookie).expect(403);
    expect(read).not.toHaveBeenCalled();
  });
  it("does not admit a live Portal identity to the staff directory", async () => {
    const customer = app.db.prisma.customer.create({
      data: {
        tenantId: fixture.tenants.a.id,
        kind: "INDIVIDUAL",
        displayName: "Synthetic portal customer",
        legalName: null,
        taxId: null,
        firstName: null,
        lastName: null,
        documentNumber: null,
        isActive: true,
      },
    });
    const portal = seedPortalAccess(app.db, {
      tenantId: fixture.tenants.a.id,
      customerId: customer.id,
    });
    await request({}, portal.cookie).expect(401);
    expect(read).not.toHaveBeenCalled();
  });
  it.each([
    { q: "a" },
    { q: "x".repeat(81) },
    { q: 5 },
    { page: 0 },
    { page: 1.5 },
    { page: 10001 },
    { page: "2" },
    { status: "unknown" },
    { kind: "PET" },
    { sort: "name desc" },
    { tenantId: randomUUID() },
    { pageSize: 1000 },
    [],
  ])("rejects malformed input %j before the read", async (body) => {
    await request(body, readerCookie).expect(400);
    expect(read).not.toHaveBeenCalled();
  });
  it("uses safe defaults with only customers.read", async () => {
    await request({}, readerCookie).expect(200);
    expect(read).toHaveBeenCalledExactlyOnceWith({
      q: "",
      page: 1,
      status: "active",
      kind: "all",
      sort: "name",
    });
  });
  it("normalizes body fields and never logs the confidential search", async () => {
    await request(
      {
        q: "  ConfidentialCustomerNeedle  ",
        page: 2,
        kind: "COMPANY",
        status: "all",
        sort: "recent",
      },
      readerCookie
    ).expect(200);
    expect(read).toHaveBeenCalledExactlyOnceWith({
      q: "ConfidentialCustomerNeedle",
      page: 2,
      kind: "COMPANY",
      status: "all",
      sort: "recent",
    });
    expect(app.logLines().join("\n")).not.toContain("ConfidentialCustomerNeedle");
  });
});
