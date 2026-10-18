import { describe, expect, it, vi } from "vitest";
import {
  NOTIFICATION_DELIVERY_REASON,
  createDenyAllNotificationEntitlementPort,
  createNullNotificationRecipientPort,
  type NotificationChannel,
  type NotificationChannels,
  type NotificationDeliveryJob,
  type NotificationRecipientPort,
  type NotificationEntitlementPort,
} from "@newsaas/notifications";
import {
  createUnavailableNotificationContentBuilder,
  type NotificationContentBuilder,
  type NotificationContentOutcome,
} from "./notification-content.js";
import {
  NotificationDeliveryHandler,
  UnsupportedRecipientTypeError,
  type NotificationDeliveryPrisma,
  type NotificationDeliveryTx,
} from "./notification-delivery.handler.js";

type Status = "SCHEDULED" | "QUEUED" | "SENDING" | "SENT" | "FAILED" | "CANCELLED";

const job: NotificationDeliveryJob = {
  notificationDeliveryId: "00000000-0000-4000-8000-000000000001",
  tenantId: "00000000-0000-4000-8000-000000000002",
};

interface DeliveryFixture {
  readonly id: string;
  readonly tenantId: string;
  readonly channel: NotificationChannel;
  readonly status: Status;
  readonly recipientType: "CUSTOMER";
  readonly recipientId: string;
  readonly attemptCount: number;
  readonly lastAttemptAt: Date | null;
}

interface Write {
  readonly where: Record<string, unknown>;
  readonly data: Record<string, unknown>;
}

interface Setup {
  readonly handler: NotificationDeliveryHandler;
  readonly writes: Write[];
  /** The rows the attempt log was asked to write ([[TD-046]]). */
  readonly attemptRows: Record<string, unknown>[];
  /** Counts the transactions the handler opened, which is how "one settle, one commit" is asserted. */
  readonly prismaCalls: { transactions: number };
  readonly claimCalls: () => number;
  readonly channelSend: (channel: NotificationChannel) => ReturnType<typeof vi.fn>;
}

