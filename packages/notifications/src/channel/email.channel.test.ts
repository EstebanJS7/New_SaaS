import { describe, expect, it, vi } from "vitest";
import {
  classifyEmailFailure,
  createSmtpEmailChannel,
  isDeliverableEmailAddress,
  type EmailTransport,
  type SmtpEmailConfig,
} from "./email.channel.js";
import {
  isAcceptableNotificationAttachment,
  NOTIFICATION_ATTACHMENT_CONTENT_TYPES,
  NOTIFICATION_ATTACHMENT_MAX_BYTES,
  NOTIFICATION_ATTACHMENT_MAX_COUNT,
  NOTIFICATION_CHANNEL_REASON,
} from "./channel.port.js";

const config: SmtpEmailConfig = {
  host: "smtp.example.test",
  port: 587,
  secure: false,
  user: "user",
  password: "secret",
  from: "no-reply@example.test",
};

const request = {
  tenantId: "11111111-1111-1111-1111-111111111111",
  deliveryId: "22222222-2222-2222-2222-222222222222",
  recipient: "person@example.test",
  subject: "Recordatorio",
  body: "Su turno es mañana.",
  parameters: [],
};

function unpack(reason: unknown, into: unknown[]): void {
  into.push(reason);
}

/** A transport that records what it was asked to send and how it was torn down. */
function recordingTransport(result: { messageId?: string } | Error) {
  const sendMail = vi.fn((_options: Record<string, unknown>) =>
    result instanceof Error ? Promise.reject(result) : Promise.resolve(result)
  );
  const close = vi.fn();
  const transport: EmailTransport = { sendMail, close };
  return { transport, sendMail, close };
}

describe("the SMTP email adapter's guardrails (ADR-011)", () => {
  it("builds a transport PER SEND and always closes it", async () => {
    // Guardrail 2. A shared, process-global transport is the shape of the
    // library's own cross-tenant credential advisory, so the adapter may never
    // hold one, and a leak would keep a connection to one tenant's relay alive
    // for the next tenant's send.
    const first = recordingTransport({ messageId: "one" });
    const second = recordingTransport({ messageId: "two" });
    const transportFactory = vi
      .fn<(config: SmtpEmailConfig) => EmailTransport>()
      .mockReturnValueOnce(first.transport)
      .mockReturnValueOnce(second.transport);

    const channel = createSmtpEmailChannel({ config, transportFactory });
    await channel.send(request);
    await channel.send(request);

    expect(transportFactory).toHaveBeenCalledTimes(2);
    expect(transportFactory).toHaveBeenCalledWith(config);
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.close).toHaveBeenCalledTimes(1);
  });

  it("does not let a throwing teardown change the outcome — TD-040 R3-002", async () => {
    // A close() that throws used to propagate out of the `finally` and turn a
    // message that ALREADY LEFT into a recorded failure.
    const sendMail = vi.fn(() => Promise.resolve({ messageId: "one" }));
    const transport = {
      sendMail,
      close: () => {
        throw new Error("teardown exploded");
      },
    };

    const channel = createSmtpEmailChannel({ config, transportFactory: () => transport });

    await expect(channel.send(request)).resolves.toEqual({
      outcome: "SENT",
      providerReference: "one",
    });
  });

  it("survives an ASYNC teardown that rejects — TD-042 R3-1", async () => {
    // The first version of the guard wrapped `close()` in a try/catch, which
    // catches a synchronous throw and NOTHING about a returned rejected promise:
    // the rejection escaped as an unhandled one. The adapter awaits it now.
    const rejections: unknown[] = [];
    const onUnhandled = (reason: unknown) => unpack(reason, rejections);
    process.on("unhandledRejection", onUnhandled);
    try {
      const transport = {
        sendMail: vi.fn(() => Promise.resolve({ messageId: "one" })),
        close: () => Promise.reject(new Error("async teardown exploded")),
      };
      const channel = createSmtpEmailChannel({ config, transportFactory: () => transport });

      await expect(channel.send(request)).resolves.toEqual({
        outcome: "SENT",
        providerReference: "one",
      });
      // Give an unhandled rejection a chance to surface before asserting.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("closes the transport even when the send fails", async () => {
    const failing = recordingTransport(Object.assign(new Error("boom"), { code: "ECONNECTION" }));
    const channel = createSmtpEmailChannel({
      config,
      transportFactory: () => failing.transport,
    });

    await channel.send(request);
    expect(failing.close).toHaveBeenCalledTimes(1);
  });

  it("disables file and URL access on every message", async () => {
    // Guardrail 3: GHSA-8m3c-c648-2xjj is exactly this bypass.
    const { transport, sendMail } = recordingTransport({ messageId: "one" });
    const channel = createSmtpEmailChannel({ config, transportFactory: () => transport });

    await channel.send(request);

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ disableFileAccess: true, disableUrlAccess: true })
    );
  });

  it("sends to exactly the one resolved address, never a list and no caller header", async () => {
    // Guardrail 5. A list is what the address parser's advisories need.
    const { transport, sendMail } = recordingTransport({ messageId: "one" });
    const channel = createSmtpEmailChannel({ config, transportFactory: () => transport });

    await channel.send(request);

    const options = sendMail.mock.calls[0]?.[0];
    expect(options?.to).toBe("person@example.test");
    expect(String(options?.to)).not.toMatch(/[,;]/);
    expect(options?.from).toBe("no-reply@example.test");
  });

  it("reports the provider's message id as the reference, and null when there is none", async () => {
    const withId = recordingTransport({ messageId: "<one@example.test>" });
    const withoutId = recordingTransport({});
    await expect(
      createSmtpEmailChannel({ config, transportFactory: () => withId.transport }).send(request)
    ).resolves.toEqual({ outcome: "SENT", providerReference: "<one@example.test>" });
    await expect(
      createSmtpEmailChannel({ config, transportFactory: () => withoutId.transport }).send(request)
    ).resolves.toEqual({ outcome: "SENT", providerReference: null });
  });

  it("refuses an undeliverable address without a retry and without echoing it", async () => {
    const { transport, sendMail } = recordingTransport({ messageId: "one" });
    const channel = createSmtpEmailChannel({ config, transportFactory: () => transport });

    const outcome = await channel.send({ ...request, recipient: "not an address" });

    expect(outcome).toMatchObject({ outcome: "FAILED", retryable: false });
    if (outcome.outcome === "FAILED") {
      expect(outcome.reason).not.toContain("not an address");
    }
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("never puts the recipient or the transport's message text into a failure", async () => {
    // The message text is the one field a library could have echoed the
    // recipient into, so only the error's own code and response code travel.
    const leaky = Object.assign(new Error(`550 person@example.test mailbox unavailable`), {
      code: "EENVELOPE",
      responseCode: 550,
    });
    const { transport } = recordingTransport(leaky);
    const channel = createSmtpEmailChannel({ config, transportFactory: () => transport });

    const outcome = await channel.send(request);

    expect(outcome).toMatchObject({ outcome: "FAILED", retryable: false });
    if (outcome.outcome === "FAILED") {
      expect(outcome.reason).not.toContain("person@example.test");
      expect(outcome.reason).toContain("550");
    }
  });
});

