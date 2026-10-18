import type { Prisma } from "@newsaas/database";
import { NOTIFICATION_DELIVERY_REASON } from "@newsaas/notifications";
import { TENANT_TIME_ZONE } from "@newsaas/shared";
import type {
  NotificationContentBuilder,
  NotificationContentOutcome,
  NotificationContentRequest,
} from "./notification-content.js";

/**
 * The real content builder: what a delivery SAYS, built AT SEND TIME from the
 * authoritative rows.
 *
 * Two properties are the whole point of this file, and both were decided before
 * it was written:
 *
 * 1. **It re-reads the source and GATES on it.** The send-time check is the
 *    invariant [[DEC-060]] relies on: a cancelled appointment produces no reminder
 *    even when the cancellation event was lost, delayed, or raced with the
 *    enqueue — the event is the optimisation, this read is the guarantee. It also
 *    closes the residual interleaving window the fix's own review named.
 * 2. **It builds the message HERE rather than storing one.** The delivery record
 *    holds references only, so a reschedule before the reminder fires cannot send
 *    a stale time: the time is read now, not when the intent was created.
 *
 * It reads no Veterinary aggregate. An appointment's PATIENT is Veterinary, so the
 * message names the branch and the instant instead of the patient — a Core builder
 * naming a patient would cross the boundary the recipient port exists to respect,
 * and the limitation is recorded rather than worked around.
 */

/** The statuses an appointment can be in and still deserve a reminder. */
const SENDABLE_APPOINTMENT_STATUSES = Object.freeze(["CONFIRMED", "ARRIVED"]);

/** The document status a notice may be sent for. */
const NOTIFIABLE_FISCAL_STATUS = "APPROVED";

/** The narrow client this builder needs, in Prisma's own arg types. */
export interface NotificationContentClient {
  notificationDelivery: {
    findFirst(
      args: Prisma.NotificationDeliveryFindFirstArgs
    ): Promise<{ sourceType: string; sourceId: string } | null>;
  };
  appointment: {
    findFirst(
      args: Prisma.AppointmentFindFirstArgs
    ): Promise<{ status: string; startAt: Date; branchId: string } | null>;
  };
  branch: {
    findFirst(args: Prisma.BranchFindFirstArgs): Promise<{ name: string } | null>;
  };
  fiscalDocument: {
    findFirst(
      args: Prisma.FiscalDocumentFindFirstArgs
    ): Promise<{ status: string; invoiceId: string; cdc: string | null } | null>;
  };
  invoice: {
    findFirst(
      args: Prisma.InvoiceFindFirstArgs
    ): Promise<{ series: string; number: number | null } | null>;
  };
}

/**
 * Renders an instant in the tenant's timezone.
 *
 * The zone comes from the shared kernel, so the worker and the API cannot
 * disagree about which local time an appointment has.
 */
export function formatLocalInstant(instant: Date): string {
  return new Intl.DateTimeFormat("es-PY", {
    timeZone: TENANT_TIME_ZONE,
    // Explicit fields rather than `dateStyle`: ICU refuses to combine a style with
    // an individual hour, and 24 hours must be explicit because `es-PY`'s own
    // default is 12-hour ("8:00 a. m."). A reminder whose time can be misread by
    // twelve hours is worse than one that reads slightly less naturally.
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    // `hourCycle: "h23"` rather than `hour12: false`: the boolean resolves to h23 or
    // h24 depending on the LOCALE's preferred hour cycle, so another ICU build can
    // render midnight as `24:00` (TD-044 R3-001). Measured on Node 24 / es-PY, where
    // both forms give 00:00 — the explicit cycle removes the dependency on that.
    hourCycle: "h23",
  }).format(instant);
}

export function createNotificationContentBuilder(args: {
  readonly client: NotificationContentClient;
}): NotificationContentBuilder {
  return {
    async build(request: NotificationContentRequest): Promise<NotificationContentOutcome> {
      const delivery = await args.client.notificationDelivery.findFirst({
        where: { id: request.deliveryId, tenantId: request.tenantId },
        select: { sourceType: true, sourceId: true },
      });
      // A delivery this tenant cannot see has no content to build; failing closed
      // here keeps a foreign id from being rendered as somebody else's message.
      if (delivery === null) return unavailable(NOTIFICATION_DELIVERY_REASON.SOURCE_UNAVAILABLE);

      // A switch with an explicit default, not a ternary (TD-044 R3-002): the
      // ternary was fail-OPEN, so a third source type added by a migration before
      // this file learned to build it would have been announced as an invoice.
      switch (delivery.sourceType) {
        case "APPOINTMENT":
          return buildAppointmentReminder(args.client, request, delivery.sourceId);
        case "FISCAL_DOCUMENT":
          return buildFiscalNotice(args.client, request, delivery.sourceId);
        default:
          return unavailable(NOTIFICATION_DELIVERY_REASON.SOURCE_UNAVAILABLE);
      }
    },
  };
}