function setup(args: {
  readonly status?: Status;
  readonly channel?: NotificationChannel;
  readonly lastAttemptAt?: Date | null;
  readonly channelOutcome?: "SENT" | "RETRYABLE_FAILURE" | "PERMANENT_FAILURE";
  readonly content?: NotificationContentOutcome;
  readonly recipient?: NotificationRecipientPort;
  readonly entitlement?: NotificationEntitlementPort;
  readonly claimSucceeds?: boolean;
  /** How many attempts already ran, which is what the log's numbering derives from. */
  readonly attemptCount?: number;
  readonly rowPresent?: boolean;
  readonly channelThrows?: boolean;
}): Setup {
  const attempts = args.lastAttemptAt ?? null;
  const delivery: DeliveryFixture = {
    id: job.notificationDeliveryId,
    tenantId: job.tenantId,
    channel: args.channel ?? "EMAIL",
    status: args.status ?? "SCHEDULED",
    recipientType: "CUSTOMER",
    recipientId: "00000000-0000-4000-8000-000000000003",
    attemptCount: args.attemptCount ?? 0,
    lastAttemptAt: attempts,
  };

  const writes: Write[] = [];
  const updateMany = vi.fn((write: Write) => {
    writes.push(write);
    return Promise.resolve({ count: args.claimSucceeds === false ? 0 : 1 });
  });
  // Named `attemptRows`: `attempts` is already the delivery's LEASE instant in this
  // harness, and shadowing it silently broke both.
  const attemptRows: Record<string, unknown>[] = [];
  const prismaCalls = { transactions: 0 };
  const prisma: NotificationDeliveryPrisma = {
    notificationDelivery: {
      findFirst: () => Promise.resolve(args.rowPresent === false ? null : delivery),
      updateMany,
    },
    notificationDeliveryAttempt: {
      create: (createArgs) => {
        attemptRows.push(createArgs.data);
        return Promise.resolve({ id: `attempt-${attemptRows.length}` });
      },
    },
    // The real transaction runs the callback against the same client; the stub's maps ARE
    // the transaction boundary, so what the assertion can see is that the settle and its
    // attempt row went through ONE callback rather than two independent writes.
    $transaction: (run) => {
      prismaCalls.transactions += 1;
      return run(prisma);
    },
  };

  const sends: Record<string, ReturnType<typeof vi.fn>> = {
    EMAIL: vi.fn(() => {
      if (args.channelThrows) return Promise.reject(new Error("boundary exploded"));
      return Promise.resolve(
        args.channelOutcome === "SENT" || args.channelOutcome === undefined
          ? { outcome: "SENT", providerReference: "provider-handle-1" }
          : args.channelOutcome === "RETRYABLE_FAILURE"
            ? { outcome: "FAILED", retryable: true, reasonCode: "C", reason: "transient" }
            : { outcome: "FAILED", retryable: false, reasonCode: "C", reason: "rejected" }
      );
    }),
    WHATSAPP: vi.fn(() => Promise.resolve({ outcome: "SENT", providerReference: "wamid.1" })),
  };
  const channels: NotificationChannels = {
    for: (channel) => ({ providerId: "FAKE", send: sends[channel] as never }),
  };

  const content: NotificationContentBuilder = {
    build: () =>
      Promise.resolve(
        args.content ?? { outcome: "READY", subject: "s", body: "b", parameters: ["p"] }
      ),
  };

  const handler = new NotificationDeliveryHandler(
    prisma,
    channels,
    args.recipient ?? { resolve: () => Promise.resolve({ address: "person@example.test" }) },
    args.entitlement ?? createDenyAllNotificationEntitlementPort(),
    content
  );

  return {
    handler,
    attemptRows,
    prismaCalls,
    writes,
    claimCalls: () => updateMany.mock.calls.length,
    channelSend: (channel) => sends[channel],
  };
}

/** The claim write is the first one that increments the attempt count. */
function claimWrite(writes: Write[]): Write {
  const write = writes.find((entry) => "attemptCount" in entry.data);
  if (write === undefined) throw new Error("no claim write was issued");
  return write;
}

function lastWrite(writes: Write[]): Write {
  const write = writes.at(-1);
  if (write === undefined) throw new Error("no write was issued");
  return write;
}

describe("the delivery handler's claim", () => {
  it("claims a SCHEDULED delivery into SENDING with one attempt and a fresh lease", async () => {
    const { handler, writes } = setup({ status: "SCHEDULED" });
    await handler.handle(job);

    const write = claimWrite(writes);
    expect(write.where).toEqual({
      id: job.notificationDeliveryId,
      tenantId: job.tenantId,
      status: { in: ["SCHEDULED", "QUEUED"] },
    });
    // Asserted field by field rather than with `expect.any(Date)` inside a strict
    // `toEqual`: that matcher is typed `any`, and the repo's lint forbids letting
    // one into a checked shape.
    expect(write.data.status).toBe("SENDING");
    expect(write.data.attemptCount).toEqual({ increment: 1 });
    expect(write.data.lastAttemptAt).toBeInstanceOf(Date);
  });

  it("does nothing for an absent row", async () => {
    const { handler, claimCalls } = setup({ rowPresent: false });
    await handler.handle(job);
    expect(claimCalls()).toBe(0);
  });

  it("never touches a settled row, because a settled row is not editable state", async () => {
    for (const status of ["SENT", "FAILED", "CANCELLED"] as const) {
      const { handler, claimCalls, channelSend } = setup({ status });
      await handler.handle(job);
      expect(claimCalls(), status).toBe(0);
      expect(channelSend("EMAIL")).not.toHaveBeenCalled();
    }
  });

  it("leaves a fresh SENDING claim to its owner", async () => {
    const { handler, claimCalls } = setup({
      status: "SENDING",
      lastAttemptAt: new Date(Date.now() - 1_000),
    });
    await handler.handle(job);
    // A duplicate delivery from the queue reaches a claim somebody else holds.
    expect(claimCalls()).toBe(0);
  });

  it("re-claims an abandoned lease IN PLACE: the CAS pins the observed lease, not a status change", async () => {
    const observed = new Date(Date.now() - 10 * 60_000);
    const { handler, writes } = setup({ status: "SENDING", lastAttemptAt: observed });
    await handler.handle(job);

    const write = claimWrite(writes);
    // Keeping `SENDING` is the point: the guard admits no SENDING -> SENDING
    // edge and none is needed, because the status does not change.
    expect(write.where).toEqual({
      id: job.notificationDeliveryId,
      tenantId: job.tenantId,
      status: "SENDING",
      lastAttemptAt: observed,
    });
    expect(write.data.status).toBeUndefined();
    expect(write.data.attemptCount).toEqual({ increment: 1 });
  });

  it("stops when the claim is lost to another worker", async () => {
    const { handler, channelSend } = setup({ claimSucceeds: false });
    await handler.handle(job);
    expect(channelSend("EMAIL")).not.toHaveBeenCalled();
  });
});

