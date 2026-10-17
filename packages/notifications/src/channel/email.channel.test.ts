import { describe, expect, it, vi } from "vitest";
import {
  classifyEmailFailure,
  createSmtpEmailChannel,
  isDeliverableEmailAddress,
  type EmailTransport,
  type SmtpEmailConfig,
} from "./email.channel.js";

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
