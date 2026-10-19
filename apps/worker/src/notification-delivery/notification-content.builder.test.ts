import { describe, expect, it, vi } from "vitest";
import { NOTIFICATION_DELIVERY_REASON } from "@newsaas/notifications";
import {
  createNotificationContentBuilder,
  formatLocalInstant,
  type NotificationContentClient,
} from "./notification-content.builder.js";

const tenantId = "11111111-1111-1111-1111-111111111111";
const deliveryId = "22222222-2222-2222-2222-222222222222";
const appointmentId = "33333333-3333-3333-3333-333333333333";
const fiscalDocumentId = "44444444-4444-4444-4444-444444444444";
const invoiceId = "55555555-5555-5555-5555-555555555555";
const request = { tenantId, deliveryId, channel: "EMAIL" as const };

/**
 * The instant is chosen to make the TIMEZONE observable: 11:00 UTC is 08:00 in
 * America/Asuncion (UTC-3), so a builder that rendered UTC would be caught.
 */
const START_AT = new Date("2026-10-18T11:00:00.000Z");

/** The deployment origin the recovery link is built from (DAT-007). */
const WEB_APP_BASE_URL = "https://app.example.test";

/** The staff profile a recovery delivery points at, passed explicitly below. */
const staffProfileId = "66666666-6666-4666-8666-666666666666";
const staffDelivery = { sourceType: "STAFF_ACCOUNT", sourceId: staffProfileId };

/** The portal access a recovery delivery points at, passed explicitly below. */
const portalAccessId = "77777777-7777-4777-8777-777777777777";
const portalDelivery = { sourceType: "PORTAL_ACCOUNT", sourceId: portalAccessId };

function setup(args: {
  readonly sourceType?: "APPOINTMENT" | "FISCAL_DOCUMENT" | "STAFF_ACCOUNT";
  readonly delivery?: { sourceType: string; sourceId: string } | null;
  readonly appointment?: { status: string; startAt: Date; branchId: string } | null;
  readonly branch?: { name: string } | null;
  readonly fiscalDocument?: { status: string; invoiceId: string; cdc: string | null } | null;
  readonly invoice?: { series: string; number: number | null } | null;
  readonly profile?: { id: string; credential?: unknown } | null;
  readonly portalAccess?: { id: string; status: string; credential?: unknown } | null;
}) {
  // Locals hold the mocks: an assertion against `client.x.findFirst` would detach
  // an object's method from its receiver, which the lint refuses.
  const deliveryFind = vi.fn(() =>
    Promise.resolve(
      args.delivery === undefined
        ? { sourceType: args.sourceType ?? "APPOINTMENT", sourceId: appointmentId }
        : args.delivery
    )
  );
  const appointmentFind = vi.fn(() =>
    Promise.resolve(
      args.appointment === undefined
        ? { status: "CONFIRMED", startAt: START_AT, branchId: "b-1" }
        : args.appointment
    )
  );
  const branchFind = vi.fn(() =>
    Promise.resolve(args.branch === undefined ? { name: "Sucursal Centro" } : args.branch)
  );
  const fiscalFind = vi.fn(() =>
    Promise.resolve(
      args.fiscalDocument === undefined
        ? { status: "APPROVED", invoiceId, cdc: "cdc-1" }
        : args.fiscalDocument
    )
  );
  const invoiceFind = vi.fn(() =>
    Promise.resolve(args.invoice === undefined ? { series: "A", number: 42 } : args.invoice)
  );
  // Typed with a parameter for the same reason as `tokenCreate`: a zero-argument mock
  // produces a tuple type of length 0, so the call's arguments are unreadable.
  const profileFind = vi.fn((_args: { where: unknown }) =>
    Promise.resolve(
      args.profile === undefined
        ? { id: staffProfileId, credential: { userProfileId: staffProfileId } }
        : args.profile
    )
  );
  // Typed with a parameter so the call's ARGUMENTS are readable in an assertion:
  // a zero-argument mock gives a tuple type of length 0.
  const tokenCreate = vi.fn((_args: { data: unknown }) => Promise.resolve({ id: "token-1" }));
  const tenantFind = vi.fn(() => Promise.resolve({ id: "t-1", slug: "demo" }));
  const portalAccessFind = vi.fn((_args: { where: unknown }) =>
    Promise.resolve(
      args.portalAccess === undefined
        ? { id: "pa-1", status: "ACTIVE", credential: { portalAccessId: "pa-1" } }
        : args.portalAccess
    )
  );
  const portalTokenCreate = vi.fn((_args: { data: unknown }) =>
    Promise.resolve({ id: "portal-token-1" })
  );

  const client = {
    notificationDelivery: { findFirst: deliveryFind },
    appointment: { findFirst: appointmentFind },
    branch: { findFirst: branchFind },
    fiscalDocument: { findFirst: fiscalFind },
    invoice: { findFirst: invoiceFind },
    userProfile: { findFirst: profileFind },
    passwordResetToken: { create: tokenCreate },
    tenant: { findFirst: tenantFind },
    customerPortalAccess: { findFirst: portalAccessFind },
    portalPasswordResetToken: { create: portalTokenCreate },
  } as unknown as NotificationContentClient;

  return {
    builder: createNotificationContentBuilder({ client, webAppBaseUrl: WEB_APP_BASE_URL }),
    deliveryFind,
    appointmentFind,
    branchFind,
    fiscalFind,
    profileFind,
    tokenCreate,
    portalAccessFind,
    portalTokenCreate,
  };
}