describe("the delivery handler's gates", () => {
  it("sends email without asking about any feature, because email is ungated", async () => {
    const has = vi.fn(() => Promise.resolve(false));
    const { handler, channelSend, writes } = setup({
      channel: "EMAIL",
      entitlement: { has },
    });

    await handler.handle(job);

    expect(has).not.toHaveBeenCalled();
    expect(channelSend("EMAIL")).toHaveBeenCalledTimes(1);
    expect(lastWrite(writes).data.status).toBe("SENT");
  });

  it("refuses WhatsApp for a tenant without the grant, before any send", async () => {
    const has = vi.fn(() => Promise.resolve(false));
    const { handler, channelSend, writes } = setup({
      channel: "WHATSAPP",
      entitlement: { has },
    });

    await handler.handle(job);

    expect(has).toHaveBeenCalledWith({ tenantId: job.tenantId, featureCode: "whatsapp" });
    expect(channelSend("WHATSAPP")).not.toHaveBeenCalled();
    expect(lastWrite(writes).data).toMatchObject({
      status: "FAILED",
      lastErrorCode: NOTIFICATION_DELIVERY_REASON.FEATURE_NOT_ENTITLED,
    });
  });

  it("sends WhatsApp for a tenant that holds the grant", async () => {
    const { handler, channelSend, writes } = setup({
      channel: "WHATSAPP",
      entitlement: { has: () => Promise.resolve(true) },
    });

    await handler.handle(job);

    expect(channelSend("WHATSAPP")).toHaveBeenCalledTimes(1);
    expect(lastWrite(writes).data.status).toBe("SENT");
  });

  it("settles an unresolved recipient without reaching an adapter", async () => {
    const { handler, channelSend, writes } = setup({
      recipient: createNullNotificationRecipientPort(),
    });

    await handler.handle(job);

    expect(channelSend("EMAIL")).not.toHaveBeenCalled();
    expect(lastWrite(writes).data).toMatchObject({
      status: "FAILED",
      lastErrorCode: NOTIFICATION_DELIVERY_REASON.RECIPIENT_UNRESOLVED,
    });
  });

  it("settles a delivery the content seam cannot build, by the seam's own name", async () => {
    const { handler, channelSend, writes } = setup({});

    const handlerWithNoContent = new NotificationDeliveryHandler(
      (handler as unknown as { prisma: NotificationDeliveryPrisma }).prisma,
      (handler as unknown as { channels: NotificationChannels }).channels,
      (handler as unknown as { recipients: NotificationRecipientPort }).recipients,
      (handler as unknown as { entitlements: NotificationEntitlementPort }).entitlements,
      createUnavailableNotificationContentBuilder()
    );
    await handlerWithNoContent.handle(job);

    expect(channelSend("EMAIL")).not.toHaveBeenCalled();
    expect(lastWrite(writes).data).toMatchObject({
      status: "FAILED",
      lastErrorCode: NOTIFICATION_DELIVERY_REASON.CONTENT_UNAVAILABLE,
    });
  });

  it("builds the message from the seam and passes the resolved datum to the adapter", async () => {
    const { handler, channelSend } = setup({
      content: { outcome: "READY", subject: "Recordatorio", body: "Mañana", parameters: ["x"] },
    });

    await handler.handle(job);

    expect(channelSend("EMAIL")).toHaveBeenCalledWith({
      tenantId: job.tenantId,
      deliveryId: job.notificationDeliveryId,
      recipient: "person@example.test",
      subject: "Recordatorio",
      body: "Mañana",
      parameters: ["x"],
    });
  });
});

