import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import { seedTwoTenants, type TwoTenantFixture } from "../../test/support/seed-two-tenants.js";
import { seedPortalAccess, type PortalAccessFixture } from "../../test/support/seed-portal.js";
import { REQUEST_ID_HEADER } from "../common/errors/request-id.js";
import { PORTAL_NOT_FOUND_MESSAGE } from "./portal-holder-scope.js";

interface ErrorEnvelopeBody {
  error: { code: string; message: string; requestId: string };
}

interface ProfileBody {
  phone: string | null;
  address: {
    label: string | null;
    line1: string | null;
    line2: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    countryCode: string | null;
  } | null;
}

/** Exact allowlisted response surface of `GET`/`PUT /portal/profile`. */
const PROFILE_KEYS = ["address", "phone"];
const ADDRESS_KEYS = ["city", "countryCode", "label", "line1", "line2", "postalCode", "state"];

/** Stable action code the audit row must carry (pinned, not imported). */
const PROFILE_ACTION = "portal_profile.updated";

/** Distinctive CONFIDENTIAL markers: none may reach audit metadata or logs. */
const PHONE_MARKER = "+595981555777";
const LINE1_MARKER = "SECRET-STREET-7a31";
const CITY_MARKER = "SECRET-CITY-4b02";

interface HolderFixture {
  customerId: string;
  holder: PortalAccessFixture;
}

/**
 * EPIC-08 WU4C — holder profile self-service over real HTTP and the full guard
 * chain (AppModule + AppGuards + in-memory Prisma boundary).
 *
 * Proves: session-derived tenant/Customer scoping with NO client-supplied
 * target, a strict payload that rejects every staff-owned field, the phone
 * "exactly one primary" upsert plus the additive address upsert, exactly one
 * co-committed PORTAL audit row carrying field names and ids but no
 * CONFIDENTIAL value, and the absence of side effects on anyone else's rows.
 */