describe("the tenant's local instant", () => {
  it("renders in the shared tenant timezone, not in UTC", () => {
    // 11:00Z is 08:00 in Asuncion: a builder that printed UTC would be wrong by
    // three hours and would say so here.
    expect(formatLocalInstant(START_AT)).toContain("08:00");
    expect(formatLocalInstant(START_AT)).toBe(formatLocalInstant(START_AT));
  });
});

describe("TD-044's two fixes", () => {
  it("renders midnight as 00:00, with an explicit hour cycle", () => {
    // `hour12: false` resolves to h23 or h24 depending on the locale's preferred
    // cycle, so another ICU build can say 24:00. `hourCycle: "h23"` is unambiguous,
    // and the boundary is what a reminder is most likely to get wrong.
    const midnight = new Date("2026-10-18T03:00:00.000Z");
    const rendered = formatLocalInstant(midnight);
    expect(rendered).toContain("00:00");
    expect(rendered).not.toContain("24:00");
  });

  it("fails CLOSED for a source type it does not build", async () => {
    // The ternary was fail-open: a third source type would have been announced as
    // an invoice. The switch's default refuses it by name.
    const { builder } = setup({ delivery: { sourceType: "SOMETHING_NEW", sourceId: "x" } });

    await expect(builder.build(request)).resolves.toMatchObject({
      outcome: "UNAVAILABLE",
      reasonCode: NOTIFICATION_DELIVERY_REASON.SOURCE_UNAVAILABLE,
    });
  });
});

describe("the appointment reminder", () => {
  it("builds from the appointment read at send time, naming the branch and the instant", async () => {
    const { builder, deliveryFind, appointmentFind, branchFind } = setup({});

    const outcome = await builder.build(request);

    expect(outcome).toMatchObject({ outcome: "READY", subject: "Recordatorio de turno" });
    if (outcome.outcome === "READY") {
      expect(outcome.body).toContain("Sucursal Centro");
      expect(outcome.body).toContain("08:00");
      // Ordered the way the body reads, for a template channel's parameters.
      expect(outcome.parameters).toHaveLength(2);
      expect(outcome.parameters[0]).toBe("Sucursal Centro");
      expect(outcome.parameters[1]).toContain("08:00");
    }
    // The delivery, the appointment and the branch reads are ALL tenant-predicated.
    expect(deliveryFind).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: deliveryId, tenantId } })
    );
    expect(appointmentFind).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: appointmentId, tenantId } })
    );
    expect(branchFind).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "b-1", tenantId } })
    );
  });

  it("refuses to build for an appointment that is no longer sendable — the send-time gate", async () => {
    // DEC-060's invariant: a cancelled appointment produces no reminder even when
    // the cancellation event never reached this delivery. This read IS the
    // guarantee; the event is the optimisation.
    for (const status of ["CANCELLED", "NO_SHOW", "COMPLETED", "IN_PROGRESS", "SCHEDULED"]) {
      const { builder } = setup({
        appointment: { status, startAt: START_AT, branchId: "b-1" },
      });

      await expect(builder.build(request), status).resolves.toMatchObject({
        outcome: "UNAVAILABLE",
        reasonCode: NOTIFICATION_DELIVERY_REASON.APPOINTMENT_NOT_SENDABLE,
      });
    }
  });

  it("accepts an ARRIVED appointment, whose instant has arrived", async () => {
    const { builder } = setup({
      appointment: { status: "ARRIVED", startAt: START_AT, branchId: "b-1" },
    });
    await expect(builder.build(request)).resolves.toMatchObject({ outcome: "READY" });
  });

  it("fails closed when the appointment or its branch is gone", async () => {
    await expect(setup({ appointment: null }).builder.build(request)).resolves.toMatchObject({
      outcome: "UNAVAILABLE",
      reasonCode: NOTIFICATION_DELIVERY_REASON.SOURCE_UNAVAILABLE,
    });
    await expect(setup({ branch: null }).builder.build(request)).resolves.toMatchObject({
      outcome: "UNAVAILABLE",
      reasonCode: NOTIFICATION_DELIVERY_REASON.SOURCE_UNAVAILABLE,
    });
  });

  it("fails closed for a delivery this tenant cannot see", async () => {
    // A foreign id must not be rendered as somebody else's message.
    const { builder, appointmentFind } = setup({ delivery: null });
    await expect(builder.build(request)).resolves.toMatchObject({
      outcome: "UNAVAILABLE",
      reasonCode: NOTIFICATION_DELIVERY_REASON.SOURCE_UNAVAILABLE,
    });
    // ...and nothing downstream is read.
    expect(appointmentFind).not.toHaveBeenCalled();
  });
});