describe("email address validation", () => {
  it("accepts ordinary addresses", () => {
    for (const address of ["person@example.test", "first.last+tag@sub.example.co", "a@b.co"]) {
      expect(isDeliverableEmailAddress(address), address).toBe(true);
    }
  });

  it("refuses lists, header injection, comments and malformed shapes", () => {
    for (const address of [
      "a@example.test,b@example.test",
      "a@example.test;b@example.test",
      "person@example.test\r\nBcc: thief@example.test",
      "person@example.test\nBcc: thief@example.test",
      "person(comment)@example.test",
      "<person@example.test>",
      '"quoted"@example.test',
      "person@example",
      "@example.test",
      "person@",
      "person@@example.test",
      "person @example.test",
      "",
    ]) {
      expect(isDeliverableEmailAddress(address), JSON.stringify(address)).toBe(false);
    }
  });
});

describe("email failure classification", () => {
  it("retries the transport's failures and the server's temporary refusals", () => {
    for (const error of [
      { code: "ECONNECTION" },
      { code: "ETIMEDOUT" },
      { code: "ESOCKET" },
      { responseCode: 421 },
      { responseCode: 451 },
    ]) {
      expect(classifyEmailFailure(error), JSON.stringify(error)).toMatchObject({ retryable: true });
    }
  });

  it("does not retry a decision, a configuration problem or a bad message", () => {
    for (const error of [
      { responseCode: 550 },
      { responseCode: 553 },
      { code: "EAUTH" },
      { code: "EMESSAGE" },
      {},
    ]) {
      expect(classifyEmailFailure(error), JSON.stringify(error)).toMatchObject({
        retryable: false,
      });
    }
  });
});