describe("portal profile self-service (real HTTP, full guard chain)", () => {
  let booted: BootedTestApp;
  let fixture: TwoTenantFixture;
  let tenantA: string;
  let tenantB: string;

  let holderB: PortalAccessFixture;
  let holderFresh: HolderFixture;
  let holderMain: HolderFixture;
  let holderDrift: HolderFixture;
  let holderMulti: HolderFixture;
  let holderReject: HolderFixture;
  let holderScope: HolderFixture;
  let holderSecret: HolderFixture;
  let holderGhost: HolderFixture;
  let holderClear: HolderFixture;
  let holderClearMulti: HolderFixture;
  let foreignCustomerId: string;

  const prismaRef = (): BootedTestApp["db"]["prisma"] => booted.db.prisma;

  beforeAll(async () => {
    booted = await bootTestApp();
    fixture = seedTwoTenants(booted.db);
    const prisma = prismaRef();
    tenantA = fixture.tenants.a.id;
    tenantB = fixture.tenants.b.id;

    const createCustomer = (tenantId: string, displayName: string): string =>
      prisma.customer.create({
        data: {
          tenantId,
          kind: "INDIVIDUAL",
          displayName,
          legalName: null,
          taxId: null,
          firstName: null,
          lastName: null,
          documentNumber: null,
          isActive: true,
        },
      }).id;

    const createHolder = (displayName: string): HolderFixture => {
      const customerId = createCustomer(tenantA, displayName);
      return { customerId, holder: seedPortalAccess(booted.db, { tenantId: tenantA, customerId }) };
    };

    holderFresh = createHolder("Fresh Holder Customer");
    holderMain = createHolder("Main Holder Customer");
    holderDrift = createHolder("Drift Holder Customer");
    holderMulti = createHolder("Multi-address Holder Customer");
    holderReject = createHolder("Reject Holder Customer");
    holderScope = createHolder("Scope Holder Customer");
    holderSecret = createHolder("Secret Holder Customer");
    holderClear = createHolder("Clear Holder Customer");
    holderClearMulti = createHolder("Clear Multi Holder Customer");

    // A live portal session whose Customer row does not exist: the guard
    // authenticates from the access row, so the service must mask it.
    const ghostCustomerId = randomUUID();
    holderGhost = {
      customerId: ghostCustomerId,
      holder: seedPortalAccess(booted.db, { tenantId: tenantA, customerId: ghostCustomerId }),
    };

    // Entitled-less tenant holder.
    const customerB = createCustomer(tenantB, "Holder B Customer");
    holderB = seedPortalAccess(booted.db, { tenantId: tenantB, customerId: customerB });

    // Same-tenant, OTHER Customer: nothing a holder writes may touch these.
    foreignCustomerId = createCustomer(tenantA, "Foreign Customer A");
    prisma.customerContact.create({
      data: {
        tenantId: tenantA,
        customerId: foreignCustomerId,
        kind: "PHONE",
        label: null,
        value: "+595111000111",
        isPrimary: true,
        isActive: true,
      },
    });
    prisma.customerAddress.create({
      data: {
        tenantId: tenantA,
        customerId: foreignCustomerId,
        label: "casa",
        line1: "Foreign Street 1",
        line2: null,
        city: "Foreign City",
        state: null,
        postalCode: null,
        countryCode: "PY",
        isActive: true,
      },
    });

    // Pre-existing phone drift: TWO active primary rows (the DB has no partial
    // unique index for CustomerContact), with distinct updatedAt so the
    // "most recently updated" tie-break is deterministic.
    prisma.customerContact.create({
      data: {
        tenantId: tenantA,
        customerId: holderDrift.customerId,
        kind: "PHONE",
        label: null,
        value: "+595111222333",
        isPrimary: true,
        isActive: true,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    prisma.customerContact.create({
      data: {
        tenantId: tenantA,
        customerId: holderDrift.customerId,
        kind: "PHONE",
        label: null,
        value: "+595444555666",
        isPrimary: true,
        isActive: true,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-02-01T00:00:00.000Z"),
      },
    });

    // Multiple addresses are legitimate: only the most recently updated one is
    // the target, the rest stay exactly as they were.
    prisma.customerAddress.create({
      data: {
        tenantId: tenantA,
        customerId: holderMulti.customerId,
        label: "vieja",
        line1: "Old Street 1",
        line2: null,
        city: "Old City",
        state: null,
        postalCode: null,
        countryCode: "PY",
        isActive: true,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    prisma.customerAddress.create({
      data: {
        tenantId: tenantA,
        customerId: holderMulti.customerId,
        label: "actual",
        line1: "Current Street 1",
        line2: null,
        city: "Current City",
        state: null,
        postalCode: null,
        countryCode: "PY",
        isActive: true,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-02-01T00:00:00.000Z"),
      },
    });

    // A holder with TWO active phones and TWO active addresses, to prove a
    // clear deactivates the whole active channel (not just the projected row)
    // and that the read is then null.
    prisma.customerContact.create({
      data: {
        tenantId: tenantA,
        customerId: holderClearMulti.customerId,
        kind: "PHONE",
        label: null,
        value: "+595111222444",
        isPrimary: true,
        isActive: true,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-02-01T00:00:00.000Z"),
      },
    });
    prisma.customerContact.create({
      data: {
        tenantId: tenantA,
        customerId: holderClearMulti.customerId,
        kind: "PHONE",
        label: null,
        value: "+595111222555",
        isPrimary: false,
        isActive: true,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    prisma.customerAddress.create({
      data: {
        tenantId: tenantA,
        customerId: holderClearMulti.customerId,
        label: "vieja",
        line1: "Multi Old Street 1",
        line2: null,
        city: "Old City",
        state: null,
        postalCode: null,
        countryCode: "PY",
        isActive: true,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    prisma.customerAddress.create({
      data: {
        tenantId: tenantA,
        customerId: holderClearMulti.customerId,
        label: "actual",
        line1: "Multi Current Street 1",
        line2: null,
        city: "Current City",
        state: null,
        postalCode: null,
        countryCode: "PY",
        isActive: true,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-02-01T00:00:00.000Z"),
      },
    });

    // Only tenant A holds the explicit `portal` grant.
    const portalFeature = prisma.featureCode.create({ data: { code: "portal" } });
    prisma.tenantEntitlement.create({
      data: { tenantId: tenantA, featureCodeId: portalFeature.id },
    });
  });

  afterAll(async () => {
    fixture.cleanup();
    await booted.close();
  });

  const server = (): ReturnType<BootedTestApp["app"]["getHttpServer"]> =>
    booted.app.getHttpServer();

  const profileGet = (cookie: string) =>
    supertest(server()).get("/portal/profile").set("Cookie", cookie);

  const profilePut = (cookie: string, body: Record<string, unknown>) =>
    supertest(server()).put("/portal/profile").set("Cookie", cookie).send(body);

  const phoneRowsFor = (customerId: string) =>
    booted.db.prisma.customerContact.findMany({
      where: { tenantId: tenantA, customerId, kind: "PHONE" },
      orderBy: { updatedAt: "desc" },
    });

  const addressRowsFor = (customerId: string) =>
    booted.db.prisma.customerAddress.findMany({
      where: { tenantId: tenantA, customerId },
      orderBy: { updatedAt: "desc" },
    });

  /** Value-only snapshot used to prove a rejected payload changed NOTHING. */
  const storedPhones = (customerId: string) =>
    phoneRowsFor(customerId).map(({ id, value, isPrimary, isActive }) => ({
      id,
      value,
      isPrimary,
      isActive,
    }));

  const storedAddresses = (customerId: string) =>
    addressRowsFor(customerId).map(({ id, label, line1, city, isActive }) => ({
      id,
      label,
      line1,
      city,
      isActive,
    }));

  const auditRowsFor = (requestId: string) =>
    booted.db.prisma.auditLog.findMany({ where: { requestId } });

  describe("authentication and entitlement boundary", () => {
    it("returns 401 for an anonymous read and write", async () => {
      await supertest(server()).get("/portal/profile").expect(401);
      await supertest(server()).put("/portal/profile").send({ phone: PHONE_MARKER }).expect(401);
    });

    it("returns 401 for a staff session on both routes", async () => {
      await supertest(server())
        .get("/portal/profile")
        .set("Cookie", fixture.actors.a.cookie)
        .expect(401);
      await supertest(server())
        .put("/portal/profile")
        .set("Cookie", fixture.actors.a.cookie)
        .send({ phone: PHONE_MARKER })
        .expect(401);
    });

    it("returns 403 FEATURE_NOT_ENTITLED for an entitled-less tenant holder", async () => {
      const read = await profileGet(holderB.cookie).expect(403);
      expect((read.body as ErrorEnvelopeBody).error.code).toBe("FEATURE_NOT_ENTITLED");
      const write = await profilePut(holderB.cookie, { phone: PHONE_MARKER }).expect(403);
      expect((write.body as ErrorEnvelopeBody).error.code).toBe("FEATURE_NOT_ENTITLED");
    });
  });

  describe("guard errors win over the controller identity fence (ordering pin)", () => {
    // ORDERING PIN: the identity fence lives in the CONTROLLER, so the global
    // portal guards must decide first. A caller with no session still gets 401,
    // and a caller without the `portal` entitlement still gets 403 — never the
    // fence's 400 — even when the request carries an identity hint. These cases
    // fail if the fence is ever hoisted above authentication (e.g. moved into a
    // global guard or interceptor ahead of the portal chain).
    const HINT_QUERY = { customerId: "22222222-2222-4222-8222-222222222222" };
    const HINT_HEADER: readonly [string, string] = [
      "x-tenant-id",
      "11111111-1111-4111-8111-111111111111",
    ];
    // A VALID body, so a non-guard 400 could only come from the fence itself.
    const PROBE_BODY = { phone: "+595984999111", address: { line1: "Order Probe 1" } };

    it("returns 401 for an anonymous request carrying an identity query parameter", async () => {
      const agent = supertest(server());
      const responses = [
        await agent.get("/portal/profile").query(HINT_QUERY),
        await agent.put("/portal/profile").query(HINT_QUERY).send(PROBE_BODY),
      ];
      for (const response of responses) {
        expect(response.status).toBe(401);
        expect((response.body as ErrorEnvelopeBody).error.code).toBe("UNAUTHENTICATED");
      }
    });

    it("returns 401 for an anonymous request carrying an identity header", async () => {
      const agent = supertest(server());
      const [name, value] = HINT_HEADER;
      const responses = [
        await agent.get("/portal/profile").set(name, value),
        await agent.put("/portal/profile").set(name, value).send(PROBE_BODY),
      ];
      for (const response of responses) {
        expect(response.status).toBe(401);
        expect((response.body as ErrorEnvelopeBody).error.code).toBe("UNAUTHENTICATED");
      }
    });

    it("returns 403 for an entitled-less holder carrying an identity query parameter", async () => {
      const agent = supertest(server());
      const responses = [
        await agent.get("/portal/profile").query(HINT_QUERY).set("Cookie", holderB.cookie),
        await agent
          .put("/portal/profile")
          .query(HINT_QUERY)
          .set("Cookie", holderB.cookie)
          .send(PROBE_BODY),
      ];
      for (const response of responses) {
        expect(response.status).toBe(403);
        expect((response.body as ErrorEnvelopeBody).error.code).toBe("FEATURE_NOT_ENTITLED");
      }
    });

    it("returns 403 for an entitled-less holder carrying an identity header", async () => {
      const agent = supertest(server());
      const [name, value] = HINT_HEADER;
      const responses = [
        await agent.get("/portal/profile").set(name, value).set("Cookie", holderB.cookie),
        await agent
          .put("/portal/profile")
          .set(name, value)
          .set("Cookie", holderB.cookie)
          .send(PROBE_BODY),
      ];
      for (const response of responses) {
        expect(response.status).toBe(403);
        expect((response.body as ErrorEnvelopeBody).error.code).toBe("FEATURE_NOT_ENTITLED");
      }
    });
  });

  describe("fresh holder reads an empty profile", () => {
    it("returns nulls with the allowlisted shape and does not crash", async () => {
      const response = await profileGet(holderFresh.holder.cookie).expect(200);
      const body = response.body as ProfileBody;
      expect(Object.keys(body).sort()).toEqual(PROFILE_KEYS);
      expect(body.phone).toBeNull();
      expect(body.address).toBeNull();
    });

    it("masks an unresolvable session Customer with the byte-equivalent portal NOT_FOUND", async () => {
      // One pinned request id for both probes, so the raw envelopes must be
      // byte-identical — not merely the same shape.
      const sharedRequestId = randomUUID();
      const [ghost, canonical] = await Promise.all([
        supertest(server())
          .get("/portal/profile")
          .set("Cookie", holderGhost.holder.cookie)
          .set(REQUEST_ID_HEADER, sharedRequestId)
          .expect(404),
        supertest(server())
          .get(`/portal/pets/${randomUUID()}`)
          .set("Cookie", holderFresh.holder.cookie)
          .set(REQUEST_ID_HEADER, sharedRequestId)
          .expect(404),
      ]);

      const error = (ghost.body as ErrorEnvelopeBody).error;
      expect(error.code).toBe("NOT_FOUND");
      // The shared portal NOT_FOUND message itself, not a hand-copied literal:
      // the test cannot drift from the constant the masking path uses.
      expect(error.message).toBe(PORTAL_NOT_FOUND_MESSAGE);
      // Byte-equivalent with the canonical portal masking path (holder-owned
      // pet lookup) for the same pinned request id.
      expect(ghost.text).toBe(canonical.text);
      expect(ghost.text).not.toContain(holderGhost.customerId);
    });
  });

  describe("profile upsert", () => {
    it("creates the phone and address and returns the allowlisted projection", async () => {
      const response = await profilePut(holderMain.holder.cookie, {
        phone: "+595981000111",
        address: {
          label: "casa",
          line1: "Av. Siempre Viva 742",
          city: "Asuncion",
          countryCode: "PY",
        },
      }).expect(200);

      const body = response.body as ProfileBody;
      expect(Object.keys(body).sort()).toEqual(PROFILE_KEYS);
      expect(body.phone).toBe("+595981000111");
      expect(body.address).toMatchObject({
        label: "casa",
        line1: "Av. Siempre Viva 742",
        line2: null,
        city: "Asuncion",
        state: null,
        postalCode: null,
        countryCode: "PY",
      });
      expect(Object.keys(body.address ?? {}).sort()).toEqual(ADDRESS_KEYS);

      const phones = phoneRowsFor(holderMain.customerId);
      expect(phones).toHaveLength(1);
      expect(phones[0]).toMatchObject({
        tenantId: tenantA,
        customerId: holderMain.customerId,
        kind: "PHONE",
        value: "+595981000111",
        isPrimary: true,
        isActive: true,
      });

      const addresses = addressRowsFor(holderMain.customerId);
      expect(addresses).toHaveLength(1);
      expect(addresses[0]).toMatchObject({
        tenantId: tenantA,
        customerId: holderMain.customerId,
        label: "casa",
        line1: "Av. Siempre Viva 742",
        line2: null,
        city: "Asuncion",
        state: null,
        postalCode: null,
        countryCode: "PY",
        isActive: true,
      });
    });

    it("updates in place on a second PUT instead of duplicating rows", async () => {
      const beforePhones = phoneRowsFor(holderMain.customerId);
      const beforeAddresses = addressRowsFor(holderMain.customerId);

      const response = await profilePut(holderMain.holder.cookie, {
        phone: "+595981000222",
        address: { line1: "Av. Siempre Viva 748", city: "Lambare" },
      }).expect(200);

      const body = response.body as ProfileBody;
      expect(body.phone).toBe("+595981000222");
      // Partial address update: supplied keys written, absent keys preserved.
      expect(body.address).toMatchObject({
        label: "casa",
        line1: "Av. Siempre Viva 748",
        city: "Lambare",
        countryCode: "PY",
      });

      const afterPhones = phoneRowsFor(holderMain.customerId);
      const afterAddresses = addressRowsFor(holderMain.customerId);
      expect(afterPhones).toHaveLength(beforePhones.length);
      expect(afterAddresses).toHaveLength(beforeAddresses.length);
      expect(afterPhones[0].id).toBe(beforePhones[0].id);
      expect(afterAddresses[0].id).toBe(beforeAddresses[0].id);
      expect(afterPhones[0].isPrimary).toBe(true);
    });

    it("leaves exactly one primary phone when a second primary row already exists", async () => {
      const before = phoneRowsFor(holderDrift.customerId);
      expect(before.filter((row) => row.isPrimary)).toHaveLength(2);

      const response = await profilePut(holderDrift.holder.cookie, {
        phone: "+595999000111",
      }).expect(200);
      expect((response.body as ProfileBody).phone).toBe("+595999000111");

      const after = phoneRowsFor(holderDrift.customerId);
      expect(after).toHaveLength(2);
      const primaries = after.filter((row) => row.isPrimary);
      expect(primaries).toHaveLength(1);
      // The most recently updated primary was the target; the sibling keeps its
      // value and is demoted, not deactivated.
      expect(primaries[0].id).toBe(before[0].id);
      expect(primaries[0].value).toBe("+595999000111");
      const demoted = after.find((row) => row.id === before[1].id);
      expect(demoted).toMatchObject({ value: before[1].value, isPrimary: false, isActive: true });
    });

    it("updates only the most recent active address and leaves the others alone", async () => {
      const before = addressRowsFor(holderMulti.customerId);
      expect(before).toHaveLength(2);

      await profilePut(holderMulti.holder.cookie, {
        address: { line1: "Newest Street 9", city: "Newest City" },
      }).expect(200);

      const after = addressRowsFor(holderMulti.customerId);
      expect(after).toHaveLength(2);
      const target = after.find((row) => row.id === before[0].id);
      expect(target).toMatchObject({
        line1: "Newest Street 9",
        city: "Newest City",
        label: before[0].label,
        isActive: true,
      });
      // The older address is neither rewritten nor deactivated.
      const untouched = after.find((row) => row.id === before[1].id);
      expect(untouched).toMatchObject({
        label: before[1].label,
        line1: before[1].line1,
        city: before[1].city,
        isActive: true,
      });
    });
  });

  describe("profile clear (null means clear, absent means leave untouched)", () => {
    it("clears the phone and reports it, deactivating rather than deleting the row", async () => {
      await profilePut(holderClear.holder.cookie, {
        phone: "+595982000111",
        address: { line1: "Clear Street 1", city: "Clear City" },
      }).expect(200);
      const before = phoneRowsFor(holderClear.customerId);
      expect(before).toHaveLength(1);

      const response = await profilePut(holderClear.holder.cookie, { phone: null }).expect(200);
      const body = response.body as ProfileBody;
      expect(body.phone).toBeNull();
      // The stored address is untouched: an absent `address` key keeps it.
      expect(body.address).toMatchObject({ line1: "Clear Street 1", city: "Clear City" });

      const after = phoneRowsFor(holderClear.customerId);
      expect(after).toHaveLength(1);
      // Deactivated, not deleted: the SAME row survives the clear.
      expect(after[0].id).toBe(before[0].id);
      expect(after[0]).toMatchObject({
        value: "+595982000111",
        isActive: false,
        isPrimary: false,
      });
    });

    it("clears the address and reports it, deactivating rather than deleting the row", async () => {
      await profilePut(holderClear.holder.cookie, {
        phone: "+595982000222",
        address: { line1: "Clear Street 2", city: "Clear City" },
      }).expect(200);
      const before = addressRowsFor(holderClear.customerId);
      expect(before).toHaveLength(1);

      const response = await profilePut(holderClear.holder.cookie, { address: null }).expect(200);
      const body = response.body as ProfileBody;
      expect(body.address).toBeNull();
      // The stored phone is untouched: an absent `phone` key keeps it.
      expect(body.phone).toBe("+595982000222");

      const after = addressRowsFor(holderClear.customerId);
      expect(after).toHaveLength(1);
      expect(after[0].id).toBe(before[0].id);
      expect(after[0]).toMatchObject({ line1: "Clear Street 2", isActive: false });
    });

    it("clears the whole active channel when several active rows exist", async () => {
      const beforePhones = phoneRowsFor(holderClearMulti.customerId);
      const beforeAddresses = addressRowsFor(holderClearMulti.customerId);
      expect(beforePhones).toHaveLength(2);
      expect(beforeAddresses).toHaveLength(2);

      const response = await profilePut(holderClearMulti.holder.cookie, {
        phone: null,
        address: null,
      }).expect(200);
      const body = response.body as ProfileBody;
      expect(body.phone).toBeNull();
      expect(body.address).toBeNull();

      const afterPhones = phoneRowsFor(holderClearMulti.customerId);
      const afterAddresses = addressRowsFor(holderClearMulti.customerId);
      expect(afterPhones).toHaveLength(2);
      expect(afterAddresses).toHaveLength(2);
      // Every active row is deactivated and demoted; none is deleted, and no
      // active primary is left dangling (DEC-006 interaction).
      for (const row of afterPhones) {
        expect(row).toMatchObject({ isActive: false, isPrimary: false });
      }
      for (const row of afterAddresses) {
        expect(row.isActive).toBe(false);
      }
      // A foreign Customer's rows are untouched by the holder's clear.
      expect(storedPhones(foreignCustomerId)).toHaveLength(1);
      expect(storedAddresses(foreignCustomerId)).toHaveLength(1);
    });

    it("names a clear with a `.cleared` token in the audit row and no value", async () => {
      await profilePut(holderClear.holder.cookie, {
        phone: PHONE_MARKER,
        address: { line1: LINE1_MARKER, city: CITY_MARKER },
      }).expect(200);
      const requestId = `portal-profile-clear-${randomUUID()}`;

      const response = await supertest(server())
        .put("/portal/profile")
        .set("Cookie", holderClear.holder.cookie)
        .set(REQUEST_ID_HEADER, requestId)
        .send({ phone: null, address: null })
        .expect(200);

      expect((response.body as ProfileBody).phone).toBeNull();
      expect((response.body as ProfileBody).address).toBeNull();

      const rows = auditRowsFor(requestId);
      expect(rows).toHaveLength(1);
      const audit = rows[0];
      expect(audit.action).toBe(PROFILE_ACTION);
      expect(audit.actorType).toBe("PORTAL");
      expect(audit.targetType).toBe("customer");
      expect(audit.metadata).toEqual({
        schemaVersion: 1,
        changedFields: ["phone.cleared", "address.cleared"],
        contactId: phoneRowsFor(holderClear.customerId)[0].id,
        addressId: addressRowsFor(holderClear.customerId)[0].id,
      });
      // No CONFIDENTIAL value reaches the clear's audit metadata.
      const serialized = JSON.stringify(audit.metadata);
      for (const marker of [PHONE_MARKER, LINE1_MARKER, CITY_MARKER]) {
        expect(serialized).not.toContain(marker);
      }
    });

    it("is idempotent: clearing an already-absent field succeeds and records no change", async () => {
      await profilePut(holderClear.holder.cookie, { phone: "+595982000333" }).expect(200);
      await profilePut(holderClear.holder.cookie, { phone: null }).expect(200);

      const requestId = `portal-profile-clear-noop-${randomUUID()}`;
      const response = await supertest(server())
        .put("/portal/profile")
        .set("Cookie", holderClear.holder.cookie)
        .set(REQUEST_ID_HEADER, requestId)
        .send({ phone: null })
        .expect(200);
      expect((response.body as ProfileBody).phone).toBeNull();

      const rows = auditRowsFor(requestId);
      expect(rows).toHaveLength(1);
      // The row exists (one row per mutation) but claims no change: a no-op
      // clear does not lie about having cleared something.
      expect(rows[0].metadata).toEqual({ schemaVersion: 1, changedFields: [] });
    });
  });

  describe("audit trail", () => {
    it("writes exactly one co-committed PORTAL row per successful PUT", async () => {
      const requestId = `portal-profile-audit-${randomUUID()}`;

      await supertest(server())
        .put("/portal/profile")
        .set("Cookie", holderMain.holder.cookie)
        .set(REQUEST_ID_HEADER, requestId)
        .send({
          phone: "+595981000333",
          address: { label: "oficina", line1: "Oficina 1", city: "Asuncion" },
        })
        .expect(200);

      const rows = auditRowsFor(requestId);
      expect(rows).toHaveLength(1);
      const audit = rows[0];
      expect(audit.action).toBe(PROFILE_ACTION);
      expect(audit.actorType).toBe("PORTAL");
      expect(audit.actorPortalAccessId).toBe(holderMain.holder.access.id);
      // A PORTAL row never carries a staff actor.
      expect(audit.actorUserProfileId).toBeUndefined();
      expect(audit.tenantId).toBe(tenantA);
      expect(audit.targetType).toBe("customer");
      expect(audit.targetId).toBe(holderMain.customerId);
      expect(audit.metadata).toEqual({
        schemaVersion: 1,
        changedFields: ["phone", "address.label", "address.line1", "address.city"],
        contactId: phoneRowsFor(holderMain.customerId)[0].id,
        addressId: addressRowsFor(holderMain.customerId)[0].id,
      });
    });

    it("names only the supplied address fields in the diff", async () => {
      const requestId = `portal-profile-audit-partial-${randomUUID()}`;

      await supertest(server())
        .put("/portal/profile")
        .set("Cookie", holderMulti.holder.cookie)
        .set(REQUEST_ID_HEADER, requestId)
        .send({ address: { line1: "Solo Linea" } })
        .expect(200);

      const rows = auditRowsFor(requestId);
      expect(rows).toHaveLength(1);
      expect(rows[0].metadata).toEqual({
        schemaVersion: 1,
        changedFields: ["address.line1"],
        addressId: addressRowsFor(holderMulti.customerId)[0].id,
      });
    });

    it("persists neither the contact nor the address when the audit append fails", async () => {
      const customerId = holderScope.customerId;
      const beforePhones = phoneRowsFor(customerId).length;
      const beforeAddresses = addressRowsFor(customerId).length;
      const originalCreate = booted.db.prisma.auditLog.create;
      booted.db.prisma.auditLog.create = () => {
        throw new Error("audit storage unavailable");
      };

      let status = 0;
      try {
        const response = await profilePut(holderScope.holder.cookie, {
          phone: "+595981000444",
          address: { line1: "Rollback Street 1" },
        });
        status = response.status;
      } finally {
        booted.db.prisma.auditLog.create = originalCreate;
      }

      expect(status).toBe(500);
      // The transaction rolled back: audit-or-nothing.
      expect(phoneRowsFor(customerId)).toHaveLength(beforePhones);
      expect(addressRowsFor(customerId)).toHaveLength(beforeAddresses);
    });
  });

  describe("strict payload contract", () => {
    let baselinePhones: ReturnType<typeof storedPhones>;
    let baselineAddresses: ReturnType<typeof storedAddresses>;
    let baselineAudits: number;

    beforeAll(async () => {
      await profilePut(holderReject.holder.cookie, {
        phone: "+595981000555",
        address: { line1: "Baseline Street 1", city: "Baseline City" },
      }).expect(200);
      baselinePhones = storedPhones(holderReject.customerId);
      baselineAddresses = storedAddresses(holderReject.customerId);
      baselineAudits = [...booted.db.tables.audits.values()].length;
    });

    it.each([
      ["an email", { email: "nuevo@portal.test" }],
      ["a displayName", { displayName: "Nuevo Nombre" }],
      ["a kind", { kind: "PHONE" }],
      ["a taxId", { taxId: "80012345-6" }],
      ["a firstName", { firstName: "Nuevo" }],
      ["a lastName", { lastName: "Apellido" }],
      ["a legalName", { legalName: "Legal SA" }],
      ["a documentNumber", { documentNumber: "1234567" }],
      ["an unknown key", { somethingElse: "x" }],
      ["a client-supplied id", { id: randomUUID() }],
    ])("rejects %s with 400 and persists nothing", async (_label, extra) => {
      const response = await profilePut(holderReject.holder.cookie, {
        phone: "+595999888777",
        ...extra,
      }).expect(400);

      expect((response.body as ErrorEnvelopeBody).error.code).toBe("VALIDATION_FAILED");
      expect(storedPhones(holderReject.customerId)).toEqual(baselinePhones);
      expect(storedAddresses(holderReject.customerId)).toEqual(baselineAddresses);
      expect([...booted.db.tables.audits.values()].length).toBe(baselineAudits);
    });

    // Thunks, not plain objects: the `it.each` table is built while `describe`
    // runs, before `beforeAll` resolves `foreignCustomerId`.
    it.each([
      ["a client-supplied customerId", () => ({ customerId: randomUUID() })],
      ["a client-supplied tenantId", () => ({ tenantId: randomUUID() })],
      ["another Customer's identifiers", () => ({ customerId: foreignCustomerId })],
    ])("rejects %s with 400 and persists nothing", async (_label, buildExtra) => {
      const response = await profilePut(holderReject.holder.cookie, {
        phone: "+595999888777",
        ...buildExtra(),
      }).expect(400);
      expect((response.body as ErrorEnvelopeBody).error.code).toBe("VALIDATION_FAILED");
      expect(storedPhones(holderReject.customerId)).toEqual(baselinePhones);
      expect([...booted.db.tables.audits.values()].length).toBe(baselineAudits);
    });

    it.each([
      ["an empty body", {}],
      ["an empty phone", { phone: "" }],
      ["an address without line1", { address: { city: "Asuncion" } }],
      ["an address with a 3-letter countryCode", { address: { line1: "X", countryCode: "PRY" } }],
      ["an address with a 1-letter countryCode", { address: { line1: "X", countryCode: "P" } }],
      ["an unknown address key", { address: { line1: "X", email: "a@b.test" } }],
    ])("rejects %s with 400 and persists nothing", async (_label, body) => {
      const response = await profilePut(holderReject.holder.cookie, body).expect(400);
      expect((response.body as ErrorEnvelopeBody).error.code).toBe("VALIDATION_FAILED");
      expect(storedPhones(holderReject.customerId)).toEqual(baselinePhones);
      expect(storedAddresses(holderReject.customerId)).toEqual(baselineAddresses);
      expect([...booted.db.tables.audits.values()].length).toBe(baselineAudits);
    });
  });

  describe("confidentiality", () => {
    it("keeps the response free of email and every staff-owned field", async () => {
      const response = await profilePut(holderSecret.holder.cookie, {
        phone: PHONE_MARKER,
        address: { label: "secreto", line1: LINE1_MARKER, city: CITY_MARKER },
      }).expect(200);

      const body = response.body as ProfileBody;
      expect(Object.keys(body).sort()).toEqual(PROFILE_KEYS);
      expect(Object.keys(body.address ?? {}).sort()).toEqual(ADDRESS_KEYS);
      // The holder's OWN values are returned …
      expect(body.phone).toBe(PHONE_MARKER);
      expect(body.address?.line1).toBe(LINE1_MARKER);
      // … but no staff-owned identity field, no email and no tenant echo.
      for (const forbidden of [
        '"email"',
        '"displayName"',
        '"legalName"',
        '"taxId"',
        '"firstName"',
        '"lastName"',
        '"documentNumber"',
        '"kind"',
        '"customerId"',
        '"tenantId"',
        tenantA,
        holderSecret.customerId,
      ]) {
        expect(response.text, `response leaked ${forbidden}`).not.toContain(forbidden);
      }
    });

    it("keeps CONFIDENTIAL values out of the audit metadata and the logs", async () => {
      const requestId = `portal-profile-secret-${randomUUID()}`;

      await supertest(server())
        .put("/portal/profile")
        .set("Cookie", holderSecret.holder.cookie)
        .set(REQUEST_ID_HEADER, requestId)
        .send({
          phone: PHONE_MARKER,
          address: { label: "secreto", line1: LINE1_MARKER, city: CITY_MARKER },
        })
        .expect(200);

      const rows = auditRowsFor(requestId);
      expect(rows).toHaveLength(1);
      const serializedMetadata = JSON.stringify(rows[0].metadata);
      expect(serializedMetadata).toContain('"changedFields"');
      expect(serializedMetadata).toContain("contactId");
      expect(serializedMetadata).toContain("addressId");
      for (const marker of [PHONE_MARKER, LINE1_MARKER, CITY_MARKER]) {
        expect(serializedMetadata, "CONFIDENTIAL value reached audit metadata").not.toContain(
          marker
        );
      }

      const logs = booted.logLines().join("\n");
      for (const marker of [PHONE_MARKER, LINE1_MARKER, CITY_MARKER]) {
        expect(logs, "CONFIDENTIAL value reached a log line").not.toContain(marker);
      }
    });
  });

  describe("client-supplied identity hints are refused", () => {
    /** Thunks: the `it.each` table is built before `beforeAll` resolves ids. */
    const QUERY_HINTS = [
      ["tenantId", (): string => tenantB],
      ["customerId", (): string => foreignCustomerId],
      ["contactId", (): string => randomUUID()],
      ["addressId", (): string => randomUUID()],
      ["id", (): string => randomUUID()],
    ] as const;

    /** Value-only snapshot: a refused hint must leave every store untouched. */
    const scopeSnapshot = (): {
      phones: ReturnType<typeof storedPhones>;
      addresses: ReturnType<typeof storedAddresses>;
      audits: number;
    } => ({
      phones: storedPhones(holderScope.customerId),
      addresses: storedAddresses(holderScope.customerId),
      audits: [...booted.db.tables.audits.values()].length,
    });

    const expectUnchanged = (before: ReturnType<typeof scopeSnapshot>): void => {
      expect(storedPhones(holderScope.customerId)).toEqual(before.phones);
      expect(storedAddresses(holderScope.customerId)).toEqual(before.addresses);
      expect([...booted.db.tables.audits.values()].length).toBe(before.audits);
    };

    it.each(QUERY_HINTS)(
      "refuses a %s query hint on GET and PUT with 400 and writes nothing",
      async (name, value) => {
        const before = scopeSnapshot();
        const hint = { [name]: value() };

        const read = await supertest(server())
          .get("/portal/profile")
          .query(hint)
          .set("Cookie", holderScope.holder.cookie)
          .expect(400);
        const readError = (read.body as ErrorEnvelopeBody).error;
        expect(readError.code).toBe("VALIDATION_FAILED");
        expect(readError.message).toContain(name);

        const write = await supertest(server())
          .put("/portal/profile")
          .query(hint)
          .set("Cookie", holderScope.holder.cookie)
          .send({ phone: "+595984000111", address: { line1: "Scoped Street 1" } })
          .expect(400);
        const writeError = (write.body as ErrorEnvelopeBody).error;
        expect(writeError.code).toBe("VALIDATION_FAILED");
        expect(writeError.message).toContain(name);

        expectUnchanged(before);
      }
    );

    it.each([
      ["x-tenant-id", (): string => tenantB],
      ["x-customer-id", (): string => foreignCustomerId],
    ])(
      "refuses a %s header hint on GET and PUT with 400 and writes nothing",
      async (name, value) => {
        const before = scopeSnapshot();
        const hint = value();

        const read = await supertest(server())
          .get("/portal/profile")
          .set(name, hint)
          .set("Cookie", holderScope.holder.cookie)
          .expect(400);
        const readError = (read.body as ErrorEnvelopeBody).error;
        expect(readError.code).toBe("VALIDATION_FAILED");
        expect(readError.message).toContain(name);

        const write = await supertest(server())
          .put("/portal/profile")
          .set(name, hint)
          .set("Cookie", holderScope.holder.cookie)
          .send({ phone: "+595984000112", address: { line1: "Scoped Street 1" } })
          .expect(400);
        const writeError = (write.body as ErrorEnvelopeBody).error;
        expect(writeError.code).toBe("VALIDATION_FAILED");
        expect(writeError.message).toContain(name);

        expectUnchanged(before);
      }
    );

    it("keeps the body case unchanged: identity keys are still refused with 400", async () => {
      const before = scopeSnapshot();

      const response = await profilePut(holderScope.holder.cookie, {
        phone: "+595984000113",
        customerId: foreignCustomerId,
      }).expect(400);

      const error = (response.body as ErrorEnvelopeBody).error;
      expect(error.code).toBe("VALIDATION_FAILED");
      expect(error.message).toBe("Invalid profile update body.");
      expectUnchanged(before);
    });

    it("always writes the session tenant and Customer and never another Customer's rows", async () => {
      const beforePhones = storedPhones(foreignCustomerId);
      const beforeAddresses = storedAddresses(foreignCustomerId);

      const response = await profilePut(holderScope.holder.cookie, {
        phone: "+595984000222",
        address: { line1: "Scoped Street 2" },
      }).expect(200);
      expect((response.body as ProfileBody).phone).toBe("+595984000222");

      const written = [
        ...phoneRowsFor(holderScope.customerId),
        ...addressRowsFor(holderScope.customerId),
      ];
      expect(written).not.toHaveLength(0);
      for (const row of written) {
        expect(row.tenantId).toBe(tenantA);
        expect(row.customerId).toBe(holderScope.customerId);
      }
      expect(storedPhones(foreignCustomerId)).toEqual(beforePhones);
      expect(storedAddresses(foreignCustomerId)).toEqual(beforeAddresses);
    });
  });
});
