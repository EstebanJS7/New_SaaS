import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import { expectCrossTenant404 } from "../../test/support/expect-cross-tenant-404.js";
import {
  seedSchedulingHttp,
  type SchedulingHttpFixture,
} from "../../test/support/scheduling-http-fixture.js";
import { seedRbacActor, seedRoleWithKeys } from "../../test/support/rbac-fixture.js";
import type { AppointmentRow, AuditLogRow } from "../../test/support/in-memory-database.js";
import { REQUEST_ID_HEADER } from "../common/errors/request-id.js";

interface ErrorDto {
  error: { code: string };
}

interface AppointmentDto {
  id: string;
  tenantId: string;
  branchId: string;
  patientId: string;
  professionalMembershipId: string;
  status: string;
  startAt: string;
  endAt: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** Allowlisted CONFIDENTIAL surface — any extra key must fail. */
const APPOINTMENT_RESPONSE_KEYS: readonly string[] = [
  "id",
  "tenantId",
  "branchId",
  "patientId",
  "professionalMembershipId",
  "status",
  "startAt",
  "endAt",
  "version",
  "createdAt",
  "updatedAt",
];

/**
 * EPIC-07 WU3 HTTP boundary over the REAL guard chain and the scheduling
 * fixture. Every test mints its own anchors (or consumes unique 30-minute
 * slots) so no test depends on state produced by another.
 */
describe("Appointments HTTP boundary (EPIC-07 WU3)", () => {
  let booted: BootedTestApp;
  let fixture: SchedulingHttpFixture;

  beforeAll(async () => {
    booted = await bootTestApp();
    // One listening server for the whole suite (repeated binds race).
    await booted.app.listen(0);
    fixture = seedSchedulingHttp(booted.db);
  });

  afterAll(async () => {
    await booted.close();
  });

  const server = () => booted.app.getHttpServer();

  function auditRowsWith(requestId: string): AuditLogRow[] {
    return [...booted.db.tables.audits.values()].filter((row) => row.requestId === requestId);
  }

  function appointmentCount(): number {
    return booted.db.tables.appointments.size;
  }

  // Unique non-overlapping 30-minute slots avoid accidental cross-test overlap
  // for the shared professional (conflict detection is range-based).
  let slotMinutes = 0;
  function nextSlot(): { startAt: string; endAt: string } {
    const start = new Date(Date.UTC(2026, 2, 2, 0, slotMinutes));
    slotMinutes += 30;
    return {
      startAt: start.toISOString(),
      endAt: new Date(start.getTime() + 30 * 60_000).toISOString(),
    };
  }

  function validCreateBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      branchId: fixture.a.branch.id,
      patientId: fixture.a.patientId,
      professionalMembershipId: fixture.a.professionalMembershipId,
      ...nextSlot(),
      ...overrides,
    };
  }

  function createAppointmentHttp(
    overrides: Record<string, unknown> = {},
    cookie = fixture.a.actor.cookie
  ) {
    return supertest(server())
      .post("/appointments")
      .set("Cookie", cookie)
      .send(validCreateBody(overrides));
  }

