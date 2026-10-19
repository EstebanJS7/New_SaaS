import type { Prisma } from "@newsaas/database";
import { NOTIFICATION_DELIVERY_REASON } from "@newsaas/notifications";
import {
  generatePasswordResetToken,
  hashPasswordResetToken,
  PASSWORD_RESET_TOKEN_TTL_MS,
  staffRecoveryUrl,
  TENANT_TIME_ZONE,
} from "@newsaas/shared";
import { portalRecoveryUrl } from "@newsaas/notifications";
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
  /** The recovery branch's gate: a profile that cannot log in has no password to reset. */
  /**
   * The credential is `unknown` on purpose: the generated delegate's return type
   * depends on the `select` it is given, so a narrower declaration here does not
   * accept the real client. Nothing reads INTO it — the branch only asks whether it
   * is present, and truthiness is exactly that question.
   */
  userProfile: {
    // `id` is declared alongside the optional relation for a TypeScript reason worth
    // naming: a type whose properties are ALL optional is a "weak type", and the
    // generated delegate is not assignable to one. `id` is also genuinely selected.
    findFirst(
      args: Prisma.UserProfileFindFirstArgs
    ): Promise<{ id: string; credential?: unknown } | null>;
  };
  /**
   * The recovery branch MINTS the token it puts in the message.
   *
   * This is the one place the builder writes, and the reason is DAT-007's issuance
   * model: content is built at send time, a plaintext token cannot be rebuilt from a
   * digest, and the alternatives are all worse — persisting the plaintext, carrying it
   * in the job payload, or sending inline from the request. Minting here is also what
   * keeps the plaintext inside the one function that needs it: it is returned in the
   * message and exists nowhere else.
   */
  passwordResetToken: {
    create(args: Prisma.PasswordResetTokenCreateArgs): Promise<{ id: string }>;
  };
  /**
   * The PORTAL_ACCOUNT branch's three needs ([[PORTAL-002]]): the gate (an ACTIVE access with a
   * credential), the tenant whose slug goes in the link, and the token it mints at send time.
   */
  customerPortalAccess: {
    findFirst(
      args: Prisma.CustomerPortalAccessFindFirstArgs
    ): Promise<{ id: string; status: string; credential?: unknown } | null>;
  };
  tenant: {
    findFirst(args: Prisma.TenantFindFirstArgs): Promise<{ id: string; slug: string } | null>;
  };
  portalPasswordResetToken: {
    create(args: Prisma.PortalPasswordResetTokenCreateArgs): Promise<{ id: string }>;
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
  /**
   * The staff app's origin, used to build the link a recovery message carries. A
   * deployment input rather than a constant: a link pointing at the wrong host hands a
   * LIVE token to whoever owns that host.
   */
  readonly webAppBaseUrl: string;
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
        case "STAFF_ACCOUNT":
          return buildStaffRecovery(args.client, args.webAppBaseUrl, delivery.sourceId);
        case "PORTAL_ACCOUNT":
          return buildPortalRecovery(
            args.client,
            args.webAppBaseUrl,
            delivery.sourceId,
            request.tenantId
          );
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

/**
 * The password-recovery message (DAT-007 WU-D2).
 *
 * The gate is the profile's own credential, read NOW rather than trusted from the
 * event that created the intent: a profile whose credential was removed cannot log in,
 * so a link that changes its password is a link to nowhere. A `status` check is absent
 * for consistency with login, which ignores it — a recovery stricter than login would
 * be a second, contradictory rule about who may enter.
 *
 * The token is minted here, so its lifetime starts at the moment of sending rather than
 * at the moment of asking: an SMTP delay does not eat the user's window. A retried send
 * mints a second token, which is bounded rather than harmful — the profile's outstanding
 * tokens are all spent the moment the password changes, and the hour window caps how
 * many messages can exist at all.
 */
async function buildStaffRecovery(
  client: NotificationContentClient,
  webAppBaseUrl: string,
  userProfileId: string
): Promise<NotificationContentOutcome> {
  const profile = await client.userProfile.findFirst({
    // By id alone, like the recipient reader: a staff profile is an identity and the
    // delivery's tenant is the platform one, which owns the message rather than the
    // person.
    where: { id: userProfileId },
    select: { id: true, credential: { select: { userProfileId: true } } },
  });
  // Falsy rather than `=== null`: a client that does not model the relation answers
  // `undefined`, and a strict null check would read "no credentials" as "has
  // credentials" and mail a link for a password that does not exist.
  if (!profile?.credential) return unavailable(NOTIFICATION_DELIVERY_REASON.SOURCE_UNAVAILABLE);

  const token = generatePasswordResetToken();
  const now = new Date();
  await client.passwordResetToken.create({
    data: {
      userProfileId,
      // Only the DIGEST is stored, following `StaffSession`. The plaintext leaves this
      // function as part of the message and is never persisted.
      tokenHash: hashPasswordResetToken(token),
      expiresAt: new Date(now.getTime() + PASSWORD_RESET_TOKEN_TTL_MS),
    },
    select: { id: true },
  });

  const url = staffRecoveryUrl(webAppBaseUrl, token);
  return {
    outcome: "READY",
    subject: "Recuperación de contraseña",
    // The link is the message. There is no greeting, no name and no tenant: the mail
    // is about a credential, and the fewer facts it carries about who received it, the
    // less it is worth to anybody who reads the inbox by accident.
    body: `Podés elegir una contraseña nueva con este enlace: ${url}`,
    parameters: [url],
  };
}

/**
 * The portal's password-recovery message ([[PORTAL-002]]).
 *
 * Gated on the access being ACTIVE and having a credential, read NOW rather than trusted from the
 * event that created the intent: a holder who lost either cannot sign in, so a link that changes
 * their password is a link to nowhere.
 *
 * The link carries the tenant's SLUG in the path, because the portal surface is `/[slug]/…` and the
 * page must know which clinic the holder is at before any session exists. The token is minted HERE,
 * for the reason the staff branch records: content is built at send time, a plaintext token cannot be
 * rebuilt from a digest, and minting at send time keeps the plaintext inside this one function.
 *
 * `webAppBaseUrl` is reused deliberately: one web app serves both surfaces, and the deployment
 * input's name is a misnomer this Story records rather than renames — changing it would break every
 * existing deployment for a word.
 */
async function buildPortalRecovery(
  client: NotificationContentClient,
  appBaseUrl: string,
  portalAccessId: string,
  tenantId: string
): Promise<NotificationContentOutcome> {
  const access = await client.customerPortalAccess.findFirst({
    where: { id: portalAccessId, tenantId },
    select: { id: true, status: true, credential: { select: { portalAccessId: true } } },
  });
  // The status is explicit — a SUSPENDED access is not a holder who can sign in — and the credential
  // is FALSY rather than `=== null`, because a client that does not model the relation answers
  // `undefined` and a strict null check would read "no credential" as "has one".
  if (access?.status !== "ACTIVE" || !access?.credential) {
    return unavailable(NOTIFICATION_DELIVERY_REASON.SOURCE_UNAVAILABLE);
  }

  const tenant = await client.tenant.findFirst({
    where: { id: tenantId },
    select: { id: true, slug: true },
  });
  if (tenant === null) return unavailable(NOTIFICATION_DELIVERY_REASON.SOURCE_UNAVAILABLE);

  const token = generatePasswordResetToken();
  const now = new Date();
  await client.portalPasswordResetToken.create({
    data: {
      portalAccessId,
      // Only the DIGEST: the plaintext leaves this function inside the message.
      tokenHash: hashPasswordResetToken(token),
      expiresAt: new Date(now.getTime() + PASSWORD_RESET_TOKEN_TTL_MS),
    },
    select: { id: true },
  });

  const url = portalRecoveryUrl(appBaseUrl, tenant.slug, token);
  return {
    outcome: "READY",
    subject: "Recuperación de contraseña",
    body: `Podés elegir una contraseña nueva con este enlace: ${url}`,
    parameters: [url],
  };
}

function unavailable(reasonCode: string): NotificationContentOutcome {
  return {
    outcome: "UNAVAILABLE",
    reasonCode,
    reason: "The delivery's source is unavailable or no longer notifiable.",
  };
}
