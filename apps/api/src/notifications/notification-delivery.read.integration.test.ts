import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import { expectCrossTenant404 } from "../../test/support/expect-cross-tenant-404.js";
import type { TenantRow } from "../../test/support/in-memory-database.js";
import {
  seedRbacActor,
  seedRoleWithKeys,
  type RbacActor,
} from "../../test/support/rbac-fixture.js";
import { NOTIFICATIONS_PERMISSIONS } from "./notifications.permissions.js";
import type { NotificationDeliveryStatusRow } from "../../test/support/in-memory-database.js";

/**
 * The notification-delivery read surface over real HTTP ([[NOTIF-004]]).
 *
 * What this suite can and cannot prove, stated rather than implied: the in-memory
 * Prisma harness applies the predicate but not `take`/`orderBy`, so **the bound and
 * the ordering are proven in the service's own suite, on the arguments**, and this
 * suite proves what the harness does honour — the tenant predicate, the permission
 * chain, the refusal of a malformed query, and the response's shape.
 */

interface ReadTenant {
  tenant: TenantRow;
  actor: RbacActor;
}

function seedTenant(booted: BootedTestApp, label: string, permitted: boolean): ReadTenant {
  const suffix = randomUUID().slice(0, 8);
  const tenant = booted.db.prisma.tenant.create({
    data: { slug: `notif-read-${label}-${suffix}`, name: `Notif read ${label}` },
  });
  const role = seedRoleWithKeys(
    booted.db,
    `NOTIF_READ_${label}_${suffix}`,
    `Notif read ${label}`,
    permitted ? [NOTIFICATIONS_PERMISSIONS.deliveryRead] : []
  );
  const actor = seedRbacActor(booted.db, {
    email: `notif-read-${label}-${suffix}@isolation.test`,
    tenantId: tenant.id,
    roleId: role.role.id,
  });
  return { tenant, actor };
}

function seedDelivery(
  booted: BootedTestApp,
  tenantId: string,
  overrides: {
    status?: NotificationDeliveryStatusRow;
    channel?: "EMAIL" | "WHATSAPP";
    scheduledAt?: Date;
    sourceId?: string;
  } = {}
) {
  return booted.db.prisma.notificationDelivery.create({
    data: {
      tenantId,
      channel: overrides.channel ?? "EMAIL",
      status: overrides.status ?? "SCHEDULED",
      dedupeKey: `appointment:${randomUUID()}:EMAIL`,
      sourceType: "APPOINTMENT",
      sourceId: overrides.sourceId ?? randomUUID(),
      recipientType: "CUSTOMER",
      recipientId: randomUUID(),
      scheduledAt: overrides.scheduledAt ?? new Date("2026-10-18T10:00:00.000Z"),
    },
  });
}

const list = (booted: BootedTestApp, cookie: string, query = "") =>
  supertest(booted.app.getHttpServer())
    .get(`/notifications/deliveries${query}`)
    .set("Cookie", cookie);

const detail = (booted: BootedTestApp, cookie: string, id: string) =>
  supertest(booted.app.getHttpServer())
    .get(`/notifications/deliveries/${id}`)
    .set("Cookie", cookie);

const RESPONSE_KEYS = [
  "id",
  "channel",
  "status",
  "sourceType",
  "sourceId",
  "recipientType",
  "recipientId",
  "scheduledAt",
  "attemptCount",
  "lastAttemptAt",
  "lastErrorCode",
  "lastErrorMessage",
  "providerReference",
  "sentAt",
  "cancelledAt",
  "cancellationReason",
  "createdAt",
  "updatedAt",
];