  it("rejects anonymous callers on the scheduling routes with 401 UNAUTHENTICATED", async () => {
    const id = randomUUID();
    const responses = await Promise.all([
      supertest(server()).get("/appointments"),
      supertest(server()).get("/appointments/options"),
      supertest(server()).get(`/appointments/${id}`),
      supertest(server()).post("/appointments").send({}),
      supertest(server()).put(`/appointments/${id}`).send({}),
      supertest(server()).post(`/appointments/${id}/confirm`).send({}),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(401);
      expect((response.body as ErrorDto).error.code).toBe("UNAUTHENTICATED");
    }
  });

  it("returns 403 FORBIDDEN when the active role lacks the route's granular permission", async () => {
    const readOnlyRole = seedRoleWithKeys(
      booted.db,
      `SCHED_RO_${randomUUID().slice(0, 8)}`,
      "Scheduling read-only (fixture)",
      ["scheduling.appointment.read"]
    );
    const readOnly = seedRbacActor(booted.db, {
      email: `sched-ro-${randomUUID().slice(0, 8)}@isolation.test`,
      tenantId: fixture.a.tenant.id,
      roleId: readOnlyRole.role.id,
    });
    const manageOnlyRole = seedRoleWithKeys(
      booted.db,
      `SCHED_MGR_${randomUUID().slice(0, 8)}`,
      "Scheduling manage-only (fixture)",
      ["scheduling.appointment.manage"]
    );
    const manageOnly = seedRbacActor(booted.db, {
      email: `sched-mgr-${randomUUID().slice(0, 8)}@isolation.test`,
      tenantId: fixture.a.tenant.id,
      roleId: manageOnlyRole.role.id,
    });

    const denied = [
      supertest(server())
        .post("/appointments")
        .set("Cookie", readOnly.cookie)
        .send(validCreateBody()),
      supertest(server())
        .put(`/appointments/${randomUUID()}`)
        .set("Cookie", readOnly.cookie)
        .send({ ...nextSlot(), version: 1 }),
      supertest(server())
        .post(`/appointments/${randomUUID()}/confirm`)
        .set("Cookie", readOnly.cookie)
        .send({}),
      supertest(server()).get("/appointments").set("Cookie", manageOnly.cookie),
      supertest(server()).get("/appointments/options").set("Cookie", manageOnly.cookie),
      supertest(server()).get(`/appointments/${randomUUID()}`).set("Cookie", manageOnly.cookie),
    ];
    for (const request of denied) {
      const response = await request;
      expect(response.status).toBe(403);
      expect((response.body as ErrorDto).error.code).toBe("FORBIDDEN");
    }
  });

  it("rejects a malformed appointment id with 400 VALIDATION_FAILED", async () => {
    const response = await supertest(server())
      .get("/appointments/not-a-uuid")
      .set("Cookie", fixture.a.actor.cookie)
      .expect(400);
    expect((response.body as ErrorDto).error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a non-ordered time range with 400 and persists nothing", async () => {
    const before = appointmentCount();
    const { startAt } = nextSlot();

    const response = await supertest(server())
      .post("/appointments")
      .set("Cookie", fixture.a.actor.cookie)
      .send(validCreateBody({ endAt: startAt }))
      .expect(400);

    expect((response.body as ErrorDto).error.code).toBe("VALIDATION_FAILED");
    expect(appointmentCount()).toBe(before);
  });

  it("ignores a request-body tenantId (strict schema) and persists nothing", async () => {
    const before = appointmentCount();

    const response = await supertest(server())
      .post("/appointments")
      .set("Cookie", fixture.a.actor.cookie)
      .send(validCreateBody({ tenantId: fixture.b.tenant.id }))
      .expect(400);

    expect((response.body as ErrorDto).error.code).toBe("VALIDATION_FAILED");
    expect(appointmentCount()).toBe(before);
  });

  it("rejects a non-VETERINARIAN professional with 400 and persists nothing", async () => {
    const membership = fixture.a.actor.membership;
    if (!membership) throw new Error("fixture actor membership missing");
    const before = appointmentCount();

    const response = await createAppointmentHttp({
      professionalMembershipId: membership.id,
    }).expect(400);

    expect((response.body as ErrorDto).error.code).toBe("VALIDATION_FAILED");
    expect(appointmentCount()).toBe(before);
  });

  it("creates a SCHEDULED appointment with an allowlisted DTO and one co-committed audit row", async () => {
    const requestId = randomUUID();

    const response = await createAppointmentHttp().set(REQUEST_ID_HEADER, requestId).expect(201);

    const body = response.body as AppointmentDto;
    expect(Object.keys(body).sort()).toEqual([...APPOINTMENT_RESPONSE_KEYS].sort());
    expect(body.status).toBe("SCHEDULED");
    expect(body.version).toBe(1);
    expect(body.tenantId).toBe(fixture.a.tenant.id);
    expect(body.branchId).toBe(fixture.a.branch.id);
    expect(body.patientId).toBe(fixture.a.patientId);
    expect(body.professionalMembershipId).toBe(fixture.a.professionalMembershipId);

    const audits = auditRowsWith(requestId);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "appointment.created", targetId: body.id });
    expect(audits[0].actorUserProfileId).toBe(fixture.a.actor.profile.id);
  });

  it("masks foreign Branch, Patient and membership anchors as byte-equivalent 404", async () => {
    const before = appointmentCount();
    const foreignPatient = fixture.patient.createPatientB().patient;

    await expectCrossTenant404({
      app: booted.app,
      cookie: fixture.a.actor.cookie,
      nonexistentUrl: "/appointments",
      foreignUrl: "/appointments",
      method: "POST",
      body: validCreateBody({ branchId: randomUUID() }),
      foreignBody: validCreateBody({ branchId: fixture.b.branch.id }),
      forbiddenIdentifiers: [fixture.b.branch.id, fixture.b.tenant.id],
    });
    await expectCrossTenant404({
      app: booted.app,
      cookie: fixture.a.actor.cookie,
      nonexistentUrl: "/appointments",
      foreignUrl: "/appointments",
      method: "POST",
      body: validCreateBody({ patientId: randomUUID() }),
      foreignBody: validCreateBody({ patientId: foreignPatient.id }),
      forbiddenIdentifiers: [foreignPatient.id, fixture.b.tenant.id],
    });
    await expectCrossTenant404({
      app: booted.app,
      cookie: fixture.a.actor.cookie,
      nonexistentUrl: "/appointments",
      foreignUrl: "/appointments",
      method: "POST",
      body: validCreateBody({ professionalMembershipId: randomUUID() }),
      foreignBody: validCreateBody({
        professionalMembershipId: fixture.b.professionalMembershipId,
      }),
      forbiddenIdentifiers: [fixture.b.professionalMembershipId, fixture.b.tenant.id],
    });

    expect(appointmentCount()).toBe(before);
  });