/** The appointment reminder, gated on the appointment's own current status. */
async function buildAppointmentReminder(
  client: NotificationContentClient,
  request: NotificationContentRequest,
  appointmentId: string
): Promise<NotificationContentOutcome> {
  const appointment = await client.appointment.findFirst({
    where: { id: appointmentId, tenantId: request.tenantId },
    select: { status: true, startAt: true, branchId: true },
  });
  if (appointment === null) return unavailable(NOTIFICATION_DELIVERY_REASON.SOURCE_UNAVAILABLE);

  // THE GATE. A cancelled, missed or completed appointment produces no reminder,
  // whether or not the cancellation event ever reached this delivery.
  if (!SENDABLE_APPOINTMENT_STATUSES.includes(appointment.status)) {
    return {
      outcome: "UNAVAILABLE",
      reasonCode: NOTIFICATION_DELIVERY_REASON.APPOINTMENT_NOT_SENDABLE,
      reason: `The appointment is ${appointment.status.toLowerCase()} and is not reminded.`,
    };
  }

  const branch = await client.branch.findFirst({
    where: { id: appointment.branchId, tenantId: request.tenantId },
    select: { name: true },
  });
  // A branch that cannot be read is not a message worth sending without saying
  // where: the location is half of what a reminder is for.
  if (branch === null) return unavailable(NOTIFICATION_DELIVERY_REASON.SOURCE_UNAVAILABLE);

  const localInstant = formatLocalInstant(appointment.startAt);
  return {
    outcome: "READY",
    subject: "Recordatorio de turno",
    body: `Le recordamos su turno en ${branch.name} para el ${localInstant}.`,
    // Ordered for a template channel, whose text an operator approves: the
    // branch and then the instant, which is the order the body reads in.
    parameters: [branch.name, localInstant],
  };
}

/** The post-approval fiscal notice PRD §36's journey ends a step with. */
async function buildFiscalNotice(
  client: NotificationContentClient,
  request: NotificationContentRequest,
  fiscalDocumentId: string
): Promise<NotificationContentOutcome> {
  const document = await client.fiscalDocument.findFirst({
    where: { id: fiscalDocumentId, tenantId: request.tenantId },
    select: { status: true, invoiceId: true, cdc: true },
  });
  if (document === null) return unavailable(NOTIFICATION_DELIVERY_REASON.SOURCE_UNAVAILABLE);

  // The same discipline as the appointment's gate: the notice is sent for an
  // APPROVED document and for nothing else, read now rather than trusted from the
  // event that scheduled it.
  if (document.status !== NOTIFIABLE_FISCAL_STATUS) {
    return {
      outcome: "UNAVAILABLE",
      reasonCode: NOTIFICATION_DELIVERY_REASON.FISCAL_DOCUMENT_NOT_APPROVED,
      reason: `The fiscal document is ${document.status.toLowerCase()}.`,
    };
  }

  const invoice = await client.invoice.findFirst({
    where: { id: document.invoiceId, tenantId: request.tenantId },
    select: { series: true, number: true },
  });
  // The human-facing identity is the invoice's series plus its allocated number;
  // a document with no number cannot be named, so it is not announced. Two reads
  // rather than one compound condition, because the compound form is the shape the
  // lint rewrites into an optional chain that reads worse.
  if (invoice === null) return unavailable(NOTIFICATION_DELIVERY_REASON.SOURCE_UNAVAILABLE);
  if (invoice.number === null) return unavailable(NOTIFICATION_DELIVERY_REASON.SOURCE_UNAVAILABLE);

  const documentNumber = `${invoice.series}-${String(invoice.number).padStart(7, "0")}`;
  return {
    outcome: "READY",
    subject: `Documento fiscal ${documentNumber}`,
    body: `Su documento fiscal ${documentNumber} está disponible.`,
    parameters: [documentNumber],
  };
}

function unavailable(reasonCode: string): NotificationContentOutcome {
  return {
    outcome: "UNAVAILABLE",
    reasonCode,
    reason: "The delivery's source is unavailable or no longer notifiable.",
  };
}
