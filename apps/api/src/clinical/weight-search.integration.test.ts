import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import supertest from "supertest";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import { seedTwoTenants, type TwoTenantFixture } from "../../test/support/seed-two-tenants.js";
import { seedRbacActor, seedRoleWithKeys } from "../../test/support/rbac-fixture.js";
import { seedPortalAccess } from "../../test/support/seed-portal.js";
import { WeightSearchService } from "./weight-search.service.js";

describe("Weight search HTTP authorization and strict validation", () => {
  let app: BootedTestApp, fixture: TwoTenantFixture;
  let readerCookie: string;
  const read = vi.fn(() =>
    Promise.resolve({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 })
  );
  beforeAll(async () => {
    app = await bootTestApp();
    fixture = seedTwoTenants(app.db);
    const role = seedRoleWithKeys(app.db, `WEIGHT_SEARCH_${randomUUID()}`, "Weight reader", [
      "vet.clinical.read",
    ]);
    readerCookie = seedRbacActor(app.db, {
      tenantId: fixture.tenants.a.id,
      roleId: role.role.id,
    }).cookie;
    vi.spyOn(app.app.get(WeightSearchService), "search").mockImplementation(read);
  });
  beforeEach(() => read.mockClear());
  afterAll(async () => {
    vi.restoreAllMocks();
    await app.close();
  });
  function request(body: object, cookie?: string) {
    const call = supertest(app.app.getHttpServer()).post(
      "/patients/11111111-1111-4111-8111-111111111111/clinical/weights/search"
    );
    if (cookie) call.set("Cookie", cookie);
    return call.send(body);
  }
  it("protects detail with the same staff and clinical-read gates", async () => {
    const path =
      "/patients/11111111-1111-4111-8111-111111111111/clinical/weights/22222222-2222-4222-8222-222222222222";
    await supertest(app.app.getHttpServer()).get(path).expect(401);
    await supertest(app.app.getHttpServer())
      .get(path)
      .set("Cookie", fixture.actors.suspendedA.cookie)
      .expect(403);
    const role = seedRoleWithKeys(app.db, `WEIGHT_OTHER_${randomUUID()}`, "Other reader", [
      "patients.read",
    ]);
    const actor = seedRbacActor(app.db, { tenantId: fixture.tenants.a.id, roleId: role.role.id });
    await supertest(app.app.getHttpServer()).get(path).set("Cookie", actor.cookie).expect(403);
    const detail = {
      id: "22222222-2222-4222-8222-222222222222",
      quantity: "12.345",
      unit: null,
      measuredAt: "2026-10-01T12:00:00.000Z",
    };
    const spy = vi.spyOn(app.app.get(WeightSearchService), "get").mockResolvedValue(detail);
    try {
      const response = await supertest(app.app.getHttpServer())
        .get(path)
        .set("Cookie", readerCookie)
        .expect(200);
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(response.body).toEqual(detail);
      expect(spy).toHaveBeenCalledExactlyOnceWith(
        "11111111-1111-4111-8111-111111111111",
        detail.id
      );
    } finally {
      spy.mockRestore();
    }
  });
  it("rejects malformed patient and weight identifiers", async () => {
    await supertest(app.app.getHttpServer())
      .post("/patients/invalid/clinical/weights/search")
      .set("Cookie", readerCookie)
      .send({})
      .expect(400);
    await supertest(app.app.getHttpServer())
      .get("/patients/11111111-1111-4111-8111-111111111111/clinical/weights/invalid")
      .set("Cookie", readerCookie)
      .expect(400);
    expect(read).not.toHaveBeenCalled();
  });
  it("requires authentication before handling search", async () => {
    await request({}).expect(401);
    expect(read).not.toHaveBeenCalled();
  });
  it("requires vet.clinical.read even with another read permission", async () => {
    const role = seedRoleWithKeys(app.db, `NO_WEIGHT_SEARCH_${randomUUID()}`, "Other reader", [
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
    { unit: "LB" },
    { unit: null },
    { unit: "all", minQuantity: "1" },
    { q: "not supported" },
    { minQuantity: 2 },
    { minQuantity: "0" },
    { maxQuantity: "0.000" },
    { minQuantity: "-1" },
    { minQuantity: "1e2" },
    { maxQuantity: "10000000" },
    { minQuantity: "0.0001" },
    { minQuantity: "1,5" },
    { minQuantity: "NaN" },
    { maxQuantity: null },
    { minQuantity: "2.001", maxQuantity: "2.000" },
    { page: 0 },
    { page: 1.5 },
    { page: 10001 },
    { page: "2" },
    { period: "unknown" },
    { sort: "name desc" },
    { tenantId: randomUUID() },
    { pageSize: 1000 },
    [],
  ])("rejects malformed input %j before the read", async (body) => {
    await request(body, readerCookie).expect(400);
    expect(read).not.toHaveBeenCalled();
  });
  it("uses safe defaults with only vet.clinical.read", async () => {
    const response = await request({}, readerCookie).expect(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(read).toHaveBeenCalledExactlyOnceWith("11111111-1111-4111-8111-111111111111", {
      page: 1,
      period: "all",
      sort: "recent",
    });
  });
  it("forwards an explicit KG range without inferring or converting values", async () => {
    await request(
      { unit: "KG", minQuantity: "0.001", maxQuantity: "9999999.999" },
      readerCookie
    ).expect(200);
    expect(read).toHaveBeenCalledExactlyOnceWith("11111111-1111-4111-8111-111111111111", {
      page: 1,
      period: "all",
      sort: "recent",
      unit: "KG",
      minQuantity: "0.001",
      maxQuantity: "9999999.999",
    });
  });
  it("normalizes body fields and never logs the confidential search", async () => {
    await request(
      {
        minQuantity: "  9999999.998  ",
        maxQuantity: "9999999.999",
        page: 2,
        period: "last30",
        sort: "recent",
      },
      readerCookie
    ).expect(200);
    expect(read).toHaveBeenCalledExactlyOnceWith("11111111-1111-4111-8111-111111111111", {
      minQuantity: "9999999.998",
      maxQuantity: "9999999.999",
      page: 2,
      period: "last30",
      sort: "recent",
    });
    expect(app.logLines().join("\n")).not.toContain("9999999.998");
  });
});
