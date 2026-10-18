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

function setup(args: {
  readonly sourceType?: "APPOINTMENT" | "FISCAL_DOCUMENT";
  readonly delivery?: { sourceType: string; sourceId: string } | null;
  readonly appointment?: { status: string; startAt: Date; branchId: string } | null;
  readonly branch?: { name: string } | null;
  readonly fiscalDocument?: { status: string; invoiceId: string; cdc: string | null } | null;
  readonly invoice?: { series: string; number: number | null } | null;
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

  const client = {
    notificationDelivery: { findFirst: deliveryFind },
    appointment: { findFirst: appointmentFind },
    branch: { findFirst: branchFind },
    fiscalDocument: { findFirst: fiscalFind },
    invoice: { findFirst: invoiceFind },
  } as unknown as NotificationContentClient;

  return {
    builder: createNotificationContentBuilder({ client }),
    deliveryFind,
    appointmentFind,
    branchFind,
    fiscalFind,
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