describe("the fiscal notice", () => {
  const fiscal = {
    sourceType: "FISCAL_DOCUMENT" as const,
    delivery: { sourceType: "FISCAL_DOCUMENT", sourceId: fiscalDocumentId },
  };

  it("names the invoice's document number for an approved document", async () => {
    const { builder, fiscalFind } = setup(fiscal);

    const outcome = await builder.build(request);

    expect(outcome).toMatchObject({
      outcome: "READY",
      subject: "Documento fiscal A-0000042",
      parameters: ["A-0000042"],
    });
    if (outcome.outcome === "READY") {
      expect(outcome.body).toContain("A-0000042");
    }
    expect(fiscalFind).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: fiscalDocumentId, tenantId } })
    );
  });

  it("refuses to announce a document that is not approved", async () => {
    for (const status of [
      "PENDING",
      "QUEUED",
      "SENDING",
      "SIGNING",
      "SUBMITTED",
      "REJECTED",
      "ERROR",
      "CANCELLED",
    ]) {
      const { builder } = setup({
        ...fiscal,
        fiscalDocument: { status, invoiceId, cdc: null },
      });

      await expect(builder.build(request), status).resolves.toMatchObject({
        outcome: "UNAVAILABLE",
        reasonCode: NOTIFICATION_DELIVERY_REASON.FISCAL_DOCUMENT_NOT_APPROVED,
      });
    }
  });

  it("fails closed for a document or an invoice it cannot name", async () => {
    await expect(
      setup({ ...fiscal, fiscalDocument: null }).builder.build(request)
    ).resolves.toMatchObject({ outcome: "UNAVAILABLE" });
    // An unallocated number cannot be announced: the customer would have no way to
    // identify what the notice is about.
    await expect(
      setup({ ...fiscal, invoice: { series: "A", number: null } }).builder.build(request)
    ).resolves.toMatchObject({
      outcome: "UNAVAILABLE",
      reasonCode: NOTIFICATION_DELIVERY_REASON.SOURCE_UNAVAILABLE,
    });
  });
});

