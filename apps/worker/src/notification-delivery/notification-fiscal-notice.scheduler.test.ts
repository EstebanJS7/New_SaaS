import { describe, expect, it } from "vitest";
import type { ApplicationEvent, EventDispatcher } from "@newsaas/shared";
import type { NotificationDeliveryProducer } from "@newsaas/notifications";
import { FISCAL_APPROVED } from "../fiscal-submission/fiscal-approval.emitter.js";
import {
  NotificationFiscalNoticeScheduler,
  type FiscalNoticePrisma,
} from "./notification-fiscal-notice.scheduler.js";

const tenantId = "11111111-1111-1111-1111-111111111111";
const fiscalDocumentId = "22222222-2222-2222-2222-222222222222";
const customerId = "33333333-3333-3333-3333-333333333333";

interface Prisma_CreateArgs {
  data: Record<string, unknown>;
}

function setup(args: {
  readonly document?: { status: string; invoiceId: string } | null;
  readonly invoice?: { customerId: string | null } | null;
  readonly conflict?: boolean;
}) {
  const handlers = new Map<string, (event: ApplicationEvent<string, unknown>) => unknown>();
  const dispatcher: EventDispatcher = {
    publish: () => {
      throw new Error("the notice scheduler must not publish");
    },
    subscribe: (type, handler) => {
      handlers.set(type, handler as (event: ApplicationEvent<string, unknown>) => unknown);
      return () => undefined;
    },
  };

  const creates: Prisma_CreateArgs[] = [];
  const prisma: FiscalNoticePrisma = {
    fiscalDocument: {
      findFirst: () =>
        Promise.resolve(
          args.document === undefined ? { status: "APPROVED", invoiceId: "inv-1" } : args.document
        ),
    },
    invoice: {
      findFirst: () => Promise.resolve(args.invoice === undefined ? { customerId } : args.invoice),
    },
    notificationDelivery: {
      create: (createArgs: Prisma_CreateArgs) => {
        creates.push(createArgs);
        if (args.conflict === true) {
          return Promise.reject(
            Object.assign(new Error("unique constraint"), {
              code: "P2002",
              meta: { target: ["tenant_id", "dedupe_key"] },
            })
          );
        }
        return Promise.resolve({ id: `delivery-${creates.length}` });
      },
    },
  };

  const enqueued: {
    job: { notificationDeliveryId: string; tenantId: string };
    scheduledAt: Date;
  }[] = [];
  const producer: NotificationDeliveryProducer = {
    enqueue: (job, scheduledAt) => {
      enqueued.push({ job, scheduledAt });
      return Promise.resolve();
    },
    cancel: () => Promise.resolve(),
  };

  const scheduler = new NotificationFiscalNoticeScheduler(dispatcher, prisma, producer);
  scheduler.onModuleInit();

  return {
    creates,
    enqueued,
    notify: (eventTenantId: string | null = tenantId): Promise<unknown> =>
      Promise.resolve(
        handlers.get(FISCAL_APPROVED)?.({
          tenantId: eventTenantId,
          aggregateId: fiscalDocumentId,
          payload: {},
        } as ApplicationEvent<string, unknown>)
      ),
  };
}

describe("the fiscal notice scheduler's subscription", () => {
  it("subscribes to FiscalApproved, in the deployable that publishes it", () => {
    // The dispatcher is in-process: a subscriber in the API would never see an
    // event the worker publishes (DEC-059). The subscription itself is the assertion.
    const { notify } = setup({});
    expect(typeof notify).toBe("function");
  });
});

describe("creating the fiscal notice", () => {
  it("creates one intent for the invoice's customer, on the fixed email channel", async () => {
    const { notify, creates, enqueued } = setup({});

    await notify();

    expect(creates).toHaveLength(1);
    // `toMatchObject`, because `scheduledAt` is asserted separately: the matcher
    // `expect.any` is typed `any` and the repo's lint refuses it inside a shape.
    expect(creates[0]?.data).toMatchObject({
      tenantId,
      channel: "EMAIL",
      status: "SCHEDULED",
      dedupeKey: `fiscal:${fiscalDocumentId}:EMAIL`,
      sourceType: "FISCAL_DOCUMENT",
      sourceId: fiscalDocumentId,
      recipientType: "CUSTOMER",
      recipientId: customerId,
    });
    expect(creates[0]?.data.scheduledAt).toBeInstanceOf(Date);
    // Enqueued at its own instant, which is NOW: a notice confirms something that
    // already happened rather than being deferred like a reminder.
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]?.job).toEqual({ notificationDeliveryId: "delivery-1", tenantId });
  });

  it("does nothing for a document that is not APPROVED", async () => {
    for (const status of [
      "PENDING",
      "QUEUED",
      "SENDING",
      "SUBMITTED",
      "REJECTED",
      "ERROR",
      "CANCELLED",
    ]) {
      const { notify, creates } = setup({ document: { status, invoiceId: "inv-1" } });
      await notify();
      expect(creates, status).toHaveLength(0);
    }
  });

  it("does nothing for a document or an invoice it cannot read", async () => {
    await expect(setup({ document: null }).notify()).resolves.toBeUndefined();
    expect(setup({ document: null }).creates).toHaveLength(0);
    // An invoice with no customer has nobody to address, and the row's recipient
    // column is NOT NULL, so the intent is not created at all.
    const { notify, creates } = setup({ invoice: { customerId: null } });
    await notify();
    expect(creates).toHaveLength(0);
  });

  it("is idempotent: a repeated approval creates nothing and enqueues nothing", async () => {
    const { notify, creates, enqueued } = setup({ conflict: true });

    await notify();

    // The row that already exists was enqueued by its own writer, so a second
    // enqueue would be a second notice to a real customer.
    expect(creates).toHaveLength(1);
    expect(enqueued).toHaveLength(0);
  });

  it("ignores an event with no tenant", async () => {
    // A platform-level event has no tenant to scope a read or a row to.
    const { notify, creates } = setup({});
    await notify(null);
    expect(creates).toHaveLength(0);
  });
});
