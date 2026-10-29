import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import supertest from "supertest";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import {
  seedPatientHttp,
  type PatientHttpFixture,
} from "../../test/support/patient-http-fixture.js";
import { seedRbacActor, seedRoleWithKeys } from "../../test/support/rbac-fixture.js";
import { PatientSearchService } from "./patient-search.service.js";

describe("Patient search HTTP authorization and validation", () => {
  let app: BootedTestApp, fixture: PatientHttpFixture;
  const read = vi.fn(() =>
    Promise.resolve({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
      totalPages: 0,
      canReadGuardians: false,
    })
  );
  beforeAll(async () => {
    app = await bootTestApp();
    fixture = seedPatientHttp(app.db);
    vi.spyOn(app.app.get(PatientSearchService), "search").mockImplementation(read);
  });
  beforeEach(() => read.mockClear());
  afterAll(async () => {
    vi.restoreAllMocks();
    await app.close();
  });
  function request(body: object, cookie?: string) {
    const call = supertest(app.app.getHttpServer()).post("/patients/search");
    if (cookie) call.set("Cookie", cookie);
    return call.send(body);
  }
  it("requires an authenticated staff identity", async () => {
    await request({}).expect(401);
    expect(read).not.toHaveBeenCalled();
  });
  it("requires patients.read", async () => {
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
  it("does not require customers.read to access the patient-only list", async () => {
    const role = seedRoleWithKeys(app.db, `SEARCH_${randomUUID()}`, "Patient reader", [
      "patients.read",
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
    await request(body, fixture.a.actor.cookie).expect(400);
    expect(read).not.toHaveBeenCalled();
  });
  it("passes normalized safe fields and keeps search values out of logs", async () => {
    await request({ q: "  ConfidentialSearchNeedle  ", page: 2 }, fixture.a.actor.cookie).expect(
      200
    );
    expect(read).toHaveBeenCalledExactlyOnceWith({
      q: "ConfidentialSearchNeedle",
      page: 2,
      status: "active",
      sort: "name",
    });
    expect(app.logLines().join("\n")).not.toContain("ConfidentialSearchNeedle");
  });
});
