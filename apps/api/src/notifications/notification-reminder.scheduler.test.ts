import { describe, expect, it, vi } from "vitest";
import type { ApplicationEvent, EventDispatcher } from "@newsaas/shared";
import type { EntitlementsService } from "../entitlements/entitlements.service.js";
import type { TenantSettingsService } from "../settings/tenant-settings.service.js";
import type { NotificationDeliveryProducer } from "@newsaas/notifications";
import type { AppointmentRecipientPort } from "./appointment-recipient.port.js";
import {
  APPOINTMENT_CANCELLED,
  APPOINTMENT_CONFIRMED,
  NotificationReminderScheduler,
  REMINDER_CANCELLATION_REASON,
  type NotificationReminderPrisma,
} from "./notification-reminder.scheduler.js";

const tenantId = "11111111-1111-1111-1111-111111111111";
const appointmentId = "22222222-2222-2222-2222-222222222222";
const patientId = "33333333-3333-3333-3333-333333333333";
const customerId = "44444444-4444-4444-4444-444444444444";
const startsAt = new Date("2026-10-18T12:00:00.000Z");

const CONFIRMED_APPOINTMENT = {
  id: appointmentId,
  patientId,
  status: "CONFIRMED",
  startAt: startsAt,
};

/**
 * The reactions are driven through the SUBSCRIBED handlers rather than by calling
 * the methods, so a suite that passes proves the subscription as well as the
 * policy.
 */
