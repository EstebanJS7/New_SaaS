import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import type { Prisma } from "@newsaas/database";
import { PrismaService } from "@newsaas/database";
import {
  FISCAL_NOTICE_CHANNEL,
  fiscalNoticeDedupeKey,
  NOTIFICATION_DELIVERY_PRODUCER,
  type NotificationDeliveryProducer,
} from "@newsaas/notifications";
import type { ApplicationEvent, EventDispatcher } from "@newsaas/shared";
import { APPLICATION_EVENT_DISPATCHER } from "../events/application-events.module.js";
import { FISCAL_APPROVED } from "../fiscal-submission/fiscal-approval.emitter.js";

/**
 * The fiscal notice's subscriber, and it lives in the WORKER because that is where
 * the event is published.
 *
 * `FiscalApproved` is published by the fiscal submission handler and by the
 * reconciliation sweep, both of which run in this deployable, and the dispatcher is
 * **in-process**: a subscriber registered in the API would never see it
 * ([[DEC-059]]). That is the whole reason this file is here rather than beside the
 * reminder scheduler.
 *
 * The reaction creates ONE intent for the invoice's customer — email, the ungated
 * channel — and enqueues it immediately: a notice is not deferred, unlike the
 * reminder whose lead time is policy.
 */

export interface FiscalNoticePrisma {
  fiscalDocument: {
    findFirst(
      args: Prisma.FiscalDocumentFindFirstArgs
    ): Promise<{ status: string; invoiceId: string } | null>;
  };
  invoice: {
    findFirst(args: Prisma.InvoiceFindFirstArgs): Promise<{ customerId: string | null } | null>;
  };
  notificationDelivery: {
    create(args: Prisma.NotificationDeliveryCreateArgs): Promise<{ id: string }>;
  };
}

/** The unique index that makes a repeated notice idempotent (see the scheduler). */
const DEDUPE_KEY_CONSTRAINT = "notification_delivery_tenant_id_dedupe_key_key";
const DEDUPE_KEY_FIELDS: readonly string[] = ["tenantid", "dedupekey"];

@Injectable()
export class NotificationFiscalNoticeScheduler implements OnModuleInit {
  constructor(
    @Inject(APPLICATION_EVENT_DISPATCHER) private readonly events: EventDispatcher,
    @Inject(PrismaService) private readonly prisma: FiscalNoticePrisma,
    @Inject(NOTIFICATION_DELIVERY_PRODUCER)
    private readonly producer: NotificationDeliveryProducer
  ) {}

  onModuleInit(): void {
    this.events.subscribe(FISCAL_APPROVED, (event) => this.onApproved(event));
  }

  async onApproved(event: ApplicationEvent<string, unknown>): Promise<void> {
    const tenantId = event.tenantId;
    if (tenantId === null) return;

    // The row is the authority: an event that arrives for a document which is not
    // (or is no longer) APPROVED produces no notice, and neither does one whose
    // invoice has no customer to address.
    const document = await this.prisma.fiscalDocument.findFirst({
      where: { id: event.aggregateId, tenantId },
      select: { status: true, invoiceId: true },
    });
    if (document?.status !== "APPROVED") return;

    const invoice = await this.prisma.invoice.findFirst({
      where: { id: document.invoiceId, tenantId },
      select: { customerId: true },
    });
    if (invoice?.customerId === null || invoice === null) return;

    const created = await this.createIntent({
      tenantId,
      fiscalDocumentId: event.aggregateId,
      customerId: invoice.customerId,
    });
    // `null` means the intent already existed: a re-delivered event, or a document
    // the sweep and the handler both resolved.
    if (created === null) return;

    const now = new Date();
    // Enqueued with the delivery's own instant, which is NOW: a confirmation of an
    // approval that already happened is not scheduled for later.
    await this.producer.enqueue({ notificationDeliveryId: created.id, tenantId }, now);
  }

  /** Inserts the intent, or reports that it already existed. */
  private async createIntent(args: {
    readonly tenantId: string;
    readonly fiscalDocumentId: string;
    readonly customerId: string;
  }): Promise<{ id: string } | null> {
    try {
      return await this.prisma.notificationDelivery.create({
        data: {
          tenantId: args.tenantId,
          channel: FISCAL_NOTICE_CHANNEL,
          status: "SCHEDULED",
          dedupeKey: fiscalNoticeDedupeKey({
            fiscalDocumentId: args.fiscalDocumentId,
            channel: FISCAL_NOTICE_CHANNEL,
          }),
          sourceType: "FISCAL_DOCUMENT",
          sourceId: args.fiscalDocumentId,
          recipientType: "CUSTOMER",
          recipientId: args.customerId,
          scheduledAt: new Date(),
        },
        select: { id: true },
      });
    } catch (error) {
      if (isDedupeKeyConflict(error)) return null;
      throw error;
    }
  }
}

/** True only for the `(tenant_id, dedupe_key)` unique, never for another `P2002`. */
function isDedupeKeyConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  if (candidate.code !== "P2002") return false;

  const normalize = (token: string): string => token.toLowerCase().replace(/[^a-z0-9]/g, "");
  const target = candidate.meta?.target;
  const expectedConstraint = normalize(DEDUPE_KEY_CONSTRAINT);
  if (typeof target === "string") return normalize(target) === expectedConstraint;
  if (!Array.isArray(target)) return false;

  const tokens = target.filter((entry): entry is string => typeof entry === "string");
  if (tokens.length === 0) return false;
  if (tokens.length === 1 && normalize(tokens[0] ?? "") === expectedConstraint) return true;
  const normalized = tokens.map(normalize);
  return (
    normalized.length === DEDUPE_KEY_FIELDS.length &&
    DEDUPE_KEY_FIELDS.every((field) => normalized.includes(field))
  );
}