  it("masks a foreign appointment read as a byte-equivalent 404", async () => {
    const foreign = fixture.createAppointment(fixture.b);

    await expectCrossTenant404({
      app: booted.app,
      cookie: fixture.a.actor.cookie,
      nonexistentUrl: `/appointments/${randomUUID()}`,
      foreignUrl: `/appointments/${foreign.id}`,
      forbiddenIdentifiers: [foreign.id, fixture.b.tenant.id],
    });
  });

  it("rejects an overlapping appointment under the default REJECT policy with 409", async () => {
    const first = await createAppointmentHttp().expect(201);
    const created = first.body as AppointmentDto;
    const before = appointmentCount();

    const overlapping = await createAppointmentHttp({
      startAt: new Date(Date.parse(created.startAt) + 10 * 60_000).toISOString(),
      endAt: new Date(Date.parse(created.endAt) + 10 * 60_000).toISOString(),
    }).expect(409);

    expect((overlapping.body as ErrorDto).error.code).toBe("CONFLICT");
    expect(appointmentCount()).toBe(before);
  });

  it("runs a named transition with an audit row and rejects an illegal edge with 409", async () => {
    const created = (await createAppointmentHttp().expect(201)).body as AppointmentDto;
    const confirmRequestId = randomUUID();

    const confirmed = await supertest(server())
      .post(`/appointments/${created.id}/confirm`)
      .set("Cookie", fixture.a.actor.cookie)
      .set(REQUEST_ID_HEADER, confirmRequestId)
      .send({})
      .expect(201);
    expect((confirmed.body as AppointmentDto).status).toBe("CONFIRMED");

    const audits = auditRowsWith(confirmRequestId);
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe("appointment.confirmed");

    // Terminal/illegal edge: a second confirm from CONFIRMED is 409 unchanged.
    const illegal = await supertest(server())
      .post(`/appointments/${created.id}/confirm`)
      .set("Cookie", fixture.a.actor.cookie)
      .send({})
      .expect(409);
    expect((illegal.body as ErrorDto).error.code).toBe("CONFLICT");
    expect(booted.db.tables.appointments.get(created.id)?.status).toBe("CONFIRMED");
  });

  it("reschedules with the version guard and rejects a stale version with 409", async () => {
    const created = (await createAppointmentHttp().expect(201)).body as AppointmentDto;
    const slot = nextSlot();

    const rescheduled = await supertest(server())
      .put(`/appointments/${created.id}`)
      .set("Cookie", fixture.a.actor.cookie)
      .send({ ...slot, version: created.version })
      .expect(200);
    expect((rescheduled.body as AppointmentDto).version).toBe(created.version + 1);

    const stale = await supertest(server())
      .put(`/appointments/${created.id}`)
      .set("Cookie", fixture.a.actor.cookie)
      .send({ ...nextSlot(), version: created.version })
      .expect(409);
    expect((stale.body as ErrorDto).error.code).toBe("CONFLICT");

    const stored: AppointmentRow | undefined = booted.db.tables.appointments.get(created.id);
    expect(stored?.version).toBe(created.version + 1);
    expect(stored?.startAt.toISOString()).toBe(slot.startAt);
  });

  it("returns branch and VETERINARIAN professional options scoped to the tenant", async () => {
    const response = await supertest(server())
      .get("/appointments/options")
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);

    const body = response.body as {
      branches: { id: string; name: string }[];
      professionals: { membershipId: string }[];
    };
    expect(body.branches.map((branch) => branch.id)).toContain(fixture.a.branch.id);
    expect(body.branches.map((branch) => branch.id)).not.toContain(fixture.b.branch.id);
    const professionalIds = body.professionals.map((entry) => entry.membershipId);
    expect(professionalIds).toContain(fixture.a.professionalMembershipId);
    expect(professionalIds).not.toContain(fixture.b.professionalMembershipId);
  });
});