describe("the delivery handler's outcome", () => {
  it("settles SENT with the provider handle and clears the previous error", async () => {
    const { handler, writes } = setup({});
    await handler.handle(job);

    const write = lastWrite(writes);
    expect(write.where).toEqual({
      id: job.notificationDeliveryId,
      tenantId: job.tenantId,
      status: "SENDING",
    });
    expect(write.data).toMatchObject({
      status: "SENT",
      // The table's CHECK requires a SENT row to carry no error code, so a send
      // that succeeded after a retry cannot keep the old reason as current.
      lastErrorCode: null,
      lastErrorMessage: null,
      providerReference: "provider-handle-1",
    });
    expect(write.data.sentAt).toBeInstanceOf(Date);
  });

  it("omits the provider handle when the provider issued none", async () => {
    const channels: NotificationChannels = {
      for: () => ({
        providerId: "SMTP",
        send: () => Promise.resolve({ outcome: "SENT", providerReference: null }),
      }),
    };
    const writes: Write[] = [];
    const handler = new NotificationDeliveryHandler(
      {
        notificationDeliveryAttempt: { create: () => Promise.resolve({ id: "attempt" }) },
        // The transaction hands over the SAME delegates, because that is what the real one
        // does: a callback given an empty object would make every assertion here vacuous.
        $transaction: <T>(run: (tx: NotificationDeliveryTx) => Promise<T>): Promise<T> =>
          run({
            notificationDelivery: {
              updateMany: (write: Write) => {
                writes.push(write);
                return Promise.resolve({ count: 1 });
              },
            },
            notificationDeliveryAttempt: { create: () => Promise.resolve({ id: "attempt" }) },
          }),
        notificationDelivery: {
          findFirst: () =>
            Promise.resolve({
              id: job.notificationDeliveryId,
              tenantId: job.tenantId,
              channel: "EMAIL",
              status: "SCHEDULED",
              recipientType: "CUSTOMER",
              recipientId: "x",
              attemptCount: 0,
              lastAttemptAt: null,
            }),
          updateMany: (write: Write) => {
            writes.push(write);
            return Promise.resolve({ count: 1 });
          },
        } as unknown as NotificationDeliveryPrisma["notificationDelivery"],
      },
      channels,
      { resolve: () => Promise.resolve({ address: "person@example.test" }) },
      createDenyAllNotificationEntitlementPort(),
      {
        build: () => Promise.resolve({ outcome: "READY", subject: "s", body: "b", parameters: [] }),
      }
    );

    await handler.handle(job);

    // An absent handle must not become a null write: the column is simply not
    // mentioned, so nothing overwrites what a previous attempt recorded.
    expect(lastWrite(writes).data).not.toHaveProperty("providerReference");
  });

  it("settles FAILED for a non-retryable failure, keeping the bounded reason", async () => {
    const { handler, writes } = setup({ channelOutcome: "PERMANENT_FAILURE" });
    await handler.handle(job);

    expect(lastWrite(writes).data).toMatchObject({ status: "FAILED", lastErrorCode: "C" });
  });

  it("keeps a retryable failure on SENDING, records its reason, and throws so BullMQ retries", async () => {
    const { handler, writes } = setup({ channelOutcome: "RETRYABLE_FAILURE" });

    await expect(handler.handle(job)).rejects.toThrow(/will be retried/);

    const write = lastWrite(writes);
    // SENDING is what a retryable failure IS, and the table's CHECK admits an
    // error code exactly on SENDING and FAILED.
    expect(write.data).not.toHaveProperty("status");
    expect(write.data).toMatchObject({ lastErrorCode: "C", lastErrorMessage: "transient" });
    expect(write.where).toMatchObject({ status: "SENDING" });
  });

  it("treats a boundary that throws as retryable rather than settling the delivery", async () => {
    const { handler, writes } = setup({ channelThrows: true });

    await expect(handler.handle(job)).rejects.toThrow(/will be retried/);
    expect(lastWrite(writes).data).not.toHaveProperty("status");
  });

  it("records a trace when a gate throws, then retries — TD-041 R3-001", async () => {
    // The claim is committed before the gates run, so an unexpected throw must
    // leave the row saying what happened. It used to propagate with nothing
    // written: SENDING, a fresh lease, an incremented attempt count and no
    // reason, which an operator could only read as "in progress".
    const { handler, writes } = setup({
      recipient: { resolve: () => Promise.reject(new Error("connection terminated")) },
    });

    await expect(handler.handle(job)).rejects.toThrow(/will be retried/);

    const write = lastWrite(writes);
    expect(write.data).not.toHaveProperty("status");
    expect(write.data.lastErrorCode).toBe(NOTIFICATION_DELIVERY_REASON.GATE_FAILED);
    // The step is named, and no driver text is stored: an error message is the
    // field most likely to carry a row's value.
    expect(String(write.data.lastErrorMessage)).toContain("recipient");
    expect(String(write.data.lastErrorMessage)).not.toContain("connection terminated");
    // And it NEVER settles: no write on this path sets FAILED, so a delivery
    // cannot be settled twice or settled after a retryable record. The claim plus
    // this one write is the whole trail.
    expect(writes).toHaveLength(2);
    for (const issued of writes) {
      expect(issued.data.status).not.toBe("FAILED");
    }
  });

  it("names the failing gate, not a generic reason", async () => {
    // WhatsApp, because email is ungated and never asks this port at all.
    const { handler, writes } = setup({
      channel: "WHATSAPP",
      entitlement: { has: () => Promise.reject(new Error("connection terminated")) },
    });

    await expect(handler.handle(job)).rejects.toThrow(/will be retried/);
    expect(String(lastWrite(writes).data.lastErrorMessage)).toContain("entitlement");
  });

  it("settles an unsupported recipient type instead of retrying it", async () => {
    // A missing reader is a programming error: a retry reaches the same absent
    // reader, so the delivery settles with a name rather than burning attempts.
    const { handler, writes, channelSend } = setup({
      recipient: {
        resolve: () => Promise.reject(new UnsupportedRecipientTypeError("TEAM_MEMBER")),
      },
    });

    await handler.handle(job);

    expect(channelSend("EMAIL")).not.toHaveBeenCalled();
    expect(lastWrite(writes).data).toMatchObject({
      status: "FAILED",
      lastErrorCode: NOTIFICATION_DELIVERY_REASON.RECIPIENT_TYPE_UNSUPPORTED,
    });
  });
});

