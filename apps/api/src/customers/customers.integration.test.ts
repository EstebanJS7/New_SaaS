import { afterAll, beforeAll, describe, expect, it } from "vitest";
import assert from "node:assert";
import supertest from "supertest";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import { seedRoleWithKeys } from "../../test/support/rbac-fixture.js";
import { insertLiveStaffSession } from "../../test/support/seed-two-tenants.js";

interface CustomerDto {
  id: string;
  tenantId: string;
  kind: string;
  displayName: string;
  legalName: string | null;
  taxId: string | null;
  firstName: string | null;
  lastName: string | null;
  documentNumber: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface CustomerAddressDto {
  id: string;
  tenantId: string;
  customerId: string;
  label: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  countryCode: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface CustomerContactDto {
  id: string;
  tenantId: string;
  customerId: string;
  kind: "EMAIL" | "PHONE";
  label: string | null;
  value: string;
  isPrimary: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ErrorDto {
  error: { code: string };
}

interface AuditRow {
  action: string;
  targetId: string;
  metadata: Record<string, unknown>;
}

const CUSTOMER_RESPONSE_KEYS: readonly string[] = [
  "id",
  "tenantId",
  "kind",
  "displayName",
  "legalName",
  "taxId",
  "firstName",
  "lastName",
  "documentNumber",
  "isActive",
  "createdAt",
  "updatedAt",
];

describe("Customers HTTP boundary", () => {
  let booted: BootedTestApp;
  let tenantAId: string;
  let ownerCookie: string;
  let readOnlyCookie: string;
  let noAccessCookie: string;
  let foreignOwnerCookie: string;
  let customerAId: string;

  beforeAll(async () => {
    booted = await bootTestApp();
    const db = booted.db;

    const tenantA = db.prisma.tenant.create({ data: { slug: "cust-a", name: "A" } });
    const tenantB = db.prisma.tenant.create({ data: { slug: "cust-b", name: "B" } });
    tenantAId = tenantA.id;

    const ownerRole = seedRoleWithKeys(db, "CUSTOMER_OWNER", "Customer Owner", [
      "customers.read",
      "customers.create",
      "customers.update",
      "customers.deactivate",
      "customers.address.manage",
      "customers.contact.manage",
    ]);
    const readOnlyRole = seedRoleWithKeys(db, "CUSTOMER_READ", "Customer Read", ["customers.read"]);
    const noAccessRole = seedRoleWithKeys(db, "CUSTOMER_NONE", "Customer None", []);

    function profile(email: string) {
      return db.prisma.userProfile.create({
        data: { email, displayName: email, status: "active" },
      });
    }

    const owner = profile("owner@cust.test");
    const readOnly = profile("readonly@cust.test");
    const noAccess = profile("none@cust.test");
    const foreignOwner = profile("foreign@cust.test");

    db.prisma.tenantMembership.create({
      data: {
        tenantId: tenantA.id,
        userProfileId: owner.id,
        roleId: ownerRole.role.id,
        status: "ACTIVE",
      },
    });
    db.prisma.tenantMembership.create({
      data: {
        tenantId: tenantA.id,
        userProfileId: readOnly.id,
        roleId: readOnlyRole.role.id,
        status: "ACTIVE",
      },
    });
    db.prisma.tenantMembership.create({
      data: {
        tenantId: tenantA.id,
        userProfileId: noAccess.id,
        roleId: noAccessRole.role.id,
        status: "ACTIVE",
      },
    });
    db.prisma.tenantMembership.create({
      data: {
        tenantId: tenantB.id,
        userProfileId: foreignOwner.id,
        roleId: ownerRole.role.id,
        status: "ACTIVE",
      },
    });

    ownerCookie = insertLiveStaffSession(db, owner.id).cookie;
    readOnlyCookie = insertLiveStaffSession(db, readOnly.id).cookie;
    noAccessCookie = insertLiveStaffSession(db, noAccess.id).cookie;
    foreignOwnerCookie = insertLiveStaffSession(db, foreignOwner.id).cookie;
  });

  afterAll(async () => {
    await booted.close();
  });

  it("GET /customers requires customers.read", async () => {
    await supertest(booted.app.getHttpServer())
      .get("/customers")
      .set("Cookie", noAccessCookie)
      .expect(403);
  });

  it("creates a customer and returns an exact allowlisted DTO", async () => {
    const response = await supertest(booted.app.getHttpServer())
      .post("/customers")
      .set("Cookie", ownerCookie)
      .send({ kind: "INDIVIDUAL", displayName: "Ana" })
      .expect(201);
    const body = response.body as CustomerDto;
    customerAId = body.id;
    expect(body).toHaveProperty("id");
    expect(body).toHaveProperty("tenantId", tenantAId);
    expect(Object.keys(body).sort()).toEqual(CUSTOMER_RESPONSE_KEYS.slice().sort());
    expect(response.body as CustomerDto).not.toHaveProperty("internalNotes");

    const audit = [...booted.db.tables.audits.values()].find(
      (row) => (row as AuditRow).action === "customer.created"
    ) as AuditRow | undefined;
    assert(audit);
    expect(audit.targetId).toBe(customerAId);
    expect(audit.metadata).not.toHaveProperty("displayName");
  });

  it("lists active customers only", async () => {
    const list = await supertest(booted.app.getHttpServer())
      .get("/customers")
      .set("Cookie", ownerCookie)
      .expect(200);
    const body = list.body as CustomerDto[];
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(customerAId);
  });

  it("rejects a COMPANY customer missing required company fields", async () => {
    await supertest(booted.app.getHttpServer())
      .post("/customers")
      .set("Cookie", ownerCookie)
      .send({ kind: "COMPANY", displayName: "Paws S.A." })
      .expect(400);
  });

  it("rejects an INDIVIDUAL customer with company-only taxId", async () => {
    await supertest(booted.app.getHttpServer())
      .post("/customers")
      .set("Cookie", ownerCookie)
      .send({ kind: "INDIVIDUAL", displayName: "Ana", taxId: "123" })
      .expect(400);
  });

  it("prevents create without customers.create", async () => {
    await supertest(booted.app.getHttpServer())
      .post("/customers")
      .set("Cookie", readOnlyCookie)
      .send({ kind: "INDIVIDUAL", displayName: "Eve" })
      .expect(403);
  });

  it("masks cross-tenant reads as 404", async () => {
    const response = await supertest(booted.app.getHttpServer())
      .get(`/customers/${customerAId}`)
      .set("Cookie", foreignOwnerCookie)
      .expect(404);
    const body = response.body as ErrorDto;
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("rejects kind-mismatched updates", async () => {
    await supertest(booted.app.getHttpServer())
      .put(`/customers/${customerAId}`)
      .set("Cookie", ownerCookie)
      .send({ taxId: "123" })
      .expect(400);
  });

  it("updates a customer and co-commits exactly one audit row", async () => {
    const beforeAuditCount = booted.db.tables.audits.size;

    const response = await supertest(booted.app.getHttpServer())
      .put(`/customers/${customerAId}`)
      .set("Cookie", ownerCookie)
      .send({ displayName: "Ana María" })
      .expect(200);

    const body = response.body as CustomerDto;
    expect(body.displayName).toBe("Ana María");
    expect(booted.db.tables.audits.size).toBe(beforeAuditCount + 1);

    const audit = [...booted.db.tables.audits.values()].find(
      (row) => (row as AuditRow).action === "customer.updated"
    ) as AuditRow | undefined;
    assert(audit);
    expect(audit.targetId).toBe(customerAId);
    expect(audit.metadata).toMatchObject({ changedFields: ["displayName"] });
  });

  it("deactivates a customer and excludes it from default lists", async () => {
    await supertest(booted.app.getHttpServer())
      .post(`/customers/${customerAId}/deactivate`)
      .set("Cookie", ownerCookie)
      .send({})
      .expect(201);

    const list = await supertest(booted.app.getHttpServer())
      .get("/customers")
      .set("Cookie", ownerCookie)
      .expect(200);
    expect(list.body as CustomerDto[]).toHaveLength(0);

    const audit = [...booted.db.tables.audits.values()].find(
      (row) => (row as AuditRow).action === "customer.deactivated"
    ) as AuditRow | undefined;
    assert(audit);
    expect(audit.metadata).toMatchObject({ changedFields: ["isActive"] });
    expect(audit.metadata).not.toHaveProperty("reason");
  });

  it("enforces all six customer permission gates", async () => {
    // Re-use tenant A but seed a role with only read to prove per-key gates.
    const readCreateRole = seedRoleWithKeys(booted.db, "CUSTOMER_READ_CREATE", "Read+Create", [
      "customers.read",
      "customers.create",
    ]);
    const limitedProfile = booted.db.prisma.userProfile.create({
      data: { email: "limited@cust.test", displayName: "Limited", status: "active" },
    });
    booted.db.prisma.tenantMembership.create({
      data: {
        tenantId: tenantAId,
        userProfileId: limitedProfile.id,
        roleId: readCreateRole.role.id,
        status: "ACTIVE",
      },
    });
    const limitedCookie = insertLiveStaffSession(booted.db, limitedProfile.id).cookie;

    const cases = [
      {
        method: "GET" as const,
        path: "/customers",
        cookie: readOnlyCookie,
        expected: 200,
        label: "customers.read",
      },
      {
        method: "POST" as const,
        path: "/customers",
        body: { kind: "INDIVIDUAL", displayName: "Gate" },
        cookie: readOnlyCookie,
        expected: 403,
        label: "customers.create denied",
      },
      {
        method: "POST" as const,
        path: "/customers",
        body: { kind: "INDIVIDUAL", displayName: "Gate" },
        cookie: limitedCookie,
        expected: 201,
        label: "customers.create allowed",
      },
      {
        method: "PUT" as const,
        path: `/customers/${customerAId}`,
        body: { displayName: "No" },
        cookie: limitedCookie,
        expected: 403,
        label: "customers.update denied",
      },
      {
        method: "POST" as const,
        path: `/customers/${customerAId}/deactivate`,
        cookie: limitedCookie,
        expected: 403,
        label: "customers.deactivate denied",
      },
      {
        method: "POST" as const,
        path: `/customers/${customerAId}/addresses`,
        body: { line1: "No" },
        cookie: limitedCookie,
        expected: 403,
        label: "customers.address.manage denied",
      },
      {
        method: "POST" as const,
        path: `/customers/${customerAId}/contacts`,
        body: { kind: "EMAIL", value: "no@test.test" },
        cookie: limitedCookie,
        expected: 403,
        label: "customers.contact.manage denied",
      },
    ];

    for (const scenario of cases) {
      const request = supertest(booted.app.getHttpServer())
        [scenario.method.toLowerCase() as "get" | "post" | "put"](scenario.path)
        .set("Cookie", scenario.cookie);
      if (scenario.body) {
        request.send(scenario.body);
      }
      await request.expect(scenario.expected);
    }
  });

  it("manages addresses under a customer with tenant isolation", async () => {
    const create = await supertest(booted.app.getHttpServer())
      .post(`/customers/${customerAId}/addresses`)
      .set("Cookie", ownerCookie)
      .send({ label: "Billing", line1: "Calle Falsa 123", city: "Buenos Aires" })
      .expect(201);
    const address = create.body as CustomerAddressDto;
    expect(address.tenantId).toBe(tenantAId);
    expect(address.customerId).toBe(customerAId);
    expect(address.label).toBe("Billing");
    expect(address.line1).toBe("Calle Falsa 123");

    await supertest(booted.app.getHttpServer())
      .get(`/customers/${customerAId}/addresses/${address.id}`)
      .set("Cookie", ownerCookie)
      .expect(200);

    const foreign = await supertest(booted.app.getHttpServer())
      .get(`/customers/${customerAId}/addresses/${address.id}`)
      .set("Cookie", foreignOwnerCookie)
      .expect(404);
    expect((foreign.body as ErrorDto).error.code).toBe("NOT_FOUND");

    await supertest(booted.app.getHttpServer())
      .post(`/customers/${customerAId}/addresses/${address.id}/deactivate`)
      .set("Cookie", ownerCookie)
      .send({})
      .expect(201);
  });

  it("manages contacts under a customer with tenant isolation", async () => {
    const create = await supertest(booted.app.getHttpServer())
      .post(`/customers/${customerAId}/contacts`)
      .set("Cookie", ownerCookie)
      .send({ kind: "PHONE", value: "+54 9 11 1234-5678" })
      .expect(201);
    const contact = create.body as CustomerContactDto;
    expect(contact.tenantId).toBe(tenantAId);
    expect(contact.customerId).toBe(customerAId);
    expect(contact.kind).toBe("PHONE");
    expect(contact.value).toBe("+54 9 11 1234-5678");

    await supertest(booted.app.getHttpServer())
      .get(`/customers/${customerAId}/contacts/${contact.id}`)
      .set("Cookie", ownerCookie)
      .expect(200);

    const foreign = await supertest(booted.app.getHttpServer())
      .get(`/customers/${customerAId}/contacts/${contact.id}`)
      .set("Cookie", foreignOwnerCookie)
      .expect(404);
    expect((foreign.body as ErrorDto).error.code).toBe("NOT_FOUND");

    await supertest(booted.app.getHttpServer())
      .post(`/customers/${customerAId}/contacts/${contact.id}/deactivate`)
      .set("Cookie", ownerCookie)
      .send({})
      .expect(201);
  });
});