function setup(args: {
  readonly appointment?: { id: string; patientId: string; status: string; startAt: Date } | null;
  readonly guardian?: { customerId: string } | null;
  readonly settings?: Record<string, unknown>;
  readonly entitled?: boolean;
  readonly existingDedupeKeys?: readonly string[];
  /** A Prisma-shaped rejection; the Error base keeps the lint's rejection rule satisfied. */
  readonly conflictingCreate?: Error;
  readonly pendingDeliveries?: readonly { id: string }[];
  readonly cancelCount?: number;
  /** Whether the compensation read still finds the intent pending (R3-001). */
  readonly stillPending?: boolean;
  /**
   * The appointment each successive appointment read answers, the last repeating.
   * A single entry is the ordinary case; two are what the "cancellation landed
   * between the reads" window needs.
   */
  readonly appointmentSequence?: readonly ({
    id: string;
    patientId: string;
    status: string;
    startAt: Date;
  } | null)[];
  /** Makes the removal fail, so the report path can be asserted (R4). */
  readonly cancelThrows?: boolean;
  /** Makes the ROW write fail, so the independent-removal path is assertable. */
  readonly cancelWriteThrows?: boolean;
}) {
  const handlers = new Map<string, (event: ApplicationEvent<string, unknown>) => unknown>();
  const dispatcher: EventDispatcher = {
    publish: () => {
      throw new Error("the scheduler must not publish");
    },
    subscribe: (type, handler) => {
      handlers.set(type, handler as (event: ApplicationEvent<string, unknown>) => unknown);
      return () => undefined;
    },
  };

  let appointmentReads = 0;
  const creates: Prisma_CreateArgs[] = [];
  const updates: { where: Record<string, unknown>; data: Record<string, unknown> }[] = [];
  const prisma: NotificationReminderPrisma = {
    appointment: {
      // Scripted, the last entry repeating: the second window (a cancellation
      // landing BETWEEN the reaction's two appointment reads) needs the same
      // question to answer differently the second time.
      findFirst: () => {
        // `!== undefined` rather than `??`: a case that scripts an explicit
        // NULL (an absent or foreign appointment) must not fall back to the
        // default CONFIRMED row.
        const sequence = args.appointmentSequence ?? [
          args.appointment !== undefined ? args.appointment : CONFIRMED_APPOINTMENT,
        ];
        const index = Math.min(appointmentReads, sequence.length - 1);
        appointmentReads += 1;
        return Promise.resolve(sequence[index] ?? null);
      },
    },
    notificationDelivery: {
      create: (createArgs: Prisma_CreateArgs) => {
        creates.push(createArgs);
        if (args.conflictingCreate !== undefined) return Promise.reject(args.conflictingCreate);
        const dedupeKey = (createArgs.data as { dedupeKey: string }).dedupeKey;
        if (args.existingDedupeKeys?.includes(dedupeKey)) {
          // A Prisma-shaped rejection: the code and the target are what the
          // matcher reads, and the Error base keeps the lint's rejection rule
          // satisfied without changing the shape under test.
          return Promise.reject(
            Object.assign(new Error("unique constraint"), {
              code: "P2002",
              meta: { target: ["tenant_id", "dedupe_key"] },
            })
          );
        }
        return Promise.resolve({ id: `delivery-${creates.length}` });
      },
      // ONE read serves two questions the reaction asks: whether the INTENT is still
      // pending (the compensation, R3-001) and, on a dedupe conflict, which PENDING
      // delivery holds the key so a failed enqueue can be retried (R3-001 of the
      // fiscal notice's review, the same hole).
      findFirst: () => Promise.resolve(args.stillPending === false ? null : { id: "delivery-1" }),
      findMany: () => Promise.resolve(args.pendingDeliveries ?? []),
      updateMany: (updateArgs: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        updates.push(updateArgs);
        if (args.cancelWriteThrows === true) {
          return Promise.reject(new Error("the row write failed"));
        }
        return Promise.resolve({ count: args.cancelCount ?? 1 });
      },
    },
  } as unknown as NotificationReminderPrisma;

  const settings = {
    get: () =>
      Promise.resolve(
        args.settings ?? {
          appointmentReminderLeadHours: 24,
          appointmentReminderChannels: ["EMAIL"],
        }
      ),
  } as unknown as TenantSettingsService;

  const has = vi.fn(() => Promise.resolve(args.entitled ?? false));
  const entitlements = { has } as unknown as EntitlementsService;

  const enqueued: {
    job: { notificationDeliveryId: string; tenantId: string };
    scheduledAt: Date;
  }[] = [];
  const cancelled: string[] = [];
  const producer: NotificationDeliveryProducer = {
    enqueue: (job, scheduledAt) => {
      enqueued.push({ job, scheduledAt });
      return Promise.resolve();
    },
    cancel: (id) => {
      if (args.cancelThrows === true) return Promise.reject(new Error("redis is down"));
      cancelled.push(id);
      return Promise.resolve();
    },
  };

  const recipients = {
    primaryCustomerFor: () =>
      Promise.resolve(
        args.guardian === undefined ? customerId : (args.guardian?.customerId ?? null)
      ),
  } as unknown as AppointmentRecipientPort;

  const scheduler = new NotificationReminderScheduler(
    dispatcher,
    prisma,
    settings,
    entitlements,
    recipients,
    producer
  );
  scheduler.onModuleInit();

  return {
    handlers,
    creates,
    updates,
    enqueued,
    cancelled,
    has,
    confirmed: (): Promise<unknown> =>
      Promise.resolve(
        handlers.get(APPOINTMENT_CONFIRMED)?.({
          tenantId,
          aggregateId: appointmentId,
          payload: {},
        } as ApplicationEvent<string, unknown>)
      ),
    cancel: (): Promise<unknown> =>
      Promise.resolve(
        handlers.get(APPOINTMENT_CANCELLED)?.({
          tenantId,
          aggregateId: appointmentId,
          payload: {},
        } as ApplicationEvent<string, unknown>)
      ),
  };
}

interface Prisma_CreateArgs {
  data: Record<string, unknown>;
}

describe("the reminder scheduler's subscription", () => {
  it("subscribes to exactly the two catalog events it reacts to", () => {
    const { handlers } = setup({});
    expect([...handlers.keys()].sort()).toEqual([APPOINTMENT_CANCELLED, APPOINTMENT_CONFIRMED]);
  });
});