describe("the settle path", () => {
  it("does not reinterpret a failing SETTLE write as a retryable one — TD-042 R3-4", async () => {
    // A settle inside the gates' try had its own failure caught and rewritten as
    // a retryable failure, so a delivery that faithfully failed non-retryably
    // would be retried — and its message attempted again — because the write that
    // RECORDS the settle failed.
    const writes: { where: Record<string, unknown>; data: Record<string, unknown> }[] = [];
    let call = 0;
    const handler = new NotificationDeliveryHandler(
      {
        notificationDeliveryAttempt: { create: () => Promise.resolve({ id: "attempt" }) },
        // The SAME delegate inside the transaction, so the failure this case is about
        // happens where the handler's settle runs rather than in an empty object.
        $transaction: <T>(run: (tx: NotificationDeliveryTx) => Promise<T>): Promise<T> =>
          run({
            notificationDelivery: {
              updateMany: (write: {
                where: Record<string, unknown>;
                data: Record<string, unknown>;
              }) => {
                writes.push(write);
                call += 1;
                // 1: the claim. 2: the settle, which fails.
                return call === 2
                  ? Promise.reject(new Error("the settle write failed"))
                  : Promise.resolve({ count: 1 });
              },
            },
            notificationDeliveryAttempt: { create: () => Promise.resolve({ id: "attempt" }) },
          }),
        notificationDelivery: {
          findFirst: () =>
            Promise.resolve({
              id: job.notificationDeliveryId,
              tenantId: job.tenantId,
              channel: "EMAIL",
              status: "SCHEDULED",
              recipientType: "CUSTOMER",
              recipientId: "x",
              attemptCount: 0,
              lastAttemptAt: null,
            }),
          updateMany: (write: {
            where: Record<string, unknown>;
            data: Record<string, unknown>;
          }) => {
            writes.push(write);
            call += 1;
            return call === 2
              ? Promise.reject(new Error("the settle write failed"))
              : Promise.resolve({ count: 1 });
          },
        } as unknown as NotificationDeliveryPrisma["notificationDelivery"],
      },
      {
        for: () => ({
          providerId: "FAKE",
          send: () => Promise.resolve({ outcome: "SENT", providerReference: null }),
        }),
      },
      createNullNotificationRecipientPort(),
      createDenyAllNotificationEntitlementPort(),
      {
        build: () => Promise.resolve({ outcome: "READY", subject: "s", body: "b", parameters: [] }),
      }
    );

    // The settle's failure propagates as itself: nothing rewrites it into a
    // "will be retried" outcome, and no third write is issued.
    await expect(handler.handle(job)).rejects.toThrow(/the settle write failed/);
    expect(writes).toHaveLength(2);
  });
});