describe("Notification delivery read surface", () => {
  let booted: BootedTestApp;
  let permitted: ReadTenant;
  let foreign: ReadTenant;
  let forbidden: ReadTenant;

  beforeAll(async () => {
    booted = await bootTestApp();
    permitted = seedTenant(booted, "a", true);
    foreign = seedTenant(booted, "b", true);
    forbidden = seedTenant(booted, "c", false);
  });
  afterAll(async () => booted.close());

  it("lists the tenant's deliveries with an allowlisted projection", async () => {
    const mine = seedDelivery(booted, permitted.tenant.id, { channel: "WHATSAPP" });
    const response = await list(booted, permitted.actor.cookie).expect(200);
    const body = response.body as { deliveries: Record<string, unknown>[] };
    expect(body.deliveries.length).toBeGreaterThan(0);
    expect(Object.keys(body.deliveries[0] ?? {}).sort()).toEqual([...RESPONSE_KEYS].sort());

    const found = body.deliveries.find((item) => item.id === mine.id);
    expect(found).toBeDefined();
    expect(found?.channel).toBe("WHATSAPP");
    expect(found?.recipientType).toBe("CUSTOMER");
    // A reference, not the datum: the id is a uuid, never a phone number or an
    // address, and nothing resembling message content is present.
    expect(found?.recipientId).toMatch(/^[0-9a-f-]{36}$/);
    // The scan runs over the body with UUIDs MASKED OUT.
    //
    // This assertion used to scan the raw JSON, and `/[+]?\d{9,}/` matches nine
    // or more consecutive digits — which a `randomUUID()` contains by chance
    // (nine hex digits that happen to all be decimal, about 1.5 % per UUID, and
    // a delivery carries several). That made a green suite fail intermittently on
    // data nobody wrote, which is the worst kind of flake: it looks like a leak
    // and it is an artefact of the identifier's alphabet.
    //
    // Masking identifiers first keeps the assertion's actual subject — that no
    // phone number, address or timestamp of the payload reached the projection —
    // while removing the alphabet that could impersonate one.
    const withoutIdentifiers = JSON.stringify(body).replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      "<uuid>"
    );
    expect(withoutIdentifiers).not.toMatch(/[+]?\d{9,}|@|\bat\b\s*10:00/);
  });

  it("never shows another tenant's delivery", async () => {
    const theirs = seedDelivery(booted, foreign.tenant.id);
    const response = await list(booted, permitted.actor.cookie).expect(200);
    const body = response.body as { deliveries: { id: string }[] };
    expect(body.deliveries.map((item) => item.id)).not.toContain(theirs.id);
  });

  it("filters by status and by channel", async () => {
    seedDelivery(booted, permitted.tenant.id, { status: "FAILED", channel: "EMAIL" });
    const failed = await list(booted, permitted.actor.cookie, "?status=FAILED").expect(200);
    const body = failed.body as { deliveries: { status: string }[] };
    expect(body.deliveries.length).toBeGreaterThan(0);
    expect(body.deliveries.every((item) => item.status === "FAILED")).toBe(true);

    const whatsapp = await list(booted, permitted.actor.cookie, "?channel=WHATSAPP").expect(200);
    const filtered = whatsapp.body as { deliveries: { channel: string }[] };
    expect(filtered.deliveries.every((item) => item.channel === "WHATSAPP")).toBe(true);
  });

  it("filters by the source reference, still scoped to the caller's tenant", async () => {
    const sourceId = randomUUID();
    const mine = seedDelivery(booted, permitted.tenant.id, { sourceId });
    const theirs = seedDelivery(booted, foreign.tenant.id, { sourceId });
    const response = await list(
      booted,
      permitted.actor.cookie,
      `?sourceType=APPOINTMENT&sourceId=${sourceId}`
    ).expect(200);
    const body = response.body as { deliveries: { id: string }[] };
    // The FOREIGN delivery carries the SAME source reference -- an appointment id is
    // not tenant-unique -- and the filter must not widen the tenant predicate.
    expect(body.deliveries.map((item) => item.id)).toContain(mine.id);
    expect(body.deliveries.map((item) => item.id)).not.toContain(theirs.id);
  });

  it("returns one delivery by id", async () => {
    const mine = seedDelivery(booted, permitted.tenant.id);
    const response = await detail(booted, permitted.actor.cookie, mine.id).expect(200);
    expect((response.body as { id: string }).id).toBe(mine.id);
  });

  it("returns the attempt history on the detail, and never on the list", async () => {
    const mine = seedDelivery(booted, permitted.tenant.id);
    // A sequence the delivery row could not keep: three tries, three reasons, and the row
    // remembers only the last one.
    for (const [number, code] of [
      [1, "TIMEOUT"],
      [2, "PROVIDER_REJECTED"],
      [3, "TIMEOUT"],
    ] as const) {
      booted.db.prisma.notificationDeliveryAttempt.create({
        data: {
          deliveryId: mine.id,
          attemptNumber: number,
          outcome: "FAILED",
          reasonCode: code,
          reasonMessage: `Attempt ${number}.`,
          occurredAt: new Date(`2026-10-18T10:0${number}:00.000Z`),
        },
      });
    }

    // Named `detailResponse`: `detail` is this file's request helper, and a local of the
    // same name would shadow it in its own initializer.
    const detailResponse = await detail(booted, permitted.actor.cookie, mine.id).expect(200);
    const body = detailResponse.body as {
      attempts: { attemptNumber: number; reasonCode: string }[];
    };
    expect(body.attempts.map((attempt) => attempt.attemptNumber)).toEqual([1, 2, 3]);
    expect(body.attempts.map((attempt) => attempt.reasonCode)).toEqual([
      "TIMEOUT",
      "PROVIDER_REJECTED",
      "TIMEOUT",
    ]);

    // The LIST is unchanged: it carries no attempts, which is what keeps its read one query
    // per page rather than one per row.
    const listResponse = await list(booted, permitted.actor.cookie).expect(200);
    const listed = (listResponse.body as { deliveries: Record<string, unknown>[] }).deliveries;
    expect(Object.keys(listed[0] ?? {})).not.toContain("attempts");
  });

  it("answers a foreign delivery exactly like one that does not exist", async () => {
    const theirs = seedDelivery(booted, foreign.tenant.id);
    await expectCrossTenant404({
      app: booted.app,
      cookie: permitted.actor.cookie,
      nonexistentUrl: `/notifications/deliveries/${randomUUID()}`,
      foreignUrl: `/notifications/deliveries/${theirs.id}`,
      forbiddenIdentifiers: [theirs.id, theirs.recipientId, theirs.sourceId],
    });
  });

  it("refuses an actor without the read permission", async () => {
    const response = await list(booted, forbidden.actor.cookie).expect(403);
    expect((response.body as { error: { code: string } }).error.code).toBe("FORBIDDEN");
    const seeded = seedDelivery(booted, forbidden.tenant.id);
    await detail(booted, forbidden.actor.cookie, seeded.id).expect(403);
  });

  it("refuses an unknown query key, an out-of-vocabulary value and an oversized limit", async () => {
    await list(booted, permitted.actor.cookie, "?tenantId=other").expect(400);
    await list(booted, permitted.actor.cookie, "?status=SENT_BY_HAND").expect(400);
    await list(booted, permitted.actor.cookie, "?limit=101").expect(400);
    await list(booted, permitted.actor.cookie, "?sourceType=NOTE").expect(400);
    await list(booted, permitted.actor.cookie, "?sourceId=aaaa").expect(400);
  });

  it("refuses a malformed delivery id before it can reach a query", async () => {
    await detail(booted, permitted.actor.cookie, "not-a-uuid").expect(400);
    await detail(booted, permitted.actor.cookie, "1; DROP TABLE").expect(400);
  });

  it("offers no command route on this surface", async () => {
    const response = await supertest(booted.app.getHttpServer())
      .post("/notifications/deliveries")
      .set("Cookie", permitted.actor.cookie)
      .send({ status: "SENT" });
    expect([404, 405]).toContain(response.status);
  });
});