describe("the staff password-recovery message (DAT-007)", () => {
  it("mints the token AT SEND TIME and stores only its digest", async () => {
    const { builder, tokenCreate } = setup({ delivery: staffDelivery });
    const outcome = await builder.build(request);

    expect(outcome.outcome).toBe("READY");
    const created = tokenCreate.mock.calls[0]?.[0] as {
      data: { userProfileId: string; tokenHash: string; expiresAt: Date };
    };
    // The gate is the profile's own credential, read NOW rather than trusted from the
    // event that created the intent.
    expect(created.data.userProfileId).toBe(staffProfileId);
    expect(created.data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    // The lifetime starts at the moment of SENDING, not of asking: an SMTP delay must
    // not eat the user's window.
    expect(created.data.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("carries a link built from the deployment's own origin, and never the digest", async () => {
    const { builder, tokenCreate } = setup({ delivery: staffDelivery });
    const outcome = await builder.build(request);
    const created = tokenCreate.mock.calls[0]?.[0] as { data: { tokenHash: string } };

    // Narrowed rather than cast: the outcome is a union, and a READY one is the only
    // shape with a body to read.
    if (outcome.outcome !== "READY") throw new Error(`expected READY, got ${outcome.outcome}`);
    expect(outcome.body).toContain(`${WEB_APP_BASE_URL}/reset-password?token=`);
    // The plaintext is IN the message and nowhere else: the row the builder just wrote
    // holds the digest, so a leaked table yields no usable link.
    const plaintext = outcome.parameters[0]?.split("token=")[1] ?? "";
    expect(plaintext).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.data.tokenHash).not.toContain(plaintext);
    expect(outcome.body).not.toContain(created.data.tokenHash);
  });

  it("refuses a profile that cannot log in at all, and mints nothing", async () => {
    const { builder, tokenCreate } = setup({
      delivery: staffDelivery,
      profile: { id: staffProfileId, credential: null },
    });
    // A link that changes the password of a profile with no credentials is a link to
    // nowhere; failing closed here is what keeps it from being sent.
    await expect(builder.build(request)).resolves.toMatchObject({
      outcome: "UNAVAILABLE",
      reasonCode: NOTIFICATION_DELIVERY_REASON.SOURCE_UNAVAILABLE,
    });
    expect(tokenCreate).not.toHaveBeenCalled();
  });

  it("refuses a profile that no longer exists, and mints nothing", async () => {
    const { builder, tokenCreate } = setup({ delivery: staffDelivery, profile: null });
    await expect(builder.build(request)).resolves.toMatchObject({
      outcome: "UNAVAILABLE",
      reasonCode: NOTIFICATION_DELIVERY_REASON.SOURCE_UNAVAILABLE,
    });
    expect(tokenCreate).not.toHaveBeenCalled();
  });

  it("reads the profile by id ALONE, with no tenant predicate", async () => {
    const { builder, profileFind } = setup({ delivery: staffDelivery });
    await builder.build(request);
    // A staff profile belongs to no tenant — they merely work in some — and the
    // delivery's tenant is the platform one, which owns the message rather than the
    // person. A tenant predicate here would find nobody.
    expect(profileFind.mock.calls[0]?.[0].where).toEqual({ id: staffProfileId });
    expect(JSON.stringify(profileFind.mock.calls[0]?.[0]?.where)).not.toContain(tenantId);
  });
});

describe("the portal password-recovery message (PORTAL-002)", () => {
  it("mints the token AT SEND TIME, keyed to the access, and builds the link with the tenant SLUG", async () => {
    const { builder, portalTokenCreate, portalAccessFind } = setup({ delivery: portalDelivery });
    const url = `${WEB_APP_BASE_URL}/demo/reset-password?token=`;
    const outcome = await builder.build({ ...request, tenantId: "t-1" });

    if (outcome.outcome !== "READY") throw new Error(`expected READY, got ${outcome.outcome}`);
    // The slug is in the PATH, because the page has to know which clinic the holder is at before any
    // session exists.
    expect(outcome.body).toContain(url);
    const created = portalTokenCreate.mock.calls[0]?.[0] as {
      data: { portalAccessId: string; tokenHash: string; expiresAt: Date };
    };
    expect(created.data.portalAccessId).toBe(portalAccessId);
    expect(created.data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    // The plaintext is in the message and nowhere else: the row holds the digest.
    const plaintext = outcome.parameters[0]?.split("token=")[1] ?? "";
    expect(plaintext).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.data.tokenHash).not.toContain(plaintext);

    // The gate is TENANT-predicated: an access belongs to a clinic.
    expect(portalAccessFind.mock.calls[0]?.[0].where).toEqual({
      id: portalAccessId,
      tenantId: "t-1",
    });
  });

  it("refuses a SUSPENDED access and one with no credential, minting nothing", async () => {
    for (const portalAccess of [
      { id: portalAccessId, status: "SUSPENDED", credential: { portalAccessId } },
      { id: portalAccessId, status: "ACTIVE", credential: null },
      null,
    ]) {
      const { builder, portalTokenCreate } = setup({ delivery: portalDelivery, portalAccess });
      await expect(builder.build({ ...request, tenantId: "t-1" })).resolves.toMatchObject({
        outcome: "UNAVAILABLE",
        reasonCode: NOTIFICATION_DELIVERY_REASON.SOURCE_UNAVAILABLE,
      });
      expect(portalTokenCreate).not.toHaveBeenCalled();
    }
  });
});
