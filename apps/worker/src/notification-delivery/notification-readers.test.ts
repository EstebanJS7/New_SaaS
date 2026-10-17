import { describe, expect, it, vi } from "vitest";
import {
  createNotificationEntitlementReader,
  type NotificationEntitlementClient,
} from "./notification-entitlement.read.js";
import {
  createNotificationRecipientReader,
  UnsupportedRecipientTypeError,
  type NotificationRecipientClient,
} from "./notification-recipient.read.js";

const tenantId = "00000000-0000-4000-8000-000000000002";
const customerId = "00000000-0000-4000-8000-000000000003";

type RecipientFindArgs = Parameters<NotificationRecipientClient["customerContact"]["findFirst"]>[0];
type EntitlementFindArgs = Parameters<
  NotificationEntitlementClient["tenantEntitlement"]["findFirst"]
>[0];

function recipientClient(result: { value: string } | null) {
  const findFirst = vi.fn((_args: RecipientFindArgs) => Promise.resolve(result));
  const client: NotificationRecipientClient = {
    customerContact: { findFirst },
  };
  return { client, findFirst };
}

describe("the recipient reader", () => {
  it("reads the channel's own contact kind, tenant-predicated and active only", async () => {
    const { client, findFirst } = recipientClient({ value: "person@example.test" });
    const reader = createNotificationRecipientReader({ client });

    await expect(
      reader.resolve({
        tenantId,
        recipientType: "CUSTOMER",
        recipientId: customerId,
        channel: "EMAIL",
      })
    ).resolves.toEqual({ address: "person@example.test" });

    expect(findFirst).toHaveBeenCalledWith({
      where: { tenantId, customerId, kind: "EMAIL", isActive: true },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      select: { value: true },
    });
  });

  it("reads the PHONE contact for WhatsApp, not the email one", async () => {
    const { client, findFirst } = recipientClient({ value: "+595981123456" });
    const reader = createNotificationRecipientReader({ client });

    await reader.resolve({
      tenantId,
      recipientType: "CUSTOMER",
      recipientId: customerId,
      channel: "WHATSAPP",
    });

    const args = findFirst.mock.calls[0]?.[0];
    expect(args?.where).toMatchObject({ kind: "PHONE" });
  });

  it("answers null when the customer has no active contact of that kind", async () => {
    // `null` is a settled outcome, not an error: a retry cannot create a phone
    // number.
    const { client } = recipientClient(null);
    const reader = createNotificationRecipientReader({ client });

    await expect(
      reader.resolve({
        tenantId,
        recipientType: "CUSTOMER",
        recipientId: customerId,
        channel: "EMAIL",
      })
    ).resolves.toBeNull();
  });

  it("propagates a read failure, so the handler can retry it", async () => {
    // Different from an absent contact on purpose: a database blip is transient.
    const client: NotificationRecipientClient = {
      customerContact: {
        findFirst: () => Promise.reject(new Error("connection terminated")),
      },
    };
    const reader = createNotificationRecipientReader({ client });

    await expect(
      reader.resolve({
        tenantId,
        recipientType: "CUSTOMER",
        recipientId: customerId,
        channel: "EMAIL",
      })
    ).rejects.toThrow(/connection terminated/);
  });

  it("fails closed for a recipient type it has no reader for", async () => {
    const { client } = recipientClient({ value: "someone@example.test" });
    const reader = createNotificationRecipientReader({ client });

    await expect(
      reader.resolve({
        tenantId,
        recipientType: "TEAM_MEMBER" as "CUSTOMER",
        recipientId: customerId,
        channel: "EMAIL",
      })
    ).rejects.toBeInstanceOf(UnsupportedRecipientTypeError);
  });
});

describe("the entitlement reader", () => {
  function entitlementClient(result: { id: string } | null) {
    const findFirst = vi.fn((_args: EntitlementFindArgs) => Promise.resolve(result));
    const client: NotificationEntitlementClient = {
      tenantEntitlement: {
        findFirst,
      },
    };
    return { client, findFirst };
  }

  it("answers true for a grant and queries by the feature code", async () => {
    const { client, findFirst } = entitlementClient({ id: "grant-1" });
    const reader = createNotificationEntitlementReader({ client });

    await expect(reader.has({ tenantId, featureCode: "whatsapp" })).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledWith({
      where: { tenantId, featureCode: { code: "whatsapp" } },
      select: { id: true },
    });
  });

  it("answers false when the tenant holds no grant", async () => {
    const { client } = entitlementClient(null);
    const reader = createNotificationEntitlementReader({ client });
    await expect(reader.has({ tenantId, featureCode: "whatsapp" })).resolves.toBe(false);
  });

  it("propagates a read failure instead of answering false", async () => {
    // Answering `false` here would settle a delivery the tenant is entitled to
    // receive; the handler retries it instead.
    const client: NotificationEntitlementClient = {
      tenantEntitlement: {
        findFirst: () => Promise.reject(new Error("connection terminated")),
      },
    };
    const reader = createNotificationEntitlementReader({ client });

    await expect(reader.has({ tenantId, featureCode: "whatsapp" })).rejects.toThrow(
      /connection terminated/
    );
  });
});
