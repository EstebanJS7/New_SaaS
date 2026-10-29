import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import supertest from "supertest";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import {
  seedPatientHttp,
  type PatientHttpFixture,
} from "../../test/support/patient-http-fixture.js";
import { seedRbacActor, seedRoleWithKeys } from "../../test/support/rbac-fixture.js";
import { SaleSearchService } from "./sale-search.service.js";

describe("Sale search HTTP authorization and validation", () => {
  let app: BootedTestApp, fixture: PatientHttpFixture;
  let readerCookie: string;
  const read = vi.fn(() =>
    Promise.resolve({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
      totalPages: 0,
      canReadCustomers: false,
    })
  );
  beforeAll(async () => {
    app = await bootTestApp();
    fixture = seedPatientHttp(app.db);
    const role = seedRoleWithKeys(app.db, `SALES_SEARCH_${randomUUID()}`, "Sales reader", [
      "sales.read",
      "customers.read",
    ]);
    readerCookie = seedRbacActor(app.db, {
      email: `${randomUUID()}@search.test`,
      tenantId: fixture.a.tenant.id,
      roleId: role.role.id,
    }).cookie;
    vi.spyOn(app.app.get(SaleSearchService), "search").mockImplementation(read);
  });
  beforeEach(() => read.mockClear());
  afterAll(async () => {
    vi.restoreAllMocks();
    await app.close();
  });
  function request(body: object, cookie?: string) {
    const call = supertest(app.app.getHttpServer()).post("/sales/search");
    if (cookie) call.set("Cookie", cookie);
    return call.send(body);
  }
  it("requires an authenticated staff identity", async () => {
    await request({}).expect(401);
    expect(read).not.toHaveBeenCalled();
  });
  it("requires sales.read", async () => {
    const role = seedRoleWithKeys(app.db, `SEARCH_${randomUUID()}`, "Synthetic search", [
      "customers.read",
    ]);
    const actor = seedRbacActor(app.db, {
      email: `${randomUUID()}@search.test`,
      tenantId: fixture.a.tenant.id,
      roleId: role.role.id,
    });
    await request({}, actor.cookie).expect(403);
    expect(read).not.toHaveBeenCalled();
  });
  it("does not require customers.read to access the sale-only list", async () => {
    const role = seedRoleWithKeys(app.db, `SEARCH_${randomUUID()}`, "Patient reader", [
      "sales.read",
    ]);
    const actor = seedRbacActor(app.db, {
      email: `${randomUUID()}@search.test`,
      tenantId: fixture.a.tenant.id,
      roleId: role.role.id,
    });
    await request({}, actor.cookie).expect(200);
    expect(read).toHaveBeenCalledOnce();
  });
  it.each([
    { q: "a" },
    { q: "x".repeat(81) },
    { page: 0 },
    { page: 1.5 },
    { page: 10001 },
    { page: "2" },
    { status: "unknown" },
    { sort: "name desc" },
    { tenantId: randomUUID() },
    { pageSize: 1000 },
  ])("rejects invalid body %j", async (body) => {
    await request(body, readerCookie).expect(400);
    expect(read).not.toHaveBeenCalled();
  });
  it("passes normalized safe fields and keeps search values out of logs", async () => {
    await request({ q: "  ConfidentialSearchNeedle  ", page: 2 }, readerCookie).expect(200);
    expect(read).toHaveBeenCalledExactlyOnceWith({
      q: "ConfidentialSearchNeedle",
      page: 2,
      status: "all",
      sort: "recent",
    });
    expect(app.logLines().join("\n")).not.toContain("ConfidentialSearchNeedle");
  });
});
