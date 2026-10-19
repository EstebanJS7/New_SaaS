import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@newsaas/database";
import {
  PORTAL_RECOVERY_CHANNEL,
  portalRecoveryDedupeKey,
  type NotificationDeliveryProducer,
} from "@newsaas/notifications";
import type { ApplicationEvent, EventDispatcher } from "@newsaas/shared";
import { PORTAL_PASSWORD_RESET_REQUESTED } from "../portal/portal-password-recovery.service.js";
import {
  NotificationIntentService,
  type NotificationIntentPrisma,
} from "./notification-intent.service.js";
import { PortalPasswordRecoveryScheduler } from "./portal-password-recovery.scheduler.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const ACCESS = "22222222-2222-4222-8222-222222222222";
const DELIVERY = "33333333-3333-4333-8333-333333333333";

function event(overrides: Partial<ApplicationEvent<string, unknown>> = {}) {
  return {
    id: "e1",
    type: PORTAL_PASSWORD_RESET_REQUESTED,
    occurredAt: "2026-10-19T12:00:00.000Z",
    tenantId: TENANT,
    aggregateId: ACCESS,
    payload: {},
    ...overrides,
  } as ApplicationEvent<string, unknown>;
}

function harness(options: { createFails?: Error; enqueueFails?: Error } = {}) {
  const created: Prisma.NotificationDeliveryCreateArgs[] = [];
  const enqueued: { notificationDeliveryId: string; tenantId: string }[] = [];
  const prisma: NotificationIntentPrisma = {
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
    scheduler: new PortalPasswordRecoveryScheduler(
      { subscribe: () => () => undefined } as unknown as EventDispatcher,
      new NotificationIntentService(prisma),
      producer
    ),
    created,
    enqueued,
  };
}

describe("PortalPasswordRecoveryScheduler", () => {
  it("creates the intent under the CLINIC's tenant, as a PORTAL_HOLDER, and enqueues it", async () => {
    const { scheduler, created, enqueued } = harness();
    await scheduler.onRequested(event());

    expect(created[0]?.data).toMatchObject({
      tenantId: TENANT,
      channel: PORTAL_RECOVERY_CHANNEL,
      sourceType: "PORTAL_ACCOUNT",
      recipientType: "PORTAL_HOLDER",
      // The source and the recipient are the ACCESS: the token row does not exist yet.
      sourceId: ACCESS,
      recipientId: ACCESS,
    });
    expect(enqueued).toEqual([{ notificationDeliveryId: DELIVERY, tenantId: TENANT }]);
  });

  it("refuses an event with NO tenant — a portal message must belong to a clinic", async () => {
    const { scheduler, created, enqueued } = harness();
    await scheduler.onRequested(event({ tenantId: null }));
    // The mirror of the staff scheduler's rule, which refuses a TENANT-scoped event because its
    // message is platform-owned.
    expect(created).toHaveLength(0);
    expect(enqueued).toHaveLength(0);
  });

  it("keys the delivery by the ACCESS and the hour, from the policy", async () => {
    const { scheduler, created } = harness();
    await scheduler.onRequested(event());
    const key = String((created[0]?.data as Record<string, unknown>).dedupeKey);
    expect(key).toMatch(/^portal-recovery:[0-9a-f-]{36}:\d{4}-\d{2}-\d{2}T\d{2}$/);
    expect(key).toBe(
      portalRecoveryDedupeKey({
        portalAccessId: ACCESS,
        now: new Date(key.slice(key.lastIndexOf(":") + 1) + ":00:00.000Z"),
      })
    );
  });

  it("subscribes to the event, in the deployable that publishes it", () => {
    const subscribed: string[] = [];
    const scheduler = new PortalPasswordRecoveryScheduler(
      {
        subscribe: (type: string) => {
          subscribed.push(type);
          return () => undefined;
        },
      } as unknown as EventDispatcher,
      {} as unknown as NotificationIntentService,
      {} as unknown as NotificationDeliveryProducer
    );
    scheduler.onModuleInit();
    expect(subscribed).toEqual([PORTAL_PASSWORD_RESET_REQUESTED]);
  });

  it("never throws, and logs the error's NAME only", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { scheduler } = harness({ enqueueFails: new Error("redis://user:secret@host") });
    await expect(scheduler.onRequested(event())).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("could not be scheduled"),
      expect.objectContaining({ error: "Error" })
    );
    expect(JSON.stringify(spy.mock.calls)).not.toContain("secret");
    spy.mockRestore();
  });
});
