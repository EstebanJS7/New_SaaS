import { describe, expect, it, vi } from "vitest";
import {
  classifyWhatsAppFailure,
  createWhatsAppCloudChannel,
  isDeliverablePhoneNumber,
  WHATSAPP_CLOUD_DEFAULT_BASE_URL,
  type WhatsAppCloudConfig,
  type WhatsAppFetch,
} from "./whatsapp.channel.js";

const config: WhatsAppCloudConfig = {
  token: "token-secret",
  phoneNumberId: "123456",
  templateName: "appointment_reminder",
  templateLanguage: "es",
};

const request = {
  tenantId: "11111111-1111-1111-1111-111111111111",
  deliveryId: "22222222-2222-2222-2222-222222222222",
  recipient: "+595981123456",
  subject: "Recordatorio",
  body: "body that a template channel cannot send",
  parameters: ["Ana", "mañana 09:00"],
};

function recordingFetch(status: number, body: string) {
  const calls: { url: string; init: Parameters<WhatsAppFetch>[1] }[] = [];
  const fetchImpl: WhatsAppFetch = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve({ status, text: () => Promise.resolve(body) });
  };
  return { fetchImpl, calls };
}

describe("the WhatsApp Cloud adapter", () => {
  it("posts the approved template with the ordered parameters", async () => {
    const { fetchImpl, calls } = recordingFetch(
      200,
      JSON.stringify({ messages: [{ id: "wamid.1" }] })
    );
    const channel = createWhatsAppCloudChannel({ config, fetchImpl });

    await expect(channel.send(request)).resolves.toEqual({
      outcome: "SENT",
      providerReference: "wamid.1",
    });

    const call = calls[0];
    expect(call?.url).toBe(`${WHATSAPP_CLOUD_DEFAULT_BASE_URL}/123456/messages`);
    expect(call?.init.method).toBe("POST");
    expect(call?.init.headers.Authorization).toBe("Bearer token-secret");

    const payload = JSON.parse(String(call?.init.body)) as Record<string, unknown>;
    expect(payload.messaging_product).toBe("whatsapp");
    expect(payload.to).toBe("+595981123456");
    expect(payload.type).toBe("template");
    expect(payload.template).toEqual({
      name: "appointment_reminder",
      language: { code: "es" },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: "Ana" },
            { type: "text", text: "mañana 09:00" },
          ],
        },
      ],
    });
    // A business-initiated message is a template: the rendered body cannot go.
    expect(JSON.stringify(payload)).not.toContain(request.body);
  });

  it("honours a configured base URL", async () => {
    const { fetchImpl, calls } = recordingFetch(200, "{}");
    const channel = createWhatsAppCloudChannel({
      config: { ...config, baseUrl: "https://proxy.example.test/v1" },
      fetchImpl,
    });

    await channel.send(request);
    expect(calls[0]?.url).toBe("https://proxy.example.test/v1/123456/messages");
  });

  it("refuses a malformed base URL at construction, not per send — TD-040 R3-001", () => {
    // Caught per send, a bad URL would be retried to the end of the budget as if
    // the provider were unreachable: a failure attributable to nobody.
    expect(() =>
      createWhatsAppCloudChannel({
        config: { ...config, baseUrl: "not a url" },
        fetchImpl: recordingFetch(200, "{}").fetchImpl,
      })
    ).toThrow(/WHATSAPP_CLOUD_API_BASE_URL must be an absolute URL/);
  });

  it("accepts a 2xx answer with no message id as a send", async () => {
    const { fetchImpl } = recordingFetch(200, "not json at all");
    const channel = createWhatsAppCloudChannel({ config, fetchImpl });
    await expect(channel.send(request)).resolves.toEqual({
      outcome: "SENT",
      providerReference: null,
    });
  });

  it("retries a rate limit and a provider fault, and does not retry a rejection", async () => {
    for (const [status, retryable] of [
      [429, true],
      [500, true],
      [503, true],
      [400, false],
      [401, false],
      [404, false],
    ] as const) {
      const { fetchImpl } = recordingFetch(status, "{}");
      const channel = createWhatsAppCloudChannel({ config, fetchImpl });
      await expect(channel.send(request), String(status)).resolves.toMatchObject({
        outcome: "FAILED",
        retryable,
      });
    }
  });

  it("retries an unreachable provider, and never leaks the error text", async () => {
    const fetchImpl: WhatsAppFetch = async () => {
      // No await: the throw IS the failure under test, and a rejected promise is
      // what a real transport error surfaces as.
      return Promise.reject(new Error(`connect failed for ${request.recipient} with token-secret`));
    };
    const channel = createWhatsAppCloudChannel({ config, fetchImpl });

    const outcome = await channel.send(request);

    expect(outcome).toMatchObject({ outcome: "FAILED", retryable: true });
    if (outcome.outcome === "FAILED") {
      expect(outcome.reason).not.toContain(request.recipient);
      expect(outcome.reason).not.toContain("token-secret");
    }
  });

  it("refuses an undeliverable number and an unfilled template, both without a retry", async () => {
    const { fetchImpl, calls } = recordingFetch(200, "{}");
    const channel = createWhatsAppCloudChannel({ config, fetchImpl });

    await expect(channel.send({ ...request, recipient: "not a number" })).resolves.toMatchObject({
      outcome: "FAILED",
      retryable: false,
    });
    await expect(channel.send({ ...request, parameters: [] })).resolves.toMatchObject({
      outcome: "FAILED",
      retryable: false,
    });
    expect(calls).toHaveLength(0);
  });

  it("bounds one attempt so a hanging provider cannot hold a worker slot", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl: WhatsAppFetch = (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
      const channel = createWhatsAppCloudChannel({ config, fetchImpl, timeoutMs: 50 });

      const pending = channel.send(request);
      await vi.advanceTimersByTimeAsync(60);
      await expect(pending).resolves.toMatchObject({ outcome: "FAILED", retryable: true });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("WhatsApp recipient validation", () => {
  it("accepts E.164-shaped numbers with and without the plus", () => {
    for (const number of ["+595981123456", "595981123456", "+14155552671"]) {
      expect(isDeliverablePhoneNumber(number), number).toBe(true);
    }
  });

  it("refuses separators, headers, letters and implausible lengths", () => {
    for (const number of [
      "+595 981 123456",
      "+595-981-123456",
      "+595981123456\r\nX: y",
      "+0595981123456",
      "12345",
      "+1234567890123456",
      "not a number",
      "",
    ]) {
      expect(isDeliverablePhoneNumber(number), JSON.stringify(number)).toBe(false);
    }
  });
});

describe("WhatsApp failure classification", () => {
  it("treats only 429 and 5xx as retryable, and an unreachable API as retryable", () => {
    expect(classifyWhatsAppFailure(null)).toMatchObject({ retryable: true });
    expect(classifyWhatsAppFailure(429)).toMatchObject({ retryable: true });
    expect(classifyWhatsAppFailure(500)).toMatchObject({ retryable: true });
    expect(classifyWhatsAppFailure(400)).toMatchObject({ retryable: false });
    expect(classifyWhatsAppFailure(403)).toMatchObject({ retryable: false });
  });
});