describe("the SMTP email adapter's in-memory attachments (DEC-098)", () => {
  const kude = {
    filename: "kude-001-001-0000042.html",
    contentType: "text/html; charset=utf-8" as const,
    content: Buffer.from("<html>KuDE</html>", "utf8"),
  };

  it("sends a message without attachments exactly as before", async () => {
    // The pinned shape: no `attachments` key at all, so a reminder or a recovery
    // mail is byte-for-byte the message it was before attachments existed.
    for (const attachments of [undefined, []]) {
      const { transport, sendMail } = recordingTransport({ messageId: "one" });
      const channel = createSmtpEmailChannel({ config, transportFactory: () => transport });

      await channel.send({ ...request, ...(attachments === undefined ? {} : { attachments }) });

      expect(sendMail.mock.calls[0]?.[0]).toEqual({
        from: "no-reply@example.test",
        to: "person@example.test",
        subject: "Recordatorio",
        text: "Su turno es mañana.",
        disableFileAccess: true,
        disableUrlAccess: true,
      });
    }
  });

  it("passes an attachment as in-memory content only, with file and URL access still off", async () => {
    const { transport, sendMail } = recordingTransport({ messageId: "one" });
    const channel = createSmtpEmailChannel({ config, transportFactory: () => transport });

    await expect(channel.send({ ...request, attachments: [kude] })).resolves.toEqual({
      outcome: "SENT",
      providerReference: "one",
    });

    const options = sendMail.mock.calls[0]?.[0];
    expect(options.disableFileAccess).toBe(true);
    expect(options.disableUrlAccess).toBe(true);
    const attachments = options.attachments as Record<string, unknown>[];
    expect(attachments).toHaveLength(1);
    const [first] = attachments;
    // Exactly these three keys: never `path`, `href`, `raw`, `encoding` or `cid`.
    expect(Object.keys(first ?? {}).sort()).toEqual(["content", "contentType", "filename"]);
    expect(first?.filename).toBe("kude-001-001-0000042.html");
    expect(first?.contentType).toBe("text/html; charset=utf-8");
    expect(Buffer.isBuffer(first?.content)).toBe(true);
    expect((first?.content as Buffer).toString("utf8")).toBe("<html>KuDE</html>");
  });

  it("accepts a plain Uint8Array and hands nodemailer a Buffer", async () => {
    const { transport, sendMail } = recordingTransport({ messageId: "one" });
    const channel = createSmtpEmailChannel({ config, transportFactory: () => transport });

    await channel.send({
      ...request,
      attachments: [{ ...kude, content: new Uint8Array([60, 104, 62]) }],
    });

    const options = sendMail.mock.calls[0]?.[0] as { attachments: { content: unknown }[] };
    expect(Buffer.isBuffer(options.attachments[0]?.content)).toBe(true);
    expect((options.attachments[0]?.content as Buffer).toString("utf8")).toBe("<h>");
  });

  it("refuses an attachment outside the contract, without a retry and without sending", async () => {
    const violations: unknown[] = [
      // A second attachment.
      [kude, { ...kude, filename: "kude-2.html" }],
      // A content type outside the closed allowlist.
      [{ ...kude, contentType: "application/pdf" }],
      // Oversize: one byte over the cap.
      [{ ...kude, content: Buffer.alloc(NOTIFICATION_ATTACHMENT_MAX_BYTES + 1) }],
      // Filenames that could name a path, a header or another type.
      [{ ...kude, filename: "../etc/passwd" }],
      [{ ...kude, filename: "kude.html\r\nBcc: x@example.test" }],
      [{ ...kude, filename: "kude.exe" }],
      [{ ...kude, filename: ".html" }],
      // A path or URL smuggled in place of the bytes.
      [{ ...kude, content: "/etc/passwd" }],
      [{ ...kude, path: "/etc/passwd" }],
      [{ ...kude, href: "https://example.test/x" }],
    ];
    for (const attachments of violations) {
      const { transport, sendMail } = recordingTransport({ messageId: "one" });
      const channel = createSmtpEmailChannel({ config, transportFactory: () => transport });

      const outcome = await channel.send({
        ...request,
        attachments: attachments as never,
      });

      expect(outcome).toEqual({
        outcome: "FAILED",
        retryable: false,
        reasonCode: NOTIFICATION_CHANNEL_REASON.ATTACHMENT_REJECTED,
        reason: "The message's attachment is outside the channel's attachment contract.",
      });
      expect(sendMail).not.toHaveBeenCalled();
    }
  });

  it("accepts an attachment of exactly the byte cap", async () => {
    const { transport, sendMail } = recordingTransport({ messageId: "one" });
    const channel = createSmtpEmailChannel({ config, transportFactory: () => transport });

    await expect(
      channel.send({
        ...request,
        attachments: [{ ...kude, content: Buffer.alloc(NOTIFICATION_ATTACHMENT_MAX_BYTES) }],
      })
    ).resolves.toMatchObject({ outcome: "SENT" });
    expect(sendMail).toHaveBeenCalledTimes(1);
  });
});

describe("the attachment contract", () => {
  it("pins the cap, the count and the closed content-type allowlist", () => {
    expect(NOTIFICATION_ATTACHMENT_MAX_BYTES).toBe(512 * 1024);
    expect(NOTIFICATION_ATTACHMENT_MAX_COUNT).toBe(1);
    expect(NOTIFICATION_ATTACHMENT_CONTENT_TYPES).toEqual(["text/html; charset=utf-8"]);
  });

  it("accepts the KuDE's shape and refuses anything else", () => {
    const valid = {
      filename: "kude-A-0000042.html",
      contentType: "text/html; charset=utf-8",
      content: new Uint8Array([1]),
    };
    expect(isAcceptableNotificationAttachment(valid)).toBe(true);
    expect(isAcceptableNotificationAttachment({ ...valid, filename: "a b.html" })).toBe(false);
    expect(
      isAcceptableNotificationAttachment({ ...valid, filename: `${"a".repeat(65)}.html` })
    ).toBe(false);
    expect(isAcceptableNotificationAttachment({ ...valid, content: new Uint8Array() })).toBe(false);
    expect(isAcceptableNotificationAttachment({ ...valid, extra: 1 })).toBe(false);
    expect(isAcceptableNotificationAttachment(null)).toBe(false);
  });
});
