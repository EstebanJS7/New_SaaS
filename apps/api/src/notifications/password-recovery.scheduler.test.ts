import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@newsaas/database";
import { PLATFORM_TENANT_SLUG } from "@newsaas/database";
import {
  STAFF_RECOVERY_CHANNEL,
  staffRecoveryDedupeKey,
  type NotificationDeliveryProducer,
} from "@newsaas/notifications";
import type { ApplicationEvent, EventDispatcher } from "@newsaas/shared";
import { PASSWORD_RESET_REQUESTED } from "../auth/password-recovery.service.js";
import {
  NotificationIntentService,
  type NotificationIntentPrisma,
} from "./notification-intent.service.js";
import {
  PasswordRecoveryScheduler,
  type PasswordRecoverySchedulerPrisma,
} from "./password-recovery.scheduler.js";

const PLATFORM = "99999999-9999-4999-8999-999999999999";
const PROFILE = "11111111-1111-4111-8111-111111111111";
const DELIVERY = "22222222-2222-4222-8222-222222222222";

function event(overrides: Partial<ApplicationEvent<string, unknown>> = {}) {
  return {
    id: "e1",
    type: PASSWORD_RESET_REQUESTED,
    occurredAt: "2026-10-17T12:00:00.000Z",
    tenantId: null,
    aggregateId: PROFILE,
    payload: {},
    ...overrides,
  } as ApplicationEvent<string, unknown>;
}

interface Harness {
  scheduler: PasswordRecoveryScheduler;
  created: Prisma.NotificationDeliveryCreateArgs[];
  enqueued: { notificationDeliveryId: string; tenantId: string }[];
  tenantLookups: Prisma.TenantFindUniqueArgs[];
}

function harness(
  options: { platform?: { id: string } | null; createFails?: Error; enqueueFails?: Error } = {}
): Harness {
  const created: Prisma.NotificationDeliveryCreateArgs[] = [];
  const enqueued: Harness["enqueued"] = [];
  const tenantLookups: Prisma.TenantFindUniqueArgs[] = [];
  const prisma: PasswordRecoverySchedulerPrisma & NotificationIntentPrisma = {
    tenant: {
      findUnique: (args) => {
        tenantLookups.push(args);
        return Promise.resolve(
          options.platform === undefined ? { id: PLATFORM } : options.platform
        );
      },
    },
    notificationDelivery: {
      create: (args) => {
        created.push(args);
        if (options.createFails) return Promise.reject(options.createFails);
        return Promise.resolve({ id: DELIVERY });
      },
      findFirst: () => Promise.resolve(null),
    },
  };
  const producer = {
    enqueue: (job: { notificationDeliveryId: string; tenantId: string }) => {
      enqueued.push(job);
      return options.enqueueFails ? Promise.reject(options.enqueueFails) : Promise.resolve();
    },
  } as unknown as NotificationDeliveryProducer;
  return {
    scheduler: new PasswordRecoveryScheduler(
      { subscribe: () => () => undefined } as unknown as EventDispatcher,
      prisma,
      new NotificationIntentService(prisma),
      producer
    ),
    created,
    enqueued,
    tenantLookups,
  };
}