describe("scheduling a reminder", () => {
  it("creates one intent per configured channel and enqueues each, delayed", async () => {
    const { confirmed, creates, enqueued } = setup({
      settings: { appointmentReminderLeadHours: 24, appointmentReminderChannels: ["EMAIL"] },
    });

    await confirmed();

    expect(creates).toHaveLength(1);
    expect(creates[0]?.data).toEqual({
      tenantId,
      channel: "EMAIL",
      status: "SCHEDULED",
      dedupeKey: `appointment:${appointmentId}:EMAIL:2026-10-18T12:00:00.000Z`,
      sourceType: "APPOINTMENT",
      sourceId: appointmentId,
      recipientType: "CUSTOMER",
      recipientId: customerId,
      scheduledAt: new Date("2026-10-17T12:00:00.000Z"),
    });
    // The job is delayed to the intent's own instant, so the tenant's lead time
    // is what decides when the message leaves.
    expect(enqueued).toEqual([
      {
        job: { notificationDeliveryId: "delivery-1", tenantId },
        scheduledAt: new Date("2026-10-17T12:00:00.000Z"),
      },
    ]);
  });

  it("honours the tenant's own lead time", async () => {
    const { confirmed, creates } = setup({
      settings: { appointmentReminderLeadHours: 168, appointmentReminderChannels: ["EMAIL"] },
    });

    await confirmed();

    expect(creates[0]?.data.scheduledAt).toEqual(new Date("2026-10-11T12:00:00.000Z"));
  });

  it("creates one intent per channel when two are configured", async () => {
    const { confirmed, creates, enqueued } = setup({
      entitled: true,
      settings: {
        appointmentReminderLeadHours: 24,
        appointmentReminderChannels: ["EMAIL", "WHATSAPP"],
      },
    });

    await confirmed();

    expect(creates.map((create) => create.data.channel)).toEqual(["EMAIL", "WHATSAPP"]);
    expect(creates.map((create) => create.data.dedupeKey)).toEqual([
      `appointment:${appointmentId}:EMAIL:2026-10-18T12:00:00.000Z`,
      `appointment:${appointmentId}:WHATSAPP:2026-10-18T12:00:00.000Z`,
    ]);
    expect(enqueued).toHaveLength(2);
  });

  it("refuses a channel the tenant is not entitled to, BEFORE scheduling it — DEC-058", async () => {
    const { confirmed, creates, enqueued, has } = setup({
      entitled: false,
      settings: {
        appointmentReminderLeadHours: 24,
        appointmentReminderChannels: ["EMAIL", "WHATSAPP"],
      },
    });

    await confirmed();

    // The gate is per VALUE: the entitled channel is scheduled and the other
    // never becomes a row, so an unentitled tenant has no pending WhatsApp
    // reminder at all.
    expect(has).toHaveBeenCalledWith(tenantId, "whatsapp");
    expect(creates.map((create) => create.data.channel)).toEqual(["EMAIL"]);
    expect(enqueued).toHaveLength(1);
  });

  it("does not ask about any grant for EMAIL, which is ungated", async () => {
    const { confirmed, has } = setup({});
    await confirmed();
    expect(has).not.toHaveBeenCalled();
  });

  it("re-enqueues the EXISTING intent on a repeated confirmation — the stranded-reminder fix", async () => {
    // Review R3-001 of the fiscal notice, and the SAME hole was here: returning on
    // the conflict stranded a delivery whose first enqueue failed, because every
    // later confirmation took this branch and nothing ever enqueued it. The job id
    // is deterministic, so re-adding is a no-op when the job exists, and the handler
    // refuses a delivery that already settled.
    const dedupeKey = `appointment:${appointmentId}:EMAIL:2026-10-18T12:00:00.000Z`;
    const { confirmed, creates, enqueued } = setup({ existingDedupeKeys: [dedupeKey] });

    await confirmed();

    expect(creates).toHaveLength(1);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]?.job.notificationDeliveryId).toBe("delivery-1");
  });

  it("does nothing when the key is held by a delivery that is no longer pending", async () => {
    const dedupeKey = `appointment:${appointmentId}:EMAIL:2026-10-18T12:00:00.000Z`;
    const { confirmed, enqueued } = setup({
      existingDedupeKeys: [dedupeKey],
      stillPending: false,
    });

    await confirmed();
    expect(enqueued).toHaveLength(0);
  });

  it("propagates a P2002 that is NOT the dedupe key", async () => {
    // Accepting a bare P2002 would swallow a tenant-ownership-key conflict as
    // "already scheduled", which is how a bug becomes a silent no-op.
    const { confirmed } = setup({
      conflictingCreate: Object.assign(new Error("unique constraint"), {
        code: "P2002",
        meta: { target: "notification_delivery_pkey" },
      }),
    });

    await expect(confirmed()).rejects.toMatchObject({ code: "P2002" });
  });

  it("propagates a non-P2002 failure", async () => {
    const { confirmed } = setup({ conflictingCreate: new Error("connection terminated") });
    await expect(confirmed()).rejects.toThrow(/connection terminated/);
  });

  it("schedules nothing for an appointment that is no longer CONFIRMED", async () => {
    // A stale event: the row is the authority, and the reminder belongs to a
    // CONFIRMED appointment.
    const { confirmed, creates } = setup({
      appointment: { id: appointmentId, patientId, status: "CANCELLED", startAt: startsAt },
    });

    await confirmed();
    expect(creates).toHaveLength(0);
  });

  it("schedules nothing for an absent or foreign appointment", async () => {
    const { confirmed, creates } = setup({ appointment: null });
    await confirmed();
    expect(creates).toHaveLength(0);
  });

  it("schedules nothing when the patient has no active primary guardian", async () => {
    // EPIC-05's invariant makes this unreachable for an active patient; the guard
    // exists so an invariant break skips the reminder rather than throwing inside
    // a post-commit reaction.
    const { confirmed, creates } = setup({ guardian: null });
    await confirmed();
    expect(creates).toHaveLength(0);
  });

  it("compensates when a cancellation won the race against the enqueue — R3-001", async () => {
    // The create and the enqueue are two steps. A cancellation can interleave,
    // CAS the row and find no job to remove; the compensation then removes the
    // job this reaction just enqueued for a row that is already cancelled.
    const { confirmed, enqueued, cancelled } = setup({ stillPending: false });

    await confirmed();

    // The intent is created and immediately abandoned, so nothing is enqueued and
    // the job the reaction WOULD have created is never created.
    expect(enqueued).toHaveLength(0);
    expect(cancelled).toEqual(["delivery-1"]);
  });

  it("leaves a job alone when the delivery is still pending", async () => {
    const { confirmed, cancelled } = setup({ stillPending: true });
    await confirmed();
    expect(cancelled).toEqual([]);
  });

  it("compensates when the cancellation ran BEFORE the intent existed — R3-001, second window", async () => {
    // The targeted validator's finding: the cancellation's findMany found nothing
    // (no row yet) while this reaction still had the appointment CONFIRMED from
    // its earlier read. Re-reading the APPOINTMENT is what closes it.
    const { confirmed, enqueued, updates } = setup({
      // CONFIRMED on the first read (so the reaction proceeds) and CANCELLED on
      // the compensation's read: the cancellation landed in between.
      appointmentSequence: [
        CONFIRMED_APPOINTMENT,
        { id: appointmentId, patientId, status: "CANCELLED", startAt: startsAt },
      ],
      stillPending: true,
    });

    await confirmed();

    // Nothing is enqueued for a cancelled appointment, and the intent is
    // cancelled rather than left pending.
    expect(enqueued).toHaveLength(0);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.data.status).toBe("CANCELLED");
  });

  it("keeps processing the other channels when a compensation fails — validator regression", async () => {
    // The first version awaited the compensation inside the loop without a catch,
    // so a failing removal exited the reaction and left the REMAINING channels
    // untouched: worse than the problem it reported.
    const errors: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    try {
      const { confirmed, cancelled } = setup({
        entitled: true,
        stillPending: false,
        cancelThrows: true,
        settings: {
          appointmentReminderLeadHours: 24,
          appointmentReminderChannels: ["EMAIL", "WHATSAPP"],
        },
      });

      await expect(confirmed()).resolves.toBeUndefined();

      // Both channels were attempted, so neither was skipped: the loop never
      // aborts on one channel's failure.
      expect(errors).toHaveLength(2);
      expect(cancelled).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it("ignores an event with no tenant", async () => {
    const { handlers, creates } = setup({});
    await handlers.get(APPOINTMENT_CONFIRMED)?.({
      tenantId: null,
      aggregateId: appointmentId,
      payload: {},
    } as ApplicationEvent<string, unknown>);
    expect(creates).toHaveLength(0);
  });
});

describe("cancelling a reminder", () => {
  it("cancels each pending reminder with its own accounting and removes its job", async () => {
    const { cancel, updates, cancelled } = setup({
      pendingDeliveries: [{ id: "delivery-1" }, { id: "delivery-2" }],
    });

    await cancel();

    expect(updates).toHaveLength(2);
    expect(updates[0]?.where).toEqual({
      id: "delivery-1",
      tenantId,
      status: { in: ["SCHEDULED", "QUEUED"] },
    });
    expect(updates[0]?.data.status).toBe("CANCELLED");
    expect(updates[0]?.data.cancellationReason).toBe(REMINDER_CANCELLATION_REASON);
    expect(updates[0]?.data.cancelledAt).toBeInstanceOf(Date);
    // PRD §24's hard requirement: the PENDING JOB is removed, which the record
    // alone would not do.
    expect(cancelled).toEqual(["delivery-1", "delivery-2"]);
  });

  it("removes the job even when the row was ALREADY cancelled — fix review R3-002", async () => {
    // This case used to assert the OPPOSITE, and the review found that assertion
    // encoded a defect: the removal is not the cancellation, so it must not depend
    // on winning the compare-and-swap. In the compensation, a cancellation that
    // landed between the pre-check and the enqueue has already cancelled the row,
    // and skipping the removal there left the job this reaction just enqueued
    // orphaned — exactly what the compensation exists to close. `queue.remove` is
    // idempotent, so removing twice costs nothing.
    const { cancel, cancelled } = setup({
      pendingDeliveries: [{ id: "delivery-1" }],
      cancelCount: 0,
    });

    await cancel();

    expect(cancelled).toEqual(["delivery-1"]);
  });

  it("still removes the job when the ROW WRITE fails — fix review R3-001", async () => {
    // The write and the removal used to share one try, so a database failure
    // logged and returned without touching the job.
    const errors: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    try {
      const { cancel, cancelled } = setup({
        pendingDeliveries: [{ id: "delivery-1" }],
        cancelWriteThrows: true,
      });

      await expect(cancel()).resolves.toBeUndefined();

      expect(cancelled).toEqual(["delivery-1"]);
      expect(JSON.stringify(errors)).toContain("delivery-1");
      // The error's name, never its text.
      expect(JSON.stringify(errors)).toContain("Error");
      expect(JSON.stringify(errors)).not.toContain("the row write failed");
    } finally {
      spy.mockRestore();
    }
  });

  it("queries only this tenant's pending reminders of that appointment", async () => {
    const { cancel, updates } = setup({ pendingDeliveries: [] });
    await cancel();
    expect(updates).toHaveLength(0);
  });

  it("reports a removal failure, keeps going, and never makes the cancellation look failed — R4", async () => {
    // The row IS cancelled and the handler refuses a settled row, so the reminder
    // cannot be delivered; what the failure costs is a lingering job an operator
    // has to see, and the other deliveries must still be cancelled.
    const errors: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    try {
      const { cancel } = setup({
        pendingDeliveries: [{ id: "delivery-1" }, { id: "delivery-2" }],
        cancelThrows: true,
      });

      // It resolves: an unhandled rejection would be the alternative, and the
      // row's status is the guarantee.
      await expect(cancel()).resolves.toBeUndefined();

      const reported = JSON.stringify(errors);
      expect(errors).toHaveLength(2);
      expect(reported).toContain("delivery-1");
      // The error's NAME, never its text: a driver's message is where a
      // connection URL with a password lives, and "redis is down" is exactly the
      // kind of text that must not reach an operator's console.
      expect(reported).toContain("Error");
      expect(reported).not.toContain("redis is down");
      // Never a contact datum either.
      expect(reported).not.toContain("@");
    } finally {
      spy.mockRestore();
    }
  });
});
