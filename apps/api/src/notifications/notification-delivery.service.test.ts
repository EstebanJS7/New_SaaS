import { describe, expect, it } from "vitest";
import type { Prisma } from "@newsaas/database";
import {
  NOTIFICATION_DELIVERY_ATTEMPT_HISTORY_LIMIT,
  NOTIFICATION_DELIVERY_LIST_LIMIT_DEFAULT,
  notificationDeliveryListQuerySchema,
  toNotificationDeliveryResponse,
  type NotificationDeliveryAttemptRow,
  type NotificationDeliveryRow,
} from "./notification-delivery.dto.js";
import {
  NotificationDeliveryService,
  type NotificationDeliveryReadPrisma,
} from "./notification-delivery.service.js";
import { NOTIFICATIONS_PERMISSIONS } from "./notifications.permissions.js";
import type { PermissionResolver } from "../rbac/permission-resolver.service.js";
import type { RequestContextService } from "../context/request-context.service.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "99999999-9999-4999-8999-999999999999";

function row(overrides: Partial<NotificationDeliveryRow> = {}): NotificationDeliveryRow {
  const at = new Date("2026-10-17T10:00:00.000Z");
  return {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    channel: "EMAIL",
    status: "SCHEDULED",
    sourceType: "APPOINTMENT",
    sourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    recipientType: "CUSTOMER",
    recipientId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    scheduledAt: at,
    attemptCount: 0,
    lastAttemptAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    providerReference: null,
    sentAt: null,
    cancelledAt: null,
    cancellationReason: null,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

interface Harness {
  service: NotificationDeliveryService;
  /** The arguments the service passed to Prisma, typed rather than via `mock.calls`. */
  manyCalls: Prisma.NotificationDeliveryFindManyArgs[];
  firstCalls: Prisma.NotificationDeliveryFindFirstArgs[];
  attemptCalls: Prisma.NotificationDeliveryAttemptFindManyArgs[];
}

/**
 * The bound and the ordering are asserted **on the arguments**, because the
 * in-memory Prisma harness applies the predicate but honours neither `take` nor
 * `orderBy` — so an end-to-end assertion would pass whatever the service asked for.
 * The typed call arrays keep the assertion honest about what is being claimed.
 */
function harness(
  options: {
    rows?: NotificationDeliveryRow[];
    attempts?: NotificationDeliveryAttemptRow[];
    permissions?: readonly string[];
  } = {}
): Harness {
  const manyCalls: Prisma.NotificationDeliveryFindManyArgs[] = [];
  const firstCalls: Prisma.NotificationDeliveryFindFirstArgs[] = [];
  const attemptCalls: Prisma.NotificationDeliveryAttemptFindManyArgs[] = [];
  const prisma: NotificationDeliveryReadPrisma = {
    notificationDelivery: {
      findMany: (args) => {
        manyCalls.push(args);
        return Promise.resolve(options.rows ?? []);
      },
      findFirst: (args) => {
        firstCalls.push(args);
        return Promise.resolve((options.rows ?? [])[0] ?? null);
      },
    },
    notificationDeliveryAttempt: {
      findMany: (args) => {
        attemptCalls.push(args);
        return Promise.resolve(options.attempts ?? []);
      },
    },
  };
  const requestContext = { requireTenantId: () => TENANT } as unknown as RequestContextService;
  const permissionResolver = {
    resolveForActiveRequest: () =>
      Promise.resolve(new Set(options.permissions ?? [NOTIFICATIONS_PERMISSIONS.deliveryRead])),
  } as unknown as PermissionResolver;
  return {
    service: new NotificationDeliveryService(prisma, requestContext, permissionResolver),
    manyCalls,
    firstCalls,
    attemptCalls,
  };
}

describe("NotificationDeliveryService — the read contract", () => {
  it("scopes every read to the context's tenant, never an argument", async () => {
    const { service, manyCalls, firstCalls } = harness({ rows: [row()] });
    await service.list({});
    await service.get(row().id);

    // The tenant comes from the request context; there is no parameter that could
    // carry a different one, and it is INSIDE the predicate rather than applied
    // afterwards, so a foreign row does not match at all.
    expect(manyCalls[0].where).toMatchObject({ tenantId: TENANT });
    expect(firstCalls[0].where).toMatchObject({ id: row().id, tenantId: TENANT });
    expect(JSON.stringify(manyCalls[0].where)).not.toContain(OTHER_TENANT);
  });

  it("bounds the list at the contract, defaulting rather than reading everything", async () => {
    const { service, manyCalls } = harness();
    await service.list({});
    expect(manyCalls[0].take).toBe(NOTIFICATION_DELIVERY_LIST_LIMIT_DEFAULT);

    await service.list({ limit: 7 });
    expect(manyCalls[1].take).toBe(7);

    // A deterministic order, so a page is a page and two identical calls agree.
    expect(manyCalls[0].orderBy).toEqual([{ scheduledAt: "desc" }, { id: "desc" }]);
  });

  it("carries only the supplied filters into the predicate", async () => {
    const { service, manyCalls } = harness();
    await service.list({});
    expect(manyCalls[0].where).not.toHaveProperty("status");
    expect(manyCalls[0].where).not.toHaveProperty("channel");

    await service.list({ status: "FAILED", channel: "WHATSAPP" });
    expect(manyCalls[1].where).toMatchObject({
      status: "FAILED",
      channel: "WHATSAPP",
    });
  });

  it("filters by the source reference, which is the surface's central question", async () => {
    const { service, manyCalls } = harness();
    await service.list({
      sourceType: "APPOINTMENT",
      sourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(manyCalls[0].where).toMatchObject({
      sourceType: "APPOINTMENT",
      sourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
  });

  it("maps an allowlist, so a column the row happens to carry cannot leak", () => {
    // A row with MORE than the projection names: the mapper is the fence.
    const response = toNotificationDeliveryResponse({
      ...row(),
      messageBody: "Your appointment is at 10:00",
      contactValue: "+595981123456",
    } as NotificationDeliveryRow);

    expect(Object.keys(response).sort()).toEqual(
      [
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
      ].sort()
    );
    expect(JSON.stringify(response)).not.toContain("+595981123456");
    expect(JSON.stringify(response)).not.toContain("Your appointment is at");
  });

  it("selects a narrow projection rather than every column", async () => {
    const { service, manyCalls, firstCalls } = harness({ rows: [row()] });
    await service.list({});
    await service.get(row().id);
    for (const select of [manyCalls[0].select, firstCalls[0].select]) {
      expect(select).toBeDefined();
      // The datum and the dedupe key are not part of the read contract.
      expect(select).not.toHaveProperty("contactValue");
      expect(select).not.toHaveProperty("messageBody");
    }
  });

  it("reads the attempt history for the DETAIL, bounded and newest-windowed", async () => {
    const attempts: NotificationDeliveryAttemptRow[] = [
      {
        attemptNumber: 3,
        outcome: "FAILED",
        reasonCode: "PROVIDER_REJECTED",
        reasonMessage: "Provider refused the address.",
        occurredAt: new Date("2026-10-18T10:02:00.000Z"),
      },
      {
        attemptNumber: 2,
        outcome: "FAILED",
        reasonCode: "TIMEOUT",
        reasonMessage: null,
        occurredAt: new Date("2026-10-18T10:01:00.000Z"),
      },
    ];
    const { service, attemptCalls } = harness({ rows: [row()], attempts });
    const detail = await service.get(row().id);

    // The read is bounded, and it takes the NEWEST window before reversing: a bounded read
    // that returned the oldest twenty would hide exactly the attempts an operator is
    // looking at a failure for.
    expect(attemptCalls[0]?.take).toBe(NOTIFICATION_DELIVERY_ATTEMPT_HISTORY_LIMIT);
    expect(attemptCalls[0]?.orderBy).toEqual({ attemptNumber: "desc" });
    expect(attemptCalls[0]?.where).toEqual({ deliveryId: row().id });
    // Chronological once mapped, so the story reads top to bottom.
    expect(detail.attempts.map((attempt) => attempt.attemptNumber)).toEqual([2, 3]);
    expect(detail.attempts[0]).toEqual({
      attemptNumber: 2,
      outcome: "FAILED",
      reasonCode: "TIMEOUT",
      reasonMessage: null,
      occurredAt: "2026-10-18T10:01:00.000Z",
    });
  });

  it("reads NO attempt history for the LIST, so the read surface stays one query per page", async () => {
    const { service, attemptCalls } = harness({ rows: [row()] });
    await service.list({});
    // The list carrying a per-row attempt query is the N+1 this surface does not have, and
    // the assertion is here because the obvious way to add this feature gets it wrong.
    expect(attemptCalls).toHaveLength(0);
  });

  it("does not read attempts for a delivery the caller cannot see", async () => {
    const { service, attemptCalls } = harness({ rows: [] });
    await expect(service.get(row().id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // The 404 comes first, so a foreign id never touches the second table.
    expect(attemptCalls).toHaveLength(0);
  });

  it("answers an unknown delivery with NOT_FOUND", async () => {
    const { service } = harness({ rows: [] });
    await expect(service.get(row().id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses a caller without the read permission, in the service as well as the route", async () => {
    const { service } = harness({ permissions: [] });
    await expect(service.list({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.get(row().id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("notificationDeliveryListQuerySchema — the closed query", () => {
  it("accepts the documented shapes and nothing else", () => {
    expect(notificationDeliveryListQuerySchema.safeParse({}).success).toBe(true);
    expect(notificationDeliveryListQuerySchema.safeParse({ status: "FAILED" }).success).toBe(true);
    expect(
      notificationDeliveryListQuerySchema.safeParse({ channel: "EMAIL", limit: "10" }).success
    ).toBe(true);
  });

  it("refuses an unknown key instead of ignoring it", () => {
    // Ignoring it would let a caller believe a filter applied when it did not.
    expect(notificationDeliveryListQuerySchema.safeParse({ tenantId: OTHER_TENANT }).success).toBe(
      false
    );
    expect(notificationDeliveryListQuerySchema.safeParse({ sourceId: "x" }).success).toBe(false);
  });

  it("refuses an out-of-vocabulary status or channel", () => {
    expect(notificationDeliveryListQuerySchema.safeParse({ status: "SENT_BY_HAND" }).success).toBe(
      false
    );
    expect(notificationDeliveryListQuerySchema.safeParse({ channel: "SMS" }).success).toBe(false);
  });

  it("accepts the source reference and refuses one that is not an identifier", () => {
    const sourceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    expect(
      notificationDeliveryListQuerySchema.safeParse({ sourceType: "APPOINTMENT", sourceId }).success
    ).toBe(true);
    expect(notificationDeliveryListQuerySchema.safeParse({ sourceType: "NOTE" }).success).toBe(
      false
    );
    // A source reference is an identifier, never a fragment of one: a prefix search
    // would be an unbounded scan dressed as a filter.
    expect(notificationDeliveryListQuerySchema.safeParse({ sourceId: "aaaa" }).success).toBe(false);
    expect(
      notificationDeliveryListQuerySchema.safeParse({ sourceId: sourceId.slice(0, 35) }).success
    ).toBe(false);
  });

  it("refuses an oversized limit rather than clamping it silently", () => {
    expect(notificationDeliveryListQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(notificationDeliveryListQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(notificationDeliveryListQuerySchema.safeParse({ limit: -1 }).success).toBe(false);
    expect(notificationDeliveryListQuerySchema.safeParse({ limit: 1.5 }).success).toBe(false);
  });
});