describe("PasswordRecoveryScheduler — the message side of a reset request", () => {
  it("subscribes to the event, in the deployable that publishes it", () => {
    // The dispatcher is IN-PROCESS: a subscriber registered anywhere else would
    // silently never fire (DEC-059's rule). This is that property, asserted rather
    // than assumed.
    const subscribed: string[] = [];
    const events = {
      subscribe: (type: string) => {
        subscribed.push(type);
        return () => undefined;
      },
    } as unknown as EventDispatcher;
    const { scheduler } = harness();
    const withSpy = new PasswordRecoveryScheduler(
      events,
      {} as unknown as PasswordRecoverySchedulerPrisma,
      {} as unknown as NotificationIntentService,
      {} as unknown as NotificationDeliveryProducer
    );
    withSpy.onModuleInit();
    expect(subscribed).toEqual([PASSWORD_RESET_REQUESTED]);
    expect(scheduler).toBeDefined();
  });

  it("creates the intent under the PLATFORM tenant and enqueues it", async () => {
    const { scheduler, created, enqueued, tenantLookups } = harness();
    await scheduler.onRequested(event());

    expect(tenantLookups[0]?.where).toEqual({ slug: PLATFORM_TENANT_SLUG });
    const data = created[0]?.data as Record<string, unknown>;
    expect(data).toMatchObject({
      tenantId: PLATFORM,
      channel: STAFF_RECOVERY_CHANNEL,
      sourceType: "STAFF_ACCOUNT",
      recipientType: "STAFF",
      // The source IS the profile: the token is minted at send time, so there is no
      // token row to point at.
      sourceId: PROFILE,
      recipientId: PROFILE,
    });
    expect(String(data.dedupeKey)).toContain(PROFILE);
    expect(enqueued).toEqual([{ notificationDeliveryId: DELIVERY, tenantId: PLATFORM }]);
  });

  it("keys the delivery from the policy, so the two cannot drift", async () => {
    const { scheduler, created } = harness();
    await scheduler.onRequested(event());

    const key = String((created[0]?.data as Record<string, unknown>).dedupeKey);
    // The shape, derived from the policy rather than composed here: the hour boundary
    // itself IS the policy's own case, and what this asserts is that this scheduler
    // calls it instead of building a key of its own — two sites composing one key is
    // how they drift, and the drift would be silent (the index would simply stop
    // deduping).
    expect(key).toBe(
      staffRecoveryDedupeKey({
        userProfileId: PROFILE,
        now: new Date(key.slice(key.lastIndexOf(":") + 1) + ":00:00.000Z"),
      })
    );
    expect(key).toMatch(/^staff-recovery:[0-9a-f-]{36}:\d{4}-\d{2}-\d{2}T\d{2}$/);
  });

  it("does not send when the key is held by a delivery that is no longer pending", async () => {
    const { scheduler, enqueued } = harness();
    const withConflict = new PasswordRecoveryScheduler(
      { subscribe: () => () => undefined } as unknown as EventDispatcher,
      {
        tenant: { findUnique: () => Promise.resolve({ id: PLATFORM }) },
        notificationDelivery: {
          create: () =>
            Promise.reject(
              Object.assign(new Error("duplicate"), {
                code: "P2002",
                meta: { target: "notification_delivery_tenant_id_dedupe_key_key" },
              })
            ),
          findFirst: () => Promise.resolve(null),
        },
      },
      new NotificationIntentService({
        notificationDelivery: {
          create: () => Promise.reject(new Error("unused")),
          findFirst: () => Promise.resolve(null),
        },
      }),
      { enqueue: () => Promise.resolve() } as unknown as NotificationDeliveryProducer
    );
    await withConflict.onRequested(event());
    expect(enqueued).toHaveLength(0);
    expect(scheduler).toBeDefined();
  });

  it("refuses a tenant-scoped event of this type, which would file the mail under a customer", async () => {
    const { scheduler, created, enqueued } = harness();
    await scheduler.onRequested(event({ tenantId: "11111111-1111-4111-8111-1111111111aa" }));
    expect(created).toHaveLength(0);
    expect(enqueued).toHaveLength(0);
  });

  it("reports a missing platform tenant loudly instead of sending nothing quietly", async () => {
    const { scheduler, created, enqueued } = harness({ platform: null });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await scheduler.onRequested(event());

    expect(created).toHaveLength(0);
    expect(enqueued).toHaveLength(0);
    // The reaction cannot report to the caller (the request already answered 202), so
    // an operator console is the only place this can surface — and it must.
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("platform tenant is not seeded"),
      expect.objectContaining({ userProfileId: PROFILE })
    );
    spy.mockRestore();
  });

  it("never throws, and logs the error's NAME only", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failing = harness({ enqueueFails: new Error("redis://user:secret@host") });
    await expect(failing.scheduler.onRequested(event())).resolves.toBeUndefined();

    const logged = JSON.stringify(spy.mock.calls);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("could not be scheduled"),
      expect.objectContaining({ error: "Error" })
    );
    // The dispatcher is fire-and-forget: a rejection here would be an unhandled
    // rejection, and a driver message is where a connection string with credentials
    // lives.
    expect(logged).not.toContain("redis://");
    expect(logged).not.toContain("secret");
    spy.mockRestore();
  });
});