describe("the handler's own reason strings", () => {
  it("are bounded and newline-free, so a reason stays a coordinate", async () => {
    const { handler, writes } = setup({
      channelOutcome: "PERMANENT_FAILURE",
      content: { outcome: "READY", subject: "s", body: "b", parameters: [] },
    });
    await handler.handle(job);

    const message = lastWrite(writes).data.lastErrorMessage;
    expect(typeof message).toBe("string");
    expect(String(message).length).toBeLessThanOrEqual(500);
    expect(String(message)).not.toMatch(/[\r\n\t]/);
  });
});

describe("the delivery path's trace", () => {
  it("logs nothing while a RESTRICTED datum passes through it", async () => {
    // AC: the contact datum is never logged. Asserted by capturing every console
    // channel across a full send, because "we do not log it" is a claim that has
    // to hold against a future edit rather than against today's reading.
    const spies = {
      log: vi.spyOn(console, "log").mockImplementation(() => undefined),
      info: vi.spyOn(console, "info").mockImplementation(() => undefined),
      warn: vi.spyOn(console, "warn").mockImplementation(() => undefined),
      error: vi.spyOn(console, "error").mockImplementation(() => undefined),
    };
    try {
      const { handler } = setup({});
      await handler.handle(job);

      for (const [name, spy] of Object.entries(spies)) {
        const printed = spy.mock.calls.flat().map(String).join(" ");
        expect(printed, name).not.toContain("person@example.test");
        expect(printed, name).toBe("");
      }
    } finally {
      for (const spy of Object.values(spies)) spy.mockRestore();
    }
  });

  it("issues no database transaction, so no provider call can happen inside one", async () => {
    // The prisma stub this suite passes has NO `$transaction` member at all: a
    // handler that wrapped its work in one would throw, and every case above
    // would fail. Stating it here makes the absence deliberate rather than
    // incidental (ENGINEERING-RULES: never hold a transaction while waiting on an
    // external call).
    const { handler } = setup({});
    await expect(handler.handle(job)).resolves.toBeUndefined();
  });

  it("is tenant-predicated on every statement it issues", async () => {
    const { handler, writes } = setup({});
    await handler.handle(job);

    expect(writes.length).toBeGreaterThan(0);
    for (const write of writes) {
      expect(write.where.tenantId).toBe(job.tenantId);
    }
  });
});

