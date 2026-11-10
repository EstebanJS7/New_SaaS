import { describe, expect, it } from "vitest";
import { createFakeNotificationChannel, FAKE_CHANNEL_RETAINED_ATTEMPTS } from "./fake.channel.js";
import { NOTIFICATION_CHANNEL_REASON } from "./channel.port.js";

const request = {
  tenantId: "11111111-1111-1111-1111-111111111111",
  deliveryId: "22222222-2222-2222-2222-222222222222",
  recipient: "person@example.test",
  subject: "Recordatorio",
  body: "Su turno es mañana.",
  parameters: ["mañana"],
};

const fixedClock = () => new Date("2026-10-17T12:00:00.000Z");

describe("fake notification channel", () => {
  it("is deterministic: the same input produces the same answer and the same clock", async () => {
    const fake = createFakeNotificationChannel({ channel: "EMAIL", clock: fixedClock });
    const first = await fake.send(request);
    const second = await fake.send(request);

    expect(first).toEqual({ outcome: "SENT", providerReference: "fake-email-1" });
    expect(second).toEqual({ outcome: "SENT", providerReference: "fake-email-2" });
    expect(fake.attempts.map((attempt) => attempt.at)).toEqual([
      "2026-10-17T12:00:00.000Z",
      "2026-10-17T12:00:00.000Z",
    ]);
  });

  it("forces each outcome the caller must handle, with the last entry repeating", async () => {
    const fake = createFakeNotificationChannel({
      channel: "WHATSAPP",
      outcomes: ["SENT", "RETRYABLE_FAILURE", "PERMANENT_FAILURE"],
    });

    await expect(fake.send(request)).resolves.toMatchObject({ outcome: "SENT" });
    await expect(fake.send(request)).resolves.toMatchObject({
      outcome: "FAILED",
      retryable: true,
    });
    await expect(fake.send(request)).resolves.toMatchObject({
      outcome: "FAILED",
      retryable: false,
    });
    // The last scripted entry repeats, so a test that exhausts the script keeps
    // getting the answer it asked for rather than an undefined one.
    await expect(fake.send(request)).resolves.toMatchObject({
      outcome: "FAILED",
      retryable: false,
    });
  });

  it("never puts the recipient into a failure reason", async () => {
    const fake = createFakeNotificationChannel({
      channel: "EMAIL",
      outcomes: ["RETRYABLE_FAILURE", "PERMANENT_FAILURE"],
    });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const outcome = await fake.send(request);
      expect(outcome.outcome).toBe("FAILED");
      if (outcome.outcome === "FAILED") {
        expect(outcome.reason).not.toContain(request.recipient);
        expect(outcome.reason).not.toContain("@");
      }
    }
  });

  it("records every attempt in memory, which is the only place a datum is retained", async () => {
    const fake = createFakeNotificationChannel({ channel: "EMAIL", clock: fixedClock });
    await fake.send(request);

    expect(fake.attempts).toEqual([
      {
        tenantId: request.tenantId,
        deliveryId: request.deliveryId,
        recipient: request.recipient,
        subject: request.subject,
        body: request.body,
        parameters: ["mañana"],
        at: "2026-10-17T12:00:00.000Z",
      },
    ]);
  });

  it("retains a bounded number of attempts, and its reference keeps counting — TD-040 R3-004", async () => {
    // The fake is selectable in production for the documented demo path, so an
    // unbounded log would hold a RESTRICTED datum per delivery forever. The
    // counter is separate from the log on purpose: a saturated log that drove the
    // index would start repeating provider references.
    const fake = createFakeNotificationChannel({ channel: "EMAIL", clock: fixedClock });
    for (let i = 0; i < FAKE_CHANNEL_RETAINED_ATTEMPTS + 1; i += 1) {
      await fake.send(request);
    }

    expect(fake.attempts).toHaveLength(FAKE_CHANNEL_RETAINED_ATTEMPTS);
    await expect(fake.send(request)).resolves.toEqual({
      outcome: "SENT",
      providerReference: `fake-email-${FAKE_CHANNEL_RETAINED_ATTEMPTS + 2}`,
    });
  });

  it("copies the parameters rather than holding the caller's array", async () => {
    const fake = createFakeNotificationChannel({ channel: "EMAIL", clock: fixedClock });
    const mutable = { ...request, parameters: ["one"] };
    await fake.send(mutable);

    expect(fake.attempts[0]?.parameters).toEqual(["one"]);
    expect(fake.attempts[0]?.parameters).not.toBe(mutable.parameters);
  });

  it("records an attachment's metadata only, never its bytes (DEC-098)", async () => {
    const fake = createFakeNotificationChannel({ channel: "EMAIL", clock: fixedClock });
    const content = Buffer.from("<html>CONFIDENTIAL KuDE</html>", "utf8");

    await expect(
      fake.send({
        ...request,
        attachments: [
          { filename: "kude-A-0000042.html", contentType: "text/html; charset=utf-8", content },
        ],
      })
    ).resolves.toMatchObject({ outcome: "SENT" });

    expect(fake.attempts[0]?.attachments).toEqual([
      {
        filename: "kude-A-0000042.html",
        contentType: "text/html; charset=utf-8",
        byteLength: content.byteLength,
      },
    ]);
    expect(JSON.stringify(fake.attempts)).not.toContain("CONFIDENTIAL");
  });

  it("refuses an attachment outside the contract, as the real email channel does", async () => {
    const fake = createFakeNotificationChannel({ channel: "EMAIL", clock: fixedClock });

    await expect(
      fake.send({
        ...request,
        attachments: [
          {
            filename: "../x.html",
            contentType: "text/html; charset=utf-8",
            content: Buffer.from("x"),
          },
        ],
      })
    ).resolves.toEqual({
      outcome: "FAILED",
      retryable: false,
      reasonCode: NOTIFICATION_CHANNEL_REASON.ATTACHMENT_REJECTED,
      reason: "The message's attachment is outside the channel's attachment contract.",
    });
  });
});