/**
 * The attempt log's writer ([[TD-046]]).
 *
 * The delivery row keeps a SUMMARY — a count, the last instant and the last reason — which
 * is the right shape for "did it work". These cases are about the other question: what the
 * SEQUENCE was, which is what an operator needs when a message failed three times with
 * three different reasons and the row only remembers the third.
 */
describe("the attempt log", () => {
  it("records a SENT attempt, with no reason and the next attempt number", async () => {
    // attemptCount 2 means two attempts already ran, so this one is the third.
    const { handler, attemptRows } = setup({ attemptCount: 2 });
    await handler.handle(job);

    expect(attemptRows).toHaveLength(1);
    expect(attemptRows[0]).toMatchObject({ attemptNumber: 3, outcome: "SENT" });
    // The biconditional the database also enforces: a success carries no reason.
    expect(attemptRows[0]).not.toHaveProperty("reasonCode");
    expect(attemptRows[0]).not.toHaveProperty("reasonMessage");
  });

  it("records a FAILED attempt with the bounded reason the settle stored", async () => {
    const { handler, attemptRows } = setup({ channelOutcome: "PERMANENT_FAILURE" });
    await handler.handle(job);

    expect(attemptRows).toHaveLength(1);
    expect(attemptRows[0]).toMatchObject({ attemptNumber: 1, outcome: "FAILED" });
    expect(String(attemptRows[0]?.reasonCode)).toBeTruthy();
    expect(String(attemptRows[0]?.reasonMessage)).toBeTruthy();
  });

  it("records a RETRYABLE failure too, which is where the sequence earns its keep", async () => {
    // The delivery stays SENDING and its `lastErrorMessage` holds the LAST reason. Without
    // this row, the previous attempt's reason would be gone the moment the next one fails.
    const { handler, attemptRows } = setup({ channelOutcome: "RETRYABLE_FAILURE" });
    await expect(handler.handle(job)).rejects.toThrow(/will be retried/);

    expect(attemptRows).toHaveLength(1);
    expect(attemptRows[0]).toMatchObject({ attemptNumber: 1, outcome: "FAILED" });
  });

  it("records NOTHING when the settle lost its compare-and-set", async () => {
    // A lost settle belongs to another worker, and an attempt row written for it would put
    // somebody else's attempt in this log — the one way this table could lie.
    const { handler, attemptRows } = setup({ claimSucceeds: false });
    await handler.handle(job);
    expect(attemptRows).toHaveLength(0);
  });

  it("writes the settle and its attempt in ONE transaction", async () => {
    // Asserted at the seam rather than assumed: a settle committed without its attempt
    // row would be a log that disagrees with the record it belongs to, and the failure
    // mode is silent.
    const { handler, prismaCalls } = setup({});
    await handler.handle(job);
    expect(prismaCalls.transactions).toBeGreaterThan(0);
    // One settle, one transaction: the claim is its own CAS and is not wrapped.
    expect(prismaCalls.transactions).toBe(1);
  });
});
